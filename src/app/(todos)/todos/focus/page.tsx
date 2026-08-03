import { loadShellData } from "@/lib/todos/shell-data";
import { TodosViews } from "@/components/todos/todos-views";

export const dynamic = "force-dynamic";

export const metadata = { title: "Focus" };

/**
 * Focus mode is one more destination the views shell renders from the same
 * in-memory household set, so this route exists only for the cold paths — a
 * reload, a deep link, a Shortcut firing straight into "what am I doing now".
 * In-app, `f` and the Today header button switch instantly via pushState.
 */
export default async function FocusPage({
  searchParams,
}: {
  searchParams: Promise<{ as?: string }>;
}) {
  const { as } = await searchParams;
  const data = await loadShellData(as);

  // initialView is only the shell's fallback when the URL names no view; here
  // the URL names focus, and Today is the list focus mode walks.
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
