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
import type { BookBlock } from "@/lib/reading/block-stream";
import { blockElements } from "@/lib/reading/annotation-anchors";
import {
  computeGeometry,
  type ChatPanelPresentation,
  type PageGeometry,
} from "@/lib/reading/paged-geometry";
import {
  segmentsOf,
  windowFor,
  windowHolds,
  windowHtml,
  type BookWindow,
} from "@/lib/reading/paged-window";
import {
  getServerViewportSize,
  getViewportSize,
  subscribeViewport,
} from "@/lib/reading/viewport-size";
import {
  assertPagesMoveForward,
  charOffsetAtTopOfPage,
  countPages,
  pageForCharOffset,
  type MeasureCtx,
} from "@/lib/reading/paged-position";
import type { ReaderSettings } from "@/lib/reading/reader-settings";
import { note, startTimer } from "@/lib/reading/perf";

/**
 * The paging engine: owns the geometry, the repagination lifecycle, and which
 * page is showing.
 *
 * The whole book is laid out once as one multi-column flow, and a page turn is
 * just a horizontal translate of that flow — no relayout, no scrolling, nothing
 * to wait for. Relayout only happens when something about the layout itself
 * changes (font, margins, columns, window size, the chat panel opening), and
 * every one of those follows the same three steps: remember the character at the
 * top of the page, let the browser re-fragment the text, then find that
 * character again and jump to whatever page it landed on.
 *
 * That's the whole trick to never losing your place. Position is a character
 * offset; pages are just where the characters happen to be right now.
 */

export type Pagination = {
  geometry: PageGeometry | null;
  /**
   * The markup to render: a few chapters of the book, not all of it. Null until
   * the book has loaded or while paging is off.
   */
  html: string | null;
  /** Global index of the first rendered block — see RenderedBlocks. */
  windowBase: number;
  pageIndex: number;
  totalPages: number;
  /** Character at the top of the current page — the thing worth persisting. */
  charOffset: number;
  /** First character past the bottom of the page, for "what's visible here". */
  charEnd: number;
  /** At the last page of the LAST window — the end of the book, not of a window. */
  atEnd: boolean;
  /** At the first page of the first window. */
  atStart: boolean;
  goToChar: (charOffset: number) => void;
  goToPage: (page: number) => void;
  next: () => void;
  prev: () => void;
  /** Bumped after every repagination, so overlays re-measure. */
  layoutNonce: number;
};

export function usePagination({
  enabled,
  html,
  flowRef,
  blocks,
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
  settings: ReaderSettings;
  /** How the chat is presented, which decides what it costs — see ChatPanelPresentation. */
  chatPanel: ChatPanelPresentation;
  /**
   * Height at the foot of the window the page may not use — the audiobook
   * player bar, when something is playing.
   *
   * The page shrinks from the bottom rather than the bar covering it, so the
   * running foot stays visible and no line of text ends up underneath a
   * control. Changing it repaginates once, which is the same cost as changing
   * the Margins setting and happens at the same moment you deliberately started
   * listening.
   */
  bottomInset?: number;
  /**
   * Where the reader is, owned by the caller. While paging is on this hook
   * drives it; while it's off the scrolling view does, and we track it so
   * turning paging on opens where they were reading rather than where they
   * opened the book.
   */
  charOffset: number;
  /** Called whenever the reader lands on a new page. Must be stable. */
  onPositionChange: (charOffset: number, atEnd: boolean) => void;
}): Pagination {
  const viewport = useSyncExternalStore(
    subscribeViewport,
    getViewportSize,
    getServerViewportSize
  );
  const [pageIndex, setPageIndex] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  /**
   * The character the rendered window is chosen around.
   *
   * Deliberately NOT the reading position. Turning pages moves the reader freely
   * inside the window and this doesn't move at all, so the book is re-laid-out
   * only when they actually leave it — about once every couple of chapters —
   * rather than at every chapter boundary. It is also why the two-column spread
   * can't re-pair underneath a reader who hasn't asked to go anywhere.
   */
  const [windowChar, setWindowChar] = useState(externalCharOffset);
  const [charOffset, setCharOffset] = useState(externalCharOffset);
  const [charEnd, setCharEnd] = useState(externalCharOffset);
  const [layoutNonce, setLayoutNonce] = useState(0);
  // Bumped when something outside our control changed the metrics (web fonts).
  const [revision, setRevision] = useState(0);

  const segments = useMemo(() => segmentsOf(blocks), [blocks]);
  // While paging is off the scrolling view owns the position, so the window
  // follows it — switching paging on then opens the chapter they were reading.
  const centre = enabled ? windowChar : externalCharOffset;
  const win = useMemo<BookWindow | null>(
    () => (html == null || segments.length === 0 ? null : windowFor(segments, centre)),
    [html, segments, centre]
  );
  /** The window's own blocks, index-parallel with what's in the DOM. */
  const windowBlocks = useMemo(
    () => (win ? blocks.slice(win.startBlock, win.endBlock) : blocks),
    [blocks, win]
  );
  const renderedHtml = useMemo(
    () => (html != null && win ? windowHtml(html, blocks, win) : null),
    [html, blocks, win]
  );

  const geometryRef = useRef<PageGeometry | null>(null);
  const charRef = useRef(externalCharOffset);
  const totalRef = useRef(1);
  const pageRef = useRef(0);
  // Width of the fragmented strip as of the last repagination. Only read to
  // decide whether a late web font actually changed anything — see below.
  const stripWidthRef = useRef(-1);

  // While paging is off, the scrolling view is the one moving; keep the
  // character we'd repaginate around in step with it, so switching paging on
  // opens where they were reading. Layout effects run first, so the value is
  // already current on the render where paging comes back.
  useEffect(() => {
    if (!enabled) charRef.current = externalCharOffset;
  }, [enabled, externalCharOffset]);

  /**
   * A snapshot to measure against.
   *
   * The block elements are queried every time rather than cached across
   * renders, which is not the obvious choice for a 3,500-element book but is the
   * correct one: React re-applies dangerouslySetInnerHTML on this element after
   * mount, which silently swaps every child for a new node. A cached list then
   * points at detached elements, and detached elements report no client rects —
   * so every character-to-page lookup quietly resolved to the same wrong answer
   * while paging by arrow key still appeared to work. One querySelectorAll costs
   * a fraction of a millisecond and happens once per jump, not per probe.
   */
  const measureCtx = useCallback((): MeasureCtx | null => {
    const flow = flowRef.current;
    const geom = geometryRef.current;
    if (!flow || !geom) return null;
    const blockEls = blockElements(flow);
    if (blockEls.length === 0) return null;
    return { flow, blocks: windowBlocks, blockEls, geom };
  }, [windowBlocks, flowRef]);

  const paint = useCallback(
    (page: number) => {
      const flow = flowRef.current;
      const geom = geometryRef.current;
      if (!flow || !geom) return;
      flow.style.transform = `translate3d(${-page * geom.pageStride}px, 0, 0)`;
    },
    [flowRef]
  );

  const goToPage = useCallback(
    (page: number) => {
      const stopTurn = startTimer("turn");
      const total = totalRef.current;
      const next = Math.min(Math.max(0, page), Math.max(0, total - 1));
      pageRef.current = next;
      paint(next);
      setPageIndex(next);
      const ctx = measureCtx();
      const char = ctx ? charOffsetAtTopOfPage(next, ctx) : charRef.current;
      charRef.current = char;
      setCharOffset(char);
      // Falling back to `char` means "no window", which makes the chapter
      // readout fall back to plain "the chapter I'm in" rather than reaching
      // forward to the last chapter of the book.
      setCharEnd(ctx && next + 1 < total ? charOffsetAtTopOfPage(next + 1, ctx) : char);
      const lastWindow = !win || win.endBlock >= blocks.length;
      onPositionChange(char, lastWindow && next >= total - 1);
      stopTurn(`p${next}`);
    },
    [blocks.length, measureCtx, onPositionChange, paint, win]
  );

  const goToChar = useCallback(
    (target: number) => {
      // Somewhere else in the book. Move the window rather than the page: the
      // repagination effect below runs before paint, so it lands on the right
      // page of the newly rendered chapter with nothing shown in between.
      if (win && !windowHolds(win, target)) {
        charRef.current = target;
        note("window", `to char ${target}`);
        setWindowChar(target);
        return;
      }
      const ctx = measureCtx();
      if (!ctx) {
        // Not laid out yet — remember it so the next repagination lands there.
        charRef.current = target;
        return;
      }
      goToPage(pageForCharOffset(target, ctx));
    },
    [goToPage, measureCtx, win]
  );

  // Turning off the end of a window is a jump to the character just past it —
  // which is the first character of the next chapter, and the last of the
  // previous one. Going back is the interesting direction: the previous
  // window's final page isn't knowable until it has been laid out, and it never
  // has to be. Solving for that character after fragmentation finds it.
  const next = useCallback(() => {
    if (win && pageRef.current >= totalRef.current - 1 && win.endBlock < blocks.length) {
      goToChar(win.charEnd);
      return;
    }
    goToPage(pageRef.current + 1);
  }, [blocks.length, goToChar, goToPage, win]);

  const prev = useCallback(() => {
    if (win && pageRef.current <= 0 && win.startBlock > 0) {
      goToChar(win.charStart - 1);
      return;
    }
    goToPage(pageRef.current - 1);
  }, [goToChar, goToPage, win]);

  // Geometry comes from the window, not from measuring the reading area's own
  // box. A paged reader covers the whole window by construction, so the two are
  // the same number — but only one of them can be zero. The reading area is a
  // `fixed inset-0` element whose children are all absolutely positioned, so
  // before its stylesheet applies it measures 0×0, we decline to paginate, and
  // the book never appears at all. The window is always the window.
  //
  // Derived during render rather than measured into state by an effect, and the
  // difference is a frame you can see.
  //
  // As an effect, the geometry landed after the browser had already painted, so
  // opening the chat came out as a staircase: one frame with the panel sitting on
  // top of a book still where it was, then the new geometry, then the page
  // repositioning. Nothing in it was slow — it was three frames of a change that
  // should be one, and it read as the reader lagging behind the panel. Derived
  // here, the panel and the book it moves arrive together, because the layout
  // effects below run in the same pre-paint pass as the render that moved it.
  //
  // Free to do during render: computeGeometry is arithmetic on the window size.
  // It reads no layout, so it forces none.
  const measured = useMemo(
    () =>
      !enabled || html == null || viewport.width === 0 || viewport.height === 0
        ? null
        : computeGeometry(
            viewport.width,
            Math.max(200, viewport.height - bottomInset),
            settings,
            chatPanel
          ),
    [enabled, html, viewport, settings, chatPanel, bottomInset]
  );
  const geometry = measured;

  // What the browser actually needs to re-fragment for: the size of a column box
  // and the gap between boxes. Notably not `cols` — the flow element is always
  // one column wide, so how many columns a page shows never reaches the text.
  const fragmentationKey = geometry
    ? `${geometry.colW}:${geometry.gap}:${geometry.pageH}`
    : null;

  // What the position solve has to re-run for. `cols` is here because it changes
  // how many columns a page holds, and so which page any given character is on —
  // but it costs almost nothing, because the flow's own styles don't change and
  // the browser's layout never goes dirty. See the effect below.
  const pagingKey = geometry ? `${fragmentationKey}:${geometry.cols}` : null;

  // Positional-only geometry changes: keep the ref current and re-paint where we
  // already are, without re-fragmenting. This is the chat panel sliding the book
  // sideways on a wide screen — the columns are unchanged, so there is nothing to
  // recompute. Declared before the repagination effect so that effect always
  // reads a current geometry from the ref.
  useLayoutEffect(() => {
    if (!enabled || !geometry) return;
    geometryRef.current = geometry;
    paint(pageRef.current);
  }, [enabled, geometry, paint]);

  // Repaginate. Runs before paint, so the reader never sees the un-jumped
  // layout — no flash, and no need to animate anything to cover it up.
  //
  // Keyed on the paging, not on the geometry object: an offsetX-only change must
  // not land here, or moving the book sideways costs a whole-book pass. Geometry
  // itself is read from geometryRef, kept current by the effect above.
  //
  // Landing here does NOT necessarily mean re-fragmenting. When only `cols`
  // changed — the chat panel opening, a page going from a spread to a single
  // column — React writes no new styles to the flow, so layout is still clean and
  // the forced read below is free; all that's left is re-deriving which page the
  // reader's character is now on. The expensive path is taken only when the
  // fragmentation triple itself moves, and the `fragment` timing says which
  // happened.
  useLayoutEffect(() => {
    const geom = geometryRef.current;
    if (!enabled || renderedHtml == null || !geom) return;
    const flow = flowRef.current;
    if (!flow) return;

    // Force the fragmentation now rather than at paint, so the measurements
    // below are against the new layout. This read is the single most expensive
    // thing the reader does — laying a whole book out as one multi-column strip —
    // so it's the one number worth having from the device that feels slow.
    const stopFragment = startTimer("fragment");
    const stripWidth = flow.scrollWidth;
    stripWidthRef.current = stripWidth;
    stopFragment(
      `${geom.cols}col ${geom.colW}w ${Math.round(stripWidth / 1000)}kpx ` +
        `blocks ${windowBlocks[0]?.index ?? 0}+${windowBlocks.length}`
    );

    const stopSolve = startTimer("solve");
    const total = countPages(flow, geom);
    totalRef.current = total;
    setTotalPages(total);

    const ctx: MeasureCtx = {
      flow,
      blocks: windowBlocks,
      blockEls: blockElements(flow),
      geom,
    };
    const page = Math.min(pageForCharOffset(charRef.current, ctx), total - 1);
    pageRef.current = page;
    paint(page);
    setPageIndex(page);

    const char = charOffsetAtTopOfPage(page, ctx);
    charRef.current = char;
    setCharOffset(char);
    setCharEnd(page + 1 < total ? charOffsetAtTopOfPage(page + 1, ctx) : char);
    setLayoutNonce((n) => n + 1);
    stopSolve(`${total}pp → p${page}`);

    assertPagesMoveForward(ctx, total);
  }, [enabled, renderedHtml, pagingKey, windowBlocks, revision, flowRef, paint]);

  // Web fonts swapping in changes every line's metrics, which changes where the
  // column breaks fall.
  //
  // But `fonts.ready` resolving does not mean anything changed: on any reopen the
  // faces are already in the cache and applied before the book was ever laid out,
  // and the reader's own chrome has asked for them by then anyway. Bumping the
  // revision unconditionally therefore paid for a second full fragmentation of
  // the book — the most expensive thing here — on every single open, in the
  // common case, for nothing.
  //
  // The strip's width is the cheapest exact test of whether the metrics actually
  // moved: it's a whole book's worth of lines, so a change of even a fraction of
  // a pixel per line shows up as hundreds of pixels across it. The layout is
  // already clean at this point, so reading it costs nothing.
  useEffect(() => {
    if (!enabled || html == null) return;
    let cancelled = false;
    void document.fonts?.ready.then(() => {
      if (cancelled) return;
      const flow = flowRef.current;
      const before = stripWidthRef.current;
      const after = flow?.scrollWidth ?? -1;
      if (flow && before >= 0 && after === before) {
        note("fonts", "no metric change, skipped");
        return;
      }
      note("fonts", `strip ${before} → ${after}, repaginating`);
      setRevision((n) => n + 1);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, html, flowRef]);

  return {
    geometry,
    html: enabled ? renderedHtml : null,
    windowBase: win?.startBlock ?? 0,
    pageIndex,
    totalPages,
    charOffset,
    charEnd,
    atEnd: (!win || win.endBlock >= blocks.length) && pageIndex >= totalPages - 1,
    atStart: (!win || win.startBlock === 0) && pageIndex <= 0,
    goToChar,
    goToPage,
    next,
    prev,
    layoutNonce,
  };
}
