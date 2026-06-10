import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { resolveViewedMember } from "@/lib/todos/member-context";
import {
  getAreas,
  getLogbookProjects,
  getLogbookTasks,
  getMemberActiveTasks,
  getProjects,
  getSelfEmail,
  getTaskAttachments,
  getTodoMembers,
  markInboxSeen,
  sweepElapsedSnoozes,
} from "@/lib/todos/queries";
import { isTodoView } from "@/lib/todos/types";
import { TodosViews } from "@/components/todos/todos-views";

// Every load runs the snooze wake sweep (an UPDATE), so these pages can never
// be statically cached.
export const dynamic = "force-dynamic";

/**
 * One server render carries every sidebar view's data — a family's active
 * task set is small, so this is barely more than any single view's queries
 * cost. The client shell (todos-views.tsx) derives the view the URL names and
 * switches between views instantly, without coming back here; mutations still
 * reconcile through router.refresh(), which re-runs this page for whichever
 * URL the shell has pushed.
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

  const supabase = await createClient();
  const [selfEmail, members] = await Promise.all([
    getSelfEmail(supabase),
    getTodoMembers(),
  ]);
  const viewed = resolveViewedMember(as, selfEmail, members);

  // Wake elapsed snoozes before reading (keeps Today and the badge
  // consistent), then fetch. Landing on your own Inbox also acknowledges the
  // tasks others put there (clears the bell); instant client-side switches to
  // it do the same through the acknowledgeInbox action.
  await sweepElapsedSnoozes(supabase);
  if (view === "inbox" && viewed.email === selfEmail) {
    await markInboxSeen(supabase, selfEmail);
  }
  const [activeTasks, logbookTasks, projects, areas, logbookProjects] =
    await Promise.all([
      getMemberActiveTasks(supabase, viewed.email),
      getLogbookTasks(supabase, viewed.email),
      getProjects(supabase),
      getAreas(supabase),
      getLogbookProjects(supabase),
    ]);
  const attachmentsByTask = await getTaskAttachments(
    supabase,
    activeTasks.map((t) => t.id)
  );

  return (
    <TodosViews
      initialView={view}
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
