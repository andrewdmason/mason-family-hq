import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getIsOwner } from "@/lib/journal/auth";

export type ReadingScope = {
  /** RLS-scoped session client in self mode; service-role admin in member mode. */
  client: SupabaseClient;
  /** Whose books to read/write. Use in EVERY .eq("user_id", …) and insert. */
  userId: string;
  /** That user's email, for the reading_settings (weekly goal) lookup. */
  email: string | null;
  /** True when the owner is viewing/managing another member's reading. */
  isMemberMode: boolean;
};

/**
 * Resolve whose reading a request operates on. Mirrors the journal's
 * resolveSettingsScope: no member (or your own) → self mode on the RLS client; a
 * different member → owner-gated member mode on a service-role admin client
 * scoped to that member's id.
 *
 * The admin client bypasses RLS, so callers MUST filter every read/write by the
 * returned `userId` (redundant-but-safe in self mode, required in member mode).
 * `userId` always comes from a trusted email→user_id lookup, never client input.
 */
export async function resolveReadingScope(
  memberEmail?: string | null
): Promise<ReadingScope> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  const callerId = user.id;
  const callerEmail = user.email?.toLowerCase() ?? null;

  const email = memberEmail?.trim().toLowerCase() || null;
  if (!email || email === callerEmail) {
    return { client: supabase, userId: callerId, email: callerEmail, isMemberMode: false };
  }

  if (!(await getIsOwner(supabase))) throw new Error("Not authorized");

  const admin = createAdminClient();
  const { data: member, error } = await admin
    .from("journal_members")
    .select("user_id")
    .eq("email", email)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!member) throw new Error("Member not found.");
  if (!member.user_id) {
    throw new Error("This person hasn't signed in yet, so there's nothing to show.");
  }
  if (member.user_id === callerId) {
    return { client: supabase, userId: callerId, email: callerEmail, isMemberMode: false };
  }

  return {
    client: admin,
    userId: member.user_id as string,
    email,
    isMemberMode: true,
  };
}
