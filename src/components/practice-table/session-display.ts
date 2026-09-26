"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { TaskWithDetails } from "@/lib/types";

/**
 * How today's log is laid out on this device: whether finished items are
 * showing, and which sessions have been folded or opened by hand. It's a
 * "right now, on this screen" choice, so it lives in localStorage rather than
 * the account, and it's thrown away when the date changes.
 */
type DisplayPrefs = {
  savedOn: string;
  showCompleted: boolean;
  /** Per log day, per session number: an explicit fold that differs from the default. */
  collapsed: Record<string, Record<string, boolean>>;
};

const STORAGE_KEY = "practice-session-display";
const EMPTY: DisplayPrefs = { savedOn: "", showCompleted: false, collapsed: {} };

const listeners = new Set<() => void>();
let cachedRaw: string | null | undefined;
let cachedPrefs: DisplayPrefs = EMPTY;

function readPrefs(): DisplayPrefs {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return EMPTY;
  }
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    try {
      cachedPrefs = raw ? { ...EMPTY, ...JSON.parse(raw) } : EMPTY;
    } catch {
      cachedPrefs = EMPTY;
    }
  }
  return cachedPrefs;
}

function writePrefs(next: DisplayPrefs) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Private mode or a full quota: the choice just won't survive a reload.
  }
  for (const l of listeners) l();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function useSessionDisplayPrefs(today: string) {
  const stored = useSyncExternalStore(subscribe, readPrefs, () => EMPTY);
  const prefs = stored.savedOn === today ? stored : EMPTY;

  const update = useCallback(
    (fn: (prev: DisplayPrefs) => DisplayPrefs) => {
      const current = readPrefs();
      const base =
        current.savedOn === today ? current : { ...EMPTY, savedOn: today };
      writePrefs(fn(base));
    },
    [today]
  );

  const setShowCompleted = useCallback(
    (show: boolean) => update((p) => ({ ...p, showCompleted: show })),
    [update]
  );

  /**
   * Record a fold. Only a choice that differs from what the session would do
   * on its own is kept, so a session opened because practice moved into it
   * still folds away once it's finished.
   */
  const setCollapsed = useCallback(
    (date: string, sessionNumber: number, collapsed: boolean, byDefault: boolean) =>
      update((p) => {
        const day = { ...p.collapsed[date] };
        if (collapsed === byDefault) delete day[sessionNumber];
        else day[sessionNumber] = collapsed;
        return { ...p, collapsed: { ...p.collapsed, [date]: day } };
      }),
    [update]
  );

  return {
    showCompleted: prefs.showCompleted,
    setShowCompleted,
    collapsedOverride: (date: string, sessionNumber: number) =>
      prefs.collapsed[date]?.[sessionNumber] as boolean | undefined,
    setCollapsed,
  };
}

export type LingerPhase = "shown" | "leaving";

const LINGER_MS = 900;
const LEAVE_MS = 250;

/**
 * Items finished while you're looking stay on screen, checked, for a beat
 * before sliding out — long enough to see you got the right row. Returns the
 * phase for each such item; anything finished before the page loaded isn't in
 * here and hides straight away.
 */
export function useJustCompleted(
  tasks: TaskWithDetails[],
  enabled: boolean
): ReadonlyMap<string, LingerPhase> {
  const openNow = new Set(tasks.filter((t) => !t.completed).map((t) => t.id));
  const [prevOpen, setPrevOpen] = useState(openNow);
  const [phases, setPhases] = useState<Record<string, LingerPhase>>({});

  const changed =
    openNow.size !== prevOpen.size || [...openNow].some((id) => !prevOpen.has(id));
  if (changed) {
    const justDone = [...prevOpen].filter(
      (id) => !openNow.has(id) && tasks.some((t) => t.id === id && t.completed)
    );
    setPrevOpen(openNow);
    const reopened = Object.keys(phases).filter((id) => openNow.has(id));
    if ((enabled && justDone.length > 0) || reopened.length > 0) {
      setPhases((prev) => {
        const next = { ...prev };
        for (const id of reopened) delete next[id];
        if (enabled) for (const id of justDone) next[id] = "shown";
        return next;
      });
    }
  }

  const timersRef = useRef(new Map<string, ReturnType<typeof setTimeout>[]>());
  useEffect(() => {
    const timers = timersRef.current;
    for (const [id, handles] of timers) {
      if (!(id in phases)) {
        handles.forEach(clearTimeout);
        timers.delete(id);
      }
    }
    for (const [id, phase] of Object.entries(phases)) {
      if (phase !== "shown" || timers.has(id)) continue;
      timers.set(id, [
        setTimeout(() => {
          setPhases((p) => (id in p ? { ...p, [id]: "leaving" } : p));
        }, LINGER_MS),
        setTimeout(() => {
          timers.delete(id);
          setPhases((p) => {
            if (!(id in p)) return p;
            const next = { ...p };
            delete next[id];
            return next;
          });
        }, LINGER_MS + LEAVE_MS),
      ]);
    }
  }, [phases]);
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const handles of timers.values()) handles.forEach(clearTimeout);
      timers.clear();
    };
  }, []);

  return new Map(Object.entries(phases));
}
