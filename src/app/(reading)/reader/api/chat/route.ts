import { NextRequest } from "next/server";
import type Anthropic from "@anthropic-ai/sdk";
import { anthropic } from "@/lib/journal/anthropic";
import { resolveReadingScope } from "@/lib/reading/scope";
import { getTextForRange } from "@/lib/reading/extract-text";
import { getBookPreface } from "@/lib/reading/book-document-context";
import { gatherReaderProfile } from "@/lib/reading/reader-profile";
import { todayLocal } from "@/lib/journal/today";
import { resolveReaderPosition } from "@/lib/reading/reader-position";
import {
  buildReaderChatSystem,
  FALLBACK_CHARS_PER_TOKEN,
  FAST_MODEL_CONTEXT_WINDOW,
  FAST_MODEL_HEADROOM,
  READER_CHAT_DEEP_EFFORT,
  READER_CHAT_DEEP_MAX_TOKENS,
  READER_CHAT_DEEP_MODEL,
  READER_CHAT_FAST_MODEL,
  READER_CHAT_MAX_CONTEXT_CHARS,
  READER_CHAT_MAX_TOKENS,
  readerWebSearchTools,
  SEARCH_TOOL_TOKEN_ALLOWANCE,
  THINKING_STATUS,
} from "@/lib/reading/chat-prompt";
import { statusFrame } from "@/lib/reading/chat-stream";
import {
  collectWebSources,
  MAX_SEARCH_RESUMES,
  SEARCHING_STATUS,
  sourcesLine,
} from "@/lib/reading/web-sources";

export const runtime = "nodejs";

/** No page boundary — take the book to its end. */
const NO_PAGE_LIMIT = 1_000_000_000;

const PROMOTION_NOTE =
  "Answered with the Deep model — this book is too long for the Fast model's context window.";

type AnnotationRow = {
  id: string;
  book_id: string;
  spoiler_free: boolean;
  context_through_page: number | null;
  anchor_char_offset: number;
  anchor_page: number | null;
  quoted_text: string | null;
  model_preference: string;
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
  const { client: db, userId, email } = await resolveReadingScope(body.memberEmail);

  const { data: chatRaw } = await db
    .from("reading_annotations")
    .select(
      "id, book_id, spoiler_free, context_through_page, anchor_char_offset, " +
        "anchor_page, quoted_text, model_preference"
    )
    .eq("id", chatId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!chatRaw) return new Response("chat not found", { status: 404 });
  const chat = chatRaw as unknown as AnnotationRow;

  const { data: book } = await db
    .from("reading_books")
    .select("title, author, type")
    .eq("id", chat.book_id)
    .eq("user_id", userId)
    .maybeSingle();
  if (!book) return new Response("book not found", { status: 404 });

  // Thread so far. 'notice' rows are app-authored UI text and never go to the
  // model; 'note' rows are the reader's own writing and do — see the marker
  // below and the explanation of it in chat-prompt.ts.
  const { data: priorMsgs, error: msgsErr } = await db
    .from("reading_annotation_messages")
    .select("role, content")
    .eq("annotation_id", chatId)
    .eq("user_id", userId)
    .in("role", ["user", "assistant", "note"])
    .order("created_at", { ascending: true });
  if (msgsErr) return new Response(msgsErr.message, { status: 500 });

  const rendered = ((priorMsgs ?? []) as { role: string; content: string }[]).map(
    (m) => ({
      role: (m.role === "assistant" ? "assistant" : "user") as "assistant" | "user",
      content: m.role === "note" ? `[Reader's note] ${m.content}` : m.content,
    })
  );
  rendered.push({ role: "user", content: userMessage.trim() });
  const hasReaderNotes = (priorMsgs ?? []).some(
    (m) => (m as { role: string }).role === "note"
  );

  // Consecutive same-role turns are folded into one. A note followed by the
  // question it prompted is the ordinary case now, and that is two user turns in
  // a row — permitted by the API, but merging costs nothing and keeps this
  // working whichever way that rule lands.
  const turns: Anthropic.MessageParam[] = [];
  for (const turn of rendered) {
    const last = turns.at(-1);
    if (last && last.role === turn.role) {
      last.content = `${last.content as string}\n\n${turn.content}`;
    } else {
      turns.push({ role: turn.role, content: turn.content });
    }
  }

  const { error: insertErr } = await db.from("reading_annotation_messages").insert({
    annotation_id: chatId,
    user_id: userId,
    role: "user",
    content: userMessage.trim(),
  });
  if (insertErr) return new Response(insertErr.message, { status: 500 });

  // The spoiler boundary is frozen by the first question, and the insert above
  // was that question if this is the first turn — so it can no longer move under
  // this thread while the thread is being answered. `spoiler_free`
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
    chapterMarkers: true,
    maxChars: READER_CHAT_MAX_CONTEXT_CHARS,
    throughCharOffset,
  });
  if (!slice) return new Response("book text unavailable", { status: 409 });

  // An unscoped chat holds the whole book, so the model has to be told where the
  // reader actually is — left to infer it from where the text runs out, it reads
  // the last page as their position and starts explaining the ending. A scoped
  // chat needs none of this: the text stops at the boundary. An article has no
  // "further on" to protect, and its char_count is HTML length, so any
  // percentage derived from it would be nonsense.
  const isArticle = (book.type as string | null) === "article";
  const readerPosition =
    scoped || isArticle
      ? null
      : await resolveReaderPosition(db, userId, chat.book_id, chat.anchor_char_offset);

  // The one place the reader's stated intent travels to. An article can't have
  // a preface — there is no Contents to write one from — so this is a book-only
  // lookup, and null for the vast majority of books.
  // Both of these are round trips that sit between the reader pressing send and
  // the first token, so they go together rather than one after the other.
  //
  // The profile is who they are, so a name they drop mid-conversation resolves
  // to somebody. Scoped to the book's OWNER, not the signed-in caller — in
  // member mode those are different people, and the wrong one here is a parent's
  // life turning up inside a kid's chat.
  const [readerIntent, readerProfile] = await Promise.all([
    isArticle ? null : getBookPreface(db, userId, chat.book_id),
    todayLocal().then((today) => gatherReaderProfile(db, userId, email, today)),
  ]);

  const system = buildReaderChatSystem({
    bookTitle: book.title as string,
    bookAuthor: (book.author as string | null) ?? null,
    bookText: slice.text,
    hasPageMarkers: slice.hasPageMarkers,
    hasChapterMarkers: slice.hasChapterMarkers,
    chapters: slice.chapters,
    spoilerFree: scoped,
    contextThroughPage: scoped ? chat.context_through_page : null,
    readerPosition,
    quotedText: chat.quoted_text,
    hasReaderNotes,
    readerIntent,
    readerProfile,
  });

  const client = anthropic();

  // Deterministic model choice: count the payload before sending, and promote
  // if it won't fit Fast. Never a retry-on-error — an oversized request would
  // fail mid-stream after the user already saw it start.
  let model = chat.model_preference === "deep"
    ? READER_CHAT_DEEP_MODEL
    : READER_CHAT_FAST_MODEL;
  let promoted = false;
  if (model === READER_CHAT_FAST_MODEL) {
    const budget =
      FAST_MODEL_CONTEXT_WINDOW - FAST_MODEL_HEADROOM - READER_CHAT_MAX_TOKENS;
    let counted: number;
    try {
      // No `tools` here, deliberately: the count-tokens endpoint refuses any
      // request carrying a server tool and 400s the whole call rather than
      // counting the rest. The search tool is added back as a flat allowance —
      // see SEARCH_TOOL_TOKEN_ALLOWANCE, which is where the reasoning lives.
      const counting = await client.messages.countTokens({
        model: READER_CHAT_FAST_MODEL,
        system,
        messages: turns,
      });
      counted = counting.input_tokens + SEARCH_TOOL_TOKEN_ALLOWANCE;
    } catch {
      // Counting failed. Estimate from the payload's own length rather than
      // assuming it fits: the failure mode this replaces was a silent fall
      // through to Fast, which turned a long book into an error the reader saw
      // in place of their answer.
      const chars =
        system.reduce((n, block) => n + block.text.length, 0) +
        turns.reduce((n, turn) => n + (turn.content as string).length, 0);
      counted = Math.ceil(chars / FALLBACK_CHARS_PER_TOKEN);
    }
    if (counted > budget) {
      model = READER_CHAT_DEEP_MODEL;
      promoted = true;
    }
  }

  if (promoted) {
    const { data: existingNote } = await db
      .from("reading_annotation_messages")
      .select("id")
      .eq("annotation_id", chatId)
      .eq("user_id", userId)
      .eq("role", "notice")
      .limit(1);
    if (!existingNote || existingNote.length === 0) {
      await db.from("reading_annotation_messages").insert({
        annotation_id: chatId,
        user_id: userId,
        role: "notice",
        content: PROMOTION_NOTE,
      });
    }
  }

  const tools = readerWebSearchTools(model);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      let full = "";
      // url -> the markdown link for it, so a page cited three times is listed
      // once and in the order it was first leaned on.
      const sources = new Map<string, string>();
      try {
        // Grows only when a turn comes back paused; the ordinary case runs this
        // body once and breaks out at the bottom.
        const conversation = [...turns];

        // What the panel is showing right now, so a frame goes out only when it
        // changes. Outside the round loop deliberately: a turn that pauses
        // mid-search resumes straight into more of the same work, and clearing
        // at the round boundary would blink the line off and back on.
        let status: string | null = null;
        const setStatus = (next: string | null) => {
          if (next === status) return;
          status = next;
          controller.enqueue(encoder.encode(statusFrame(next)));
        };

        const deep = model === READER_CHAT_DEEP_MODEL;

        for (let round = 0; ; round++) {
          const claudeStream = client.messages.stream({
            model,
            max_tokens: deep ? READER_CHAT_DEEP_MAX_TOKENS : READER_CHAT_MAX_TOKENS,
            system,
            tools,
            messages: conversation,
            // Deep thinks before it answers — how often, and how much that is
            // worth, is measured in READER_CHAT_DEEP_EFFORT. Set explicitly
            // rather than omitted: leaving `thinking` out runs Sonnet's own
            // default, which is not the level these numbers were taken at.
            //
            // `display` is set rather than left alone because the reasoning is
            // never shown: the panel says only THAT it is thinking. Nothing
            // downstream reads a thinking block, so a server-side default that
            // started returning summaries would be tokens spent on text no one
            // ever sees.
            ...(deep
              ? {
                  thinking: { type: "adaptive" as const, display: "omitted" as const },
                  output_config: { effort: READER_CHAT_DEEP_EFFORT },
                }
              : {}),
          });

          for await (const event of claudeStream) {
            if (event.type === "content_block_start") {
              if (event.content_block.type === "thinking") {
                setStatus(THINKING_STATUS);
                continue;
              }
              // A search has started. Nothing will stream until it comes back, so
              // say what's happening rather than leaving a spinner to imply it.
              //
              // Any server-side tool counts, not just the one named `web_search`:
              // search is the only tool this chat has, and the newer version of it
              // runs code of its own to filter results before they reach the
              // model. That work is part of the wait the reader is sitting through.
              if (event.content_block.type === "server_tool_use") {
                setStatus(SEARCHING_STATUS);
                continue;
              }
            }
            if (
              event.type === "content_block_delta" &&
              event.delta.type === "text_delta"
            ) {
              // The answer is arriving, which is a better answer to "what is it
              // doing" than any status line.
              setStatus(null);
              const chunk = event.delta.text;
              full += chunk;
              controller.enqueue(encoder.encode(chunk));
            }
          }

          const finished = await claudeStream.finalMessage();

          collectWebSources(finished.content, sources);

          if (finished.stop_reason !== "pause_turn" || round >= MAX_SEARCH_RESUMES) break;
          // Resuming is re-sending with the paused turn appended; the server
          // picks up from the trailing server-tool block on its own.
          conversation.push({
            role: "assistant",
            content: finished.content as Anthropic.ContentBlockParam[],
          });
        }

        // The turn is over however it ended — a status left standing here would
        // sit under a finished answer forever.
        setStatus(null);

        // Appended by the app rather than written by the model, so a searched
        // answer always says where it went and an unsearched one never grows a
        // heading it doesn't need. Streamed and persisted identically, so a
        // reload shows what the reader just watched arrive.
        const line = sourcesLine(sources);
        if (line) {
          full += line;
          controller.enqueue(encoder.encode(line));
        }

        const trimmed = full.trim();
        if (trimmed.length > 0) {
          await db.from("reading_annotation_messages").insert({
            annotation_id: chatId,
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
