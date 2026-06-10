"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link, { useLinkStatus } from "next/link";
import { useRouter } from "next/navigation";
import {
  DndContext,
  MeasuringStrategy,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { LucideIcon } from "lucide-react";
import {
  Archive,
  BookCheck,
  CircleDashed,
  Inbox,
  KeyRound,
  Layers,
  Moon,
  Plus,
  Send,
  Star,
} from "lucide-react";
import {
  createProject,
  setAreaSortOrder,
  setProjectArea,
  setProjectSortOrder,
} from "@/app/(todos)/todos/actions";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { MemberSwitcher } from "@/components/todos/member-switcher";
import { onChordHints } from "@/lib/todos/chord-hints";
import {
  DROP_TARGET_ATTR,
  onDropTarget,
  projectDropKey,
  viewDropKey,
} from "@/lib/todos/drop-targets";
import { withAs } from "@/lib/todos/member-context";
import { useReconciler } from "@/lib/todos/reconcile";
import { sortBetween } from "@/lib/todos/sort";
import { requestViewSwitch } from "@/lib/todos/view-switch";
import type {
  SidebarCounts,
  TodoArea,
  TodoMember,
  TodoProject,
  TodoView,
} from "@/lib/todos/types";
import { cn } from "@/lib/utils";

type ViewItem = {
  view: TodoView;
  label: string;
  icon: LucideIcon;
  iconClass: string;
  /** The `g` navigation chord (see todos-shortcuts.tsx), shown as a tooltip. */
  chord: string;
};

// The fixed views; the member's projects (grouped by area) list below.
const VIEW_ITEMS: ViewItem[] = [
  { view: "inbox", label: "Inbox", icon: Inbox, iconClass: "text-sky-700", chord: "g i" },
  { view: "today", label: "Today", icon: Star, iconClass: "text-amber-500", chord: "g t" },
  { view: "anytime", label: "Anytime", icon: Layers, iconClass: "text-teal-700", chord: "g a" },
  { view: "someday", label: "Someday", icon: Archive, iconClass: "text-stone-500", chord: "g s" },
  { view: "snoozed", label: "Snoozed", icon: Moon, iconClass: "text-indigo-500", chord: "g z" },
  { view: "delegated", label: "Delegated", icon: Send, iconClass: "text-rose-700", chord: "g d" },
  { view: "logbook", label: "Logbook", icon: BookCheck, iconClass: "text-emerald-700", chord: "g l" },
];

type SidebarSize = "sm" | "lg";

/**
 * Sidebar: fixed views, then the viewed member's projects grouped by area.
 * Membership = decluttering — only projects the viewed member belongs to show
 * here (and only areas containing at least one of those). Areas and projects
 * drag-reorder; the ordering is family-global since they're shared objects.
 *
 * Two variants, like Things: "rail" is the desktop column beside the list
 * (hidden on phones); "page" renders the same content as a full-screen lists
 * page (/todos/browse) with touch-sized rows — on phones each view is its own
 * screen and a back chevron returns here.
 */
export function TodosSidebar({
  active,
  activeProjectId = null,
  counts,
  viewedEmail,
  selfEmail,
  members,
  projects,
  areas,
  variant = "rail",
}: {
  active: TodoView | null;
  activeProjectId?: string | null;
  counts: SidebarCounts;
  viewedEmail: string;
  selfEmail: string;
  members: TodoMember[];
  projects: TodoProject[];
  areas: TodoArea[];
  variant?: "rail" | "page";
}) {
  const href = (path: string) => withAs(path, viewedEmail, selfEmail);
  const size: SidebarSize = variant === "page" ? "lg" : "sm";

  const myProjects = useMemo(
    () => projects.filter((p) => p.memberEmails.includes(viewedEmail)),
    [projects, viewedEmail]
  );

  // The task list broadcasts which sidebar item a live task drag is over
  // (null when it isn't over a valid target); that item lights up.
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  useEffect(() => onDropTarget(setDropTarget), []);

  // Holding `g` for a beat decorates each view with its chord's follow-up
  // key (see chord-hints.ts) — a reminder for half-learned shortcuts.
  const [chordHints, setChordHints] = useState(false);
  useEffect(() => onChordHints(setChordHints), []);

  const content = (
    <>
      <ul className={size === "lg" ? "space-y-1" : "space-y-0.5"}>
        {VIEW_ITEMS.map((item) => (
          <li key={item.view}>
            <SidebarLink
              icon={item.icon}
              iconClass={item.iconClass}
              label={item.label}
              active={active === item.view}
              badge={counts[item.view] ?? 0}
              href={href(`/todos/${item.view}`)}
              view={item.view}
              hint={`${item.label} (${item.chord})`}
              chordHint={chordHints ? item.chord.split(" ")[1] : null}
              dropKey={viewDropKey(item.view)}
              dropActive={dropTarget === viewDropKey(item.view)}
              size={size}
            />
          </li>
        ))}
      </ul>

      <ProjectsSection
        projects={myProjects}
        areas={areas}
        activeProjectId={activeProjectId}
        dropTarget={dropTarget}
        href={href}
        size={size}
      />

      <NewProjectButton hrefFor={href} size={size} />

      {/* Footer: occasional destinations, kept quiet. "Family" swaps the
          whole app to another member's perspective. */}
      <div className={size === "lg" ? "mt-4 border-t border-border pt-2" : "mt-1"}>
        <MemberSwitcher
          members={members}
          viewedEmail={viewedEmail}
          selfEmail={selfEmail}
        />
        <Link
          href="/todos/settings"
          className="flex cursor-default items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm text-muted-foreground/70 hover:bg-accent/40 hover:text-foreground"
        >
          <KeyRound className="size-4" />
          Integrations
        </Link>
      </div>
    </>
  );

  if (variant === "page") {
    return <nav className="w-full">{content}</nav>;
  }

  return (
    <nav className="hidden w-52 shrink-0 md:block">
      <div className="sticky top-20">{content}</div>
    </nav>
  );
}

/**
 * Instant feedback for view switching. Sibling navigations (today → anytime)
 * are param-only, so the (todos) loading boundary never re-shows — the old
 * view rightly stays put while the server answers. Without this, a click on
 * a slow connection reads as dead; the in-flight item lights up immediately
 * instead. Rendered inside a <Link> (useLinkStatus's contract).
 */
function LinkPendingHighlight({ rounded = "rounded-lg" }: { rounded?: string }) {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return (
    <span
      className={cn(
        "pointer-events-none absolute inset-0 animate-pulse bg-accent/70",
        rounded
      )}
    />
  );
}

function SidebarLink({
  icon: Icon,
  iconClass,
  label,
  active,
  badge,
  href,
  view,
  hint,
  chordHint,
  dropKey,
  dropActive = false,
  size = "sm",
}: {
  icon: LucideIcon;
  iconClass: string;
  label: string;
  active: boolean;
  badge: number;
  href: string;
  /** A fixed view's link switches instantly when the views shell is mounted. */
  view?: TodoView;
  hint?: string;
  /** While `g` is held: the chord's follow-up key, shown in place of the badge. */
  chordHint?: string | null;
  /** Marks this item as a task-drag drop target (see drop-targets.ts). */
  dropKey?: string;
  dropActive?: boolean;
  /** "lg" = touch-sized rows for the full-screen lists page. */
  size?: SidebarSize;
}) {
  return (
    <Link
      href={href}
      title={hint}
      onClick={(e) => {
        // Plain left-clicks switch views client-side when the shell is up
        // (todos-views.tsx) — instant. Modified clicks (new tab) and pages
        // without the shell (projects, browse) keep the real navigation.
        if (!view || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        if (requestViewSwitch(view)) e.preventDefault();
      }}
      // Anchors are natively draggable; a native drag's dragstart makes
      // dnd-kit cancel the row's sort, so rows would never reorder.
      draggable={false}
      {...(dropKey ? { [DROP_TARGET_ATTR]: dropKey } : {})}
      className={cn(
        // Like Things: sidebar rows keep the normal arrow cursor.
        "relative flex cursor-default items-center transition-colors",
        size === "lg"
          ? "gap-3 rounded-xl px-3 py-2.5 text-[15px] font-medium"
          : "gap-2.5 rounded-lg px-2.5 py-1.5 text-sm",
        active
          ? "bg-accent/70 font-medium text-foreground"
          : size === "lg"
            ? "text-foreground active:bg-accent/50"
            : "text-muted-foreground hover:bg-accent/40 hover:text-foreground",
        // A live task drag hovering this item.
        dropActive && "bg-primary/15 text-foreground ring-1 ring-primary/40 ring-inset"
      )}
    >
      <LinkPendingHighlight rounded={size === "lg" ? "rounded-xl" : "rounded-lg"} />
      <Icon
        className={cn(
          "relative shrink-0",
          size === "lg" ? "size-5" : "size-4",
          iconClass
        )}
      />
      <span className="relative flex-1 truncate">{label}</span>
      {chordHint ? (
        <kbd className="relative rounded border border-border bg-muted px-1.5 py-0.5 font-sans text-xs leading-none text-muted-foreground animate-in fade-in-0 duration-150">
          {chordHint}
        </kbd>
      ) : (
        badge > 0 && (
          <span className="relative rounded-full bg-primary/15 px-1.5 py-0.5 text-xs tabular-nums text-primary">
            {badge}
          </span>
        )
      )}
    </Link>
  );
}

/**
 * The member's projects: loose ones first, then one group per area (areas with
 * none of their projects are hidden). One DndContext covers everything so a
 * project drags within its group, between areas, and in/out of the loose
 * group (dropping on an area's header files it there); areas drag among
 * themselves by their headers.
 */
function ProjectsSection({
  projects,
  areas,
  activeProjectId,
  dropTarget,
  href,
  size = "sm",
}: {
  projects: TodoProject[];
  areas: TodoArea[];
  activeProjectId: string | null;
  dropTarget: string | null;
  href: (path: string) => string;
  size?: SidebarSize;
}) {
  // Local copies for optimistic drag reorder; server snapshots win once no
  // reorder is in flight (a snapshot raced by a drag would snap items back).
  const { run, idle } = useReconciler();
  const [orderedProjects, setOrderedProjects] = useState(projects);
  const [orderedAreas, setOrderedAreas] = useState(areas);
  useEffect(() => {
    if (idle()) setOrderedProjects(projects);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects]);
  useEffect(() => {
    if (idle()) setOrderedAreas(areas);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [areas]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const looseProjects = orderedProjects.filter((p) => !p.areaId);
  const visibleAreas = orderedAreas.filter((area) =>
    orderedProjects.some((p) => p.areaId === area.id)
  );

  if (orderedProjects.length === 0) return null;

  const groupOf = (areaId: string | null) =>
    orderedProjects.filter((p) => (p.areaId ?? null) === areaId);

  /** The area a droppable belongs to: the area itself, or a project's home. */
  const areaIdOf = (id: string, type: string | undefined): string | null =>
    type === "area"
      ? id
      : (orderedProjects.find((p) => p.id === id)?.areaId ?? null);

  // While a project drag hovers another group, reparent it locally so that
  // group opens up and the sort transforms track the right neighbors. The
  // server isn't told until the drop; Escape rewinds to the server snapshot.
  const handleDragOver = ({ active, over }: DragOverEvent) => {
    if (active.data.current?.type !== "project" || !over) return;
    const dragged = orderedProjects.find((p) => p.id === active.id);
    if (!dragged) return;
    const overType = over.data.current?.type as string | undefined;
    if (overType !== "project" && overType !== "area") return;
    const targetAreaId = areaIdOf(String(over.id), overType);
    if ((dragged.areaId ?? null) === targetAreaId) return;
    setOrderedProjects((prev) =>
      prev.map((p) =>
        p.id === active.id ? { ...p, areaId: targetAreaId } : p
      )
    );
  };

  const handleDragCancel = () => {
    setOrderedProjects(projects);
    setOrderedAreas(areas);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active: dragged, over } = event;
    if (!over) {
      handleDragCancel();
      return;
    }
    if (dragged.data.current?.type === "area") {
      // Reorder areas; a drop on a project counts as its area.
      const overAreaId = areaIdOf(String(over.id), over.data.current?.type as string | undefined);
      if (!overAreaId || overAreaId === dragged.id) return;
      const oldIndex = visibleAreas.findIndex((a) => a.id === dragged.id);
      const newIndex = visibleAreas.findIndex((a) => a.id === overAreaId);
      if (oldIndex < 0 || newIndex < 0) return;
      const next = arrayMove(visibleAreas, oldIndex, newIndex);
      const sortOrder = sortBetween(
        next[newIndex - 1]?.sortOrder ?? null,
        next[newIndex + 1]?.sortOrder ?? null
      );
      setOrderedAreas((prev) =>
        prev
          .map((a) => (a.id === dragged.id ? { ...a, sortOrder } : a))
          .sort((a, b) => a.sortOrder - b.sortOrder)
      );
      void run(setAreaSortOrder(String(dragged.id), sortOrder));
      return;
    }

    // Project drop: it already sits in its final group (handleDragOver moved
    // it); place it at the slot `over` marks and persist group + position.
    const project = orderedProjects.find((p) => p.id === dragged.id);
    if (!project) return;
    const targetAreaId = project.areaId ?? null;
    const group = groupOf(targetAreaId);
    const oldIndex = group.findIndex((p) => p.id === dragged.id);
    let newIndex = group.findIndex((p) => p.id === over.id);
    if (newIndex < 0) newIndex = oldIndex; // dropped on the area header / itself
    const next = arrayMove(group, oldIndex, newIndex);
    const sortOrder = sortBetween(
      next[newIndex - 1]?.sortOrder ?? null,
      next[newIndex + 1]?.sortOrder ?? null
    );
    const serverAreaId =
      projects.find((p) => p.id === dragged.id)?.areaId ?? null;
    const areaChanged = serverAreaId !== targetAreaId;
    if (!areaChanged && dragged.id === over.id) return;
    setOrderedProjects((prev) =>
      prev
        .map((p) => (p.id === dragged.id ? { ...p, sortOrder } : p))
        .sort((a, b) => a.sortOrder - b.sortOrder)
    );
    void run(
      (async () => {
        if (areaChanged) await setProjectArea(String(dragged.id), targetAreaId);
        await setProjectSortOrder(String(dragged.id), sortOrder);
      })()
    );
  };

  const projectList = (group: TodoProject[]) => (
    <SortableContext
      items={group.map((p) => p.id)}
      strategy={verticalListSortingStrategy}
    >
      <div className={size === "lg" ? "space-y-1" : "space-y-0.5"}>
        {group.map((project) => (
          <SortableRow key={project.id} id={project.id} type="project">
            <SidebarLink
              icon={CircleDashed}
              iconClass="text-primary/70"
              label={project.name}
              active={activeProjectId === project.id}
              badge={0}
              href={href(`/todos/project/${project.id}`)}
              dropKey={projectDropKey(project.id)}
              dropActive={dropTarget === projectDropKey(project.id)}
              size={size}
            />
          </SortableRow>
        ))}
      </div>
    </SortableContext>
  );

  return (
    <DndContext
      id="todos-sidebar-lists"
      sensors={sensors}
      collisionDetection={closestCenter}
      measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div className="mt-5 space-y-4">
        {looseProjects.length > 0 && projectList(looseProjects)}

        <SortableContext
          items={visibleAreas.map((a) => a.id)}
          strategy={verticalListSortingStrategy}
        >
          <div className="space-y-4">
            {visibleAreas.map((area) => (
              <SortableRow key={area.id} id={area.id} type="area">
                <div>
                  <h3
                    className={cn(
                      "pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground",
                      size === "lg" ? "px-3" : "px-2.5"
                    )}
                  >
                    {area.name}
                  </h3>
                  {projectList(groupOf(area.id))}
                </div>
              </SortableRow>
            ))}
          </div>
        </SortableContext>
      </div>
    </DndContext>
  );
}

function SortableRow({
  id,
  type,
  children,
}: {
  id: string;
  /** Tags the draggable so the shared-context handlers can tell rows apart. */
  type: "project" | "area";
  children: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id, data: { type } });

  // A drop lands on the row's <Link>, and the browser follows the click that
  // trails the pointerup — suppress the first click right after a drag.
  const wasDragging = useRef(false);
  useEffect(() => {
    if (isDragging) {
      wasDragging.current = true;
      return;
    }
    const timer = setTimeout(() => {
      wasDragging.current = false;
    }, 150);
    return () => clearTimeout(timer);
  }, [isDragging]);

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(isDragging && "z-10 opacity-70")}
      {...attributes}
      {...listeners}
      onPointerDown={(e) => {
        // Project rows nest inside their area's row; without this both
        // sortables arm on the same pointerdown and fight over the drag.
        e.stopPropagation();
        listeners?.onPointerDown?.(e);
      }}
      onClickCapture={(e) => {
        if (wasDragging.current) {
          e.preventDefault();
          e.stopPropagation();
          wasDragging.current = false;
        }
      }}
    >
      {children}
    </div>
  );
}

function NewProjectButton({
  hrefFor,
  size = "sm",
}: {
  hrefFor: (path: string) => string;
  size?: SidebarSize;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed || creating) return;
    setCreating(true);
    try {
      const { id } = await createProject(trimmed);
      setOpen(false);
      setName("");
      // No refresh() here: a refresh racing a just-issued push cancels the
      // navigation (the new project page is force-dynamic, so the push alone
      // carries fresh data — sidebar included).
      router.push(hrefFor(`/todos/project/${id}`));
    } finally {
      setCreating(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            className={cn(
              "mt-4 flex w-full cursor-default items-center text-muted-foreground hover:bg-accent/40 hover:text-foreground",
              size === "lg"
                ? "gap-3 rounded-xl px-3 py-2.5 text-[15px]"
                : "gap-2.5 rounded-lg px-2.5 py-1.5 text-sm"
            )}
          />
        }
      >
        <Plus className="size-4" />
        New project
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-2">
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit();
          }}
          placeholder="Project name"
          className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-none focus:border-primary/40"
        />
        <button
          type="button"
          onClick={() => void submit()}
          disabled={creating || !name.trim()}
          className="mt-2 w-full rounded-md bg-primary px-2 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          Create project
        </button>
      </PopoverContent>
    </Popover>
  );
}
