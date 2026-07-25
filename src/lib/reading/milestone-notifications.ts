import "server-only";

import type { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getIsAdult } from "@/lib/members/auth";
import type { JournalNotification } from "@/lib/types";

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

function firstName(name: string | null, fallback: string): string {
  return name?.trim().split(/\s+/)[0] || fallback;
}

/**
 * Bell items for reached-but-unawarded reward milestones, surfaced to parents so
 * they remember the real-world handoff. There's no persistent notifications table,
 * so this is computed each render like the journal/todo sources. Parents only — it
 * reads across kids via the service role (RLS otherwise hides other members'
 * milestones); a kid gets nothing. Clears when the parent marks it awarded.
 */
export async function getReadingMilestoneNotifications(
  supabase: SupabaseClient
): Promise<JournalNotification[]> {
  if (!(await getIsAdult(supabase))) return [];

  const admin = createAdminClient();
  const { data: rows } = await admin
    .from("reading_milestones")
    .select("id, user_id, title")
    .not("achieved_at", "is", null)
    .is("awarded_at", null);
  if (!rows || rows.length === 0) return [];

  const userIds = [...new Set(rows.map((r) => r.user_id as string))];
  const { data: members } = await admin
    .from("family_members")
    .select("user_id, name, email")
    .in("user_id", userIds);
  const nameByUser = new Map<string, string>();
  for (const m of members ?? []) {
    nameByUser.set(
      m.user_id as string,
      firstName((m.name as string | null) ?? null, (m.email as string) ?? "They")
    );
  }

  return rows.map((r) => ({
    id: `milestone:${r.id}`,
    title: r.title as string,
    reason: `${nameByUser.get(r.user_id as string) ?? "A reader"} reached this milestone`,
    href: "/books",
  }));
}
