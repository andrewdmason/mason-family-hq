"use server";

import { resolveReadingScope } from "@/lib/reading/scope";
import { markText } from "@/lib/reading/inline-chat-blocks";
import { pageForCharOffset } from "@/lib/reading/reader-position";
import type { AnnotationAnchor } from "@/lib/reading/annotation-anchors";
import type {
  ReaderAnnotationData,
  AnnotationDetail,
  ReaderChatMessage,
  ReaderChatModelPreference,
  AnnotationSummary,
} from "@/lib/reading/annotation-types";

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
  "id, book_id, anchor, anchor_char_offset, anchor_page, spoiler_free, " +
  "context_through_page, quoted_text, chapter_anchor_id, color, " +
  "model_preference, created_at";

type AnnotationRow = {
  id: string;
  book_id: string;
  anchor: unknown;
  anchor_char_offset: number;
  anchor_page: number | null;
  spoiler_free: boolean;
  context_through_page: number | null;
  quoted_text: string | null;
  chapter_anchor_id: string | null;
  color: string;
  model_preference: string;
  created_at: string;
};

function toSummary(
  row: AnnotationRow,
  counts?: {
    messageCount: number;
    noteCount: number;
    latestNote: string | null;
    lastMessageAt: string | null;
    firstQuestion?: string | null;
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
    latestNote: counts?.latestNote ?? null,
    noteCount: counts?.noteCount ?? 0,
    color: row.color,
    modelPreference: (row.model_preference === "deep"
      ? "deep"
      : "fast") as ReaderChatModelPreference,
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
  const { data: msgRows } = rows.length
    ? await client
        .from("reading_annotation_messages")
        .select("annotation_id, created_at, role, content")
        .eq("user_id", userId)
        .in(
          "annotation_id",
          rows.map((r) => r.id)
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
  const stats = new Map<string, Stat>();
  for (const m of (msgRows ?? []) as {
    annotation_id: string;
    created_at: string;
    role: string;
    content: string;
  }[]) {
    const cur = stats.get(m.annotation_id) ?? {
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
    stats.set(m.annotation_id, cur);
  }
  // A note-only annotation still deserves a line in the page and a legible entry
  // in the list, so what it opened with is its first note rather than nothing.
  for (const stat of stats.values()) {
    stat.firstQuestion = stat.firstQuestion ?? stat.firstNote;
  }

  const { data: pageRows } = await client
    .from("reading_book_pages")
    .select("page_number, char_start, anchor_id")
    .eq("book_id", bookId)
    .eq("user_id", userId)
    .order("page_number", { ascending: true });

  return {
    chats: rows.map((r) => toSummary(r, stats.get(r.id))),
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

  const { data: inserted, error } = await client
    .from("reading_annotations")
    .insert({
      book_id: input.bookId,
      user_id: userId,
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

  return { ...toSummary(inserted as unknown as AnnotationRow), messages: [] };
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

  const { data: msgs, error } = await client
    .from("reading_annotation_messages")
    .select("id, role, content, model, created_at")
    .eq("annotation_id", chatId)
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);

  const messages: ReaderChatMessage[] = (
    (msgs ?? []) as {
      id: string;
      role: string;
      content: string;
      model: string | null;
      created_at: string;
    }[]
  ).map((m) => ({
    id: m.id,
    role: m.role as ReaderChatMessage["role"],
    content: m.content,
    model: m.model,
    createdAt: m.created_at,
  }));

  const chatRow = row as unknown as AnnotationRow;
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
    }),
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
  client: Awaited<ReturnType<typeof resolveReadingScope>>["client"],
  userId: string,
  annotationId: string
): Promise<boolean> {
  const { count } = await client
    .from("reading_annotation_messages")
    .select("id", { count: "exact", head: true })
    .eq("annotation_id", annotationId)
    .eq("user_id", userId)
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

  // Notes are messages now, so this one check covers both things that make an
  // annotation the reader's rather than an abandoned draft: something asked, or
  // something written.
  const { count } = await client
    .from("reading_annotation_messages")
    .select("id", { count: "exact", head: true })
    .eq("annotation_id", annotationId)
    .eq("user_id", userId);
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
 * Add a note to the thread — the reader's own words, which get no reply.
 *
 * An append rather than an edit, which is the whole point of moving notes out of
 * a column and into the transcript: the thought you have on a second reading
 * lands under the one you had on the first instead of erasing it. There is
 * deliberately no update or delete for a single note; the way to get rid of your
 * writing on a passage is the delete control, same as before.
 */
export async function addAnnotationNote(
  annotationId: string,
  content: string,
  memberEmail?: string | null
): Promise<void> {
  const text = content.trim();
  if (!text) return;
  const { client, userId } = await resolveReadingScope(memberEmail);

  // Scoped like every other write in this file: an annotation id alone is not
  // proof the caller owns it.
  const { data: row } = await client
    .from("reading_annotations")
    .select("id")
    .eq("id", annotationId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!row) throw new Error("Annotation not found.");

  const { error } = await client.from("reading_annotation_messages").insert({
    annotation_id: annotationId,
    user_id: userId,
    role: "note",
    content: text,
  });
  if (error) throw new Error(error.message);
}

export async function deleteAnnotation(
  chatId: string,
  memberEmail?: string | null
): Promise<void> {
  const { client, userId } = await resolveReadingScope(memberEmail);
  const { error } = await client
    .from("reading_annotations")
    .delete()
    .eq("id", chatId)
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
}
