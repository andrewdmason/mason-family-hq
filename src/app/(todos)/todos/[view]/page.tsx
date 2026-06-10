import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { resolveViewedMember, withAs } from "@/lib/todos/member-context";
import {
  getAreas,
  getLogbookProjects,
  getProjects,
  getSelfEmail,
  getSidebarCounts,
  getTaskAttachments,
  getTodoMembers,
  getViewTasks,
  markInboxSeen,
  sweepElapsedSnoozes,
} from "@/lib/todos/queries";
import { isTodoView, viewLabel } from "@/lib/todos/types";
import { BackToLists } from "@/components/todos/back-to-lists";
import { InlineNewButton } from "@/components/todos/inline-new-button";
import { LogbookList } from "@/components/todos/logbook-list";
import { QuickAddButton } from "@/components/todos/quick-add";
import { TaskList } from "@/components/todos/task-list";
import { TodosSidebar } from "@/components/todos/todos-sidebar";
import { ViewingBanner } from "@/components/todos/viewing-banner";

// Every load runs the snooze wake sweep (an UPDATE), so these pages can never
// be statically cached.
export const dynamic = "force-dynamic";

// Tab reads e.g. "Snoozed · Todos" (the (todos) layout's title template).
export async function generateMetadata({
  params,
}: {
  params: Promise<{ view: string }>;
}) {
  const { view } = await params;
  return isTodoView(view) ? { title: viewLabel(view) } : {};
}

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
  const [tasks, counts, projects, areas, logbookProjects] =
    await Promise.all([
      getViewTasks(supabase, viewed.email, view),
      getSidebarCounts(supabase, viewed.email),
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
