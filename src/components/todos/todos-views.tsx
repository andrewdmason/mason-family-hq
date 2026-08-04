"use client";

import { useEffect, useMemo, useRef } from "react";
import { usePathname } from "next/navigation";
import { Crosshair } from "lucide-react";
import { acknowledgeInbox } from "@/app/(todos)/todos/actions";
import { BackToLists } from "@/components/todos/back-to-lists";
import { FocusMode } from "@/components/todos/focus-mode";
import { InlineNewButton } from "@/components/todos/inline-new-button";
import { LogbookList } from "@/components/todos/logbook-list";
import { ProjectHeader } from "@/components/todos/project-header";
import { ProjectLogged } from "@/components/todos/project-logged";
import { QuickAddButton } from "@/components/todos/quick-add";
import { TaskList } from "@/components/todos/task-list";
import { TodosSidebar } from "@/components/todos/todos-sidebar";
import { ViewingBanner } from "@/components/todos/viewing-banner";
import {
  deriveProjectTasks,
  deriveViewTasks,
  localSnoozeSweep,
} from "@/lib/todos/derive";
import { withAs } from "@/lib/todos/member-context";
import type { LogbookProject, TodoTaskAttachment } from "@/lib/todos/queries";
import { useReconciler } from "@/lib/todos/reconcile";
import { useShellData } from "@/lib/todos/shell-refresh";
import {
  isTodoView,
  viewLabel,
  type SidebarCounts,
  type TodoArea,
  type TodoMember,
  type TodoProject,
  type TodoSection,
  type TodoTask,
  type TodoView,
} from "@/lib/todos/types";
import {
  registerViewSwitcher,
  requestFocusSwitch,
} from "@/lib/todos/view-switch";

/**
 * The client shell for the sidebar views *and* projects. The server page hands
 * over the *whole* household active task set (plus the logbook page) in one
 * render, and this component derives whichever destination the URL names — a
 * sidebar view (/todos/[view]) or a project (/todos/project/[id]) — so
 * switching either way is a pushState + an in-memory filter, instant, no server
 * roundtrip. Sidebar clicks and `g` chords route here through view-switch.ts;
 * deep links, the back button, and reloads all still resolve through their
 * server route (which renders this same shell).
 *
 * Freshness rides the existing reconcile loop: every mutation's drained refresh
 * re-reads the same payload into this mounted shell (see shell-refresh.ts), and
 * the new snapshot updates every view's and project's derivation at once. It
 * deliberately does NOT go through router.refresh(): the pushState above means
 * the URL names a route Next's router has no tree for, so a route refresh would
 * be handled as a navigation and remount this shell mid-edit.
 */
export function TodosViews(props: {
  initialView: TodoView;
  activeTasks: TodoTask[];
  logbookTasks: TodoTask[];
  logbookProjects: LogbookProject[];
  attachmentsByTask: Record<string, TodoTaskAttachment[]>;
  members: TodoMember[];
  projects: TodoProject[];
  sections: TodoSection[];
  areas: TodoArea[];
  viewed: TodoMember;
  selfEmail: string;
}) {
  // The server render to begin with, then whatever the reconciler last re-read
  // (see shell-refresh.ts) — this shell must never be remounted to get fresh
  // data, or it takes the open editor and your keystrokes down with it.
  const {
    initialView,
    activeTasks,
    logbookTasks,
    logbookProjects,
    attachmentsByTask,
    members,
    projects,
    sections,
    areas,
    viewed,
    selfEmail,
  } = useShellData(props);
  const pathname = usePathname();
  const { run } = useReconciler();

  // The URL names the destination (pushState keeps usePathname in sync, and so
  // do back/forward); the server params are only the SSR starting point.
  // /todos/[view] → a sidebar view; /todos/project/[id] → a project.
  const parts = pathname.split("/");
  const segment = parts[2] ?? "";
  const projectId = segment === "project" ? (parts[3] ?? null) : null;
  // A stale/unknown id (e.g. a project deleted in another tab) falls back to
  // the entry view rather than a blank screen; the server route is the one that
  // notFound()s on a hard navigation.
  const project = projectId
    ? (projects.find((p) => p.id === projectId) ?? null)
    : null;
  const inProject = project != null;
  // Focus mode is a destination like a project is — not a sidebar view, so it
  // deliberately stays out of TodoView (no sidebar row, no `g` chord).
  const inFocus = segment === "focus";
  const view: TodoView = isTodoView(segment) ? segment : initialView;

  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;

  useEffect(
    () =>
      registerViewSwitcher((path) => {
        if (path === pathnameRef.current) return;
        window.history.pushState(
          null,
          "",
          withAs(path, viewed.email, selfEmail)
        );
        // A switch is a new screen, like the full navigation it replaces.
        window.scrollTo(0, 0);
      }),
    [viewed.email, selfEmail]
  );

  // Opening your own Inbox acknowledges tasks-from-others (clears the bell).
  // The server page covers the initial load; instant switches go through the
  // action, and the reconciler's refresh carries the new bell state.
  const mounted = useRef(false);
  useEffect(() => {
    const isFirstRender = !mounted.current;
    mounted.current = true;
    // `view` still holds the entry view on the focus path (the URL names no
    // view there), so focus needs its own guard or it would acknowledge an
    // Inbox you never opened.
    if (
      isFirstRender ||
      inProject ||
      inFocus ||
      view !== "inbox" ||
      viewed.email !== selfEmail
    )
      return;
    void run(acknowledgeInbox());
  }, [inProject, inFocus, view, viewed.email, selfEmail, run]);

  // Re-sweep on every switch (not just new snapshots) so a tab left open
  // overnight still shows elapsed snoozes in Today, like a fresh load would.
  const swept = useMemo(
    () => localSnoozeSweep(activeTasks, new Date().toISOString()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeTasks, view]
  );
  const viewTasks = useMemo(
    () => (view === "logbook" ? [] : deriveViewTasks(swept, view, viewed.email)),
    [swept, view, viewed.email]
  );

  // Focus mode always walks Today, whichever view you pressed `f` from — the
  // URL names no view on that path, so `view` can't be trusted here.
  const focusTasks = useMemo(
    () => (inFocus ? deriveViewTasks(swept, "today", viewed.email) : []),
    [swept, inFocus, viewed.email]
  );

  // A project shows every assignee's tasks (hence the household-wide set), in
  // manual order — derived in memory, no server fetch.
  const projectTasks = useMemo(
    () => (project ? deriveProjectTasks(swept, project.id) : []),
    [swept, project]
  );

  // ProjectHeader inputs, all derived from the in-memory project tasks (mirrors
  // what project/[id]/page.tsx computed server-side).
  const projectArea = project
    ? (areas.find((a) => a.id === project.areaId) ?? null)
    : null;
  const openTasksByMember = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const task of projectTasks) {
      counts[task.assigneeEmail] = (counts[task.assigneeEmail] ?? 0) + 1;
    }
    return counts;
  }, [projectTasks]);

  // The sidebar badges are the same filters as their views — derived, so the
  // page doesn't need getSidebarCounts.
  const counts = useMemo<SidebarCounts>(
    () =>
      Object.fromEntries(
        (["inbox", "today", "snoozed", "delegated"] as const).map((badged) => [
          badged,
          deriveViewTasks(swept, badged, viewed.email).length,
        ])
      ),
    [swept, viewed.email]
  );

  // Everything below — sidebar, view header, add buttons — is the chrome focus
  // mode exists to remove, so it renders instead of the frame rather than
  // inside it. (The global header hides itself on this path; see
  // global-header-client.tsx.)
  if (inFocus) {
    return (
      <FocusMode
        tasks={focusTasks}
        projects={projects}
        attachmentsByTask={attachmentsByTask}
      />
    );
  }

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-6 sm:px-6">
      <div className="md:flex md:gap-8">
        <TodosSidebar
          active={project ? null : view}
          activeProjectId={project?.id}
          counts={counts}
          viewedEmail={viewed.email}
          selfEmail={selfEmail}
          members={members}
          projects={projects}
          areas={areas}
        />

        <div className="min-w-0 flex-1">
          <BackToLists href={withAs("/todos/browse", viewed.email, selfEmail)} />

          {viewed.email !== selfEmail && <ViewingBanner viewed={viewed} />}

          {project ? (
            <>
              <ProjectHeader
                project={project}
                area={projectArea}
                areas={areas}
                members={members}
                openTaskCount={projectTasks.length}
                openTasksByMember={openTasksByMember}
                homeHref={withAs("/todos/today", viewed.email, selfEmail)}
                logbookHref={withAs("/todos/logbook", viewed.email, selfEmail)}
              />

              <TaskList
                context={{ mode: "project", projectId: project.id }}
                initialTasks={projectTasks}
                initialSections={sections}
                members={members}
                projects={projects}
                attachmentsByTask={attachmentsByTask}
                viewedEmail={viewed.email}
                selfEmail={selfEmail}
              />

              <ProjectLogged projectId={project.id} />
            </>
          ) : (
            <>
              <div className="mb-4 flex items-center justify-between gap-3">
                <h1 className="font-serif text-2xl tracking-tight text-foreground">
                  {viewLabel(view)}
                </h1>
                {view === "today" && viewTasks.length > 0 && (
                  <button
                    type="button"
                    onClick={() => requestFocusSwitch()}
                    className="ml-auto flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
                    title="Focus mode (f)"
                  >
                    <Crosshair className="size-4" />
                    <span className="hidden sm:inline">Focus</span>
                  </button>
                )}
                {view === "snoozed" || view === "delegated" || view === "logbook" ? (
                  // Status/history lenses can't host an inline draft — fall back
                  // to the capture modal.
                  <QuickAddButton
                    label="New"
                    defaults={{ assigneeEmail: viewed.email, bucket: "inbox" }}
                  />
                ) : (
                  // Bucket views create in place, like Things: a draft opens at
                  // the top of the list.
                  <InlineNewButton />
                )}
              </div>

              {view === "logbook" ? (
                <LogbookList
                  initialTasks={logbookTasks}
                  initialProjects={logbookProjects}
                />
              ) : (
                <TaskList
                  context={{ mode: "view", view }}
                  initialTasks={viewTasks}
                  initialSections={sections}
                  members={members}
                  projects={projects}
                  attachmentsByTask={attachmentsByTask}
                  viewedEmail={viewed.email}
                  selfEmail={selfEmail}
                />
              )}
            </>
          )}
        </div>
      </div>
    </main>
  );
}
