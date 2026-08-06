import { NextRequest } from "next/server";
import { anthropic } from "@/lib/journal/anthropic";
import { resolveReadingScope } from "@/lib/reading/scope";
import { getChapterText } from "@/lib/reading/extract-text";
import { chapterSummaryQuestion } from "@/lib/reading/chapter-summary";
import {
  buildChapterSummarySystem,
  CHAPTER_SUMMARY_MAX_TOKENS,
  CHAPTER_SUMMARY_MODEL,
} from "@/lib/reading/chat-prompt";

/**
 * The recap behind a chapter title.
 *
 * Its own route rather than a branch of /reader/api/chat, because almost nothing
 * is shared: the context is one chapter instead of the whole book, the model is
 * fixed rather than chosen, and there is no spoiler boundary to resolve and no
 * promotion to decide. What the two DO share — the
 * annotation row, the transcript table, the streaming contract the panel reads —
 * they share exactly, which is why a follow-up question typed under a summary
 * goes to the chat route and simply works.
 *
 * Generate and regenerate are the same request. A summary owns its thread: the
 * recap and whatever was asked about it are one artifact, so making a new recap
 * replaces both rather than appending a second one under stale follow-ups.
 *
 * Member mode returns a service-role client that bypasses RLS, so every query
 * below filters by this userId explicitly.
 */

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    annotationId?: string;
    memberEmail?: string | null;
  };
  if (!body.annotationId) {
    return new Response("annotationId required", { status: 400 });
  }

  const { client: db, userId } = await resolveReadingScope(body.memberEmail);

  const { data: row } = await db
    .from("reading_annotations")
    .select("id, book_id, chapter_anchor_id")
    .eq("id", body.annotationId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!row) return new Response("summary not found", { status: 404 });

  const anchorId = row.chapter_anchor_id as string | null;
  // Not a summary. Worth refusing rather than summarizing "the chapter this
  // happens to sit in": an ordinary chat's transcript would be wiped below.
  if (!anchorId) return new Response("not a chapter summary", { status: 400 });

  const bookId = row.book_id as string;
  const { data: book } = await db
    .from("reading_books")
    .select("title, author")
    .eq("id", bookId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!book) return new Response("book not found", { status: 404 });

  const chapter = await getChapterText(db, userId, bookId, anchorId);
  if (!chapter) return new Response("chapter text unavailable", { status: 409 });

  const { error: clearErr } = await db
    .from("reading_annotation_messages")
    .delete()
    .eq("annotation_id", row.id)
    .eq("user_id", userId);
  if (clearErr) return new Response(clearErr.message, { status: 500 });

  // Written as the reader's own turn, and written FIRST — same contract as the
  // chat route. The summary is committed the moment it is asked for, so a reply
  // that fails leaves a thread you can regenerate rather than an empty row the
  // discard sweep would throw away. The client renders its own copy of this line
  // optimistically, which is why the wording lives in a shared module.
  const question = chapterSummaryQuestion(chapter.title);
  const { error: insertErr } = await db
    .from("reading_annotation_messages")
    .insert({
      annotation_id: row.id,
      user_id: userId,
      role: "user",
      content: question,
    });
  if (insertErr) return new Response(insertErr.message, { status: 500 });

  const system = buildChapterSummarySystem({
    bookTitle: book.title as string,
    bookAuthor: (book.author as string | null) ?? null,
    chapterTitle: chapter.title,
    chapterText: chapter.text,
    truncated: chapter.truncated,
  });

  const client = anthropic();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      let full = "";
      try {
        const claudeStream = client.messages.stream({
          model: CHAPTER_SUMMARY_MODEL,
          max_tokens: CHAPTER_SUMMARY_MAX_TOKENS,
          system,
          messages: [{ role: "user", content: question }],
          // Sonnet 5 runs adaptive thinking when `thinking` is omitted, which
          // costs tokens and delays the first visible character.
          thinking: { type: "disabled" as const },
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
          await db.from("reading_annotation_messages").insert({
            annotation_id: row.id,
            user_id: userId,
            role: "assistant",
            content: trimmed,
            model: CHAPTER_SUMMARY_MODEL,
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
      "X-Reader-Chat-Model": CHAPTER_SUMMARY_MODEL,
    },
  });
}
