"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { BookBlock } from "@/lib/reading/block-stream";
import { blockElements } from "@/lib/reading/annotation-anchors";
import {
  computeGeometry,
  sameGeometry,
  type PageGeometry,
} from "@/lib/reading/paged-geometry";
import {
  assertPagesMoveForward,
  charOffsetAtTopOfPage,
  countPages,
  pageForCharOffset,
  type MeasureCtx,
} from "@/lib/reading/paged-position";
import type { ReaderSettings } from "@/lib/reading/reader-settings";

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

const RESIZE_DEBOUNCE_MS = 150;

export type Pagination = {
  geometry: PageGeometry | null;
  pageIndex: number;
  totalPages: number;
  /** Character at the top of the current page — the thing worth persisting. */
  charOffset: number;
  /** First character past the bottom of the page, for "what's visible here". */
  charEnd: number;
  atEnd: boolean;
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
  chatPanelOpen,
  charOffset: externalCharOffset,
  onPositionChange,
}: {
  enabled: boolean;
  html: string | null;
  flowRef: React.RefObject<HTMLDivElement | null>;
  blocks: BookBlock[];
  settings: ReaderSettings;
  chatPanelOpen: boolean;
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
  const [measured, setMeasured] = useState<PageGeometry | null>(null);
  // Derived rather than cleared when paging is switched off, so turning the
  // setting on and off doesn't cascade an extra render each way.
  const geometry = enabled ? measured : null;
  const [pageIndex, setPageIndex] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [charOffset, setCharOffset] = useState(externalCharOffset);
  const [charEnd, setCharEnd] = useState(externalCharOffset);
  const [layoutNonce, setLayoutNonce] = useState(0);
  // Bumped when something outside our control changed the metrics (web fonts).
  const [revision, setRevision] = useState(0);

  const geometryRef = useRef<PageGeometry | null>(null);
  const charRef = useRef(externalCharOffset);
  const totalRef = useRef(1);
  const pageRef = useRef(0);

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
    return { flow, blocks, blockEls, geom };
  }, [blocks, flowRef]);

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
      onPositionChange(char, next >= total - 1);
    },
    [measureCtx, onPositionChange, paint]
  );

  const goToChar = useCallback(
    (target: number) => {
      const ctx = measureCtx();
      if (!ctx) {
        // Not laid out yet — remember it so the next repagination lands there.
        charRef.current = target;
        return;
      }
      goToPage(pageForCharOffset(target, ctx));
    },
    [goToPage, measureCtx]
  );

  const next = useCallback(() => goToPage(pageRef.current + 1), [goToPage]);
  const prev = useCallback(() => goToPage(pageRef.current - 1), [goToPage]);

  // Geometry comes from the window, not from measuring the reading area's own
  // box. A paged reader covers the whole window by construction, so the two are
  // the same number — but only one of them can be zero. The reading area is a
  // `fixed inset-0` element whose children are all absolutely positioned, so
  // before its stylesheet applies it measures 0×0, we decline to paginate, and
  // the book never appears at all. The window is always the window.
  //
  // Resizes are debounced (a drag fires dozens and each would re-fragment the
  // whole book); a settings change re-runs this effect and repaginates at once,
  // since that one is a deliberate action and should feel immediate.
  useEffect(() => {
    if (!enabled || html == null) {
      geometryRef.current = null;
      return;
    }

    let timer: ReturnType<typeof setTimeout> | null = null;
    const remeasure = () => {
      const width = window.innerWidth;
      const height = window.innerHeight;
      if (width === 0 || height === 0) return;
      const nextGeometry = computeGeometry(width, height, settings, chatPanelOpen);
      setMeasured((prev) => (sameGeometry(prev, nextGeometry) ? prev : nextGeometry));
    };

    remeasure();
    const onResize = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(remeasure, RESIZE_DEBOUNCE_MS);
    };
    window.addEventListener("resize", onResize);
    // Phones change the visible height without a window resize when the browser
    // chrome slides away.
    window.visualViewport?.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.visualViewport?.removeEventListener("resize", onResize);
      if (timer) clearTimeout(timer);
    };
  }, [enabled, html, settings, chatPanelOpen]);

  // What the browser actually needs to re-fragment for. Everything else about
  // the geometry — really just offsetX — only moves the finished flow around.
  const fragmentationKey = geometry
    ? `${geometry.cols}:${geometry.colW}:${geometry.gap}:${geometry.pageH}`
    : null;

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
  // Keyed on the fragmentation, not on the geometry object: an offsetX-only
  // change must not land here, or opening a chat pays for a full re-fragmentation
  // of the book to move the text 224px to the left. Geometry itself is read from
  // geometryRef, kept current by the effect above.
  useLayoutEffect(() => {
    const geom = geometryRef.current;
    if (!enabled || html == null || !geom) return;
    const flow = flowRef.current;
    if (!flow) return;

    // Force the fragmentation now rather than at paint, so the measurements
    // below are against the new layout.
    void flow.scrollWidth;

    const total = countPages(flow, geom);
    totalRef.current = total;
    setTotalPages(total);

    const ctx: MeasureCtx = {
      flow,
      blocks,
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

    assertPagesMoveForward(ctx, total);
  }, [enabled, html, fragmentationKey, blocks, revision, flowRef, paint]);

  // Web fonts swapping in changes every line's metrics, which changes where the
  // column breaks fall.
  useEffect(() => {
    if (!enabled || html == null) return;
    let cancelled = false;
    void document.fonts?.ready.then(() => {
      if (!cancelled) setRevision((n) => n + 1);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, html]);

  return {
    geometry,
    pageIndex,
    totalPages,
    charOffset,
    charEnd,
    atEnd: pageIndex >= totalPages - 1,
    goToChar,
    goToPage,
    next,
    prev,
    layoutNonce,
  };
}
