import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { classesFor, type ClassesPayload } from "@/lib/tuttles/classes";
import { tutoredStudent } from "@/lib/tuttles/tutoring-as";
import { currentMemory } from "@/lib/tuttles/memory";

export const runtime = "nodejs";

/**
 * The Tuttles app's classes: the "Due soon" strip, a page per class, and the
 * labels on chats (src/lib/tuttles/classes.ts).
 *
 *   GET   Authorization: Bearer <supabase access token>   → ClassesPayload
 *
 * A parent gets the kid they're tutored as (src/lib/tuttles/tutoring-as.ts).
 * Bearer-only, like the chat route; excluded from the session gate in
 * middleware for that reason.
 */
export async function GET(request: Request) {
  const token = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const db = createAdminClient();
  const {
    data: { user },
  } = await db.auth.getUser(token);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const student = await tutoredStudent(db, user.id);
  if (!student) return NextResponse.json({ error: "not a family member" }, { status: 403 });

  const [classes, memory] = await Promise.all([
    classesFor(db, student.studentId, user.id),
    currentMemory(db, student.studentId),
  ]);
  const payload: ClassesPayload = {
    student: { name: student.name, preview: student.preview },
    memory: memory && {
      learning: memory.profile.learning.map((i) => i.text),
      classes: memory.profile.classes.map((c) => ({
        courseId: classes.classes.find((k) => k.name === c.name)?.id ?? null,
        name: c.name,
        strong: c.strengths.map((i) => i.text),
        workingOn: c.shaky.map((i) => i.text),
      })),
    },
    ...classes,
  };
  return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
}
