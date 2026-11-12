import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { canvasContext, focusAssignmentContext } from "@/lib/canvas/tutor-context";
import { memoryContext } from "@/lib/tuttles/memory";
import { requestedKid, tutoredStudent, type TutoredStudent } from "@/lib/tuttles/tutoring-as";

/**
 * The phone's requests to the Tuttles routes carry its Supabase access token
 * as a bearer header (no cookies; the routes are excluded from the session
 * gate in middleware). This checks it and works out who's being tutored.
 *
 * `userId` is whose chats these are: the caller, or the kid a parent's phone
 * is being used by (src/lib/tuttles/tutoring-as.ts).
 */
export async function tuttlesCaller(
  request: Request,
): Promise<{ db: SupabaseClient; userId: string; student: TutoredStudent } | { error: string; status: number }> {
  const token = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return { error: "unauthorized", status: 401 };
  const db = createAdminClient();
  const {
    data: { user },
  } = await db.auth.getUser(token);
  if (!user) return { error: "unauthorized", status: 401 };
  const student = await tutoredStudent(db, user.id, requestedKid(request));
  if (!student) return { error: "not a family member", status: 403 };
  return { db, userId: student.ownerId, student };
}

/**
 * What the tutor knows beyond its rules, in the order it's given: the
 * student as a learner (memory), their classes, and the assignment the chat
 * is about. Each part is left out when there's nothing for it.
 */
export async function studentSections(
  db: SupabaseClient,
  student: TutoredStudent,
  assignmentId: number | null,
): Promise<string[]> {
  const parts = await Promise.all([
    memoryContext(db, student.studentId, student.name).catch(() => null),
    canvasContext(db, student.studentId).catch(() => null),
    assignmentId ? focusAssignmentContext(db, student.studentId, assignmentId).catch(() => null) : null,
  ]);
  return parts.filter((p): p is string => Boolean(p));
}
