import type { SupabaseClient } from "@supabase/supabase-js";

export type TutoredStudent = {
  /** Whose classes, name and grade the tutor uses. */
  studentId: string;
  /**
   * Whose chats these are: the threads, photos and "seen" marks are saved
   * under this user. The caller, except when a parent hands their phone to a
   * kid, when it's the kid.
   */
  ownerId: string;
  name: string;
  birthdate: string | null;
  /** A parent trying the app as a kid: their chats stay their own. */
  preview: boolean;
};

/**
 * The header a parent's phone sends when a kid is using it as themselves
 * (the app's "Oscar" view): the kid's user id. Their chats are the kid's own,
 * as if the kid had signed in.
 */
export const KID_HEADER = "x-tuttles-kid";

/**
 * Who the tutor is tutoring. A kid is tutored as themselves. A parent trying
 * the app is tutored as a kid, so they see what the kid will: the kid's name,
 * grade and classes. The chat still belongs to the parent, so it never lands in
 * the kid's history, summary or memory.
 *
 * The kid previewed is the oldest one with Canvas connected (only Sebastian,
 * for now).
 *
 * `asKid`: a parent's phone being used by a kid without one of their own. The
 * named kid is tutored as themselves and owns the chats. Only a parent may ask,
 * and only for a kid; anything else is refused (null).
 */
export async function tutoredStudent(
  db: SupabaseClient,
  userId: string,
  asKid: string | null = null,
): Promise<TutoredStudent | null> {
  const { data: members } = await db
    .from("family_members")
    .select("user_id, name, birthdate, role")
    .not("user_id", "is", null);
  const me = members?.find((m) => m.user_id === userId);
  if (!me) return null;
  const isParent = me.role === "owner" || me.role === "parent";

  if (asKid) {
    const kid = isParent ? members?.find((m) => m.user_id === asKid && m.role === "kid") : null;
    if (!kid) return null;
    return { studentId: kid.user_id, ownerId: kid.user_id, name: kid.name ?? "the student", birthdate: kid.birthdate, preview: false };
  }

  const self = { studentId: userId, ownerId: userId, name: me.name ?? "the student", birthdate: me.birthdate, preview: false };
  if (!isParent) return self;

  const kid = await previewedKid(db, members ?? []);
  if (!kid) return self;
  return { studentId: kid.user_id, ownerId: userId, name: kid.name ?? "the student", birthdate: kid.birthdate, preview: true };
}

type Member = { user_id: string; name: string | null; birthdate: string | null; role: string };

/** The kid a parent previews: the oldest with Canvas connected, else the oldest. */
async function previewedKid(db: SupabaseClient, members: Member[]): Promise<Member | null> {
  const { data: conns } = await db.from("canvas_connections").select("student_id");
  const kids = members
    .filter((m) => m.role === "kid")
    .sort((a, b) => String(a.birthdate).localeCompare(String(b.birthdate)));
  return kids.find((k) => conns?.some((c) => c.student_id === k.user_id)) ?? kids[0] ?? null;
}

export type FamilyKid = {
  id: string;
  name: string;
  /** "preview": the parent sees what this kid would, in their own chats.
   *  "own": the kid uses the parent's phone, in the kid's own chats. */
  mode: "preview" | "own";
};

/**
 * The kids a parent's app can switch to, youngest first: the previewed kid
 * as a preview, the rest as themselves (they have no phone of their own).
 * Null for a kid.
 */
export async function familyKids(db: SupabaseClient, userId: string): Promise<FamilyKid[] | null> {
  const { data } = await db
    .from("family_members")
    .select("user_id, name, birthdate, role")
    .not("user_id", "is", null);
  const members = (data ?? []) as Member[];
  const me = members.find((m) => m.user_id === userId);
  if (!me || (me.role !== "owner" && me.role !== "parent")) return null;
  const previewed = await previewedKid(db, members);
  return members
    .filter((m) => m.role === "kid")
    .sort((a, b) => String(b.birthdate).localeCompare(String(a.birthdate)))
    .map((k) => ({
      id: k.user_id,
      name: k.name ?? "Kid",
      mode: k.user_id === previewed?.user_id ? "preview" : "own",
    }));
}

/** The kid a request names with {@link KID_HEADER}, if any. */
export function requestedKid(request: Request): string | null {
  const id = request.headers.get(KID_HEADER)?.trim().toLowerCase();
  return id || null;
}
