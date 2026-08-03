import { notFound } from "next/navigation";
import { loadShellData } from "@/lib/todos/shell-data";
import { TodosViews } from "@/components/todos/todos-views";

export const dynamic = "force-dynamic";

/**
 * A project is just another destination the views shell (todos-views.tsx)
 * renders from the in-memory household task set — so this route fetches the
 * *same* superset as /todos/[view] and hands it to the same shell, which reads
 * the project id from the URL. The only reason to SSR here at all is the hard
 * navigation / deep link / reload path (and the notFound() for a bad id);
 * in-app, sidebar clicks switch to a project instantly, no roundtrip.
 */
export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ as?: string }>;
}) {
  const [{ id }, { as }] = await Promise.all([params, searchParams]);

  const data = await loadShellData(as);
  if (!data.projects.some((p) => p.id === id)) notFound();

  // initialView is only the SSR fallback the shell uses when the URL names no
  // view — here the URL names a project, so the shell renders project mode.
  return (
    <TodosViews
      initialView="today"
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
    />
  );
}
