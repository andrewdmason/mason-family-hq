import { NextResponse } from "next/server";
import { tuttlesCaller } from "@/lib/tuttles/context";
import { parseQuestion } from "@/lib/tuttles/study";
import { questionBlock, quizState, quizThread, recordQuestion } from "@/lib/tuttles/study-db";

export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A question the voice tutor asked (its ask_question tool, relayed by the
 * phone): saved with its answer, and handed back without it for the screen.
 *
 *   POST { threadId, question: <the tool's arguments> }
 *   → { question: PublicQuestion, block, state }
 *
 * `block` is the question as it goes into the saved chat when the call ends.
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
  if (!UUID.test(threadId)) return NextResponse.json({ error: "bad thread" }, { status: 400 });
  const found = await quizThread(db, threadId, student.ownerId, student.studentId);
  if (!found) return NextResponse.json({ error: "not a quiz" }, { status: 404 });
  if (found.quiz.finishedAt) return NextResponse.json({ error: "The quiz is over." }, { status: 409 });
  const draft = parseQuestion(body.question);
  if (!draft) return NextResponse.json({ error: "That question couldn't be read (multiple choice needs its answer)." }, { status: 400 });

  const q = await recordQuestion(db, { threadId, setId: found.set.id, draft, counts: !student.preview });
  const state = await quizState(db, threadId, found.set, found.quiz);
  const card = state.questions.find((x) => x.id === q.id)!;
  return NextResponse.json({ question: card, block: questionBlock(q, found.quiz.count, card.topic), state });
}
