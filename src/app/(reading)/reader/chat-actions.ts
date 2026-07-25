"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveReadingScope } from "@/lib/reading/scope";
import type { ChatAnchor } from "@/lib/reading/chat-anchors";
import type {
  ReaderChatData,
  ReaderChatDetail,
  ReaderChatMessage,
  ReaderChatModelPreference,
  ReaderChatSummary,
} from "@/lib/reading/chat-types";

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
  "context_through_page, quoted_text, model_preference, forked_from_chat_id, created_at";

type ChatRow = {
  id: string;
  book_id: string;
  anchor: unknown;
  anchor_char_offset: number;
  anchor_page: number | null;
  spoiler_free: boolean;
  context_through_page: number | null;
  quoted_text: string | null;
  model_preference: string;
  forked_from_chat_id: string | null;
  created_at: string;
};

function toSummary(
  row: ChatRow,
  counts?: { messageCount: number; lastMessageAt: string | null }
): ReaderChatSummary {
  return {
    id: row.id,
    anchor: row.anchor as ChatAnchor,
    anchorCharOffset: row.anchor_char_offset,
    anchorPage: row.anchor_page,
    spoilerFree: row.spoiler_free,
    contextThroughPage: row.context_through_page,
    quotedText: row.quoted_text,
    modelPreference: (row.model_preference === "deep"
      ? "deep"
      : "fast") as ReaderChatModelPreference,
    forkedFromChatId: row.forked_from_chat_id,
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
export async function getReaderChatData(
  bookId: string,
  memberEmail?: string | null
): Promise<ReaderChatData> {
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
    .from("reading_chats")
    .select(CHAT_COLUMNS)
    .eq("book_id", bookId)
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);

  const rows = (chatRows ?? []) as unknown as ChatRow[];

  // One roll-up query rather than a count per chat. Skipped entirely when there
  // are no chats — an empty .in() list is a malformed PostgREST filter, not an
  // empty result.
  const { data: msgRows } = rows.length
    ? await client
        .from("reading_chat_messages")
        .select("chat_id, created_at")
        .eq("user_id", userId)
        .in(
          "chat_id",
          rows.map((r) => r.id)
        )
    : { data: [] };

  const stats = new Map<string, { messageCount: number; lastMessageAt: string | null }>();
  for (const m of (msgRows ?? []) as { chat_id: string; created_at: string }[]) {
    const cur = stats.get(m.chat_id) ?? { messageCount: 0, lastMessageAt: null };
    cur.messageCount += 1;
    if (!cur.lastMessageAt || m.created_at > cur.lastMessageAt) {
      cur.lastMessageAt = m.created_at;
    }
    stats.set(m.chat_id, cur);
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
export async function createReaderChat(input: {
  bookId: string;
  anchor: ChatAnchor;
  anchorCharOffset: number;
  quotedText?: string | null;
  forkedFromChatId?: string | null;
  memberEmail?: string | null;
}): Promise<ReaderChatDetail> {
  const { client, userId } = await resolveReadingScope(input.memberEmail);

  const { data: book } = await client
    .from("reading_books")
    .select("id, spoiler_free")
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

  // Never trust a client offset: clamp into the book before it decides anything.
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
  const spoilerFree = book.spoiler_free === true;

  const { data: inserted, error } = await client
    .from("reading_chats")
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
      forked_from_chat_id: input.forkedFromChatId ?? null,
    })
    .select(CHAT_COLUMNS)
    .single();
  if (error) throw new Error(error.message);

  return { ...toSummary(inserted as unknown as ChatRow), messages: [] };
}

/** A chat and its transcript. */
export async function getReaderChat(
  chatId: string,
  memberEmail?: string | null
): Promise<ReaderChatDetail | null> {
  const { client, userId } = await resolveReadingScope(memberEmail);

  const { data: row } = await client
    .from("reading_chats")
    .select(CHAT_COLUMNS)
    .eq("id", chatId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!row) return null;

  const { data: msgs, error } = await client
    .from("reading_chat_messages")
    .select("id, role, content, model, created_at")
    .eq("chat_id", chatId)
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

  const chatRow = row as unknown as ChatRow;
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
export async function forkReaderChat(input: {
  chatId: string;
  anchor: ChatAnchor;
  anchorCharOffset: number;
  memberEmail?: string | null;
}): Promise<ReaderChatDetail> {
  const { client, userId } = await resolveReadingScope(input.memberEmail);

  const { data: parent } = await client
    .from("reading_chats")
    .select("id, book_id")
    .eq("id", input.chatId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!parent) throw new Error("Chat not found.");

  return createReaderChat({
    bookId: parent.book_id as string,
    anchor: input.anchor,
    anchorCharOffset: input.anchorCharOffset,
    forkedFromChatId: parent.id as string,
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

export async function setChatModelPreference(
  chatId: string,
  preference: ReaderChatModelPreference,
  memberEmail?: string | null
): Promise<void> {
  const { client, userId } = await resolveReadingScope(memberEmail);
  const { error } = await client
    .from("reading_chats")
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
export async function discardReaderChatIfEmpty(
  chatId: string,
  memberEmail?: string | null
): Promise<boolean> {
  const { client, userId } = await resolveReadingScope(memberEmail);

  const { count } = await client
    .from("reading_chat_messages")
    .select("id", { count: "exact", head: true })
    .eq("chat_id", chatId)
    .eq("user_id", userId);
  if ((count ?? 0) > 0) return false;

  const { error } = await client
    .from("reading_chats")
    .delete()
    .eq("id", chatId)
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
  return true;
}

export async function deleteReaderChat(
  chatId: string,
  memberEmail?: string | null
): Promise<void> {
  const { client, userId } = await resolveReadingScope(memberEmail);
  const { error } = await client
    .from("reading_chats")
    .delete()
    .eq("id", chatId)
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
}
