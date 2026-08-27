import { NextRequest } from "next/server";
import type Anthropic from "@anthropic-ai/sdk";
import { anthropic } from "@/lib/journal/anthropic";
import { resolveReadingScope } from "@/lib/reading/scope";
import { recordMentions } from "@/lib/reading/thread-mentions";
import {
  buildReaderChatContext,
  CHAT_CONTEXT_COLUMNS,
  type ChatContextRow,
} from "@/lib/reading/chat-context";
import {
  FALLBACK_CHARS_PER_TOKEN,
  FAST_MODEL_CONTEXT_WINDOW,
  FAST_MODEL_HEADROOM,
  READER_CHAT_DEEP_EFFORT,
  READER_CHAT_DEEP_MAX_TOKENS,
  READER_CHAT_DEEP_MODEL,
  READER_CHAT_FAST_MODEL,
  READER_CHAT_MAX_TOKENS,
  READER_CHAT_PROMOTION_MODEL,
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

// Deliberately doesn't say "Deep": a promoted chat is still the Fast
// conversation, answered by a bigger model only because the book doesn't fit.
// Calling it Deep would promise the argument this answer isn't going to make.
const PROMOTION_NOTE =
  "Answered with a larger model — this book is too long for the Fast model's context window.";

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
  const { client: db, userId, email, isMemberMode } =
    await resolveReadingScope(body.memberEmail);

  const { data: chatRaw } = await db
    .from("reading_annotations")
    .select(CHAT_CONTEXT_COLUMNS)
    .eq("id", chatId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!chatRaw) return new Response("chat not found", { status: 404 });
  const chat = chatRaw as unknown as ChatContextRow;

  const { data: book } = await db
    .from("reading_books")
    .select("title, author, type, fiction")
    .eq("id", chat.book_id)
    .eq("user_id", userId)
    .maybeSingle();
  if (!book) return new Response("book not found", { status: 404 });

  // Thread so far. 'notice' rows are app-authored UI text and never go to the
  // model; 'note' rows are the reader's own writing and do — see the marker
  // below and the explanation of it in chat-prompt.ts.
  // Read by thread and not by author: the transcript is the conversation's, and
  // a filter on who wrote each line would hand the model half of one.
  const { data: priorMsgs, error: msgsErr } = await db
    .from("reading_annotation_messages")
    .select("role, content")
    .eq("thread_id", chat.thread_id)
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

  const mentions = await recordMentions(db, {
    threadId: chat.thread_id,
    text: userMessage.trim(),
    authorId: userId,
    isMemberMode,
  });

  const { error: insertErr } = await db.from("reading_annotation_messages").insert({
    thread_id: chat.thread_id,
    user_id: userId,
    role: "user",
    content: userMessage.trim(),
    mentions,
  });
  if (insertErr) return new Response(insertErr.message, { status: 500 });
  await db
    .from("reading_annotation_threads")
    .update({ last_message_at: new Date().toISOString() })
    .eq("id", chat.thread_id);

  // Everything that decides what this turn is SENT — the book slice, the reader's
  // position, their preface, their profile, their marks, the register — lives in
  // one builder shared with the prompt inspector. See chat-context.ts for why
  // that matters: a debugging view assembled by a second copy of this logic
  // agrees with the real thing right until you need it to disagree.
  const context = await buildReaderChatContext({
    db,
    userId,
    email,
    chat,
    book: {
      title: book.title as string,
      author: (book.author as string | null) ?? null,
      type: (book.type as string | null) ?? null,
      fiction: (book.fiction as boolean | null) ?? null,
    },
    hasReaderNotes,
  });
  if (!context) return new Response("book text unavailable", { status: 409 });
  const { system, depth } = context;

  const client = anthropic();

  // Deterministic model choice: count the payload before sending, and promote
  // if it won't fit Fast. Never a retry-on-error — an oversized request would
  // fail mid-stream after the user already saw it start.
  //
  // Promotion goes to its own model rather than to Deep's. They used to be the
  // same constant, which quietly meant a long book upgraded the CONVERSATION:
  // a reader who picked Fast and asked a one-line question got Deep's model,
  // Deep's token budget and Deep's thinking because their novel was long. What
  // they picked is `depth` above and governs how the answer is written; this
  // governs only what can hold the book.
  let model = depth === "deep" ? READER_CHAT_DEEP_MODEL : READER_CHAT_FAST_MODEL;
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
      model = READER_CHAT_PROMOTION_MODEL;
      promoted = true;
    }
  }

  if (promoted) {
    // Once per conversation, not once per reader in it — the notice explains
    // something about the thread, so a second participant asking a question
    // shouldn't make it appear again underneath the first one.
    const { data: existingNote } = await db
      .from("reading_annotation_messages")
      .select("id")
      .eq("thread_id", chat.thread_id)
      .eq("role", "notice")
      .limit(1);
    if (!existingNote || existingNote.length === 0) {
      await db.from("reading_annotation_messages").insert({
        thread_id: chat.thread_id,
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

        // What the READER picked, not what the book forced. A promoted Fast
        // chat runs on a bigger model because that is the only one that holds
        // the book — it does not get an essay's budget or thinking time.
        const deep = depth === "deep";

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
            thread_id: chat.thread_id,
            user_id: userId,
            role: "assistant",
            content: trimmed,
            model,
          });
          await db
            .from("reading_annotation_threads")
            .update({ last_message_at: new Date().toISOString() })
            .eq("id", chat.thread_id);
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
