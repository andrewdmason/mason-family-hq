"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useSearchParams } from "next/navigation";
import { addDays, localDate } from "@/lib/date-utils";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

type DayStats = { elapsedSeconds: number; goalSeconds: number };

type PracticeDayContextValue = {
  /** The user's today, kept current across midnight. */
  today: string;
  /** The day the log is showing. */
  viewDate: string;
  isToday: boolean;
  goToDate: (date: string) => void;
  /** Time logged and planned on the day on screen, for the title bar. */
  dayStats: DayStats;
  setDayStats: (stats: DayStats) => void;
};

const PracticeDayContext = createContext<PracticeDayContextValue | null>(null);

export function usePracticeDay(): PracticeDayContextValue {
  const ctx = useContext(PracticeDayContext);
  if (!ctx) throw new Error("usePracticeDay needs a PracticeDayProvider");
  return ctx;
}

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/**
 * Which day the practice log shows. The day lives in the address (?date=), so
 * a reload stays put and Back retraces the days stepped through; no date means
 * "today", which follows the calendar — leave the log open overnight and it
 * turns over with it. Having stepped to a particular day, you stay on it.
 */
export function PracticeDayProvider({
  initialToday,
  children,
}: {
  initialToday: string;
  children: ReactNode;
}) {
  const searchParams = useSearchParams();
  const [today, setToday] = useState(initialToday);

  // The server rendered with its idea of today; the browser's clock is the one
  // the user is looking at. Re-check whenever the window comes back and once a
  // minute, so an open log turns over at midnight.
  useEffect(() => {
    const check = () => setToday(localDate());
    check();
    const interval = setInterval(check, 60_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  const dateParam = searchParams.get("date");
  const viewDate =
    dateParam && DATE_PATTERN.test(dateParam) ? dateParam : today;
  const isToday = viewDate === today;

  const todayRef = useRef(today);
  useEffect(() => {
    todayRef.current = today;
  }, [today]);

  const goToDate = useCallback((date: string) => {
    const params = new URLSearchParams(window.location.search);
    if (date === todayRef.current) {
      params.delete("date");
    } else {
      params.set("date", date);
      // Focus is a today-only mode; leaving today leaves it.
      params.delete("view");
    }
    const qs = params.toString();
    const url = qs ? `/practice?${qs}` : "/practice";
    if (url === `${window.location.pathname}${window.location.search}`) return;
    window.history.pushState(null, "", url);
    window.scrollTo({ top: 0 });
  }, []);

  const viewDateRef = useRef(viewDate);
  useEffect(() => {
    viewDateRef.current = viewDate;
  }, [viewDate]);

  // [ and ] step a day; T comes home. Letters rather than the arrow keys,
  // which already belong to the metronome's tempo while it's running.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;
      if (document.querySelector("[role=dialog], [role=menu]")) return;
      if (e.key === "[") {
        e.preventDefault();
        goToDate(addDays(viewDateRef.current, -1));
      } else if (e.key === "]") {
        e.preventDefault();
        goToDate(addDays(viewDateRef.current, 1));
      } else if (e.key === "t" || e.key === "T") {
        e.preventDefault();
        goToDate(todayRef.current);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [goToDate]);

  const [dayStats, setDayStatsState] = useState<DayStats>({
    elapsedSeconds: 0,
    goalSeconds: 0,
  });
  const setDayStats = useCallback((next: DayStats) => {
    setDayStatsState((prev) =>
      prev.elapsedSeconds === next.elapsedSeconds &&
      prev.goalSeconds === next.goalSeconds
        ? prev
        : next,
    );
  }, []);

  const value = useMemo(
    () => ({ today, viewDate, isToday, goToDate, dayStats, setDayStats }),
    [today, viewDate, isToday, goToDate, dayStats, setDayStats],
  );

  return (
    <PracticeDayContext.Provider value={value}>
      {children}
    </PracticeDayContext.Provider>
  );
}
