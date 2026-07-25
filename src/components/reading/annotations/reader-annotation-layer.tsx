"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
import { blockIndexForCharOffset, blockMap } from "@/lib/reading/block-stream";
import {
  anchorForGap,
  anchorFromRange,
  blockElements,
  type AnchorSpace,
} from "@/lib/reading/annotation-anchors";
import type {
  ReaderAnnotationData,
  AnnotationDetail,
  ReaderChatModelPreference,
} from "@/lib/reading/annotation-types";
import { AnnotationPanel } from "./annotation-panel";
import { AnnotationList } from "./annotation-list";
import { AnnotationsButton } from "./annotations-button";
import { AnnotationThread } from "./annotation-thread";
import { GutterMarkers } from "./gutter-markers";
import { useGutterPlacement } from "./gutter-placement";
import { ParagraphHoverTarget } from "./paragraph-hover-target";
import { SelectionToolbar, type SelectionIntent } from "./selection-toolbar";
import { annotationAtPoint, useAnnotationHighlights } from "./use-annotation-highlights";

/** Must match book-reader.tsx's reading line. */
const READING_LINE_OFFSET = 72;

/**
 * Owns reader chat: loads the anchored chats for a book, renders the two ways to
 * start one and the markers that reopen them, and hosts the panel.
 *
 * Everything positional is computed from the book HTML the reader already
 * fetched (see block-stream.ts), so anchors resolve without measuring text.
 */
export function ReaderAnnotationLayer({
  bookId,
  memberEmail,
  html,
  isArticle,
  contentRef,
  currentPage,
  scrollToAnchor,
  panelOpen,
  onPanelOpenChange,
  layoutNonce,
}: {
  bookId: string;
  memberEmail: string | null;
  html: string;
  /** Articles have no page map and no conversion char space — see AnchorSpace. */
  isArticle: boolean;
  contentRef: React.RefObject<HTMLDivElement | null>;
  currentPage: number | null;
  scrollToAnchor: (anchorId: string) => void;
  panelOpen: boolean;
  onPanelOpenChange: (open: boolean) => void;
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

  // Articles never touch the conversion char space: their HTML was never run
  // through convert.ts, so blockMap would be measuring a stream that doesn't
  // exist. Skipping it also avoids scanning the whole document on every load.
  const blocks = useMemo(() => (isArticle ? [] : blockMap(html)), [html, isArticle]);
  const space = useMemo<AnchorSpace>(
    () => (isArticle ? { kind: "dom" } : { kind: "book", blocks }),
    [isArticle, blocks]
  );
  // Memoized, not `data?.chats ?? []`: a fresh array literal every render would
  // re-run the placement effect, which sets state, which renders again — a loop.
  const chats = useMemo(() => data?.chats ?? [], [data]);
  // One placement pass shared by the markers and the hover target, so they
  // stack in the same column instead of landing on each other.
  const gutterRows = useGutterPlacement(chats, contentRef, layoutNonce);
  // Passages with a chat on them stay marked in the text.
  useAnnotationHighlights(chats, contentRef, detail?.id ?? null, layoutNonce);
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
      onPanelOpenChange(true);
    },
    [onPanelOpenChange]
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
    void discardAnnotationIfEmpty(closing.id, memberEmail)
      .then((discarded) => {
        if (discarded) refreshList();
      })
      .catch(() => {});
  }, [detail, draftId, memberEmail, onPanelOpenChange, refreshList, touched]);

  const startAtGap = useCallback(
    async (blockIndex: number) => {
      const container = contentRef.current;
      if (!container || busy) return;
      const resolved = anchorForGap(blockIndex, space, container);
      if (!resolved) return;
      setBusy(true);
      try {
        const chat = await createAnnotation({
          bookId,
          anchor: resolved.anchor,
          anchorCharOffset: resolved.anchorCharOffset,
          memberEmail,
        });
        openPanelWith(chat, true);
        refreshList();
      } finally {
        setBusy(false);
      }
    },
    [bookId, busy, contentRef, memberEmail, openPanelWith, refreshList, space]
  );

  /**
   * The three things a selection can become. They differ only in what the row
   * starts with and whether the panel opens — it is one annotation either way,
   * and any of them can grow into any other later.
   */
  const annotateSelection = useCallback(
    async (range: Range, intent: SelectionIntent) => {
      const container = contentRef.current;
      if (!container || busy) return;
      const resolved = anchorFromRange(range, container, space);
      if (!resolved) return;
      setBusy(true);
      try {
        const annotation = await createAnnotation({
          bookId,
          anchor: resolved.anchor,
          anchorCharOffset: resolved.anchorCharOffset,
          quotedText: resolved.quotedText,
          memberEmail,
        });
        // Highlighting is a one-gesture action: mark it and keep reading. Notes
        // and chats need somewhere to write, so they open the panel.
        //
        // "Note" deliberately does NOT pre-write an empty note. The row starts
        // as a highlight and becomes a note the moment you type something, so
        // tapping Note and changing your mind leaves a highlight rather than a
        // blank entry in the sidebar. Only "Ask" creates a discardable draft.
        if (intent !== "highlight") openPanelWith(annotation, intent === "ask");
        refreshList();
      } finally {
        setBusy(false);
      }
    },
    [bookId, busy, contentRef, memberEmail, openPanelWith, refreshList, space]
  );

  const openExisting = useCallback(
    async (chatId: string) => {
      const chat = await getAnnotation(chatId, memberEmail);
      if (chat) openPanelWith(chat);
    },
    [memberEmail, openPanelWith]
  );

  // Clicking a highlighted passage opens its chat — the highlight should be the
  // affordance, not just a colour. Ignored while a selection is live, so this
  // never hijacks the click that finishes selecting text.
  useEffect(() => {
    const container = contentRef.current;
    if (!container) return;
    const onClick = (e: MouseEvent) => {
      const selection = window.getSelection();
      if (selection && !selection.isCollapsed) return;
      // Articles keep real links. A click inside one is meant for the link, and
      // opening a panel on top of a navigation is the wrong answer to both.
      if ((e.target as HTMLElement | null)?.closest("a")) return;
      const hit = annotationAtPoint(chats, container, e.clientX, e.clientY);
      if (hit) void openExisting(hit.id);
    };
    container.addEventListener("click", onClick);
    return () => container.removeEventListener("click", onClick);
  }, [chats, contentRef, openExisting]);

  // A citation cites a page, but most books have no page-N element in the DOM
  // (verified: even books flagged has_real_pages carry none). So try the anchor,
  // then fall back to the page's character offset, which always resolves.
  const jumpToPage = useCallback(
    (page: number) => {
      if (document.getElementById(`page-${page}`)) {
        scrollToAnchor(`page-${page}`);
        return;
      }
      const mark = data?.pageMarks.find((m) => m.pageNumber === page);
      const container = contentRef.current;
      if (!mark || !container) return;
      const el = blockElements(container)[
        blockIndexForCharOffset(blocks, mark.charStart)
      ];
      if (!el) return;
      window.scrollTo({
        top: el.getBoundingClientRect().top + window.scrollY - READING_LINE_OFFSET,
      });
    },
    [blocks, contentRef, data, scrollToAnchor]
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
    if (!detail) return;
    const container = contentRef.current;
    if (!container) return;
    // Anchor the fork where the reader is now: the block at the reading line.
    const els = blockElements(container);
    const line = window.scrollY + READING_LINE_OFFSET;
    let idx = 0;
    for (let i = 0; i < els.length; i++) {
      if (els[i].getBoundingClientRect().top + window.scrollY <= line) idx = i;
      else break;
    }
    const resolved = anchorForGap(idx, space, container);
    if (!resolved) return;
    const chat = await forkAnnotation({
      chatId: detail.id,
      anchor: resolved.anchor,
      anchorCharOffset: resolved.anchorCharOffset,
      memberEmail,
    });
    openPanelWith(chat, true);
    refreshList();
  }, [contentRef, detail, memberEmail, openPanelWith, refreshList, space]);

  // Deletes outright rather than going through closePanel, which would then
  // also try to discard the row it just removed.
  const removeChat = useCallback(async () => {
    if (!detail) return;
    const id = detail.id;
    onPanelOpenChange(false);
    setDetail(null);
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
    async (note: string | null) => {
      if (!detail) return;
      // Optimistic: the textarea already shows this, and a note that flickered
      // back to its old text on save would read as a lost edit.
      setDetail((d) => (d ? { ...d, note } : d));
      await setAnnotationNote(detail.id, note, memberEmail);
      refreshList();
    },
    [detail, memberEmail, refreshList]
  );

  const changeModel = useCallback(
    async (next: ReaderChatModelPreference) => {
      if (!detail) return;
      setDetail((d) => (d ? { ...d, modelPreference: next } : d));
      await setAnnotationModelPreference(detail.id, next, memberEmail);
    },
    [detail, memberEmail]
  );

  return (
    <>
      <AnnotationsButton
        onClick={openList}
        active={panelOpen && mode === "list"}
      />
      <GutterMarkers
        rows={gutterRows}
        openAnnotationId={detail?.id ?? null}
        onOpen={(id) => void openExisting(id)}
      />
      <ParagraphHoverTarget
        contentRef={contentRef}
        onStart={(i) => void startAtGap(i)}
        layoutNonce={layoutNonce}
        disabled={busy}
      />
      <SelectionToolbar
        contentRef={contentRef}
        onAct={(range, intent) => void annotateSelection(range, intent)}
        disabled={busy}
      />
      <AnnotationPanel
        open={panelOpen}
        isMobile={isMobile}
        onClose={closePanel}
        // The list is a destination and stays put; only an untouched chat
        // draft behaves like a popover and gets out of your way.
        dismissOnOutsidePress={mode === "thread" && !touched}
      >
        {mode === "list" ? (
          <AnnotationList
            annotations={chats}
            openAnnotationId={detail?.id ?? null}
            hasRealPages={data?.hasRealPages ?? false}
            onOpen={(id) => void openExisting(id)}
            onClose={closePanel}
          />
        ) : (
          detail && (
          <AnnotationThread
            key={detail.id}
            chat={detail}
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
            onTouched={() => setTouched(true)}
            onSpoilerFreeChange={(v) => void changeSpoilerFree(v)}
            onModelChange={(v) => void changeModel(v)}
            onNoteChange={(n) => void changeNote(n)}
          />
          )
        )}
      </AnnotationPanel>
    </>
  );
}
