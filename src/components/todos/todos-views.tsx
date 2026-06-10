"use client";

import { useEffect, useMemo, useRef } from "react";
import { usePathname } from "next/navigation";
import { acknowledgeInbox } from "@/app/(todos)/todos/actions";
import { BackToLists } from "@/components/todos/back-to-lists";
import { InlineNewButton } from "@/components/todos/inline-new-button";
import { LogbookList } from "@/components/todos/logbook-list";
import { QuickAddButton } from "@/components/todos/quick-add";
import { TaskList } from "@/components/todos/task-list";
import { TodosSidebar } from "@/components/todos/todos-sidebar";
import { ViewingBanner } from "@/components/todos/viewing-banner";
import { deriveViewTasks, localSnoozeSweep } from "@/lib/todos/derive";
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
 * The client shell for the sidebar views. The server page hands over the
 * *whole* active task set (plus the logbook page) in one render, and this
 * component derives whichever view the URL names — so switching views is a
 * pushState + an in-memory filter, instant, no server roundtrip. Sidebar
 * clicks and `g` chords route here through view-switch.ts; deep links, the
 * back button, and reloads all still resolve through /todos/[view].
 *
 * Freshness rides the existing reconcile loop: every mutation's drained
 * router.refresh() re-runs the page for the current (pushed) URL, and the new
 * snapshot updates every view's derivation at once.
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
}) {
  const pathname = usePathname();
  const { run } = useReconciler();

  // The URL names the view (pushState keeps usePathname in sync, and so do
  // back/forward); the server param is only the SSR starting point.
  const segment = pathname.split("/")[2] ?? "";
  const view: TodoView = isTodoView(segment) ? segment : initialView;
  const viewRef = useRef(view);
  viewRef.current = view;

  useEffect(
    () =>
      registerViewSwitcher((next) => {
        if (next === viewRef.current) return;
        window.history.pushState(
          null,
          "",
          withAs(`/todos/${next}`, viewed.email, selfEmail)
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
    if (isFirstRender || view !== "inbox" || viewed.email !== selfEmail) return;
    void run(acknowledgeInbox());
  }, [view, viewed.email, selfEmail, run]);

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

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-6 sm:px-6">
      <div className="md:flex md:gap-8">
        <TodosSidebar
          active={view}
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
            />
          )}
        </div>
      </div>
    </main>
  );
}
