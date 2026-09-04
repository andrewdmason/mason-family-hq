import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getTextForRange } from "@/lib/reading/extract-text";
import { getBookPreface, getReaderMarks } from "@/lib/reading/book-document-context";
import { gatherReaderProfile } from "@/lib/reading/reader-profile";
import { todayLocal } from "@/lib/journal/today";
import { resolveReaderPosition } from "@/lib/reading/reader-position";
import {
  buildReaderChatSections,
  buildReaderChatSystem,
  type PromptSection,
  READER_CHAT_MAX_CONTEXT_CHARS,
  READER_CHAT_MAX_MARK_CHARS,
  type ReaderChatDepth,
} from "@/lib/reading/chat-prompt";
import {
  isReaderChatTemplate,
  type ReaderChatTemplate,
} from "@/lib/reading/annotation-types";
import { agentFor, type ReadingAgent } from "@/lib/reading/reading-agent";
import type { AnnotationAnchor } from "@/lib/reading/annotation-anchors";
import { hashOf } from "@/lib/reading/book-copy";

/**
 * Everything that decides what a reader-chat turn is sent, gathered in ONE
 * place.
 *
 * This used to live inline in the chat route, which was fine while the route was
 * the only thing that needed it. It stopped being fine when the panel grew a
 * "see the prompt" inspector: a debugging view assembled by a second copy of
 * this logic is worse than none at all, because it agrees with the real thing
 * right up until the moment you actually need it to disagree. One builder, two
 * callers, no drift.
 *
 * Deliberately does NOT own the transcript, the message insert, the token count
 * or the promotion decision. Those belong to the turn being sent, not to the
 * context it is sent with, and the inspector has no business doing any of them.
 */

/** No page boundary — take the book to its end. */
const NO_PAGE_LIMIT = 1_000_000_000;

/** The annotation columns a chat turn is built from. */
export const CHAT_CONTEXT_COLUMNS =
  "id, book_id, thread_id, spoiler_free, context_through_page, anchor_char_offset, " +
  "anchor_page, quoted_text, plain_quoted_text, anchor, model_preference, template";

export type ChatContextRow = {
  id: string;
  book_id: string;
  /**
   * The conversation. Everything else on this row is per-copy — the boundary,
   * the position, the page — which is exactly why the transcript is addressed
   * separately: a turn is built from the SPEAKER's mark and appended to the
   * conversation both of them can see.
   */
  thread_id: string;
  spoiler_free: boolean;
  context_through_page: number | null;
  anchor_char_offset: number;
  anchor_page: number | null;
  quoted_text: string | null;
  /** The plain sentence the reader selected, for a mark made in Plain English. */
  plain_quoted_text?: string | null;
  anchor?: AnnotationAnchor | null;
  model_preference: string;
  template: string | null;
};

/**
 * The plain-English rendering of the paragraphs a mark sits on, when the reader
 * was reading in that face — so the model can see what they saw while answering
 * against the author's words. Null for an original-face mark, an article, or a
 * book with no translation of those paragraphs.
 */
async function plainFaceFor(
  db: SupabaseClient,
  userId: string,
  chat: ChatContextRow,
  isArticle: boolean
): Promise<string | null> {
  if (isArticle || !chat.anchor || chat.anchor.face !== "plain") return null;
  const hash = await hashOf(db, chat.book_id, userId);
  if (!hash) return null;
  const from = chat.anchor.blockIndex;
  const to = (chat.anchor.endBlockIndex ?? chat.anchor.blockIndex) + 1;
  const { data } = await db
    .from("reading_plain_blocks")
    .select("block_index, kept, text")
    .eq("content_hash", hash)
    .gte("block_index", from)
    .lt("block_index", to)
    .order("block_index", { ascending: true });
  const rows = (data ?? []) as { block_index: number; kept: boolean; text: string | null }[];
  const paragraphs = rows.filter((r) => !r.kept && r.text).map((r) => r.text as string);
  return paragraphs.length > 0 ? paragraphs.join("\n\n") : null;
}

export type ChatContextBook = {
  title: string;
  author: string | null;
  type: string | null;
  fiction: boolean | null;
};

export type ReaderChatContext = {
  system: Anthropic.TextBlockParam[];
  /**
   * The same prompt split into its four layers, for the panel's inspector.
   *
   * Built from the same input in the same pass rather than reconstructed, for
   * the reason this whole module exists: what the inspector shows must not be
   * able to disagree with what was sent.
   */
  sections: PromptSection[];
  /** What the reader picked, which governs the register. */
  depth: ReaderChatDepth;
  template: ReaderChatTemplate | null;
  /** Which persona this book gets — the thing hardest to check by reading. */
  agent: ReadingAgent;
  isArticle: boolean;
  /** Whether this chat is spoiler-scoped, for anything that wants to say so. */
  scoped: boolean;
};

/**
 * Assemble the system blocks for one chat.
 *
 * Returns null when the book's text isn't available, which the chat route
 * reports as a 409 — the same condition, said once.
 */
export async function buildReaderChatContext(input: {
  db: SupabaseClient;
  userId: string;
  /** The signed-in caller, for the reader profile. */
  email: string | null;
  chat: ChatContextRow;
  book: ChatContextBook;
  /** Whether the transcript carries notes the reader wrote to themselves. */
  hasReaderNotes: boolean;
}): Promise<ReaderChatContext | null> {
  const { db, userId, email, chat, book } = input;

  // The spoiler boundary is frozen by the first question. `spoiler_free` with a
  // null page means the book has no page map at all, so fall back to the
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
  if (!slice) return null;

  // An unscoped chat holds the whole book, so the model has to be told where the
  // reader actually is — left to infer it from where the text runs out, it reads
  // the last page as their position and starts explaining the ending. A scoped
  // chat needs none of this: the text stops at the boundary. An article has no
  // "further on" to protect, and its char_count is HTML length, so any
  // percentage derived from it would be nonsense.
  const isArticle = book.type === "article";
  const readerPosition =
    scoped || isArticle
      ? null
      : await resolveReaderPosition(db, userId, chat.book_id, chat.anchor_char_offset);

  const template = isReaderChatTemplate(chat.template) ? chat.template : null;

  // The one place the reader's stated intent travels to. An article can't have a
  // preface, so this is a book-only lookup and null for most books.
  //
  // The profile is who they are, so a name they drop mid-conversation resolves
  // to somebody. Scoped to the book's OWNER, not the signed-in caller — in
  // member mode those are different people, and the wrong one here is a parent's
  // life turning up inside a kid's chat.
  //
  // EARLIER CHECK-INS, and only those. Not the reader's highlights, not their
  // notes, not the questions they asked in the margin.
  //
  // Their marks used to come too, and they were the first thing this template
  // got wrong in every direction: a companion that theorised about the reader's
  // highlighting, then one that treated the absence of it as a diagnosis, then
  // one that mistook an old briefing for a conversation. Ordinary marks are
  // ordinary — a passage caught someone and they underlined it — and putting
  // them in front of a model that has been asked to say something interesting
  // is an invitation to find meaning that isn't there.
  //
  // What survives is the one thing that is genuinely this conversation: what
  // was said the last time they checked in.
  //
  // This chat is excluded from its own history — without that, turn two reads
  // the several hundred words it just wrote as though a previous session had
  // said them.
  //
  // All of these sit between the reader pressing send and the first token, so
  // they go together rather than one after another.
  const [readerIntent, readerProfile, marksResult, plainFace] = await Promise.all([
    isArticle ? null : getBookPreface(db, userId, chat.book_id),
    todayLocal().then((today) => gatherReaderProfile(db, userId, email, today)),
    template === "check_in" && !isArticle
      ? getReaderMarks(db, userId, chat.book_id, {
          excludeAnnotationId: chat.id,
          maxChars: READER_CHAT_MAX_MARK_CHARS,
          onlyTemplate: "check_in",
        })
      : null,
    plainFaceFor(db, userId, chat, isArticle),
  ]);

  // Which conversation they asked for. Read here and used for BOTH the register
  // and the model — the two used to be derived from the resolved model instead,
  // which is how a long book silently turned a quick question into a deep one.
  const depth: ReaderChatDepth =
    chat.model_preference === "deep" ? "deep" : "fast";

  const promptInput = {
    bookTitle: book.title,
    bookAuthor: book.author,
    bookText: slice.text,
    hasPageMarkers: slice.hasPageMarkers,
    hasChapterMarkers: slice.hasChapterMarkers,
    chapters: slice.chapters,
    // An article is never "a story" or "an argument" in the sense the branch
    // means, so it gets neither — same as a book nothing has classified yet.
    fiction: isArticle ? null : book.fiction,
    spoilerFree: scoped,
    contextThroughPage: scoped ? chat.context_through_page : null,
    readerPosition,
    quotedText: chat.quoted_text,
    plainFace,
    plainQuotedText: chat.plain_quoted_text ?? null,
    hasReaderNotes: input.hasReaderNotes,
    readerIntent,
    readerProfile,
    depth,
    template,
    priorCheckIns: marksResult?.marks ?? null,
    priorCheckInsTruncated: marksResult?.truncated ?? false,
  };

  return {
    system: buildReaderChatSystem(promptInput),
    sections: buildReaderChatSections(promptInput),
    depth,
    template,
    agent: agentFor(promptInput.fiction),
    isArticle,
    scoped,
  };
}
