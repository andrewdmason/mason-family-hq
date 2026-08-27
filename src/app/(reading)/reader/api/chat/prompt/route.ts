import { NextRequest } from "next/server";
import { resolveReadingScope } from "@/lib/reading/scope";
import {
  buildReaderChatContext,
  CHAT_CONTEXT_COLUMNS,
  type ChatContextRow,
} from "@/lib/reading/chat-context";
import {
  READER_CHAT_DEEP_MODEL,
  READER_CHAT_FAST_MODEL,
} from "@/lib/reading/chat-prompt";
import { READER_CHAT_TEMPLATE_OPENERS } from "@/lib/reading/annotation-types";
import { AGENT_LABELS } from "@/lib/reading/reading-agent";

export const runtime = "nodejs";

/**
 * What this chat is actually sent, for reading.
 *
 * Built by the SAME builder the chat route uses (chat-context.ts), which is the
 * entire point — a prompt inspector assembled from a second copy of the logic
 * agrees with reality right up until the moment you need it to disagree, which
 * is the only moment anyone opens it.
 *
 * What it deliberately does not reproduce is the promotion decision, which
 * depends on counting the payload against the Fast window and is made per turn
 * at send time. The model named here is the one the reader's pick implies; a
 * long book may still be answered by a bigger one.
 */

/**
 * How many contents lines to show before summarizing the rest.
 *
 * The index of a five-hundred-page novel is itself a wall of text, and the point
 * of this view is to read the INSTRUCTIONS. Enough to confirm the index is
 * there and well-formed, then a count.
 */
const CONTENTS_PREVIEW_LINES = 8;

/**
 * Replace the novel with a description of itself.
 *
 * Without this the response is the entire book — several megabytes down the wire
 * so that a person can scroll past it looking for the paragraph that made the
 * model behave oddly. The size is reported instead, which is the only thing
 * about the book text anyone debugging a prompt actually wants to know.
 */
function elideBookText(text: string): { text: string; elidedChars: number } {
  if (!text.startsWith("<book ")) return { text, elidedChars: 0 };

  const openEnd = text.indexOf(">") + 1;
  const openTag = text.slice(0, openEnd);
  let rest = text.slice(openEnd);
  const closeTag = "</book>";
  if (rest.endsWith(closeTag)) rest = rest.slice(0, -closeTag.length);

  let contents = "";
  const contentsMatch = rest.match(/^\s*<contents>\n([\s\S]*?)\n<\/contents>\n/);
  if (contentsMatch) {
    const lines = contentsMatch[1].split("\n");
    const shown = lines.slice(0, CONTENTS_PREVIEW_LINES).join("\n");
    const extra = lines.length - CONTENTS_PREVIEW_LINES;
    contents =
      `<contents>\n${shown}` +
      (extra > 0 ? `\n… ${extra} more heading${extra === 1 ? "" : "s"}` : "") +
      `\n</contents>\n`;
    rest = rest.slice(contentsMatch[0].length);
  }

  const chars = rest.trim().length;
  return {
    text:
      `${openTag}\n${contents}` +
      `[ ${chars.toLocaleString("en-US")} characters of book text — elided here, ` +
      `sent in full ]\n${closeTag}`,
    elidedChars: chars,
  };
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    chatId?: string;
    memberEmail?: string | null;
  };
  const { chatId } = body;
  if (!chatId) return new Response("chatId required", { status: 400 });

  const { client: db, userId, email } = await resolveReadingScope(body.memberEmail);

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

  // Whether the transcript carries reader notes changes one block, so it is read
  // the same way the chat route reads it rather than assumed.
  const { data: noteRows } = await db
    .from("reading_annotation_messages")
    .select("role")
    .eq("thread_id", chat.thread_id)
    .eq("role", "note")
    .limit(1);

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
    hasReaderNotes: (noteRows ?? []).length > 0,
  });
  if (!context) return new Response("book text unavailable", { status: 409 });

  // By LAYER rather than by API block, which is the useful cut for a person: the
  // three instruction layers share one block on the wire, and reading them as
  // one wall is exactly what made this prompt hard to reason about in the first
  // place.
  const sections = context.sections.map((section) => {
    const { text, elidedChars } = elideBookText(section.text);
    return {
      layer: section.layer,
      title: section.title,
      text,
      // The whole novel bills at ~0.1x on every turn after the first only if the
      // prefix is byte-stable, so which pieces carry a breakpoint is exactly the
      // kind of thing this view exists to make checkable.
      cached: section.cached === true,
      chars: section.text.length,
      elidedChars,
    };
  });

  return Response.json({
    depth: context.depth,
    template: context.template,
    agent: AGENT_LABELS[context.agent],
    scoped: context.scoped,
    model:
      context.depth === "deep" ? READER_CHAT_DEEP_MODEL : READER_CHAT_FAST_MODEL,
    // Only templates have one; an ordinary chat's first message is whatever the
    // reader typed, which is already visible in the thread.
    openingMessage: context.template
      ? READER_CHAT_TEMPLATE_OPENERS[context.template]
      : null,
    sections,
  });
}
