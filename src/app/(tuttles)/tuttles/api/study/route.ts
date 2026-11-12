import { NextResponse } from "next/server";
import { tuttlesCaller } from "@/lib/tuttles/context";
import { iseeForGrade, namedIsee, parseSetDraft, TEMPLATES } from "@/lib/tuttles/study";
import { gradeFor } from "@/lib/tuttles/prompt";
import { addSources, saveSet, setSummaries } from "@/lib/tuttles/study-db";
import { foldInMaterial } from "@/lib/tuttles/study-material";

export const runtime = "nodejs";
export const maxDuration = 120;

const DAY = 864e5;
/** Canvas quizzes and tests this far ahead are offered as sets. */
const SUGGEST_AHEAD = 14 * DAY;
const TESTLIKE = /\b(quiz|test|exam|assessment|midterm|final)\b/i;

/**
 * The kid's study sets (src/lib/tuttles/study.ts), for the app's Study
 * section and set cards, and upcoming Canvas quizzes and tests that don't
 * have one yet.
 *
 *   GET   Authorization: Bearer …   → { studentId, sets, suggestions }
 *
 * `studentId` is whose sets these are (the folder their photos go in).
 *   GET ?archived=1                 → { sets }   (put-away sets)
 *
 * Makes one from a form (a parent's "New study set", or the kid outside a
 * chat): Tuttles reads the note and photos into topics and notes.
 *
 *   POST { title, courseId?, testDate?, note?, images?, template?, assignmentId? } → { set }
 *
 * `images` are already in the tuttles bucket, under {kid id}/study/.
 */
export async function GET(request: Request) {
  const caller = await tuttlesCaller(request);
  if ("error" in caller) return NextResponse.json({ error: caller.error }, { status: caller.status });
  const { db, student } = caller;
  const archived = new URL(request.url).searchParams.get("archived") === "1";
  const sets = await setSummaries(db, student.studentId, { archived });
  if (archived) return NextResponse.json({ sets }, { headers: { "Cache-Control": "no-store" } });

  const now = Date.now();
  const { data: upcoming } = await db
    .from("canvas_assignments")
    .select("id, course_id, name, due_at, is_quiz, submitted_at, graded_at")
    .eq("student_id", student.studentId)
    .gte("due_at", new Date(now - 12 * 3600e3).toISOString())
    .lte("due_at", new Date(now + SUGGEST_AHEAD).toISOString())
    .order("due_at");
  const { data: taken } = await db
    .from("tutor_study_sets")
    .select("assignment_id")
    .eq("student_id", student.studentId)
    .not("assignment_id", "is", null);
  const has = new Set((taken ?? []).map((t) => Number(t.assignment_id)));
  const suggestions = (upcoming ?? [])
    .filter((a) => (a.is_quiz || TESTLIKE.test(a.name)) && !a.submitted_at && !a.graded_at && !has.has(a.id))
    .slice(0, 5)
    .map((a) => ({ assignmentId: a.id, courseId: a.course_id, name: a.name, dueAt: a.due_at }));

  return NextResponse.json(
    { studentId: student.studentId, sets, suggestions },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  const caller = await tuttlesCaller(request);
  if ("error" in caller) return NextResponse.json({ error: caller.error }, { status: caller.status });
  const { db, student } = caller;
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const title = typeof body.title === "string" ? body.title.trim().slice(0, 120) : "";
  // "isee-lower"/"-middle"/"-upper", or plain "isee" for the level the kid's grade calls for.
  const asked = typeof body.template === "string" ? body.template.toLowerCase() : "";
  const template =
    asked in TEMPLATES ? asked : (namedIsee(asked, null) ?? (asked === "isee" ? iseeForGrade(gradeFor(student.birthdate)) : null));
  if (!title && !template) return NextResponse.json({ error: "A study set needs a name." }, { status: 400 });
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 8000) : "";
  const folder = `${student.studentId}/study/`;
  const images = (Array.isArray(body.images) ? body.images : [])
    .filter((p): p is string => typeof p === "string" && p.startsWith(folder) && p.endsWith(".jpg") && !p.includes(".."))
    .slice(0, 12);
  const courseId = typeof body.courseId === "number" ? body.courseId : null;
  const assignmentId = typeof body.assignmentId === "number" ? body.assignmentId : null;
  const testDate = typeof body.testDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.testDate) ? body.testDate : null;

  try {
    const by = caller.userId;
    const base = parseSetDraft({ title, testDate, template })!;
    let set = await saveSet(db, { student, by, setId: null, draft: base, courseId, assignmentId });
    if (note || images.length || assignmentId) {
      const canvas = assignmentId
        ? (await db.from("canvas_assignments").select("name, description").eq("id", assignmentId).eq("student_id", student.studentId).maybeSingle()).data
        : null;
      const topics = template ? TEMPLATES[template].topics : [];
      const draft = await foldInMaterial(db, set, topics, {
        note,
        images,
        canvas: canvas ? `${canvas.name}\n${(canvas.description ?? "").replace(/<[^>]+>/g, " ").slice(0, 4000)}` : null,
      });
      set = await saveSet(db, { student, by, setId: set.id, draft: { ...draft, title: title || draft.title } });
      await addSources(db, set.id, by, [
        ...(note ? [{ kind: "note" as const, body: note }] : []),
        ...images.map((p) => ({ kind: "photo" as const, imagePath: p, body: "Photo" })),
        ...(assignmentId ? [{ kind: "canvas" as const, assignmentId, body: canvas?.name ?? "Canvas assignment" }] : []),
      ]);
    }
    const summary = (await setSummaries(db, student.studentId)).find((s) => s.id === set.id);
    return NextResponse.json({ set: summary ?? null });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't make the set." }, { status: 500 });
  }
}
