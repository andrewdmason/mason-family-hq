import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

function firstName(name: string | null, fallback: string): string {
  return name?.trim().split(/\s+/)[0] || fallback;
}

/**
 * Map a set of user ids to their first names (for "Oscar claimed…" labels).
 * Takes a service-role client since it reads across members. Small id sets only.
 */
export async function firstNameFor(
  admin: SupabaseClient,
  userIds: string[]
): Promise<Map<string, string>> {
  const ids = [...new Set(userIds)];
  const byUser = new Map<string, string>();
  if (ids.length === 0) return byUser;

  const { data } = await admin
    .from("family_members")
    .select("user_id, name, email")
    .in("user_id", ids);
  for (const m of data ?? []) {
    byUser.set(
      m.user_id as string,
      firstName((m.name as string | null) ?? null, (m.email as string) ?? "A kid")
    );
  }
  return byUser;
}
