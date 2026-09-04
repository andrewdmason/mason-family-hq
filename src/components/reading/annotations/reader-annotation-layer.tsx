"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createAnnotation,
  deleteAnnotation,
  discardAnnotationIfEmpty,
  getAnnotation,
  getAnnotationData,
  openBookDocument,
  setBookSpoilerFree,
  postAnnotationMessage,
  setAnnotationModelPreference,
  setAnnotationSpoilerFree,
  setAnnotationStarred,
  setAnnotationTemplate,
} from "@/app/(reading)/reader/annotation-actions";
import type { BookScope } from "@/lib/reading/book-documents";
import { blockIndexForCharOffset, type BookBlock } from "@/lib/reading/block-stream";
import { inOpenOverlay, isTypingTarget } from "@/lib/keyboard";
import { note, startTimer, time } from "@/lib/reading/perf";
import {
  INLINE_MARK_ATTR,
  markText,
  pageBlocks,
  type InlineChatMark,
} from "@/lib/reading/inline-chat-blocks";
import { CHAPTER_SUMMARY_MARK_TEXT } from "@/lib/reading/chapter-summary";
import {
  anchorForGap,
  anchorFromRange,
  blockElements,
  type AnchorSpace,
  type ResolvedAnchor,
} from "@/lib/reading/annotation-anchors";
import type {
  ReaderAnnotationData,
  AnnotationDetail,
  AnnotationSummary,
  ReaderChatModelPreference,
  ReaderChatTemplate,
} from "@/lib/reading/annotation-types";
import {
  summarizableChapters,
  type ChapterBound,
} from "@/lib/reading/reading-progress";
import { loadStarredOnly, saveStarredOnly } from "@/lib/reading/starred-filter";
import { CHAPTER_TAP_CLASS } from "../reader-prose";
import { AnnotationPanel } from "./annotation-panel";
import { AnnotationList } from "./annotation-list";
import { ReaderMarginControls } from "./annotations-button";
import { AnnotationThread } from "./annotation-thread";
import type { MentionTarget } from "@/lib/reading/mentions";
import { BookDocumentThread } from "./book-document-thread";
import { ChapterMenu } from "./chapter-menu";
import { GutterMarkers } from "./gutter-markers";
import { useGutterPlacement, type PagedGutterContext } from "./gutter-placement";
import { PanelDockToggle } from "./panel-dock-toggle";
import { SelectionToolbar, type SelectionIntent } from "./selection-toolbar";
import { CounterpartPanel, type CounterpartRequest } from "./counterpart-panel";
import type { FaceTextOf } from "@/lib/reading/face-map";
import type { PlainBlock } from "@/lib/reading/plain/types";
import { annotationAtPoint, useAnnotationHighlights } from "./use-annotation-highlights";
import { useContentVersion } from "./use-content-version";

/**
 * Owns reader chat: loads the anchored chats for a book, renders the two ways to
 * start one and the markers that reopen them, and hosts the panel.
 *
 * The two ways are deliberately different in kind. Selecting a passage asks
 * about that sentence and leaves a highlight; the control in the top margin asks
 * about where you are, anchors at the first paragraph break on screen, and — once
 * you have actually asked something — leaves a one-line mark in the page itself
 * (see inline-chat-blocks.ts). The second replaced a hover-between-paragraphs
 * affordance that could not exist on a phone or an e-reader, which is most of
 * where this book gets read.
 *
 * Everything positional is computed from the book HTML the reader already
 * fetched (see block-stream.ts), so anchors resolve without measuring text —
 * which is why pagination didn't disturb any of it. Only the placement of the
 * markers cares how the book is laid out.
 */
/** Stable identity, so an article doesn't re-run every blocks-keyed memo. */
const NO_BLOCKS: BookBlock[] = [];
const NO_CHAPTERS: ChapterBound[] = [];

/**
 * Where "the top of the screen" is once the header's space is allowed for —
 * the same measure the scrolling reader uses to decide where you are. Only
 * articles need it; everything else answers that question in characters.
 */
const READING_LINE = 72;

/**
 * An annotation the reader can see and type into before the server has heard
 * about it.
 *
 * The panel used to open only after `createAnnotation` came back, which meant
 * every "Ask" cost a database round trip before anything appeared. It now opens
 * on the click, against a stand-in row whose id is replaced by the real one when
 * the insert lands — usually while the reader is still typing their question.
 *
 * The window in between is small but has real states in it: the reader can send,
 * write a note, close, or delete, all before the row exists. Each is recorded
 * here and carried out by the create's own continuation, so nothing races the
 * insert. `onCreate` in particular is what keeps the discard guarantee intact:
 * an abandoned draft still gets thrown away, and it still can't be confused with
 * an ordinary highlight, because the id it discards can only ever have come from
 * this interaction's own insert.
 */
/**
 * What just made an annotation real: a question to Claude, or the reader's own
 * note. They are not interchangeable — see markTouched, where telling them apart
 * is what keeps a note looking like a note.
 */
type TouchKind = "question" | "note";

/**
 * Marks the ids of rows that exist only on this device. Everything real is a
 * uuid, so nothing can collide with it, and anything holding one knows not to
 * ask the server about it — see openExisting.
 */
const PENDING_PREFIX = "pending:";
const newPendingId = () => `${PENDING_PREFIX}${crypto.randomUUID()}`;
const isPendingId = (id: string) => id.startsWith(PENDING_PREFIX);

type PendingCreate = {
  /** Also the optimistic row's id, until the real one arrives. */
  clientId: string;
  /** Deliberately never rejects, so no continuation is an unhandled rejection. */
  result: Promise<{ ok: true; detail: AnnotationDetail } | { ok: false; error: Error }>;
  /** Server writes asked for while the row didn't exist, in the order asked. */
  queue: Promise<unknown>;
  /** Decided while the row didn't exist; honoured once it does. */
  onCreate: "keep" | "discardIfEmpty" | "delete";
  /**
   * True once the insert has come back. The record outlives that — the thread
   * may still be holding the stand-in id and need it translated — but only an
   * UNSETTLED one blocks starting another annotation.
   */
  settled: boolean;
};

/**
 * Whether two loads of a book's marks would draw the same thing.
 *
 * Compares only what the page and the margin actually render from. Deliberately
 * not a deep equality: the anchor is a nested object that never changes without
 * the id changing, and message content never reaches this list at all.
 */
function sameMarks(
  prev: ReaderAnnotationData | null,
  next: ReaderAnnotationData
): boolean {
  if (!prev) return false;
  if (prev.chats.length !== next.chats.length) return false;
  if (prev.spoilerFree !== next.spoilerFree) return false;
  if (prev.hasRealPages !== next.hasRealPages) return false;
  if (prev.pageMarks.length !== next.pageMarks.length) return false;
  return prev.chats.every((a, i) => {
    const b = next.chats[i];
    return (
      a.id === b.id &&
      a.messageCount === b.messageCount &&
      a.noteCount === b.noteCount &&
      a.unreadCount === b.unreadCount &&
      a.lastMessageAt === b.lastMessageAt &&
      a.anchorCharOffset === b.anchorCharOffset &&
      a.anchorStatus === b.anchorStatus &&
      a.sharedFromUserId === b.sharedFromUserId &&
      // Drawn from, like the rest: a star decides whether a plain highlight gets
      // a margin marker at all. Leave it out and a star set on another device
      // would land in the database and never reach this screen, because the
      // gate below would decide the refetch drew the same thing.
      a.starred === b.starred
    );
  });
}

export function ReaderAnnotationLayer({
  bookId,
  memberEmail,
  blocks: allBlocks,
  chapters,
  isArticle,
  contentRef,
  currentCharOffset,
  visibleThroughChar,
  onInlineMarksChange,
  requestedDocument,
  onDocumentRequestHandled,
  onDocumentChanged,
  goToChar,
  paged,
  panelOpen,
  onPanelOpenChange,
  openListOnMount,
  preferSheet,
  docked,
  canFloat,
  windowBase,
  layoutNonce,
  mentionTargets,
  openMarkId,
  onVisitAnchor,
  shownFace = "original",
  faceTextOf,
  plainBlocks,
  hideGutter = false,
}: {
  bookId: string;
  memberEmail: string | null;
  /**
   * Everyone who can be named in a mark, Nor first. Resolved on the server and
   * handed down rather than fetched here, so the handle the composer offers and
   * the handle the server grants on are the same string.
   */
  mentionTargets: MentionTarget[];
  /** One mark to open on arrival, from a mention's permalink. */
  openMarkId?: string | null;
  /**
   * Take the reader to a passage they were SENT to, rather than one they chose.
   * The book holds its saved position for as long as that visit lasts — see
   * ReaderReturnPill.
   */
  onVisitAnchor?: (charOffset: number) => void;
  /** Which face the page shows, for the toolbar's fourth action and the panel. */
  shownFace?: "original" | "plain";
  /** What the DOM shows per block in the plain face — see annotation-anchors.ts. */
  faceTextOf?: FaceTextOf;
  /** Plain paragraphs already held, for the counterpart panel. */
  plainBlocks?: ReadonlyMap<number, PlainBlock>;
  /**
   * Leave the margin markers out. The parallel spread has no column margins
   * for them to sit in; the marks list and the highlights still work.
   */
  hideGutter?: boolean;
  /** The book's block stream, mapped once by the reader and shared from there. */
  blocks: BookBlock[];
  /**
   * The book's chapters in the character space, for grouping the marks list.
   * Empty for an article, whose offsets aren't in that space at all.
   */
  chapters: ChapterBound[];
  /** Articles have no page map and no conversion char space — see AnchorSpace. */
  isArticle: boolean;
  contentRef: React.RefObject<HTMLDivElement | null>;
  /** Where the reader is now, in the conversion char space. */
  currentCharOffset: number;
  /**
   * First character past the bottom of the page, which with the above bounds
   * exactly what's on screen. Null while scrolling, and on the last page of a
   * paged window, where the reader has no next page to measure against — read as
   * "unbounded" rather than "empty" (see pageBlocks).
   */
  visibleThroughChar: number | null;
  /**
   * Publishes the conversations that leave a mark in the page. They have to be
   * an input to the rendered HTML rather than something drawn over it, so they
   * go up to the reader instead of being painted here — see inline-chat-blocks.
   */
  onInlineMarksChange: (marks: InlineChatMark[]) => void;
  /**
   * One of the reader's own documents, asked for from the Contents. Cleared by
   * onDocumentRequestHandled once acted on — a request rather than a state, so
   * choosing the same entry twice reopens it.
   */
  requestedDocument: BookScope | null;
  onDocumentRequestHandled: () => void;
  /** One was written or deleted; the Contents dates what it offers. */
  onDocumentChanged: () => void;
  goToChar: (charOffset: number) => void;
  /** Non-null in paged mode; drives marker placement. */
  paged: PagedGutterContext | null;
  panelOpen: boolean;
  onPanelOpenChange: (open: boolean) => void;
  /**
   * Arrive with the list already showing. Honoured exactly once, on the first
   * render of this layer: it describes how you got here, not a state to hold, so
   * closing the panel afterwards has to stick.
   */
  openListOnMount: boolean;
  /** Present the chat over the book rather than beside it — see chatAsSheet. */
  preferSheet: boolean;
  /** The panel takes width from the book rather than sitting over it. */
  docked: boolean;
  /**
   * Whether floating is on offer at all. Only a paged book has a second column
   * worth protecting; a scrolling one is a single centred measure that simply
   * shifts, and a sheet has taken nothing to give back.
   */
  canFloat: boolean;
  /**
   * Global index of the first block currently rendered. Zero while the whole
   * book is in the DOM; non-zero once the paged reader windows it. Every
   * translation between a stored anchor and the page goes through this.
   */
  windowBase: number;
  layoutNonce: number;
}) {
  const [data, setData] = useState<ReaderAnnotationData | null>(null);
  const [detail, setDetail] = useState<AnnotationDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  // Whether anything has been sent in the open chat. Drives both the discard on
  // close and whether clicking back into the book dismisses the panel.
  const [touched, setTouched] = useState(false);
  /**
   * The annotation THIS interaction created as an empty chat draft, if any.
   *
   * Load-bearing under the one-annotation model. "No messages" used to mean
   * "abandoned draft, throw it away"; now it also describes a perfectly good
   * highlight. Without this, opening a chat on a highlight you made last week
   * and closing it without typing would silently delete the highlight.
   */
  const [draftId, setDraftId] = useState<string | null>(null);
  /**
   * The panel shows one annotation, the index of all of them, or — for a peek
   * at the other face — a passage with no annotation behind it at all.
   */
  const [mode, setMode] = useState<"thread" | "list" | "counterpart">("thread");
  const [counterpart, setCounterpart] = useState<CounterpartRequest | null>(null);
  /**
   * Whether the index is collapsed to starred marks only. Remembered per book —
   * see starred-filter.ts for why it is per book and not per device.
   *
   * Read after mount rather than in a lazy initializer: this component renders
   * on the server too, and an initializer reaching for localStorage would hydrate
   * to a different value than it rendered. Nothing is ever seen unfiltered by
   * mistake, because the panel starts closed.
   */
  const [starredOnly, setStarredOnly] = useState(false);
  /**
   * The chapter heading whose menu is open, held as the element itself: the menu
   * positions against it and re-measures, which a copied rectangle couldn't
   * survive. Cleared whenever the page it sits on is relaid.
   */
  const [chapterMenu, setChapterMenu] = useState<HTMLElement | null>(null);
  /** Set when the row this panel is showing failed to save — see PendingCreate. */
  const [createError, setCreateError] = useState<string | null>(null);
  /** Bumped per open, so the thread remounts per annotation but not per id swap. */
  const [threadKey, setThreadKey] = useState(0);
  /**
   * Which way the composer opens. Set from the selection toolbar's intent, so
   * choosing Note there lands in a panel already set to write one; reopening
   * anything from the margin or the list starts on Chat, because by then the
   * gesture that carried an intent is long over.
   */
  /** The row the panel is showing, while it exists only on this device. */
  const pendingRef = useRef<PendingCreate | null>(null);
  /**
   * Passages highlighted here that the loaded list hasn't caught up with yet.
   *
   * A plain highlight opens nothing, so unlike a chat draft it has no panel to
   * carry its optimistic state — and without this the yellow only appeared once
   * the insert AND the refetch behind it had both returned, which is a visible
   * second between the tap and the mark.
   *
   * Keyed separately from the row's id because the row's id changes underneath
   * it: it starts as a stand-in and becomes the real one when the insert lands.
   */
  const [pendingHighlights, setPendingHighlights] = useState<
    { key: string; row: AnnotationSummary }[]
  >([]);

  // Articles never touch the conversion char space: their HTML was never run
  // through convert.ts, so the block stream would be describing a stream that
  // doesn't exist.
  //
  // The blocks themselves arrive as a prop rather than being derived here. They
  // used to be a second `blockMap(html)` over the same string the reader had
  // already mapped — a regex pass over 1.1M characters, run twice on every open
  // for one copy of the answer.
  const blocks = isArticle ? NO_BLOCKS : allBlocks;
  const space = useMemo<AnchorSpace>(
    () =>
      isArticle
        ? { kind: "dom" }
        : { kind: "book", blocks, base: windowBase, faceTextOf },
    [isArticle, blocks, windowBase, faceTextOf]
  );
  // Memoized, not `data?.chats ?? []`: a fresh array literal every render would
  // re-run the placement effect, which sets state, which renders again — a loop.
  const fetched = useMemo(() => data?.chats ?? [], [data]);

  /**
   * The server's list plus anything highlighted here that hasn't come back in
   * it yet. Everything downstream — the marks in the text, the gutter, the
   * index, what a tap lands on — reads this, so a fresh highlight behaves like
   * a real one in all of them from the first frame.
   */
  const loaded = useMemo(() => {
    if (pendingHighlights.length === 0) return fetched;
    const known = new Set(fetched.map((c) => c.id));
    const extra = pendingHighlights
      .filter((h) => !known.has(h.row.id))
      .map((h) => h.row);
    return extra.length === 0 ? fetched : [...fetched, ...extra];
  }, [fetched, pendingHighlights]);

  /**
   * The loaded list with the OPEN annotation's live state laid over it.
   *
   * Necessary because what an annotation *is* now depends on its contents: send
   * the first message in a chat and it stops being a highlight. The summary list
   * only learns that on its next fetch, so without this overlay a brand-new
   * conversation keeps painting yellow and stays out of the margin until you
   * reload the page — which is exactly the bug this fixes. refreshList() below
   * makes it durable; this makes it immediate.
   */
  const chats = useMemo(() => {
    if (!detail) return loaded;
    // The reader's preface and afterword are annotations but never marks. The
    // server keeps them out of `loaded` for exactly that reason, and this
    // overlay would otherwise put the open one straight back in — where its
    // formality of an anchor (block zero) would paint a gutter icon at the top
    // of the book and an entry in the marks list.
    if (detail.bookScope != null) return loaded;
    // An annotation the server hasn't returned yet is still one the reader has
    // made, and they should see the passage marked the moment they act. It
    // dedupes itself: once refreshList lands, the row is in `loaded` under its
    // real id and this branch stops firing.
    if (!loaded.some((c) => c.id === detail.id)) {
      const { messages, ...summary } = detail;
      void messages;
      return [...loaded, summary];
    }
    return loaded.map((c) =>
      c.id === detail.id
        ? {
            ...c,
            latestNote: detail.latestNote ?? c.latestNote,
            noteCount: Math.max(c.noteCount, detail.noteCount),
            // The mark in the page appears on the send, not on the reply — see
            // markTouched. Until the list is refetched, this is the only place
            // that knows the question was asked. `detail.messageCount` carries
            // that for a summary, whose mark isn't keyed on a question at all.
            firstQuestion: c.firstQuestion ?? detail.firstQuestion,
            messageCount: Math.max(c.messageCount, detail.messageCount),
          }
        : c
    );
  }, [loaded, detail]);

  /**
   * The things that show as a line in the book: conversations anchored to a
   * paragraph break that have actually been asked something, and the summary of
   * any chapter that has one.
   *
   * A chat started from a selection is deliberately not here. It already has a
   * visible home in the text — the highlight and its margin icon — and inlining
   * those as well would interrupt the prose on every passage you ever marked.
   *
   * A summary's mark says the same thing under every chapter rather than
   * quoting its own opening turn, which is why it is keyed on having a message
   * at all rather than on `firstQuestion`: the question is app-authored (see
   * chapter-summary.ts) and would only ever read the mark back to itself.
   *
   * Articles are out too: their HTML is arbitrary sanitized markup with no
   * character space to splice against, so they keep the margin icon alone.
   */
  const inlineMarks = useMemo<InlineChatMark[]>(() => {
    if (isArticle) return [];
    return chats.flatMap((c) => {
      if (c.anchor?.kind !== "between") return [];
      if (c.chapterAnchorId) {
        return c.messageCount > 0
          ? [
              {
                chatId: c.id,
                blockIndex: c.anchor.blockIndex,
                text: CHAPTER_SUMMARY_MARK_TEXT,
                kind: "summary" as const,
              },
            ]
          : [];
      }
      return c.firstQuestion
        ? [{ chatId: c.id, blockIndex: c.anchor.blockIndex, text: c.firstQuestion }]
        : [];
    });
  }, [chats, isArticle]);

  // Published on change rather than every render: the reader folds these into
  // the book's markup, and re-rendering the book to hand it an identical list
  // would repaginate it for nothing.
  const marksRef = useRef(inlineMarks);
  useEffect(() => {
    marksRef.current = inlineMarks;
  });
  const marksKey = inlineMarks
    .map((m) => `${m.chatId}@${m.blockIndex}:${m.text}`)
    .join("|");
  useEffect(() => {
    onInlineMarksChange(marksRef.current);
  }, [marksKey, onInlineMarksChange]);
  // Both of the things below are derived from the rendered content, so both
  // have to be re-derived when that content is swapped in or replaced. See
  // use-content-version.ts: layoutNonce alone does not reliably cover it.
  const contentVersion = useContentVersion(contentRef, layoutNonce);
  // Placed next to the hover target's own pass, in the same module, so the two
  // margins can't disagree about where a block is — see gutter-placement.ts.
  const gutterRows = useGutterPlacement(
    chats,
    contentRef,
    layoutNonce + contentVersion,
    paged,
    windowBase
  );
  // Annotated passages stay marked in the text.
  useAnnotationHighlights(
    chats,
    contentRef,
    detail?.id ?? null,
    layoutNonce + contentVersion,
    windowBase,
    faceTextOf
  );
  const totalChars = useMemo(() => {
    const last = blocks.at(-1);
    return last ? last.charStart + last.text.length + 1 : 0;
  }, [blocks]);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const sync = () => setIsMobile(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  // A phone is always a sheet; so is any window where the book has no room to
  // sit beside a panel, which the reader works out from its own geometry and
  // tells us. See chatAsSheet in book-reader.tsx.
  const asSheet = isMobile || preferSheet;
  // Only offered where it changes something. On a sheet the book has no width to
  // give — that's why it's a sheet — and a scrolling column has no second column
  // to save, so the panel there is simply always docked.
  const dockToggle = canFloat && !asSheet ? <PanelDockToggle /> : null;

  useEffect(() => {
    let cancelled = false;
    void getAnnotationData(bookId, memberEmail)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [bookId, memberEmail]);

  // Returns when the list has been re-read, so a caller holding an optimistic
  // copy of something knows when it's safe to let go of it. Never rejects.
  /**
   * Reload the marks, and keep the OLD array when nothing about them changed.
   *
   * This gate is not an optimisation. `chats` is memoized off `data`, so an
   * identical refetch still produces a fresh array identity, which re-runs the
   * highlight painter and the gutter placer — both of which recompute ranges and
   * reset the CSS highlight registry. On an e-ink reader that is a full-screen
   * repaint, and once a shared thread is polling on a timer it would be a
   * full-screen repaint every few seconds for as long as the book is open.
   */
  const refreshList = useCallback(
    () =>
      getAnnotationData(bookId, memberEmail)
        .then((next) =>
          setData((prev) => (sameMarks(prev, next) ? prev : next))
        )
        .catch(() => {}),
    [bookId, memberEmail]
  );

  // Keyed on the book, so opening a second one in the same tab re-reads rather
  // than carrying the first book's filter into it.
  useEffect(() => setStarredOnly(loadStarredOnly(bookId)), [bookId]);
  const changeStarredOnly = useCallback(
    (on: boolean) => {
      setStarredOnly(on);
      saveStarredOnly(bookId, on);
    },
    [bookId]
  );

  /**
   * Which page a character offset falls on, from the marks the book shipped
   * with. The server works this out too when it creates an annotation; doing it
   * here as well is what lets the panel open with the right page on it before the
   * server has been asked.
   */
  const pageMarks = useMemo(
    () => [...(data?.pageMarks ?? [])].sort((a, b) => a.charStart - b.charStart),
    [data]
  );
  const pageForCharOffset = useCallback(
    (charOffset: number): number | null => {
      let page: number | null = null;
      for (const mark of pageMarks) {
        if (mark.charStart <= charOffset) page = mark.pageNumber;
        else break;
      }
      return page;
    },
    [pageMarks]
  );

  const openList = useCallback(() => {
    // Toggle: the same control and the same key close it again.
    if (panelOpen && mode === "list") {
      onPanelOpenChange(false);
      return;
    }
    setMode("list");
    setDraftId(null);
    onPanelOpenChange(true);
  }, [mode, onPanelOpenChange, panelOpen]);

  /**
   * Coming in from the shelf's annotation count, which promised the notes.
   *
   * Deliberately not openList(): that one toggles, and a toggle fired on mount
   * would be at the mercy of whatever the panel happened to be doing. This says
   * the one thing it means, once, and then never again — the ref is what keeps a
   * re-render from reopening a panel you just closed, with the query string
   * still sitting in the URL.
   */
  const openedFromLink = useRef(false);
  useEffect(() => {
    // A link to one MARK beats a link to the list. Both firing would open the
    // panel twice and remount the thread mid-arrival, which is the exact failure
    // the document-opening ref below was written to prevent.
    if (openMarkId || !openListOnMount || openedFromLink.current) return;
    openedFromLink.current = true;
    setMode("list");
    onPanelOpenChange(true);
  }, [openListOnMount, onPanelOpenChange, openMarkId]);


  const openPanelWith = useCallback(
    (annotation: AnnotationDetail, asDraft = false) => {
      setMode("thread");
      setDetail(annotation);
      // A chat opened with an empty transcript is a draft until something is
      // sent — see closePanel.
      setTouched(annotation.messages.length > 0);
      setDraftId(asDraft ? annotation.id : null);
      setCreateError(null);
      // Bumped per open rather than keyed on the annotation's id, because that
      // id changes under an optimistic draft the moment the insert lands — and
      // remounting the thread then would throw away the half-typed question the
      // optimistic open exists to let them start.
      setThreadKey((k) => k + 1);
      onPanelOpenChange(true);
    },
    [onPanelOpenChange]
  );

  /**
   * The first send in a chat.
   *
   * Two things become true at once: the conversation is real and must survive
   * being closed, and the page now has a mark to carry. The question comes back
   * with the callback rather than being refetched, so the mark appears on the
   * send instead of a round trip later — which matters, because inserting it is
   * what reflows the page, and that should happen once, at the moment the reader
   * committed to asking.
   */
  const markTouched = useCallback((text: string, kind: TouchKind) => {
    setTouched(true);
    setDetail((d) =>
      d
        ? {
            ...d,
            firstQuestion: d.firstQuestion ?? markText(text),
            // Only a question bumps this. It is the count of the CONVERSATION,
            // and it is what annotationKind reads to decide a passage is a chat
            // — so bumping it for a note painted notes in the chat's purple and
            // gave them its speech-bubble icon. A summary's mark is keyed on
            // having a message rather than on the question, so it still needs
            // this to appear at the same moment.
            //
            // The matching bump for a note lives in addNote, deliberately: it
            // happens once the write lands, so a passage doesn't dress itself as
            // annotated until the words are actually saved.
            messageCount:
              kind === "question" ? Math.max(d.messageCount, 1) : d.messageCount,
          }
        : d
    );
  }, []);

  /** True while an annotation is being inserted — one at a time is plenty. */
  const isCreating = useCallback(
    () => pendingRef.current != null && !pendingRef.current.settled,
    []
  );

  /**
   * The real id for an annotation, waiting for its insert if it hasn't landed.
   *
   * Normally this returns immediately — the row exists, or the create settled
   * while the reader was typing. It only ever actually waits if they type and
   * send within the round trip.
   */
  const realIdFor = useCallback(async (id: string): Promise<string> => {
    const pending = pendingRef.current;
    if (!pending || pending.clientId !== id) return id;
    const result = await pending.result;
    if (!result.ok) throw result.error;
    return result.detail.id;
  }, []);

  /** Run a server write against an annotation that may not exist yet. */
  const onceCreated = useCallback(
    (id: string, run: (realId: string) => Promise<unknown>): Promise<unknown> => {
      const pending = pendingRef.current;
      if (!pending || pending.clientId !== id) return run(id);
      // Chained rather than fired in parallel, so a note written into a draft
      // commits before any discard that was also asked for while it was pending.
      pending.queue = pending.queue
        .then(() => pending.result)
        .then((result) => (result.ok ? run(result.detail.id) : undefined))
        .catch(() => {});
      return pending.queue;
    },
    []
  );

  /**
   * Everything createAnnotation would have told us about a row, predicted from
   * what the client already holds — which is what lets a mark appear, and a
   * panel open with the right header on it, before the server has been asked.
   *
   * The two exemptions the server applies to a chapter summary are mirrored
   * here rather than waited for, so the panel doesn't visibly correct itself a
   * moment later.
   */
  const optimisticRow = useCallback(
    (
      resolved: ResolvedAnchor,
      clientId: string,
      chapterAnchorId: string | null,
      askNor: boolean
    ): AnnotationSummary => {
      const isSummary = chapterAnchorId != null;
      const anchorPage = pageForCharOffset(resolved.anchorCharOffset);
      const spoilerFree = !isArticle && !isSummary && data?.spoilerFree === true;
      return {
        id: clientId,
        anchor: resolved.anchor,
        anchorCharOffset: resolved.anchorCharOffset,
        anchorPage,
        spoilerFree,
        contextThroughPage: spoilerFree ? anchorPage : null,
        quotedText: resolved.quotedText,
        plainQuotedText: resolved.plainQuotedText,
        chapterAnchorId,
        // Whether Nor is in this thread is the toolbar's choice, and a recap
        // is always his. Nobody else's, exactly where the reader just put it,
        // and with an audience of one.
        aiParticipant: askNor || isSummary,
        // Not known until the row exists; nothing reads it on a pending mark.
        threadId: "",
        sharedFromUserId: null,
        anchorStatus: "exact",
        participants: [],
        unreadCount: 0,
        // Never a book document: those are reached from the Contents and read
        // on their own page, never as a mark in the margin.
        bookScope: null,
        latestNote: null,
        noteCount: 0,
        // The column's default, and its only permitted value today.
        color: "yellow",
        // Nothing is starred at the moment it is made. Starring is a second
        // thought about a passage, never the first one.
        starred: false,
        modelPreference: isSummary ? "deep" : "fast",
        // Never at creation: a template is something the reader picks from
        // inside the blank thread, which converts this row afterwards.
        template: null,
        messageCount: 0,
        lastMessageAt: null,
        firstQuestion: null,
        createdAt: new Date().toISOString(),
      };
    },
    [data, isArticle, pageForCharOffset]
  );

  /**
   * Open the panel now; create the row alongside it.
   *
   * Shared by the selection toolbar and the between-paragraphs target, which
   * differ only in the anchor they arrive with.
   */
  const openDraft = useCallback(
    (
      resolved: ResolvedAnchor,
      asDraft: boolean,
      /** Set when this is a chapter's summary — see createAnnotation. */
      chapterAnchorId: string | null = null,
      /** Whether Nor answers in this thread — the toolbar's Ask/Note choice. */
      askNor = true
    ) => {
      const stopOpen = startTimer("annotate: click → panel");
      const clientId = newPendingId();
      const optimistic: AnnotationDetail = {
        ...optimisticRow(resolved, clientId, chapterAnchorId, askNor),
        messages: [],
      };

      const result = createAnnotation({
        bookId,
        anchor: resolved.anchor,
        anchorCharOffset: resolved.anchorCharOffset,
        quotedText: resolved.quotedText,
        plainQuotedText: resolved.plainQuotedText,
        chapterAnchorId,
        askNor,
        memberEmail,
      }).then(
        (detail) => ({ ok: true, detail }) as const,
        (error: unknown) => ({
          ok: false as const,
          error: error instanceof Error ? error : new Error("Couldn't save that annotation."),
        }) as const
      );
      const pending: PendingCreate = {
        clientId,
        result,
        queue: Promise.resolve(),
        onCreate: "keep",
        settled: false,
      };
      pendingRef.current = pending;

      openPanelWith(optimistic, asDraft);
      // Two frames: one for React to commit the panel, one for the browser to
      // paint it. This is the number the reader actually feels.
      requestAnimationFrame(() => requestAnimationFrame(() => stopOpen()));

      void result.then((settled) => {
        if (pendingRef.current !== pending) return;
        pending.settled = true;
        if (!settled.ok) {
          console.error("[reader] couldn't save that annotation", settled.error);
          setCreateError(settled.error.message);
          return;
        }
        const real = settled.detail;
        note("annotate: id settled", real.id);
        // Anything written in the meantime outranks the empty row the server
        // made — a note typed inside the create round trip is already drawn in
        // the thread and queued for the insert, so the server's freshly-created
        // (and therefore noteless) row must not paint over it.
        setDetail((d) =>
          d && d.id === clientId
            ? {
                ...real,
                latestNote: d.latestNote ?? real.latestNote,
                noteCount: Math.max(d.noteCount, real.noteCount),
                firstQuestion: d.firstQuestion ?? real.firstQuestion,
              }
            : d
        );
        setDraftId((d) => (d === clientId ? real.id : d));

        const queued = pending.queue;
        const disposition = pending.onCreate;
        void queued
          .then(async () => {
            if (disposition === "delete") await deleteAnnotation(real.id, memberEmail);
            else if (disposition === "discardIfEmpty") {
              await discardAnnotationIfEmpty(real.id, memberEmail);
            }
          })
          .then(refreshList)
          .catch(() => {});
      });
    },
    [bookId, memberEmail, openPanelWith, optimisticRow, refreshList]
  );

  /**
   * Leaving a chat you never wrote in throws it away, so an abandoned draft
   * doesn't leave a marker in the margin. The row is created up front (the
   * anchor has to exist before there's anywhere to send to), so this is the
   * cleanup for it. Reports whether it discarded anything.
   *
   * Every exit from a chat comes through here — closing the panel, and going
   * back to the list — because they abandon a draft equally.
   *
   * Only ever the draft this interaction created: anything else on screen is an
   * annotation that already existed, and leaving a panel is not a request to
   * delete it.
   *
   * Worth knowing exactly how much the server backstop covers, because it isn't
   * everything. It refuses to discard a row carrying a note or any message — so
   * notes and chats are safe twice over. A PLAIN HIGHLIGHT looks identical to an
   * abandoned draft in the database (no note, no messages), so nothing on the
   * server can tell them apart, and this `draftId` check is the only thing
   * standing between it and deletion. Do not route any other close path through
   * discardAnnotationIfEmpty.
   */
  const releaseOpenChat = useCallback(() => {
    const closing = detail;
    const wasTouched = touched;
    const wasDraft = closing != null && closing.id === draftId;
    setDraftId(null);
    if (!closing || wasTouched || !wasDraft) return false;

    const pending = pendingRef.current;
    if (pending && pending.clientId === closing.id) {
      // The row doesn't exist yet, so there is nothing to discard and nothing to
      // race the insert with. Record it; the create's own continuation carries
      // it out once it knows the id — see openDraft.
      pending.onCreate = "discardIfEmpty";
      return true;
    }
    void discardAnnotationIfEmpty(closing.id, memberEmail)
      .then((discarded) => {
        if (discarded) refreshList();
      })
      .catch(() => {});
    return true;
  }, [detail, draftId, memberEmail, refreshList, touched]);

  const closePanel = useCallback(() => {
    onPanelOpenChange(false);
    releaseOpenChat();
    setDetail(null);
  }, [onPanelOpenChange, releaseOpenChat]);

  /**
   * Leave the open chat for the index, without closing the panel.
   *
   * Routed through the same release as closing, because leaving a chat you never
   * wrote in abandons it either way — going back to the list must not be the one
   * exit that leaves a phantom mark behind in the margin. What survives is the
   * annotation itself: the list highlights the row you just came from, so you
   * land looking at where you were rather than at the top of a list of ten.
   * A discarded draft is the exception — there is no row left to point at.
   */
  const backToList = useCallback(() => {
    if (releaseOpenChat()) setDetail(null);
    setMode("list");
  }, [releaseOpenChat]);

  // `blockIndex` is global, like every index that reaches an anchor. See
  // RenderedBlocks.
  const startAtGap = useCallback(
    (blockIndex: number) => {
      const container = contentRef.current;
      if (!container || busy || isCreating()) return;
      const resolved = anchorForGap(blockIndex, space, container);
      if (!resolved) return;
      openDraft(resolved, true);
    },
    [busy, contentRef, isCreating, openDraft, space]
  );

  /**
   * What's on the page, in block indices, and where a conversation about it
   * would go. Null for articles, which have no character space — they fall back
   * to measuring the DOM in `askHere`.
   */
  const onPage = useMemo(
    () =>
      isArticle
        ? null
        : pageBlocks(blocks, currentCharOffset, visibleThroughChar ?? currentCharOffset),
    [blocks, currentCharOffset, isArticle, visibleThroughChar]
  );

  /**
   * The three things a selection can become. They differ only in what the row
   * starts with and whether the panel opens — it is one annotation either way,
   * and any of them can grow into any other later.
   */
  const annotateSelection = useCallback(
    async (range: Range, intent: SelectionIntent) => {
      const container = contentRef.current;
      if (!container || busy || isCreating()) return;
      const resolved = time("anchor: from selection", () =>
        anchorFromRange(range, container, space)
      );
      // anchorFromRange reports its own reason — see fail() there.
      if (!resolved) return;

      // The other face of the passage: whole paragraphs, in the panel, and no
      // mark anywhere. A peek, not an annotation — see CounterpartPanel.
      if (intent === "face") {
        const from = resolved.anchor.blockIndex;
        const to = (resolved.anchor.endBlockIndex ?? resolved.anchor.blockIndex) + 1;
        setCounterpart({
          from,
          to,
          show: shownFace === "plain" ? "original" : "plain",
          selected: range.toString().trim() || null,
        });
        setMode("counterpart");
        setDetail(null);
        setDraftId(null);
        onPanelOpenChange(true);
        return;
      }

      // Ask and Note both need somewhere to write, so they open the panel — and
      // they open it now, against a row that doesn't exist yet, rather than
      // after the round trip that creates it. See PendingCreate.
      //
      // Neither pre-writes anything. The row starts as a highlight and becomes
      // a conversation the moment you type, so changing your mind leaves a
      // highlight rather than a blank entry in the index.
      //
      // The intent decides whether Nor is in the thread, and the thread keeps
      // that — the toolbar already asked, so making the reader say it again
      // inside the panel, every turn, would be asking twice.
      if (intent !== "highlight") {
        openDraft(resolved, false, null, intent === "ask");
        return;
      }

      // Highlighting is a one-gesture action: mark it and keep reading. So the
      // yellow is painted from a stand-in row on the tap, and the insert happens
      // behind it — waiting for the insert and the refetch that follows it is a
      // second of nothing, on the one action that should feel like a pen.
      //
      // Nothing here holds `busy`, unlike every other path: the reader is not
      // waiting on anything, so marking three passages in a row must not be
      // rationed to one at a time.
      const key = newPendingId();
      setPendingHighlights((p) => [
        ...p,
        // A highlight is a mark with nobody in it — opened later, it writes.
        { key, row: optimisticRow(resolved, key, null, false) },
      ]);
      const stopCreate = startTimer("annotate: server create");
      try {
        const saved = await createAnnotation({
          bookId,
          anchor: resolved.anchor,
          anchorCharOffset: resolved.anchorCharOffset,
          quotedText: resolved.quotedText,
          plainQuotedText: resolved.plainQuotedText,
          askNor: false,
          memberEmail,
        });
        stopCreate(intent);
        // Take on the real id, so a tap on the passage in the gap before the
        // refetch opens the row that now exists rather than doing nothing.
        setPendingHighlights((p) =>
          p.map((h) => (h.key === key ? { ...h, row: { ...h.row, id: saved.id } } : h))
        );
        await refreshList();
      } catch (err) {
        // `void annotateSelection(...)` means a throw here becomes an unhandled
        // rejection nobody sees, and the reader just watches their selection
        // vanish. Surface it. The mark goes with it — below — because it stood
        // for a row that was never written.
        console.error("[reader] couldn't save that annotation", err);
      } finally {
        // Retired once the list has been read again, rather than once the row
        // is spotted in it. Those differ if the highlight was deleted in the
        // meantime, and only this one declines to repaint it from its ghost.
        setPendingHighlights((p) => p.filter((h) => h.key !== key));
      }
    },
    [
      bookId,
      busy,
      contentRef,
      isCreating,
      memberEmail,
      onPanelOpenChange,
      openDraft,
      optimisticRow,
      refreshList,
      shownFace,
      space,
    ]
  );

  /**
   * Open one mark's thread.
   *
   * Returns what it opened, which the arrival-from-a-link path needs: `detail`
   * in this component's state will not have updated inside that effect's
   * closure, and threading the jump through a state read would be a timing dance
   * with nothing to gain. Opening still deliberately does NOT move the book —
   * the caller decides that.
   */
  const openExisting = useCallback(
    async (chatId: string): Promise<AnnotationDetail | null> => {
      // A highlight made a moment ago whose insert hasn't landed. There is
      // nothing to fetch, and asking would be a round trip that can only fail —
      // its id isn't a uuid. The tap does nothing for the short while that's
      // true, and works from the moment the row exists.
      if (isPendingId(chatId)) return null;
      const chat = await getAnnotation(chatId, memberEmail);
      if (!chat) return null;
      openPanelWith(chat);
      return chat;
    },
    [memberEmail, openPanelWith]
  );

  /**
   * Arriving from a mention.
   *
   * The ref is set BEFORE the await, not after — React double-invokes effects in
   * development, the clearing setState has not flushed between the two calls,
   * and the second call's closure holds a stale `detail`. Same reasoning, and
   * same shape, as opening a book document.
   */
  const arrivedAtMark = useRef(false);
  useEffect(() => {
    if (!openMarkId || arrivedAtMark.current) return;
    arrivedAtMark.current = true;
    void (async () => {
      const chat = await openExisting(openMarkId);
      // An unplaced mark — the passage could not be found in this copy — still
      // opens its conversation. It just has nowhere to jump to, and offering a
      // way back from a place you never went would be nonsense.
      if (chat && !isArticle) onVisitAnchor?.(chat.anchorCharOffset);
    })();
  }, [isArticle, onVisitAnchor, openExisting, openMarkId]);

  /**
   * The reader's preface or afterword, opened from the Contents.
   *
   * Not optimistic, unlike every other way into this panel. The row is
   * find-or-create against a unique index — that is what stops two devices
   * starting two prefaces — so there is a real id to wait for, and the wait is
   * one round trip against something the reader has just deliberately navigated
   * to rather than something they expect under their cursor.
   *
   * The ref guards a window state can't: this effect can fire twice for one
   * request (React double-invokes effects in development, and the clearing
   * setState has not necessarily flushed between the two), and the open is
   * asynchronous — so `detail` is still the old thread when the second call
   * checks it. Two opens would remount the panel twice, and a thread remounted
   * mid-question asks a second one.
   */
  const openingDocumentRef = useRef<BookScope | null>(null);

  const openDocument = useCallback(
    async (scope: BookScope) => {
      if (busy || isCreating() || openingDocumentRef.current === scope) return;
      if (panelOpen && mode === "thread" && detail?.bookScope === scope) return;

      openingDocumentRef.current = scope;
      setBusy(true);
      try {
        const document = await openBookDocument({ bookId, scope, memberEmail });
        openPanelWith(document);
      } catch (err) {
        // `void openDocument(...)` would otherwise make this an unhandled
        // rejection nobody sees, and the reader just watches nothing happen.
        console.error("[reader] couldn't open that", err);
      } finally {
        openingDocumentRef.current = null;
        setBusy(false);
      }
    },
    [bookId, busy, detail, isCreating, memberEmail, mode, openPanelWith, panelOpen]
  );

  useEffect(() => {
    if (!requestedDocument) return;
    const scope = requestedDocument;
    // Cleared first, so the request can't be replayed by this effect re-running
    // when openDocument's identity changes underneath it.
    onDocumentRequestHandled();
    void openDocument(scope);
  }, [onDocumentRequestHandled, openDocument, requestedDocument]);

  /** The headings a tap should mean something on — see summarizableChapters. */
  const chapterIds = useMemo(
    () => new Set(summarizableChapters(chapters).map((c) => c.anchorId)),
    [chapters]
  );

  /**
   * The summary of the chapter whose title was just tapped: reopened if it has
   * one, written now if it doesn't.
   *
   * The anchor is the chapter's FIRST PARAGRAPH, not its heading, and that is
   * what puts the mark where it belongs. Every mark is spliced in at the start
   * of the block it names (inline-chat-blocks.ts), so anchoring one block below
   * the heading lands it between the heading and the prose — which is where a
   * summary of what follows should sit, and is also the only spot in a paged
   * book guaranteed to be on screen when the chapter is.
   */
  const openChapterSummary = useCallback(
    (anchorId: string) => {
      const container = contentRef.current;
      if (!container || busy || isCreating()) return;

      const existing = chats.find((c) => c.chapterAnchorId === anchorId);
      if (existing) {
        // Already the open thread. Reopening would remount it, which throws
        // away a recap that is still streaming — and a second tap on a title
        // you can see is far more likely to be a stray one than a request.
        if (panelOpen && mode === "thread" && detail?.id === existing.id) return;
        void openExisting(existing.id);
        return;
      }

      const bound = chapters.find((c) => c.anchorId === anchorId);
      if (!bound) return;
      const heading = blockIndexForCharOffset(blocks, bound.charStart);
      // A chapter that is nothing but its heading has no paragraph to sit above,
      // so the mark goes on the heading itself rather than nowhere.
      const below = Math.min(heading + 1, blocks.length - 1);
      const resolved = anchorForGap(below, space, container);
      if (!resolved) return;

      openDraft(resolved, true, anchorId);
    },
    [
      blocks,
      busy,
      chapters,
      chats,
      contentRef,
      detail,
      isCreating,
      mode,
      openDraft,
      openExisting,
      panelOpen,
      space,
    ]
  );

  /**
   * Start a NEW conversation about the visible page.
   *
   * Always a new one. This used to reopen whatever conversation the page already
   * had, on a one-page-one-conversation rule that turned out to be a rule about
   * the wrong thing: a page can raise a second question that has nothing to do
   * with the first, and threading it onto an unrelated exchange makes both worse
   * — the model carries the old context, and neither conversation is findable
   * afterwards by what it was about. So they stack instead. Each leaves its own
   * mark at the same paragraph break, in the order they were started, and each
   * is its own thread.
   *
   * Reopening is what the marks in the page and the list are for; nothing here
   * has to double as that.
   *
   * An article has no character space to reason in, so its break is measured off
   * the DOM instead: the first block starting below the top of the window. Books
   * never take that path, in either reading mode — a scrolling book reports no
   * page end, which `pageBlocks` reads as "the next paragraph start", and that is
   * the same answer.
   */
  const askHere = useCallback(() => {
    const container = contentRef.current;
    if (!container || busy || isCreating()) return;

    if (onPage) {
      startAtGap(onPage.breakIndex);
      return;
    }

    const els = blockElements(container);
    const found = els.findIndex((el) => el.getBoundingClientRect().top > READING_LINE);
    // Articles are never windowed, so a DOM index is already a global one.
    const blockIndex = found >= 0 ? found : els.length - 1;
    if (blockIndex < 0) return;
    startAtGap(blockIndex);
  }, [busy, contentRef, isCreating, onPage, startAtGap]);

  /**
   * `c` — start a conversation about what you're looking at.
   *
   * One key, two meanings, decided by whether anything is selected: with a
   * passage highlighted it asks about that passage, and with nothing selected it
   * asks about the page. Those are the same two things the selection toolbar's
   * "Ask" and the margin control already do, so this adds a way in rather than a
   * behaviour — which is what makes one letter for both defensible.
   *
   * Matched on the physical key like `b` above (see annotations-button.tsx):
   * e.key is whatever the layout produces, e.code is the key you pressed.
   */
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== "KeyC") return;
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || e.repeat) return;
      if (isTypingTarget(e.target) || inOpenOverlay(e.target)) return;
      const container = contentRef.current;
      if (!container) return;

      // Cloned before the selection is dropped, for the same reason the toolbar
      // clones (see use-selection-range.ts): the anchor has to survive whatever
      // happens to the live selection next.
      const selection = window.getSelection();
      const live =
        selection && !selection.isCollapsed && selection.rangeCount > 0
          ? selection.getRangeAt(0)
          : null;
      const onPassage =
        live != null &&
        container.contains(live.commonAncestorContainer) &&
        live.toString().trim().length > 0;

      e.preventDefault();
      if (onPassage && live) {
        const range = live.cloneRange();
        selection?.removeAllRanges();
        void annotateSelection(range, "ask");
        return;
      }
      askHere();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [annotateSelection, askHere, contentRef]);

  // Clicking a highlighted passage opens its chat — the highlight should be the
  // affordance, not just a colour. Ignored while a selection is live, so this
  // never hijacks the click that finishes selecting text.
  useEffect(() => {
    const container = contentRef.current;
    if (!container) return;
    const onClick = (e: MouseEvent) => {
      const selection = window.getSelection();
      if (selection && !selection.isCollapsed) return;
      // A mark set into the page IS the way back into its conversation. It lives
      // in the book's own markup rather than in React, so it is opened from here
      // — see inline-chat-blocks.ts.
      const mark = (e.target as HTMLElement | null)?.closest(`[${INLINE_MARK_ATTR}]`);
      const markId = mark?.getAttribute(INLINE_MARK_ATTR);
      if (markId) {
        void openExisting(markId);
        return;
      }
      // A chapter title is tappable, and offers what can be done with the
      // chapter it names — today, its summary. Only the headings the CONTENTS
      // lists: a converted book also uses headings for front matter and part
      // dividers, and neither of those is a chapter anyone wants recapped.
      //
      // Books only, like every other splice: an article's offsets aren't in the
      // conversion char space the anchor would be recorded in.
      const heading = isArticle
        ? null
        : (e.target as HTMLElement | null)?.closest<HTMLElement>(".reader-heading");
      if (heading?.id && chapterIds.has(heading.id)) {
        // Toggle. A press on the open menu's own heading is deliberately not
        // treated as a press outside it, so it arrives here and shuts it.
        setChapterMenu((open) => (open === heading ? null : heading));
        return;
      }
      // Articles keep real links. A click inside one is meant for the link, and
      // opening a panel on top of a navigation is the wrong answer to both.
      if ((e.target as HTMLElement | null)?.closest("a")) return;
      // A Plain English marker or glossary term belongs to the reader, which
      // handles it on the same container; a click on one is not a passage.
      if ((e.target as HTMLElement | null)?.closest("[data-reader-plain], .reader-term")) {
        return;
      }
      const hit = annotationAtPoint(chats, container, e.clientX, e.clientY, windowBase, faceTextOf);
      if (hit) void openExisting(hit.id);
    };
    container.addEventListener("click", onClick);
    return () => container.removeEventListener("click", onClick);
  }, [chapterIds, chats, contentRef, faceTextOf, isArticle, openExisting, windowBase]);

  /**
   * Mark the tappable titles as tappable.
   *
   * The pointer over a chapter heading has to stop saying "text", because on
   * this one line of the page it isn't: it opens a menu. The class carries the
   * cursor and the hover underline (see reader-prose.ts) and goes on only the
   * headings the contents lists, so the front matter and part dividers that
   * share the same markup keep reading as ordinary type.
   *
   * Stamped from here rather than emitted by the converter because which
   * headings qualify is a question about the book's CONTENTS, which the
   * converter never sees. Re-run whenever the rendered content is swapped —
   * a paged window turns the whole book over several times a chapter.
   */
  useEffect(() => {
    const container = contentRef.current;
    if (!container || isArticle) return;
    for (const h of container.querySelectorAll<HTMLElement>(".reader-heading")) {
      h.classList.toggle(CHAPTER_TAP_CLASS, !!h.id && chapterIds.has(h.id));
    }
  }, [chapterIds, contentRef, contentVersion, isArticle, layoutNonce]);

  // A relaid page has moved the heading out from under the menu — and in a paged
  // window may have taken the element out of the document entirely.
  useEffect(() => {
    setChapterMenu(null);
  }, [contentVersion, layoutNonce]);

  // A citation cites a page, and every page we know about has a recorded
  // character offset — which navigates identically whether the book is paged or
  // scrolled. (The page-N elements can't be relied on: even books flagged
  // has_real_pages often carry none in the DOM.)
  const jumpToPage = useCallback(
    (page: number) => {
      const mark = data?.pageMarks.find((m) => m.pageNumber === page);
      if (!mark) return;
      goToChar(mark.charStart);
    },
    [data, goToChar]
  );

  /**
   * Scroll the book to where the open chat is anchored.
   *
   * Opening a conversation does NOT move the book — deliberately, since most of
   * them are opened from a marker you are already looking at, and yanking the
   * page out from under someone would be worse than useless. But that leaves the
   * one route in that arrives from somewhere else, the marks list, with no way
   * back to the passage a conversation was about.
   *
   * Goes by character offset rather than by page, like every other jump here: it
   * navigates identically whether the book is paged or scrolled, and it lands on
   * the paragraph rather than the top of the page it happens to sit on.
   *
   * Books only. An article's anchors are DOM-text offsets rather than positions
   * in the conversion character space, so the same call would land somewhere
   * arbitrary — and an article is one scroll long, where the value of this is
   * close to nil anyway.
   */
  const jumpToAnchor = useCallback(() => {
    if (!detail || isArticle) return;
    goToChar(detail.anchorCharOffset);
  }, [detail, goToChar, isArticle]);

  /** Synthetic page numbers mean nothing on screen — show progress instead. */
  const labelForPage = useCallback(
    (page: number) => {
      const mark = data?.pageMarks.find((m) => m.pageNumber === page);
      if (!mark || totalChars <= 0) return null;
      return `${Math.round((mark.charStart / totalChars) * 100)}%`;
    },
    [data, totalChars]
  );

  // Deletes outright rather than going through closePanel, which would then
  // also try to discard the row it just removed.
  const removeChat = useCallback(async () => {
    if (!detail) return;
    const id = detail.id;
    onPanelOpenChange(false);
    setDetail(null);
    setDraftId(null);

    const pending = pendingRef.current;
    if (pending && pending.clientId === id) {
      // Deleting something that hasn't been inserted yet. Left as "keep" this
      // would land a row nobody asked for the moment the insert returned.
      pending.onCreate = "delete";
      return;
    }
    await deleteAnnotation(id, memberEmail);
    refreshList();
  }, [detail, memberEmail, onPanelOpenChange, refreshList]);

  /**
   * Move the open chat's spoiler boundary — and take the book's default with it.
   *
   * Two writes because they answer two different questions. The chat's own row
   * is what the reader is actually changing: the box sits by the composer, so it
   * has to govern the question about to be asked, not some future one. The
   * book's switch follows along because spoiler-safety is a stance about the
   * book you're in the middle of, not a per-question mood — having to re-tick it
   * at every passage would be the same paper cut as the old "applies to new
   * chats" label, from the other direction.
   *
   * The server ignores the first write once the chat has been asked something;
   * the panel stops offering the control at the same moment.
   */
  const changeSpoilerFree = useCallback(
    async (next: boolean) => {
      if (!detail) return;
      setDetail((d) =>
        d
          ? {
              ...d,
              spoilerFree: next,
              // Kept in step with what the server writes, so the header's "read
              // to p.N" line answers the tick immediately.
              contextThroughPage: next ? d.anchorPage : null,
            }
          : d
      );
      setData((d) => (d ? { ...d, spoilerFree: next } : d));
      await onceCreated(detail.id, (id) =>
        setAnnotationSpoilerFree(id, next, memberEmail)
      );
      await setBookSpoilerFree(bookId, next, memberEmail);
    },
    [bookId, detail, memberEmail, onceCreated]
  );

  /**
   * Append a note to the open annotation.
   *
   * The thread has already drawn it, so this only has to make it real and tell
   * the list — which cares because a note is what turns a highlight into
   * something with words in the margin.
   */
  const addNote = useCallback(
    async (text: string) => {
      if (!detail) return;
      // Recorded after the write rather than before it. The thread has already
      // drawn the note optimistically and rolls its own copy back if this
      // throws; these fields only feed the marks list, so writing them up front
      // would leave a note in the sidebar that no longer exists in the panel.
      await onceCreated(detail.id, (id) =>
        postAnnotationMessage(id, text, memberEmail)
      );
      setDetail((d) =>
        d
          ? {
              ...d,
              latestNote: text,
              noteCount: d.noteCount + 1,
              firstQuestion: d.firstQuestion ?? markText(text),
            }
          : d
      );
      refreshList();
    },
    [detail, memberEmail, onceCreated, refreshList]
  );

  /** What the open thread is a summary OF, when it's a summary at all. */
  const openChapterTitle = useMemo(() => {
    const anchorId = detail?.chapterAnchorId;
    if (!anchorId) return null;
    return chapters.find((c) => c.anchorId === anchorId)?.title ?? null;
  }, [chapters, detail]);

  const changeModel = useCallback(
    async (next: ReaderChatModelPreference) => {
      if (!detail) return;
      setDetail((d) => (d ? { ...d, modelPreference: next } : d));
      await onceCreated(detail.id, (id) =>
        setAnnotationModelPreference(id, next, memberEmail)
      );
    },
    [detail, memberEmail, onceCreated]
  );

  /**
   * Keep this passage, or stop keeping it.
   *
   * Patches BOTH the open thread and the loaded list, which none of the settings
   * above have to. A star is set from two places — the thread's header and the
   * row in the marks list — and both are on screen at once when the panel is
   * docked; waiting for a refetch would leave one of them a round trip behind
   * the tap that asked for it.
   *
   * It also changes what the MARGIN draws: a starred highlight gets a marker
   * that an unstarred one never does. So a star necessarily churns the `chats`
   * identity and re-runs the highlight painter and the gutter placer — a
   * full-screen flash on e-ink. That is the very thing sameMarks exists to
   * avoid, and here it is correct: something visible did change. Don't "fix" it.
   *
   * Rolls back on failure, like pickTemplate and unlike changeModel: a star that
   * silently didn't save is a passage the reader believes they can find again
   * and can't, which is the one failure this feature exists to prevent. Hence
   * realIdFor rather than onceCreated, which swallows its errors.
   */
  const toggleStar = useCallback(
    async (annotationId: string, next: boolean) => {
      const patch = (value: boolean) => {
        setDetail((d) => (d && d.id === annotationId ? { ...d, starred: value } : d));
        setData((prev) =>
          prev
            ? {
                ...prev,
                chats: prev.chats.map((c) =>
                  c.id === annotationId ? { ...c, starred: value } : c
                ),
              }
            : prev
        );
      };
      patch(next);
      try {
        const id = await realIdFor(annotationId);
        await setAnnotationStarred(id, next, memberEmail);
      } catch {
        patch(!next);
      }
    },
    [memberEmail, realIdFor]
  );

  /**
   * Convert the open blank chat into one of the two mid-book conversations.
   *
   * MUST REJECT IF THE WRITE FAILS, which is why this goes through realIdFor and
   * calls the action directly rather than using onceCreated like the two
   * settings above. That helper swallows its errors — right for a note or a
   * model preference, where a lost write costs a setting — and wrong here: the
   * thread sends the opening question the moment this resolves, so a silent
   * failure would produce a confident answer from a prompt that had never heard
   * of the template. Nothing about that reads as broken from the outside, which
   * is exactly what makes it worth the extra care.
   *
   * The local row is updated first so the model picker and the spoiler box go
   * away on the click, and rolled back if the write doesn't land — a chat that
   * looks templated and isn't would be the same lie one layer up.
   */
  const pickTemplate = useCallback(
    async (template: ReaderChatTemplate) => {
      if (!detail) return;
      const before = detail;
      setDetail((d) =>
        d
          ? {
              ...d,
              template,
              modelPreference: "deep",
              spoilerFree: false,
              contextThroughPage: null,
            }
          : d
      );
      try {
        const id = await realIdFor(detail.id);
        await setAnnotationTemplate(id, template, memberEmail);
      } catch (err) {
        setDetail((d) => (d && d.id === before.id ? before : d));
        throw err;
      }
    },
    [detail, memberEmail, realIdFor]
  );

  return (
    <>
      <ReaderMarginControls
        onAsk={askHere}
        onOpenList={openList}
        listActive={panelOpen && mode === "list"}
      />
      {!hideGutter && (
        <GutterMarkers
          rows={gutterRows}
          openAnnotationId={detail?.id ?? null}
          onOpen={(id) => void openExisting(id)}
        />
      )}
      <SelectionToolbar
        contentRef={contentRef}
        onAct={(range, intent) => void annotateSelection(range, intent)}
        disabled={busy}
        // Books only: an article has no translation and no block map to peek
        // through. Offered in every book, translated or not — the untranslated
        // case is exactly when a paragraph in plain English is worth a look.
        faceAction={isArticle ? null : shownFace === "plain" ? "original" : "plain"}
      />
      {chapterMenu && (
        <ChapterMenu
          anchor={chapterMenu}
          title={chapters.find((c) => c.anchorId === chapterMenu.id)?.title ?? null}
          hasSummary={chats.some((c) => c.chapterAnchorId === chapterMenu.id)}
          onSummarize={() => {
            const anchorId = chapterMenu.id;
            setChapterMenu(null);
            openChapterSummary(anchorId);
          }}
          onDismiss={() => setChapterMenu(null)}
        />
      )}
      <AnnotationPanel
        open={panelOpen}
        isMobile={asSheet}
        docked={docked}
        onClose={closePanel}
        // The list is a destination and stays put; only an untouched chat
        // draft behaves like a popover and gets out of your way. So is a
        // preface or afterword — you went to the Contents to get here, and it
        // starts asking the moment it opens.
        dismissOnOutsidePress={
          mode === "counterpart" || (mode === "thread" && !touched && detail?.bookScope == null)
        }
      >
        {mode === "counterpart" && counterpart ? (
          <CounterpartPanel
            bookId={bookId}
            request={counterpart}
            blocks={blocks}
            known={plainBlocks ?? new Map()}
            onClose={closePanel}
            dockToggle={dockToggle}
          />
        ) : mode === "list" ? (
          <AnnotationList
            annotations={chats}
            // An article's anchors are DOM offsets, not the book character
            // space these chapters are measured in — there is nothing to group.
            chapters={isArticle ? NO_CHAPTERS : chapters}
            totalChars={totalChars}
            openAnnotationId={detail?.id ?? null}
            hasRealPages={data?.hasRealPages ?? false}
            onOpen={(id) => void openExisting(id)}
            onClose={closePanel}
            onAsk={askHere}
            starredOnly={starredOnly}
            onStarredOnlyChange={changeStarredOnly}
            onToggleStar={(id, next) => void toggleStar(id, next)}
            dockToggle={dockToggle}
          />
        ) : (
          detail &&
          (detail.bookScope != null ? (
            <BookDocumentThread
              key={threadKey}
              chat={detail}
              scope={detail.bookScope}
              memberEmail={memberEmail}
              hasRealPages={data?.hasRealPages ?? false}
              labelForPage={labelForPage}
              // The whole reason these came back to the panel: a citation moves
              // the book behind it, and the conversation stays open.
              onJumpToPage={jumpToPage}
              // Deleting one is how you start it over, so the Contents has to
              // hear about it as well as the marks list.
              onDelete={() => void removeChat().then(onDocumentChanged)}
              onBack={backToList}
              onClose={closePanel}
              onTouched={() => setTouched(true)}
              onExchangeComplete={onDocumentChanged}
              dockToggle={dockToggle}
            />
          ) : (
          <AnnotationThread
            key={threadKey}
            chat={detail}
            chapterTitle={openChapterTitle}
            resolveChatId={realIdFor}
            createError={createError}
            memberEmail={memberEmail}
            isArticle={isArticle}
            hasRealPages={data?.hasRealPages ?? false}
            labelForPage={labelForPage}
            onJumpToPage={jumpToPage}
            onJumpToAnchor={isArticle ? undefined : jumpToAnchor}
            onDelete={() => void removeChat()}
            onBack={backToList}
            onClose={closePanel}
            onTouched={markTouched}
            // A sent message promotes a highlight to a chat, which changes both
            // its colour and whether it gets a margin icon. Refetch so the
            // change outlives the panel being open.
            onExchangeComplete={refreshList}
            onSpoilerFreeChange={(v) => void changeSpoilerFree(v)}
            onModelChange={(v) => void changeModel(v)}
            onPickTemplate={pickTemplate}
            mentionTargets={mentionTargets}
            onAddNote={addNote}
            onToggleStar={(next) => void toggleStar(detail.id, next)}
            dockToggle={dockToggle}
          />
          ))
        )}
      </AnnotationPanel>
    </>
  );
}
