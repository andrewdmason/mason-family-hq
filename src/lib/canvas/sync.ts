import type { SupabaseClient } from "@supabase/supabase-js";
import {
  canvasClient,
  CanvasAuthError,
  type CanvasAnnouncement,
  type CanvasAssignment,
  type CanvasClient,
  type CanvasCourse,
  type CanvasFile,
  type CanvasModule,
  type CanvasPage,
  type CanvasSubmission,
  type CanvasUser,
} from "./canvas-api";
import { htmlToText, linkedFileIds } from "./html-text";

/**
 * Pulls one student's Canvas into the canvas_* tables (migration 00209) with
 * their access key: active courses, every assignment with the student's
 * submission, teacher comments and rubric scores, the modules (units), unit
 * pages linked from them, and announcements. Runs every two hours from the
 * cron sweep, and right after a parent connects a key.
 *
 * Each run upserts everything it sees and then drops this student's rows it
 * didn't see (a course they left, an assignment a teacher deleted).
 */

type FileRef = { id: number; name: string; content_type: string | null; size: number | null };

export type SyncResult = { ok: true; courses: number; assignments: number } | { ok: false; error: string };

export async function syncCanvasForStudent(db: SupabaseClient, studentId: string): Promise<SyncResult> {
  const { data: conn } = await db
    .from("canvas_connections")
    .select("base_url, token")
    .eq("student_id", studentId)
    .maybeSingle();
  if (!conn) return { ok: false, error: "No Canvas connection" };

  const startedAt = new Date().toISOString();
  try {
    const canvas = canvasClient(conn.base_url, conn.token);
    const me = await canvas.get<CanvasUser>("/users/self");
    if (!me) throw new Error("Canvas didn't say who this key belongs to.");

    const courses = await canvas.all<CanvasCourse>("/courses?enrollment_state=active&include[]=syllabus_body");
    const known = await knownFiles(db, studentId);
    let assignmentCount = 0;

    for (const course of courses) {
      const [assignments, submissions, modules, announcements] = await Promise.all([
        canvas.all<CanvasAssignment>(`/courses/${course.id}/assignments?order_by=due_at`),
        canvas.all<CanvasSubmission & { assignment_id: number }>(
          `/courses/${course.id}/students/submissions?student_ids[]=self&include[]=submission_comments&include[]=rubric_assessment`,
        ),
        canvas.all<CanvasModule>(`/courses/${course.id}/modules?include[]=items`),
        canvas.all<CanvasAnnouncement>(
          `/announcements?context_codes[]=course_${course.id}&start_date=${monthsAgo(4)}&end_date=${monthsAgo(-1)}`,
        ),
      ]);

      // Which unit each assignment sits in.
      const moduleOf = new Map<number, string>();
      for (const m of modules) {
        for (const item of m.items ?? []) {
          if (item.type === "Assignment" && item.content_id) moduleOf.set(item.content_id, m.name);
        }
      }
      const submissionOf = new Map(submissions.map((s) => [s.assignment_id, s]));

      const assignmentRows = [];
      for (const a of assignments) {
        const files: FileRef[] = [];
        for (const id of linkedFileIds(a.description)) {
          const file = known.get(id) ?? (await fileRef(canvas, course.id, id));
          if (file) {
            known.set(id, file);
            files.push(file);
          }
        }
        assignmentRows.push(assignmentRow(studentId, course.id, a, submissionOf.get(a.id), moduleOf.get(a.id), files));
      }
      assignmentCount += assignmentRows.length;

      const pageRows = [];
      for (const m of modules) {
        for (const item of m.items ?? []) {
          if (item.type !== "Page" || !item.url) continue;
          const page = await canvas.get<CanvasPage>(item.url.replace(/^.*\/api\/v1/, ""));
          if (!page) continue;
          pageRows.push({
            student_id: studentId,
            key: `page:${item.page_url ?? item.url}`,
            course_id: course.id,
            kind: "page",
            title: page.title,
            body: htmlToText(page.body).slice(0, 20000),
            module_name: m.name,
            module_position: m.position,
            posted_at: page.updated_at ?? null,
            synced_at: startedAt,
          });
        }
      }
      const announcementRows = announcements.map((n) => ({
        student_id: studentId,
        key: `announcement:${n.id}`,
        course_id: course.id,
        kind: "announcement",
        title: n.title,
        body: htmlToText(n.message).slice(0, 8000),
        module_name: null,
        module_position: null,
        posted_at: n.posted_at ?? null,
        synced_at: startedAt,
      }));

      await upsert(db, "canvas_courses", [
        {
          student_id: studentId,
          id: course.id,
          name: course.name,
          course_code: course.course_code ?? null,
          syllabus: htmlToText(course.syllabus_body).slice(0, 30000) || null,
          synced_at: startedAt,
        },
      ], "student_id,id");
      await upsert(db, "canvas_modules", modules.map((m) => ({
        student_id: studentId,
        id: m.id,
        course_id: course.id,
        name: m.name,
        position: m.position,
        item_count: m.items_count ?? m.items?.length ?? 0,
        synced_at: startedAt,
      })), "student_id,id");
      await upsert(db, "canvas_assignments", assignmentRows, "student_id,id");
      await upsert(db, "canvas_items", [...pageRows, ...announcementRows], "student_id,key");
    }

    // Anything this run didn't see is gone from Canvas.
    for (const table of ["canvas_courses", "canvas_modules", "canvas_assignments", "canvas_items"]) {
      await db.from(table).delete().eq("student_id", studentId).lt("synced_at", startedAt);
    }
    await db
      .from("canvas_connections")
      .update({ canvas_user_id: me.id, canvas_name: me.name, last_synced_at: new Date().toISOString(), last_error: null })
      .eq("student_id", studentId);
    return { ok: true, courses: courses.length, assignments: assignmentCount };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    await db
      .from("canvas_connections")
      .update({
        last_error: error,
        // A refused key has expired, whatever date was entered for it.
        ...(err instanceof CanvasAuthError ? { token_expires_at: new Date().toISOString() } : {}),
      })
      .eq("student_id", studentId);
    return { ok: false, error };
  }
}

/** Every connected student; the cron sweep. */
export async function syncAllCanvas(db: SupabaseClient) {
  const { data } = await db.from("canvas_connections").select("student_id");
  const results: Record<string, SyncResult> = {};
  for (const { student_id } of data ?? []) results[student_id] = await syncCanvasForStudent(db, student_id);
  return results;
}

function assignmentRow(
  studentId: string,
  courseId: number,
  a: CanvasAssignment,
  s: CanvasSubmission | undefined,
  moduleName: string | undefined,
  files: FileRef[],
) {
  const rubric = a.rubric?.map((c) => ({
    id: c.id,
    description: c.description ?? "",
    details: c.long_description || null,
    points: c.points ?? null,
    ratings: (c.ratings ?? []).map((r) => ({ description: r.description ?? "", points: r.points ?? null })),
  }));
  const rubricScores = s?.rubric_assessment
    ? Object.entries(s.rubric_assessment).map(([id, r]) => ({
        criterion: a.rubric?.find((c) => c.id === id)?.description ?? id,
        points: r.points ?? null,
        comments: r.comments || null,
      }))
    : null;
  return {
    student_id: studentId,
    id: a.id,
    course_id: courseId,
    name: a.name.trim(),
    description: htmlToText(a.description).slice(0, 12000) || null,
    due_at: a.due_at ?? null,
    unlock_at: a.unlock_at ?? null,
    lock_at: a.lock_at ?? null,
    points_possible: a.points_possible ?? null,
    submission_types: a.submission_types ?? [],
    is_quiz: Boolean(a.quiz_id || a.is_quiz_assignment || a.submission_types?.includes("online_quiz")),
    html_url: a.html_url ?? null,
    module_name: moduleName ?? null,
    rubric: rubric ?? null,
    files,
    workflow_state: s?.workflow_state ?? null,
    submitted_at: s?.submitted_at ?? null,
    graded_at: s?.graded_at ?? null,
    score: s?.score ?? null,
    grade: s?.grade ?? null,
    late: s?.late ?? false,
    missing: s?.missing ?? false,
    excused: s?.excused ?? false,
    answer: htmlToText(s?.body).slice(0, 12000) || null,
    answer_files: (s?.attachments ?? []).map((f) => ({
      id: f.id,
      name: f.display_name,
      content_type: f["content-type"] ?? null,
      size: f.size ?? null,
    })),
    comments: (s?.submission_comments ?? [])
      .filter((c) => c.comment)
      .map((c) => ({ author: c.author_name ?? null, comment: c.comment, created_at: c.created_at ?? null })),
    rubric_scores: rubricScores,
    synced_at: new Date().toISOString(),
  };
}

async function fileRef(canvas: CanvasClient, courseId: number, id: number): Promise<FileRef | null> {
  const f = await canvas.get<CanvasFile>(`/courses/${courseId}/files/${id}`);
  return f ? { id: f.id, name: f.display_name, content_type: f["content-type"] ?? null, size: f.size ?? null } : null;
}

/** Files already looked up on an earlier run, so each is fetched once. */
async function knownFiles(db: SupabaseClient, studentId: string): Promise<Map<number, FileRef>> {
  const { data } = await db.from("canvas_assignments").select("files").eq("student_id", studentId);
  const map = new Map<number, FileRef>();
  for (const row of data ?? []) for (const f of (row.files as FileRef[]) ?? []) map.set(f.id, f);
  return map;
}

async function upsert(db: SupabaseClient, table: string, rows: object[], onConflict: string) {
  if (rows.length === 0) return;
  const { error } = await db.from(table).upsert(rows, { onConflict });
  if (error) throw new Error(`${table}: ${error.message}`);
}

function monthsAgo(n: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d.toISOString().slice(0, 10);
}
