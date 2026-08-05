import { notFound } from "next/navigation";
import { loadShellData } from "@/lib/todos/shell-data";
import { isTodoView, viewLabel } from "@/lib/todos/types";
import { TodosViews } from "@/components/todos/todos-views";

// Every load runs the snooze wake sweep (an UPDATE), so these pages can never
// be statically cached.
export const dynamic = "force-dynamic";

// Tab reads e.g. "Snoozed · Todos" (the (todos) layout's title template).
// Instant client-side switches keep this initial title — document.title isn't
// re-derived without a server render, and the tab naming the entry view is
// fine for a single-page session.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ view: string }>;
}) {
  const { view } = await params;
  return isTodoView(view) ? { title: viewLabel(view) } : {};
}

/**
 * One server render carries every sidebar view's data — a family's active
 * task set is small, so this is barely more than any single view's queries
 * cost. The client shell (todos-views.tsx) derives the view the URL names
 * (sidebar badge counts included) and switches between views instantly,
 * without coming back here; mutations reconcile by re-reading the same data
 * into the mounted shell (see shell-refresh.ts) rather than re-running this
 * page, so a refresh can never cost you an open editor.
 */
export default async function TodoViewPage({
  params,
  searchParams,
}: {
  params: Promise<{ view: string }>;
  searchParams: Promise<{ as?: string }>;
}) {
  const [{ view }, { as }] = await Promise.all([params, searchParams]);
  if (!isTodoView(view)) notFound();

  // Landing on your own Inbox also acknowledges the tasks others put there
  // (clears the bell); instant client-side switches to it do the same through
  // the acknowledgeInbox action.
  const data = await loadShellData(as, { acknowledgeInbox: view === "inbox" });

  return (
    <TodosViews
      initialView={view}
      activeTasks={data.activeTasks}
      logbookTasks={data.logbookTasks}
      logbookProjects={data.logbookProjects}
      attachmentsByTask={data.attachmentsByTask}
      members={data.members}
      projects={data.projects}
      sections={data.sections}
      areas={data.areas}
      viewed={data.viewed}
      selfEmail={data.selfEmail}
      renderedAt={data.renderedAt}
    />
  );
}
