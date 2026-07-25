import { NextRequest } from "next/server";
import type Anthropic from "@anthropic-ai/sdk";
import { anthropic } from "@/lib/journal/anthropic";
import { resolveReadingScope } from "@/lib/reading/scope";
import { getTextForRange } from "@/lib/reading/extract-text";
import {
  buildReaderChatSystem,
  FAST_MODEL_CONTEXT_WINDOW,
  FAST_MODEL_HEADROOM,
  READER_CHAT_DEEP_MODEL,
  READER_CHAT_FAST_MODEL,
  READER_CHAT_MAX_CONTEXT_CHARS,
  READER_CHAT_MAX_TOKENS,
} from "@/lib/reading/chat-prompt";

export const runtime = "nodejs";

/** No page boundary — take the book to its end. */
const NO_PAGE_LIMIT = 1_000_000_000;

const PROMOTION_NOTE =
  "Answered with the Deep model — this book is too long for the Fast model's context window.";

type ChatRow = {
  id: string;
  book_id: string;
  spoiler_free: boolean;
  context_through_page: number | null;
  anchor_char_offset: number;
  anchor_page: number | null;
  quoted_text: string | null;
  model_preference: string;
  forked_from_chat_id: string | null;
};

export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    chatId?: string;
    userMessage?: string;
    memberEmail?: string | null;
  };
  const { chatId, userMessage } = body;
  if (!chatId) return new Response("chatId required", { status: 400 });
  if (!userMessage || userMessage.trim().length === 0) {
    return new Response("userMessage required", { status: 400 });
  }

  // Member mode returns a service-role client that bypasses RLS, so every query
  // below filters by this userId explicitly.
  const { client: db, userId } = await resolveReadingScope(body.memberEmail);

  const { data: chatRaw } = await db
    .from("reading_chats")
    .select(
      "id, book_id, spoiler_free, context_through_page, anchor_char_offset, " +
        "anchor_page, quoted_text, model_preference, forked_from_chat_id"
    )
    .eq("id", chatId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!chatRaw) return new Response("chat not found", { status: 404 });
  const chat = chatRaw as unknown as ChatRow;

  const { data: book } = await db
    .from("reading_books")
    .select("title, author")
    .eq("id", chat.book_id)
    .eq("user_id", userId)
    .maybeSingle();
  if (!book) return new Response("book not found", { status: 404 });

  // Thread so far. 'note' rows are app-authored UI text and never go to the model.
  const { data: priorMsgs, error: msgsErr } = await db
    .from("reading_chat_messages")
    .select("role, content")
    .eq("chat_id", chatId)
    .eq("user_id", userId)
    .in("role", ["user", "assistant"])
    .order("created_at", { ascending: true });
  if (msgsErr) return new Response(msgsErr.message, { status: 500 });

  const turns: Anthropic.MessageParam[] = (
    (priorMsgs ?? []) as { role: string; content: string }[]
  ).map((m) => ({
    role: m.role === "assistant" ? "assistant" : "user",
    content: m.content,
  }));
  turns.push({ role: "user", content: userMessage.trim() });

  const { error: insertErr } = await db.from("reading_chat_messages").insert({
    chat_id: chatId,
    user_id: userId,
    role: "user",
    content: userMessage.trim(),
  });
  if (insertErr) return new Response(insertErr.message, { status: 500 });

  // The spoiler boundary was frozen when the chat was created. `spoiler_free`
  // with a null page means the book has no page map at all, so fall back to the
  // anchor's character offset rather than silently taking the whole book.
  const scoped = chat.spoiler_free;
  const throughPage =
    scoped && chat.context_through_page != null
      ? chat.context_through_page
      : NO_PAGE_LIMIT;
  const throughCharOffset =
    scoped && chat.context_through_page == null ? chat.anchor_char_offset : null;

  const slice = await getTextForRange(db, userId, chat.book_id, null, throughPage, {
    pageMarkers: true,
    maxChars: READER_CHAT_MAX_CONTEXT_CHARS,
    throughCharOffset,
  });
  if (!slice) return new Response("book text unavailable", { status: 409 });

  // Fork: carry the parent transcript forward as context (not as real turns).
  let priorTranscript: { role: "user" | "assistant"; content: string }[] | null =
    null;
  let parentAnchorPage: number | null = null;
  if (chat.forked_from_chat_id) {
    const { data: parent } = await db
      .from("reading_chats")
      .select("anchor_page")
      .eq("id", chat.forked_from_chat_id)
      .eq("user_id", userId)
      .maybeSingle();
    parentAnchorPage = (parent?.anchor_page as number | null) ?? null;

    const { data: parentMsgs } = await db
      .from("reading_chat_messages")
      .select("role, content")
      .eq("chat_id", chat.forked_from_chat_id)
      .eq("user_id", userId)
      .in("role", ["user", "assistant"])
      .order("created_at", { ascending: true });
    const rendered = ((parentMsgs ?? []) as { role: string; content: string }[]).map(
      (m) => ({
        role: (m.role === "assistant" ? "assistant" : "user") as "user" | "assistant",
        content: m.content,
      })
    );
    priorTranscript = rendered.length > 0 ? rendered : null;
  }

  const system = buildReaderChatSystem({
    bookTitle: book.title as string,
    bookAuthor: (book.author as string | null) ?? null,
    bookText: slice.text,
    hasPageMarkers: slice.hasPageMarkers,
    spoilerFree: scoped,
    contextThroughPage: scoped ? chat.context_through_page : null,
    quotedText: chat.quoted_text,
    priorTranscript,
    parentAnchorPage,
  });

  const client = anthropic();

  // Deterministic model choice: count the exact payload before sending, and
  // promote if it won't fit Fast. Never a retry-on-error — an oversized request
  // would fail mid-stream after the user already saw it start.
  let model = chat.model_preference === "deep"
    ? READER_CHAT_DEEP_MODEL
    : READER_CHAT_FAST_MODEL;
  let promoted = false;
  if (model === READER_CHAT_FAST_MODEL) {
    try {
      const counted = await client.messages.countTokens({
        model: READER_CHAT_FAST_MODEL,
        system,
        messages: turns,
      });
      if (
        counted.input_tokens >
        FAST_MODEL_CONTEXT_WINDOW - FAST_MODEL_HEADROOM - READER_CHAT_MAX_TOKENS
      ) {
        model = READER_CHAT_DEEP_MODEL;
        promoted = true;
      }
    } catch {
      // Fail open to Fast rather than silently upgrading on a transient error;
      // an over-long request then surfaces as a clear API error.
    }
  }

  if (promoted) {
    const { data: existingNote } = await db
      .from("reading_chat_messages")
      .select("id")
      .eq("chat_id", chatId)
      .eq("user_id", userId)
      .eq("role", "note")
      .limit(1);
    if (!existingNote || existingNote.length === 0) {
      await db.from("reading_chat_messages").insert({
        chat_id: chatId,
        user_id: userId,
        role: "note",
        content: PROMOTION_NOTE,
      });
    }
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      let full = "";
      try {
        const claudeStream = client.messages.stream({
          model,
          max_tokens: READER_CHAT_MAX_TOKENS,
          system,
          messages: turns,
          // Sonnet 5 runs adaptive thinking when `thinking` is omitted, which
          // costs tokens and delays the first visible character in a chat UI.
          ...(model === READER_CHAT_DEEP_MODEL
            ? { thinking: { type: "disabled" as const } }
            : {}),
        });

        for await (const event of claudeStream) {
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            const chunk = event.delta.text;
            full += chunk;
            controller.enqueue(encoder.encode(chunk));
          }
        }

        const trimmed = full.trim();
        if (trimmed.length > 0) {
          await db.from("reading_chat_messages").insert({
            chat_id: chatId,
            user_id: userId,
            role: "assistant",
            content: trimmed,
            model,
          });
        }
        controller.close();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // Marked so the client can render it as an error rather than as text
        // the assistant said. Not persisted — a failed turn leaves no message.
        controller.enqueue(encoder.encode(`\n\n[error: ${msg}]`));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
      "X-Reader-Chat-Model": model,
      "X-Reader-Chat-Promoted": promoted ? "1" : "0",
    },
  });
}
