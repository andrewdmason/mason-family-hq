import type { SupabaseClient } from "@supabase/supabase-js";

export type TutoredStudent = {
  /** Whose classes, name and grade the tutor uses. */
  studentId: string;
  /**
   * Whose chats these are: the threads, photos and "seen" marks are saved
   * under this user. The caller, except when a parent's phone is being used
   * as a kid, when it's the kid.
   */
  ownerId: string;
  name: string;
  birthdate: string | null;
  /** A parent in their own view, which is about a kid: the chats (their briefings) stay their own. */
  preview: boolean;
  /**
   * A parent using the app as themselves (the app's "Andrew" or "Jenny"):
   * their own chats, Vocab, Math and house, kept apart from the kids' so a
   * parent can try things without touching the kids' progress.
   */
  parentSelf?: boolean;
};

/**
 * The header a parent's phone sends when it's being used as a kid (the app's
 * "Oscar" and "Sebastian" views): the kid's user id. A parent's own id here
 * is the parent using the app as themselves. The chats are the kid's
 * own, as if the kid had signed in, whether it's the kid holding the phone or
 * a parent looking in.
 */
export const KID_HEADER = "x-tuttles-kid";

/**
 * Who the tutor is tutoring. A kid is tutored as themselves.
 *
 * `asKid`: a parent's phone being used as a kid, by the kid or by the parent.
 * The named kid is tutored as themselves and owns the chats: they show on the
 * kid's own phone and count in their history, summary and memory. Only a
 * parent may ask, and only for a kid; anything else is refused (null). A
 * parent who names themselves is tutored as themselves (`parentSelf`): their
 * own practice, apart from the kids'.
 *
 * A parent who names no kid is in the parents' own view (This week and their
 * briefings). It's about one kid, the oldest with Canvas connected (only
 * Sebastian, for now): the tutor knows that kid's name, grade and classes,
 * and the chats belong to the parent.
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

  if (asKid && isParent && asKid === userId) {
    return { studentId: userId, ownerId: userId, name: me.name ?? "the student", birthdate: me.birthdate, preview: false, parentSelf: true };
  }

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

/** The kid the parents' view is about: the oldest with Canvas connected, else the oldest. */
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
  /** Always "own": the phone is used as the kid, in the kid's own chats.
   *  Builds of the app from before every kid was "own" still read it. */
  mode: "own";
  /**
   * The kid has a phone of their own, so a parent's is only looking in:
   * opening their graded work there leaves it marked new for the kid. It's
   * the kid the parents' view is about, for now.
   */
  ownPhone: boolean;
};

/**
 * The kids a parent's app can switch to, youngest first, each used as
 * themselves. Null for a kid.
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
      mode: "own" as const,
      ownPhone: k.user_id === previewed?.user_id,
    }));
}

/** The kid a request names with {@link KID_HEADER}, if any. */
export function requestedKid(request: Request): string | null {
  const id = request.headers.get(KID_HEADER)?.trim().toLowerCase();
  return id || null;
}
