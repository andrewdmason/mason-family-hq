import { createClient } from "@/lib/supabase/server";
import { resolveViewedMember } from "@/lib/todos/member-context";
import {
  getAreas,
  getDelegatedCount,
  getInboxCount,
  getProjects,
  getSelfEmail,
  getTodoMembers,
} from "@/lib/todos/queries";
import { TodosSidebar } from "@/components/todos/todos-sidebar";
import { ViewingBanner } from "@/components/todos/viewing-banner";

export const dynamic = "force-dynamic";

/**
 * The lists screen — Things' iPhone home. On phones the sidebar isn't a rail
 * beside the content; it's this full-screen page of views and projects, and
 * every view carries a back chevron returning here. Desktop never links to it
 * (the rail is always visible there), but it renders fine at any width.
 */
export default async function TodosBrowsePage({
  searchParams,
}: {
  searchParams: Promise<{ as?: string }>;
}) {
  const { as } = await searchParams;

  const supabase = await createClient();
  const [selfEmail, members] = await Promise.all([
    getSelfEmail(supabase),
    getTodoMembers(),
  ]);
  const viewed = resolveViewedMember(as, selfEmail, members);

  const [inboxCount, delegatedCount, projects, areas] = await Promise.all([
    getInboxCount(supabase, viewed.email),
    getDelegatedCount(supabase, viewed.email),
    getProjects(supabase),
    getAreas(supabase),
  ]);

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-6 sm:px-6">
      <div className="mx-auto w-full max-w-md">
        {viewed.email !== selfEmail && <ViewingBanner viewed={viewed} />}
        <TodosSidebar
          variant="page"
          active={null}
          inboxCount={inboxCount}
          delegatedCount={delegatedCount}
          viewedEmail={viewed.email}
          selfEmail={selfEmail}
          members={members}
          projects={projects}
          areas={areas}
        />
      </div>
    </main>
  );
}
