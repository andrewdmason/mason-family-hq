"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import {
  updateTaskRemaining,
  startTaskTimer as startTaskTimerAction,
  stopTaskTimer as stopTaskTimerAction,
} from "@/app/practice/timer/task-actions";
import type { Piece, PieceKind, SectionStatus } from "@/lib/types";

const STORAGE_KEY = "practice-task-timer-state";

export type ActiveTaskMeta = {
  pieceId: string | null;
  pieceName: string | null;
  pieceComposer: string | null;
  pieceKind: PieceKind | null;
  sectionLabel: string | null;
  sectionStatus: SectionStatus | null;
  text: string;
  goalSeconds: number;
  metronomeSpeed: number | null;
  date: string;
};

type PersistedState = {
  taskId: string;
  remainingSeconds: number;
  lastTickAt: string;
  meta?: ActiveTaskMeta;
  /** "running" (default) counts down from lastTickAt; "loaded" holds the
   * remaining value as-is so the user can resume a paused task from the bar. */
  status?: "running" | "loaded";
};

/**
 * Task-run boundary events for the capture controller (plan U4, KTD2/KTD3).
 * Additive subscription surface: events fire only from the explicit lifecycle
 * functions (startTaskTimer / pauseTaskTimer / resetTaskTimer), all of which
 * are reached from user gestures (or their synchronous consequences, like
 * auto-advance). Restore-on-mount never emits — that is what gives
 * subscribers gesture-only semantics for reloads and second tabs.
 *
 * Ordering guarantees subscribers rely on:
 * - switch: run-end(switch) for the previous task, then run-start for the new
 *   one, both synchronously inside the same startTaskTimer call.
 * - reset: run-end(reset) then run-start(reset), synchronously.
 * - complete + auto-advance: run-end(pause) then run-start, synchronously
 *   (the auto-advance CustomEvent dispatch is synchronous).
 * Soft-goal expiry and setTaskGoal emit nothing (not segment boundaries).
 */
export type TimerRunEvent =
  | {
      type: "run-start";
      taskId: string;
      meta: ActiveTaskMeta | null;
      reason: "start" | "switch" | "reset";
    }
  | { type: "run-end"; taskId: string; reason: "pause" | "switch" | "reset" };

type TimerRunListener = (event: TimerRunEvent) => void;
const runEventListeners = new Set<TimerRunListener>();

export function subscribeTaskTimerRunEvents(
  listener: TimerRunListener
): () => void {
  runEventListeners.add(listener);
  return () => {
    runEventListeners.delete(listener);
  };
}

function emitRunEvent(event: TimerRunEvent) {
  for (const listener of runEventListeners) {
    try {
      listener(event);
    } catch {
      // Listeners must never break the timer.
    }
  }
}

/** Identifies a specific piece-group instance in the practice table (one piece
 * on one day in one session). Distinct from the filter state because the same
 * piece can appear in multiple days/sessions and we only want the specific one
 * the user clicked to render as "active". */
type ActivePieceInstance = { pieceId: string; key: string };

type TaskTimerContextValue = {
  activeTaskId: string | null;
  activeTaskMeta: ActiveTaskMeta | null;
  remainingSeconds: number;
  isExpired: boolean;
  /** Total elapsed seconds for tasks today (from server data + active timer) */
  dailyElapsedSeconds: number;
  activePieces: Piece[];
  /** Map of work_id → work name, for grouping pieces in UI. */
  worksById: Record<string, string>;
  /** Filter piece ID — drives filter-bar pill, filtered-view, and URL. */
  focusedPieceId: string | null;
  setFocusedPieceId: (id: string | null) => void;
  /** Specific piece-group instance the user is interacting with. Primary input
   * for the sidebar detail view; falls back to focusedPieceId when null. */
  activePieceInstance: ActivePieceInstance | null;
  setActivePieceInstance: (instance: ActivePieceInstance | null) => void;
  /** Paused-but-loaded task, so the transport bar can offer to resume it. */
  loadedTaskId: string | null;
  loadedTaskMeta: ActiveTaskMeta | null;
  loadedRemaining: number;
  unloadLoadedTask: () => void;
  startTaskTimer: (taskId: string, seconds: number, meta?: ActiveTaskMeta) => void;
  pauseTaskTimer: () => void;
  resetTaskTimer: (taskId: string, seconds: number) => void;
  /** Sync the goal for a task that is currently active or loaded in the bar.
   * Server-side, changing the goal also resets remaining to match — mirror
   * that here so the bar updates without waiting for revalidation. */
  setTaskGoal: (taskId: string, goalSeconds: number) => void;
  /** Refresh the daily total from server data */
  refreshDailyTotal: () => void;
};

const TaskTimerContext = createContext<TaskTimerContextValue | null>(null);

export function useTaskTimer() {
  const ctx = useContext(TaskTimerContext);
  if (!ctx) {
    throw new Error("useTaskTimer must be used within a TaskTimerProvider");
  }
  return ctx;
}

export function TaskTimerProvider({
  activePieces,
  worksById,
  initialDailySeconds = 0,
  children,
}: {
  activePieces: Piece[];
  worksById: Record<string, string>;
  initialDailySeconds?: number;
  children: ReactNode;
}) {
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [activeTaskMeta, setActiveTaskMeta] = useState<ActiveTaskMeta | null>(
    null
  );
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const [isExpired, setIsExpired] = useState(false);
  const [restored, setRestored] = useState(false);
  const [baseDailySeconds, setBaseDailySeconds] = useState(initialDailySeconds);
  const [activeTaskElapsed, setActiveTaskElapsed] = useState(0);
  const [focusedPieceId, setFocusedPieceId] = useState<string | null>(null);
  const [activePieceInstance, setActivePieceInstance] =
    useState<ActivePieceInstance | null>(null);
  const [loadedTaskId, setLoadedTaskId] = useState<string | null>(null);
  const [loadedTaskMeta, setLoadedTaskMeta] = useState<ActiveTaskMeta | null>(
    null
  );
  const [loadedRemaining, setLoadedRemaining] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const activeTaskStartRef = useRef<number | null>(null);

  const dailyElapsedSeconds = baseDailySeconds + activeTaskElapsed;

  const announceRemaining = useCallback((taskId: string, seconds: number) => {
    window.dispatchEvent(
      new CustomEvent("task-timer-paused", {
        detail: { taskId, remainingSeconds: seconds },
      })
    );
  }, []);

  const persistTaskRemaining = useCallback(
    (taskId: string, seconds: number) => {
      void updateTaskRemaining(taskId, seconds).catch(() => {});
      announceRemaining(taskId, seconds);
    },
    [announceRemaining]
  );

  // Restore from localStorage on mount
  useEffect(() => {
    let restoredTaskId: string | null = null;
    let restoredHadMeta = false;
    let restoredStatus: "running" | "loaded" = "running";
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const state: PersistedState = JSON.parse(raw);
        restoredStatus = state.status ?? "running";
        if (restoredStatus === "loaded") {
          // Paused-but-loaded: hold the remaining value without counting down.
          setLoadedTaskId(state.taskId);
          setLoadedTaskMeta(state.meta ?? null);
          setLoadedRemaining(state.remainingSeconds);
        } else {
          const elapsed = Math.floor(
            (Date.now() - new Date(state.lastTickAt).getTime()) / 1000
          );
          // Remaining can go negative once the soft goal has been passed.
          const remaining = state.remainingSeconds - elapsed;
          setActiveTaskId(state.taskId);
          setActiveTaskMeta(state.meta ?? null);
          setRemainingSeconds(remaining);
          setIsExpired(remaining <= 0);
          activeTaskStartRef.current = Date.now() - elapsed * 1000;
        }
        restoredTaskId = state.taskId;
        restoredHadMeta = !!state.meta;
      }
    } catch {
      // Ignore corrupt localStorage
    }
    setRestored(true);

    // If we restored a task but don't have meta (e.g. persisted under an
    // older version of this context), fetch the task details so the transport
    // bar can show piece/section/goal correctly.
    if (restoredTaskId && !restoredHadMeta) {
      const statusAtRestore = restoredStatus;
      void (async () => {
        try {
          const { getTaskWithDetails } = await import(
            "@/app/practice/timer/task-actions"
          );
          const task = await getTaskWithDetails(restoredTaskId!);
          if (!task) return;
          const meta: ActiveTaskMeta = {
            pieceId: task.piece_id,
            pieceName: task.piece_name,
            pieceComposer: task.piece_composer,
            pieceKind: task.piece_kind,
            sectionLabel: task.section_label,
            sectionStatus: task.section_status,
            text: task.text,
            goalSeconds: task.timer_seconds,
            metronomeSpeed: task.metronome_speed,
            date: task.date,
          };
          if (statusAtRestore === "loaded") {
            setLoadedTaskMeta(meta);
          } else {
            setActiveTaskMeta(meta);
          }
        } catch {
          // Ignore — the bar will just show a stripped-down view.
        }
      })();
    }
  }, []);

  const persist = useCallback(
    (taskId: string | null, seconds: number, meta: ActiveTaskMeta | null) => {
      if (!restored) return;
      if (taskId) {
        const state: PersistedState = {
          taskId,
          remainingSeconds: seconds,
          lastTickAt: new Date().toISOString(),
          meta: meta ?? undefined,
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }
    },
    [restored]
  );

  // Handle visibility change
  useEffect(() => {
    const handler = () => {
      if (document.visibilityState !== "visible") return;
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw || !activeTaskId) return;
        const state: PersistedState = JSON.parse(raw);
        if (state.taskId !== activeTaskId) return;
        const elapsed = Math.floor(
          (Date.now() - new Date(state.lastTickAt).getTime()) / 1000
        );
        const remaining = state.remainingSeconds - elapsed;
        setRemainingSeconds(remaining);
        if (remaining <= 0) {
          setIsExpired(true);
        }
      } catch {
        // Ignore
      }
    };
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }, [activeTaskId]);

  // Countdown interval — keeps running past the soft goal so the user can
  // practice longer than planned without stopping the timer.
  useEffect(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    if (!activeTaskId) return;

    intervalRef.current = setInterval(() => {
      setRemainingSeconds((prev) => prev - 1);
      // Update active task elapsed for daily total
      if (activeTaskStartRef.current) {
        setActiveTaskElapsed(
          Math.floor((Date.now() - activeTaskStartRef.current) / 1000)
        );
      }
    }, 1000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [activeTaskId]);

  // Fire goal-reached side effects outside the setState updater so the
  // synchronous `task-timer-paused` dispatch doesn't violate React 19's
  // rule against updating other components from within another updater.
  useEffect(() => {
    if (!activeTaskId || isExpired) return;
    if (remainingSeconds > 0) return;
    setIsExpired(true);
    persistTaskRemaining(activeTaskId, 0);
  }, [activeTaskId, isExpired, remainingSeconds, persistTaskRemaining]);

  // Persist every 10 seconds while running (including past the soft goal, so
  // overtime is reflected on reload via the server's daily summary).
  const tickCount = useRef(0);
  useEffect(() => {
    if (!activeTaskId) {
      tickCount.current = 0;
      return;
    }
    tickCount.current++;
    if (tickCount.current % 10 === 0) {
      persist(activeTaskId, remainingSeconds, activeTaskMeta);
      void updateTaskRemaining(activeTaskId, remainingSeconds).catch(() => {});
    }
  }, [remainingSeconds, activeTaskId, activeTaskMeta, persist]);

  const refreshDailyTotal = useCallback(async () => {
    try {
      const { getTodaySummary } = await import("@/app/practice/timer/actions");
      const summary = await getTodaySummary();
      const total = summary.reduce((sum, e) => sum + e.total_seconds, 0);
      setBaseDailySeconds(total);
    } catch {
      // Ignore
    }
  }, []);

  const startTaskTimer = useCallback(
    (taskId: string, seconds: number, meta?: ActiveTaskMeta) => {
      const isSwitch = !!activeTaskId && activeTaskId !== taskId;
      if (activeTaskId && activeTaskId !== taskId) {
        persistTaskRemaining(activeTaskId, remainingSeconds);
        // Add the elapsed time from the previous task to the base total
        if (activeTaskStartRef.current) {
          const prevElapsed = Math.floor(
            (Date.now() - activeTaskStartRef.current) / 1000
          );
          setBaseDailySeconds((prev) => prev + prevElapsed);
        }
        // Switch is NOT pause-then-start — the previous run ends here.
        emitRunEvent({ type: "run-end", taskId: activeTaskId, reason: "switch" });
      }
      const nextMeta = meta ?? null;
      setActiveTaskId(taskId);
      setActiveTaskMeta(nextMeta);
      setRemainingSeconds(seconds);
      setIsExpired(seconds <= 0);
      setActiveTaskElapsed(0);
      activeTaskStartRef.current = Date.now();
      // Starting a task clears any loaded-but-paused task — the new one
      // takes over the transport bar.
      setLoadedTaskId(null);
      setLoadedTaskMeta(null);
      setLoadedRemaining(0);
      persist(taskId, seconds, nextMeta);

      // Record started_at on server
      void startTaskTimerAction(taskId).catch(() => {});

      emitRunEvent({
        type: "run-start",
        taskId,
        meta: nextMeta,
        reason: isSwitch ? "switch" : "start",
      });
    },
    [activeTaskId, remainingSeconds, persist, persistTaskRemaining]
  );

  const pauseTaskTimer = useCallback(() => {
    if (!activeTaskId) return;
    const pausedTaskId = activeTaskId;
    const pausedMeta = activeTaskMeta;
    const finalRemaining = remainingSeconds;

    // Announce the final remaining synchronously so rows can update their
    // optimistic copy before isActive flips to false in the same render.
    announceRemaining(pausedTaskId, finalRemaining);

    // Add elapsed to base daily total
    if (activeTaskStartRef.current) {
      const elapsed = Math.floor(
        (Date.now() - activeTaskStartRef.current) / 1000
      );
      setBaseDailySeconds((prev) => prev + elapsed);
    }

    // Atomically persist remaining + ended_at so a subsequent revalidate
    // can't race and read a stale timer_remaining_seconds.
    void stopTaskTimerAction(pausedTaskId, finalRemaining).catch(() => {});

    // Hold the task in "loaded" state so the transport bar can offer to
    // resume it without re-picking the piece.
    setLoadedTaskId(pausedTaskId);
    setLoadedTaskMeta(pausedMeta);
    setLoadedRemaining(finalRemaining);
    const loadedState: PersistedState = {
      taskId: pausedTaskId,
      remainingSeconds: finalRemaining,
      lastTickAt: new Date().toISOString(),
      meta: pausedMeta ?? undefined,
      status: "loaded",
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(loadedState));

    setActiveTaskId(null);
    setActiveTaskMeta(null);
    setActiveTaskElapsed(0);
    activeTaskStartRef.current = null;

    emitRunEvent({ type: "run-end", taskId: pausedTaskId, reason: "pause" });
  }, [activeTaskId, activeTaskMeta, remainingSeconds, announceRemaining]);

  const unloadLoadedTask = useCallback(() => {
    setLoadedTaskId(null);
    setLoadedTaskMeta(null);
    setLoadedRemaining(0);
    // Only clear storage if it holds a loaded state; don't clobber a running
    // task's persisted state.
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const state: PersistedState = JSON.parse(raw);
        if (state.status === "loaded") {
          localStorage.removeItem(STORAGE_KEY);
        }
      }
    } catch {
      // Ignore
    }
  }, []);

  const setTaskGoal = useCallback(
    (taskId: string, goalSeconds: number) => {
      if (activeTaskId === taskId) {
        // Preserve accrued time: only the goal changes. Remaining shifts by
        // the same delta so elapsed stays put. Don't touch activeTaskStartRef
        // or activeTaskElapsed — the daily total keeps ticking.
        const oldGoal = activeTaskMeta?.goalSeconds ?? goalSeconds;
        const newRemaining = remainingSeconds + (goalSeconds - oldGoal);
        setRemainingSeconds(newRemaining);
        setIsExpired(newRemaining <= 0);
        const nextMeta = activeTaskMeta
          ? { ...activeTaskMeta, goalSeconds }
          : null;
        setActiveTaskMeta(nextMeta);
        persist(taskId, newRemaining, nextMeta);
        return;
      }
      if (loadedTaskId === taskId) {
        const oldGoal = loadedTaskMeta?.goalSeconds ?? goalSeconds;
        const newLoadedRemaining =
          loadedRemaining + (goalSeconds - oldGoal);
        const nextMeta = loadedTaskMeta
          ? { ...loadedTaskMeta, goalSeconds }
          : null;
        setLoadedTaskMeta(nextMeta);
        setLoadedRemaining(newLoadedRemaining);
        // Update the persisted loaded state so a reload doesn't resurrect
        // the old goal.
        try {
          const raw = localStorage.getItem(STORAGE_KEY);
          if (raw) {
            const state: PersistedState = JSON.parse(raw);
            if (state.taskId === taskId && state.status === "loaded") {
              const nextState: PersistedState = {
                ...state,
                remainingSeconds: newLoadedRemaining,
                lastTickAt: new Date().toISOString(),
                meta: nextMeta ?? undefined,
              };
              localStorage.setItem(STORAGE_KEY, JSON.stringify(nextState));
            }
          }
        } catch {
          // Ignore
        }
      }
    },
    [
      activeTaskId,
      activeTaskMeta,
      loadedTaskId,
      loadedTaskMeta,
      loadedRemaining,
      remainingSeconds,
      persist,
    ]
  );

  const resetTaskTimer = useCallback(
    (taskId: string, seconds: number) => {
      // Reset ends the current run's segment; the reset run starts a new one.
      if (activeTaskId) {
        emitRunEvent({ type: "run-end", taskId: activeTaskId, reason: "reset" });
      }
      setActiveTaskId(taskId);
      setRemainingSeconds(seconds);
      setIsExpired(false);
      setActiveTaskElapsed(0);
      activeTaskStartRef.current = Date.now();
      persist(taskId, seconds, activeTaskMeta);
      emitRunEvent({
        type: "run-start",
        taskId,
        meta: activeTaskMeta,
        reason: "reset",
      });
    },
    [persist, activeTaskMeta, activeTaskId]
  );

  return (
    <TaskTimerContext.Provider
      value={{
        activeTaskId,
        activeTaskMeta,
        remainingSeconds,
        isExpired,
        dailyElapsedSeconds,
        activePieces,
        worksById,
        focusedPieceId,
        setFocusedPieceId,
        activePieceInstance,
        setActivePieceInstance,
        loadedTaskId,
        loadedTaskMeta,
        loadedRemaining,
        unloadLoadedTask,
        startTaskTimer,
        pauseTaskTimer,
        resetTaskTimer,
        setTaskGoal,
        refreshDailyTotal,
      }}
    >
      {children}
    </TaskTimerContext.Provider>
  );
}
