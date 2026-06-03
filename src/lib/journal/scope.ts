import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getIsOwner, requireUserId } from "@/lib/members/auth";

export type SettingsScope = {
  /** RLS-scoped client in self mode; service-role admin client in member mode. */
  client: SupabaseClient;
  /** Whose settings to read/write. Use in EVERY .eq("user_id", …) and insert. */
  userId: string;
  /** True when the owner is editing another member's settings. */
  isMemberMode: boolean;
};

/**
 * Resolve which user's settings a request operates on.
 *
 * - No `memberEmail` (or it resolves to the caller's own row): **self mode** —
 *   the regular RLS client, scoped to the caller.
 * - A `memberEmail` for someone else: **member mode** — owner-gated. The caller
 *   must be the owner and the target must have signed in (so their settings rows
 *   exist). Returns the service-role admin client scoped to that member's id.
 *
 * Because the admin client bypasses RLS, callers MUST add `.eq("user_id",
 * userId)` to every read/write — redundant-but-safe in self mode, required in
 * member mode. The returned `userId` always comes from a trusted email→user_id
 * lookup, never from client input.
 */
export async function resolveSettingsScope(
  memberEmail?: string | null
): Promise<SettingsScope> {
  const supabase = await createClient();
  const callerId = await requireUserId(supabase);

  const email = memberEmail?.trim().toLowerCase() || null;
  if (!email) {
    return { client: supabase, userId: callerId, isMemberMode: false };
  }

  if (!(await getIsOwner(supabase))) throw new Error("Not authorized");

  const admin = createAdminClient();
  const { data: member, error } = await admin
    .from("family_members")
    .select("user_id, seeded_at")
    .eq("email", email)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!member) throw new Error("Member not found.");
  if (!member.user_id) {
    throw new Error("This person hasn't signed in yet, so there's nothing to edit.");
  }

  // The owner editing their own row via the param behaves exactly like no param.
  if (member.user_id === callerId) {
    return { client: supabase, userId: callerId, isMemberMode: false };
  }

  return { client: admin, userId: member.user_id as string, isMemberMode: true };
}
