"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveReadingScope } from "@/lib/reading/scope";
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

const CHAT_COLUMNS =
  "id, book_id, anchor, anchor_char_offset, anchor_page, spoiler_free, " +
  "context_through_page, quoted_text, note, color, model_preference, " +
  "forked_from_annotation_id, created_at";

type AnnotationRow = {
  id: string;
  book_id: string;
  anchor: unknown;
  anchor_char_offset: number;
  anchor_page: number | null;
  spoiler_free: boolean;
  context_through_page: number | null;
  quoted_text: string | null;
  note: string | null;
  color: string;
  model_preference: string;
  forked_from_annotation_id: string | null;
  created_at: string;
};

function toSummary(
  row: AnnotationRow,
  counts?: { messageCount: number; lastMessageAt: string | null }
): AnnotationSummary {
  return {
    id: row.id,
    anchor: row.anchor as AnnotationAnchor,
    anchorCharOffset: row.anchor_char_offset,
    anchorPage: row.anchor_page,
    spoilerFree: row.spoiler_free,
    contextThroughPage: row.context_through_page,
    quotedText: row.quoted_text,
    note: row.note,
    color: row.color,
    modelPreference: (row.model_preference === "deep"
      ? "deep"
      : "fast") as ReaderChatModelPreference,
    forkedFromAnnotationId: row.forked_from_annotation_id,
    messageCount: counts?.messageCount ?? 0,
    lastMessageAt: counts?.lastMessageAt ?? null,
    createdAt: row.created_at,
  };
}

/**
 * Resolve a character offset to the page containing it: the highest page whose
 * char_start is at or before the offset. Null when the book has no page map.
 *
 * Server-side on purpose — the client knows its block index but must never get
 * to choose its own spoiler boundary.
 */
async function pageForCharOffset(
  client: SupabaseClient,
  userId: string,
  bookId: string,
  charOffset: number
): Promise<number | null> {
  const { data } = await client
    .from("reading_book_pages")
    .select("page_number")
    .eq("book_id", bookId)
    .eq("user_id", userId)
    .lte("char_start", charOffset)
    .order("page_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data?.page_number as number | undefined) ?? null;
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
  const { data: msgRows } = rows.length
    ? await client
        .from("reading_annotation_messages")
        .select("annotation_id, created_at")
        .eq("user_id", userId)
        .in(
          "annotation_id",
          rows.map((r) => r.id)
        )
    : { data: [] };

  const stats = new Map<string, { messageCount: number; lastMessageAt: string | null }>();
  for (const m of (msgRows ?? []) as { annotation_id: string; created_at: string }[]) {
    const cur = stats.get(m.annotation_id) ?? { messageCount: 0, lastMessageAt: null };
    cur.messageCount += 1;
    if (!cur.lastMessageAt || m.created_at > cur.lastMessageAt) {
      cur.lastMessageAt = m.created_at;
    }
    stats.set(m.annotation_id, cur);
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
 * char offset); the server decides what the chat is allowed to see and freezes
 * it here, once, for the life of the chat.
 */
export async function createAnnotation(input: {
  bookId: string;
  anchor: AnnotationAnchor;
  anchorCharOffset: number;
  quotedText?: string | null;
  /** Set when the reader picked "Note" rather than "Highlight" or "Ask". */
  note?: string | null;
  forkedFromAnnotationId?: string | null;
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
  const isArticle = book.type === "article";
  const spoilerFree = !isArticle && book.spoiler_free === true;

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
      note: input.note?.trim() || null,
      forked_from_annotation_id: input.forkedFromAnnotationId ?? null,
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
  return {
    ...toSummary(chatRow, {
      messageCount: messages.length,
      lastMessageAt: messages.at(-1)?.createdAt ?? null,
    }),
    messages,
  };
}

/**
 * "Continue from here": a NEW chat at a new anchor, carrying the old
 * transcript forward as prompt context (see chat-prompt.ts). The parent is left
 * exactly as it was — its frozen boundary is the whole point of forking.
 */
export async function forkAnnotation(input: {
  chatId: string;
  anchor: AnnotationAnchor;
  anchorCharOffset: number;
  memberEmail?: string | null;
}): Promise<AnnotationDetail> {
  const { client, userId } = await resolveReadingScope(input.memberEmail);

  const { data: parent } = await client
    .from("reading_annotations")
    .select("id, book_id")
    .eq("id", input.chatId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!parent) throw new Error("Chat not found.");

  return createAnnotation({
    bookId: parent.book_id as string,
    anchor: input.anchor,
    anchorCharOffset: input.anchorCharOffset,
    forkedFromAnnotationId: parent.id as string,
    memberEmail: input.memberEmail,
  });
}

/** Flip the book's spoiler switch. Affects NEW chats only. */
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

export async function setAnnotationModelPreference(
  chatId: string,
  preference: ReaderChatModelPreference,
  memberEmail?: string | null
): Promise<void> {
  const { client, userId } = await resolveReadingScope(memberEmail);
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

  const { count } = await client
    .from("reading_annotation_messages")
    .select("id", { count: "exact", head: true })
    .eq("annotation_id", annotationId)
    .eq("user_id", userId);
  if ((count ?? 0) > 0) return false;

  // A note makes this the reader's writing, not an abandoned draft. Under the
  // old chat-only model "no messages" meant "garbage"; it no longer does, and
  // this check is what stops a highlight being deleted out from under someone.
  const { data: row } = await client
    .from("reading_annotations")
    .select("note")
    .eq("id", annotationId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!row || row.note != null) return false;

  const { error } = await client
    .from("reading_annotations")
    .delete()
    .eq("id", annotationId)
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
  return true;
}

/**
 * Write (or clear) the reader's note on an annotation. This is how a highlight
 * becomes a note and how a note is edited — always the same row, never a new one.
 *
 * Clearing the note does NOT delete the annotation: erasing what you wrote
 * leaves the passage highlighted, which is the reversible reading of the
 * gesture. Getting rid of it entirely is what the delete control is for.
 */
export async function setAnnotationNote(
  annotationId: string,
  note: string | null,
  memberEmail?: string | null
): Promise<void> {
  const { client, userId } = await resolveReadingScope(memberEmail);
  const { error } = await client
    .from("reading_annotations")
    .update({ note: note?.trim() || null })
    .eq("id", annotationId)
    .eq("user_id", userId);
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
