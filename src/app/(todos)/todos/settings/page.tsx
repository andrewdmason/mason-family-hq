import { createClient } from "@/lib/supabase/server";
import { resolveViewedMember } from "@/lib/todos/member-context";
import {
  getAreas,
  getInboxCount,
  getProjects,
  getSelfEmail,
  getTodoMembers,
} from "@/lib/todos/queries";
import { ApiTokens, type ApiTokenRow } from "@/components/todos/api-tokens";
import { TodosSidebar } from "@/components/todos/todos-sidebar";

export const dynamic = "force-dynamic";

/**
 * Todos settings: personal API tokens for the capture integrations (iOS
 * Reminders Shortcut, Raycast). Always your own — no ?as= here.
 */
export default async function TodosSettingsPage() {
  const supabase = await createClient();
  const [selfEmail, members] = await Promise.all([
    getSelfEmail(supabase),
    getTodoMembers(),
  ]);
  const viewed = resolveViewedMember(undefined, selfEmail, members);

  const [inboxCount, projects, areas, { data: tokenRows }] = await Promise.all([
    getInboxCount(supabase, selfEmail),
    getProjects(supabase),
    getAreas(supabase),
    supabase
      .from("todo_api_tokens")
      .select("id, name, created_at, last_used_at")
      .order("created_at", { ascending: false }),
  ]);

  const tokens: ApiTokenRow[] = (
    (tokenRows ?? []) as {
      id: string;
      name: string;
      created_at: string;
      last_used_at: string | null;
    }[]
  ).map((row) => ({
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
  }));

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-6 sm:px-6">
      <div className="md:flex md:gap-8">
        <TodosSidebar
          active={null}
          inboxCount={inboxCount}
          viewedEmail={viewed.email}
          selfEmail={selfEmail}
          members={members}
          projects={projects}
          areas={areas}
        />

        <div className="min-w-0 flex-1">
          <h1 className="mb-1 font-serif text-2xl tracking-tight text-foreground">
            Integrations
          </h1>
          <p className="mb-4 text-sm text-muted-foreground">
            API tokens authenticate the Apple Reminders Shortcut and the
            Raycast quick-capture command. See{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">
              docs/todos-ios-shortcut.md
            </code>{" "}
            for the Shortcut recipe.
          </p>

          <ApiTokens tokens={tokens} />
        </div>
      </div>
    </main>
  );
}
