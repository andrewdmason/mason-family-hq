import type { SupabaseClient } from "@supabase/supabase-js";
import type { FamilyKid } from "@/lib/tuttles/tutoring-as";
import { currentUnit, type Assignment } from "@/lib/canvas/tutor-context";

/**
 * What the Tuttles app shows about a student's classes: the "Due soon" strip,
 * a page per class (current unit, due and missing work, new feedback), and the
 * labels on chats. Worked out here from the synced Canvas tables so the phone
 * only draws it.
 */

const DAY = 864e5;
/** "Due soon" reaches this far ahead. */
const SOON = 7 * DAY;
/** Feedback counts as recent for this long after grading. */
const RECENT_FEEDBACK = 21 * DAY;

export type ClassAssignment = {
  id: number;
  courseId: number;
  name: string;
  dueAt: string | null;
  status: "todo" | "missing" | "submitted" | "graded" | "excused";
  score: number | null;
  pointsPossible: number | null;
  isQuiz: boolean;
  comments: { author: string | null; comment: string }[];
  /** Feedback (a comment, or lost points) the viewer hasn't opened in the app. */
  isNew: boolean;
  url: string | null;
};

export type ClassInfo = {
  id: number;
  name: string;
  /** "Math", "History": what fits on a label. */
  shortName: string;
  /** Hex, picked per subject so a class keeps its color. */
  color: string;
  unit: { name: string; overviewTitle: string | null; overview: string | null } | null;
  due: ClassAssignment[];
  missing: ClassAssignment[];
  feedback: ClassAssignment[];
};

export type ClassesPayload = {
  /** Whose classes these are (a parent trying the app sees a kid's). */
  student: { name: string; preview: boolean };
  /** For a parent: the kids the app can switch to (src/lib/tuttles/tutoring-as.ts). */
  kids?: FamilyKid[];
  /** What Tuttles has noticed (src/lib/tuttles/memory.ts), for the student to read; no evidence, no parent notes. */
  memory: {
    learning: string[];
    classes: { courseId: number | null; name: string; strong: string[]; workingOn: string[] }[];
  } | null;
  dueSoon: ClassAssignment[];
  classes: ClassInfo[];
  syncedAt: string | null;
};

const SUBJECTS: [RegExp, string, string][] = [
  [/math|algebra|geometry|calculus/i, "Math", "#2f6fdb"],
  [/science|biology|chemistry|physics/i, "Science", "#2e9d5b"],
  [/history|social studies/i, "History", "#c46b1d"],
  [/english|literature|writing/i, "English", "#8a4fd6"],
  [/espa|spanish|french|latin|mandarin/i, "Spanish", "#d6407a"],
];
const FALLBACK_COLORS = ["#0f8f8f", "#9a7b14", "#5b5bd6", "#b5482d"];

export function subjectOf(name: string, index: number): { shortName: string; color: string } {
  const hit = SUBJECTS.find(([re]) => re.test(name));
  if (hit) {
    // Spanish/French/… keep their own name.
    const shortName = hit[1] === "Spanish" && !/espa|spanish/i.test(name) ? name.split(/\s/)[0] : hit[1];
    return { shortName, color: hit[2] };
  }
  return { shortName: name.replace(/\s+\d+.*$/, ""), color: FALLBACK_COLORS[index % FALLBACK_COLORS.length] };
}

export async function classesFor(
  db: SupabaseClient,
  studentId: string,
  viewerId: string,
  now = new Date(),
): Promise<Omit<ClassesPayload, "student" | "memory">> {
  const [{ data: conn }, { data: courses }, { data: assignments }, { data: modules }, { data: pages }, { data: seen }] =
    await Promise.all([
      db.from("canvas_connections").select("last_synced_at").eq("student_id", studentId).maybeSingle(),
      db.from("canvas_courses").select("id, name").eq("student_id", studentId).order("name"),
      db
        .from("canvas_assignments")
        .select(
          "id, course_id, name, description, due_at, points_possible, is_quiz, module_name, rubric, files, workflow_state, submitted_at, graded_at, score, missing, late, excused, answer, comments, rubric_scores, html_url",
        )
        .eq("student_id", studentId),
      db.from("canvas_modules").select("course_id, name, position, item_count").eq("student_id", studentId),
      db.from("canvas_items").select("course_id, title, body, module_name").eq("student_id", studentId).eq("kind", "page"),
      db.from("tutor_feedback_seen").select("assignment_id").eq("user_id", viewerId),
    ]);
  const t = now.getTime();
  const seenIds = new Set((seen ?? []).map((s) => Number(s.assignment_id)));
  const all = (assignments ?? []) as (Assignment & { html_url: string | null })[];

  const summary = (a: Assignment & { html_url: string | null }): ClassAssignment => {
    const graded = a.graded_at != null && a.score != null;
    const status: ClassAssignment["status"] = a.excused
      ? "excused"
      : graded
        ? "graded"
        : a.missing
          ? "missing"
          : a.submitted_at
            ? "submitted"
            : "todo";
    return {
      id: a.id,
      courseId: a.course_id,
      name: a.name,
      dueAt: a.due_at,
      status,
      score: a.score,
      pointsPossible: a.points_possible,
      isQuiz: a.is_quiz,
      comments: a.comments.map((c) => ({ author: c.author, comment: c.comment })),
      isNew: graded && !seenIds.has(a.id),
      url: a.html_url,
    };
  };

  const isDueSoon = (a: Assignment) =>
    a.due_at != null &&
    !a.submitted_at &&
    !a.excused &&
    a.graded_at == null &&
    Date.parse(a.due_at) >= t - 12 * 3600e3 &&
    Date.parse(a.due_at) <= t + SOON;
  const byDue = (a: { due_at: string | null }, b: { due_at: string | null }) =>
    Date.parse(a.due_at ?? "9999") - Date.parse(b.due_at ?? "9999");

  const classes: ClassInfo[] = (courses ?? []).map((course, i) => {
    const mine = all.filter((a) => a.course_id === course.id);
    const unitName = currentUnit(mine, (modules ?? []).filter((m) => m.course_id === course.id), t);
    const overview = unitName ? (pages ?? []).find((p) => p.course_id === course.id && p.module_name === unitName) : null;
    return {
      id: course.id,
      name: course.name,
      ...subjectOf(course.name, i),
      unit: unitName ? { name: unitName, overviewTitle: overview?.title ?? null, overview: overview?.body ?? null } : null,
      due: mine.filter(isDueSoon).sort(byDue).map(summary),
      missing: mine.filter((a) => a.missing && !a.excused && a.graded_at == null).sort(byDue).map(summary),
      feedback: mine
        .filter((a) => a.graded_at && a.score != null && Date.parse(a.graded_at) >= t - RECENT_FEEDBACK)
        // Worth going over: the teacher said something, or points were lost.
        // Full marks with no comment is just a grade.
        .filter(
          (a) =>
            a.comments.length > 0 ||
            (a.rubric_scores ?? []).some((r) => r.comments) ||
            (a.points_possible != null && a.score! < a.points_possible),
        )
        .sort((a, b) => Date.parse(b.graded_at!) - Date.parse(a.graded_at!))
        .map(summary),
    };
  });

  const dueSoon = [
    ...classes.flatMap((c) => c.missing),
    ...all.filter(isDueSoon).sort(byDue).map(summary),
  ].filter((a, i, list) => list.findIndex((b) => b.id === a.id) === i);

  return { dueSoon, classes, syncedAt: conn?.last_synced_at ?? null };
}
