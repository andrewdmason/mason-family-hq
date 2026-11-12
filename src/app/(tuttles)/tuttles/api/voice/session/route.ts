import { NextResponse } from "next/server";
import OpenAI from "openai";
import { studentSections, tuttlesCaller } from "@/lib/tuttles/context";
import { memoryContext } from "@/lib/tuttles/memory";
import { briefingInstructions, tutorInstructions, type Briefing } from "@/lib/tuttles/prompt";
import { questions, quizThread, setSummaries, topicStates } from "@/lib/tuttles/study-db";
import {
  ASK_QUESTION_TOOL,
  quizInstructions,
  RECORD_ANSWER_TOOL,
  SAVE_STUDY_SET_TOOL,
  studySetsContext,
} from "@/lib/tuttles/study-prompt";
import {
  SHOW_VISUAL_TOOL,
  TRANSCRIBE_LANGUAGE,
  TRANSCRIBE_PROMPT,
  VOICE,
  VOICE_MODEL,
  VOICE_TRANSCRIBE_MODEL,
  voiceInstructions,
} from "@/lib/tuttles/voice";

export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Starts a voice call in a chat (src/lib/tuttles/voice.ts).
 *
 *   POST { threadId, assignmentId? }   Authorization: Bearer <supabase access token>
 *   → { key, model, expiresAt }
 *
 * `key` is a short-lived OpenAI key for one realtime session, already set up
 * with the tutor's instructions, voice and tools; the phone connects with it.
 *
 * In a quiz chat the tutor quizzes out loud, with ask_question to put each
 * question on the screen and record_answer for what's said (the phone relays
 * both to /tuttles/api/quiz). Elsewhere it can save a study set
 * (save_study_set → /tuttles/api/study/save).
 */
export async function POST(request: Request) {
  const caller = await tuttlesCaller(request);
  if ("error" in caller) return NextResponse.json({ error: caller.error }, { status: caller.status });
  const { db, userId, student } = caller;

  let body: { threadId?: unknown; assignmentId?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const threadId = typeof body.threadId === "string" ? body.threadId.toLowerCase() : "";
  if (!UUID.test(threadId)) return NextResponse.json({ error: "bad threadId" }, { status: 400 });

  const { data: thread } = await db
    .from("tutor_threads")
    .select("student_id, assignment_id, kind, topic, study_set_id")
    .eq("id", threadId)
    .maybeSingle();
  if (thread && thread.student_id !== userId) return NextResponse.json({ error: "not your thread" }, { status: 403 });
  const assignmentId =
    thread?.assignment_id ?? (typeof body.assignmentId === "number" ? body.assignmentId : null);

  const { data: messages } = thread
    ? await db.from("tutor_messages").select("role, content").eq("thread_id", threadId).order("created_at")
    : { data: [] };
  // A parent's briefing chat stays a briefing on the phone call too.
  const briefing = thread?.kind === "briefing" ? (thread.topic as Briefing) : null;
  const parent = briefing
    ? ((await db.from("family_members").select("name").eq("user_id", userId).maybeSingle()).data?.name ?? "the parent")
    : null;
  const chatSoFar = (messages ?? []) as { role: "student" | "tutor"; content: string }[];
  const quiz = thread?.kind === "quiz" ? await quizThread(db, threadId, userId, student.studentId) : null;
  let instructions: string;
  let tools;
  if (quiz) {
    const [asked, states, memory, { data: course }] = await Promise.all([
      questions(db, threadId),
      topicStates(db, [quiz.set.id]),
      memoryContext(db, student.studentId, student.name).catch(() => null),
      quiz.set.course_id
        ? db.from("canvas_courses").select("name").eq("id", quiz.set.course_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    const sections = [
      quizInstructions({
        name: student.name,
        set: quiz.set,
        className: course?.name ?? null,
        quiz: quiz.quiz,
        topics: states.get(quiz.set.id) ?? [],
        asked,
        voice: true,
      }),
      ...(memory ? [memory] : []),
    ];
    instructions = voiceInstructions(student, sections, chatSoFar, tutorInstructions(student));
    tools = [SHOW_VISUAL_TOOL, ASK_QUESTION_TOOL, RECORD_ANSWER_TOOL];
  } else {
    const sections = await studentSections(db, student, briefing ? (briefing.assignmentIds[0] ?? null) : assignmentId);
    if (!briefing) {
      const [sets, { data: courses }] = await Promise.all([
        setSummaries(db, student.studentId).catch(() => []),
        db.from("canvas_courses").select("id, name").eq("student_id", student.studentId),
      ]);
      const className = (id: number | null) => (id == null ? null : (courses?.find((c) => c.id === id)?.name ?? null));
      sections.push(studySetsContext(student.name, sets, className, true));
    }
    instructions = voiceInstructions(
      student,
      sections,
      chatSoFar,
      briefing && parent ? briefingInstructions(parent, student, briefing) : undefined,
      parent ?? undefined,
    );
    tools = briefing ? [SHOW_VISUAL_TOOL] : [SHOW_VISUAL_TOOL, SAVE_STUDY_SET_TOOL];
  }

  if (!process.env.OPENAI_API_KEY) return NextResponse.json({ error: "OPENAI_API_KEY is not set" }, { status: 500 });
  try {
    const secret = await new OpenAI({ apiKey: process.env.OPENAI_API_KEY }).realtime.clientSecrets.create({
      expires_after: { anchor: "created_at", seconds: 600 },
      session: {
        type: "realtime",
        model: VOICE_MODEL,
        instructions,
        output_modalities: ["audio"],
        audio: {
          input: {
            format: { type: "audio/pcm", rate: 24000 },
            transcription: { model: VOICE_TRANSCRIBE_MODEL, language: TRANSCRIBE_LANGUAGE, prompt: TRANSCRIBE_PROMPT },
            // Push to talk: the phone commits each turn when the button is let go.
            turn_detection: null,
          },
          output: { format: { type: "audio/pcm", rate: 24000 }, voice: VOICE },
        },
        tools,
      },
    });
    return NextResponse.json({ key: secret.value, model: VOICE_MODEL, expiresAt: secret.expires_at });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't start the call." }, { status: 502 });
  }
}
