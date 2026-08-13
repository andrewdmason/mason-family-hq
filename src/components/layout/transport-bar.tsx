"use client";

import { useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { SquareIcon, PlayIcon, MicIcon, MicOffIcon } from "lucide-react";
import { useTaskTimer } from "@/components/timer/task-timer-context";
import {
  useCaptureStatus,
  setAutoRecordPreference,
} from "@/components/practice/capture-controller";
import { MetronomeControl } from "@/components/metronome/metronome-control";
import { Popover, PopoverContent } from "@/components/ui/popover";
import { formatElapsed } from "@/lib/timer-utils";
import {
  createTask,
  getNextTaskForToday,
} from "@/app/practice/timer/task-actions";
import { localDate } from "@/lib/date-utils";
import {
  emitOptimisticTask,
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
  } = useTaskTimer();

  const [piecePickerOpen, setPiecePickerOpen] = useState(false);
  const playButtonRef = useRef<HTMLButtonElement>(null);
  const capture = useCaptureStatus();

  const isActive = activeTaskId !== null;
  const isLoaded = !isActive && loadedTaskId !== null;

  // The bar lives on the practice home always, and follows the user to every
  // route under the practice layout whenever a timer is active or loaded —
  // so a running (possibly recording) task is never invisible.
  if (pathname !== "/practice" && !isActive && !isLoaded) return null;
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

  // Auto-record indicator (plan U4, R4): quiet states only, never blocking.
  // "not-recording" = toggle on + timer running but this run isn't recording
  // (restored timer / second tab); "mic-unavailable" = gUM failed or the
  // track died mid-run — the timer keeps going either way.
  const captureState:
    | "off"
    | "armed"
    | "recording"
    | "mic-unavailable"
    | "not-recording" = !capture.enabled
    ? "off"
    : capture.recording
      ? "recording"
      : isActive && capture.micUnavailable
        ? "mic-unavailable"
        : isActive
          ? "not-recording"
          : "armed";
  const captureTitle = {
    off: "Auto-record off",
    armed: "Auto-record on — timed tasks will record",
    recording: capture.silent
      ? "Recording — no input heard, check the microphone"
      : "Recording",
    "mic-unavailable":
      "Microphone unavailable — the timer keeps running without recording",
    "not-recording":
      "Not recording — restored timers don't auto-record; press play to start a recorded run",
  }[captureState];

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
            {isActive ? (
              <SquareIcon className="size-5 fill-current" />
            ) : (
              <PlayIcon className="size-5 fill-current" />
            )}
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

          <div className="flex shrink-0 items-center gap-1.5">
            {captureState === "recording" && (
              <div
                className="flex items-center gap-1.5"
                title={captureTitle}
                aria-label={captureTitle}
              >
                <span
                  className={cn(
                    "size-2 shrink-0 animate-pulse rounded-full",
                    capture.silent
                      ? "bg-amber-300"
                      : isActive
                        ? "bg-white"
                        : "bg-red-500"
                  )}
                />
                <div
                  className={cn(
                    "h-1 w-10 overflow-hidden rounded-full",
                    isActive ? "bg-white/25" : "bg-muted"
                  )}
                  aria-hidden
                >
                  <div
                    className={cn(
                      "h-full transition-[width] duration-75",
                      capture.silent
                        ? "bg-amber-300"
                        : isActive
                          ? "bg-white"
                          : "bg-emerald-500"
                    )}
                    style={{ width: `${Math.round(capture.level * 100)}%` }}
                  />
                </div>
                {capture.silent && (
                  <span
                    className={cn(
                      "hidden text-[10px] font-medium sm:inline",
                      isActive ? "text-amber-200" : "text-destructive"
                    )}
                  >
                    No input
                  </span>
                )}
              </div>
            )}
            {(captureState === "mic-unavailable" ||
              captureState === "not-recording") && (
              <span
                className={cn(
                  "hidden text-[10px] sm:inline",
                  captureState === "mic-unavailable"
                    ? isActive
                      ? "text-amber-200"
                      : "text-amber-600"
                    : isActive
                      ? "text-white/60"
                      : "text-muted-foreground"
                )}
                title={captureTitle}
              >
                {captureState === "mic-unavailable"
                  ? "Mic unavailable"
                  : "Not recording"}
              </span>
            )}
            <button
              type="button"
              onClick={() => setAutoRecordPreference(!capture.enabled)}
              title={captureTitle}
              aria-label={
                capture.enabled ? "Turn auto-record off" : "Turn auto-record on"
              }
              aria-pressed={capture.enabled}
              className={cn(
                "flex size-8 shrink-0 items-center justify-center rounded-full transition-colors",
                isActive
                  ? "hover:bg-white/15"
                  : "hover:bg-muted",
                captureState === "off" &&
                  (isActive ? "text-white/40" : "text-muted-foreground/60"),
                captureState === "armed" &&
                  (isActive ? "text-white/80" : "text-muted-foreground"),
                captureState === "recording" &&
                  (isActive ? "text-white" : "text-foreground"),
                captureState === "mic-unavailable" &&
                  (isActive ? "text-amber-200" : "text-amber-600"),
                captureState === "not-recording" &&
                  (isActive ? "text-white/60" : "text-muted-foreground")
              )}
            >
              {capture.enabled &&
              captureState !== "mic-unavailable" &&
              captureState !== "not-recording" ? (
                <MicIcon className="size-4" />
              ) : (
                <MicOffIcon className="size-4" />
              )}
            </button>
            <MetronomeControl onAccent={isActive} />
          </div>
        </div>
      </div>
    </>
  );
}
