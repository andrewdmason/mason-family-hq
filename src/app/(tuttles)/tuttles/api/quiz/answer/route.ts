import { NextResponse } from "next/server";
import { tuttlesCaller } from "@/lib/tuttles/context";
import { letter, type Result } from "@/lib/tuttles/study";
import { openQuestion, questions, quizState, quizThread, recordAnswer } from "@/lib/tuttles/study-db";

export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RESULTS: Result[] = ["correct", "hinted", "wrong", "skipped"];

/**
 * An answer to a quiz question: a tap on a multiple choice card (typed chat
 * or a call), or the voice tutor's record_answer. Multiple choice is graded
 * here against the stored answer.
 *
 *   POST { threadId, questionId?, choice?, result?, response? }
 *   → { state, note }
 *
 * `questionId` defaults to the open question. `note` is the line for the
 * voice tutor ("Tapped B (ribosome): correct.", "Recorded.").
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

  const list = await questions(db, threadId);
  const asked = typeof body.questionId === "string" ? body.questionId.toLowerCase() : null;
  const question = asked ? list.find((q) => q.id === asked) : openQuestion(list);
  if (!question) return NextResponse.json({ error: "no open question" }, { status: 409 });
  const choice = typeof body.choice === "number" || typeof body.choice === "string" ? body.choice : null;
  const result = RESULTS.includes(body.result as Result) ? (body.result as Result) : null;
  const response = typeof body.response === "string" ? body.response.slice(0, 1000) : null;

  const { question: saved, finished } = await recordAnswer(db, { question, quiz: found.quiz, choice, result, response });
  const quiz = finished ? { ...found.quiz, finishedAt: found.quiz.finishedAt ?? new Date().toISOString() } : found.quiz;
  const state = await quizState(db, threadId, found.set, quiz);

  let note: string;
  if (!saved.result) note = "Couldn't tell which option that was. Ask them to say the letter.";
  else {
    const picked = saved.chosen_index != null && saved.choices ? `${letter(saved.chosen_index)} (${saved.choices[saved.chosen_index]})` : null;
    const right = saved.choices && saved.answer_index != null ? `${letter(saved.answer_index)} (${saved.choices[saved.answer_index]})` : saved.answer;
    note = `${picked ? `Answered ${picked}` : "Recorded"}: ${saved.result}${saved.result === "correct" ? "" : `. The right answer is ${right}`}.`;
    if (found.quiz.mode === "test") note += " (Test run: don't tell them yet.)";
    if (finished) note += ` That was the last question; the quiz is over, so wrap up as instructed.`;
  }
  return NextResponse.json({ state, note });
}
