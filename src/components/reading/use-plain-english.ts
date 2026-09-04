"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { enablePlainEnglish, setReadingFace } from "@/app/(reading)/reader/plain-actions";
import { PLAIN_POLL_MS } from "@/lib/reading/plain/constants";
import { loadPlainPlan, storePlainPlan } from "@/lib/reading/offline/content-cache";
import type {
  PlainBlock,
  PlainChapter,
  PlainPlan,
  ReadingFace,
} from "@/lib/reading/plain/types";
import type { PlainRenderState } from "@/lib/reading/plain/render";

/**
 * The reader's side of Plain English.
 *
 * Owns three things: which face this reader has chosen, what the family's
 * translation of this conversion currently holds, and which chapters' plain
 * text is actually APPLIED to the page — which lags "ready" on purpose. A
 * chapter that lands while you are reading it does not swap under you; it
 * waits for a navigation or a tap on its marker (KTD13). Chapters elsewhere
 * swap as soon as they land in paged mode, where the window they are in isn't
 * on screen; in scroll mode, where the whole book is one document and any swap
 * above the viewport moves it, nothing swaps until you leave the chapter.
 *
 * Polls the plan while anything is pending and the face is plain, exactly as
 * the audiobook player polls its track list, and fires the live prepare for
 * the chapter you are in (and the next) whenever you reach one that isn't ready.
 */

type ChapterFilter = (c: PlainChapter) => boolean;

export type PlainEnglishState = {
  face: ReadingFace;
  /** What is on screen: the setting, except while Listen forces the original. */
  shownFace: ReadingFace;
  plan: PlainPlan | null;
  chapters: PlainChapter[];
  /** The chapter the reader is in, by the plan's chapters, or null. */
  currentChapter: PlainChapter | null;
  /** What the renderer needs, or null when the original face is shown. */
  render: PlainRenderState | null;
  /** Counts for the menu label. */
  counts: { total: number; ready: number; failed: number; pending: number };
  /** Whether a translation exists (any chapter row) for this conversion. */
  exists: boolean;
  /** Whether anything is still on its way. */
  inProgress: boolean;
  loading: boolean;
  error: string | null;
  enable: () => Promise<void>;
  disable: () => Promise<void>;
  /** Apply a ready chapter that was waiting for a navigation. */
  applyChapter: (index: number) => void;
  /** Reset a failed chapter and translate it live. */
  retryChapter: (index: number) => Promise<void>;
  /** Text shown for a block in the current face, for position mapping. */
  faceTextOf: (blockIndex: number) => string | null;
  /** Every stored paragraph, ready or not, for the counterpart panel. */
  blocksByIndex: ReadonlyMap<number, PlainBlock>;
};

const PENDING: ChapterFilter = (c) =>
  c.status === "pending" || c.status === "preparing" || c.status === "batched";

export function usePlainEnglish({
  bookId,
  enabled,
  initialFace,
  currentCharOffset,
  paged,
  listening,
}: {
  bookId: string;
  /** False for articles and until the book has loaded. */
  enabled: boolean;
  initialFace: ReadingFace;
  currentCharOffset: number;
  paged: boolean;
  /** While a voice is reading, the original is shown regardless (R20). */
  listening: boolean;
}): PlainEnglishState {
  const [face, setFace] = useState<ReadingFace>(initialFace);
  const [plan, setPlan] = useState<PlainPlan | null>(null);
  const [applied, setApplied] = useState<Set<number>>(() => new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const etagRef = useRef<string | null>(null);
  const preparingRef = useRef<Set<number>>(new Set());

  const shownFace: ReadingFace = listening ? "original" : face;
  const chapters = useMemo(() => plan?.chapters ?? [], [plan]);

  const currentChapter = useMemo(
    () =>
      chapters.find((c) => currentCharOffset >= c.charStart && currentCharOffset < c.charEnd) ??
      null,
    [chapters, currentCharOffset]
  );
  // Remembered so a chapter change can be told from a page turn.
  const currentIndexRef = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    try {
      const res = await fetch(`/reader/api/plain/${bookId}`, {
        headers: etagRef.current ? { "If-None-Match": etagRef.current } : undefined,
        cache: "no-store",
      });
      if (res.status === 304) return;
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Couldn't load.");
      etagRef.current = res.headers.get("ETag");
      const next = (await res.json()) as PlainPlan;
      setPlan(next);
      setError(null);
      void storePlainPlan(bookId, next);
    } catch (err) {
      // Offline, most likely. The device's copy is better than nothing.
      const cached = await loadPlainPlan<PlainPlan>(bookId).catch(() => null);
      if (cached) setPlan((p) => p ?? cached);
      else setError(err instanceof Error ? err.message : "Couldn't load the translation.");
    }
  }, [bookId, enabled]);

  // Load once when the book is ready, and again whenever the face is plain and
  // something is pending.
  useEffect(() => {
    if (!enabled) return;
    void refresh();
  }, [enabled, refresh]);

  const inProgress = chapters.some(PENDING);
  useEffect(() => {
    if (!enabled || face !== "plain" || !inProgress) return;
    const timer = setInterval(() => void refresh(), PLAIN_POLL_MS);
    return () => clearInterval(timer);
  }, [enabled, face, inProgress, refresh]);

  /** Fire the live translation for a chapter; safe to call twice. */
  const prepare = useCallback(
    async (index: number) => {
      if (preparingRef.current.has(index)) return;
      preparingRef.current.add(index);
      try {
        await fetch(`/reader/api/plain/${bookId}/${index}/prepare`, { method: "POST" });
      } catch {
        // The poll will show whatever happened.
      } finally {
        preparingRef.current.delete(index);
        void refresh();
      }
    },
    [bookId, refresh]
  );

  // Reach-ahead: in plain mode, the chapter you are in and the next one go live
  // the moment you arrive at one that isn't ready. This is also what rescues a
  // chapter the batch gave back after a failure.
  useEffect(() => {
    if (!enabled || face !== "plain" || !currentChapter) return;
    for (const c of [currentChapter, chapters[currentChapter.index + 1]]) {
      if (c && c.status === "pending") void prepare(c.index);
      if (c && c.status === "batched") void prepare(c.index);
    }
  }, [enabled, face, currentChapter, chapters, prepare]);

  // Which ready chapters are applied. Everything ready except the chapter being
  // read applies at once in paged mode; in scroll mode nothing new applies while
  // the reader stays in their chapter. Leaving a chapter applies whatever is
  // ready, the current one included, since the page is moving anyway.
  useEffect(() => {
    if (!plan) return;
    const ready = plan.chapters.filter((c) => c.status === "ready").map((c) => c.index);
    const here = currentChapter?.index ?? null;
    const moved = currentIndexRef.current !== here;
    currentIndexRef.current = here;

    setApplied((prev) => {
      const next = new Set(prev);
      for (const index of ready) {
        if (next.has(index)) continue;
        if (moved) next.add(index);
        else if (paged && index !== here) next.add(index);
      }
      // A chapter that stopped being ready (a re-run) drops out.
      for (const index of Array.from(next)) if (!ready.includes(index)) next.delete(index);
      return next.size === prev.size && Array.from(next).every((i) => prev.has(i)) ? prev : next;
    });
  }, [plan, currentChapter, paged]);

  const applyChapter = useCallback((index: number) => {
    setApplied((prev) => {
      if (prev.has(index)) return prev;
      const next = new Set(prev);
      next.add(index);
      return next;
    });
  }, []);

  const retryChapter = useCallback(
    async (index: number) => {
      await fetch(`/reader/api/plain/${bookId}/retry`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chapterIndex: index }),
      }).catch(() => {});
      await prepare(index);
    },
    [bookId, prepare]
  );

  const enable = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const outcome = await enablePlainEnglish(bookId, currentCharOffset);
      setFace("plain");
      setPlan((p) => ({
        hash: p?.hash ?? "",
        blocks: p?.blocks ?? [],
        terms: p?.terms ?? [],
        chapters: outcome.chapters,
      }));
      for (const index of outcome.live) void prepare(index);
      void refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't turn on Plain English.");
      throw err;
    } finally {
      setLoading(false);
    }
  }, [bookId, currentCharOffset, prepare, refresh]);

  const disable = useCallback(async () => {
    setFace("original");
    await setReadingFace(bookId, "original").catch(() => {});
  }, [bookId]);

  const blocksByIndex = useMemo(() => {
    const map = new Map<number, PlainBlock>();
    for (const b of plan?.blocks ?? []) map.set(b.index, b);
    return map;
  }, [plan]);

  const render = useMemo<PlainRenderState | null>(
    () =>
      shownFace === "plain" && plan
        ? { face: "plain", chapters: plan.chapters, applied, blocks: blocksByIndex, terms: plan.terms }
        : null,
    [applied, blocksByIndex, plan, shownFace]
  );

  const faceTextOf = useCallback(
    (blockIndex: number): string | null => {
      if (!render) return null;
      const b = render.blocks.get(blockIndex);
      if (!b || b.kept || b.text == null || !render.applied.has(b.chapterIndex)) return null;
      return b.text;
    },
    [render]
  );

  const counts = useMemo(
    () => ({
      total: chapters.length,
      ready: chapters.filter((c) => c.status === "ready").length,
      failed: chapters.filter((c) => c.status === "failed").length,
      pending: chapters.filter(PENDING).length,
    }),
    [chapters]
  );

  return {
    face,
    shownFace,
    plan,
    chapters,
    currentChapter,
    render,
    counts,
    exists: chapters.length > 0,
    inProgress,
    loading,
    error,
    enable,
    disable,
    applyChapter,
    retryChapter,
    faceTextOf,
    blocksByIndex,
  };
}
