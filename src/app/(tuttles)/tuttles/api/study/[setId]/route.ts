import { NextResponse } from "next/server";
import { tuttlesCaller } from "@/lib/tuttles/context";
import { changeIseeLevel, getSet, setSources, setSummaries } from "@/lib/tuttles/study-db";

export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One study set's page: its topics and levels, what the test is like, what
 * it's built from, and the quizzes taken on it.
 *
 *   GET                                                 → { set, format, material, sources, quizzes }
 *   PATCH { title?, testDate?, removeTopicId?, archived?, iseeLevel? } → { set }
 *
 * `testDate: null` makes it open-ended. `iseeLevel` ("lower", "middle",
 * "upper") moves an ISEE set to that level's outline and topics.
 */
export async function GET(request: Request, { params }: { params: Promise<{ setId: string }> }) {
  const caller = await tuttlesCaller(request);
  if ("error" in caller) return NextResponse.json({ error: caller.error }, { status: caller.status });
  const { db, student } = caller;
  const { setId } = await params;
  if (!UUID.test(setId)) return NextResponse.json({ error: "bad set" }, { status: 400 });
  const set = await getSet(db, setId, student.studentId);
  if (!set) return NextResponse.json({ error: "not found" }, { status: 404 });

  const [summaries, archived, sources, { data: quizzes }] = await Promise.all([
    setSummaries(db, student.studentId),
    set.archived_at ? setSummaries(db, student.studentId, { archived: true }) : Promise.resolve([]),
    setSources(db, setId),
    db
      .from("tutor_threads")
      .select("id, title, created_at, quiz, student_id")
      .eq("study_set_id", setId)
      .eq("kind", "quiz")
      .order("created_at", { ascending: false })
      .limit(30),
  ]);
  const summary = [...summaries, ...archived].find((s) => s.id === setId) ?? null;
  const { data: answers } = quizzes?.length
    ? await db
        .from("tutor_quiz_questions")
        .select("thread_id, result")
        .in("thread_id", quizzes.map((q) => q.id))
        .not("result", "is", null)
    : { data: [] as { thread_id: string; result: string }[] };

  return NextResponse.json(
    {
      set: summary,
      format: set.format,
      sources: sources.map((s) => ({ id: s.id, kind: s.kind, body: s.body, imagePath: s.image_path, createdAt: s.created_at })),
      quizzes: (quizzes ?? []).map((q) => {
        const mine = (answers ?? []).filter((a) => a.thread_id === q.id);
        const quiz = q.quiz as { mode?: string; count?: number; finishedAt?: string | null } | null;
        return {
          threadId: q.id,
          createdAt: q.created_at,
          mode: quiz?.mode ?? "practice",
          count: quiz?.count ?? 0,
          finished: Boolean(quiz?.finishedAt),
          right: mine.filter((a) => a.result === "correct").length,
          answered: mine.length,
          // A parent's tries as the kid show, but marked.
          byParent: q.student_id !== student.studentId,
        };
      }),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function PATCH(request: Request, { params }: { params: Promise<{ setId: string }> }) {
  const caller = await tuttlesCaller(request);
  if ("error" in caller) return NextResponse.json({ error: caller.error }, { status: caller.status });
  const { db, student } = caller;
  const { setId } = await params;
  if (!UUID.test(setId)) return NextResponse.json({ error: "bad set" }, { status: 400 });
  const set = await getSet(db, setId, student.studentId);
  if (!set) return NextResponse.json({ error: "not found" }, { status: 404 });
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  const change: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof body.title === "string" && body.title.trim()) change.title = body.title.trim().slice(0, 120);
  if (body.testDate === null) change.test_date = null;
  else if (typeof body.testDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.testDate)) {
    change.test_date = body.testDate;
    // A new date brings a put-away set back.
    change.archived_at = null;
  }
  if (typeof body.archived === "boolean") change.archived_at = body.archived ? new Date().toISOString() : null;
  const { error } = await db.from("tutor_study_sets").update(change).eq("id", setId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (typeof body.iseeLevel === "string" && ["lower", "middle", "upper"].includes(body.iseeLevel)) {
    try {
      await changeIseeLevel(db, set, body.iseeLevel as "lower" | "middle" | "upper");
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't change the level." }, { status: 500 });
    }
  }
  if (typeof body.removeTopicId === "string" && UUID.test(body.removeTopicId)) {
    await db
      .from("tutor_study_topics")
      .update({ removed_at: new Date().toISOString() })
      .eq("id", body.removeTopicId)
      .eq("set_id", setId);
  }
  const all = [
    ...(await setSummaries(db, student.studentId)),
    ...(await setSummaries(db, student.studentId, { archived: true })),
  ];
  return NextResponse.json({ set: all.find((s) => s.id === setId) ?? null });
}
