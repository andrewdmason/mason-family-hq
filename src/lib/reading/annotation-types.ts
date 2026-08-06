import type { AnnotationAnchor } from "@/lib/reading/annotation-anchors";
import type { BookScope } from "@/lib/reading/book-documents";

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
   * Set on the two annotations that are about the WHOLE book rather than a
   * passage in it — the reader's preface and afterword. Null on everything else.
   *
   * These never appear in the margin, the gutter or the marks index: they have
   * no passage, and their anchor exists only because the columns are NOT NULL.
   * getAnnotationData filters them out of `chats` for exactly that reason, so a
   * consumer holding an AnnotationSummary can assume this is null — the two that
   * aren't arrive separately, in `documents`.
   */
  bookScope: BookScope | null;
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
   * different to you than it does to it. "document" is a finished preface or
   * afterword: a turn the assistant took, marked apart from the conversation
   * because it is the thing the conversation was for.
   */
  role: "user" | "assistant" | "notice" | "note" | "document";
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

/**
 * Enough about the reader's preface or afterword for the Contents to offer it:
 * whether it exists as a thread at all, whether anything has been written yet,
 * and when the latest version was.
 *
 * Deliberately not an AnnotationSummary. The Contents is the only thing that
 * ever renders these, it needs three facts, and shipping a summary would invite
 * them back into the margin machinery they are excluded from. See
 * getBookDocumentStates.
 */
export type BookDocumentState = {
  scope: BookScope;
  /** Null until the reader has opened it once. */
  annotationId: string | null;
  /** Whether a preface or afterword has actually been written into the thread. */
  written: boolean;
  /** When the most recent one was written. */
  writtenAt: string | null;
};

export type ReaderAnnotationData = {
  /**
   * Everything marked in the book. Never the reader's preface or afterword:
   * those have no passage to mark, and are read on their own page.
   */
  chats: AnnotationSummary[];
  /** What a NEW chat in this book starts as. Each chat then carries its own. */
  spoilerFree: boolean;
  pageMarks: AnnotationPageMark[];
  /** False when page numbers are synthetic and shouldn't be shown to the reader. */
  hasRealPages: boolean;
};
