import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { resolveViewedMember, withAs } from "@/lib/todos/member-context";
import {
  getAreas,
  getProjectLoggedTasks,
  getProjects,
  getProjectTasks,
  getSelfEmail,
  getSidebarCounts,
  getTaskAttachments,
  getTodoMembers,
  sweepElapsedSnoozes,
} from "@/lib/todos/queries";
import { BackToLists } from "@/components/todos/back-to-lists";
import { InlineNewButton } from "@/components/todos/inline-new-button";
import { ProjectHeader } from "@/components/todos/project-header";
import { ProjectLogged } from "@/components/todos/project-logged";
import { TaskList } from "@/components/todos/task-list";
import { TodosSidebar } from "@/components/todos/todos-sidebar";
import { ViewingBanner } from "@/components/todos/viewing-banner";

export const dynamic = "force-dynamic";

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
  const [projects, areas, tasks, loggedTasks, counts] = await Promise.all([
    getProjects(supabase),
    getAreas(supabase),
    getProjectTasks(supabase, id),
    getProjectLoggedTasks(supabase, id),
    getSidebarCounts(supabase, viewed.email),
  ]);

  const project = projects.find((p) => p.id === id);
  if (!project) notFound();

  const attachmentsByTask = await getTaskAttachments(supabase, tasks.map((t) => t.id));

  const area = areas.find((a) => a.id === project.areaId) ?? null;
  const openTasksByMember: Record<string, number> = {};
  for (const task of tasks) {
    openTasksByMember[task.assigneeEmail] =
      (openTasksByMember[task.assigneeEmail] ?? 0) + 1;
  }

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-6 sm:px-6">
      <div className="md:flex md:gap-8">
        <TodosSidebar
          active={null}
          activeProjectId={project.id}
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

          <ProjectHeader
            project={project}
            area={area}
            areas={areas}
            members={members}
            openTaskCount={tasks.length}
            openTasksByMember={openTasksByMember}
            homeHref={withAs("/todos/today", viewed.email, selfEmail)}
            logbookHref={withAs("/todos/logbook", viewed.email, selfEmail)}
          />

          <div className="mb-1 flex justify-end">
            <InlineNewButton />
          </div>

          <TaskList
            context={{ mode: "project", projectId: project.id }}
            initialTasks={tasks}
            members={members}
            projects={projects}
            attachmentsByTask={attachmentsByTask}
            viewedEmail={viewed.email}
            selfEmail={selfEmail}
          />

          <ProjectLogged initialTasks={loggedTasks} />
        </div>
      </div>
    </main>
  );
}
