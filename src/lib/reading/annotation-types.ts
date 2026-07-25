import type { AnnotationAnchor } from "@/lib/reading/annotation-anchors";

/** "fast" = claude-haiku-4-5, "deep" = claude-sonnet-5. */
export type ReaderChatModelPreference = "fast" | "deep";

export type AnnotationSummary = {
  id: string;
  anchor: AnnotationAnchor;
  anchorCharOffset: number;
  anchorPage: number | null;
  /**
   * Frozen at creation. When true the chat only ever sees the book through
   * `contextThroughPage` (or `anchorCharOffset` if the book has no page map).
   */
  spoilerFree: boolean;
  contextThroughPage: number | null;
  quotedText: string | null;
  modelPreference: ReaderChatModelPreference;
  forkedFromAnnotationId: string | null;
  messageCount: number;
  lastMessageAt: string | null;
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
