import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import type { RosterMember } from "@/lib/reading/mentions";

/**
 * The family, for anything that needs to name people rather than act as them.
 *
 * Read through the admin client because family_members' own policy exposes only
 * your own row — the same reason the todos member list does it, and the same
 * shape of read: names and colours, never anything that decides access.
 *
 * A generalisation of getTodoMembers rather than a second copy of it, because
 * three unrelated things now want the same list — the mention picker, the
 * notification bell, and the mailer that has to address an email to a person
 * rather than to a uuid — and a handle that resolves differently in the composer
 * than in the email is a bug with no symptom until somebody is confused about
 * who they shared a passage with.
 */
export type FamilyMember = RosterMember & {
  color: string | null;
  role: string | null;
};

export async function listRoster(): Promise<FamilyMember[]> {
  const admin = createAdminClient();
  const [{ data }, { data: photos }] = await Promise.all([
    admin
      .from("family_members")
      .select("email, name, color, role, user_id")
      .order("created_at", { ascending: true }),
    admin
      .from("journal_member_photos")
      .select("member_email")
      .eq("is_primary", true),
  ]);

  const withPhoto = new Set(
    ((photos ?? []) as { member_email: string }[]).map((p) => p.member_email)
  );

  return ((data ?? []) as {
    email: string;
    name: string | null;
    color: string | null;
    role: string | null;
    user_id: string | null;
  }[]).map((m) => ({
    email: m.email,
    name: m.name,
    color: m.color,
    role: m.role,
    userId: m.user_id,
    hasPhoto: withPhoto.has(m.email),
  }));
}

/**
 * Who can be mentioned in a mark today.
 *
 * The reader is gated to adults, so a picker offering a kid would generate a
 * notification that dead-ends at a redirect: they cannot open the link they were
 * sent. Filtered here rather than in the picker so the server that grants access
 * and the list you choose from can never disagree — and so that opening the
 * reader to the kids one day is this predicate, not a hunt.
 */
export function mentionableMembers(
  roster: FamilyMember[],
  selfEmail: string | null
): FamilyMember[] {
  return roster.filter(
    (m) =>
      m.email !== selfEmail &&
      m.userId != null &&
      (m.role === "owner" || m.role === "parent")
  );
}
