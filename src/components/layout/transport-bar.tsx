"use client";

import { useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { CheckIcon, ClockIcon } from "lucide-react";
import { useTaskTimer } from "@/components/timer/task-timer-context";
import { MetronomeControl } from "@/components/metronome/metronome-control";
import { Popover, PopoverContent } from "@/components/ui/popover";
import { formatElapsed } from "@/lib/timer-utils";
import {
  completeTask,
  createTask,
  getNextTaskForToday,
} from "@/app/practice/timer/task-actions";
import { localDate } from "@/lib/date-utils";
import {
  emitOptimisticTask,
  emitOptimisticTaskUpdate,
  rollbackOptimisticTask,
} from "@/lib/optimistic-task";
import type { Piece } from "@/lib/types";
import { cn } from "@/lib/utils";

const BAR_HEIGHT_PX = 72;

function formatSigned(seconds: number): string {
  const abs = Math.abs(seconds);
  const formatted = formatElapsed(abs);
  return seconds < 0 ? `+${formatted}` : formatted;
}

export function TransportBar() {
  const pathname = usePathname();
  const {
    activeTaskId,
    activeTaskMeta,
    remainingSeconds,
    isExpired,
    startTaskTimer,
    pauseTaskTimer,
    focusedPieceId,
    activePieces,
    loadedTaskId,
    loadedTaskMeta,
    loadedRemaining,
    unloadLoadedTask,
  } = useTaskTimer();

  const [piecePickerOpen, setPiecePickerOpen] = useState(false);
  const playButtonRef = useRef<HTMLButtonElement>(null);

  if (pathname !== "/practice") return null;

  const isActive = activeTaskId !== null;
  const isLoaded = !isActive && loadedTaskId !== null;
  const focusedPiece = focusedPieceId
    ? activePieces.find((p) => p.id === focusedPieceId) ?? null
    : null;

  const startTimerForPiece = async (piece: Piece) => {
    const existing = await getNextTaskForToday(piece.id);
    if (existing) {
      startTaskTimer(existing.id, existing.timer_remaining_seconds, {
        pieceId: piece.id,
        pieceName: piece.name,
        pieceComposer: piece.composer,
        pieceKind: piece.kind,
        sectionLabel: null,
        sectionStatus: null,
        text: existing.text,
        goalSeconds: existing.timer_seconds,
        metronomeSpeed: existing.metronome_speed,
        date: existing.date,
      });
      return;
    }
    const today = localDate();
    const tempId = emitOptimisticTask({
      pieceId: piece.id,
      sectionId: null,
      date: today,
      metronomeSpeed: null,
      pieceName: piece.name,
      pieceComposer: piece.composer,
      pieceKind: piece.kind,
      sectionLabel: null,
      sectionStatus: null,
    });
    try {
      const { id, timer_seconds, timer_remaining_seconds } = await createTask(
        piece.id,
        null,
        null,
        today
      );
      startTaskTimer(id, timer_remaining_seconds, {
        pieceId: piece.id,
        pieceName: piece.name,
        pieceComposer: piece.composer,
        pieceKind: piece.kind,
        sectionLabel: null,
        sectionStatus: null,
        text: "",
        goalSeconds: timer_seconds,
        metronomeSpeed: null,
        date: today,
      });
    } catch (err) {
      rollbackOptimisticTask(tempId);
      throw err;
    }
  };

  const handlePlayPauseClick = async () => {
    if (isActive) {
      pauseTaskTimer();
      return;
    }
    if (isLoaded && loadedTaskId && loadedTaskMeta) {
      startTaskTimer(loadedTaskId, loadedRemaining, loadedTaskMeta);
      return;
    }
    if (focusedPiece) {
      await startTimerForPiece(focusedPiece);
      return;
    }
    setPiecePickerOpen(true);
  };

  // Finishing an item happens here, at the end of the work, rather than at a
  // checkbox sitting next to the row's start button. Hand the completion to the
  // task's own row so the follow-up dialog and auto-advance still run; only if
  // that row isn't mounted (filtered out of the current view) do we complete it
  // directly, so the bar is never a dead end.
  const handleDone = () => {
    const taskId = activeTaskId ?? loadedTaskId;
    if (!taskId) return;

    const detail = { taskId, handled: false };
    window.dispatchEvent(new CustomEvent("task-request-complete", { detail }));
    if (detail.handled) return;

    if (isActive) pauseTaskTimer();
    unloadLoadedTask();
    emitOptimisticTaskUpdate(taskId, { completed: true });
    void completeTask(taskId);
  };

  const handlePickPiece = async (piece: Piece) => {
    setPiecePickerOpen(false);
    await startTimerForPiece(piece);
  };

  const displayMeta = activeTaskMeta ?? loadedTaskMeta;
  const displayRemaining = isActive ? remainingSeconds : loadedRemaining;
  const pieceName = displayMeta?.pieceName ?? null;
  const sectionLabel = displayMeta?.sectionLabel ?? null;
  const text = displayMeta?.text ?? "";
  const goalSeconds = displayMeta?.goalSeconds ?? 0;
  const elapsed =
    goalSeconds > 0 ? Math.max(0, goalSeconds - displayRemaining) : 0;
  const progressPct =
    goalSeconds > 0 ? Math.min(100, (elapsed / goalSeconds) * 100) : 0;
  const hasTask = isActive || isLoaded;

  return (
    <>
      <div aria-hidden style={{ height: BAR_HEIGHT_PX }} />
      <div
        className={cn(
          "fixed inset-x-0 bottom-0 z-40 border-t transition-colors",
          isActive &&
            !isExpired &&
            "border-red-400/60 bg-red-500 text-white shadow-[0_-8px_24px_-12px_rgba(220,38,38,0.45)]",
          isActive &&
            isExpired &&
            "border-red-400/60 text-white shadow-[0_-8px_24px_-12px_rgba(220,38,38,0.45)] animate-transport-pulse",
          !isActive &&
            "border-border bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80"
        )}
        style={{ height: BAR_HEIGHT_PX }}
        role="region"
        aria-label="Practice transport"
      >
        <div className="mx-auto flex h-full max-w-7xl items-center gap-3 px-4 sm:gap-4 sm:px-6">
          <button
            ref={playButtonRef}
            onClick={handlePlayPauseClick}
            className={cn(
              "flex size-11 shrink-0 items-center justify-center rounded-full transition-colors",
              !isActive &&
                "bg-muted text-foreground hover:bg-muted-foreground/20",
              isActive && "bg-white text-red-600 hover:bg-white/90 shadow-sm"
            )}
            aria-label={
              isActive
                ? "Stop practice timer"
                : isLoaded
                  ? "Resume practice timer"
                  : "Start practice timer"
            }
          >
            <ClockIcon className="size-5" />
          </button>

          <Popover open={piecePickerOpen} onOpenChange={setPiecePickerOpen}>
            <PopoverContent
              anchor={playButtonRef}
              align="start"
              side="top"
              sideOffset={8}
              className="w-56 p-1 gap-0"
            >
              <div className="px-2 py-1.5 text-xs text-muted-foreground">
                What are you practicing?
              </div>
              <ul className="flex max-h-72 flex-col overflow-auto">
                {activePieces.map((piece) => (
                  <li key={piece.id}>
                    <button
                      type="button"
                      onClick={() => handlePickPiece(piece)}
                      className="flex w-full items-center rounded-sm px-2 py-1.5 text-sm text-left hover:bg-muted"
                    >
                      {piece.name}
                    </button>
                  </li>
                ))}
                {activePieces.length === 0 && (
                  <li className="px-2 py-1.5 text-xs text-muted-foreground">
                    No active pieces.
                  </li>
                )}
              </ul>
            </PopoverContent>
          </Popover>

          <div className="min-w-0 flex-1">
            {hasTask ? (
              <>
                <div className="flex items-baseline gap-1.5 text-sm">
                  <span
                    className={cn(
                      "truncate font-medium",
                      isLoaded && "text-muted-foreground"
                    )}
                  >
                    {pieceName ?? "Practice"}
                  </span>
                  {sectionLabel && (
                    <span
                      className={cn(
                        "shrink-0 text-xs",
                        isActive ? "text-white/80" : "text-muted-foreground"
                      )}
                    >
                      · {sectionLabel}
                    </span>
                  )}
                  {text && (
                    <span
                      className={cn(
                        "hidden truncate text-xs italic sm:inline",
                        isActive ? "text-white/70" : "text-muted-foreground"
                      )}
                    >
                      — {text}
                    </span>
                  )}
                </div>
                <div className="mt-1.5 flex items-center gap-2.5">
                  <span
                    className={cn(
                      "font-mono text-sm tabular-nums",
                      isLoaded && "text-muted-foreground"
                    )}
                  >
                    {formatElapsed(elapsed)}
                  </span>
                  <div
                    className={cn(
                      "relative h-1.5 flex-1 overflow-hidden rounded-full",
                      isActive ? "bg-white/25" : "bg-muted"
                    )}
                  >
                    <div
                      className={cn(
                        "h-full transition-[width] duration-1000 ease-linear",
                        isExpired
                          ? "bg-emerald-500"
                          : isActive
                            ? "bg-white"
                            : "bg-muted-foreground/40"
                      )}
                      style={{ width: `${progressPct}%` }}
                    />
                  </div>
                  <span
                    className={cn(
                      "font-mono text-sm tabular-nums",
                      isExpired && "font-semibold",
                      isLoaded && "text-muted-foreground"
                    )}
                  >
                    {isExpired
                      ? `${formatSigned(displayRemaining)} over`
                      : `${formatSigned(displayRemaining)} left`}
                  </span>
                </div>
              </>
            ) : (
              <div className="flex items-baseline gap-1.5 text-sm">
                <span className="font-medium text-muted-foreground">
                  Ready to practice
                </span>
                {focusedPiece && (
                  <span className="truncate text-xs text-muted-foreground">
                    · {focusedPiece.name}
                  </span>
                )}
              </div>
            )}
          </div>

          {hasTask && (
            <button
              type="button"
              onClick={handleDone}
              aria-label="Mark this item done"
              title="Mark done"
              className={cn(
                "flex shrink-0 items-center gap-1.5 rounded-full px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-white/20 text-white hover:bg-white/30"
                  : "bg-muted text-muted-foreground hover:bg-muted-foreground/20 hover:text-foreground"
              )}
            >
              <CheckIcon className="size-4" />
              <span className="hidden sm:inline">Done</span>
            </button>
          )}

          <div className="shrink-0">
            <MetronomeControl onAccent={isActive} />
          </div>
        </div>
      </div>
    </>
  );
}
