"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  GripVerticalIcon,
  PlusIcon,
  CircleIcon,
  CopyPlusIcon,
  MicIcon,
  Trash2Icon,
  MetronomeIcon,
  ArrowRightIcon,
  CalendarArrowUpIcon,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useTaskTimer } from "@/components/timer/task-timer-context";
import { useMetronome } from "@/components/metronome/metronome-context";
import { TimerCell } from "@/components/practice-table/timer-cell";
import {
  updateTaskField,
  updateTaskRemaining,
  updateTaskSection,
  updateTaskSession,
  deleteTask,
  duplicateTask,
  moveTaskToDate,
  completeTask,
  uncompleteTask,
} from "@/app/practice/timer/task-actions";
import {
  emitOptimisticTask,
  emitOptimisticTaskDelete,
  emitOptimisticTaskRename,
  emitOptimisticTaskUpdate,
  rollbackOptimisticTask,
  type FocusTaskNotesDetail,
} from "@/lib/optimistic-task";
import { TaskAudioDialog } from "@/components/practice-table/task-audio-dialog";
import { TaskRecordings } from "@/components/practice-table/task-recordings";
import { FollowUpDialog } from "@/components/practice-table/follow-up-dialog";
import {
  getCachedSectionPickerData,
  loadSectionPickerData,
  type SectionPickerData,
} from "@/lib/section-picker-cache";
import { localDate } from "@/lib/date-utils";
import { practiceTempo } from "@/lib/section-utils";
import type { PieceSection, TaskWithDetails, SectionStatus } from "@/lib/types";
import { SECTION_STATUS_DOT_COLORS } from "@/lib/types";
import { cn } from "@/lib/utils";

export function TaskRow({
  task,
  isFirst,
  onAddBelow,
  daySessionNumbers,
  sessionNumbersByDate,
}: {
  task: TaskWithDetails;
  isFirst: boolean;
  onAddBelow: (afterTaskId: string) => void;
  daySessionNumbers: number[];
  sessionNumbersByDate: Record<string, number[]>;
}) {
  const {
    activeTaskId,
    remainingSeconds,
    startTaskTimer,
    pauseTaskTimer,
    loadedTaskId,
    unloadLoadedTask,
    setTaskGoal,
  } = useTaskTimer();

  const isActive = activeTaskId === task.id;

  const activeRowBg = "bg-red-500";
  const activeBorderClasses =
    "border-r border-red-400 border-b-red-400 border-t-red-400";
  const activeSectionBorderClasses =
    "border-r border-red-400 border-b-red-400 border-l-red-400 border-t-red-400";
  const activeNotesBorderClasses =
    "border-r-red-400 border-b-red-400 border-t-red-400";

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const metronomeCtx = useMetronome();

  const [text, setText] = useState(task.text);
  const [metronome, setMetronome] = useState(
    task.metronome_speed?.toString() ?? ""
  );
  const [editingMetronome, setEditingMetronome] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [optimisticCompleted, setOptimisticCompleted] = useState(task.completed);
  const [optimisticGoalSeconds, setOptimisticGoalSeconds] = useState(
    task.timer_seconds
  );
  const [optimisticSection, setOptimisticSection] = useState<{
    sectionId: string | null;
    label: string | null;
    status: SectionStatus | null;
  }>({
    sectionId: task.section_id,
    label: task.section_label,
    status: task.section_status,
  });
  const [optimisticMetronomeSpeed, setOptimisticMetronomeSpeed] = useState<
    number | null
  >(task.metronome_speed);
  const [optimisticRemaining, setOptimisticRemaining] = useState(
    task.timer_remaining_seconds
  );
  const [sectionPickerOpen, setSectionPickerOpen] = useState(false);
  const [sectionPickerData, setSectionPickerData] =
    useState<SectionPickerData | null>(
      task.piece_id ? getCachedSectionPickerData(task.piece_id) : null
    );
  const [noteOpen, setNoteOpen] = useState(false);
  const [audioDialogOpen, setAudioDialogOpen] = useState(false);
  const [audioDialogMode, setAudioDialogMode] = useState<"record" | "playback">(
    "record"
  );
  const [followUpOpen, setFollowUpOpen] = useState(false);
  const hasAudio = !!task.audio_path;
  const openAudioDialog = useCallback(
    (mode: "record" | "playback") => {
      setAudioDialogMode(mode);
      setAudioDialogOpen(true);
    },
    []
  );
  const noteTextareaRef = useRef<HTMLTextAreaElement>(null);
  const noteInputRef = useRef<HTMLInputElement>(null);
  const metronomeRef = useRef<HTMLInputElement>(null);
  const gripButtonRef = useRef<HTMLButtonElement>(null);
  const gripPointerStart = useRef<{ x: number; y: number } | null>(null);

  const handleGripPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    gripPointerStart.current = { x: e.clientX, y: e.clientY };
    listeners?.onPointerDown?.(e);
  };

  const handleGripPointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    const start = gripPointerStart.current;
    gripPointerStart.current = null;
    if (!start) return;
    const moved = Math.hypot(e.clientX - start.x, e.clientY - start.y) >= 5;
    if (!moved) setMenuOpen((prev) => !prev);
  };

  // Sync optimistic state when server revalidation brings a new value
  useEffect(() => {
    setOptimisticCompleted(task.completed);
  }, [task.completed]);
  useEffect(() => {
    setOptimisticGoalSeconds(task.timer_seconds);
  }, [task.timer_seconds]);
  useEffect(() => {
    setOptimisticSection({
      sectionId: task.section_id,
      label: task.section_label,
      status: task.section_status,
    });
  }, [task.section_id, task.section_label, task.section_status]);
  useEffect(() => {
    setOptimisticMetronomeSpeed(task.metronome_speed);
    setMetronome(task.metronome_speed?.toString() ?? "");
  }, [task.metronome_speed]);
  // Adopt the server's remaining only when the server value itself changes.
  // If this also ran on isActive transitions, stopping the timer would briefly
  // revert to a stale prop before revalidation lands.
  useEffect(() => {
    setOptimisticRemaining(task.timer_remaining_seconds);
  }, [task.timer_remaining_seconds]);

  // Adopt the server's text when it changes — but not while the user is editing.
  const [prevServerText, setPrevServerText] = useState(task.text);
  if (task.text !== prevServerText) {
    setPrevServerText(task.text);
    if (!noteOpen) setText(task.text);
  }

  const autoGrowNote = useCallback(() => {
    const el = noteTextareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  const isNoteOverflowing = useCallback(() => {
    const el = noteInputRef.current;
    if (!el) return false;
    return el.scrollWidth > el.clientWidth;
  }, []);

  const openNotePopover = useCallback(() => {
    setNoteOpen(true);
    requestAnimationFrame(() => {
      const el = noteTextareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
      autoGrowNote();
    });
  }, [autoGrowNote]);

  const handleNoteOpenChange = (open: boolean) => {
    if (!open) {
      if (text !== task.text) {
        void updateTaskField(task.id, "text", text);
      }
      setNoteOpen(false);
    }
  };

  const handleInlineNoteChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setText(e.target.value);
    requestAnimationFrame(() => {
      if (isNoteOverflowing()) openNotePopover();
    });
  };

  const handleInlineNoteClick = () => {
    if (isNoteOverflowing()) openNotePopover();
  };

  const handleInlineNoteBlur = () => {
    if (noteOpen) return;
    if (text !== task.text) {
      void updateTaskField(task.id, "text", text);
    }
  };

  const handleInlineNoteKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === "Escape") {
      e.preventDefault();
      e.currentTarget.blur();
    }
  };

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as {
        taskId: string;
        remainingSeconds: number;
      };
      if (detail.taskId === task.id) {
        setOptimisticRemaining(detail.remainingSeconds);
      }
    };
    window.addEventListener("task-timer-paused", handler);
    return () => window.removeEventListener("task-timer-paused", handler);
  }, [task.id]);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<FocusTaskNotesDetail>).detail;
      if (detail.taskId !== task.id) return;
      const el = noteInputRef.current;
      if (!el) return;
      el.focus();
      if (detail.selectAll && el.value.length > 0) {
        el.select();
      }
    };
    window.addEventListener("task-focus-notes", handler);
    return () => window.removeEventListener("task-focus-notes", handler);
  }, [task.id]);

  const elapsed =
    optimisticGoalSeconds -
    (isActive ? remainingSeconds : optimisticRemaining);

  const handleTimerClick = () => {
    if (isActive) {
      pauseTaskTimer();
    } else {
      startTaskTimer(task.id, optimisticRemaining, {
        pieceId: task.piece_id,
        pieceName: task.piece_name,
        pieceComposer: task.piece_composer,
        pieceKind: task.piece_kind,
        sectionLabel: optimisticSection.label,
        sectionStatus: optimisticSection.status,
        text: text,
        goalSeconds: optimisticGoalSeconds,
        metronomeSpeed: optimisticMetronomeSpeed,
        date: task.date,
      });
    }
  };

  const handleMetronomeBlur = () => {
    const val = metronome.trim();
    const num = val ? parseInt(val, 10) : null;
    if (num !== optimisticMetronomeSpeed) {
      setOptimisticMetronomeSpeed(num);
      void updateTaskField(task.id, "metronome_speed", num);
    }
    setEditingMetronome(false);
  };

  const isMetronomeActiveForThisTask =
    metronomeCtx.isActive && metronomeCtx.activeSourceId === task.id;

  const displayedMetronomeSpeed = isMetronomeActiveForThisTask
    ? metronomeCtx.bpm
    : optimisticMetronomeSpeed;

  const handleMetronomePillClick = () => {
    if (!optimisticMetronomeSpeed) return;
    if (isMetronomeActiveForThisTask) {
      metronomeCtx.stop();
    } else {
      metronomeCtx.start(optimisticMetronomeSpeed, task.id);
    }
  };

  const handleMetronomeRightClick = (e: React.MouseEvent) => {
    e.preventDefault();
    setEditingMetronome(true);
    requestAnimationFrame(() => metronomeRef.current?.focus());
  };

  const handleComplete = () => {
    const nextValue = !optimisticCompleted;
    setOptimisticCompleted(nextValue);
    if (nextValue) {
      const wasActive = isActive;
      if (wasActive) pauseTaskTimer();
      // If this task is the one the transport bar has loaded (either the
      // running task we just paused, or a previously-paused task), clear
      // it so the bar doesn't offer to resume a completed task.
      if (loadedTaskId === task.id || wasActive) unloadLoadedTask();
      void completeTask(task.id);
      if (wasActive) {
        window.dispatchEvent(
          new CustomEvent("task-auto-advance", {
            detail: { completedTaskId: task.id, dayDate: task.date },
          })
        );
      }
      // Kick off section data fetch in parallel with dialog open so the
      // picker is warm by the time the user reaches for it.
      if (task.piece_id) void loadSectionPickerData(task.piece_id);
      setFollowUpOpen(true);
      window.dispatchEvent(
        new CustomEvent("follow-up-dialog-opened", {
          detail: { dayDate: task.date, taskId: task.id },
        })
      );
    } else {
      void uncompleteTask(task.id);
    }
  };

  const tomorrowDate = (() => {
    const d = new Date(task.date + "T12:00:00");
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  })();
  const dayAfterDate = (() => {
    const d = new Date(task.date + "T12:00:00");
    d.setDate(d.getDate() + 2);
    return d.toISOString().slice(0, 10);
  })();

  const handleSectionPickerOpenChange = (open: boolean) => {
    setSectionPickerOpen(open);
    if (open && task.piece_id && !sectionPickerData) {
      void loadSectionPickerData(task.piece_id)
        .then(setSectionPickerData)
        .catch(() => {});
    }
  };

  const handleSelectSection = (section: PieceSection) => {
    const effectiveTempo =
      section.target_tempo ?? sectionPickerData?.pieceTargetTempo ?? null;
    const computedTempo = practiceTempo(section.status, effectiveTempo);

    setOptimisticSection({
      sectionId: section.id,
      label: section.label,
      status: section.status,
    });

    // Only overwrite the metronome if the section yields a concrete tempo;
    // otherwise leave whatever the user had set.
    const metronomeArg = computedTempo ?? undefined;
    if (computedTempo !== null) {
      setOptimisticMetronomeSpeed(computedTempo);
      setMetronome(computedTempo.toString());
    }

    setSectionPickerOpen(false);
    void updateTaskSection(task.id, section.id, metronomeArg);
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "group/task",
        isDragging && "opacity-50",
      )}
    >
      <div className="flex items-stretch">
      {/* Gutter — sits in the page's pl-8 padding area, like Notion */}
      <div className={cn(
        "-ml-8 w-8 shrink-0 flex items-center justify-center gap-0 transition-opacity",
        menuOpen ? "opacity-100" : "opacity-0 group-hover/task:opacity-100",
      )}>
        <button
          onClick={() => onAddBelow(task.id)}
          className="flex items-center justify-center w-4 h-6 rounded-sm text-muted-foreground/60 hover:text-foreground hover:bg-muted transition-colors"
        >
          <PlusIcon className="size-3.5" />
        </button>
        <button
          ref={gripButtonRef}
          type="button"
          {...attributes}
          onPointerDown={handleGripPointerDown}
          onPointerUp={handleGripPointerUp}
          className="flex items-center justify-center w-4 h-6 cursor-grab rounded-sm text-muted-foreground/60 hover:text-foreground hover:bg-muted transition-colors"
        >
          <GripVerticalIcon className="size-3.5" />
        </button>
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuContent
            anchor={gripButtonRef}
            align="start"
            side="bottom"
            className="w-48"
          >
            <DropdownMenuItem
              onClick={async () => {
                const today = localDate();
                const isToday = task.date === today;
                let targetDate: string;
                if (isToday) {
                  const d = new Date(task.date + "T12:00:00");
                  d.setDate(d.getDate() + 1);
                  targetDate = d.toISOString().slice(0, 10);
                } else {
                  targetDate = today;
                }
                const tempId = emitOptimisticTask({
                  pieceId: task.piece_id,
                  sectionId: task.section_id,
                  date: targetDate,
                  text: task.text,
                  metronomeSpeed: task.metronome_speed,
                  timerSeconds: task.timer_seconds,
                  pieceName: task.piece_name,
                  pieceComposer: task.piece_composer,
                  pieceKind: task.piece_kind,
                  sectionLabel: task.section_label,
                  sectionStatus: task.section_status,
                });
                try {
                  await duplicateTask(task.id, targetDate);
                } catch (err) {
                  rollbackOptimisticTask(tempId);
                  throw err;
                }
              }}
            >
              <CopyPlusIcon />
              {task.date === localDate()
                ? "Duplicate to tomorrow"
                : "Duplicate to today"}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={async () => {
                const today = localDate();
                const isToday = task.date === today;
                let targetDate: string;
                if (isToday) {
                  const d = new Date(task.date + "T12:00:00");
                  d.setDate(d.getDate() + 1);
                  targetDate = d.toISOString().slice(0, 10);
                } else {
                  targetDate = today;
                }
                emitOptimisticTaskDelete(task.id);
                const tempId = emitOptimisticTask({
                  pieceId: task.piece_id,
                  sectionId: task.section_id,
                  date: targetDate,
                  text: task.text,
                  metronomeSpeed: task.metronome_speed,
                  timerSeconds: task.timer_seconds,
                  pieceName: task.piece_name,
                  pieceComposer: task.piece_composer,
                  pieceKind: task.piece_kind,
                  sectionLabel: task.section_label,
                  sectionStatus: task.section_status,
                });
                try {
                  await moveTaskToDate(task.id, targetDate);
                  emitOptimisticTaskRename(tempId, task.id);
                } catch (err) {
                  rollbackOptimisticTask(tempId);
                  throw err;
                }
              }}
            >
              <CalendarArrowUpIcon />
              {task.date === localDate()
                ? "Move to tomorrow"
                : "Move to today"}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => openAudioDialog(hasAudio ? "playback" : "record")}
            >
              <MicIcon />
              {hasAudio ? "Play recording" : "Record"}
            </DropdownMenuItem>
            {daySessionNumbers
              .filter((n) => n !== task.session_number)
              .map((n) => (
                <DropdownMenuItem
                  key={n}
                  onClick={() => {
                    emitOptimisticTaskUpdate(task.id, {
                      session_number: n,
                    });
                    void updateTaskSession(task.id, n);
                  }}
                >
                  <ArrowRightIcon />
                  Move to session {n}
                </DropdownMenuItem>
              ))}
            <DropdownMenuItem
              onClick={() => {
                const next =
                  (daySessionNumbers.length > 0
                    ? Math.max(...daySessionNumbers)
                    : task.session_number) + 1;
                emitOptimisticTaskUpdate(task.id, {
                  session_number: next,
                });
                void updateTaskSession(task.id, next);
              }}
            >
              <PlusIcon />
              Move to new session
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onClick={() => {
                if (isActive) pauseTaskTimer();
                void deleteTask(task.id);
              }}
            >
              <Trash2Icon />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Row content — Notion-style: bordered cells, no fill */}
      <div
        className={cn(
          "flex-1 min-w-0 grid grid-cols-[32px_128px_72px_56px_1fr] items-stretch text-xs transition-colors",
          isActive ? cn(activeRowBg, "text-white") : "text-foreground",
          optimisticCompleted && "opacity-50"
        )}
      >
        {/* Complete checkbox — no frame borders, only a right divider */}
        <div className="flex items-center justify-center px-2 py-1.5">
          <input
            type="checkbox"
            checked={optimisticCompleted}
            onChange={handleComplete}
            className="size-3.5 rounded"
          />
        </div>

        {/* Timer + goal */}
        <div
          className={cn(
            "flex items-center px-2 py-1.5 border-b border-l",
            isFirst && "border-t",
            !isActive && "border-r border-border/60",
            isActive && activeSectionBorderClasses
          )}
        >
          <TimerCell
            elapsedSeconds={elapsed}
            goalSeconds={optimisticGoalSeconds}
            isActive={isActive}
            isCompleted={optimisticCompleted}
            onToggleTimer={handleTimerClick}
            onChangeGoal={(seconds) => {
              // Preserve accrued elapsed time when the goal changes —
              // only the goal moves; remaining shifts by the same delta.
              const liveRemaining = isActive
                ? remainingSeconds
                : optimisticRemaining;
              const newRemaining =
                liveRemaining + (seconds - optimisticGoalSeconds);
              setOptimisticGoalSeconds(seconds);
              setOptimisticRemaining(newRemaining);
              setTaskGoal(task.id, seconds);
              void updateTaskField(task.id, "timer_seconds", seconds);
              void updateTaskRemaining(task.id, newRemaining);
            }}
          />
        </div>

        {/* Metronome pill — click to start/stop, right-click to edit */}
        <div
          className={cn(
            "flex items-center px-2 py-1.5 border-b",
            isFirst && "border-t",
            !isActive && "border-r border-border/60",
            isActive && activeBorderClasses
          )}
        >
          {editingMetronome ? (
            <input
              ref={metronomeRef}
              type="text"
              inputMode="numeric"
              value={metronome}
              onChange={(e) => setMetronome(e.target.value)}
              onBlur={handleMetronomeBlur}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleMetronomeBlur();
                }
              }}
              className={cn(
                "w-full bg-transparent text-center focus:outline-none tabular-nums",
                isActive ? "text-white placeholder:text-white/60" : "text-muted-foreground focus:text-foreground"
              )}
            />
          ) : (
            <button
              onClick={handleMetronomePillClick}
              onContextMenu={handleMetronomeRightClick}
              onDoubleClick={() => {
                setEditingMetronome(true);
                requestAnimationFrame(() => metronomeRef.current?.focus());
              }}
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2 py-0.5 tabular-nums transition-colors",
                displayedMetronomeSpeed
                  ? isActive
                    ? "bg-white/20 text-white hover:bg-white/30"
                    : isMetronomeActiveForThisTask
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:bg-muted-foreground/20"
                  : isActive ? "text-white/50" : "text-muted-foreground/40"
              )}
            >
              <MetronomeIcon className="size-3" />
              {displayedMetronomeSpeed ?? "—"}
            </button>
          )}
        </div>

        {/* Section + status dot — click opens picker */}
        <div
          className={cn(
            "flex items-stretch min-w-0 border-b",
            isFirst && "border-t",
            !isActive && "border-r border-border/60",
            isActive && activeBorderClasses
          )}
        >
          <Popover
            open={sectionPickerOpen}
            onOpenChange={handleSectionPickerOpenChange}
          >
            <PopoverTrigger
              disabled={!task.piece_id}
              className={cn(
                "flex flex-1 items-center gap-1 min-w-0 px-2 py-1.5 text-left focus:outline-none",
                task.piece_id && "cursor-pointer rounded-sm hover:bg-muted/40",
                isActive && "hover:bg-white/10",
                !task.piece_id && "cursor-default"
              )}
            >
              {optimisticSection.status !== null && (
                <CircleIcon
                  className={cn(
                    "size-2.5 shrink-0 fill-current",
                    isActive
                      ? "text-white/80"
                      : SECTION_STATUS_DOT_COLORS[
                          optimisticSection.status as SectionStatus
                        ]
                  )}
                />
              )}
              <span
                className={cn(
                  "truncate",
                  isActive ? "text-white" : "text-muted-foreground"
                )}
              >
                {optimisticSection.label ?? "—"}
              </span>
            </PopoverTrigger>
            <PopoverContent
              align="start"
              side="bottom"
              sideOffset={2}
              className="w-auto min-w-[200px] max-w-[280px] p-1 gap-0"
            >
              <SectionPickerList
                data={sectionPickerData}
                selectedSectionId={optimisticSection.sectionId}
                onSelect={handleSelectSection}
              />
            </PopoverContent>
          </Popover>
        </div>

        {/* Text notes — widest column. Truncates to one line; click opens an overlay editor. */}
        <div
          className={cn(
            "flex items-center min-w-0 px-2 py-1.5 border-b border-r",
            isFirst && "border-t",
            isActive
              ? activeNotesBorderClasses
              : "border-r-border/60"
          )}
        >
          <Popover open={noteOpen} onOpenChange={handleNoteOpenChange}>
            <input
              ref={noteInputRef}
              type="text"
              value={text}
              onChange={handleInlineNoteChange}
              onClick={handleInlineNoteClick}
              onBlur={handleInlineNoteBlur}
              onKeyDown={handleInlineNoteKeyDown}
              placeholder="Notes..."
              className={cn(
                "block w-full min-w-0 bg-transparent text-left leading-tight focus:outline-none cursor-text text-ellipsis",
                isActive
                  ? text
                    ? "text-white placeholder:text-white/60"
                    : "text-white placeholder:text-white/60"
                  : text
                    ? "text-muted-foreground placeholder:text-muted-foreground/50"
                    : "text-muted-foreground placeholder:text-muted-foreground/50"
              )}
            />
            <PopoverContent
              anchor={noteInputRef}
              align="start"
              side="bottom"
              sideOffset={-28}
              className="min-w-[320px] max-w-[520px] p-2 gap-0"
            >
              <textarea
                ref={noteTextareaRef}
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  autoGrowNote();
                }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.preventDefault();
                    handleNoteOpenChange(false);
                  } else if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleNoteOpenChange(false);
                  }
                }}
                placeholder="Notes..."
                rows={1}
                className="w-full bg-transparent focus:outline-none resize-none leading-tight text-xs text-foreground placeholder:text-muted-foreground/50"
              />
            </PopoverContent>
          </Popover>
        </div>
      </div>
      </div>
      {/* Recordings list — replaces the single-slot audio affordance (U6).
          Backfilled legacy audio appears here as its practice_recordings row. */}
      {task.recordings.length > 0 && (
        <TaskRecordings
          taskId={task.id}
          pieceId={task.piece_id}
          recordings={task.recordings}
        />
      )}
      <FollowUpDialog
        open={followUpOpen}
        onOpenChange={(open) => {
          setFollowUpOpen(open);
          if (!open) {
            window.dispatchEvent(
              new CustomEvent("follow-up-dialog-closed", {
                detail: { dayDate: task.date },
              })
            );
          }
        }}
        tomorrowDate={tomorrowDate}
        dayAfterDate={dayAfterDate}
        tomorrowSessions={sessionNumbersByDate[tomorrowDate] ?? []}
        dayAfterSessions={sessionNumbersByDate[dayAfterDate] ?? []}
        defaultSessionNumber={task.session_number}
        defaults={{
          pieceId: task.piece_id,
          pieceName: task.piece_name,
          pieceComposer: task.piece_composer,
          pieceKind: task.piece_kind,
          sectionId: optimisticSection.sectionId,
          sectionLabel: optimisticSection.label,
          sectionStatus: optimisticSection.status,
          metronomeSpeed: optimisticMetronomeSpeed,
          timerSeconds: optimisticGoalSeconds,
          text: text,
        }}
      />
      <TaskAudioDialog
        taskId={task.id}
        open={audioDialogOpen}
        onOpenChange={setAudioDialogOpen}
        initialMode={audioDialogMode}
        existingAudioPath={task.audio_path}
        existingDurationSeconds={task.audio_duration_seconds}
        existingTrimStartSeconds={task.audio_trim_start_seconds}
        existingTrimEndSeconds={task.audio_trim_end_seconds}
        existingAudioTitle={task.audio_title}
        pieceName={task.piece_name}
        sectionLabel={optimisticSection.label}
        taskText={text}
        onAttached={(path, duration, trimStart, trimEnd, audioTitle) => {
          emitOptimisticTaskUpdate(task.id, {
            audio_path: path,
            audio_duration_seconds: duration,
            audio_trim_start_seconds: trimStart,
            audio_trim_end_seconds: trimEnd,
            audio_title: audioTitle,
          });
        }}
        onTrimUpdated={(trimStart, trimEnd) => {
          emitOptimisticTaskUpdate(task.id, {
            audio_trim_start_seconds: trimStart,
            audio_trim_end_seconds: trimEnd,
          });
        }}
        onTitleUpdated={(audioTitle) => {
          emitOptimisticTaskUpdate(task.id, { audio_title: audioTitle });
        }}
        onDeleted={() => {
          emitOptimisticTaskUpdate(task.id, {
            audio_path: null,
            audio_duration_seconds: null,
            audio_trim_start_seconds: null,
            audio_trim_end_seconds: null,
            audio_title: null,
          });
        }}
      />
    </div>
  );
}

function SectionPickerList({
  data,
  selectedSectionId,
  onSelect,
}: {
  data: SectionPickerData | null;
  selectedSectionId: string | null;
  onSelect: (section: PieceSection) => void;
}) {
  if (!data) {
    return (
      <div className="px-2 py-1.5 text-xs text-muted-foreground">Loading…</div>
    );
  }

  if (data.sections.length === 0) {
    return (
      <div className="px-2 py-1.5 text-xs text-muted-foreground">
        No sections
      </div>
    );
  }

  return (
    <ul className="flex flex-col">
      {data.sections.map((section) => {
        const effectiveTempo =
          section.target_tempo ?? data.pieceTargetTempo ?? null;
        const tempo = practiceTempo(section.status, effectiveTempo);
        const isSelected = section.id === selectedSectionId;
        return (
          <li key={section.id}>
            <button
              type="button"
              onClick={() => onSelect(section)}
              className={cn(
                "flex w-full items-center gap-2 rounded-sm px-2 py-1 text-xs text-left hover:bg-muted",
                isSelected && "bg-muted/60"
              )}
            >
              <CircleIcon
                className={cn(
                  "size-2.5 shrink-0 fill-current",
                  SECTION_STATUS_DOT_COLORS[section.status]
                )}
              />
              <span className="flex-1 truncate font-medium text-foreground">
                {section.label}
              </span>
              <span className="shrink-0 font-mono text-[10px] text-muted-foreground tabular-nums">
                {tempo ? `♩=${tempo}` : "—"}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
