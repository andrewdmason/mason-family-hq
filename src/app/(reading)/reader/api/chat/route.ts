import { NextRequest } from "next/server";
import type Anthropic from "@anthropic-ai/sdk";
import { anthropic } from "@/lib/journal/anthropic";
import { resolveReadingScope } from "@/lib/reading/scope";
import { getTextForRange } from "@/lib/reading/extract-text";
import { getBookPreface } from "@/lib/reading/book-document-context";
import { resolveReaderPosition } from "@/lib/reading/reader-position";
import {
  buildReaderChatSystem,
  FALLBACK_CHARS_PER_TOKEN,
  FAST_MODEL_CONTEXT_WINDOW,
  FAST_MODEL_HEADROOM,
  READER_CHAT_DEEP_MODEL,
  READER_CHAT_FAST_MODEL,
  READER_CHAT_MAX_CONTEXT_CHARS,
  READER_CHAT_MAX_TOKENS,
  readerChatTools,
  SEARCH_TOOL_TOKEN_ALLOWANCE,
} from "@/lib/reading/chat-prompt";
import { statusFrame } from "@/lib/reading/chat-stream";

export const runtime = "nodejs";

/** No page boundary — take the book to its end. */
const NO_PAGE_LIMIT = 1_000_000_000;

const PROMOTION_NOTE =
  "Answered with the Deep model — this book is too long for the Fast model's context window.";

/** What the panel shows while a search is running. See chat-stream.ts. */
const SEARCHING_STATUS = "Searching the web…";

/**
 * How many times a paused turn may be resumed.
 *
 * A turn that uses the search tool can come back `pause_turn` instead of
 * finishing — the server-side tool loop hit its own iteration limit. Resuming is
 * just re-sending the conversation with the paused turn on the end. Bounded
 * because the alternative is a loop, and two rounds is far more than a
 * three-search cap can actually need.
 */
const MAX_RESUMES = 2;

/**
 * A source, rendered for the line under the answer.
 *
 * The title is what the page calls itself, which is usually right and
 * occasionally a hundred characters of SEO; capped rather than trusted. Square
 * brackets and parentheses come out because this becomes a markdown link, and a
 * title containing either would end the link early and leave a URL on screen.
 */
function sourceLink(title: string | null, url: string): string {
  let label = (title ?? "").replace(/[[\]]/g, "").trim();
  if (!label) {
    try {
      label = new URL(url).hostname.replace(/^www\./, "");
    } catch {
      label = url;
    }
  }
  if (label.length > 48) label = `${label.slice(0, 47).trimEnd()}…`;
  return `[${label}](${url.replace(/\)/g, "%29")})`;
}

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
  const { client: db, userId } = await resolveReadingScope(body.memberEmail);

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
  const readerIntent = isArticle
    ? null
    : await getBookPreface(db, userId, chat.book_id);

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

  const tools = readerChatTools(model);

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

        for (let round = 0; ; round++) {
          const claudeStream = client.messages.stream({
            model,
            max_tokens: READER_CHAT_MAX_TOKENS,
            system,
            tools,
            messages: conversation,
            // Sonnet 5 runs adaptive thinking when `thinking` is omitted, which
            // costs tokens and delays the first visible character in a chat UI.
            ...(model === READER_CHAT_DEEP_MODEL
              ? { thinking: { type: "disabled" as const } }
              : {}),
          });

          let searching = false;
          for await (const event of claudeStream) {
            // A search has started. Nothing will stream until it comes back, so
            // say what's happening rather than leaving a spinner to imply it.
            //
            // Any server-side tool counts, not just the one named `web_search`:
            // search is the only tool this chat has, and the newer version of it
            // runs code of its own to filter results before they reach the
            // model. That work is part of the wait the reader is sitting through.
            if (
              event.type === "content_block_start" &&
              event.content_block.type === "server_tool_use"
            ) {
              if (!searching) {
                controller.enqueue(encoder.encode(statusFrame(SEARCHING_STATUS)));
                searching = true;
              }
              continue;
            }
            if (
              event.type === "content_block_delta" &&
              event.delta.type === "text_delta"
            ) {
              // The answer is arriving, which is a better answer to "what is it
              // doing" than any status line.
              if (searching) {
                controller.enqueue(encoder.encode(statusFrame(null)));
                searching = false;
              }
              const chunk = event.delta.text;
              full += chunk;
              controller.enqueue(encoder.encode(chunk));
            }
          }

          const finished = await claudeStream.finalMessage();
          if (searching) {
            controller.enqueue(encoder.encode(statusFrame(null)));
          }

          // Which pages the answer actually rests on, rather than everything the
          // search happened to return. Citations are attached to the sentences
          // that used them, so this is the honest list.
          for (const block of finished.content) {
            if (block.type !== "text" || !block.citations) continue;
            for (const citation of block.citations) {
              if (citation.type !== "web_search_result_location") continue;
              if (sources.has(citation.url)) continue;
              sources.set(citation.url, sourceLink(citation.title, citation.url));
            }
          }

          if (finished.stop_reason !== "pause_turn" || round >= MAX_RESUMES) break;
          // Resuming is re-sending with the paused turn appended; the server
          // picks up from the trailing server-tool block on its own.
          conversation.push({
            role: "assistant",
            content: finished.content as Anthropic.ContentBlockParam[],
          });
        }

        // Appended by the app rather than written by the model, so a searched
        // answer always says where it went and an unsearched one never grows a
        // heading it doesn't need. Streamed and persisted identically, so a
        // reload shows what the reader just watched arrive.
        if (sources.size > 0) {
          const line = `\n\nSources: ${[...sources.values()].join(" · ")}`;
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
