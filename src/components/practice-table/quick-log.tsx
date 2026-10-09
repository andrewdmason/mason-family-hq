"use client";

import { useMemo } from "react";
import { useTaskTimer } from "@/components/timer/task-timer-context";
import {
  createTaskOptimistic,
  emitOptimisticTask,
} from "@/lib/optimistic-task";
import { pickMaintenancePiece } from "@/lib/practice/maintenance";
import {
  buildQuickCards,
  daysSinceText,
  formatQuickClock,
  formatQuickTotal,
  pickQuickLogTask,
  taskElapsedSeconds,
  type QuickCard,
} from "@/lib/practice/quick-log";
import { cn } from "@/lib/utils";
import type { FeedDay, Piece, TaskWithDetails } from "@/lib/types";

type PieceState = {
  running: boolean;
  /** Practice today, including the live seconds of a running timer. */
  elapsedSeconds: number;
  goalSeconds: number;
  playedToday: boolean;
  lastPracticed: string | undefined;
};

/**
 * Today as a wall of cards, one per active piece: tap to start its timer, tap
 * again to stop. Everything a tap does shows at once — it picks (or creates)
 * the day's entry for the piece and starts timing it before the server has
 * answered.
 */
export function QuickLog({ day, today }: { day: FeedDay; today: string }) {
  const {
    activePieces,
    worksById,
    activeTaskId,
    activeTaskMeta,
    remainingSeconds,
    startTaskTimer,
    pauseTaskTimer,
  } = useTaskTimer();

  const { current, maintenance } = useMemo(
    () => buildQuickCards(activePieces, worksById),
    [activePieces, worksById]
  );

  const tasksByPiece = useMemo(() => {
    const map = new Map<string, TaskWithDetails[]>();
    for (const t of day.tasks) {
      if (!t.piece_id) continue;
      map.set(t.piece_id, [...(map.get(t.piece_id) ?? []), t]);
    }
    return map;
  }, [day.tasks]);

  // The running task may be one the day hasn't caught up with yet (created a
  // moment ago), so the timer's own record of it decides which piece is live.
  const activeTask = activeTaskId
    ? day.tasks.find((t) => t.id === activeTaskId)
    : undefined;
  const runningPieceId =
    activeTaskId &&
    (activeTaskMeta ? activeTaskMeta.date === today : !!activeTask)
      ? (activeTaskMeta?.pieceId ?? activeTask?.piece_id ?? null)
      : null;
  const activeGoal = activeTaskMeta?.goalSeconds ?? activeTask?.timer_seconds ?? 0;

  const stateFor = (piece: Piece): PieceState => {
    const tasks = tasksByPiece.get(piece.id) ?? [];
    const running = runningPieceId === piece.id;
    let elapsedSeconds = 0;
    let goalSeconds = 0;
    for (const t of tasks) {
      goalSeconds += Math.max(0, t.timer_seconds);
      if (running && t.id === activeTaskId) continue;
      elapsedSeconds += taskElapsedSeconds(t);
    }
    if (running) {
      elapsedSeconds += Math.max(0, activeGoal - remainingSeconds);
      if (!tasks.some((t) => t.id === activeTaskId)) goalSeconds += activeGoal;
    }
    return {
      running,
      elapsedSeconds,
      goalSeconds,
      playedToday: running || elapsedSeconds > 0,
      lastPracticed: day.lastPracticedByPiece?.[piece.id],
    };
  };

  const tap = (piece: Piece) => {
    if (runningPieceId === piece.id) {
      pauseTaskTimer();
      return;
    }

    const target = pickQuickLogTask(tasksByPiece.get(piece.id) ?? []);
    if (target) {
      startTaskTimer(target.id, target.timer_remaining_seconds, {
        pieceId: piece.id,
        pieceName: piece.name,
        pieceComposer: piece.composer,
        pieceKind: piece.kind,
        sectionLabel: target.section_label,
        sectionStatus: target.section_status,
        text: target.text,
        goalSeconds: target.timer_seconds,
        metronomeSpeed: target.metronome_speed,
        date: today,
      });
      return;
    }

    // Nothing for this piece today: put an entry on the board and time it in
    // the same moment. The timer runs on the optimistic id and its writes wait
    // for the real one.
    const sessionNumber = day.tasks.reduce(
      (max, t) => Math.max(max, t.session_number ?? 1),
      1
    );
    const detail = {
      pieceId: piece.id,
      sectionId: null,
      date: today,
      metronomeSpeed: null,
      pieceName: piece.name,
      pieceComposer: piece.composer,
      pieceKind: piece.kind,
      sectionLabel: null,
      sectionStatus: null,
      sessionNumber,
    };
    const tempId = emitOptimisticTask(detail);
    startTaskTimer(tempId, 0, {
      pieceId: piece.id,
      pieceName: piece.name,
      pieceComposer: piece.composer,
      pieceKind: piece.kind,
      sectionLabel: null,
      sectionStatus: null,
      text: "",
      goalSeconds: 0,
      metronomeSpeed: null,
      date: today,
    });
    void createTaskOptimistic({ ...detail, existingTempId: tempId }).catch(
      () => {}
    );
  };

  // The rotation's next piece gets a quiet highlight, the same pick the
  // list's maintenance button would offer.
  const dueMaintenanceId = useMemo(
    () =>
      pickMaintenancePiece({
        pieces: activePieces,
        lastPracticedByPiece: day.lastPracticedByPiece ?? {},
        excluded: new Set(tasksByPiece.keys()),
        asOf: today,
      })?.piece.id ?? null,
    [activePieces, day.lastPracticedByPiece, tasksByPiece, today]
  );

  if (current.length === 0 && maintenance.length === 0) {
    return (
      <p className="py-8 text-sm text-muted-foreground">
        No active pieces. Mark some active in the repertoire to log them here.
      </p>
    );
  }

  return (
    <div className="space-y-8 pb-8">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {current.map((card) => (
          <QuickCardView
            key={card.key}
            card={card}
            size="lg"
            stateFor={stateFor}
            today={today}
            onTap={tap}
          />
        ))}
      </div>

      {maintenance.length > 0 && (
        <section>
          <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Maintenance
          </h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
            {maintenance.map((card) => (
              <QuickCardView
                key={card.key}
                card={card}
                size="sm"
                stateFor={stateFor}
                today={today}
                onTap={tap}
                dueId={dueMaintenanceId}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function QuickCardView({
  card,
  size,
  stateFor,
  today,
  onTap,
  dueId,
}: {
  card: QuickCard;
  size: "lg" | "sm";
  stateFor: (piece: Piece) => PieceState;
  today: string;
  onTap: (piece: Piece) => void;
  dueId?: string | null;
}) {
  if (card.pieces.length === 1) {
    const piece = card.pieces[0];
    return (
      <PieceButton
        piece={piece}
        label={card.title}
        state={stateFor(piece)}
        today={today}
        size={size}
        due={dueId === piece.id}
        onTap={onTap}
        className="rounded-xl border"
      />
    );
  }

  // A work with several pieces: one card, a segment per movement.
  const states = card.pieces.map(stateFor);
  const anyRunning = states.some((s) => s.running);
  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden rounded-xl border bg-card",
        size === "lg" && "sm:col-span-2",
        anyRunning && "border-red-500/60"
      )}
    >
      <div className="border-b px-4 pt-2.5 pb-2 text-xs font-medium text-muted-foreground">
        {card.title}
      </div>
      <div className="flex flex-1 divide-x">
        {card.pieces.map((piece, i) => (
          <PieceButton
            key={piece.id}
            piece={piece}
            label={piece.name}
            state={states[i]}
            today={today}
            size={size}
            due={dueId === piece.id}
            onTap={onTap}
            className="flex-1"
          />
        ))}
      </div>
    </div>
  );
}

function PieceButton({
  piece,
  label,
  state,
  today,
  size,
  due,
  onTap,
  className,
}: {
  piece: Piece;
  label: string;
  state: PieceState;
  today: string;
  size: "lg" | "sm";
  due: boolean;
  onTap: (piece: Piece) => void;
  className?: string;
}) {
  const { running, elapsedSeconds, goalSeconds, playedToday } = state;
  const progress =
    goalSeconds > 0 ? Math.min(1, elapsedSeconds / goalSeconds) : 0;
  const goalReached = goalSeconds > 0 && elapsedSeconds >= goalSeconds;

  const status = running
    ? formatQuickClock(elapsedSeconds)
    : playedToday
      ? `Today · ${formatQuickTotal(elapsedSeconds)}`
      : daysSinceText(state.lastPracticed, today);

  return (
    <button
      type="button"
      onClick={() => onTap(piece)}
      aria-pressed={running}
      className={cn(
        "relative flex min-w-0 flex-col items-start justify-between gap-1 overflow-hidden bg-card text-left transition-[background-color,transform] duration-100 select-none active:scale-[0.985]",
        "hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        size === "lg" ? "min-h-24 px-4 py-3.5" : "min-h-16 px-3 py-2.5",
        due && !running && "border-amber-400/70 bg-amber-50/60 dark:bg-amber-500/10",
        running &&
          "border-red-500/60 bg-red-50 hover:bg-red-100/70 dark:bg-red-500/10 dark:hover:bg-red-500/15",
        className
      )}
    >
      <span className="flex w-full min-w-0 items-start gap-2">
        <span
          className={cn(
            "min-w-0 flex-1 truncate font-medium",
            size === "lg" ? "text-base" : "text-sm"
          )}
        >
          {label}
        </span>
        {running && (
          <span className="mt-1.5 size-2.5 shrink-0 rounded-full bg-red-500" />
        )}
      </span>
      <span
        className={cn(
          "tabular-nums",
          size === "lg" ? "text-sm" : "text-xs",
          running
            ? "font-medium text-red-700 dark:text-red-300"
            : playedToday
              ? "text-foreground/80"
              : "text-muted-foreground"
        )}
      >
        {status}
      </span>
      {goalSeconds > 0 && (
        <span className="absolute inset-x-0 bottom-0 h-1 bg-muted">
          <span
            className={cn(
              "block h-full transition-[width] duration-500",
              goalReached
                ? "bg-emerald-500"
                : running
                  ? "bg-red-500/70"
                  : "bg-foreground/30"
            )}
            style={{ width: `${progress * 100}%` }}
          />
        </span>
      )}
    </button>
  );
}
