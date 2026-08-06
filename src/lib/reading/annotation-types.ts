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
  note: string | null;
  messageCount: number;
}): AnnotationKind {
  if (a.messageCount > 0) return "chat";
  return a.note ? "note" : "highlight";
}

export type AnnotationSummary = {
  id: string;
  anchor: AnnotationAnchor;
  anchorCharOffset: number;
  anchorPage: number | null;
  /**
   * Frozen at creation. When true the chat only ever sees the book through
   * `contextThroughPage` (or `anchorCharOffset` if the book has no page map).
   * Always false for articles — see createAnnotation.
   */
  spoilerFree: boolean;
  contextThroughPage: number | null;
  quotedText: string | null;
  /** The reader's own words. Null on a plain highlight or a chat-only annotation. */
  note: string | null;
  color: string;
  modelPreference: ReaderChatModelPreference;
  forkedFromAnnotationId: string | null;
  messageCount: number;
  lastMessageAt: string | null;
  /**
   * The reader's opening question, capped to a line. What the mark in the page
   * carries (see inline-chat-blocks.ts), so the summary list can render the
   * book's marginalia without fetching a transcript per annotation. Null on
   * anything that isn't a conversation yet.
   */
  firstQuestion: string | null;
  createdAt: string;
};

export type ReaderChatMessage = {
  id: string;
  /** "notice" is app-authored UI text (e.g. a model promotion); never sent to the model. */
  role: "user" | "assistant" | "notice";
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
  /** The BOOK's current switch — governs new chats only. */
  spoilerFree: boolean;
  pageMarks: AnnotationPageMark[];
  /** False when page numbers are synthetic and shouldn't be shown to the reader. */
  hasRealPages: boolean;
};
