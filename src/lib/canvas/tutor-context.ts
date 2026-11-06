import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * What the tutor is told about a student's classes, from the synced Canvas
 * tables: each course's current unit (with the teacher's overview of it),
 * what's due around now with the full instructions and rubric, what's missing,
 * recent grades with teacher comments, and recent announcements.
 *
 * Kept to recent and upcoming work so it stays a few thousand tokens. It goes
 * in the instructions, which stay the same turn to turn, so the model's prompt
 * cache absorbs most of the cost.
 */

const DAY = 864e5;
/** Full instructions for work due this far back and ahead. */
const DETAIL_BACK = 7 * DAY;
const DETAIL_AHEAD = 10 * DAY;
/** One-line listings this far back and ahead. */
const LIST_BACK = 14 * DAY;
const LIST_AHEAD = 21 * DAY;

type Assignment = {
  id: number;
  course_id: number;
  name: string;
  description: string | null;
  due_at: string | null;
  points_possible: number | null;
  is_quiz: boolean;
  module_name: string | null;
  rubric: { description: string; points: number | null }[] | null;
  files: { name: string }[];
  workflow_state: string | null;
  submitted_at: string | null;
  graded_at: string | null;
  score: number | null;
  missing: boolean;
  late: boolean;
  excused: boolean;
  answer: string | null;
  comments: { author: string | null; comment: string }[];
  rubric_scores: { criterion: string; points: number | null; comments: string | null }[] | null;
};

export async function canvasContext(db: SupabaseClient, studentId: string, now = new Date()): Promise<string | null> {
  const [{ data: conn }, { data: courses }, { data: assignments }, { data: modules }, { data: items }] = await Promise.all([
    db.from("canvas_connections").select("last_synced_at").eq("student_id", studentId).maybeSingle(),
    db.from("canvas_courses").select("id, name").eq("student_id", studentId).order("name"),
    db
      .from("canvas_assignments")
      .select(
        "id, course_id, name, description, due_at, points_possible, is_quiz, module_name, rubric, files, workflow_state, submitted_at, graded_at, score, missing, late, excused, answer, comments, rubric_scores",
      )
      .eq("student_id", studentId),
    db.from("canvas_modules").select("course_id, name, position, item_count").eq("student_id", studentId),
    db
      .from("canvas_items")
      .select("course_id, kind, title, body, module_name, module_position, posted_at")
      .eq("student_id", studentId),
  ]);
  if (!conn?.last_synced_at || !courses?.length) return null;

  const t = now.getTime();
  const all = (assignments ?? []) as Assignment[];
  const sections: string[] = [];

  for (const course of courses) {
    const mine = all.filter((a) => a.course_id === course.id);
    const lines: string[] = [`### ${course.name}`];

    const unit = currentUnit(mine, (modules ?? []).filter((m) => m.course_id === course.id), t);
    if (unit) {
      lines.push(`Current unit: ${unit}`);
      const overview = (items ?? []).find((i) => i.course_id === course.id && i.kind === "page" && i.module_name === unit);
      if (overview?.body) lines.push(`Unit overview ("${overview.title}"):\n${clip(overview.body, 1500)}`);
    }

    const dated = mine
      .filter((a) => a.due_at)
      .sort((a, b) => Date.parse(a.due_at!) - Date.parse(b.due_at!));
    const missing = mine.filter((a) => a.missing && !a.excused);
    const listed = dated.filter((a) => {
      const due = Date.parse(a.due_at!);
      return due >= t - LIST_BACK && due <= t + LIST_AHEAD;
    });
    for (const a of [...missing.filter((m) => !listed.includes(m)), ...listed]) {
      const due = Date.parse(a.due_at ?? "");
      const detailed = Number.isFinite(due) && due >= t - DETAIL_BACK && due <= t + DETAIL_AHEAD;
      lines.push(describe(a, detailed, t));
    }

    const news = (items ?? [])
      .filter((i) => i.course_id === course.id && i.kind === "announcement" && i.posted_at && Date.parse(i.posted_at) >= t - LIST_BACK)
      .map((i) => `Announcement (${day(i.posted_at!)}): ${i.title}${i.body ? `: ${clip(i.body, 400)}` : ""}`);
    lines.push(...news);

    if (lines.length > 1) sections.push(lines.join("\n"));
  }
  if (sections.length === 0) return null;

  return [
    `## The student's classes, from Canvas (today is ${date(now.toISOString())})`,
    "Use this to connect questions to the student's actual assignments: when a photo or question matches one, work from its instructions and rubric, and point to the attached reading where it helps. Mention what's due or missing only when it's relevant; don't recite this list. Graded work's own answer and the teacher's comments are here so you can help the student learn from them.",
    ...sections,
  ].join("\n\n");
}

/** The unit the latest work due by now (or the next work, early in a unit) sits in. */
function currentUnit(
  assignments: Assignment[],
  modules: { name: string; position: number; item_count: number }[],
  t: number,
): string | null {
  const inUnits = assignments.filter((a) => a.module_name && a.due_at);
  const past = inUnits.filter((a) => Date.parse(a.due_at!) <= t + 3 * DAY);
  const pick = past.sort((a, b) => Date.parse(b.due_at!) - Date.parse(a.due_at!))[0];
  if (pick) return pick.module_name;
  // No dated work in modules: the last module with anything in it.
  const filled = modules.filter((m) => m.item_count > 0).sort((a, b) => b.position - a.position);
  return filled[0]?.name ?? null;
}

function describe(a: Assignment, detailed: boolean, t: number): string {
  const due = a.due_at ? Date.parse(a.due_at) : NaN;
  const status = a.excused
    ? "excused"
    : a.graded_at && a.score != null
      ? `graded ${fmt(a.score)}${a.points_possible ? `/${fmt(a.points_possible)}` : ""}`
      : a.missing
        ? "MISSING"
        : a.submitted_at
          ? `submitted${a.late ? " late" : ""}`
          : due < t
            ? "not submitted"
            : "to do";
  const head = `- ${a.is_quiz ? "[quiz] " : ""}${a.name}, due ${a.due_at ? day(a.due_at) : "(no date)"}: ${status}`;
  const extra: string[] = [];
  for (const c of a.comments) extra.push(`  Teacher comment${c.author ? ` (${c.author})` : ""}: ${clip(c.comment, 300)}`);
  for (const r of a.rubric_scores ?? []) {
    if (r.comments) extra.push(`  Rubric "${r.criterion}": ${r.points ?? "?"} points, "${clip(r.comments, 200)}"`);
  }
  // Work that lost points shows its instructions too, so the answer can be read against the question.
  const lostPoints = Boolean(a.answer && a.score != null && a.points_possible && a.score < a.points_possible);
  if (detailed || lostPoints) {
    if (a.description) extra.push(`  Instructions:\n${indent(clip(a.description, 1500))}`);
    if (a.rubric?.length) {
      extra.push(`  Rubric: ${a.rubric.map((r) => `${r.description}${r.points != null ? ` (${fmt(r.points)})` : ""}`).join("; ")}`);
    }
    if (a.files.length) extra.push(`  Attached: ${a.files.map((f) => f.name).join(", ")}`);
  }
  // What was turned in, when it lost points: that's what to learn from.
  if (lostPoints) {
    extra.push(`  The student's submitted answer:\n${indent(clip(a.answer, 1200))}`);
  }
  return [head, ...extra].join("\n");
}

function day(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    timeZone: "America/Los_Angeles",
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function date(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    timeZone: "America/Los_Angeles",
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n).trimEnd()}…` : s);
const indent = (s: string) => s.split("\n").map((l) => `    ${l}`).join("\n");
