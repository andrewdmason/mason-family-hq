"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createAnnotation,
  deleteAnnotation,
  discardAnnotationIfEmpty,
  forkAnnotation,
  getAnnotation,
  getAnnotationData,
  setBookSpoilerFree,
  setAnnotationModelPreference,
  setAnnotationNote,
} from "@/app/(reading)/reader/annotation-actions";
import { blockIndexForCharOffset, type BookBlock } from "@/lib/reading/block-stream";
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
  ReaderChatModelPreference,
} from "@/lib/reading/annotation-types";
import {
  summarizableChapters,
  type ChapterBound,
} from "@/lib/reading/reading-progress";
import { AnnotationPanel } from "./annotation-panel";
import { AnnotationList } from "./annotation-list";
import { ReaderMarginControls } from "./annotations-button";
import { AnnotationThread } from "./annotation-thread";
import { GutterMarkers } from "./gutter-markers";
import { useGutterPlacement, type PagedGutterContext } from "./gutter-placement";
import { PanelDockToggle } from "./panel-dock-toggle";
import { SelectionToolbar, type SelectionIntent } from "./selection-toolbar";
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

function isPendingId(id: string): boolean {
  return id.startsWith("pending:");
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
  goToChar,
  paged,
  panelOpen,
  onPanelOpenChange,
  preferSheet,
  docked,
  canFloat,
  windowBase,
  layoutNonce,
}: {
  bookId: string;
  memberEmail: string | null;
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
  goToChar: (charOffset: number) => void;
  /** Non-null in paged mode; drives marker placement. */
  paged: PagedGutterContext | null;
  panelOpen: boolean;
  onPanelOpenChange: (open: boolean) => void;
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
  /** The panel shows one annotation, or the index of all of them. */
  const [mode, setMode] = useState<"thread" | "list">("thread");
  /** Set when the row this panel is showing failed to save — see PendingCreate. */
  const [createError, setCreateError] = useState<string | null>(null);
  /** Bumped per open, so the thread remounts per annotation but not per id swap. */
  const [threadKey, setThreadKey] = useState(0);
  /** The row the panel is showing, while it exists only on this device. */
  const pendingRef = useRef<PendingCreate | null>(null);

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
    () => (isArticle ? { kind: "dom" } : { kind: "book", blocks, base: windowBase }),
    [isArticle, blocks, windowBase]
  );
  // Memoized, not `data?.chats ?? []`: a fresh array literal every render would
  // re-run the placement effect, which sets state, which renders again — a loop.
  const loaded = useMemo(() => data?.chats ?? [], [data]);

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
            note: detail.note,
            // The mark in the page appears on the send, not on the reply — see
            // markTouched. Until the list is refetched, this is the only place
            // that knows the question was asked. `detail.messageCount` carries
            // that for a summary, whose mark isn't keyed on a question at all.
            firstQuestion: c.firstQuestion ?? detail.firstQuestion,
            messageCount: Math.max(
              c.messageCount,
              detail.messageCount,
              detail.messages.length
            ),
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
    windowBase
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

  const refreshList = useCallback(() => {
    void getAnnotationData(bookId, memberEmail)
      .then(setData)
      .catch(() => {});
  }, [bookId, memberEmail]);

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
  const markTouched = useCallback((question: string) => {
    setTouched(true);
    setDetail((d) =>
      d
        ? {
            ...d,
            firstQuestion: d.firstQuestion ?? markText(question),
            // A summary's mark is keyed on having a message rather than on the
            // question, so it needs this to appear at the same moment.
            messageCount: Math.max(d.messageCount, 1),
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
      chapterAnchorId: string | null = null
    ) => {
      const stopOpen = startTimer("annotate: click → panel");
      const clientId = `pending:${crypto.randomUUID()}`;
      const anchorPage = pageForCharOffset(resolved.anchorCharOffset);
      // Everything createAnnotation would have told us, predicted from what the
      // client already holds. The header reads from these, so getting them right
      // is what stops the panel visibly correcting itself a moment later — which
      // is why the two exemptions the server applies to a summary are mirrored
      // here rather than waited for.
      const isSummary = chapterAnchorId != null;
      const spoilerFree = !isArticle && !isSummary && data?.spoilerFree === true;
      const optimistic: AnnotationDetail = {
        id: clientId,
        anchor: resolved.anchor,
        anchorCharOffset: resolved.anchorCharOffset,
        anchorPage,
        spoilerFree,
        contextThroughPage: spoilerFree ? anchorPage : null,
        quotedText: resolved.quotedText,
        chapterAnchorId,
        note: null,
        // The column's default, and its only permitted value today.
        color: "yellow",
        modelPreference: isSummary ? "deep" : "fast",
        forkedFromAnnotationId: null,
        messageCount: 0,
        lastMessageAt: null,
        firstQuestion: null,
        createdAt: new Date().toISOString(),
        messages: [],
      };

      const result = createAnnotation({
        bookId,
        anchor: resolved.anchor,
        anchorCharOffset: resolved.anchorCharOffset,
        quotedText: resolved.quotedText,
        chapterAnchorId,
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
        // Anything typed in the meantime outranks the empty row the server made.
        setDetail((d) => (d && d.id === clientId ? { ...real, note: d.note ?? real.note } : d));
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
    [bookId, data, isArticle, memberEmail, openPanelWith, pageForCharOffset, refreshList]
  );

  /**
   * Closing a chat you never wrote in throws it away, so an abandoned draft
   * doesn't leave a marker in the margin. The row is created up front (the
   * anchor has to exist before there's anywhere to send to), so this is the
   * cleanup for it.
   *
   * Only ever the draft this interaction created: anything else on screen is an
   * annotation that already existed, and closing a panel is not a request to
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
  const closePanel = useCallback(() => {
    const closing = detail;
    const wasTouched = touched;
    const wasDraft = closing != null && closing.id === draftId;
    onPanelOpenChange(false);
    setDetail(null);
    setDraftId(null);
    if (!closing || wasTouched || !wasDraft) return;

    const pending = pendingRef.current;
    if (pending && pending.clientId === closing.id) {
      // The row doesn't exist yet, so there is nothing to discard and nothing to
      // race the insert with. Record it; the create's own continuation carries
      // it out once it knows the id — see openDraft.
      pending.onCreate = "discardIfEmpty";
      return;
    }
    void discardAnnotationIfEmpty(closing.id, memberEmail)
      .then((discarded) => {
        if (discarded) refreshList();
      })
      .catch(() => {});
  }, [detail, draftId, memberEmail, onPanelOpenChange, refreshList, touched]);

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
   * The conversation this page already has, if any.
   *
   * One page, one conversation: the control in the margin reopens this rather
   * than starting a second one a few paragraphs from the first. Anything more
   * specific is what selecting a passage is for.
   */
  const chatOnThisPage = useMemo(() => {
    if (!onPage) return null;
    return (
      chats
        .filter(
          (c) =>
            c.anchor?.kind === "between" &&
            c.anchor.blockIndex >= onPage.start &&
            c.anchor.blockIndex < onPage.end
        )
        .sort((a, b) => a.anchorCharOffset - b.anchorCharOffset)[0] ?? null
    );
  }, [chats, onPage]);

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

      // Notes and chats need somewhere to write, so they open the panel — and
      // they open it now, against a row that doesn't exist yet, rather than
      // after the round trip that creates it. See PendingCreate.
      //
      // "Note" deliberately does NOT pre-write an empty note. The row starts as
      // a highlight and becomes a note the moment you type something, so tapping
      // Note and changing your mind leaves a highlight rather than a blank entry
      // in the sidebar. Only "Ask" creates a discardable draft.
      if (intent !== "highlight") {
        openDraft(resolved, intent === "ask");
        return;
      }

      // Highlighting is a one-gesture action: mark it and keep reading. Nothing
      // opens, so there is nothing to be optimistic about — but it still holds
      // `busy` so the toolbar can't fire it twice.
      setBusy(true);
      const stopCreate = startTimer("annotate: server create");
      try {
        await createAnnotation({
          bookId,
          anchor: resolved.anchor,
          anchorCharOffset: resolved.anchorCharOffset,
          quotedText: resolved.quotedText,
          memberEmail,
        });
        stopCreate(intent);
        refreshList();
      } catch (err) {
        // `void annotateSelection(...)` means a throw here becomes an unhandled
        // rejection nobody sees, and the reader just watches their selection
        // vanish. Surface it.
        console.error("[reader] couldn't save that annotation", err);
      } finally {
        setBusy(false);
      }
    },
    [bookId, busy, contentRef, isCreating, memberEmail, openDraft, refreshList, space]
  );

  const openExisting = useCallback(
    async (chatId: string) => {
      const chat = await getAnnotation(chatId, memberEmail);
      if (chat) openPanelWith(chat);
    },
    [memberEmail, openPanelWith]
  );

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
   * Start — or reopen — the conversation about the visible page.
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
      if (chatOnThisPage) {
        void openExisting(chatOnThisPage.id);
        return;
      }
      startAtGap(onPage.breakIndex);
      return;
    }

    const els = blockElements(container);
    const found = els.findIndex((el) => el.getBoundingClientRect().top > READING_LINE);
    // Articles are never windowed, so a DOM index is already a global one.
    const blockIndex = found >= 0 ? found : els.length - 1;
    if (blockIndex < 0) return;
    const existing = chats.find(
      (c) => c.anchor?.kind === "between" && c.anchor.blockIndex === blockIndex
    );
    if (existing) {
      void openExisting(existing.id);
      return;
    }
    startAtGap(blockIndex);
  }, [
    busy,
    chatOnThisPage,
    chats,
    contentRef,
    isCreating,
    onPage,
    openExisting,
    startAtGap,
  ]);

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
      // A chapter title is quietly tappable, and opens the summary of the
      // chapter it names. Only the headings the CONTENTS lists: a converted book
      // also uses headings for front matter and part dividers, and neither of
      // those is a chapter anyone wants recapped. Nothing marks a title as
      // tappable on purpose — the page is a page, and a book that grew controls
      // under every chapter heading would stop reading like one.
      //
      // Books only, like every other splice: an article's offsets aren't in the
      // conversion char space the anchor would be recorded in.
      const heading = isArticle
        ? null
        : (e.target as HTMLElement | null)?.closest<HTMLElement>(".reader-heading");
      if (heading?.id && chapterIds.has(heading.id)) {
        openChapterSummary(heading.id);
        return;
      }
      // Articles keep real links. A click inside one is meant for the link, and
      // opening a panel on top of a navigation is the wrong answer to both.
      if ((e.target as HTMLElement | null)?.closest("a")) return;
      const hit = annotationAtPoint(chats, container, e.clientX, e.clientY, windowBase);
      if (hit) void openExisting(hit.id);
    };
    container.addEventListener("click", onClick);
    return () => container.removeEventListener("click", onClick);
  }, [
    chapterIds,
    chats,
    contentRef,
    isArticle,
    openChapterSummary,
    openExisting,
    windowBase,
  ]);

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

  // Which page the reader has reached, for the spoiler-free scoping and the
  // "you've read past this" note. Derived from where they are rather than from
  // page-anchor elements, which most books don't actually carry.
  const currentPage = useMemo(
    () => pageForCharOffset(currentCharOffset),
    [currentCharOffset, pageForCharOffset]
  );

  /** Synthetic page numbers mean nothing on screen — show progress instead. */
  const labelForPage = useCallback(
    (page: number) => {
      const mark = data?.pageMarks.find((m) => m.pageNumber === page);
      if (!mark || totalChars <= 0) return null;
      return `${Math.round((mark.charStart / totalChars) * 100)}%`;
    },
    [data, totalChars]
  );

  const forkHere = useCallback(async () => {
    // Forking references the annotation being forked FROM, so it needs a row
    // that exists. Unreachable in practice — the offer only appears once the
    // reader has read past the anchor — but a stand-in id must never be sent.
    if (!detail || isPendingId(detail.id)) return;
    const container = contentRef.current;
    if (!container) return;
    // Anchor the fork where the reader is now. Both modes report that as a
    // character offset, so this no longer has to know how the book is laid out.
    const resolved = anchorForGap(
      blockIndexForCharOffset(blocks, currentCharOffset),
      space,
      container
    );
    if (!resolved) return;
    const chat = await forkAnnotation({
      chatId: detail.id,
      anchor: resolved.anchor,
      anchorCharOffset: resolved.anchorCharOffset,
      memberEmail,
    });
    openPanelWith(chat, true);
    refreshList();
  }, [
    blocks,
    contentRef,
    currentCharOffset,
    detail,
    memberEmail,
    openPanelWith,
    refreshList,
    space,
  ]);

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

  const changeSpoilerFree = useCallback(
    async (next: boolean) => {
      setData((d) => (d ? { ...d, spoilerFree: next } : d));
      await setBookSpoilerFree(bookId, next, memberEmail);
    },
    [bookId, memberEmail]
  );

  const changeNote = useCallback(
    async (noteText: string | null) => {
      if (!detail) return;
      // Optimistic: the textarea already shows this, and a note that flickered
      // back to its old text on save would read as a lost edit.
      setDetail((d) => (d ? { ...d, note: noteText } : d));
      await onceCreated(detail.id, (id) => setAnnotationNote(id, noteText, memberEmail));
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

  return (
    <>
      <ReaderMarginControls
        onAsk={askHere}
        askActive={
          panelOpen && mode === "thread" && detail != null && detail.id === chatOnThisPage?.id
        }
        hasChatHere={chatOnThisPage != null}
        onOpenList={openList}
        listActive={panelOpen && mode === "list"}
      />
      <GutterMarkers
        rows={gutterRows}
        openAnnotationId={detail?.id ?? null}
        onOpen={(id) => void openExisting(id)}
      />
      <SelectionToolbar
        contentRef={contentRef}
        onAct={(range, intent) => void annotateSelection(range, intent)}
        disabled={busy}
      />
      <AnnotationPanel
        open={panelOpen}
        isMobile={asSheet}
        docked={docked}
        onClose={closePanel}
        // The list is a destination and stays put; only an untouched chat
        // draft behaves like a popover and gets out of your way.
        dismissOnOutsidePress={mode === "thread" && !touched}
      >
        {mode === "list" ? (
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
            dockToggle={dockToggle}
          />
        ) : (
          detail && (
          <AnnotationThread
            key={threadKey}
            chat={detail}
            chapterTitle={openChapterTitle}
            resolveChatId={realIdFor}
            createError={createError}
            memberEmail={memberEmail}
            bookSpoilerFree={data?.spoilerFree ?? false}
            isArticle={isArticle}
            hasRealPages={data?.hasRealPages ?? false}
            currentPage={currentPage}
            labelForPage={labelForPage}
            onJumpToPage={jumpToPage}
            onFork={() => void forkHere()}
            onDelete={() => void removeChat()}
            onClose={closePanel}
            onTouched={markTouched}
            // A sent message promotes a highlight to a chat, which changes both
            // its colour and whether it gets a margin icon. Refetch so the
            // change outlives the panel being open.
            onExchangeComplete={refreshList}
            onSpoilerFreeChange={(v) => void changeSpoilerFree(v)}
            onModelChange={(v) => void changeModel(v)}
            onNoteChange={(n) => void changeNote(n)}
            dockToggle={dockToggle}
          />
          )
        )}
      </AnnotationPanel>
    </>
  );
}
