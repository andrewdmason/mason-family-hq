import type { SupabaseClient } from "@supabase/supabase-js";
import { memoryContext } from "@/lib/tuttles/memory";
import { parseGrade, parseQuestion, parseSetDraft } from "@/lib/tuttles/study";
import {
  addSources,
  openQuestion,
  questionBlock,
  questions,
  quizThread,
  recordAnswer,
  recordQuestion,
  saveSet,
  setSummaries,
  topicStates,
  type QuizSettings,
  type SetRow,
} from "@/lib/tuttles/study-db";
import { quizInstructions, studySetsContext } from "@/lib/tuttles/study-prompt";
import type { TutoredStudent } from "@/lib/tuttles/tutoring-as";

/**
 * Study sets and quizzes inside a typed chat turn (the chat route).
 *
 * `instructions` are what the tutor is told beyond its rules; `langs` are the
 * fenced blocks the route lifts out of the reply (src/lib/tuttles/fences.ts)
 * and `handle` acts on each: saves a set, a question, or a grade, and returns
 * what the student sees in its place.
 */
export type StudyTurn = {
  instructions: string[];
  langs: Set<string>;
  handle: (lang: string, body: string) => Promise<string>;
  /** A set made or changed in this turn, for the thread to point at. */
  linkedSetId: () => string | null;
  isQuiz: boolean;
};

export async function studyTurn(
  db: SupabaseClient,
  args: {
    student: TutoredStudent;
    userId: string;
    threadId: string;
    thread: { kind: string | null; study_set_id: string | null } | null;
    /** Every photo in the thread, this turn's included. */
    images: string[];
    assignmentId: number | null;
  },
): Promise<StudyTurn> {
  const { student, threadId } = args;
  const quiz = args.thread?.kind === "quiz" ? await quizThread(db, threadId, student.ownerId, student.studentId) : null;
  if (quiz) return quizTurn(db, student, threadId, quiz.set, quiz.quiz);

  const [sets, { data: courses }] = await Promise.all([
    setSummaries(db, student.studentId).catch(() => []),
    db.from("canvas_courses").select("id, name").eq("student_id", student.studentId),
  ]);
  const className = (id: number | null) => (id == null ? null : (courses?.find((c) => c.id === id)?.name ?? null));
  let linked: string | null = args.thread?.study_set_id ?? null;

  return {
    isQuiz: false,
    instructions: [studySetsContext(student.name, sets, className)],
    langs: new Set(["studyset"]),
    linkedSetId: () => linked,
    async handle(_lang, body) {
      const set = await saveTutorSet(db, {
        student,
        userId: args.userId,
        threadId,
        linkedId: linked,
        knownIds: sets.map((s) => s.id),
        images: args.images,
        assignmentId: args.assignmentId,
        body,
      });
      if (!set) return "";
      linked = set.id;
      return "```studyset\n" + JSON.stringify({ id: set.id, title: set.title }) + "\n```\n";
    },
  };
}

/**
 * Saves a set the tutor wrote (a ```studyset block, or the voice tool), with
 * the chat's photos and assignment as its sources. Null if it couldn't be read.
 */
export async function saveTutorSet(
  db: SupabaseClient,
  args: {
    student: TutoredStudent;
    userId: string;
    threadId: string;
    /** The set this chat is already about, if any. */
    linkedId: string | null;
    /** The student's sets the tutor was told about, the only ids it may name. */
    knownIds: string[];
    images: string[];
    assignmentId: number | null;
    body: string;
  },
): Promise<SetRow | null> {
  const draft = parseSetDraft(args.body);
  if (!draft) return null;
  let raw: Record<string, unknown> = {};
  try {
    raw = JSON.parse(args.body);
  } catch {}
  const askedId = typeof raw.id === "string" && args.knownIds.includes(raw.id) ? raw.id : null;
  try {
    const target = askedId ?? args.linkedId;
    const set = await saveSet(db, {
      student: args.student,
      by: args.userId,
      setId: target,
      draft,
      assignmentId: target ? null : args.assignmentId,
    });
    await addSources(db, set.id, args.userId, [
      ...args.images.map((p) => ({ kind: "photo" as const, imagePath: p, threadId: args.threadId, body: "Photo from a chat" })),
      ...(args.assignmentId
        ? [{ kind: "canvas" as const, assignmentId: args.assignmentId, threadId: args.threadId, body: "Canvas assignment" }]
        : []),
    ]);
    return set;
  } catch {
    return null;
  }
}

async function quizTurn(
  db: SupabaseClient,
  student: TutoredStudent,
  threadId: string,
  set: SetRow,
  quiz: QuizSettings,
): Promise<StudyTurn> {
  const [asked, states, memory, { data: course }] = await Promise.all([
    questions(db, threadId),
    topicStates(db, [set.id]),
    memoryContext(db, student.studentId, student.name).catch(() => null),
    set.course_id
      ? db.from("canvas_courses").select("name").eq("id", set.course_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const topics = states.get(set.id) ?? [];
  let settings = quiz;
  return {
    isQuiz: true,
    instructions: [
      quizInstructions({ name: student.name, set, className: course?.name ?? null, quiz, topics, asked, voice: false }),
      ...(memory ? [memory] : []),
    ],
    langs: new Set(["question", "grade"]),
    linkedSetId: () => set.id,
    async handle(lang, body) {
      try {
        if (lang === "grade") {
          const grade = parseGrade(body);
          const open = openQuestion(await questions(db, threadId));
          if (grade && open) {
            const { finished } = await recordAnswer(db, {
              question: open,
              quiz: settings,
              choice: grade.choice,
              result: grade.result,
              response: grade.response,
            });
            if (finished) settings = { ...settings, finishedAt: new Date().toISOString() };
          }
          return "";
        }
        const draft = parseQuestion(body);
        if (!draft || settings.finishedAt) return "";
        const q = await recordQuestion(db, { threadId, setId: set.id, draft, counts: !student.preview });
        const topic = topics.find((t) => t.id === q.topic_id)?.name ?? null;
        return questionBlock(q, settings.count, topic);
      } catch {
        return "";
      }
    },
  };
}
