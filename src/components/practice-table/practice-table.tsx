"use client";

import { useState, useCallback, useEffect, useId, useMemo, useRef } from "react";
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
  CalendarArrowUpIcon,
  ChevronRightIcon,
  GripVerticalIcon,
  PlusIcon,
  RefreshCwIcon,
} from "lucide-react";
import { useTaskTimer } from "@/components/timer/task-timer-context";
import { useMetronome } from "@/components/metronome/metronome-context";
import { TaskRow } from "@/components/practice-table/task-row";
import { PieceSessionsDialog } from "@/components/practice-table/piece-sessions-dialog";
import {
  moveTasksToDate,
  reorderTasks,
  updateTasksSession,
} from "@/app/practice/timer/task-actions";
import {
  getPracticeDays,
  getPracticeView,
  type PracticeView,
} from "@/app/practice/feed/actions";
import { usePracticeDay } from "@/components/practice-table/practice-day-context";
import { useLogMode } from "@/components/practice-table/log-mode";
import { QuickLog } from "@/components/practice-table/quick-log";
import { AggregateTimerPill } from "@/components/practice-table/aggregate-timer-pill";
import {
  isStaleBuildError,
  registerRefresher,
  reloadForNewBuild,
} from "@/lib/sync/refresh";
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
import { FollowUpToastHost } from "@/components/practice-table/follow-up-toast";
import {
  useJustCompleted,
  useSessionDisplayPrefs,
  type LingerPhase,
} from "@/components/practice-table/session-display";
import {
  maintenanceLabel,
  pickMaintenancePiece,
} from "@/lib/practice/maintenance";
import { addDays, localDate } from "@/lib/date-utils";
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
import type { FeedDay, TaskWithDetails, PieceKind, Piece } from "@/lib/types";

type PieceGroup = {
  pieceId: string | null;
  pieceName: string;
  pieceWorkName: string | null;
  pieceKind: PieceKind | null;
  tasks: TaskWithDetails[];
  // Full task set used for aggregate timers. Differs from `tasks` only on
  // today, where finished items are hidden but timers should still reflect
  // all tasks (including completed ones).
  aggregateTasks?: TaskWithDetails[];
};

type SessionGroup = {
  sessionNumber: number;
  pieces: PieceGroup[];
  // Full unfiltered pieces for aggregate timers, for the same reason as
  // PieceGroup.aggregateTasks. Includes pieces whose tasks were all hidden.
  aggregatePieces?: PieceGroup[];
};

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

function SortablePieceGroup({
  group,
  dayDate,
  onAddTask,
  daySessionNumbers,
  currentSessionNumber,
  lingering,
}: {
  group: PieceGroup;
  dayDate: string;
  onAddTask: (afterTaskId: string | null) => void;
  daySessionNumbers: number[];
  currentSessionNumber: number;
  lingering: ReadonlyMap<string, LingerPhase>;
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
          <h3 className="text-base font-medium text-foreground">
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
        {group.tasks.map((task, index) => {
          // A just-finished item folds its height away as it goes, so the
          // rows below slide up rather than jump.
          const leaving = lingering.get(task.id) === "leaving";
          return (
            <div
              key={getStableTaskKey(task.id)}
              className={cn(
                "grid transition-[grid-template-rows,opacity] duration-200 ease-out",
                leaving ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr]"
              )}
            >
              <div className={cn("min-h-0", leaving && "overflow-hidden")}>
                <TaskRow
                  task={task}
                  isFirst={index === 0}
                  onAddBelow={(afterTaskId) => onAddTask(afterTaskId)}
                  daySessionNumbers={daySessionNumbers}
                />
              </div>
            </div>
          );
        })}
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
  collapsed,
  collapsedLabel,
  onToggleCollapsed,
  lingering,
  dayDate,
  daySessionNumbers,
  focusedPieceId,
  activePieces,
  worksById,
  onReorder,
  onAddTask,
  onAddPiece,
}: {
  sessionNumber: number;
  pieces: PieceGroup[];
  aggregatePieces?: PieceGroup[];
  showHeader: boolean;
  isFirst: boolean;
  collapsed: boolean;
  /** Shown beside the name while folded — "Done", or how much is left. */
  collapsedLabel: string | null;
  onToggleCollapsed: () => void;
  lingering: ReadonlyMap<string, LingerPhase>;
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
    <div
      className={cn(
        collapsed ? "mb-3" : "mb-5",
        !isFirst && showHeader && (collapsed ? "mt-3" : "mt-6")
      )}
    >
      {showHeader && (
        <div
          className={cn(
            "group/session flex items-center gap-3 px-1",
            !collapsed && "mb-3"
          )}
        >
          <button
            type="button"
            onClick={onToggleCollapsed}
            aria-expanded={!collapsed}
            className="-ml-5 flex items-center gap-1.5 rounded-md text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground/80 hover:text-foreground"
            title={collapsed ? "Show session" : "Hide session"}
          >
            <ChevronRightIcon
              className={cn(
                "size-3.5 transition-transform",
                !collapsed && "rotate-90"
              )}
            />
            Session {sessionNumber}
            {collapsed && collapsedLabel && (
              <span className="font-normal normal-case tracking-normal text-muted-foreground/70">
                · {collapsedLabel}
              </span>
            )}
          </button>
          <div className="h-px flex-1 bg-border/60" />
          {showSessionTimer && (
            <AggregateTimerPill
              elapsedSeconds={sessionElapsed}
              goalSeconds={sessionGoal}
              size="sm"
            />
          )}
          {!focusedPieceId && !collapsed && (
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
      {!collapsed && (
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
                lingering={lingering}
              />
            ))}
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
}

function DayGroup({
  day,
  focusedPieceId,
  focusedPieceName,
  activePieces,
  worksById,
  today,
  onReorder,
}: {
  day: FeedDay;
  focusedPieceId: string | null;
  focusedPieceName: string | null;
  activePieces: Piece[];
  worksById: Record<string, string>;
  today: string;
  onReorder: (dayDate: string, orderedIds: string[]) => void;
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

  const sessionGroups = groupTasksBySession(filteredTasks, pieceWorkNameById);

  const isToday = day.date === today;
  const isPast = day.date < today;

  // On today, finished items get out of the way: they're hidden unless asked
  // for, and a session with nothing left folds down to one line. Earlier days
  // are for looking back over, so they show everything.
  const { activeTaskId } = useTaskTimer();
  const display = useSessionDisplayPrefs(today);
  const lingering = useJustCompleted(filteredTasks, isToday);
  const hideCompleted = isToday && !display.showCompleted;

  const sessionLayout = sessionGroups.map((session) => {
    const tasks = session.pieces.flatMap((p) => p.tasks);
    const openCount = tasks.filter((t) => !t.completed).length;
    const isLingering = tasks.some((t) => lingering.has(t.id));
    const isDone = tasks.length > 0 && openCount === 0;
    const collapsedByDefault = isToday && isDone && !isLingering;
    const collapsed =
      display.collapsedOverride(day.date, session.sessionNumber) ??
      collapsedByDefault;
    // A finished session opened by hand is there to show what got done; the
    // only time one is filtered is the beat while its last item slides out.
    const filterFinished = hideCompleted && (!isDone || isLingering);
    const isHidden = (t: TaskWithDetails) =>
      filterFinished && t.completed && !lingering.has(t.id);
    const visible: SessionGroup = filterFinished
      ? {
          ...session,
          pieces: session.pieces
            .map((p) => ({
              ...p,
              tasks: p.tasks.filter((t) => !isHidden(t)),
              aggregateTasks: p.tasks,
            }))
            .filter((p) => p.tasks.length > 0),
          aggregatePieces: session.pieces,
        }
      : session;
    // What the "Show completed" link would bring back — only from open,
    // unfinished sessions, since finished ones have their own fold.
    const revealable =
      !collapsed && !isDone && isToday
        ? tasks.filter((t) => t.completed && !lingering.has(t.id)).length
        : 0;
    return {
      sessionNumber: session.sessionNumber,
      visible,
      collapsed,
      collapsedByDefault,
      collapsedLabel: isDone ? "Done" : `${openCount} left`,
      revealable,
    };
  });
  const layoutBySession = new Map(
    sessionLayout.map((l) => [l.sessionNumber, l])
  );
  const revealableCount = sessionLayout.reduce((n, l) => n + l.revealable, 0);

  const toggleCollapsed = (sessionNumber: number) => {
    const l = layoutBySession.get(sessionNumber);
    if (!l) return;
    display.setCollapsed(
      day.date,
      sessionNumber,
      !l.collapsed,
      l.collapsedByDefault
    );
  };

  // Practice moving into a folded session (auto-advance, the transport bar)
  // opens it, so the running item is always on screen.
  const activeTask = activeTaskId
    ? filteredTasks.find((t) => t.id === activeTaskId)
    : undefined;
  const activeSession = activeTask
    ? layoutBySession.get(activeTask.session_number ?? 1)
    : undefined;
  const lastActiveTaskIdRef = useRef(activeTaskId);
  const { setCollapsed } = display;
  useEffect(() => {
    if (activeTaskId === lastActiveTaskIdRef.current) return;
    lastActiveTaskIdRef.current = activeTaskId;
    if (!activeSession?.collapsed) return;
    setCollapsed(
      day.date,
      activeSession.sessionNumber,
      false,
      activeSession.collapsedByDefault
    );
  }, [activeTaskId, activeSession, day.date, setCollapsed]);

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
    ...sessionLayout.map((l) => l.visible),
    ...(pendingEmptySession !== null
      ? [{ sessionNumber: pendingEmptySession, pieces: [] }]
      : []),
  ];
  // A lone session has no header — unless it's folded, when the header is
  // all there is to show.
  const showSessionHeaders =
    sessionsToRender.length > 1 || sessionLayout.some((l) => l.collapsed);

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

  const handleAddMaintenance = async () => {
    if (!nextMaintenance) return;
    const piece = nextMaintenance.piece;
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
      sessionNumber: defaultAddSession,
    });
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

  // Built from the whole day, not `filteredTasks`: with a piece in focus the
  // visible list is narrowed, and excluding from that would happily offer a
  // piece already sitting on the page. Optimistic rows are in `day.tasks` the
  // moment they are added, which is what lets two taps name two pieces without
  // waiting on the server.
  // Built from the whole day, not `filteredTasks`: with a piece in focus the
  // visible list is narrowed, and excluding from that would happily offer a
  // piece already sitting on the page. Optimistic rows land in `day.tasks` the
  // moment they are added, which is what lets two taps name two pieces without
  // waiting on the server.
  const dayPieceIds = new Set(
    day.tasks.map((t) => t.piece_id).filter((id): id is string => id !== null)
  );

  const maintenancePieces = activePieces.filter((p) => p.maintenance);

  const nextMaintenance = pickMaintenancePiece({
    pieces: maintenancePieces,
    lastPracticedByPiece: day.lastPracticedByPiece ?? {},
    excluded: dayPieceIds,
    asOf: day.date,
  });

  const isEmpty = sessionGroups.length === 0 && pendingEmptySession === null;

  const emptyLabel = focusedPieceId
    ? `No ${focusedPieceName ?? "practice"} ${isToday ? "yet today" : isPast ? "on this day" : "planned yet"}.`
    : isToday
      ? "No practice yet today. Hit record or add something."
      : isPast
        ? "Nothing logged on this day."
        : "Nothing planned yet.";

  const addTrigger = (
    <>
      <PlusIcon className="size-3" />
      {isEmpty ? emptyLabel : "Add"}
    </>
  );
  const addTriggerClass =
    "flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground";

  // The same conditions that used to hide "New session" from the Add menu.
  // Now that it stands on its own it stays put and dims instead.
  const newSessionDisabled =
    filteredTasks.length === 0 || pendingEmptySession !== null;

  return (
    <div className="mb-8">
      {/* Session blocks */}
      {sessionsToRender.map((session, index) => {
        const layout = layoutBySession.get(session.sessionNumber);
        return (
          <SessionBlock
            key={session.sessionNumber}
            sessionNumber={session.sessionNumber}
            pieces={session.pieces}
            aggregatePieces={session.aggregatePieces}
            showHeader={showSessionHeaders}
            isFirst={index === 0}
            collapsed={layout?.collapsed ?? false}
            collapsedLabel={layout?.collapsedLabel ?? null}
            onToggleCollapsed={() => toggleCollapsed(session.sessionNumber)}
            lingering={lingering}
            dayDate={day.date}
            daySessionNumbers={sessionsToRender.map((s) => s.sessionNumber)}
            focusedPieceId={focusedPieceId}
            activePieces={activePieces}
            worksById={worksById}
            onReorder={onReorder}
            onAddTask={handleAddTask}
            onAddPiece={handleAddPiece}
          />
        );
      })}

      {focusedPieceId ? (
        <button
          type="button"
          onClick={() => handleAddTask(focusedPieceId, defaultAddSession)}
          className={addTriggerClass}
        >
          {addTrigger}
        </button>
      ) : (
        <div className="flex flex-wrap items-center gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger className={addTriggerClass}>
              {addTrigger}
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
            </DropdownMenuContent>
          </DropdownMenu>
          {maintenancePieces.length > 0 && (
            <button
              type="button"
              onClick={handleAddMaintenance}
              disabled={!nextMaintenance}
              className={cn(
                addTriggerClass,
                !nextMaintenance &&
                  "cursor-default opacity-50 hover:text-muted-foreground"
              )}
            >
              <RefreshCwIcon className="size-3" />
              {nextMaintenance
                ? maintenanceLabel(nextMaintenance)
                : "Maintenance — all queued"}
            </button>
          )}
          <button
            type="button"
            onClick={handleAddSession}
            disabled={newSessionDisabled}
            className={cn(
              addTriggerClass,
              newSessionDisabled &&
                "cursor-default opacity-50 hover:text-muted-foreground"
            )}
          >
            <PlusIcon className="size-3" />
            New session
          </button>
        </div>
      )}

      {revealableCount > 0 && (
        <button
          type="button"
          onClick={() => display.setShowCompleted(!display.showCompleted)}
          className="mt-1 px-2 py-1 text-xs text-muted-foreground/80 underline-offset-2 transition-colors hover:text-foreground hover:underline"
        >
          {display.showCompleted
            ? "Hide completed tasks"
            : `Show ${revealableCount} completed ${revealableCount === 1 ? "task" : "tasks"}`}
        </button>
      )}
    </div>
  );
}

export function PracticeTable({
  initialView,
}: {
  initialView: PracticeView;
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
  const { today, viewDate, goToDate, setDayStats } = usePracticeDay();

  // Days are cached as they're visited: the one on screen and its neighbours,
  // so stepping either way paints at once while the next pair loads behind it.
  const [days, setDays] = useState<FeedDay[]>(initialView.days);
  const [loadedDates, setLoadedDates] = useState<ReadonlySet<string>>(
    () => new Set(initialView.days.map((d) => d.date))
  );
  const inflightRef = useRef(new Set<string>());
  const daysRef = useRef(days);
  daysRef.current = days;
  const viewDateRef = useRef(viewDate);
  viewDateRef.current = viewDate;

  /**
   * Take fresh copies of some days. `onlyThese` marks every other cached day
   * as needing a re-read the next time it's shown — it stays on hand to paint
   * instantly meanwhile.
   */
  const mergeDays = useCallback((fresh: FeedDay[], onlyThese = false) => {
    const freshDates = new Set(fresh.map((d) => d.date));
    setDays((prev) =>
      [...prev.filter((d) => !freshDates.has(d.date)), ...fresh].sort((a, b) =>
        b.date.localeCompare(a.date)
      )
    );
    setLoadedDates((prev) => new Set([...(onlyThese ? [] : prev), ...freshDates]));
  }, []);

  // A fresh server render (a revalidating write, a reload) is newer than
  // anything cached for the days it carries.
  useEffect(() => {
    mergeDays(initialView.days);
  }, [initialView, mergeDays]);

  // Load the day on screen and its neighbours when they aren't cached yet.
  useEffect(() => {
    const wanted = [addDays(viewDate, -1), viewDate, addDays(viewDate, 1)].filter(
      (d) => !loadedDates.has(d) && !inflightRef.current.has(d)
    );
    if (wanted.length === 0) return;
    for (const d of wanted) inflightRef.current.add(d);
    void getPracticeDays(wanted)
      .then((fresh) => mergeDays(fresh))
      .catch((err: unknown) => {
        if (isStaleBuildError(err)) reloadForNewBuild();
      })
      .finally(() => {
        for (const d of wanted) inflightRef.current.delete(d);
      });
  }, [viewDate, loadedDates, mergeDays]);

  // In-place re-read of whatever is on screen — for coming back to the window
  // and for the app shell's "this page was replayed from cache" check. Re-reads
  // into the mounted tree rather than re-running the route, so nothing being
  // edited is remounted.
  const refreshSeqRef = useRef(0);
  const refreshView = useCallback(() => {
    const mine = ++refreshSeqRef.current;
    void getPracticeView(viewDateRef.current, localDate())
      .then((view) => {
        if (mine !== refreshSeqRef.current) return;
        mergeDays(view.days, true);
      })
      .catch((err: unknown) => {
        if (isStaleBuildError(err)) reloadForNewBuild();
      });
  }, [mergeDays]);
  useEffect(() => registerRefresher(refreshView), [refreshView]);

  // Starting practice on another day (record from the bar, say, while looking
  // at last week) brings the log to that day.
  useEffect(() => {
    const handler = (e: Event) => {
      const { date } = (e as CustomEvent<{ date: string }>).detail;
      if (date !== viewDateRef.current) goToDate(date);
    };
    window.addEventListener("practice-timer-started", handler);
    return () => window.removeEventListener("practice-timer-started", handler);
  }, [goToDate]);

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

  // A timer stopping (or handing over to another task) announces where it
  // left off. Rows keep their own copy; the day takes it too, so anything
  // reading the day — the quick logger's totals — is current without waiting
  // for the server.
  useEffect(() => {
    const handler = (e: Event) => {
      const { taskId, remainingSeconds } = (
        e as CustomEvent<{ taskId: string; remainingSeconds: number }>
      ).detail;
      setDays((prev) =>
        prev.map((d) =>
          d.tasks.some((t) => t.id === taskId)
            ? {
                ...d,
                tasks: d.tasks.map((t) =>
                  t.id === taskId
                    ? { ...t, timer_remaining_seconds: remainingSeconds }
                    : t
                ),
              }
            : d
        )
      );
    };
    window.addEventListener("task-timer-paused", handler);
    return () => window.removeEventListener("task-timer-paused", handler);
  }, []);

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
        repeat_interval_days: detail.repeatIntervalDays ?? null,
        repeat_source_task_id: detail.repeatSourceTaskId ?? null,
        audio_path: null,
        audio_duration_seconds: null,
        audio_trim_start_seconds: null,
        audio_trim_end_seconds: null,
        audio_title: null,
        session_id: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
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

      // Finished items are hidden on today, so skip past any to the next
      // thing still to do.
      const nextTask =
        tasksInView.slice(idx + 1).find((t) => !t.completed) ?? null;
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

  // Quick-add from the header's "Pieces" menu: append the piece to the latest
  // session of the day on screen, and on today make it the active timer item
  // immediately — planning tomorrow or backfilling yesterday starts nothing. Uses a ref so
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

      const date = viewDateRef.current;
      const isToday = date === localDate();
      const day = days.find((d) => d.date === date);
      const sessionNumber = (day?.tasks ?? []).reduce(
        (max, t) => Math.max(max, t.session_number ?? 1),
        1
      );

      void createTaskOptimistic({
        pieceId: piece.id,
        sectionId: null,
        date,
        metronomeSpeed: null,
        pieceName: piece.name,
        pieceComposer: piece.composer,
        pieceKind: piece.kind,
        sectionLabel: null,
        sectionStatus: null,
        sessionNumber,
      })
        .then((result) => {
          if (!isToday) return;
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
            date,
          });
          setActivePieceInstance({
            pieceId: piece.id,
            key: `${date}:${sessionNumber}:${piece.id}`,
          });
        })
        .catch(() => {});
    };
    window.addEventListener("practice-quick-add-piece", handler);
    return () => window.removeEventListener("practice-quick-add-piece", handler);
  }, []);

  const viewDay = days.find((d) => d.date === viewDate) ?? null;
  const isViewLoading = viewDay === null && !loadedDates.has(viewDate);
  const displayDay: FeedDay = viewDay ?? {
    date: viewDate,
    tasks: [],
    timeSummary: [],
  };
  const isToday = viewDate === today;
  const { mode } = useLogMode();

  // The title bar shows the day's total next to its name.
  const dayElapsedSeconds = displayDay.tasks.reduce(
    (sum, t) => sum + Math.max(0, t.timer_seconds - t.timer_remaining_seconds),
    0
  );
  const dayGoalSeconds = displayDay.tasks.reduce(
    (sum, t) => sum + Math.max(0, t.timer_seconds),
    0
  );
  useEffect(() => {
    setDayStats({ elapsedSeconds: dayElapsedSeconds, goalSeconds: dayGoalSeconds });
  }, [dayElapsedSeconds, dayGoalSeconds, setDayStats]);

  const sessionNumbersByDate = useMemo(() => {
    const map: Record<string, number[]> = {};
    for (const d of days) {
      const unique = new Set<number>();
      for (const t of d.tasks) unique.add(t.session_number ?? 1);
      map[d.date] = Array.from(unique).sort((a, b) => a - b);
    }
    return map;
  }, [days]);

  return (
    <div className="pl-8" onClick={handleRootClick}>
      {isToday && mode === "quick" ? (
        <QuickLog day={displayDay} today={today} />
      ) : isViewLoading ? (
        <div className="space-y-3 py-1" aria-busy="true">
          <div className="h-5 w-40 animate-pulse rounded bg-muted" />
          <div className="h-10 animate-pulse rounded bg-muted/60" />
          <div className="h-10 animate-pulse rounded bg-muted/60" />
        </div>
      ) : (
        <DayGroup
          key={viewDate}
          day={displayDay}
          focusedPieceId={focusedPieceId}
          focusedPieceName={focusedPieceName}
          activePieces={activePieces}
          worksById={worksById}
          today={today}
          onReorder={handleReorder}
        />
      )}

      <FollowUpToastHost sessionNumbersByDate={sessionNumbersByDate} />
    </div>
  );
}
