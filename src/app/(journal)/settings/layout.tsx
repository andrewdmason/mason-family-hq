import { SettingsNav } from "@/components/journal/settings-nav";
import { LogoutButton } from "@/components/journal/logout-button";
import { createClient } from "@/lib/supabase/server";
import { requireUserId } from "@/lib/members/auth";
import type { JournalAgentFile } from "@/lib/types";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Settings",
};

export default async function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const userId = await requireUserId(supabase);
  // One row gives us both the role (owner gates the Family tab) and the
  // name/email to show above Log out.
  const { data: me } = await supabase
    .from("family_members")
    .select("name, email, role")
    .eq("user_id", userId)
    .maybeSingle();
  const isOwner = me?.role === "owner";
  const canManage = me?.role === "owner" || me?.role === "parent";
  const { data } = await supabase
    .from("journal_agent_files")
    .select("id, name, updated_at")
    .order("updated_at", { ascending: false });
  const recentEdits = ((data ?? []) as Pick<
    JournalAgentFile,
    "id" | "name" | "updated_at"
  >[]).slice(0, 3);

  return (
    <div className="mx-auto w-full max-w-5xl px-6 pb-24 pt-12">
      <div className="grid gap-8 lg:grid-cols-[1fr_240px]">
        <div>
          <SettingsNav isOwner={isOwner} canManage={canManage} />
          {children}
        </div>

        <aside className="lg:sticky lg:top-20 lg:self-start">
          <h2 className="font-serif text-sm uppercase tracking-wide text-muted-foreground">
            Recent file edits
          </h2>
          <ul className="mt-3 space-y-3">
            {recentEdits.map((f) => (
              <li key={f.id} className="font-serif text-sm">
                <span className="block text-xs text-muted-foreground tabular-nums">
                  {f.updated_at.slice(0, 10)}
                </span>
                <span className="text-foreground">{f.name}</span>
              </li>
            ))}
          </ul>
          <p className="mt-6 font-serif text-xs italic text-muted-foreground">
            Edits you make here, or accept from a suggestion, update these
            timestamps.
          </p>

          <div className="mt-8 border-t border-border pt-6">
            <p className="font-serif text-sm text-foreground">
              {me?.name || me?.email || "Signed in"}
            </p>
            {me?.name && me?.email && (
              <p className="text-xs text-muted-foreground">{me.email}</p>
            )}
            <div className="mt-3">
              <LogoutButton />
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
