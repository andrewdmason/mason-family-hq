import { NextRequest } from "next/server";
import type Anthropic from "@anthropic-ai/sdk";
import { anthropic } from "@/lib/journal/anthropic";
import { resolveReadingScope } from "@/lib/reading/scope";
import { todayLocal } from "@/lib/journal/today";
import {
  afterwordDateline,
  gatherBookDocumentContext,
} from "@/lib/reading/book-document-context";
import { buildDocumentTurns, isBookScope } from "@/lib/reading/book-documents";
import {
  BOOK_DOCUMENT_CONVERSE_MAX_TOKENS,
  BOOK_DOCUMENT_EFFORT,
  BOOK_DOCUMENT_MODEL,
  BOOK_DOCUMENT_WRITE_MAX_TOKENS,
  bookDocumentCanSearch,
  buildBookDocumentSystem,
  readerWebSearchTools,
  type BookDocumentPhase,
} from "@/lib/reading/chat-prompt";
import { statusFrame } from "@/lib/reading/chat-stream";
import {
  collectWebSources,
  MAX_SEARCH_RESUMES,
  SEARCHING_STATUS,
  sourcesLine,
} from "@/lib/reading/web-sources";

/**
 * The reader's preface and afterword: the interview, and the document it
 * produces.
 *
 * One route for both phases, because they differ only in the last few
 * paragraphs of the system prompt and in what gets persisted at the end. They
 * share the book, the reader's marks, the transcript and the streaming
 * contract — and, crucially, the same cached prefix, so an interview's fifth
 * question doesn't re-read the novel.
 *
 * Its own route rather than a branch of /reader/api/chat because almost nothing
 * else matches: the context is the whole book plus everything the reader ever
 * did to it, the model is fixed rather than chosen, there is no spoiler boundary
 * to resolve and no promotion to decide.
 *
 * A document is written once. There is no regenerate: the page offers the bin
 * instead, and starting over means deleting the document and the interview that
 * made it and doing it again from nothing. Appending rather than replacing is
 * still what this does mechanically, which is why a prior document is sent back
 * to the model — a follow-up question is about the thing it wrote.
 *
 * Member mode returns a service-role client that bypasses RLS, so every query
 * below filters by this userId explicitly.
 */

export const runtime = "nodejs";

type AnnotationRow = {
  id: string;
  book_id: string;
  book_scope: string | null;
};

export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    annotationId?: string;
    phase?: BookDocumentPhase;
    /** The reader's turn, when they typed one. Absent for the opening question. */
    userMessage?: string | null;
    memberEmail?: string | null;
  };
  if (!body.annotationId) {
    return new Response("annotationId required", { status: 400 });
  }
  const phase: BookDocumentPhase =
    body.phase === "document" ? "document" : "converse";

  const { client: db, userId, email } = await resolveReadingScope(body.memberEmail);

  const { data: raw } = await db
    .from("reading_annotations")
    .select("id, book_id, book_scope")
    .eq("id", body.annotationId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!raw) return new Response("not found", { status: 404 });
  const row = raw as unknown as AnnotationRow;

  // Not one of the reader's own documents. Worth refusing rather than writing an
  // afterword into somebody's highlight of one paragraph.
  if (!isBookScope(row.book_scope)) {
    return new Response("not a book document", { status: 400 });
  }
  const scope = row.book_scope;

  // `email` rather than the session's: in member mode this document belongs to
  // the member, and the journal context behind it has to be theirs too.
  const ctx = await gatherBookDocumentContext(db, userId, row.book_id, scope, {
    email,
    today: await todayLocal(),
  });
  if (!ctx) return new Response("book text unavailable", { status: 409 });

  // The thread so far. 'notice' rows are app-authored UI text and never go to
  // the model. A written 'document' does — it is the thing a follow-up question
  // is about.
  const { data: priorMsgs, error: msgsErr } = await db
    .from("reading_annotation_messages")
    .select("role, content")
    .eq("annotation_id", row.id)
    .eq("user_id", userId)
    .in("role", ["user", "assistant", "note", "document"])
    .order("created_at", { ascending: true });
  if (msgsErr) return new Response(msgsErr.message, { status: 500 });

  const rendered = ((priorMsgs ?? []) as { role: string; content: string }[]).map(
    (m) => ({
      role: (m.role === "assistant" || m.role === "document"
        ? "assistant"
        : "user") as "assistant" | "user",
      content: m.role === "note" ? `[Reader's note] ${m.content}` : m.content,
    })
  );

  // What the reader is taken to have said this turn. Typing sends their words;
  // pressing the write button sends nothing, and the instruction to write lives
  // in the system prompt instead — so the transcript stays a record of what was
  // said rather than of which buttons were pressed.
  const userMessage = (body.userMessage ?? "").trim();
  if (userMessage) rendered.push({ role: "user", content: userMessage });

  // Folded, and topped and tailed so the API will take it — see
  // buildDocumentTurns, which owns both rules and is verified separately.
  const turns = buildDocumentTurns(
    rendered,
    phase,
    scope,
    ctx.bookTitle
  ) as Anthropic.MessageParam[];

  // Persist the reader's turn before streaming, like every other route here, so
  // a reply that dies leaves a thread they can carry on from rather than words
  // that were never said.
  if (userMessage) {
    const { error } = await db.from("reading_annotation_messages").insert({
      annotation_id: row.id,
      user_id: userId,
      role: "user",
      content: userMessage,
    });
    if (error) return new Response(error.message, { status: 500 });
  }

  const hasReaderNotes = ((priorMsgs ?? []) as { role: string }[]).some(
    (m) => m.role === "note"
  );
  const system = buildBookDocumentSystem(ctx, phase, { hasReaderNotes });
  const client = anthropic();

  // Written here rather than by the model: every value in it is something we
  // know exactly, and a model asked to copy four numbers into prose will
  // eventually get one wrong — on a document whose whole premise is that it can
  // be trusted years later.
  const dateline =
    phase === "document" && scope === "afterword" ? afterwordDateline(ctx) : "";

  // The afterword interview can go and look things up; nothing else here can.
  // Armed from the same predicate that writes the rules about it, so the tool
  // and the instructions for it can never disagree.
  const tools = bookDocumentCanSearch(scope, phase)
    ? readerWebSearchTools(BOOK_DOCUMENT_MODEL)
    : undefined;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      let full = "";
      const sources = new Map<string, string>();
      try {
        // The dateline goes out ahead of the first token so the reader watches
        // the document assemble under it, rather than having it appear above
        // finished prose a moment later.
        if (dateline) {
          full = `${dateline}\n\n`;
          controller.enqueue(encoder.encode(full));
        }

        // Grows only when a turn comes back paused, which only a searching turn
        // can do; the writing phase runs this body once.
        const conversation = [...turns];

        for (let round = 0; ; round++) {
          const claudeStream = client.messages.stream({
            model: BOOK_DOCUMENT_MODEL,
            max_tokens:
              phase === "document"
                ? BOOK_DOCUMENT_WRITE_MAX_TOKENS
                : BOOK_DOCUMENT_CONVERSE_MAX_TOKENS,
            system,
            messages: conversation,
            ...(tools ? { tools } : {}),
            // Adaptive thinking is on by default on this model and stays on:
            // disabling it can leak reasoning tags into the visible text, and
            // effort is the cheaper lever for a turn that wants to feel quick.
            output_config: { effort: BOOK_DOCUMENT_EFFORT[phase] },
          });

          let searching = false;
          for await (const event of claudeStream) {
            // Any server-side tool means a search is running — it is the only
            // one armed here. Nothing streams until it returns, so say so.
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
          collectWebSources(finished.content, sources);

          if (finished.stop_reason !== "pause_turn" || round >= MAX_SEARCH_RESUMES) break;
          // Resuming is re-sending with the paused turn appended; the server
          // picks up from the trailing server-tool block on its own.
          conversation.push({
            role: "assistant",
            content: finished.content as Anthropic.ContentBlockParam[],
          });
        }

        // Only ever on an interview turn — the document phase has no tool, so
        // an afterword never ends in a list of links.
        const line = sourcesLine(sources);
        if (line) {
          full += line;
          controller.enqueue(encoder.encode(line));
        }

        const trimmed = full.trim();
        if (trimmed.length > 0) {
          await db.from("reading_annotation_messages").insert({
            annotation_id: row.id,
            user_id: userId,
            role: phase === "document" ? "document" : "assistant",
            content: trimmed,
            model: BOOK_DOCUMENT_MODEL,
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
      "X-Reader-Chat-Model": BOOK_DOCUMENT_MODEL,
    },
  });
}
