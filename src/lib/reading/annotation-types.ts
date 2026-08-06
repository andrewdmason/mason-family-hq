import type { AnnotationAnchor } from "@/lib/reading/annotation-anchors";

/** "fast" = claude-haiku-4-5, "deep" = claude-sonnet-5. */
export type ReaderChatModelPreference = "fast" | "deep";

/**
 * What an annotation currently IS, derived from its contents rather than stored.
 *
 * The three states are one row at different stages of its life, which is the
 * whole point of the model: highlight a passage now, write on it tonight, ask
 * about it next week — all without ever producing a second thing in the margin
 * painting over the first.
 *
 * A chat wins over a note when an annotation has both. The text can only carry
 * one treatment, and the conversation is the richer content.
 */
export type AnnotationKind = "highlight" | "note" | "chat";

export function annotationKind(a: {
  noteCount: number;
  messageCount: number;
}): AnnotationKind {
  if (a.messageCount > 0) return "chat";
  return a.noteCount > 0 ? "note" : "highlight";
}

export type AnnotationSummary = {
  id: string;
  anchor: AnnotationAnchor;
  anchorCharOffset: number;
  anchorPage: number | null;
  /**
   * When true the chat only ever sees the book through `contextThroughPage` (or
   * `anchorCharOffset` if the book has no page map). Seeded from the book and
   * changeable until the chat is asked something, then frozen for its life —
   * moving it after that would leave the answers above it scoped to a rule that
   * no longer holds. Always false for articles — see createAnnotation.
   */
  spoilerFree: boolean;
  contextThroughPage: number | null;
  quotedText: string | null;
  /**
   * The heading this annotation recaps ("sec-42"), and null on every other kind
   * of annotation. Frozen at creation: it is what makes tapping the same chapter
   * title reopen its summary rather than start a second one, and it is why a
   * summary is a column on this row rather than a table of its own.
   */
  chapterAnchorId: string | null;
  /**
   * The most recent thing the reader wrote here, for the list's preview line.
   * Null until they write one. The notes themselves live in the thread — see
   * ReaderChatMessage — so this is a summary, not the content.
   */
  latestNote: string | null;
  /** How many notes are on this annotation; 0 makes it a highlight or a chat. */
  noteCount: number;
  color: string;
  /** Chosen with the first question and frozen by it, like `spoilerFree`. */
  modelPreference: ReaderChatModelPreference;
  /** Questions and answers only — notes are counted separately, in `noteCount`. */
  messageCount: number;
  lastMessageAt: string | null;
  /**
   * The reader's opening line, capped for display — their first question, or
   * their first note if they never asked one. What the mark in the page carries
   * (see inline-chat-blocks.ts), so the summary list can render the book's
   * marginalia without fetching a transcript per annotation. Null on a passage
   * that is still only highlighted.
   */
  firstQuestion: string | null;
  createdAt: string;
};

export type ReaderChatMessage = {
  id: string;
  /**
   * "notice" is app-authored UI text (e.g. a model promotion); never sent to
   * the model. "note" is the reader's own writing — it gets no reply, but it IS
   * sent to the model, because a thread where your own words are invisible to
   * the thing you're talking to makes every follow-up question mean something
   * different to you than it does to it.
   */
  role: "user" | "assistant" | "notice" | "note";
  content: string;
  model: string | null;
  createdAt: string;
};

export type AnnotationDetail = AnnotationSummary & {
  messages: ReaderChatMessage[];
};

/**
 * page -> first character, so a "[p.N]" citation can be scrolled to even when
 * the book has no `page-N` element in the DOM (which is the common case).
 */
export type AnnotationPageMark = {
  pageNumber: number;
  charStart: number;
  anchorId: string;
};

export type ReaderAnnotationData = {
  chats: AnnotationSummary[];
  /** What a NEW chat in this book starts as. Each chat then carries its own. */
  spoilerFree: boolean;
  pageMarks: AnnotationPageMark[];
  /** False when page numbers are synthetic and shouldn't be shown to the reader. */
  hasRealPages: boolean;
};
