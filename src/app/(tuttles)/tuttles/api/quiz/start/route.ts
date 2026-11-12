import { NextResponse } from "next/server";
import { tuttlesCaller } from "@/lib/tuttles/context";
import { getSet, quizState, startQuiz } from "@/lib/tuttles/study-db";

export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Starts a quiz on a study set: a new chat of its own kind, with the topics
 * for each question planned now (src/lib/tuttles/study.ts, planQuiz). The
 * phone then sends the first message (or calls) like any chat.
 *
 *   POST { threadId, setId, mode: "practice" | "test", count }   → QuizState
 */
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
  const threadId = typeof body.threadId === "string" ? body.threadId.toLowerCase() : "";
  const setId = typeof body.setId === "string" ? body.setId.toLowerCase() : "";
  if (!UUID.test(threadId) || !UUID.test(setId)) return NextResponse.json({ error: "bad ids" }, { status: 400 });
  const set = await getSet(db, setId, student.studentId);
  if (!set) return NextResponse.json({ error: "not found" }, { status: 404 });
  const { data: existing } = await db.from("tutor_threads").select("id").eq("id", threadId).maybeSingle();
  if (existing) return NextResponse.json({ error: "that chat already exists" }, { status: 409 });

  try {
    const quiz = await startQuiz(db, {
      threadId,
      ownerId: student.ownerId,
      set,
      mode: body.mode === "test" ? "test" : "practice",
      count: typeof body.count === "number" ? body.count : 10,
    });
    return NextResponse.json(await quizState(db, threadId, set, quiz));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't start the quiz." }, { status: 500 });
  }
}
