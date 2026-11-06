import type { SupabaseClient } from "@supabase/supabase-js";

export type TutoredStudent = {
  /** Whose classes, name and grade the tutor uses. */
  studentId: string;
  name: string;
  birthdate: string | null;
  /** A parent trying the app as a kid: their chats stay their own. */
  preview: boolean;
};

/**
 * Who the tutor is tutoring. A kid is tutored as themselves. A parent trying
 * the app is tutored as a kid, so they see what the kid will: the kid's name,
 * grade and classes. The chat still belongs to the parent, so it never lands in
 * the kid's history, summary or memory.
 *
 * The kid is the oldest one with Canvas connected (only Sebastian, for now).
 * Once a second kid is connected, the app should let the parent choose.
 */
export async function tutoredStudent(db: SupabaseClient, userId: string): Promise<TutoredStudent | null> {
  const { data: members } = await db
    .from("family_members")
    .select("user_id, name, birthdate, role")
    .not("user_id", "is", null);
  const me = members?.find((m) => m.user_id === userId);
  if (!me) return null;
  const self = { studentId: userId, name: me.name ?? "the student", birthdate: me.birthdate, preview: false };
  if (me.role !== "owner" && me.role !== "parent") return self;

  const { data: conns } = await db.from("canvas_connections").select("student_id");
  const kids = (members ?? [])
    .filter((m) => m.role === "kid")
    .sort((a, b) => String(a.birthdate).localeCompare(String(b.birthdate)));
  const kid = kids.find((k) => conns?.some((c) => c.student_id === k.user_id)) ?? kids[0];
  if (!kid) return self;
  return { studentId: kid.user_id, name: kid.name ?? "the student", birthdate: kid.birthdate, preview: true };
}
