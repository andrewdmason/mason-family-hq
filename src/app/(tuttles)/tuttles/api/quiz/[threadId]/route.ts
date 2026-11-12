import { NextResponse } from "next/server";
import { tuttlesCaller } from "@/lib/tuttles/context";
import { finishQuiz, quizState, quizThread } from "@/lib/tuttles/study-db";

export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A quiz chat's questions and how they went, for drawing its cards (answers
 * only once earned) and, when it's over, the recap.
 *
 *   GET                       → QuizState
 *   POST { finish: true }     → QuizState   (ends it early; unanswered questions don't count)
 */
export async function GET(request: Request, { params }: { params: Promise<{ threadId: string }> }) {
  const caller = await tuttlesCaller(request);
  if ("error" in caller) return NextResponse.json({ error: caller.error }, { status: caller.status });
  const { db, student } = caller;
  const { threadId } = await params;
  if (!UUID.test(threadId)) return NextResponse.json({ error: "bad thread" }, { status: 400 });
  const found = await quizThread(db, threadId.toLowerCase(), student.ownerId, student.studentId);
  if (!found) return NextResponse.json({ error: "not a quiz" }, { status: 404 });
  return NextResponse.json(await quizState(db, threadId.toLowerCase(), found.set, found.quiz), {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ threadId: string }> }) {
  const caller = await tuttlesCaller(request);
  if ("error" in caller) return NextResponse.json({ error: caller.error }, { status: caller.status });
  const { db, student } = caller;
  const { threadId: raw } = await params;
  if (!UUID.test(raw)) return NextResponse.json({ error: "bad thread" }, { status: 400 });
  const threadId = raw.toLowerCase();
  const found = await quizThread(db, threadId, student.ownerId, student.studentId);
  if (!found) return NextResponse.json({ error: "not a quiz" }, { status: 404 });
  let quiz = found.quiz;
  if (!quiz.finishedAt) {
    await finishQuiz(db, threadId, quiz);
    quiz = { ...quiz, finishedAt: new Date().toISOString() };
  }
  return NextResponse.json(await quizState(db, threadId, found.set, quiz));
}
