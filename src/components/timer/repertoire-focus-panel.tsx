"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  CheckCircle2Icon,
  ExternalLinkIcon,
  GripVerticalIcon,
  ListPlusIcon,
  MetronomeIcon,
  NotebookPenIcon,
  PlusIcon,
  Trash2Icon,
  VideoIcon,
  XIcon,
} from "lucide-react";
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTaskTimer } from "@/components/timer/task-timer-context";
import { TimeSummary } from "@/components/timer/time-summary";
import { getTodaySummary } from "@/app/practice/timer/actions";
import { getLastPracticedByPiece } from "@/app/practice/feed/actions";
import {
  getAllOpenAssignments,
  getAssignmentsForPiece,
  toggleAssignmentCompleted,
  createAssignment,
  createTaskFromAssignment,
  deleteAssignment,
  updateAssignmentText,
  updateAssignmentMetronome,
  reorderAssignments,
} from "@/app/practice/focus-panel/actions";
import type { AssignmentWithPiece } from "@/app/practice/focus-panel/actions";
import { cn } from "@/lib/utils";
import { getSections } from "@/app/practice/repertoire/section-actions";
import {
  createTaskOptimistic,
  emitOptimisticTask,
  rollbackOptimisticTask,
} from "@/lib/optimistic-task";
import { createClient } from "@/lib/supabase/client";
import { useMetronome } from "@/components/metronome/metronome-context";
import { SectionSidebar } from "@/components/timer/section-sidebar";
import { AddLessonNoteDialog } from "@/components/lessons/add-lesson-note-dialog";
import { YouTubePlayer } from "@/components/video/youtube-player";
import { useVideo } from "@/components/video/video-context";
import type {
  Piece,
  PieceKind,
  PieceSectionWithChildren,
  Assignment,
  TimeSummaryEntry,
} from "@/lib/types";
import { TECHNIQUE_PIECE_ID, SIGHT_READING_PIECE_ID } from "@/lib/types";
import { daysBetween, localDate } from "@/lib/date-utils";
import { daysSinceLabel } from "@/lib/practice/maintenance";

// Client-side caches so re-selecting a piece shows data instantly
const sectionsCache = new Map<string, PieceSectionWithChildren[]>();
const assignmentsCache = new Map<string, { openAssignments: Assignment[]; completedAssignments: Assignment[] }>();

export function RepertoireFocusPanel() {
  const {
    focusedPieceId,
    setFocusedPieceId,
    activePieceInstance,
    setActivePieceInstance,
    activePieces,
    activeTaskId,
  } = useTaskTimer();

  const activePieceId = activePieceInstance?.pieceId ?? focusedPieceId;

  const handleFocusItem = useCallback(
    (focusKey: string) => {
      setFocusedPieceId(focusKey);
      setActivePieceInstance(null);
      window.history.replaceState(null, "", `/practice?focus=${focusKey}`);
    },
    [setFocusedPieceId, setActivePieceInstance]
  );

  let content: React.ReactNode;

  if (activePieceId) {
    const activePiece = activePieces.find((p) => p.id === activePieceId);
    content = <PieceDetail pieceId={activePieceId} knownPiece={activePiece ?? null} />;
  } else {
    content = (
      <PracticeOverview
        isRunning={activeTaskId !== null}
        onFocusItem={handleFocusItem}
        activePieces={activePieces}
      />
    );
  }

  return (
    <>
      {content}
      <FloatingVideoPanel />
    </>
  );
}

// ---------------------------------------------------------------------------
// Piece Detail (handles both regular pieces and system pieces like technique)
// ---------------------------------------------------------------------------

function isSystemPiece(pieceId: string): boolean {
  return pieceId === TECHNIQUE_PIECE_ID || pieceId === SIGHT_READING_PIECE_ID;
}

function PieceDetail({ pieceId, knownPiece }: { pieceId: string; knownPiece: Piece | null }) {
  const video = useVideo();
  const cached = assignmentsCache.get(pieceId);
  const [piece, setPiece] = useState<{
    name: string;
    composer: string | null;
    target_tempo: number | null;
    kind: PieceKind;
  } | null>(knownPiece ? { name: knownPiece.name, composer: knownPiece.composer, target_tempo: knownPiece.target_tempo, kind: (knownPiece.kind ?? "piece") as PieceKind } : null);
  const [openAssignments, setOpenAssignments] = useState<Assignment[]>(cached?.openAssignments ?? []);
  const [sections, setSections] = useState<PieceSectionWithChildren[]>(
    () => sectionsCache.get(pieceId) ?? []
  );
  const [isAddingAssignment, setIsAddingAssignment] = useState(false);
  const [isLessonNoteOpen, setIsLessonNoteOpen] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  // Update piece immediately when knownPiece changes (no network needed)
  useEffect(() => {
    if (knownPiece) {
      setPiece({ name: knownPiece.name, composer: knownPiece.composer, target_tempo: knownPiece.target_tempo, kind: (knownPiece.kind ?? "piece") as PieceKind });
    }
  }, [knownPiece]);

  const refreshAssignments = useCallback(() => {
    getAssignmentsForPiece(pieceId).then((data) => {
      assignmentsCache.set(pieceId, data);
      setOpenAssignments(data.openAssignments);
    });
  }, [pieceId]);

  const refreshSections = useCallback(() => {
    getSections(pieceId).then((data) => {
      sectionsCache.set(pieceId, data);
      setSections(data);
    }).catch(() => {
      getSections(pieceId).then((data) => {
        sectionsCache.set(pieceId, data);
        setSections(data);
      }).catch(() => {});
    });
  }, [pieceId]);

  useEffect(() => {
    const cachedSections = sectionsCache.get(pieceId);
    if (cachedSections) setSections(cachedSections);
    const cachedAssignments = assignmentsCache.get(pieceId);
    if (cachedAssignments) {
      setOpenAssignments(cachedAssignments.openAssignments);
    }

    if (!knownPiece) {
      const supabase = createClient();
      supabase
        .from("pieces")
        .select("name, composer, target_tempo, kind")
        .eq("id", pieceId)
        .single()
        .then(({ data }) => {
          if (data) {
            setPiece({ name: data.name, composer: data.composer, target_tempo: data.target_tempo, kind: data.kind as PieceKind });
          }
        });
    }

    refreshAssignments();
    if (!isSystemPiece(pieceId)) {
      refreshSections();
    }
  }, [pieceId, refreshAssignments, refreshSections, knownPiece]);

  useEffect(() => {
    if (isSystemPiece(pieceId)) return;
    void video.loadPieceVideo(pieceId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pieceId]);

  useEffect(() => {
    const handler = () => refreshAssignments();
    window.addEventListener("assignments-changed", handler);
    return () => window.removeEventListener("assignments-changed", handler);
  }, [refreshAssignments]);

  useEffect(() => {
    const handler = () => refreshSections();
    window.addEventListener("sections-changed", handler);
    return () => window.removeEventListener("sections-changed", handler);
  }, [refreshSections]);

  useEffect(() => {
    const handler = (e: Event) => {
      const { sectionId, status } = (e as CustomEvent).detail;
      setSections((prev) => {
        const next = prev.map((s) => {
          if (s.id === sectionId) return { ...s, status };
          return {
            ...s,
            children: s.children.map((c) =>
              c.id === sectionId ? { ...c, status } : c
            ),
          };
        });
        sectionsCache.set(pieceId, next);
        return next;
      });
    };
    window.addEventListener("section-status-changed", handler);
    return () => window.removeEventListener("section-status-changed", handler);
  }, []);

  const handleToggle = async (assignment: Assignment) => {
    setOpenAssignments((prev) => prev.filter((t) => t.id !== assignment.id));
    await toggleAssignmentCompleted(assignment.id, true);
  };

  const handleCreate = async (text: string) => {
    const tempId = `temp-${crypto.randomUUID()}`;
    const temp: Assignment = {
      id: tempId,
      piece_id: pieceId,
      text,
      completed: false,
      completed_at: null,
      sort_order: 9999,
      metronome_speed: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    setOpenAssignments((prev) => [...prev, temp]);
    try {
      const created = await createAssignment(pieceId, text);
      setOpenAssignments((prev) => prev.map((a) => (a.id === tempId ? created : a)));
    } catch {
      setOpenAssignments((prev) => prev.filter((a) => a.id !== tempId));
    }
  };

  const handleDelete = async (assignmentId: string) => {
    setOpenAssignments((prev) => prev.filter((t) => t.id !== assignmentId));
    await deleteAssignment(assignmentId);
  };

  const handleEdit = async (assignmentId: string, newText: string) => {
    setOpenAssignments((prev) =>
      prev.map((a) => (a.id === assignmentId ? { ...a, text: newText } : a))
    );
    await updateAssignmentText(assignmentId, newText);
  };

  const handleMetronomeChange = async (
    assignmentId: string,
    speed: number | null
  ) => {
    setOpenAssignments((prev) =>
      prev.map((a) => (a.id === assignmentId ? { ...a, metronome_speed: speed } : a))
    );
    await updateAssignmentMetronome(assignmentId, speed);
  };

  const handleReorder = useCallback(
    (orderedIds: string[]) => {
      setOpenAssignments((prev) => {
        const byId = new Map(prev.map((a) => [a.id, a]));
        return orderedIds
          .map((id) => byId.get(id))
          .filter((a): a is Assignment => !!a)
          .map((a, i) => ({ ...a, sort_order: i }));
      });
      const realIds = orderedIds.filter((id) => !id.startsWith("temp-"));
      if (realIds.length > 0) {
        void reorderAssignments(realIds);
      }
    },
    []
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const ids = openAssignments.map((a) => a.id);
      const activeId = String(active.id);
      const overId = String(over.id);
      const oldIndex = ids.indexOf(activeId);
      const newIndex = ids.indexOf(overId);
      if (oldIndex === -1 || newIndex === -1) return;
      const reordered = [...ids];
      reordered.splice(oldIndex, 1);
      reordered.splice(newIndex, 0, activeId);
      handleReorder(reordered);
    },
    [openAssignments, handleReorder]
  );

  const handleAddToTasks = useCallback(
    async (assignment: Assignment) => {
      if (!piece) return;
      const today = localDate();
      const tempId = emitOptimisticTask({
        pieceId: assignment.piece_id,
        sectionId: null,
        date: today,
        text: assignment.text,
        metronomeSpeed: assignment.metronome_speed,
        pieceName: piece.name,
        pieceComposer: piece.composer,
        pieceKind: piece.kind,
        sectionLabel: null,
        sectionStatus: null,
      });
      try {
        await createTaskFromAssignment(
          assignment.piece_id,
          assignment.text,
          assignment.metronome_speed,
          today
        );
      } catch (err) {
        rollbackOptimisticTask(tempId);
        throw err;
      }
    },
    [piece]
  );

  if (!piece) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          <p className="text-sm">Loading...</p>
        </CardContent>
      </Card>
    );
  }

  const systemPiece = isSystemPiece(pieceId);
  const hasAssignmentsContent = isAddingAssignment || openAssignments.length > 0;
  const hasSectionsContent = !systemPiece && sections.length > 0;
  const showCardContent = hasAssignmentsContent || hasSectionsContent;

  return (
    <div className="space-y-4">
      {/* Piece card: header, assignments, sections */}
      <Card>
        <CardHeader className="pb-0">
          <div className="flex items-center gap-2">
            <CardTitle className="text-base flex-1 min-w-0">
              <span className="truncate">{piece.name}</span>
              {piece.composer && (
                <span className="text-sm font-normal text-muted-foreground ml-1.5">
                  {piece.composer}
                </span>
              )}
            </CardTitle>
            <div className="flex items-center gap-1 shrink-0">
              {!systemPiece && <PieceVideoToggle />}
              <button
                type="button"
                onClick={() => setIsAddingAssignment(true)}
                className="p-1 text-muted-foreground hover:text-foreground transition-colors"
                title="Add assignment"
                aria-label="Add assignment"
              >
                <PlusIcon className="size-3.5" />
              </button>
              {!systemPiece && (
                <button
                  type="button"
                  onClick={() => setIsLessonNoteOpen(true)}
                  className="p-1 text-muted-foreground hover:text-foreground transition-colors"
                  title="Add note to next lesson"
                  aria-label="Add note to next lesson"
                >
                  <NotebookPenIcon className="size-3.5" />
                </button>
              )}
              {!systemPiece && (
                <Link
                  href={`/practice/repertoire/${pieceId}`}
                  className="p-1 text-muted-foreground hover:text-foreground transition-colors"
                  title="Open repertoire page"
                >
                  <ExternalLinkIcon className="size-3.5" />
                </Link>
              )}
            </div>
          </div>
        </CardHeader>
        {showCardContent && (
          <CardContent className="space-y-4">
            {hasAssignmentsContent && (
              <div>
                {isAddingAssignment && (
                  <PendingAssignmentInput
                    onSubmit={async (text) => {
                      setIsAddingAssignment(false);
                      await handleCreate(text);
                    }}
                    onCancel={() => setIsAddingAssignment(false)}
                  />
                )}
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={handleDragEnd}
                >
                  <SortableContext
                    items={openAssignments.map((a) => a.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    <div className="space-y-1.5">
                      {openAssignments.map((assignment) => (
                        <SortableAssignmentRow
                          key={assignment.id}
                          assignment={assignment}
                          onToggle={() => handleToggle(assignment)}
                          onDelete={() => handleDelete(assignment.id)}
                          onEdit={(text) => handleEdit(assignment.id, text)}
                          onMetronomeChange={(speed) =>
                            handleMetronomeChange(assignment.id, speed)
                          }
                          onAddToTasks={() => handleAddToTasks(assignment)}
                        />
                      ))}
                    </div>
                  </SortableContext>
                </DndContext>
              </div>
            )}
            {hasSectionsContent && (
              <SectionSidebar
                sections={sections}
                pieceTargetTempo={piece.target_tempo}
                pieceId={pieceId}
                pieceName={piece.name}
                composer={piece.composer}
                onSectionsChanged={refreshSections}
                onStatusChange={(sectionId, status) => {
                  setSections((prev) => {
                    const next = prev.map((s) => {
                      if (s.id === sectionId) return { ...s, status };
                      return {
                        ...s,
                        children: s.children.map((c) =>
                          c.id === sectionId ? { ...c, status } : c
                        ),
                      };
                    });
                    sectionsCache.set(pieceId, next);
                    return next;
                  });
                }}
                onAddTask={(section, metronomeSpeed, tomorrow) => {
                  const date = tomorrow
                    ? localDate(new Date(Date.now() + 86_400_000))
                    : localDate();
                  void createTaskOptimistic({
                    pieceId,
                    sectionId: section.id,
                    date,
                    metronomeSpeed,
                    text: section.notes ?? undefined,
                    pieceName: piece.name,
                    pieceComposer: piece.composer,
                    pieceKind: piece.kind,
                    sectionLabel: section.label,
                    sectionStatus: section.status,
                    autoFocusNotes: { selectAll: !!section.notes },
                  });
                }}
              />
            )}
          </CardContent>
        )}
      </Card>
      {!systemPiece && (
        <AddLessonNoteDialog
          open={isLessonNoteOpen}
          onOpenChange={setIsLessonNoteOpen}
          pieceId={pieceId}
          pieceName={piece.name}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Piece Video (floating bottom-left panel)
// ---------------------------------------------------------------------------

function PieceVideoToggle() {
  const { videoId, showVideo, setShowVideo } = useVideo();
  if (!videoId) return null;
  return (
    <button
      type="button"
      onClick={() => setShowVideo(!showVideo)}
      className={`p-1 transition-colors ${showVideo ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}
      title={showVideo ? "Hide video" : "Show video"}
    >
      <VideoIcon className="size-3.5" />
    </button>
  );
}

function FloatingVideoPanel() {
  const { videoId, showVideo, setShowVideo } = useVideo();
  const [width, setWidth] = useState(320);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const interactionRef = useRef<
    | { type: "drag"; startMouseX: number; startMouseY: number; startX: number; startY: number }
    | { type: "resize"; startMouseX: number; startWidth: number }
    | null
  >(null);

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    const pos = position ?? { x: 16, y: window.innerHeight - 16 - Math.round(320 * 9 / 16) - 24 };
    interactionRef.current = {
      type: "drag",
      startMouseX: e.clientX,
      startMouseY: e.clientY,
      startX: pos.x,
      startY: pos.y,
    };

    const handleMove = (ev: MouseEvent) => {
      const ref = interactionRef.current;
      if (!ref || ref.type !== "drag") return;
      setPosition({
        x: ref.startX + (ev.clientX - ref.startMouseX),
        y: ref.startY + (ev.clientY - ref.startMouseY),
      });
    };

    const handleUp = () => {
      interactionRef.current = null;
      document.removeEventListener("mousemove", handleMove);
      document.removeEventListener("mouseup", handleUp);
    };

    document.addEventListener("mousemove", handleMove);
    document.addEventListener("mouseup", handleUp);
  }, [position]);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    interactionRef.current = {
      type: "resize",
      startMouseX: e.clientX,
      startWidth: width,
    };

    const handleMove = (ev: MouseEvent) => {
      const ref = interactionRef.current;
      if (!ref || ref.type !== "resize") return;
      const delta = ev.clientX - ref.startMouseX;
      setWidth(Math.max(240, Math.min(640, ref.startWidth + delta)));
    };

    const handleUp = () => {
      interactionRef.current = null;
      document.removeEventListener("mousemove", handleMove);
      document.removeEventListener("mouseup", handleUp);
    };

    document.addEventListener("mousemove", handleMove);
    document.addEventListener("mouseup", handleUp);
  }, [width]);

  if (!videoId || !showVideo) return null;

  const height = Math.round(width * 9 / 16);

  return (
    <div
      className="fixed z-50 rounded-lg overflow-hidden shadow-lg border bg-card"
      style={position
        ? { width, left: position.x, top: position.y }
        : { width, left: 16, bottom: 16 }
      }
    >
      <div
        onMouseDown={handleDragStart}
        className="flex items-center justify-between px-2 py-1 bg-muted/50 cursor-grab active:cursor-grabbing select-none"
      >
        <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Video</span>
        <button
          type="button"
          onClick={() => setShowVideo(false)}
          className="p-0.5 text-muted-foreground hover:text-foreground transition-colors"
        >
          <XIcon className="size-3" />
        </button>
      </div>
      <div style={{ height }} className="relative bg-black">
        <YouTubePlayer bare />
      </div>
      <div
        onMouseDown={handleResizeStart}
        className="absolute top-0 right-0 w-1.5 h-full cursor-ew-resize hover:bg-primary/20 transition-colors"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Row components
// ---------------------------------------------------------------------------

function AssignmentTextWithMetronome({ text }: { text: string }) {
  const { start } = useMetronome();
  const parts = text.split(/(♩=\d+)/);
  return (
    <>
      {parts.map((part, i) => {
        const match = part.match(/^♩=(\d+)$/);
        if (match) {
          const bpm = parseInt(match[1], 10);
          return (
            <button
              key={i}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                start(bpm);
              }}
              className="inline-flex items-center rounded-md bg-secondary px-1 py-0.5 font-mono text-xs text-secondary-foreground cursor-pointer hover:bg-secondary/80 transition-colors"
            >
              ♩={bpm}
            </button>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

function AssignmentRow({
  assignment,
  onToggle,
  onDelete,
  onEdit,
  onMetronomeChange,
  showCompletedDate,
  dragHandle,
}: {
  assignment: Assignment;
  onToggle: () => void;
  onDelete?: () => void;
  onEdit?: (newText: string) => void;
  onMetronomeChange?: (speed: number | null) => void;
  showCompletedDate?: boolean;
  dragHandle?: React.ReactNode;
}) {
  const metronomeCtx = useMetronome();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(assignment.text);
  const inputRef = useRef<HTMLInputElement>(null);

  const [editingMetronome, setEditingMetronome] = useState(false);
  const [metronomeText, setMetronomeText] = useState(
    assignment.metronome_speed?.toString() ?? ""
  );
  const [optimisticMetronomeSpeed, setOptimisticMetronomeSpeed] = useState<
    number | null
  >(assignment.metronome_speed);
  const metronomeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setText(assignment.text);
  }, [assignment.text]);

  useEffect(() => {
    setOptimisticMetronomeSpeed(assignment.metronome_speed);
    setMetronomeText(assignment.metronome_speed?.toString() ?? "");
  }, [assignment.metronome_speed]);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  useEffect(() => {
    if (editingMetronome) {
      metronomeRef.current?.focus();
      metronomeRef.current?.select();
    }
  }, [editingMetronome]);

  const commit = () => {
    const trimmed = text.trim();
    if (!trimmed) {
      setText(assignment.text);
      setEditing(false);
      return;
    }
    if (trimmed !== assignment.text) {
      if (onEdit) {
        onEdit(trimmed);
      } else {
        void updateAssignmentText(assignment.id, trimmed);
      }
    }
    setEditing(false);
  };

  const cancel = () => {
    setText(assignment.text);
    setEditing(false);
  };

  const isMetronomeActiveForThisRow =
    metronomeCtx.isActive && metronomeCtx.activeSourceId === assignment.id;

  const commitMetronome = () => {
    const val = metronomeText.trim();
    const parsed = val ? parseInt(val, 10) : NaN;
    const normalized = Number.isFinite(parsed) ? parsed : null;
    if (normalized !== optimisticMetronomeSpeed) {
      setOptimisticMetronomeSpeed(normalized);
      setMetronomeText(normalized?.toString() ?? "");
      if (onMetronomeChange) {
        onMetronomeChange(normalized);
      } else {
        void updateAssignmentMetronome(assignment.id, normalized);
      }
    } else {
      setMetronomeText(normalized?.toString() ?? "");
    }
    setEditingMetronome(false);
  };

  const cancelMetronome = () => {
    setMetronomeText(optimisticMetronomeSpeed?.toString() ?? "");
    setEditingMetronome(false);
  };

  const handleMetronomePillClick = () => {
    if (!optimisticMetronomeSpeed) return;
    if (isMetronomeActiveForThisRow) {
      metronomeCtx.stop();
    } else {
      metronomeCtx.start(optimisticMetronomeSpeed, assignment.id);
    }
  };

  const handleMetronomeRightClick = (e: React.MouseEvent) => {
    e.preventDefault();
    setEditingMetronome(true);
  };

  return (
    <div className="group">
      <div className="flex items-start gap-1.5 text-sm">
        {dragHandle}
        <button
          type="button"
          onClick={onToggle}
          className="mt-0.5 shrink-0"
        >
          <div className={`size-4 rounded-full border-2 flex items-center justify-center transition-colors ${
            assignment.completed
              ? "bg-primary border-primary text-primary-foreground"
              : "border-muted-foreground/40 hover:border-primary"
          }`}>
            {assignment.completed && (
              <svg className="size-2.5" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M2 6l3 3 5-5" />
              </svg>
            )}
          </div>
        </button>
        {editing ? (
          <input
            ref={inputRef}
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commit();
              } else if (e.key === "Escape") {
                e.preventDefault();
                cancel();
              }
            }}
            className="flex-1 rounded border bg-background px-1.5 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          />
        ) : (
          <button
            type="button"
            onClick={() => !assignment.completed && setEditing(true)}
            className={`flex-1 text-left cursor-text ${
              assignment.completed ? "line-through text-muted-foreground" : ""
            }`}
          >
            <AssignmentTextWithMetronome text={assignment.text} />
          </button>
        )}
        {editingMetronome ? (
          <input
            ref={metronomeRef}
            type="text"
            inputMode="numeric"
            value={metronomeText}
            onChange={(e) => setMetronomeText(e.target.value)}
            onBlur={commitMetronome}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitMetronome();
              } else if (e.key === "Escape") {
                e.preventDefault();
                cancelMetronome();
              }
            }}
            className="w-12 shrink-0 rounded border bg-background px-1 py-0 text-xs text-center tabular-nums focus:outline-none focus:ring-1 focus:ring-ring mt-0.5"
          />
        ) : (
          <button
            type="button"
            onClick={handleMetronomePillClick}
            onContextMenu={handleMetronomeRightClick}
            onDoubleClick={(e) => {
              e.preventDefault();
              setEditingMetronome(true);
            }}
            className={cn(
              "inline-flex shrink-0 items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] tabular-nums transition-colors mt-0.5",
              optimisticMetronomeSpeed
                ? isMetronomeActiveForThisRow
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted-foreground/20"
                : "text-muted-foreground/40 opacity-0 group-hover:opacity-100 hover:text-muted-foreground"
            )}
            title={
              optimisticMetronomeSpeed
                ? "Click to start/stop; right-click to edit"
                : "Right-click or double-click to set tempo"
            }
          >
            <MetronomeIcon className="size-3" />
            {optimisticMetronomeSpeed ?? "—"}
          </button>
        )}
        {onDelete && (
          <button
            type="button"
            onClick={onDelete}
            className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity shrink-0 mt-0.5"
            title="Delete assignment"
          >
            <Trash2Icon className="size-3" />
          </button>
        )}
      </div>
      {showCompletedDate && assignment.completed_at && (
        <p className="ml-6 mt-0.5 text-[10px] text-muted-foreground/70">
          Completed {formatDate(assignment.completed_at.slice(0, 10))}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Practice Overview (sidebar when no piece is focused)
// ---------------------------------------------------------------------------

// Module-level cache so reopening the overview shows last-seen data instantly
const overviewCache: {
  assignments: AssignmentWithPiece[] | null;
  summary: TimeSummaryEntry[] | null;
  lastPracticed: Record<string, string> | null;
} = { assignments: null, summary: null, lastPracticed: null };

type AssignmentGroup = {
  key: string;
  label: string;
  subtitle: string | null;
  kind: PieceKind;
  /** In the keep-it-warm rotation — listed even with no open assignments. */
  maintenance: boolean;
  /** Whole days since real practice, or null for never. */
  daysSince: number | null;
  assignments: AssignmentWithPiece[];
};

function PracticeOverview({
  isRunning,
  onFocusItem,
  activePieces,
}: {
  isRunning: boolean;
  onFocusItem: (focusKey: string) => void;
  activePieces: Piece[];
}) {
  const [summary, setSummary] = useState<TimeSummaryEntry[]>(
    () => overviewCache.summary ?? []
  );
  const [allAssignments, setAllAssignments] = useState<AssignmentWithPiece[]>(
    () => overviewCache.assignments ?? []
  );
  const [lastPracticed, setLastPracticed] = useState<Record<string, string>>(
    () => overviewCache.lastPracticed ?? {}
  );
  const [loaded, setLoaded] = useState(
    () => overviewCache.assignments !== null && overviewCache.summary !== null
  );
  const [pendingPieceId, setPendingPieceId] = useState<string | null>(null);

  const refreshData = useCallback(() => {
    // The client's own date, not a server-derived today: the timezone cookie
    // can still be missing on a fresh session.
    Promise.all([
      getTodaySummary(),
      getAllOpenAssignments(),
      getLastPracticedByPiece(localDate()),
    ]).then(([summaryData, assignmentsData, lastPracticedData]) => {
      overviewCache.summary = summaryData;
      overviewCache.assignments = assignmentsData;
      overviewCache.lastPracticed = lastPracticedData;
      setSummary(summaryData);
      setAllAssignments(assignmentsData);
      setLastPracticed(lastPracticedData);
      setLoaded(true);
    });
  }, []);

  useEffect(() => {
    refreshData();
  }, [isRunning, refreshData]);

  useEffect(() => {
    const handler = () => refreshData();
    window.addEventListener("assignments-changed", handler);
    return () => window.removeEventListener("assignments-changed", handler);
  }, [refreshData]);

  // Archiving a task by its checkbox changes how long it has been since that
  // piece was practiced, but runs no timer — so nothing else here would notice.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const handler = (e: Event) => {
      const { updates } = (e as CustomEvent<{ updates?: { completed?: boolean } }>)
        .detail;
      if (updates?.completed === undefined) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => refreshData(), 500);
    };
    window.addEventListener("task-updated-optimistic", handler);
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener("task-updated-optimistic", handler);
    };
  }, [refreshData]);

  const updateAssignments = useCallback(
    (updater: (prev: AssignmentWithPiece[]) => AssignmentWithPiece[]) => {
      setAllAssignments((prev) => {
        const next = updater(prev);
        overviewCache.assignments = next;
        return next;
      });
    },
    []
  );

  const handleToggle = useCallback(
    (assignmentId: string) => {
      updateAssignments((prev) => prev.filter((t) => t.id !== assignmentId));
      void toggleAssignmentCompleted(assignmentId, true);
    },
    [updateAssignments]
  );

  const handleDelete = useCallback(
    (assignmentId: string) => {
      updateAssignments((prev) => prev.filter((t) => t.id !== assignmentId));
      void deleteAssignment(assignmentId);
    },
    [updateAssignments]
  );

  const handleEdit = useCallback(
    (assignmentId: string, newText: string) => {
      updateAssignments((prev) =>
        prev.map((t) => (t.id === assignmentId ? { ...t, text: newText } : t))
      );
      void updateAssignmentText(assignmentId, newText);
    },
    [updateAssignments]
  );

  const handleMetronomeChange = useCallback(
    (assignmentId: string, speed: number | null) => {
      updateAssignments((prev) =>
        prev.map((t) =>
          t.id === assignmentId ? { ...t, metronome_speed: speed } : t
        )
      );
      void updateAssignmentMetronome(assignmentId, speed);
    },
    [updateAssignments]
  );

  const handleAddToTasks = useCallback(
    async (assignment: AssignmentWithPiece) => {
      const today = localDate();
      const tempId = emitOptimisticTask({
        pieceId: assignment.piece_id,
        sectionId: null,
        date: today,
        text: assignment.text,
        metronomeSpeed: assignment.metronome_speed,
        pieceName: assignment.piece_name,
        pieceComposer: assignment.piece_composer,
        pieceKind: assignment.kind,
        sectionLabel: null,
        sectionStatus: null,
      });
      try {
        await createTaskFromAssignment(
          assignment.piece_id,
          assignment.text,
          assignment.metronome_speed,
          today
        );
      } catch (err) {
        rollbackOptimisticTask(tempId);
        throw err;
      }
    },
    []
  );

  const handleCreate = useCallback(
    async (piece: {
      id: string;
      name: string;
      composer: string | null;
      kind: PieceKind;
    }, text: string) => {
      const tempId = `temp-${crypto.randomUUID()}`;
      const temp: AssignmentWithPiece = {
        id: tempId,
        piece_id: piece.id,
        text,
        completed: false,
        completed_at: null,
        sort_order: 9999,
        metronome_speed: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        piece_name: piece.name,
        piece_composer: piece.composer,
        kind: piece.kind,
      };
      updateAssignments((prev) => [...prev, temp]);
      try {
        const created = await createAssignment(piece.id, text);
        updateAssignments((prev) =>
          prev.map((t) =>
            t.id === tempId
              ? {
                  ...temp,
                  id: created.id,
                  sort_order: created.sort_order,
                  created_at: created.created_at,
                  updated_at: created.updated_at,
                }
              : t
          )
        );
      } catch {
        updateAssignments((prev) => prev.filter((t) => t.id !== tempId));
      }
    },
    [updateAssignments]
  );

  const handleReorder = useCallback(
    (pieceId: string, orderedIds: string[]) => {
      updateAssignments((prev) => {
        const byId = new Map(prev.map((a) => [a.id, a]));
        const orderIndex = new Map(orderedIds.map((id, i) => [id, i]));
        // Rewrite sort_order for items in this piece so local order matches
        const next: AssignmentWithPiece[] = prev.map((a) => {
          if (a.piece_id !== pieceId) return a;
          const idx = orderIndex.get(a.id);
          return idx === undefined ? a : { ...a, sort_order: idx };
        });
        // Sort by piece grouping isn't needed here; render layer re-groups.
        // But we need to preserve grouping order → sort the in-piece items by new sort_order
        // by replacing them in-place using the ordered list.
        const orderedAssignments = orderedIds
          .map((id) => byId.get(id))
          .filter((a): a is AssignmentWithPiece => !!a)
          .map((a, i) => ({ ...a, sort_order: i }));
        const otherPieces = next.filter((a) => a.piece_id !== pieceId);
        return [...otherPieces, ...orderedAssignments];
      });
      // Skip temp ids — they don't exist server-side yet.
      const realIds = orderedIds.filter((id) => !id.startsWith("temp-"));
      if (realIds.length > 0) {
        void reorderAssignments(realIds);
      }
    },
    [updateAssignments]
  );

  // Build a group per active piece (always present so the dropdown can pick
  // any piece), plus groups for archived/unknown pieces that still have open
  // assignments.
  const allGroups = useMemo<AssignmentGroup[]>(() => {
    const today = localDate();
    const sinceFor = (pieceId: string) => {
      const last = lastPracticed[pieceId];
      return last ? daysBetween(last, today) : null;
    };
    const byPiece = new Map<string, AssignmentGroup>();
    for (const piece of activePieces) {
      byPiece.set(piece.id, {
        key: piece.id,
        label: piece.name,
        subtitle: piece.composer,
        kind: (piece.kind ?? "piece") as PieceKind,
        maintenance: piece.maintenance,
        daysSince: sinceFor(piece.id),
        assignments: [],
      });
    }
    for (const a of allAssignments) {
      const g = byPiece.get(a.piece_id);
      if (g) {
        g.assignments.push(a);
      } else {
        byPiece.set(a.piece_id, {
          key: a.piece_id,
          label: a.piece_name,
          subtitle: a.piece_composer,
          kind: a.kind,
          maintenance: false,
          daysSince: sinceFor(a.piece_id),
          assignments: [a],
        });
      }
    }
    for (const g of byPiece.values()) {
      g.assignments.sort(
        (a, b) =>
          a.sort_order - b.sort_order ||
          (a.created_at > b.created_at ? -1 : 1)
      );
    }
    const kindOrder: Record<string, number> = {
      technique: 0,
      sight_reading: 1,
      piece: 2,
    };
    const pieceOrder = new Map(activePieces.map((p, i) => [p.id, i]));
    return [...byPiece.values()].sort((a, b) => {
      const kindDiff = (kindOrder[a.kind] ?? 2) - (kindOrder[b.kind] ?? 2);
      if (kindDiff !== 0) return kindDiff;
      return (
        (pieceOrder.get(a.key) ?? Infinity) -
        (pieceOrder.get(b.key) ?? Infinity)
      );
    });
  }, [allAssignments, activePieces, lastPracticed]);

  // Only render groups that have assignments, unless they're the pending piece.
  const visibleGroups = useMemo(
    () =>
      allGroups.filter(
        (g) =>
          g.assignments.length > 0 ||
          g.key === pendingPieceId ||
          // The rotation's pieces are the least likely to have an open
          // assignment — they're learned. List them anyway, or the days-since
          // picture would cover everything except what it's for.
          g.maintenance
      ),
    [allGroups, pendingPieceId]
  );

  if (!loaded) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          <p className="text-sm">Loading...</p>
        </CardContent>
      </Card>
    );
  }

  const showAssignmentsCard = visibleGroups.length > 0 || allGroups.length > 0;

  return (
    <div className="space-y-4">
      {showAssignmentsCard && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <CheckCircle2Icon className="size-4" />
              Active Assignments
              {allAssignments.length > 0 && (
                <span className="text-xs font-normal bg-muted text-muted-foreground rounded-full px-1.5 py-0.5">
                  {allAssignments.length}
                </span>
              )}
              {allGroups.length > 0 && (
                <DropdownMenu>
                  <DropdownMenuTrigger
                    className="ml-auto inline-flex items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground size-6 transition-colors"
                    title="Add assignment"
                    aria-label="Add assignment"
                  >
                    <PlusIcon className="size-4" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {allGroups.map((group) => (
                      <DropdownMenuItem
                        key={group.key}
                        onClick={() => setPendingPieceId(group.key)}
                      >
                        <div className="flex flex-col">
                          <span className="text-sm">{group.label}</span>
                          {group.subtitle && (
                            <span className="text-xs text-muted-foreground">
                              {group.subtitle}
                            </span>
                          )}
                        </div>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {visibleGroups.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No active assignments.
              </p>
            )}
            {visibleGroups.map((group) => (
              <AssignmentPieceGroup
                key={group.key}
                group={group}
                isPending={group.key === pendingPieceId}
                onFocus={onFocusItem}
                onToggle={handleToggle}
                onDelete={handleDelete}
                onEdit={handleEdit}
                onMetronomeChange={handleMetronomeChange}
                onAddToTasks={handleAddToTasks}
                onReorder={handleReorder}
                onPendingSubmit={async (text) => {
                  setPendingPieceId(null);
                  await handleCreate(
                    {
                      id: group.key,
                      name: group.label,
                      composer: group.subtitle,
                      kind: group.kind,
                    },
                    text
                  );
                }}
                onPendingCancel={() => setPendingPieceId(null)}
              />
            ))}
          </CardContent>
        </Card>
      )}

      {summary.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Repertoire</CardTitle>
          </CardHeader>
          <CardContent>
            <div>
              <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                Today&apos;s Practice
              </h4>
              <TimeSummary entries={summary} onItemClick={onFocusItem} />
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function AssignmentPieceGroup({
  group,
  isPending,
  onFocus,
  onToggle,
  onDelete,
  onEdit,
  onMetronomeChange,
  onAddToTasks,
  onReorder,
  onPendingSubmit,
  onPendingCancel,
}: {
  group: AssignmentGroup;
  isPending: boolean;
  onFocus: (pieceId: string) => void;
  onToggle: (assignmentId: string) => void;
  onDelete: (assignmentId: string) => void;
  onEdit: (assignmentId: string, newText: string) => void;
  onMetronomeChange: (assignmentId: string, speed: number | null) => void;
  onAddToTasks: (assignment: AssignmentWithPiece) => Promise<void>;
  onReorder: (pieceId: string, orderedIds: string[]) => void;
  onPendingSubmit: (text: string) => Promise<void>;
  onPendingCancel: () => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const ids = group.assignments.map((a) => a.id);
      const activeId = String(active.id);
      const overId = String(over.id);
      const oldIndex = ids.indexOf(activeId);
      const newIndex = ids.indexOf(overId);
      if (oldIndex === -1 || newIndex === -1) return;
      const reordered = [...ids];
      reordered.splice(oldIndex, 1);
      reordered.splice(newIndex, 0, activeId);
      onReorder(group.key, reordered);
    },
    [group.assignments, group.key, onReorder]
  );

  return (
    <div>
      <button
        type="button"
        onClick={() => onFocus(group.key)}
        className="text-xs font-medium text-muted-foreground hover:text-foreground transition-colors mb-1.5 flex w-full items-center gap-1 text-left"
      >
        {group.label}
        {group.subtitle && (
          <span className="font-normal">— {group.subtitle}</span>
        )}
        <span className="ml-auto pl-2 text-[10px] tabular-nums text-muted-foreground/70">
          {daysSinceLabel(group.daysSince)}
        </span>
      </button>
      {isPending && (
        <PendingAssignmentInput
          onSubmit={onPendingSubmit}
          onCancel={onPendingCancel}
        />
      )}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={group.assignments.map((a) => a.id)}
          strategy={verticalListSortingStrategy}
        >
          <div className="space-y-1.5">
            {group.assignments.map((assignment) => (
              <SortableAssignmentRow
                key={assignment.id}
                assignment={assignment}
                onToggle={() => onToggle(assignment.id)}
                onDelete={() => onDelete(assignment.id)}
                onEdit={(text) => onEdit(assignment.id, text)}
                onMetronomeChange={(speed) =>
                  onMetronomeChange(assignment.id, speed)
                }
                onAddToTasks={() => onAddToTasks(assignment)}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}

function PendingAssignmentInput({
  onSubmit,
  onCancel,
}: {
  onSubmit: (text: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = () => {
    const trimmed = text.trim();
    if (!trimmed) {
      onCancel();
      return;
    }
    void onSubmit(trimmed);
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="mb-1.5"
    >
      <input
        ref={inputRef}
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={submit}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
        placeholder="Assignment..."
        className="w-full rounded border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
      />
    </form>
  );
}

function SortableAssignmentRow({
  assignment,
  onToggle,
  onDelete,
  onEdit,
  onMetronomeChange,
  onAddToTasks,
}: {
  assignment: Assignment;
  onToggle: () => void;
  onDelete: () => void;
  onEdit: (newText: string) => void;
  onMetronomeChange: (speed: number | null) => void;
  onAddToTasks: () => Promise<void> | void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: assignment.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
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

  const dragHandle = (
    <>
      <button
        ref={gripButtonRef}
        type="button"
        {...attributes}
        onPointerDown={handleGripPointerDown}
        onPointerUp={handleGripPointerUp}
        className={cn(
          "mt-0.5 flex items-center justify-center w-3 h-5 shrink-0 cursor-grab rounded-sm text-muted-foreground/40 hover:text-foreground hover:bg-muted transition-opacity touch-none",
          menuOpen ? "opacity-100" : "opacity-0 group-hover:opacity-100"
        )}
        aria-label="Drag to reorder or open menu"
      >
        <GripVerticalIcon className="size-3" />
      </button>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuContent
          anchor={gripButtonRef}
          align="start"
          side="bottom"
          className="w-44"
        >
          <DropdownMenuItem
            onClick={() => {
              void onAddToTasks();
            }}
          >
            <ListPlusIcon />
            Add to tasks
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onClick={onDelete}>
            <Trash2Icon />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(isDragging && "opacity-50")}
    >
      <AssignmentRow
        assignment={assignment}
        onToggle={onToggle}
        onEdit={onEdit}
        onMetronomeChange={onMetronomeChange}
        dragHandle={dragHandle}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(dateStr: string): string {
  const date = new Date(dateStr + "T00:00:00");
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}
