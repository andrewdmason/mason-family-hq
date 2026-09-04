"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { blockElements } from "@/lib/reading/annotation-anchors";
import type { BookBlock } from "@/lib/reading/block-stream";
import type { InlineChatMark } from "@/lib/reading/inline-chat-blocks";
import {
  computeGeometry,
  PAGE_PAD_TOP,
  type ChatPanelPresentation,
} from "@/lib/reading/paged-geometry";
import { segmentsOf, windowFor, windowHolds, type BookWindow } from "@/lib/reading/paged-window";
import { note, startTimer } from "@/lib/reading/perf";
import { parallelWindowHtml, type PlainRenderState } from "@/lib/reading/plain/render";
import type { ReaderSettings } from "@/lib/reading/reader-settings";
import {
  getServerViewportSize,
  getViewportSize,
  subscribeViewport,
} from "@/lib/reading/viewport-size";

/**
 * Paging a parallel text: the book on the left, its translation on the right,
 * paragraph beside paragraph.
 *
 * The ordinary paged reader fragments the book into CSS columns and turns a
 * page by sliding sideways. That cannot hold two texts level — each column
 * breaks where its own words run out. So this lays the window out as ROWS: a
 * grid two columns wide in which every paragraph and its translation share a
 * row, headings span both, and a page is as many whole rows as fit the height.
 * Turning a page slides the grid UP.
 *
 * Everything the reader stores is unchanged. The left cells are the book's own
 * block elements, in order, so `blockElements(flow)` still counts exactly the
 * original blocks and every anchor resolves; the translation cells are
 * `<aside>`s the block selector never sees. Position is the character at the
 * top of the page — the first row's block, or a proportional point inside a
 * row too tall for a page, which is split at the same pixel on both sides.
 *
 * Deliberately simpler than use-pagination.ts. There is no column strip to
 * keep un-fragmented, so a relayout here is a grid reflow of a few chapters,
 * which is cheap enough not to need the box-fitting and font-metric tricks the
 * column engine earns its complexity with.
 */

export type ParallelGeometry = {
  /** Left edge of the spread within the window. */
  offsetX: number;
  top: number;
  /** Width of the whole spread: two columns and the gap. */
  width: number;
  colW: number;
  gap: number;
  pageH: number;
};

export type ParallelPagination = {
  geometry: ParallelGeometry | null;
  html: string | null;
  windowBase: number;
  pageIndex: number;
  totalPages: number;
  /**
   * How tall the current page is. A page ends where its last whole line does,
   * which is at or before the page height — never inside a line.
   */
  pageHeight: number;
  charOffset: number;
  charEnd: number;
  atStart: boolean;
  atEnd: boolean;
  goToChar: (charOffset: number) => void;
  goToPage: (page: number) => void;
  next: () => void;
  prev: () => void;
  layoutNonce: number;
};

type Row = { top: number; height: number };

export function useParallelPagination({
  enabled,
  html,
  flowRef,
  blocks,
  inlineMarks,
  plain,
  settings,
  chatPanel,
  bottomInset = 0,
  charOffset: externalCharOffset,
  onPositionChange,
}: {
  enabled: boolean;
  html: string | null;
  flowRef: React.RefObject<HTMLDivElement | null>;
  blocks: BookBlock[];
  inlineMarks: InlineChatMark[];
  /** The translation to lay beside the text. Null renders empty right cells. */
  plain: PlainRenderState | null;
  settings: ReaderSettings;
  chatPanel: ChatPanelPresentation;
  bottomInset?: number;
  charOffset: number;
  onPositionChange: (charOffset: number, atEnd: boolean) => void;
}): ParallelPagination {
  const viewport = useSyncExternalStore(
    subscribeViewport,
    getViewportSize,
    getServerViewportSize
  );
  const [pageIndex, setPageIndex] = useState(0);
  /** Where the pages start, in pixels down the grid. Mirrors pagesRef for render. */
  const [pages, setPages] = useState<number[]>([0]);
  const [windowChar, setWindowChar] = useState(externalCharOffset);
  const [charOffset, setCharOffset] = useState(externalCharOffset);
  const [charEnd, setCharEnd] = useState(externalCharOffset);
  const [layoutNonce, setLayoutNonce] = useState(0);
  const [revision, setRevision] = useState(0);

  const segments = useMemo(() => segmentsOf(blocks), [blocks]);
  const centre = enabled ? windowChar : externalCharOffset;
  const win = useMemo<BookWindow | null>(
    () => (html == null || segments.length === 0 ? null : windowFor(segments, centre)),
    [html, segments, centre]
  );
  const windowBlocks = useMemo(
    () => (win ? blocks.slice(win.startBlock, win.endBlock) : blocks),
    [blocks, win]
  );
  const renderedHtml = useMemo(
    () => (html != null && win ? parallelWindowHtml(html, blocks, win, inlineMarks, plain) : null),
    [html, blocks, win, inlineMarks, plain]
  );

  // The same arithmetic as the column engine, so the spread sits exactly where
  // the two-column page would have. Only meaningful when two columns fit; the
  // caller does not enable this otherwise.
  const geometry = useMemo<ParallelGeometry | null>(() => {
    if (!enabled || html == null || viewport.width === 0 || viewport.height === 0) return null;
    const g = computeGeometry(
      viewport.width,
      Math.max(200, viewport.height - bottomInset),
      settings,
      chatPanel
    );
    return {
      offsetX: g.offsetX,
      top: PAGE_PAD_TOP,
      width: g.colW * 2 + g.gap,
      colW: g.colW,
      gap: g.gap,
      pageH: g.pageH,
    };
  }, [bottomInset, chatPanel, enabled, html, settings, viewport]);

  const charRef = useRef(externalCharOffset);
  const pageRef = useRef(0);
  const pagesRef = useRef<number[]>([0]);
  const rowsRef = useRef<Row[]>([]);
  const heightRef = useRef(0);

  useEffect(() => {
    if (!enabled) charRef.current = externalCharOffset;
  }, [enabled, externalCharOffset]);

  /** The character at a pixel offset down the grid. */
  const charAt = useCallback(
    (y: number): number => {
      const rows = rowsRef.current;
      if (rows.length === 0 || windowBlocks.length === 0) return windowBlocks[0]?.charStart ?? 0;
      let lo = 0;
      let hi = rows.length - 1;
      let found = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (rows[mid].top <= y + 0.5) {
          found = mid;
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }
      if (found < 0) return windowBlocks[0].charStart;
      const block = windowBlocks[found];
      const row = rows[found];
      if (y <= row.top + 0.5 || row.height <= 0) return block.charStart;
      // Inside a row too tall for a page: the same fraction of the text as of
      // the pixels, which is exactly where the split falls on both sides.
      const frac = Math.min(1, (y - row.top) / row.height);
      return block.charStart + Math.min(block.text.length, Math.round(frac * block.text.length));
    },
    [windowBlocks]
  );

  /** The page whose top is at or before the pixel a character sits at. */
  const pageForChar = useCallback(
    (target: number): number => {
      const rows = rowsRef.current;
      const pages = pagesRef.current;
      if (rows.length === 0 || windowBlocks.length === 0) return 0;
      let idx = 0;
      for (let i = 0; i < windowBlocks.length; i++) {
        if (windowBlocks[i].charStart <= target) idx = i;
        else break;
      }
      const block = windowBlocks[idx];
      const row = rows[idx];
      const frac = block.text.length > 0 ? Math.min(1, (target - block.charStart) / block.text.length) : 0;
      const y = row.top + frac * row.height;
      let page = 0;
      for (let i = 0; i < pages.length; i++) {
        if (pages[i] <= y + 0.5) page = i;
        else break;
      }
      return page;
    },
    [windowBlocks]
  );

  const paint = useCallback(
    (page: number) => {
      const flow = flowRef.current;
      if (!flow) return;
      const y = pagesRef.current[page] ?? 0;
      flow.style.transform = `translate3d(0, ${-y}px, 0)`;
    },
    [flowRef]
  );

  const goToPage = useCallback(
    (page: number) => {
      const stopTurn = startTimer("turn (parallel)");
      const total = pagesRef.current.length;
      const next = Math.min(Math.max(0, page), Math.max(0, total - 1));
      pageRef.current = next;
      paint(next);
      setPageIndex(next);
      const char = charAt(pagesRef.current[next] ?? 0);
      charRef.current = char;
      setCharOffset(char);
      setCharEnd(next + 1 < total ? charAt(pagesRef.current[next + 1]) : (win?.charEnd ?? char));
      const lastWindow = !win || win.endBlock >= blocks.length;
      onPositionChange(char, lastWindow && next >= total - 1);
      stopTurn(`p${next}`);
    },
    [blocks.length, charAt, onPositionChange, paint, win]
  );

  const goToChar = useCallback(
    (target: number) => {
      if (win && !windowHolds(win, target)) {
        charRef.current = target;
        note("window (parallel)", `to char ${target}`);
        setWindowChar(target);
        return;
      }
      if (rowsRef.current.length === 0) {
        charRef.current = target;
        return;
      }
      goToPage(pageForChar(target));
    },
    [goToPage, pageForChar, win]
  );

  const next = useCallback(() => {
    if (win && pageRef.current >= pagesRef.current.length - 1 && win.endBlock < blocks.length) {
      goToChar(win.charEnd);
      return;
    }
    goToPage(pageRef.current + 1);
  }, [blocks.length, goToChar, goToPage, win]);

  const prev = useCallback(() => {
    if (win && pageRef.current <= 0 && win.startBlock > 0) {
      goToChar(Math.max(0, win.charStart - 1));
      return;
    }
    goToPage(pageRef.current - 1);
  }, [goToChar, goToPage, win]);

  /**
   * Lay the window out and cut it into pages.
   *
   * Break candidates are the tops of every direct child that begins a row — a
   * paragraph and its translation share one, a heading or a chat mark has its
   * own. A page ends at the last candidate that still fits; a row taller than
   * the page is split at the page height and continues on the next.
   */
  const pagingKey = `${geometry?.colW}:${geometry?.gap}:${geometry?.pageH}:${geometry?.offsetX}:${settings.fontStep}:${settings.leading}:${settings.align}`;
  useLayoutEffect(() => {
    if (!enabled || renderedHtml == null || !geometry) return;
    const flow = flowRef.current;
    if (!flow) return;

    const stop = startTimer("layout (parallel)");
    const els = blockElements(flow);
    rowsRef.current = els.map((el) => ({ top: el.offsetTop, height: el.offsetHeight }));
    const total = flow.scrollHeight;
    heightRef.current = total;

    // Every row's top, and whether the row may be split across pages. A
    // paragraph row may; a heading, a chat mark or a page anchor is pushed whole.
    const rowStarts = new Map<number, boolean>();
    for (const child of Array.from(flow.children)) {
      const el = child as HTMLElement;
      const top = el.offsetTop;
      const splittable = el.tagName === "P";
      rowStarts.set(top, (rowStarts.get(top) ?? false) || splittable);
    }
    const tops = Array.from(rowStarts.keys()).sort((a, b) => a - b);

    // A paragraph and its translation share the flow's line height and start
    // at the row's top, so their line grids coincide: a cut a whole number of
    // lines below the row's top leaves every line whole on both sides.
    const lineH =
      parseFloat(getComputedStyle(flow).lineHeight) ||
      parseFloat(getComputedStyle(flow).fontSize) * 1.75 ||
      24;

    /**
     * Where the page starting at `y` ends. The page is filled: the row the page
     * height falls inside is split on a line boundary when at least two of its
     * lines fit, otherwise it goes whole to the next page — the way a printed
     * page avoids an orphaned line without leaving half a page blank.
     */
    const pageEnd = (y: number): number => {
      const limit = y + geometry.pageH;
      if (limit >= total) return total;
      let rowTop = 0;
      let rowNext = total;
      for (let i = 0; i < tops.length; i++) {
        if (tops[i] <= limit) {
          rowTop = tops[i];
          rowNext = tops[i + 1] ?? total;
        } else break;
      }
      // The limit falls in the gap after a row: the next row starts the page.
      if (rowNext <= limit) return rowNext;
      const splittable = rowStarts.get(rowTop) ?? false;
      const from = Math.max(rowTop, y);
      const linesFit = Math.floor((limit - rowTop) / lineH);
      const startLine = Math.ceil((from - rowTop) / lineH);
      const canSplit = splittable && linesFit - startLine >= 2;
      if (canSplit) {
        const snapped = rowTop + linesFit * lineH;
        if (snapped > y + lineH / 2) return snapped;
      }
      // Push the row whole — unless it began on or above this page's top, in
      // which case there is nothing above it to fill the page with.
      if (rowTop > y + lineH / 2) return rowTop;
      return Math.min(total, Math.max(y + lineH, rowTop + Math.max(1, linesFit) * lineH));
    };

    const cut: number[] = [];
    let y = 0;
    let guard = 0;
    while (y < total && guard++ < 10_000) {
      cut.push(y);
      const end = pageEnd(y);
      y = end > y ? end : y + geometry.pageH;
    }
    if (cut.length === 0) cut.push(0);
    pagesRef.current = cut;
    // Synchronising React state with a DOM measurement, which is what a layout
    // effect is for; the lint cannot see that `cut` came from the flow's boxes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPages(cut);

    const page = Math.min(pageForChar(charRef.current), cut.length - 1);
    pageRef.current = page;
    paint(page);
    setPageIndex(page);
    const char = charAt(cut[page]);
    charRef.current = char;
    setCharOffset(char);
    setCharEnd(page + 1 < cut.length ? charAt(cut[page + 1]) : (win?.charEnd ?? char));
    setLayoutNonce((n) => n + 1);
    stop(`${cut.length}pp → p${page}`);
  }, [charAt, enabled, flowRef, geometry, pageForChar, pagingKey, paint, renderedHtml, revision, win]);

  // Web fonts arriving late move every row. One re-measure when they settle.
  useEffect(() => {
    if (!enabled || html == null) return;
    let cancelled = false;
    void document.fonts?.ready.then(() => {
      if (cancelled) return;
      const flow = flowRef.current;
      if (flow && flow.scrollHeight !== heightRef.current) setRevision((n) => n + 1);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, flowRef, html]);

  const lastWindow = !win || win.endBlock >= blocks.length;
  const firstWindow = !win || win.startBlock === 0;
  const totalPages = pages.length;
  const pageHeight = geometry
    ? Math.min(geometry.pageH, (pages[pageIndex + 1] ?? Infinity) - (pages[pageIndex] ?? 0))
    : 0;

  return {
    geometry,
    html: enabled ? renderedHtml : null,
    windowBase: win?.startBlock ?? 0,
    pageIndex,
    totalPages,
    pageHeight,
    charOffset,
    charEnd,
    atStart: firstWindow && pageIndex === 0,
    atEnd: lastWindow && pageIndex >= totalPages - 1,
    goToChar,
    goToPage,
    next,
    prev,
    layoutNonce,
  };
}
