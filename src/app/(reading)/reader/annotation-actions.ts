"use server";

import { resolveReadingScope } from "@/lib/reading/scope";
import { markText } from "@/lib/reading/inline-chat-blocks";
import { pageForCharOffset } from "@/lib/reading/reader-position";
import { ANCHOR_VERSION, type AnnotationAnchor } from "@/lib/reading/annotation-anchors";
import { BOOK_SCOPES, isBookScope, type BookScope } from "@/lib/reading/book-documents";
import type {
  ReaderAnnotationData,
  AnnotationDetail,
  BookDocumentState,
  ReaderChatMessage,
  ReaderChatModelPreference,
  ReaderChatTemplate,
  AnnotationSummary,
} from "@/lib/reading/annotation-types";
import { isReaderChatTemplate } from "@/lib/reading/annotation-types";
import { recordMentions } from "@/lib/reading/thread-mentions";
import type { StoredMention } from "@/lib/reading/mentions";
import { listRoster } from "@/lib/members/roster";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Reader chat: anchored conversations about a book.
 *
 * Scoping note that applies to EVERY query in this file — resolveReadingScope
 * hands back a service-role client in member mode, which bypasses RLS. So each
 * read filters by the resolved `userId` and each insert sets it explicitly.
 * Dropping one of those filters is a cross-member data leak, not a bug you'd
 * notice locally.
 */

// Two columns are deliberately absent. forked_from_annotation_id: "continue
// from here" is gone and no row in production ever carried one. note: the
// reader's writing moved into the thread as role='note' messages (migration
// 00172), so the column is a backup of the pre-migration state, not live data.
// Both are left in the database — reading them costs nothing to skip, and
// migrations to drop them would buy nothing back.
const CHAT_COLUMNS =
  "id, book_id, thread_id, anchor, anchor_char_offset, anchor_page, spoiler_free, " +
  "context_through_page, quoted_text, chapter_anchor_id, book_scope, color, starred, " +
  "model_preference, template, created_at, shared_from_user_id, anchor_status, " +
  // Embedded rather than fetched separately: the composer needs to know whether
  // Nor is listening before the reader types their first character, and a second
  // round trip would leave the chip guessing for as long as it took.
  "reading_annotation_threads(ai_participant)";

type AnnotationRow = {
  id: string;
  book_id: string;
  /**
   * The conversation this mark points at. Its own row before anything is shared,
   * and the same row on both people's marks once something is — which is the
   * whole reason messages hang off it rather than off the mark. See migration
   * 00180.
   */
  thread_id: string;
  anchor: unknown;
  anchor_char_offset: number;
  anchor_page: number | null;
  spoiler_free: boolean;
  context_through_page: number | null;
  quoted_text: string | null;
  chapter_anchor_id: string | null;
  book_scope: string | null;
  color: string;
  starred: boolean;
  model_preference: string;
  template: string | null;
  created_at: string;
  shared_from_user_id: string | null;
  anchor_status: string;
  reading_annotation_threads: { ai_participant: boolean } | null;
};

type ReadingClient = Awaited<ReturnType<typeof resolveReadingScope>>["client"];

/**
 * Open the conversation a new mark will point at.
 *
 * Every mark gets one, whether or not it is ever shared — a thread of one costs
 * a row and means there is no second creation path to get wrong on the day
 * somebody is mentioned. If the mark's own insert then fails, this leaves a
 * thread with no placement and no messages behind it: unreachable, unbilled, and
 * not worth a transaction to avoid.
 */
async function createThread(client: ReadingClient, userId: string): Promise<string> {
  const { data, error } = await client
    .from("reading_annotation_threads")
    .insert({ created_by: userId })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return (data as { id: string }).id;
}

/**
 * Put someone in a conversation, pointed at their own copy's mark.
 *
 * Only ever the caller putting themselves into a thread they just started —
 * bringing somebody ELSE in is a privileged act and goes through the admin
 * client, which is also what the access rules say (see migration 00186).
 */
async function joinThread(
  client: ReadingClient,
  input: {
    threadId: string;
    userId: string;
    annotationId: string;
    role: "owner" | "participant";
    invitedBy?: string | null;
  }
): Promise<void> {
  const { error } = await client
    .from("reading_annotation_thread_participants")
    .insert({
      thread_id: input.threadId,
      user_id: input.userId,
      annotation_id: input.annotationId,
      role: input.role,
      invited_by: input.invitedBy ?? null,
    });
  // 23505 is two devices opening the same thing at once, which the unique key
  // exists to make harmless. A plain insert rather than an upsert because an
  // upsert would need UPDATE rights on a row that may not be the caller's, and
  // this path only ever puts somebody into a thread they just made.
  if (error && error.code !== "23505") throw new Error(error.message);
}

/**
 * Stamp when a conversation last had something said in it.
 *
 * Denormalized onto the thread so the notification bell can ask "anything new
 * for me?" without reading messages. Best-effort: a missed stamp costs a late
 * notification, and failing the write that the reader actually made would cost
 * their words.
 */
async function touchThread(client: ReadingClient, threadId: string): Promise<void> {
  await client
    .from("reading_annotation_threads")
    .update({ last_message_at: new Date().toISOString() })
    .eq("id", threadId);
}

type SharedState = {
  participants: { userId: string; email: string | null; name: string }[];
  unreadCount: number;
};

/**
 * Who is in these conversations, and what this reader has not read yet.
 *
 * Unread counts only what SOMEBODY ELSE wrote: your own messages arriving in
 * your own bell would be the app telling you about yourself. Notices are
 * excluded for the same reason — they are the app talking, not a person.
 */
async function sharedState(
  client: ReadingClient,
  userId: string,
  threadIds: string[]
): Promise<Map<string, SharedState>> {
  const out = new Map<string, SharedState>();
  if (threadIds.length === 0) return out;

  const { data: rows } = await client
    .from("reading_annotation_thread_participants")
    .select("thread_id, user_id, last_read_at")
    .in("thread_id", threadIds);

  const parts = (rows ?? []) as {
    thread_id: string;
    user_id: string;
    last_read_at: string | null;
  }[];

  // A thread of one is the overwhelming majority and has nothing to say here.
  const byThread = new Map<string, typeof parts>();
  for (const p of parts) {
    byThread.set(p.thread_id, [...(byThread.get(p.thread_id) ?? []), p]);
  }
  const sharedThreads = [...byThread.entries()]
    .filter(([, ps]) => ps.length > 1)
    .map(([id]) => id);
  if (sharedThreads.length === 0) return out;

  const roster = await listRoster();
  const byUserId = new Map(
    roster.filter((m) => m.userId).map((m) => [m.userId as string, m])
  );

  const { data: msgRows } = await client
    .from("reading_annotation_messages")
    .select("thread_id, user_id, role, created_at")
    .in("thread_id", sharedThreads)
    .neq("user_id", userId)
    .neq("role", "notice");

  for (const threadId of sharedThreads) {
    const ps = byThread.get(threadId) ?? [];
    const mine = ps.find((p) => p.user_id === userId);
    const since = mine?.last_read_at ?? null;
    const unread = ((msgRows ?? []) as {
      thread_id: string;
      created_at: string;
    }[]).filter(
      (m) => m.thread_id === threadId && (!since || m.created_at > since)
    ).length;

    out.set(threadId, {
      participants: ps.map((p) => {
        const m = byUserId.get(p.user_id);
        return {
          userId: p.user_id,
          email: m?.email ?? null,
          name: (m?.name ?? "").trim() || (m?.email ?? "").split("@")[0] || "Someone",
        };
      }),
      unreadCount: unread,
    });
  }

  return out;
}

function toSummary(
  row: AnnotationRow,
  counts?: {
    messageCount: number;
    noteCount: number;
    latestNote: string | null;
    lastMessageAt: string | null;
    firstQuestion?: string | null;
  },
  shared?: {
    participants: { userId: string; email: string | null; name: string }[];
    unreadCount: number;
  }
): AnnotationSummary {
  return {
    id: row.id,
    anchor: row.anchor as AnnotationAnchor,
    anchorCharOffset: row.anchor_char_offset,
    anchorPage: row.anchor_page,
    spoilerFree: row.spoiler_free,
    contextThroughPage: row.context_through_page,
    quotedText: row.quoted_text,
    chapterAnchorId: row.chapter_anchor_id,
    bookScope: isBookScope(row.book_scope) ? row.book_scope : null,
    latestNote: counts?.latestNote ?? null,
    noteCount: counts?.noteCount ?? 0,
    color: row.color,
    // Coerced rather than passed through, like aiParticipant above: a row read
    // through a stale PostgREST schema cache comes back without the column at
    // all, and `undefined` where a boolean is declared would make every mark
    // look starred-ish to `!==` comparisons downstream.
    starred: row.starred === true,
    modelPreference: (row.model_preference === "deep"
      ? "deep"
      : "fast") as ReaderChatModelPreference,
    template: isReaderChatTemplate(row.template) ? row.template : null,
    aiParticipant: row.reading_annotation_threads?.ai_participant === true,
    threadId: row.thread_id,
    sharedFromUserId: row.shared_from_user_id,
    anchorStatus:
      row.anchor_status === "relocated" || row.anchor_status === "unplaced"
        ? row.anchor_status
        : "exact",
    participants: shared?.participants ?? [],
    unreadCount: shared?.unreadCount ?? 0,
    messageCount: counts?.messageCount ?? 0,
    lastMessageAt: counts?.lastMessageAt ?? null,
    firstQuestion: counts?.firstQuestion ?? null,
    createdAt: row.created_at,
  };
}

/** Everything the reader needs to render markers and open a chat. */
export async function getAnnotationData(
  bookId: string,
  memberEmail?: string | null
): Promise<ReaderAnnotationData> {
  const { client, userId } = await resolveReadingScope(memberEmail);

  const { data: book } = await client
    .from("reading_books")
    .select("spoiler_free")
    .eq("id", bookId)
    .eq("user_id", userId)
    .maybeSingle();

  const { data: content } = await client
    .from("reading_book_content")
    .select("has_real_pages")
    .eq("book_id", bookId)
    .eq("user_id", userId)
    .maybeSingle();

  const { data: chatRows, error } = await client
    .from("reading_annotations")
    .select(CHAT_COLUMNS)
    .eq("book_id", bookId)
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);

  const rows = (chatRows ?? []) as unknown as AnnotationRow[];

  // One roll-up query rather than a count per chat. Skipped entirely when there
  // are no chats — an empty .in() list is a malformed PostgREST filter, not an
  // empty result.
  // `content` rides along so the opening question can be derived here rather
  // than in a query per annotation. Only the reader's own first line survives
  // this function — a truncated one at that — so no transcript is ever shipped
  // to a client that only wanted to draw margin marks.
  // By thread, and deliberately WITHOUT a user_id filter. On a shared mark the
  // messages belong to the conversation rather than to whoever wrote each one,
  // so filtering by the reader would show them their own half of a two-person
  // thread and nothing else — a wrong count and a wrong preview line, with no
  // error to notice. Access is decided by whether they hold a placement on the
  // thread at all, which the query above has already established.
  const { data: msgRows } = rows.length
    ? await client
        .from("reading_annotation_messages")
        .select("thread_id, created_at, role, content")
        .in(
          "thread_id",
          rows.map((r) => r.thread_id)
        )
    : { data: [] };

  type Stat = {
    messageCount: number;
    noteCount: number;
    latestNote: string | null;
    latestNoteAt: string | null;
    lastMessageAt: string | null;
    firstQuestion: string | null;
    firstQuestionAt: string | null;
    firstNote: string | null;
    firstNoteAt: string | null;
  };
  // Keyed by thread, so a shared mark's stats are the conversation's, not one
  // participant's share of it.
  const stats = new Map<string, Stat>();
  for (const m of (msgRows ?? []) as {
    thread_id: string;
    created_at: string;
    role: string;
    content: string;
  }[]) {
    const cur = stats.get(m.thread_id) ?? {
      messageCount: 0,
      noteCount: 0,
      latestNote: null,
      latestNoteAt: null,
      lastMessageAt: null,
      firstQuestion: null,
      firstQuestionAt: null,
      firstNote: null,
      firstNoteAt: null,
    };
    // Notes and notices are not turns of a conversation, so neither counts
    // toward "3 messages" — an annotation you only ever wrote on should read as
    // a note in the margin, not as a chat you had.
    if (m.role === "user" || m.role === "assistant") cur.messageCount += 1;
    if (!cur.lastMessageAt || m.created_at > cur.lastMessageAt) {
      cur.lastMessageAt = m.created_at;
    }
    // Rows arrive unordered, so earliest and latest are found rather than assumed.
    if (
      m.role === "user" &&
      (!cur.firstQuestionAt || m.created_at < cur.firstQuestionAt)
    ) {
      cur.firstQuestion = markText(m.content);
      cur.firstQuestionAt = m.created_at;
    }
    if (m.role === "note") {
      cur.noteCount += 1;
      if (!cur.latestNoteAt || m.created_at > cur.latestNoteAt) {
        cur.latestNote = m.content;
        cur.latestNoteAt = m.created_at;
      }
      if (!cur.firstNoteAt || m.created_at < cur.firstNoteAt) {
        cur.firstNote = markText(m.content);
        cur.firstNoteAt = m.created_at;
      }
    }
    stats.set(m.thread_id, cur);
  }
  // A note-only annotation still deserves a line in the page and a legible entry
  // in the list, so what it opened with is its first note rather than nothing.
  for (const stat of stats.values()) {
    stat.firstQuestion = stat.firstQuestion ?? stat.firstNote;
  }

  // Who else is in each conversation, and how much of it this reader hasn't
  // seen. One query for the book rather than one per mark — the shelf already
  // learned that lesson with annotation counts.
  const shared = await sharedState(
    client,
    userId,
    rows.map((r) => r.thread_id)
  );

  const { data: pageRows } = await client
    .from("reading_book_pages")
    .select("page_number, char_start, anchor_id")
    .eq("book_id", bookId)
    .eq("user_id", userId)
    .order("page_number", { ascending: true });

  // The reader's preface and afterword are annotations, but they are not marks:
  // they belong to the whole book, they have no passage, and their anchor exists
  // only to satisfy the NOT NULL columns. Dropping them here is the single place
  // that keeps them out of the margin, the gutter, the highlight painter and the
  // marks index — all four of which draw from `chats` alone. They are read on
  // their own page instead; see getBookDocumentStates.
  const marks = rows.filter((r) => !isBookScope(r.book_scope));

  return {
    chats: marks.map((r) =>
      toSummary(r, stats.get(r.thread_id), shared.get(r.thread_id))
    ),
    spoilerFree: book?.spoiler_free === true,
    hasRealPages: content?.has_real_pages === true,
    pageMarks: (
      (pageRows ?? []) as {
        page_number: number;
        char_start: number;
        anchor_id: string;
      }[]
    ).map((p) => ({
      pageNumber: p.page_number,
      charStart: p.char_start,
      anchorId: p.anchor_id,
    })),
  };
}

/**
 * Start a chat at an anchor. The caller supplies WHERE (a block index and its
 * char offset); the server decides what the chat is allowed to see.
 *
 * What it decides here is the opening position, not the final word: until the
 * chat is asked something, the reader can still move the boundary and the model
 * from the panel (see setAnnotationSpoilerFree). The first question freezes both.
 */
export async function createAnnotation(input: {
  bookId: string;
  anchor: AnnotationAnchor;
  anchorCharOffset: number;
  quotedText?: string | null;
  /**
   * Set when the reader tapped a chapter title: the heading's id, which makes
   * this row that chapter's summary. See the migration for why it lives here.
   */
  chapterAnchorId?: string | null;
  memberEmail?: string | null;
}): Promise<AnnotationDetail> {
  const { client, userId } = await resolveReadingScope(input.memberEmail);

  const { data: book } = await client
    .from("reading_books")
    .select("id, spoiler_free, type")
    .eq("id", input.bookId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!book) throw new Error("Book not found.");

  const { data: content } = await client
    .from("reading_book_content")
    .select("char_count, status")
    .eq("book_id", input.bookId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!content || content.status !== "ready") {
    throw new Error("This book isn't ready to read yet.");
  }

  // Never trust a client offset: clamp before it decides anything. For an
  // article char_count is the length of the HTML, not of the text, so this stays
  // a safe upper bound (HTML >= text) without being a tight one — nothing
  // downstream needs it to be, because articles never resolve a page.
  const charCount = (content.char_count as number | null) ?? 0;
  const charOffset = Math.max(
    0,
    Math.min(Math.round(input.anchorCharOffset), Math.max(charCount, 0))
  );

  const anchorPage = await pageForCharOffset(
    client,
    userId,
    input.bookId,
    charOffset
  );
  // Spoiler-free is meaningless for an article and actively wrong to honour:
  // the route would cut context at anchor_char_offset, which for articles is
  // measured in DOM-text space rather than the conversion char space the cut
  // assumes. The UI hides the toggle too; this is the guard that matters.
  //
  // A chapter summary is exempt for a different reason. Asking for one is asking
  // to be told what happens in a chapter, so honouring the boundary would either
  // refuse the thing that was just requested, or — worse — answer it and then
  // refuse every follow-up about the chapter it had already recapped.
  const isArticle = book.type === "article";
  const chapterAnchorId = input.chapterAnchorId ?? null;
  const spoilerFree =
    !isArticle && chapterAnchorId == null && book.spoiler_free === true;

  const threadId = await createThread(client, userId);

  const { data: inserted, error } = await client
    .from("reading_annotations")
    .insert({
      book_id: input.bookId,
      user_id: userId,
      thread_id: threadId,
      anchor: input.anchor,
      anchor_char_offset: charOffset,
      anchor_page: anchorPage,
      spoiler_free: spoilerFree,
      // Only meaningful when spoilerFree; null here with spoilerFree true means
      // "no page map", and the route falls back to anchor_char_offset.
      context_through_page: spoilerFree ? anchorPage : null,
      quoted_text: input.quotedText?.trim() || null,
      chapter_anchor_id: chapterAnchorId,
      // A recap is worth the stronger model — it is read once and remembered,
      // where a chat turn is one of many and can be asked again. Follow-ups
      // inherit it, and the picker in the panel can still change them.
      ...(chapterAnchorId != null ? { model_preference: "deep" } : {}),
    })
    .select(CHAT_COLUMNS)
    .single();
  if (error) throw new Error(error.message);

  const row = inserted as unknown as AnnotationRow;
  await joinThread(client, {
    threadId,
    userId,
    annotationId: row.id,
    role: "owner",
  });

  return { ...toSummary(row), messages: [] };
}

/**
 * Whether the reader's preface and afterword exist yet, and when each was last
 * written — the three facts the Contents needs to offer them.
 *
 * Its own query rather than a field on getAnnotationData, because the two have
 * nothing to do with each other any more: that one feeds the margin, and these
 * are read on their own page. Always returns both scopes, in order, so the
 * Contents renders a stable pair of rows rather than a list that grows.
 */
export async function getBookDocumentStates(
  bookId: string,
  memberEmail?: string | null
): Promise<BookDocumentState[]> {
  const { client, userId } = await resolveReadingScope(memberEmail);

  const { data: rows } = await client
    .from("reading_annotations")
    .select("id, thread_id, book_scope")
    .eq("book_id", bookId)
    .eq("user_id", userId)
    .not("book_scope", "is", null);

  const found = (
    (rows ?? []) as { id: string; thread_id: string; book_scope: string | null }[]
  ).filter((r) => isBookScope(r.book_scope));
  if (found.length === 0) {
    return BOOK_SCOPES.map((scope) => ({
      scope,
      annotationId: null,
      written: false,
      writtenAt: null,
    }));
  }

  // The latest, ordered rather than assumed: a thread holds one document, but
  // what the Contents dates has to be the one you would actually read if you
  // opened it now, not whichever row came back first.
  const { data: msgs } = await client
    .from("reading_annotation_messages")
    .select("thread_id, created_at")
    .eq("role", "document")
    .in(
      "thread_id",
      found.map((r) => r.thread_id)
    )
    .order("created_at", { ascending: false });

  const latest = new Map<string, string>();
  for (const m of (msgs ?? []) as { thread_id: string; created_at: string }[]) {
    if (!latest.has(m.thread_id)) latest.set(m.thread_id, m.created_at);
  }

  return BOOK_SCOPES.map((scope) => {
    const row = found.find((r) => r.book_scope === scope);
    const writtenAt = row ? (latest.get(row.thread_id) ?? null) : null;
    return {
      scope,
      annotationId: row?.id ?? null,
      written: writtenAt != null,
      writtenAt,
    };
  });
}

/**
 * Open the reader's preface or afterword for a book, creating the thread the
 * first time it's asked for.
 *
 * Find-or-create rather than create-then-handle-duplicates, with the unique
 * index as the arbiter: two devices opening the same preface at once must land
 * in the same thread, and only the database can promise that. A 23505 here is
 * the other device having won, so the answer is to read what it wrote.
 *
 * The anchor is a formality. A book-scoped annotation is about the whole book,
 * so there is no passage to point at — the columns are NOT NULL, block zero is
 * the honest answer, and nothing may ever read it. See the migration.
 */
export async function openBookDocument(input: {
  bookId: string;
  scope: BookScope;
  memberEmail?: string | null;
}): Promise<AnnotationDetail> {
  const { client, userId } = await resolveReadingScope(input.memberEmail);

  const { data: book } = await client
    .from("reading_books")
    .select("id, type")
    .eq("id", input.bookId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!book) throw new Error("Book not found.");
  // Articles have no Contents to reach these from, and no page map to cite
  // against. Refused here as well as hidden, because this is the guard that
  // matters.
  if (book.type === "article") {
    throw new Error("Articles don't have a preface or an afterword.");
  }
  const { data: content } = await client
    .from("reading_book_content")
    .select("status")
    .eq("book_id", input.bookId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!content || content.status !== "ready") {
    throw new Error("This book isn't ready to read yet.");
  }

  const find = async () =>
    (
      await client
        .from("reading_annotations")
        .select(CHAT_COLUMNS)
        .eq("book_id", input.bookId)
        .eq("user_id", userId)
        .eq("book_scope", input.scope)
        .maybeSingle()
    ).data as unknown as AnnotationRow | null;

  let row = await find();
  if (!row) {
    const threadId = await createThread(client, userId);
    const { data: inserted, error } = await client
      .from("reading_annotations")
      .insert({
        book_id: input.bookId,
        user_id: userId,
        thread_id: threadId,
        anchor: {
          v: ANCHOR_VERSION,
          kind: "between",
          blockIndex: 0,
          endBlockIndex: null,
          startOffset: null,
          endOffset: null,
          quote: null,
        } satisfies AnnotationAnchor,
        anchor_char_offset: 0,
        anchor_page: null,
        book_scope: input.scope,
        // Both documents read the whole book — a preface that hadn't seen it
        // could only ask about the cover, and an afterword is written after the
        // ending anyway. Fiction leans on the prompt's spoiler rules instead,
        // the same ones the mid-book chat already uses.
        spoiler_free: false,
        context_through_page: null,
        // Never asked at these; the route picks the model outright. Set so
        // nothing in the panel can describe this thread as Fast.
        model_preference: "deep",
      })
      .select(CHAT_COLUMNS)
      .single();
    if (error) {
      // 23505: another device created it between the select and the insert. The
      // thread opened a few lines up is orphaned by that — no placement, no
      // messages, nothing that can reach it.
      row = error.code === "23505" ? await find() : null;
      if (!row) throw new Error(error.message);
    } else {
      row = inserted as unknown as AnnotationRow;
      await joinThread(client, {
        threadId,
        userId,
        annotationId: row.id,
        role: "owner",
      });
    }
  }

  const detail = await getAnnotation(row.id, input.memberEmail);
  if (!detail) throw new Error("Couldn't open that.");
  return detail;
}

/** A chat and its transcript. */
export async function getAnnotation(
  chatId: string,
  memberEmail?: string | null
): Promise<AnnotationDetail | null> {
  const { client, userId } = await resolveReadingScope(memberEmail);

  const { data: row } = await client
    .from("reading_annotations")
    .select(CHAT_COLUMNS)
    .eq("id", chatId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!row) return null;
  const chatRow = row as unknown as AnnotationRow;
  const shared = await sharedState(client, userId, [chatRow.thread_id]);

  // The transcript belongs to the conversation, so it is read by thread and not
  // filtered by who wrote each turn. Holding a placement on the thread — which
  // the query above just proved — is what grants the read.
  const { data: msgs, error } = await client
    .from("reading_annotation_messages")
    .select("id, user_id, role, content, model, mentions, created_at")
    .eq("thread_id", chatRow.thread_id)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);

  const messages: ReaderChatMessage[] = (
    (msgs ?? []) as {
      id: string;
      user_id: string;
      role: string;
      content: string;
      model: string | null;
      mentions: unknown;
      created_at: string;
    }[]
  ).map((m) => ({
    id: m.id,
    authorUserId: m.user_id,
    role: m.role as ReaderChatMessage["role"],
    content: m.content,
    model: m.model,
    mentions: Array.isArray(m.mentions) ? (m.mentions as StoredMention[]) : [],
    createdAt: m.created_at,
  }));

  const notes = messages.filter((m) => m.role === "note");
  return {
    ...toSummary(chatRow, {
      messageCount: messages.filter(
        (m) => m.role === "user" || m.role === "assistant"
      ).length,
      noteCount: notes.length,
      latestNote: notes.at(-1)?.content ?? null,
      lastMessageAt: messages.at(-1)?.createdAt ?? null,
      firstQuestion: (() => {
        const opened = messages.find((m) => m.role === "user" || m.role === "note");
        return opened ? markText(opened.content) : null;
      })(),
    },
    shared.get(chatRow.thread_id)),
    messages,
  };
}

/** Seed for the NEXT chat started in this book. Existing chats keep their own. */
export async function setBookSpoilerFree(
  bookId: string,
  spoilerFree: boolean,
  memberEmail?: string | null
): Promise<void> {
  const { client, userId } = await resolveReadingScope(memberEmail);
  const { error } = await client
    .from("reading_books")
    .update({ spoiler_free: spoilerFree })
    .eq("id", bookId)
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
}

/**
 * Whether this chat has been asked anything yet, which is what decides if its
 * settings are still open to being changed.
 *
 * Questions and answers only. A note freezes nothing: it was never answered, so
 * there is no reply sitting above the settings that was produced under them —
 * jotting a thought and then deciding to ask about it is one continuous act, and
 * the model and the boundary are still yours to pick when you get there.
 *
 * Server-side rather than trusting the client's count, for the same reason
 * discardAnnotationIfEmpty checks here: the chat route commits the reader's
 * question as its first step, so a question whose reply then died still counts
 * as asked, and only the server reliably knows that.
 */
async function annotationIsUnasked(
  client: ReadingClient,
  userId: string,
  annotationId: string
): Promise<boolean> {
  // Counted across the whole conversation rather than this reader's share of it.
  // On a shared mark that means the other person's question freezes the settings
  // too — which is right: the transcript above them was produced under them.
  const { data: row } = await client
    .from("reading_annotations")
    .select("thread_id")
    .eq("id", annotationId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!row) return false;

  const { count } = await client
    .from("reading_annotation_messages")
    .select("id", { count: "exact", head: true })
    .eq("thread_id", (row as { thread_id: string }).thread_id)
    .in("role", ["user", "assistant"]);
  return (count ?? 0) === 0;
}

/**
 * Move a chat's spoiler boundary, which is allowed only until it has been asked
 * something.
 *
 * Both of a chat's settings are chosen alongside its first question and frozen
 * by it. A boundary that could move mid-conversation would leave the transcript
 * above it answered under a rule that no longer holds — and would make "continue
 * from here", which exists precisely BECAUSE boundaries are frozen, meaningless.
 *
 * The two exemptions match createAnnotation exactly: an article has no page map
 * to cut against, and a chapter summary was asked to reveal a chapter. Enforced
 * here and not only in the UI, because this is the guard that matters.
 */
export async function setAnnotationSpoilerFree(
  annotationId: string,
  spoilerFree: boolean,
  memberEmail?: string | null
): Promise<void> {
  const { client, userId } = await resolveReadingScope(memberEmail);

  const { data: row } = await client
    .from("reading_annotations")
    .select("id, book_id, anchor_page, chapter_anchor_id")
    .eq("id", annotationId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!row) throw new Error("Chat not found.");
  if (row.chapter_anchor_id != null) return;

  const { data: book } = await client
    .from("reading_books")
    .select("type")
    .eq("id", row.book_id as string)
    .eq("user_id", userId)
    .maybeSingle();
  if (book?.type === "article") return;

  if (!(await annotationIsUnasked(client, userId, annotationId))) return;

  const anchorPage = row.anchor_page as number | null;
  const { error } = await client
    .from("reading_annotations")
    .update({
      spoiler_free: spoilerFree,
      // Same pairing createAnnotation writes: null WITH spoiler_free set means
      // "no page map", and the route falls back to the anchor's char offset.
      context_through_page: spoilerFree ? anchorPage : null,
    })
    .eq("id", annotationId)
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
}

/** Frozen by the first question, like the spoiler boundary above it. */
export async function setAnnotationModelPreference(
  chatId: string,
  preference: ReaderChatModelPreference,
  memberEmail?: string | null
): Promise<void> {
  const { client, userId } = await resolveReadingScope(memberEmail);
  if (!(await annotationIsUnasked(client, userId, chatId))) return;

  const { error } = await client
    .from("reading_annotations")
    .update({ model_preference: preference })
    .eq("id", chatId)
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
}

/**
 * Turn a blank chat into one of the two mid-book conversations.
 *
 * The reader picks these from inside an empty thread rather than when starting
 * one, so this converts a row that already exists instead of creating a
 * configured one. It carries the settings with it because both templates need
 * them to be what they are: the whole book, and the stronger model.
 *
 * WHY THE WHOLE BOOK. A key to how a novel is read cannot be written from the
 * half the reader has got through, and honouring the boundary would refuse the
 * question they just asked. What stops that being a spoiler machine is the
 * prompt: it is told where they are, forbidden from volunteering anything past
 * it, and lets the key over that line for METHOD only — never an event, a
 * reveal or an ending.
 *
 * Deliberately does NOT touch the book's own spoiler default, which
 * setAnnotationSpoilerFree does drag along on the reasoning that ticking that
 * box by hand is a stance rather than a per-chat setting. Picking a template is
 * not that stance, and silently changing it for every future chat in the book
 * would be a side effect nobody asked for.
 *
 * Guarded by the same unasked check as the two settings above: once a thread has
 * been answered, what it was answered under is settled.
 */
export async function setAnnotationTemplate(
  chatId: string,
  template: ReaderChatTemplate,
  memberEmail?: string | null
): Promise<void> {
  const { client, userId } = await resolveReadingScope(memberEmail);
  if (!(await annotationIsUnasked(client, userId, chatId))) return;

  const { error } = await client
    .from("reading_annotations")
    .update({
      template,
      model_preference: "deep",
      spoiler_free: false,
      // Only meaningful alongside spoiler_free, and stale the moment it is off.
      context_through_page: null,
    })
    .eq("id", chatId)
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
}

/**
 * Keep a passage, or stop keeping it.
 *
 * Unlike the three settings above, this one is NOT frozen by the first question.
 * It says nothing about how the conversation was scoped or answered, only that
 * the reader wants to find this again — and that judgement is likelier to arrive
 * AFTER the conversation than before it. Hence no annotationIsUnasked guard.
 *
 * The .eq("user_id", userId) is doing real work here rather than merely obeying
 * the file's rule. A shared mark is two rows on one thread, and this writes to
 * the caller's. Without the filter — on the service-role client member mode
 * hands back, which does not enforce row-level security — an id alone would let
 * one reader set the OTHER participant's star, which is the single thing this
 * feature promises never to do.
 */
export async function setAnnotationStarred(
  annotationId: string,
  starred: boolean,
  memberEmail?: string | null
): Promise<void> {
  const { client, userId } = await resolveReadingScope(memberEmail);

  const { error } = await client
    .from("reading_annotations")
    .update({ starred })
    .eq("id", annotationId)
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
}

/**
 * Drop a chat that was opened but never used, so an abandoned draft doesn't
 * leave a marker in the margin forever.
 *
 * The emptiness check is server-side rather than trusting the client's idea of
 * whether anything was sent — the route inserts the user's message before it
 * starts streaming, so a chat with any message at all is one the reader
 * committed to, even if the reply failed. Returns whether it was discarded.
 */
export async function discardAnnotationIfEmpty(
  annotationId: string,
  memberEmail?: string | null
): Promise<boolean> {
  const { client, userId } = await resolveReadingScope(memberEmail);

  const { data: row } = await client
    .from("reading_annotations")
    .select("thread_id")
    .eq("id", annotationId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!row) return false;

  // Notes are messages now, so this one check covers both things that make an
  // annotation the reader's rather than an abandoned draft: something asked, or
  // something written.
  //
  // Counted by thread, which matters more than it looks: a mark placed in your
  // copy because somebody mentioned you has no messages OF ITS OWN, and counting
  // by the mark would delete it out of your margin the moment you closed the
  // panel on the conversation you were just reading.
  const { count } = await client
    .from("reading_annotation_messages")
    .select("id", { count: "exact", head: true })
    .eq("thread_id", (row as { thread_id: string }).thread_id);
  if ((count ?? 0) > 0) return false;

  const { error } = await client
    .from("reading_annotations")
    .delete()
    .eq("id", annotationId)
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
  return true;
}

/**
 * Put a message in the thread — the reader's own words, which get no reply here.
 *
 * An append rather than an edit, which is the whole point of moving writing out
 * of a column and into the transcript: the thought you have on a second reading
 * lands under the one you had on the first instead of erasing it. There is
 * deliberately no update or delete for a single message; the way to get rid of
 * your writing on a passage is the delete control, same as before.
 *
 * WHO DECIDES WHAT. The rule about whether Nor answers is a rule about the
 * composer, and it lives on the client, where the chip can show it before you
 * commit to it — sending here means "just save this", and the chat route means
 * "answer this". Nothing about that needs defending, because the worst a wrong
 * guess produces is a reply nobody wanted.
 *
 * What DOES get re-derived here, from the text and never from what the client
 * sent, is who was named — because that is a grant, and a grant somebody else
 * hands you is not a grant.
 */
export async function postAnnotationMessage(
  annotationId: string,
  content: string,
  memberEmail?: string | null
): Promise<void> {
  const text = content.trim();
  if (!text) return;
  const { client, userId, isMemberMode } = await resolveReadingScope(memberEmail);

  // Scoped like every other write in this file: an annotation id alone is not
  // proof the caller owns it.
  const { data: row } = await client
    .from("reading_annotations")
    .select("id, thread_id")
    .eq("id", annotationId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!row) throw new Error("Annotation not found.");
  const threadId = (row as { thread_id: string }).thread_id;

  const mentions = await recordMentions(client, {
    threadId,
    text,
    authorId: userId,
    isMemberMode,
  });

  const { error } = await client.from("reading_annotation_messages").insert({
    thread_id: threadId,
    user_id: userId,
    role: "note",
    content: text,
    mentions,
  });
  if (error) throw new Error(error.message);

  await touchThread(client, threadId);
}

/**
 * Take a mark out of your book.
 *
 * Deletes the PLACEMENT, not the conversation. On your own mark those are the
 * same act and it behaves exactly as it always has: you leave, nobody else is
 * in it, and the thread goes with you, taking the transcript. On a mark you were
 * brought into, it means you stop seeing it in your margin and the other person
 * keeps what you both wrote — which is the only defensible reading of a delete
 * control on somebody else's passage.
 *
 * The last-one-out sweep is in application code rather than a trigger: at family
 * scale the extra round trip is nothing, and losing a race here just leaves an
 * unreachable thread that the next delete will collect.
 */
export async function deleteAnnotation(
  chatId: string,
  memberEmail?: string | null
): Promise<void> {
  const { client, userId } = await resolveReadingScope(memberEmail);

  const { data: row } = await client
    .from("reading_annotations")
    .select("thread_id")
    .eq("id", chatId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!row) return;
  const threadId = (row as { thread_id: string }).thread_id;

  await client
    .from("reading_annotation_thread_participants")
    .delete()
    .eq("thread_id", threadId)
    .eq("user_id", userId);

  const { error } = await client
    .from("reading_annotations")
    .delete()
    .eq("id", chatId)
    .eq("user_id", userId);
  if (error) throw new Error(error.message);

  const { count } = await client
    .from("reading_annotation_thread_participants")
    .select("user_id", { count: "exact", head: true })
    .eq("thread_id", threadId);
  if ((count ?? 0) === 0) {
    // Cascades the messages, which is what makes deleting your own mark still
    // delete your own writing.
    //
    // On the admin client because the last person out is not necessarily the one
    // who started it — a thread whose creator left first can only be cleaned up
    // by somebody the access rules would refuse. Nothing is exposed by this: the
    // row being removed is one that, by the line above, nobody is in.
    await createAdminClient()
      .from("reading_annotation_threads")
      .delete()
      .eq("id", threadId);
  }
}
