"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createReaderChat,
  deleteReaderChat,
  discardReaderChatIfEmpty,
  forkReaderChat,
  getReaderChat,
  getReaderChatData,
  setBookSpoilerFree,
  setChatModelPreference,
} from "@/app/(reading)/reader/chat-actions";
import { blockIndexForCharOffset, blockMap } from "@/lib/reading/block-stream";
import {
  anchorForGap,
  anchorFromRange,
  blockElements,
} from "@/lib/reading/chat-anchors";
import type {
  ReaderChatData,
  ReaderChatDetail,
  ReaderChatModelPreference,
} from "@/lib/reading/chat-types";
import { ChatPanel } from "./chat-panel";
import { ChatThread } from "./chat-thread";
import { GutterMarkers } from "./gutter-markers";
import { useGutterPlacement } from "./gutter-placement";
import { ParagraphHoverTarget } from "./paragraph-hover-target";
import { SelectionToolbar } from "./selection-toolbar";
import { chatAtPoint, useChatHighlights } from "./use-chat-highlights";

/** Must match book-reader.tsx's reading line. */
const READING_LINE_OFFSET = 72;

/**
 * Owns reader chat: loads the anchored chats for a book, renders the two ways to
 * start one and the markers that reopen them, and hosts the panel.
 *
 * Everything positional is computed from the book HTML the reader already
 * fetched (see block-stream.ts), so anchors resolve without measuring text.
 */
export function ReaderChatLayer({
  bookId,
  memberEmail,
  html,
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
  contentRef: React.RefObject<HTMLDivElement | null>;
  currentPage: number | null;
  scrollToAnchor: (anchorId: string) => void;
  panelOpen: boolean;
  onPanelOpenChange: (open: boolean) => void;
  layoutNonce: number;
}) {
  const [data, setData] = useState<ReaderChatData | null>(null);
  const [detail, setDetail] = useState<ReaderChatDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  // Whether anything has been sent in the open chat. Drives both the discard on
  // close and whether clicking back into the book dismisses the panel.
  const [touched, setTouched] = useState(false);

  const blocks = useMemo(() => blockMap(html), [html]);
  // Memoized, not `data?.chats ?? []`: a fresh array literal every render would
  // re-run the placement effect, which sets state, which renders again — a loop.
  const chats = useMemo(() => data?.chats ?? [], [data]);
  // One placement pass shared by the markers and the hover target, so they
  // stack in the same column instead of landing on each other.
  const gutterRows = useGutterPlacement(chats, contentRef, layoutNonce);
  // Passages with a chat on them stay marked in the text.
  useChatHighlights(chats, contentRef, detail?.id ?? null, layoutNonce);
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
    void getReaderChatData(bookId, memberEmail)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [bookId, memberEmail]);

  const refreshList = useCallback(() => {
    void getReaderChatData(bookId, memberEmail)
      .then(setData)
      .catch(() => {});
  }, [bookId, memberEmail]);

  const openPanelWith = useCallback(
    (chat: ReaderChatDetail) => {
      setDetail(chat);
      // A chat opened with an empty transcript is a draft until something is
      // sent — see closePanel.
      setTouched(chat.messages.length > 0);
      onPanelOpenChange(true);
    },
    [onPanelOpenChange]
  );

  /**
   * Closing a chat you never wrote in throws it away, so an abandoned draft
   * doesn't leave a marker in the margin. The row is created up front (the
   * anchor has to exist before there's anywhere to send to), so this is the
   * cleanup for it; the server re-checks emptiness before deleting.
   */
  const closePanel = useCallback(() => {
    const closing = detail;
    const wasTouched = touched;
    onPanelOpenChange(false);
    setDetail(null);
    if (!closing || wasTouched) return;
    void discardReaderChatIfEmpty(closing.id, memberEmail)
      .then((discarded) => {
        if (discarded) refreshList();
      })
      .catch(() => {});
  }, [detail, memberEmail, onPanelOpenChange, refreshList, touched]);

  const startAtGap = useCallback(
    async (blockIndex: number) => {
      if (busy) return;
      const resolved = anchorForGap(blockIndex, blocks);
      if (!resolved) return;
      setBusy(true);
      try {
        const chat = await createReaderChat({
          bookId,
          anchor: resolved.anchor,
          anchorCharOffset: resolved.anchorCharOffset,
          memberEmail,
        });
        openPanelWith(chat);
        refreshList();
      } finally {
        setBusy(false);
      }
    },
    [blocks, bookId, busy, memberEmail, openPanelWith, refreshList]
  );

  const startFromSelection = useCallback(
    async (range: Range) => {
      const container = contentRef.current;
      if (!container || busy) return;
      const resolved = anchorFromRange(range, container, blocks);
      if (!resolved) return;
      setBusy(true);
      try {
        const chat = await createReaderChat({
          bookId,
          anchor: resolved.anchor,
          anchorCharOffset: resolved.anchorCharOffset,
          quotedText: resolved.quotedText,
          memberEmail,
        });
        openPanelWith(chat);
        refreshList();
      } finally {
        setBusy(false);
      }
    },
    [blocks, bookId, busy, contentRef, memberEmail, openPanelWith, refreshList]
  );

  const openExisting = useCallback(
    async (chatId: string) => {
      const chat = await getReaderChat(chatId, memberEmail);
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
      const hit = chatAtPoint(chats, container, e.clientX, e.clientY);
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
    const resolved = anchorForGap(idx, blocks);
    if (!resolved) return;
    const chat = await forkReaderChat({
      chatId: detail.id,
      anchor: resolved.anchor,
      anchorCharOffset: resolved.anchorCharOffset,
      memberEmail,
    });
    openPanelWith(chat);
    refreshList();
  }, [blocks, contentRef, detail, memberEmail, openPanelWith, refreshList]);

  // Deletes outright rather than going through closePanel, which would then
  // also try to discard the row it just removed.
  const removeChat = useCallback(async () => {
    if (!detail) return;
    const id = detail.id;
    onPanelOpenChange(false);
    setDetail(null);
    await deleteReaderChat(id, memberEmail);
    refreshList();
  }, [detail, memberEmail, onPanelOpenChange, refreshList]);

  const changeSpoilerFree = useCallback(
    async (next: boolean) => {
      setData((d) => (d ? { ...d, spoilerFree: next } : d));
      await setBookSpoilerFree(bookId, next, memberEmail);
    },
    [bookId, memberEmail]
  );

  const changeModel = useCallback(
    async (next: ReaderChatModelPreference) => {
      if (!detail) return;
      setDetail((d) => (d ? { ...d, modelPreference: next } : d));
      await setChatModelPreference(detail.id, next, memberEmail);
    },
    [detail, memberEmail]
  );

  return (
    <>
      <GutterMarkers
        rows={gutterRows}
        openChatId={detail?.id ?? null}
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
        onStart={(r) => void startFromSelection(r)}
        disabled={busy}
      />
      <ChatPanel
        open={panelOpen}
        isMobile={isMobile}
        onClose={closePanel}
        dismissOnOutsidePress={!touched}
      >
        {detail && (
          <ChatThread
            key={detail.id}
            chat={detail}
            memberEmail={memberEmail}
            bookSpoilerFree={data?.spoilerFree ?? false}
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
          />
        )}
      </ChatPanel>
    </>
  );
}
