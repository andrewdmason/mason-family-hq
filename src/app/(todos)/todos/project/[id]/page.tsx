import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { resolveViewedMember } from "@/lib/todos/member-context";
import {
  getAllActiveTasks,
  getAreas,
  getLogbookProjects,
  getLogbookTasks,
  getProjects,
  getSelfEmail,
  getTaskAttachments,
  getTodoMembers,
  sweepElapsedSnoozes,
} from "@/lib/todos/queries";
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

  const supabase = await createClient();
  const [selfEmail, members] = await Promise.all([
    getSelfEmail(supabase),
    getTodoMembers(),
  ]);
  const viewed = resolveViewedMember(as, selfEmail, members);

  await sweepElapsedSnoozes(supabase);
  const [activeTasks, logbookTasks, projects, areas, logbookProjects] =
    await Promise.all([
      getAllActiveTasks(supabase),
      getLogbookTasks(supabase, viewed.email),
      getProjects(supabase),
      getAreas(supabase),
      getLogbookProjects(supabase),
    ]);

  if (!projects.some((p) => p.id === id)) notFound();

  const attachmentsByTask = await getTaskAttachments(
    supabase,
    activeTasks.map((t) => t.id)
  );

  // initialView is only the SSR fallback the shell uses when the URL names no
  // view — here the URL names a project, so the shell renders project mode.
  return (
    <TodosViews
      initialView="today"
      activeTasks={activeTasks}
      logbookTasks={logbookTasks}
      logbookProjects={logbookProjects}
      attachmentsByTask={attachmentsByTask}
      members={members}
      projects={projects}
      areas={areas}
      viewed={viewed}
      selfEmail={selfEmail}
    />
  );
}
