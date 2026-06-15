"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { acknowledgeInbox } from "@/app/(todos)/todos/actions";
import { BackToLists } from "@/components/todos/back-to-lists";
import { InlineNewButton } from "@/components/todos/inline-new-button";
import { JournalNudgeRow } from "@/components/todos/journal-nudge-row";
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
import {
  isTodoView,
  viewLabel,
  type SidebarCounts,
  type TodoArea,
  type TodoMember,
  type TodoProject,
  type TodoTask,
  type TodoView,
} from "@/lib/todos/types";
import { registerViewSwitcher } from "@/lib/todos/view-switch";

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
 * Freshness rides the existing reconcile loop: every mutation's drained
 * router.refresh() re-runs the page for the current (pushed) URL, and the new
 * snapshot updates every view's and project's derivation at once.
 */
export function TodosViews({
  initialView,
  activeTasks,
  logbookTasks,
  logbookProjects,
  attachmentsByTask,
  members,
  projects,
  areas,
  viewed,
  selfEmail,
  journalNudge,
}: {
  initialView: TodoView;
  activeTasks: TodoTask[];
  logbookTasks: TodoTask[];
  logbookProjects: LogbookProject[];
  attachmentsByTask: Record<string, TodoTaskAttachment[]>;
  members: TodoMember[];
  projects: TodoProject[];
  areas: TodoArea[];
  viewed: TodoMember;
  selfEmail: string;
  /** Server-decided: show the "write in your journal" row in Today. */
  journalNudge: boolean;
}) {
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
    if (isFirstRender || inProject || view !== "inbox" || viewed.email !== selfEmail)
      return;
    void run(acknowledgeInbox());
  }, [inProject, view, viewed.email, selfEmail, run]);

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

  // The journal nudge is the server prop until a check-off hides it locally
  // (its dismissal lands before the reconcile refresh re-decides). A true
  // arriving later (a new local day in a long-lived tab) re-arms it.
  const [nudgeDismissed, setNudgeDismissed] = useState(false);
  useEffect(() => {
    if (journalNudge) setNudgeDismissed(false);
  }, [journalNudge]);
  const showNudge = journalNudge && !nudgeDismissed;

  // The sidebar badges are the same filters as their views — derived, so the
  // page doesn't need getSidebarCounts. The journal nudge row counts as a
  // Today item like any other.
  const counts = useMemo<SidebarCounts>(
    () =>
      Object.fromEntries(
        (["inbox", "today", "snoozed", "delegated"] as const).map((badged) => [
          badged,
          deriveViewTasks(swept, badged, viewed.email).length +
            (badged === "today" && showNudge ? 1 : 0),
        ])
      ),
    [swept, viewed.email, showNudge]
  );

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

              <div className="mb-1 flex justify-end">
                <InlineNewButton />
              </div>

              <TaskList
                context={{ mode: "project", projectId: project.id }}
                initialTasks={projectTasks}
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
                  members={members}
                  projects={projects}
                  attachmentsByTask={attachmentsByTask}
                  viewedEmail={viewed.email}
                  selfEmail={selfEmail}
                  extraRow={
                    view === "today" && showNudge ? (
                      <JournalNudgeRow
                        onDismissed={() => setNudgeDismissed(true)}
                      />
                    ) : undefined
                  }
                />
              )}
            </>
          )}
        </div>
      </div>
    </main>
  );
}
