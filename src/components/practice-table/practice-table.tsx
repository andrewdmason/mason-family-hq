"use client";

import { useState, useCallback, useEffect, useId, useMemo, useRef } from "react";
import { useSearchParams } from "next/navigation";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ArrowRightIcon,
  ArrowUpFromLineIcon,
  CalendarArrowUpIcon,
  ClockIcon,
  GripVerticalIcon,
  PlusIcon,
} from "lucide-react";
import { useTaskTimer } from "@/components/timer/task-timer-context";
import { useMetronome } from "@/components/metronome/metronome-context";
import { TaskRow } from "@/components/practice-table/task-row";
import { PieceSectionsContext } from "@/components/practice-table/task-recordings";
import { PieceSessionsDialog } from "@/components/practice-table/piece-sessions-dialog";
import { usePendingRefresh } from "@/components/practice-table/use-pending-refresh";
import {
  moveTasksToDate,
  reorderTasks,
  rollOverUnfinishedTasks,
  updateTasksSession,
} from "@/app/practice/timer/task-actions";
import { getFeedPage } from "@/app/practice/feed/actions";
import {
  createTaskOptimistic,
  emitOptimisticTask,
  emitOptimisticTaskDelete,
  emitOptimisticTaskRename,
  emitOptimisticTaskUpdate,
  getStableTaskKey,
  rollbackOptimisticTask,
  type OptimisticTaskDetail,
  type OptimisticTaskRename,
  type OptimisticTaskRollback,
  type OptimisticTaskUpdate,
  type OptimisticTaskDelete,
} from "@/lib/optimistic-task";
import { localDate } from "@/lib/date-utils";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { groupPiecesForMenu, type PieceMenuEntry } from "@/lib/piece-menu";
import type {
  FeedDay,
  TaskWithDetails,
  PieceKind,
  Piece,
  PieceSectionWithChildren,
} from "@/lib/types";

type PieceGroup = {
  pieceId: string | null;
  pieceName: string;
  pieceWorkName: string | null;
  pieceKind: PieceKind | null;
  tasks: TaskWithDetails[];
  // Full task set used for aggregate timers. Differs from `tasks` only in
  // focus view, where `tasks` is filtered for display but timers should still
  // reflect all tasks (including completed ones).
  aggregateTasks?: TaskWithDetails[];
};

type SessionGroup = {
  sessionNumber: number;
  pieces: PieceGroup[];
  // Full unfiltered pieces for aggregate timers, for the same reason as
  // PieceGroup.aggregateTasks. Includes pieces whose tasks were all hidden.
  aggregatePieces?: PieceGroup[];
};

function formatMinsShort(totalSeconds: number): string {
  const minutes = Math.round(Math.max(0, totalSeconds) / 60);
  if (minutes <= 0) return "0m";
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function AggregateTimerPill({
  elapsedSeconds,
  goalSeconds,
  onClick,
  title,
  size = "sm",
}: {
  elapsedSeconds: number;
  goalSeconds: number;
  onClick?: () => void;
  title?: string;
  size?: "sm" | "md";
}) {
  const goalReached = goalSeconds > 0 && elapsedSeconds >= goalSeconds;
  const interactive = !!onClick;
  const textClass = size === "md" ? "text-sm" : "text-xs";

  const content = (
    <>
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-muted-foreground/70 transition-colors",
          interactive &&
            "group-hover/pill:bg-muted group-hover/pill:text-foreground"
        )}
      >
        <ClockIcon className="size-3" />
        {formatMinsShort(elapsedSeconds)}
      </span>
      <span className="mx-0.5 select-none text-muted-foreground/30">/</span>
      <span
        className={cn(
          "rounded px-1.5 py-0.5 transition-colors",
          goalReached
            ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
            : cn(
                "text-muted-foreground/70",
                interactive &&
                  "group-hover/pill:bg-muted group-hover/pill:text-foreground"
              )
        )}
      >
        {goalSeconds > 0 ? formatMinsShort(goalSeconds) : "—"}
      </span>
    </>
  );

  const baseClass = cn(
    "inline-flex items-center tabular-nums",
    textClass
  );

  if (interactive) {
    return (
      <button
        type="button"
        onClick={onClick}
        title={title}
        className={cn("group/pill", baseClass)}
      >
        {content}
      </button>
    );
  }

  return <div className={baseClass}>{content}</div>;
}

function PieceMenuItemBody({ piece }: { piece: Piece }) {
  return (
    <span className="min-w-0 flex-1 truncate text-sm">{piece.name}</span>
  );
}

function PieceMenuEntries({
  entries,
  onSelect,
}: {
  entries: PieceMenuEntry[];
  onSelect: (piece: Piece) => void;
}) {
  return (
    <>
      {entries.map((entry) =>
        entry.kind === "piece" ? (
          <DropdownMenuItem
            key={entry.piece.id}
            onClick={() => onSelect(entry.piece)}
          >
            <PieceMenuItemBody piece={entry.piece} />
          </DropdownMenuItem>
        ) : (
          <DropdownMenuSub key={entry.workId}>
            <DropdownMenuSubTrigger>
              <span className="min-w-0 flex-1 truncate">{entry.name}</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-64">
              {entry.pieces.map((piece) => (
                <DropdownMenuItem
                  key={piece.id}
                  onClick={() => onSelect(piece)}
                >
                  <PieceMenuItemBody piece={piece} />
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )
      )}
    </>
  );
}

function groupTasksByPiece(
  tasks: TaskWithDetails[],
  pieceWorkNameById: Record<string, string>
): PieceGroup[] {
  const groups = new Map<string, PieceGroup>();

  for (const task of tasks) {
    const key = task.piece_id ?? "__general__";
    if (!groups.has(key)) {
      groups.set(key, {
        pieceId: task.piece_id,
        pieceName: task.piece_name ?? "General",
        pieceWorkName: task.piece_id
          ? pieceWorkNameById[task.piece_id] ?? null
          : null,
        pieceKind: task.piece_kind,
        tasks: [],
      });
    }
    groups.get(key)!.tasks.push(task);
  }

  return Array.from(groups.values());
}

function groupTasksBySession(
  tasks: TaskWithDetails[],
  pieceWorkNameById: Record<string, string>
): SessionGroup[] {
  const bySession = new Map<number, TaskWithDetails[]>();
  for (const task of tasks) {
    const sess = task.session_number ?? 1;
    if (!bySession.has(sess)) bySession.set(sess, []);
    bySession.get(sess)!.push(task);
  }
  return Array.from(bySession.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([sessionNumber, sessionTasks]) => ({
      sessionNumber,
      pieces: groupTasksByPiece(sessionTasks, pieceWorkNameById),
    }));
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr + "T12:00:00");
  const today = new Date();
  const todayStr = localDate(today);

  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = localDate(yesterday);

  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = localDate(tomorrow);

  const weekday = date.toLocaleDateString("en-US", { weekday: "long" });

  if (dateStr === todayStr) return `Today (${weekday})`;
  if (dateStr === yesterdayStr) return `Yesterday (${weekday})`;
  if (dateStr === tomorrowStr) return `Tomorrow (${weekday})`;

  return date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function SortablePieceGroup({
  group,
  dayDate,
  onAddTask,
  daySessionNumbers,
  currentSessionNumber,
  sessionNumbersByDate,
}: {
  group: PieceGroup;
  dayDate: string;
  onAddTask: (afterTaskId: string | null) => void;
  daySessionNumbers: number[];
  currentSessionNumber: number;
  sessionNumbersByDate: Record<string, number[]>;
}) {
  const { activePieceInstance } = useTaskTimer();
  const sortableId = `piece:${group.pieceId ?? "__general__"}`;
  const groupPieceKey = group.pieceId ?? "__general__";
  const instanceKey = `${dayDate}:${currentSessionNumber}:${groupPieceKey}`;
  const isActive =
    group.pieceId !== null && activePieceInstance?.key === instanceKey;
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: sortableId });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const [sessionsOpen, setSessionsOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
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

  const moveAllTasksToSession = (n: number) => {
    const taskIds = group.tasks.map((t) => t.id);
    for (const id of taskIds) {
      emitOptimisticTaskUpdate(id, { session_number: n });
    }
    void updateTasksSession(taskIds, n);
  };

  const moveAllTasksToDate = async (targetDate: string) => {
    const tasks = group.tasks;
    const taskIds = tasks.map((t) => t.id);
    const rollbacks: { tempId: string; realId: string }[] = [];
    for (const t of tasks) {
      emitOptimisticTaskDelete(t.id);
      const tempId = emitOptimisticTask({
        pieceId: t.piece_id,
        sectionId: t.section_id,
        date: targetDate,
        text: t.text,
        metronomeSpeed: t.metronome_speed,
        timerSeconds: t.timer_seconds,
        pieceName: t.piece_name,
        pieceComposer: t.piece_composer,
        pieceKind: t.piece_kind,
        sectionLabel: t.section_label,
        sectionStatus: t.section_status,
      });
      rollbacks.push({ tempId, realId: t.id });
    }
    try {
      await moveTasksToDate(taskIds, targetDate);
      for (const { tempId, realId } of rollbacks) {
        emitOptimisticTaskRename(tempId, realId);
      }
    } catch (err) {
      for (const { tempId } of rollbacks) rollbackOptimisticTask(tempId);
      throw err;
    }
  };

  const moveToDateLabel = (() => {
    const today = localDate();
    if (dayDate === today) return "Move to tomorrow";
    return "Move to today";
  })();

  const moveToDateTarget = (() => {
    const today = localDate();
    if (dayDate === today) {
      const d = new Date(dayDate + "T12:00:00");
      d.setDate(d.getDate() + 1);
      return d.toISOString().slice(0, 10);
    }
    return today;
  })();

  const aggregateTasks = group.aggregateTasks ?? group.tasks;
  const totalElapsed = aggregateTasks.reduce(
    (sum, t) => sum + Math.max(0, t.timer_seconds - t.timer_remaining_seconds),
    0
  );
  const totalGoal = aggregateTasks.reduce(
    (sum, t) => sum + Math.max(0, t.timer_seconds),
    0
  );
  const showPieceTimer = totalElapsed > 0 || totalGoal > 0;

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-piece-group-instance={instanceKey}
      data-piece-id={group.pieceId ?? ""}
      className={cn(
        "group/piece relative mb-3 -ml-8 pl-8 -mr-2 pr-2 py-1.5 rounded-lg transition-colors duration-150",
        !isActive && "hover:bg-muted/30",
        isActive && "bg-muted/55",
        isDragging && "opacity-50"
      )}
    >
      {/* Piece header with drag handle in gutter */}
      <div className="group/piece-header flex items-stretch mb-1.5">
        <div
          className={cn(
            "-ml-8 w-8 shrink-0 flex items-center justify-center gap-0 transition-opacity",
            menuOpen
              ? "opacity-100"
              : "opacity-0 group-hover/piece-header:opacity-100"
          )}
        >
          <button
            type="button"
            onClick={() => onAddTask(null)}
            className="flex items-center justify-center w-4 h-6 rounded-sm text-muted-foreground/60 hover:text-foreground hover:bg-muted transition-colors"
            title="Add task"
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
                onClick={() => {
                  void moveAllTasksToDate(moveToDateTarget);
                }}
              >
                <CalendarArrowUpIcon />
                {moveToDateLabel}
              </DropdownMenuItem>
              {daySessionNumbers
                .filter((n) => n !== currentSessionNumber)
                .map((n) => (
                  <DropdownMenuItem
                    key={n}
                    onClick={() => moveAllTasksToSession(n)}
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
                      : currentSessionNumber) + 1;
                  moveAllTasksToSession(next);
                }}
              >
                <PlusIcon />
                Move to new session
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="flex items-center gap-1.5 px-1">
          <h3 className="text-sm font-medium text-foreground">
            {group.pieceName}
            {group.pieceWorkName && (
              <span className="text-muted-foreground/70">
                {" "}
                · {group.pieceWorkName}
              </span>
            )}
          </h3>
          {showPieceTimer && (
            <AggregateTimerPill
              elapsedSeconds={totalElapsed}
              goalSeconds={totalGoal}
              onClick={
                group.pieceId && totalElapsed > 0
                  ? () => setSessionsOpen(true)
                  : undefined
              }
              title={
                group.pieceId && totalElapsed > 0
                  ? "Edit individual sessions"
                  : undefined
              }
            />
          )}
        </div>
      </div>

      {/* Task rows */}
      <SortableContext
        items={group.tasks.map((t) => t.id)}
        strategy={verticalListSortingStrategy}
      >
        {group.tasks.map((task, index) => (
          <TaskRow
            key={getStableTaskKey(task.id)}
            task={task}
            isFirst={index === 0}
            onAddBelow={(afterTaskId) => onAddTask(afterTaskId)}
            daySessionNumbers={daySessionNumbers}
            sessionNumbersByDate={sessionNumbersByDate}
          />
        ))}
      </SortableContext>
      {group.pieceId && (
        <PieceSessionsDialog
          open={sessionsOpen}
          onOpenChange={setSessionsOpen}
          title={group.pieceName}
          tasks={aggregateTasks}
        />
      )}
    </div>
  );
}

function SessionBlock({
  sessionNumber,
  pieces,
  aggregatePieces,
  showHeader,
  isFirst,
  dayDate,
  daySessionNumbers,
  focusedPieceId,
  activePieces,
  worksById,
  onReorder,
  onAddTask,
  onAddPiece,
  sessionNumbersByDate,
}: {
  sessionNumber: number;
  pieces: PieceGroup[];
  aggregatePieces?: PieceGroup[];
  showHeader: boolean;
  isFirst: boolean;
  dayDate: string;
  daySessionNumbers: number[];
  focusedPieceId: string | null;
  activePieces: Piece[];
  worksById: Record<string, string>;
  onReorder: (dayDate: string, orderedIds: string[]) => void;
  onAddTask: (
    pieceId: string | null,
    sessionNumber: number,
    afterTaskId?: string | null
  ) => void;
  onAddPiece: (piece: Piece, sessionNumber: number) => void;
  sessionNumbersByDate: Record<string, number[]>;
}) {
  const dndId = useId();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const activeId = String(active.id);
      const overId = String(over.id);

      if (activeId.startsWith("piece:")) {
        const pieceKey = (g: PieceGroup) =>
          `piece:${g.pieceId ?? "__general__"}`;
        const oldIndex = pieces.findIndex((g) => pieceKey(g) === activeId);
        const newIndex = overId.startsWith("piece:")
          ? pieces.findIndex((g) => pieceKey(g) === overId)
          : pieces.findIndex((g) => g.tasks.some((t) => t.id === overId));
        if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return;

        const reordered = [...pieces];
        const [moved] = reordered.splice(oldIndex, 1);
        reordered.splice(newIndex, 0, moved);
        const reorderedTaskIds = reordered.flatMap((g) =>
          g.tasks.map((t) => t.id)
        );
        if (reorderedTaskIds.length === 0) return;
        onReorder(dayDate, reorderedTaskIds);
        void reorderTasks(reorderedTaskIds);
        return;
      }

      for (const group of pieces) {
        const taskIds = group.tasks.map((t) => t.id);
        const oldIndex = taskIds.indexOf(activeId);
        const newIndex = taskIds.indexOf(overId);

        if (oldIndex !== -1 && newIndex !== -1) {
          const reordered = [...taskIds];
          reordered.splice(oldIndex, 1);
          reordered.splice(newIndex, 0, activeId);
          onReorder(dayDate, reordered);
          void reorderTasks(reordered);
          break;
        }
      }
    },
    [pieces, dayDate, onReorder]
  );

  const aggregateSessionTasks = (aggregatePieces ?? pieces).flatMap((p) =>
    p.aggregateTasks ?? p.tasks
  );
  const sessionElapsed = aggregateSessionTasks.reduce(
    (sum, t) => sum + Math.max(0, t.timer_seconds - t.timer_remaining_seconds),
    0
  );
  const sessionGoal = aggregateSessionTasks.reduce(
    (sum, t) => sum + Math.max(0, t.timer_seconds),
    0
  );
  const showSessionTimer = sessionElapsed > 0 || sessionGoal > 0;

  const existingPieceIds = new Set(
    pieces.map((g) => g.pieceId).filter((id): id is string => id !== null)
  );
  const addablePieces = activePieces.filter(
    (p) => !existingPieceIds.has(p.id)
  );
  const addableEntries = groupPiecesForMenu(addablePieces, worksById);

  return (
    <div className={cn("mb-5", !isFirst && showHeader && "mt-6")}>
      {showHeader && (
        <div className="group/session flex items-center gap-3 mb-3 px-1">
          <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground/70">
            Session {sessionNumber}
          </span>
          <div className="h-px flex-1 bg-border/60" />
          {showSessionTimer && (
            <AggregateTimerPill
              elapsedSeconds={sessionElapsed}
              goalSeconds={sessionGoal}
              size="sm"
            />
          )}
          {!focusedPieceId && (
            <DropdownMenu>
              <DropdownMenuTrigger
                className="inline-flex items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground size-5 opacity-0 group-hover/session:opacity-100 data-[state=open]:opacity-100 transition-opacity"
                title="Add to session"
              >
                <PlusIcon className="size-3.5" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-64">
                <DropdownMenuItem
                  onClick={() => onAddTask(null, sessionNumber)}
                >
                  <span className="text-sm">General note</span>
                </DropdownMenuItem>
                {addableEntries.length > 0 && <DropdownMenuSeparator />}
                <PieceMenuEntries
                  entries={addableEntries}
                  onSelect={(piece) => onAddPiece(piece, sessionNumber)}
                />
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      )}
      <DndContext
        id={dndId}
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={pieces.map((g) => `piece:${g.pieceId ?? "__general__"}`)}
          strategy={verticalListSortingStrategy}
        >
          {pieces.map((group) => (
            <SortablePieceGroup
              key={group.pieceId ?? "__general__"}
              group={group}
              dayDate={dayDate}
              onAddTask={(afterTaskId) =>
                onAddTask(group.pieceId, sessionNumber, afterTaskId)
              }
              daySessionNumbers={daySessionNumbers}
              currentSessionNumber={sessionNumber}
              sessionNumbersByDate={sessionNumbersByDate}
            />
          ))}
        </SortableContext>
      </DndContext>
    </div>
  );
}

function DayGroup({
  day,
  focusedPieceId,
  focusedPieceName,
  activePieces,
  worksById,
  hasTomorrow,
  hasUnfinishedBefore,
  isNextSessionView,
  onReorder,
  sessionNumbersByDate,
}: {
  day: FeedDay;
  focusedPieceId: string | null;
  focusedPieceName: string | null;
  activePieces: Piece[];
  worksById: Record<string, string>;
  hasTomorrow: boolean;
  hasUnfinishedBefore: boolean;
  isNextSessionView: boolean;
  onReorder: (dayDate: string, orderedIds: string[]) => void;
  sessionNumbersByDate: Record<string, number[]>;
}) {
  const filteredTasks = focusedPieceId
    ? day.tasks.filter((t) => t.piece_id === focusedPieceId)
    : day.tasks;

  const pieceWorkNameById = useMemo(() => {
    const map: Record<string, string> = {};
    for (const p of activePieces) {
      if (p.work_id) {
        const workName = worksById[p.work_id];
        if (workName) map[p.id] = workName;
      }
    }
    return map;
  }, [activePieces, worksById]);

  const allSessionGroups = groupTasksBySession(
    filteredTasks,
    pieceWorkNameById
  );

  // Keep the currently-shown session visible while a follow-up dialog is open
  // for this day. Without this, completing the last task in the session would
  // filter the session out and unmount the TaskRow that owns the dialog,
  // dismissing the modal before the user can interact with it. We also track
  // the specific task so the Focus filter can keep just that completed task
  // visible without revealing others.
  const [pinnedSessionNumber, setPinnedSessionNumber] = useState<number | null>(
    null
  );
  const [pinnedTaskId, setPinnedTaskId] = useState<string | null>(null);
  const allSessionGroupsRef = useRef(allSessionGroups);
  useEffect(() => {
    allSessionGroupsRef.current = allSessionGroups;
  });
  useEffect(() => {
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent<{ dayDate: string; taskId?: string }>)
        .detail;
      if (detail?.dayDate !== day.date) return;
      const current = allSessionGroupsRef.current.find((s) =>
        s.pieces.some((p) => p.tasks.some((t) => !t.completed))
      );
      if (current) setPinnedSessionNumber(current.sessionNumber);
      setPinnedTaskId(detail.taskId ?? null);
    };
    const onClose = (e: Event) => {
      const detail = (e as CustomEvent<{ dayDate: string }>).detail;
      if (detail?.dayDate !== day.date) return;
      setPinnedSessionNumber(null);
      setPinnedTaskId(null);
    };
    window.addEventListener("follow-up-dialog-opened", onOpen);
    window.addEventListener("follow-up-dialog-closed", onClose);
    return () => {
      window.removeEventListener("follow-up-dialog-opened", onOpen);
      window.removeEventListener("follow-up-dialog-closed", onClose);
    };
  }, [day.date]);

  const sessionGroups = isNextSessionView
    ? (() => {
        const firstIncomplete = allSessionGroups.find((s) =>
          s.pieces.some((p) => p.tasks.some((t) => !t.completed))
        );
        const targetNumber =
          pinnedSessionNumber ?? firstIncomplete?.sessionNumber ?? null;
        if (targetNumber == null) return [];
        const target = allSessionGroups.find(
          (s) => s.sessionNumber === targetNumber
        );
        if (!target) return [];
        // Hide completed tasks, but keep the pinned task (the one that owns
        // an open follow-up dialog) mounted so the modal stays interactive.
        // Preserve the unfiltered tasks on each piece so aggregate timers in
        // the session header still reflect the full session, including time
        // spent on tasks that have been checked off and hidden.
        const filteredPieces = target.pieces
          .map((p) => ({
            ...p,
            tasks: p.tasks.filter(
              (t) => !t.completed || t.id === pinnedTaskId
            ),
            aggregateTasks: p.tasks,
          }))
          .filter((p) => p.tasks.length > 0);
        return filteredPieces.length > 0
          ? [
              {
                ...target,
                pieces: filteredPieces,
                aggregatePieces: target.pieces,
              },
            ]
          : [];
      })()
    : allSessionGroups;
  const nextSessionAllComplete =
    isNextSessionView &&
    allSessionGroups.length > 0 &&
    sessionGroups.length === 0;
  const [pendingNewSession, setPendingNewSession] = useState<number | null>(
    null
  );

  const maxExistingSession = sessionGroups.reduce(
    (m, s) => Math.max(m, s.sessionNumber),
    0
  );

  // Treat a pending session as active only while no real session with that
  // number exists. Once a task is added, the real session takes over and the
  // pending slot disappears naturally without needing to reset state.
  const pendingEmptySession =
    pendingNewSession !== null &&
    !sessionGroups.some((s) => s.sessionNumber === pendingNewSession)
      ? pendingNewSession
      : null;

  const defaultAddSession =
    pendingEmptySession ?? (maxExistingSession > 0 ? maxExistingSession : 1);

  const sessionsToRender: SessionGroup[] = [
    ...sessionGroups,
    ...(pendingEmptySession !== null
      ? [{ sessionNumber: pendingEmptySession, pieces: [] }]
      : []),
  ];
  const showSessionHeaders = sessionsToRender.length > 1 || isNextSessionView;

  const handleAddTask = async (
    pieceId: string | null,
    sessionNumber: number,
    afterTaskId: string | null = null
  ) => {
    const session = sessionGroups.find(
      (s) => s.sessionNumber === sessionNumber
    );
    const group = session?.pieces.find((g) => g.pieceId === pieceId);
    await createTaskOptimistic({
      pieceId,
      sectionId: null,
      date: day.date,
      metronomeSpeed: null,
      pieceName:
        group?.pieceName ??
        (pieceId === focusedPieceId ? focusedPieceName : null),
      pieceComposer: group?.tasks[0]?.piece_composer ?? null,
      pieceKind: group?.pieceKind ?? null,
      sectionLabel: null,
      sectionStatus: null,
      afterTaskId,
      sessionNumber,
    });
  };

  const handleAddPiece = async (piece: Piece, sessionNumber: number) => {
    await createTaskOptimistic({
      pieceId: piece.id,
      sectionId: null,
      date: day.date,
      metronomeSpeed: null,
      pieceName: piece.name,
      pieceComposer: piece.composer,
      pieceKind: piece.kind,
      sectionLabel: null,
      sectionStatus: null,
      sessionNumber,
    });
  };

  const handleAddSession = () => {
    const base = Math.max(maxExistingSession, pendingEmptySession ?? 0);
    setPendingNewSession(base + 1);
  };

  const dayExistingPieceIds = new Set(
    filteredTasks
      .map((t) => t.piece_id)
      .filter((id): id is string => id !== null)
  );
  const dayAddablePieces = activePieces.filter(
    (p) => !dayExistingPieceIds.has(p.id)
  );
  const dayAddableEntries = groupPiecesForMenu(
    dayAddablePieces,
    worksById
  );

  const dayElapsedSeconds = day.tasks.reduce(
    (sum, t) => sum + Math.max(0, t.timer_seconds - t.timer_remaining_seconds),
    0
  );
  const dayGoalSeconds = day.tasks.reduce(
    (sum, t) => sum + Math.max(0, t.timer_seconds),
    0
  );
  const showDayTimer = dayElapsedSeconds > 0 || dayGoalSeconds > 0;
  const todayStr = localDate();
  const isToday = day.date === todayStr;

  if (
    sessionGroups.length === 0 &&
    pendingEmptySession === null &&
    !isToday
  )
    return null;

  return (
    <div className="group/day mb-8">
      {isToday && hasTomorrow && <hr className="mb-8 border-border" />}
      {/* Day header */}
      <div
        {...(isToday ? { "data-today-anchor": "true" } : {})}
        className={cn(
          "flex items-center gap-2 mb-3 px-1",
          isToday && "scroll-mt-24"
        )}
      >
        <h2
          className={cn(
            "text-lg font-semibold",
            isToday ? "text-sky-600 dark:text-sky-400" : "text-foreground"
          )}
        >
          {formatDate(day.date)}
        </h2>
        {showDayTimer && (
          <AggregateTimerPill
            elapsedSeconds={dayElapsedSeconds}
            goalSeconds={dayGoalSeconds}
            size="md"
          />
        )}
        {!focusedPieceId && (
          <DropdownMenu>
            <DropdownMenuTrigger
              className="inline-flex items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground size-6 opacity-0 group-hover/day:opacity-100 data-[state=open]:opacity-100 transition-opacity"
              title="Add task"
            >
              <PlusIcon className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-64">
              <DropdownMenuItem
                onClick={() => handleAddTask(null, defaultAddSession)}
              >
                <span className="text-sm">General note</span>
              </DropdownMenuItem>
              {dayAddableEntries.length > 0 && <DropdownMenuSeparator />}
              <PieceMenuEntries
                entries={dayAddableEntries}
                onSelect={(piece) => handleAddPiece(piece, defaultAddSession)}
              />
              {filteredTasks.length > 0 &&
                pendingEmptySession === null &&
                !isNextSessionView && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={handleAddSession}>
                      <PlusIcon />
                      <span className="text-sm">New session</span>
                    </DropdownMenuItem>
                  </>
                )}
              {isToday && hasUnfinishedBefore && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => {
                      void rollOverUnfinishedTasks();
                    }}
                  >
                    <ArrowUpFromLineIcon />
                    <span className="text-sm">Roll over unfinished</span>
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {/* Session blocks */}
      {sessionsToRender.map((session, index) => (
        <SessionBlock
          key={session.sessionNumber}
          sessionNumber={session.sessionNumber}
          pieces={session.pieces}
          aggregatePieces={session.aggregatePieces}
          showHeader={showSessionHeaders}
          isFirst={index === 0}
          dayDate={day.date}
          daySessionNumbers={sessionsToRender.map((s) => s.sessionNumber)}
          focusedPieceId={focusedPieceId}
          activePieces={activePieces}
          worksById={worksById}
          onReorder={onReorder}
          onAddTask={handleAddTask}
          onAddPiece={handleAddPiece}
          sessionNumbersByDate={sessionNumbersByDate}
        />
      ))}

      {/* Empty state for today when the current view has no tasks */}
      {isToday &&
        sessionGroups.length === 0 &&
        pendingEmptySession === null &&
        !nextSessionAllComplete && (
          <div className="mb-3">
            {focusedPieceId && focusedPieceName && (
              <div className="flex items-center gap-1.5 mb-1.5 px-1">
                <h3 className="text-sm font-medium text-muted-foreground">
                  {focusedPieceName}
                </h3>
              </div>
            )}
            <button
              onClick={() => handleAddTask(focusedPieceId, 1)}
              className="flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <PlusIcon className="size-3" />
              No practice yet today. Hit record or add a task.
            </button>
          </div>
        )}

      {nextSessionAllComplete && (
        <div className="mb-3 px-2 py-1.5 text-xs text-muted-foreground">
          All of today&apos;s sessions are complete.
        </div>
      )}

      {isToday && <hr className="mt-8 border-border" />}
    </div>
  );
}

export function PracticeTable({
  initialData,
}: {
  initialData: { items: FeedDay[]; nextCursor: string | null };
}) {
  const {
    focusedPieceId,
    activePieceInstance,
    setActivePieceInstance,
    activePieces,
    worksById,
    startTaskTimer,
  } = useTaskTimer();
  const metronomeCtx = useMetronome();
  const searchParams = useSearchParams();
  const isNextSessionView = searchParams.get("view") === "next-session";
  const focusedPieceName =
    activePieces.find((p) => p.id === focusedPieceId)?.name ?? null;

  const handleRootClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const target = e.target as HTMLElement;
      const groupEl = target.closest<HTMLElement>(
        "[data-piece-group-instance]"
      );
      const instanceKey = groupEl?.dataset.pieceGroupInstance ?? null;
      const pieceId = groupEl?.dataset.pieceId ?? "";
      if (instanceKey && pieceId) {
        if (activePieceInstance?.key !== instanceKey) {
          setActivePieceInstance({ pieceId, key: instanceKey });
        }
        return;
      }
      if (activePieceInstance) {
        setActivePieceInstance(null);
      }
    },
    [activePieceInstance, setActivePieceInstance]
  );
  const [days, setDays] = useState<FeedDay[]>(initialData.items);
  const [cursor, setCursor] = useState<string | null>(initialData.nextCursor);
  const [loading, setLoading] = useState(false);
  const paginatedRef = useRef(false);

  // Near-live enrichment (U9): while rendered segments are still processing,
  // poll and router.refresh() on transitions so results land without a reload.
  usePendingRefresh(days);

  // Sync server revalidation into the loaded days. If the user has paginated
  // past the first page, merge the fresh first page in by date so later pages
  // (and our advanced cursor) aren't dropped — otherwise they'd flicker out and
  // be re-fetched by the infinite-scroll sentinel.
  useEffect(() => {
    if (!paginatedRef.current) {
      setDays(initialData.items);
      setCursor(initialData.nextCursor);
      return;
    }
    setDays((prev) => {
      const fresh = new Map(initialData.items.map((d) => [d.date, d]));
      const seen = new Set<string>();
      const merged = prev.map((d) => {
        seen.add(d.date);
        return fresh.get(d.date) ?? d;
      });
      const newDays = initialData.items.filter((d) => !seen.has(d.date));
      return [...newDays, ...merged];
    });
  }, [initialData]);

  const loadMore = useCallback(async () => {
    if (!cursor || loading) return;
    setLoading(true);
    try {
      const result = await getFeedPage(cursor, 7);
      paginatedRef.current = true;
      setDays((prev) => [...prev, ...result.items]);
      setCursor(result.nextCursor);
    } finally {
      setLoading(false);
    }
  }, [cursor, loading]);

  const handleReorder = useCallback(
    (dayDate: string, orderedIds: string[]) => {
      const idSet = new Set(orderedIds);
      setDays((prev) =>
        prev.map((d) => {
          if (d.date !== dayDate) return d;
          const taskMap = new Map(d.tasks.map((t) => [t.id, t]));
          let i = 0;
          const newTasks = d.tasks.map((t) => {
            if (idSet.has(t.id)) {
              return taskMap.get(orderedIds[i++])!;
            }
            return t;
          });
          return { ...d, tasks: newTasks };
        })
      );
    },
    []
  );

  // Optimistic task-created listener
  useEffect(() => {
    const addHandler = (e: Event) => {
      const detail = (e as CustomEvent<OptimisticTaskDetail>).detail;
      const optimistic: TaskWithDetails = {
        id: detail.tempId,
        piece_id: detail.pieceId,
        section_id: detail.sectionId,
        date: detail.date,
        text: detail.text ?? "",
        metronome_speed: detail.metronomeSpeed,
        timer_seconds: detail.timerSeconds ?? 0,
        timer_remaining_seconds: detail.timerSeconds ?? 0,
        completed: false,
        completed_at: null,
        started_at: null,
        ended_at: null,
        sort_order: Number.MAX_SAFE_INTEGER,
        session_number: detail.sessionNumber ?? 1,
        audio_path: null,
        audio_duration_seconds: null,
        audio_trim_start_seconds: null,
        audio_trim_end_seconds: null,
        audio_title: null,
        session_id: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        recordings: [],
        piece_name: detail.pieceName,
        piece_composer: detail.pieceComposer,
        piece_kind: detail.pieceKind,
        section_label: detail.sectionLabel,
        section_status: detail.sectionStatus,
      };
      setDays((prev) => {
        const idx = prev.findIndex((d) => d.date === detail.date);
        if (idx >= 0) {
          const next = [...prev];
          const tasks = [...next[idx].tasks];
          const anchorIdx = detail.afterTaskId
            ? tasks.findIndex((t) => t.id === detail.afterTaskId)
            : -1;
          if (anchorIdx >= 0) {
            tasks.splice(anchorIdx + 1, 0, optimistic);
          } else {
            tasks.push(optimistic);
          }
          next[idx] = { ...next[idx], tasks };
          return next;
        }
        const newDay: FeedDay = {
          date: detail.date,
          tasks: [optimistic],
          timeSummary: [],
        };
        return [newDay, ...prev].sort((a, b) => b.date.localeCompare(a.date));
      });
    };

    const rollbackHandler = (e: Event) => {
      const { tempId } = (e as CustomEvent<OptimisticTaskRollback>).detail;
      setDays((prev) =>
        prev.map((d) => ({
          ...d,
          tasks: d.tasks.filter((t) => t.id !== tempId),
        }))
      );
    };

    const updateHandler = (e: Event) => {
      const { taskId, updates } = (e as CustomEvent<OptimisticTaskUpdate>).detail;
      setDays((prev) =>
        prev.map((d) => {
          if (!d.tasks.some((t) => t.id === taskId)) return d;
          return {
            ...d,
            tasks: d.tasks.map((t) =>
              t.id === taskId ? { ...t, ...updates } : t
            ),
          };
        })
      );
    };

    const deleteHandler = (e: Event) => {
      const { taskId } = (e as CustomEvent<OptimisticTaskDelete>).detail;
      setDays((prev) =>
        prev.map((d) => ({
          ...d,
          tasks: d.tasks.filter((t) => t.id !== taskId),
        }))
      );
    };

    const renameHandler = (e: Event) => {
      const { tempId, realId } = (e as CustomEvent<OptimisticTaskRename>).detail;
      setDays((prev) =>
        prev.map((d) => {
          if (!d.tasks.some((t) => t.id === tempId)) return d;
          return {
            ...d,
            tasks: d.tasks.map((t) =>
              t.id === tempId ? { ...t, id: realId } : t
            ),
          };
        })
      );
    };

    window.addEventListener("task-created-optimistic", addHandler);
    window.addEventListener("task-created-rollback", rollbackHandler);
    window.addEventListener("task-updated-optimistic", updateHandler);
    window.addEventListener("task-deleted-optimistic", deleteHandler);
    window.addEventListener("task-rename-optimistic", renameHandler);
    return () => {
      window.removeEventListener("task-created-optimistic", addHandler);
      window.removeEventListener("task-created-rollback", rollbackHandler);
      window.removeEventListener("task-updated-optimistic", updateHandler);
      window.removeEventListener("task-deleted-optimistic", deleteHandler);
      window.removeEventListener("task-rename-optimistic", renameHandler);
    };
  }, []);

  // Auto-advance: when a task is completed while its timer is running, start
  // the timer for the next incomplete task in the same day (matching the
  // visible piece filter), and rebind the metronome to it if it's playing.
  // Uses a ref so the always-attached listener sees the latest state without
  // re-attaching every render.
  const advanceContextRef = useRef({
    days,
    focusedPieceId,
    startTaskTimer,
    metronomeCtx,
    activePieceInstance,
    setActivePieceInstance,
  });
  advanceContextRef.current = {
    days,
    focusedPieceId,
    startTaskTimer,
    metronomeCtx,
    activePieceInstance,
    setActivePieceInstance,
  };
  useEffect(() => {
    const handler = (e: Event) => {
      const { completedTaskId, dayDate } = (e as CustomEvent<{
        completedTaskId: string;
        dayDate: string;
      }>).detail;
      const {
        days,
        focusedPieceId,
        startTaskTimer,
        metronomeCtx,
        activePieceInstance,
        setActivePieceInstance,
      } = advanceContextRef.current;

      const day = days.find((d) => d.date === dayDate);
      if (!day) return;
      const tasksInView = focusedPieceId
        ? day.tasks.filter((t) => t.piece_id === focusedPieceId)
        : day.tasks;
      const idx = tasksInView.findIndex((t) => t.id === completedTaskId);
      if (idx === -1) return;

      const nextTask = tasksInView[idx + 1] ?? null;
      if (!nextTask) return;

      startTaskTimer(nextTask.id, nextTask.timer_remaining_seconds, {
        pieceId: nextTask.piece_id,
        pieceName: nextTask.piece_name,
        pieceComposer: nextTask.piece_composer,
        pieceKind: nextTask.piece_kind,
        sectionLabel: nextTask.section_label,
        sectionStatus: nextTask.section_status,
        text: nextTask.text,
        goalSeconds: nextTask.timer_seconds,
        metronomeSpeed: nextTask.metronome_speed,
        date: nextTask.date,
      });
      if (
        nextTask.piece_id &&
        activePieceInstance &&
        activePieceInstance.pieceId !== nextTask.piece_id
      ) {
        setActivePieceInstance({
          pieceId: nextTask.piece_id,
          key: `${nextTask.date}:${nextTask.session_number}:${nextTask.piece_id}`,
        });
      }
      if (metronomeCtx.isActive && nextTask.metronome_speed != null) {
        metronomeCtx.start(nextTask.metronome_speed, nextTask.id);
      }
    };
    window.addEventListener("task-auto-advance", handler);
    return () => window.removeEventListener("task-auto-advance", handler);
  }, []);

  // Quick-add from the header's "Pieces" menu: append the piece to today's
  // latest session and make it the active timer item immediately. Uses a ref so
  // the always-attached listener reads fresh state without re-subscribing.
  const quickAddContextRef = useRef({
    days,
    activePieces,
    startTaskTimer,
    setActivePieceInstance,
  });
  quickAddContextRef.current = {
    days,
    activePieces,
    startTaskTimer,
    setActivePieceInstance,
  };
  useEffect(() => {
    const handler = (e: Event) => {
      const { pieceId } = (e as CustomEvent<{ pieceId: string }>).detail;
      const { days, activePieces, startTaskTimer, setActivePieceInstance } =
        quickAddContextRef.current;
      const piece = activePieces.find((p) => p.id === pieceId);
      if (!piece) return;

      const today = localDate();
      const todayDay = days.find((d) => d.date === today);
      const sessionNumber = (todayDay?.tasks ?? []).reduce(
        (max, t) => Math.max(max, t.session_number ?? 1),
        1
      );

      void createTaskOptimistic({
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
      })
        .then((result) => {
          startTaskTimer(result.id, result.timer_remaining_seconds, {
            pieceId: piece.id,
            pieceName: piece.name,
            pieceComposer: piece.composer,
            pieceKind: piece.kind,
            sectionLabel: null,
            sectionStatus: null,
            text: "",
            goalSeconds: result.timer_seconds,
            metronomeSpeed: null,
            date: today,
          });
          setActivePieceInstance({
            pieceId: piece.id,
            key: `${today}:${sessionNumber}:${piece.id}`,
          });
        })
        .catch(() => {});
    };
    window.addEventListener("practice-quick-add-piece", handler);
    return () => window.removeEventListener("practice-quick-add-piece", handler);
  }, []);

  // On initial load, if the feed has tomorrow entries, scroll so Today sits
  // at the top of the viewport instead of Tomorrow.
  const didInitialScrollRef = useRef(false);
  useEffect(() => {
    if (didInitialScrollRef.current) return;
    didInitialScrollRef.current = true;
    const hasTomorrowInitial = initialData.items.some(
      (d) => d.date === tomorrowStr
    );
    if (!hasTomorrowInitial) return;
    const el = document.querySelector<HTMLElement>("[data-today-anchor]");
    if (!el) return;
    el.scrollIntoView({ block: "start", behavior: "instant" as ScrollBehavior });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Infinite scroll sentinel
  useEffect(() => {
    if (!cursor) return;
    const sentinel = document.getElementById("load-more-sentinel");
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          loadMore();
        }
      },
      { rootMargin: "200px" }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [cursor, loadMore]);

  const tomorrowStr = (() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return localDate(d);
  })();
  const hasTomorrow = days.some((d) => d.date === tomorrowStr);
  const hasUnfinishedBefore = days.some(
    (d) => d.date < localDate() && d.tasks.some((t) => !t.completed)
  );

  // Always include today in the displayed list so we can render an empty state
  // even when nothing has been logged yet.
  const todayStr = localDate();
  const displayDays = days.some((d) => d.date === todayStr)
    ? days
    : [
        ...days.filter((d) => d.date > todayStr),
        { date: todayStr, tasks: [], timeSummary: [] } as FeedDay,
        ...days.filter((d) => d.date < todayStr),
      ];

  const visibleDays = isNextSessionView
    ? displayDays.filter((d) => d.date === todayStr)
    : displayDays;

  const sessionNumbersByDate = useMemo(() => {
    const map: Record<string, number[]> = {};
    for (const d of days) {
      const unique = new Set<number>();
      for (const t of d.tasks) unique.add(t.session_number ?? 1);
      map[d.date] = Array.from(unique).sort((a, b) => a - b);
    }
    return map;
  }, [days]);

  // Section trees for span → section display in task recordings lists (U6).
  // Merged across loaded days; pieces repeat across days so later days just
  // overwrite with the same tree.
  const sectionsByPiece = useMemo(() => {
    const merged: Record<string, PieceSectionWithChildren[]> = {};
    for (const d of days) {
      if (d.sectionsByPiece) Object.assign(merged, d.sectionsByPiece);
    }
    return merged;
  }, [days]);

  return (
    <PieceSectionsContext.Provider value={sectionsByPiece}>
    <div className="pl-8" onClick={handleRootClick}>
      {visibleDays.map((day) => (
        <DayGroup
          key={day.date}
          day={day}
          focusedPieceId={focusedPieceId}
          focusedPieceName={focusedPieceName}
          activePieces={activePieces}
          worksById={worksById}
          hasTomorrow={hasTomorrow && !isNextSessionView}
          hasUnfinishedBefore={hasUnfinishedBefore}
          isNextSessionView={isNextSessionView}
          onReorder={handleReorder}
          sessionNumbersByDate={sessionNumbersByDate}
        />
      ))}

      {cursor && !isNextSessionView && (
        <div id="load-more-sentinel" className="py-4 text-center">
          {loading && (
            <span className="text-sm text-muted-foreground">Loading...</span>
          )}
        </div>
      )}

    </div>
    </PieceSectionsContext.Provider>
  );
}
