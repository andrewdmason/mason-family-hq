import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { resolveViewedMember } from "@/lib/todos/member-context";
import {
  getAreas,
  getInboxCount,
  getLogbookProjects,
  getProjects,
  getSelfEmail,
  getTaskAttachments,
  getTodoMembers,
  getViewTasks,
  markInboxSeen,
  sweepElapsedSnoozes,
} from "@/lib/todos/queries";
import { isTodoView, viewLabel } from "@/lib/todos/types";
import { LogbookList } from "@/components/todos/logbook-list";
import { QuickAddButton } from "@/components/todos/quick-add";
import { TaskList } from "@/components/todos/task-list";
import { TodosSidebar } from "@/components/todos/todos-sidebar";
import { ViewingBanner } from "@/components/todos/viewing-banner";

// Every load runs the snooze wake sweep (an UPDATE), so these pages can never
// be statically cached.
export const dynamic = "force-dynamic";

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

  // Wake elapsed snoozes before reading any view (keeps Today and the badge
  // consistent), then fetch. Opening your own Inbox also acknowledges the
  // tasks others put there (clears the bell).
  await sweepElapsedSnoozes(supabase);
  if (view === "inbox" && viewed.email === selfEmail) {
    await markInboxSeen(supabase, selfEmail);
  }
  const [tasks, inboxCount, projects, areas, logbookProjects] =
    await Promise.all([
      getViewTasks(supabase, viewed.email, view),
      getInboxCount(supabase, viewed.email),
      getProjects(supabase),
      getAreas(supabase),
      view === "logbook" ? getLogbookProjects(supabase) : Promise.resolve([]),
    ]);
  const attachmentsByTask =
    view === "logbook"
      ? {}
      : await getTaskAttachments(supabase, tasks.map((t) => t.id));

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-6 sm:px-6">
      <div className="md:flex md:gap-8">
        <TodosSidebar
          active={view}
          inboxCount={inboxCount}
          viewedEmail={viewed.email}
          selfEmail={selfEmail}
          members={members}
          projects={projects}
          areas={areas}
        />

        <div className="min-w-0 flex-1">
          {viewed.email !== selfEmail && <ViewingBanner viewed={viewed} />}

          <div className="mb-4 flex items-center justify-between gap-3">
            <h1 className="font-serif text-2xl tracking-tight text-foreground">
              {viewLabel(view)}
            </h1>
            <QuickAddButton
              label="New"
              defaults={{
                assigneeEmail: viewed.email,
                bucket: view === "today" ? "today" : "inbox",
              }}
            />
          </div>

          {view === "logbook" ? (
            <LogbookList initialTasks={tasks} initialProjects={logbookProjects} />
          ) : (
            <TaskList
              context={{ mode: "view", view }}
              initialTasks={tasks}
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
