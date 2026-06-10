"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
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
  setProjectSortOrder,
} from "@/app/(todos)/todos/actions";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { MemberSwitcher } from "@/components/todos/member-switcher";
import { withAs } from "@/lib/todos/member-context";
import { sortBetween } from "@/lib/todos/sort";
import type {
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

/**
 * Sidebar: fixed views, then the viewed member's projects grouped by area.
 * Membership = decluttering — only projects the viewed member belongs to show
 * here (and only areas containing at least one of those). Areas and projects
 * drag-reorder; the ordering is family-global since they're shared objects.
 */
export function TodosSidebar({
  active,
  activeProjectId = null,
  inboxCount,
  viewedEmail,
  selfEmail,
  members,
  projects,
  areas,
}: {
  active: TodoView | null;
  activeProjectId?: string | null;
  inboxCount: number;
  viewedEmail: string;
  selfEmail: string;
  members: TodoMember[];
  projects: TodoProject[];
  areas: TodoArea[];
}) {
  const href = (path: string) => withAs(path, viewedEmail, selfEmail);

  const myProjects = useMemo(
    () => projects.filter((p) => p.memberEmails.includes(viewedEmail)),
    [projects, viewedEmail]
  );

  return (
    <>
      {/* Desktop rail */}
      <nav className="hidden w-52 shrink-0 md:block">
        <div className="sticky top-20">
          <ul className="space-y-0.5">
            {VIEW_ITEMS.map((item) => (
              <li key={item.view}>
                <SidebarLink
                  icon={item.icon}
                  iconClass={item.iconClass}
                  label={item.label}
                  active={active === item.view}
                  badge={item.view === "inbox" ? inboxCount : 0}
                  href={href(`/todos/${item.view}`)}
                  hint={`${item.label} (${item.chord})`}
                />
              </li>
            ))}
          </ul>

          <ProjectsSection
            projects={myProjects}
            areas={areas}
            activeProjectId={activeProjectId}
            href={href}
          />

          <NewProjectButton hrefFor={href} />

          {/* Footer: occasional destinations, kept quiet. "Family" swaps the
              whole app to another member's perspective. */}
          <div className="mt-1">
            <MemberSwitcher
              members={members}
              viewedEmail={viewedEmail}
              selfEmail={selfEmail}
              variant="sidebar"
            />
            <Link
              href="/todos/settings"
              className="flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm text-muted-foreground/70 hover:bg-accent/40 hover:text-foreground"
            >
              <KeyRound className="size-4" />
              Integrations
            </Link>
          </div>
        </div>
      </nav>

      {/* Mobile pills */}
      <nav className="-mx-4 mb-4 overflow-x-auto px-4 md:hidden">
        <div className="flex w-max items-center gap-1.5">
          {VIEW_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = active === item.view;
            return (
              <Link
                key={item.view}
                href={href(`/todos/${item.view}`)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm whitespace-nowrap",
                  isActive
                    ? "border-primary/30 bg-primary/10 text-foreground"
                    : "border-border bg-card text-muted-foreground"
                )}
              >
                <Icon className={cn("size-3.5", item.iconClass)} />
                {item.label}
                {item.view === "inbox" && inboxCount > 0 && (
                  <span className="rounded-full bg-primary/15 px-1.5 text-xs tabular-nums text-primary">
                    {inboxCount}
                  </span>
                )}
              </Link>
            );
          })}
          {myProjects.map((project) => (
            <Link
              key={project.id}
              href={href(`/todos/project/${project.id}`)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm whitespace-nowrap",
                activeProjectId === project.id
                  ? "border-primary/30 bg-primary/10 text-foreground"
                  : "border-border bg-card text-muted-foreground"
              )}
            >
              <CircleDashed className="size-3.5 text-primary/70" />
              {project.name}
            </Link>
          ))}
          <MemberSwitcher
            members={members}
            viewedEmail={viewedEmail}
            selfEmail={selfEmail}
            variant="mobile"
          />
        </div>
      </nav>
    </>
  );
}

function SidebarLink({
  icon: Icon,
  iconClass,
  label,
  active,
  badge,
  href,
  hint,
}: {
  icon: LucideIcon;
  iconClass: string;
  label: string;
  active: boolean;
  badge: number;
  href: string;
  hint?: string;
}) {
  return (
    <Link
      href={href}
      title={hint}
      className={cn(
        "flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm transition-colors",
        active
          ? "bg-accent/70 font-medium text-foreground"
          : "text-muted-foreground hover:bg-accent/40 hover:text-foreground"
      )}
    >
      <Icon className={cn("size-4 shrink-0", iconClass)} />
      <span className="flex-1 truncate">{label}</span>
      {badge > 0 && (
        <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-xs tabular-nums text-primary">
          {badge}
        </span>
      )}
    </Link>
  );
}

/**
 * The member's projects: loose ones first, then one group per area (areas with
 * none of their projects are hidden). Projects drag within their group; areas
 * drag among themselves.
 */
function ProjectsSection({
  projects,
  areas,
  activeProjectId,
  href,
}: {
  projects: TodoProject[];
  areas: TodoArea[];
  activeProjectId: string | null;
  href: (path: string) => string;
}) {
  // Local copies for optimistic drag reorder; props win after refresh.
  const [orderedProjects, setOrderedProjects] = useState(projects);
  const [orderedAreas, setOrderedAreas] = useState(areas);
  useEffect(() => setOrderedProjects(projects), [projects]);
  useEffect(() => setOrderedAreas(areas), [areas]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const looseProjects = orderedProjects.filter((p) => !p.areaId);
  const visibleAreas = orderedAreas.filter((area) =>
    orderedProjects.some((p) => p.areaId === area.id)
  );

  if (orderedProjects.length === 0) return null;

  const handleProjectDragEnd = (event: DragEndEvent, group: TodoProject[]) => {
    const { active: dragged, over } = event;
    if (!over || dragged.id === over.id) return;
    const oldIndex = group.findIndex((p) => p.id === dragged.id);
    const newIndex = group.findIndex((p) => p.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const next = arrayMove(group, oldIndex, newIndex);
    const moved = next[newIndex];
    const sortOrder = sortBetween(
      next[newIndex - 1]?.sortOrder ?? null,
      next[newIndex + 1]?.sortOrder ?? null
    );
    setOrderedProjects((prev) =>
      prev
        .map((p) => (p.id === moved.id ? { ...p, sortOrder } : p))
        .sort((a, b) => a.sortOrder - b.sortOrder)
    );
    void setProjectSortOrder(moved.id, sortOrder);
  };

  const handleAreaDragEnd = (event: DragEndEvent) => {
    const { active: dragged, over } = event;
    if (!over || dragged.id === over.id) return;
    const oldIndex = visibleAreas.findIndex((a) => a.id === dragged.id);
    const newIndex = visibleAreas.findIndex((a) => a.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const next = arrayMove(visibleAreas, oldIndex, newIndex);
    const moved = next[newIndex];
    const sortOrder = sortBetween(
      next[newIndex - 1]?.sortOrder ?? null,
      next[newIndex + 1]?.sortOrder ?? null
    );
    setOrderedAreas((prev) =>
      prev
        .map((a) => (a.id === moved.id ? { ...a, sortOrder } : a))
        .sort((a, b) => a.sortOrder - b.sortOrder)
    );
    void setAreaSortOrder(moved.id, sortOrder);
  };

  const projectList = (groupKey: string, group: TodoProject[]) => (
    <DndContext
      id={`todos-sidebar-${groupKey}`}
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={(e) => handleProjectDragEnd(e, group)}
    >
      <SortableContext
        items={group.map((p) => p.id)}
        strategy={verticalListSortingStrategy}
      >
        <div className="space-y-0.5">
          {group.map((project) => (
            <SortableRow key={project.id} id={project.id}>
              <SidebarLink
                icon={CircleDashed}
                iconClass="text-primary/70"
                label={project.name}
                active={activeProjectId === project.id}
                badge={0}
                href={href(`/todos/project/${project.id}`)}
              />
            </SortableRow>
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );

  return (
    <div className="mt-5 space-y-4">
      {looseProjects.length > 0 && projectList("loose", looseProjects)}

      <DndContext
        id="todos-sidebar-areas"
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleAreaDragEnd}
      >
        <SortableContext
          items={visibleAreas.map((a) => a.id)}
          strategy={verticalListSortingStrategy}
        >
          <div className="space-y-4">
            {visibleAreas.map((area) => (
              <SortableRow key={area.id} id={area.id}>
                <div>
                  <h3 className="px-2.5 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {area.name}
                  </h3>
                  {projectList(
                    area.id,
                    orderedProjects.filter((p) => p.areaId === area.id)
                  )}
                </div>
              </SortableRow>
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}

function SortableRow({ id, children }: { id: string; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(isDragging && "z-10 opacity-70")}
      {...attributes}
      {...listeners}
    >
      {children}
    </div>
  );
}

function NewProjectButton({ hrefFor }: { hrefFor: (path: string) => string }) {
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
      router.push(hrefFor(`/todos/project/${id}`));
      router.refresh();
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
            className="mt-4 flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm text-muted-foreground hover:bg-accent/40 hover:text-foreground"
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
