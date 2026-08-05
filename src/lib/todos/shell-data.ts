import { createClient } from "@/lib/supabase/server";
import { resolveViewedMember } from "@/lib/todos/member-context";
import {
  getAllActiveTasks,
  getAreas,
  getLogbookProjects,
  getLogbookTasks,
  getProjects,
  getSections,
  getSelfEmail,
  getTaskAttachments,
  getTodoMembers,
  markInboxSeen,
  sweepElapsedSnoozes,
} from "@/lib/todos/queries";

/**
 * The one server read every todos shell route makes.
 *
 * /todos/[view], /todos/project/[id] and /todos/focus all render the *same*
 * client shell (todos-views.tsx) off the *same* household-wide superset — the
 * shell derives whichever destination the URL names in memory. So they all need
 * this identical preamble, and it lives here once rather than three times.
 *
 * Route-specific work stays in the routes: notFound() on a bad view/project id.
 * The one exception is acknowledging the Inbox — it has to happen before the
 * read, so it's a flag here rather than a second call at the callsite.
 */
export async function loadShellData(
  as: string | undefined,
  /** Landing on your own Inbox clears the bell (see markInboxSeen). */
  opts: { acknowledgeInbox?: boolean } = {}
) {
  const supabase = await createClient();
  const [selfEmail, members] = await Promise.all([
    getSelfEmail(supabase),
    getTodoMembers(),
  ]);
  const viewed = resolveViewedMember(as, selfEmail, members);

  // Wake elapsed snoozes before reading, so Today and its badge agree.
  await sweepElapsedSnoozes(supabase);
  if (opts.acknowledgeInbox && viewed.email === selfEmail) {
    await markInboxSeen(supabase, selfEmail);
  }
  const [activeTasks, logbookTasks, projects, sections, areas, logbookProjects] =
    await Promise.all([
      // The whole household's active set: the shell derives each member view
      // (filtered by assignee/creator) *and* any project (every assignee) from
      // it, so view↔project switches never hit the server.
      getAllActiveTasks(supabase),
      getLogbookTasks(supabase, viewed.email),
      getProjects(supabase),
      getSections(supabase),
      getAreas(supabase),
      getLogbookProjects(supabase),
    ]);
  const attachmentsByTask = await getTaskAttachments(
    supabase,
    activeTasks.map((t) => t.id)
  );

  return {
    // When this data was read. The app-shell service worker hands a cold launch
    // the last HTML it rendered and revalidates behind it (public/sw.js), so a
    // render can reach the screen hours after this timestamp — with a to-do list
    // that stopped being true overnight. The shell compares it against the clock
    // on arrival and re-reads if it's looking at yesterday (see useShellData).
    renderedAt: Date.now(),
    selfEmail,
    members,
    viewed,
    activeTasks,
    logbookTasks,
    logbookProjects,
    projects,
    sections,
    areas,
    attachmentsByTask,
  };
}

/**
 * Everything the client shell renders — and nothing else, so the same payload
 * can travel back from a server action (see loadShellSnapshot) without a route
 * re-render. Keep it serializable.
 */
export type TodosShellData = Awaited<ReturnType<typeof loadShellData>>;
