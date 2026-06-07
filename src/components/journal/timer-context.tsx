"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

const DURATION_MS = 5 * 60 * 1000;

type Ctx = {
  running: boolean;
  done: boolean;
  degrees: number;
  begin: (startedAtMs: number) => void;
  stop: () => void;
};

const JournalTimerContext = createContext<Ctx | null>(null);

/**
 * Holds the five-minute zen-timer state for the journal — a quiet "time spent on
 * this post" counter. The chat surface drives when it starts, renders its
 * progress as a small pie that fills then settles into a checkmark, and reads
 * when it's done: completion gently flips question mode off once (the timer no
 * longer gates the conversation).
 *
 * The timer is anchored to a wall-clock timestamp (the moment the entry's
 * opening question appeared, or when a blank post was started) rather than
 * counted from page load, so its progress and completion survive refreshes.
 */
export function JournalTimerProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [stopped, setStopped] = useState(false);
  const [done, setDone] = useState(false);
  const [degrees, setDegrees] = useState(0);
  const startedAtRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  // Anchor the timer to `startedAtMs` (wall-clock). Idempotent for the same
  // anchor so it's safe to call on every qualifying render; a different
  // anchor (a new entry) resets progress.
  const begin = useCallback((startedAtMs: number) => {
    if (startedAtRef.current === startedAtMs) {
      setStopped(false);
      return;
    }
    startedAtRef.current = startedAtMs;
    const elapsed = Math.max(0, Date.now() - startedAtMs);
    const p = Math.min(elapsed / DURATION_MS, 1);
    setStartedAt(startedAtMs);
    setStopped(false);
    setDegrees(p * 360);
    setDone(p >= 1);
  }, []);

  // Clear the timer entirely — it only belongs to an in-progress today
  // entry, so closing or leaving the entry should make it disappear.
  const stop = useCallback(() => {
    startedAtRef.current = null;
    setStopped(true);
    setStartedAt(null);
    setDone(false);
    setDegrees(0);
  }, []);

  useEffect(() => {
    if (startedAt == null || stopped) return;
    const tick = () => {
      const elapsed = Math.max(0, Date.now() - startedAt);
      const p = Math.min(elapsed / DURATION_MS, 1);
      const deg = p * 360;
      // Re-render only when the visible whole-degree changes.
      setDegrees((prev) => (Math.floor(deg) !== Math.floor(prev) ? deg : prev));
      if (p >= 1) {
        setDone(true);
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [startedAt, stopped]);

  const running = startedAt != null && !stopped;

  return (
    <JournalTimerContext.Provider value={{ running, done, degrees, begin, stop }}>
      {children}
    </JournalTimerContext.Provider>
  );
}

export function useJournalTimer(): Ctx {
  const ctx = useContext(JournalTimerContext);
  if (!ctx)
    throw new Error("useJournalTimer must be used inside JournalTimerProvider");
  return ctx;
}
