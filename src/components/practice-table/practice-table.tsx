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
  CalendarArrowUpIcon,
  GripVerticalIcon,
  PlusIcon,
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
  type Leftovers,
  type PracticeView,
} from "@/app/practice/feed/actions";
import { usePracticeDay } from "@/components/practice-table/practice-day-context";
import { LeftoversSection } from "@/components/practice-table/leftovers-section";
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
}: {
  group: PieceGroup;
  dayDate: string;
  onAddTask: (afterTaskId: string | null) => void;
  daySessionNumbers: number[];
  currentSessionNumber: number;
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
        {group.tasks.map((task, index) => (
          <TaskRow
            key={getStableTaskKey(task.id)}
            task={task}
            isFirst={index === 0}
            onAddBelow={(afterTaskId) => onAddTask(afterTaskId)}
            daySessionNumbers={daySessionNumbers}
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
          <span className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground/80">
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
  today,
  isNextSessionView,
  onReorder,
}: {
  day: FeedDay;
  focusedPieceId: string | null;
  focusedPieceName: string | null;
  activePieces: Piece[];
  worksById: Record<string, string>;
  today: string;
  isNextSessionView: boolean;
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

  const allSessionGroups = groupTasksBySession(
    filteredTasks,
    pieceWorkNameById
  );

  const sessionGroups = isNextSessionView
    ? (() => {
        const firstIncomplete = allSessionGroups.find((s) =>
          s.pieces.some((p) => p.tasks.some((t) => !t.completed))
        );
        const targetNumber = firstIncomplete?.sessionNumber ?? null;
        if (targetNumber == null) return [];
        const target = allSessionGroups.find(
          (s) => s.sessionNumber === targetNumber
        );
        if (!target) return [];
        // Hide completed tasks. Preserve the unfiltered tasks on each piece so
        // aggregate timers in the session header still reflect the full
        // session, including time spent on tasks that have been archived.
        const filteredPieces = target.pieces
          .map((p) => ({
            ...p,
            tasks: p.tasks.filter((t) => !t.completed),
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

  const isToday = day.date === today;
  const isPast = day.date < today;
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

  return (
    <div className="mb-8">
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
        />
      ))}

      {nextSessionAllComplete ? (
        <div className="px-2 py-1.5 text-sm text-muted-foreground">
          All of today&apos;s sessions are complete.
        </div>
      ) : focusedPieceId ? (
        <button
          type="button"
          onClick={() => handleAddTask(focusedPieceId, defaultAddSession)}
          className={addTriggerClass}
        >
          {addTrigger}
        </button>
      ) : (
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
          </DropdownMenuContent>
        </DropdownMenu>
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
  const { today, viewDate, goToDate, setDayStats } = usePracticeDay();

  // Days are cached as they're visited: the one on screen and its neighbours,
  // so stepping either way paints at once while the next pair loads behind it.
  const [days, setDays] = useState<FeedDay[]>(initialView.days);
  const [loadedDates, setLoadedDates] = useState<ReadonlySet<string>>(
    () => new Set(initialView.days.map((d) => d.date))
  );
  const [leftovers, setLeftovers] = useState<Leftovers>(
    initialView.leftovers
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

  // Leftover cleanup is optimistic and meant to be clicked through quickly.
  // While any of those writes is still on its way, a server snapshot is behind
  // the screen — applying it would bring back rows already dealt with — so
  // snapshots are skipped until the clicks settle, then the view is re-read once.
  const pendingLeftoverOpsRef = useRef(0);

  // A fresh server render (a revalidating write, a reload) is newer than
  // anything cached for the days it carries.
  useEffect(() => {
    if (pendingLeftoverOpsRef.current > 0) return;
    mergeDays(initialView.days);
    setLeftovers(initialView.leftovers);
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
        if (pendingLeftoverOpsRef.current > 0) return;
        mergeDays(view.days, true);
        setLeftovers(view.leftovers);
      })
      .catch((err: unknown) => {
        if (isStaleBuildError(err)) reloadForNewBuild();
      });
  }, [mergeDays]);
  useEffect(() => registerRefresher(refreshView), [refreshView]);

  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const trackLeftoverOp = useCallback(
    (op: Promise<unknown>) => {
      pendingLeftoverOpsRef.current += 1;
      if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
      void op
        .catch(() => {})
        .finally(() => {
          pendingLeftoverOpsRef.current -= 1;
          if (pendingLeftoverOpsRef.current > 0) return;
          // A failed write shows up here too: the re-read puts it back.
          settleTimerRef.current = setTimeout(refreshView, 500);
        });
    },
    [refreshView]
  );

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
      // An earlier day's item that's un-archived becomes a leftover again.
      const reopened =
        updates.completed === false
          ? daysRef.current
              .flatMap((d) => d.tasks)
              .find((t) => t.id === taskId && t.date < localDate())
          : undefined;
      setLeftovers((prev) => {
        const inList = prev.recent.some((t) => t.id === taskId);
        if (inList) {
          return {
            ...prev,
            recent: prev.recent.map((t) =>
              t.id === taskId ? { ...t, ...updates } : t
            ),
          };
        }
        if (reopened && reopened.date >= prev.cutoff) {
          return {
            ...prev,
            recent: [...prev.recent, { ...reopened, ...updates }].sort((a, b) =>
              b.date.localeCompare(a.date)
            ),
          };
        }
        return prev;
      });
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
      setLeftovers((prev) =>
        prev.recent.some((t) => t.id === taskId)
          ? { ...prev, recent: prev.recent.filter((t) => t.id !== taskId) }
          : prev
      );
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

  const openLeftovers = leftovers.recent.filter((t) => !t.completed);

  return (
    <div className="pl-8" onClick={handleRootClick}>
      {isToday && !isNextSessionView && (
        <LeftoversSection
          tasks={openLeftovers}
          olderCount={leftovers.olderCount}
          olderRepeatingCount={leftovers.olderRepeatingCount}
          cutoff={leftovers.cutoff}
          today={today}
          onOlderArchived={() =>
            setLeftovers((prev) => ({
              ...prev,
              olderCount: 0,
              olderRepeatingCount: 0,
            }))
          }
          track={trackLeftoverOp}
        />
      )}

      {isViewLoading ? (
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
          isNextSessionView={isNextSessionView && isToday}
          onReorder={handleReorder}
        />
      )}

      <FollowUpToastHost sessionNumbersByDate={sessionNumbersByDate} />
    </div>
  );
}
