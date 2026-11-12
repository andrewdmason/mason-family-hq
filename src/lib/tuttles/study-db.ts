import type { SupabaseClient } from "@supabase/supabase-js";
import { gradeFor } from "@/lib/tuttles/prompt";
import type { TutoredStudent } from "@/lib/tuttles/tutoring-as";
import {
  choiceIndex,
  daysUntil,
  DEFAULT_LENGTH,
  iseeForGrade,
  matchTopic,
  overallFor,
  planQuiz,
  QUIZ_LENGTHS,
  TEMPLATES,
  topicProgress,
  type Level,
  type Outcome,
  type Overall,
  type QuestionDraft,
  type Result,
  type SetDraft,
  type Slot,
  type TopicState,
} from "@/lib/tuttles/study";

/**
 * Study sets and quizzes in the database (supabase/migrations/00214). The
 * rules themselves are in study.ts; this reads and writes, always with the
 * service role, for the Tuttles routes.
 */

export type SetRow = {
  id: string;
  student_id: string;
  title: string;
  course_id: number | null;
  assignment_id: number | null;
  test_date: string | null;
  template: string | null;
  format: string | null;
  material: string;
  coverage: "thin" | "okay" | "good";
  coverage_note: string | null;
  created_by_parent: boolean;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

type TopicRow = { id: string; set_id: string; name: string; weight: number; position: number; removed_at: string | null };

export type QuestionRow = {
  id: string;
  thread_id: string;
  set_id: string;
  topic_id: string | null;
  number: number;
  kind: QuestionDraft["kind"];
  prompt: string;
  choices: string[] | null;
  answer_index: number | null;
  answer: string;
  explanation: string | null;
  result: Result | null;
  chosen_index: number | null;
  response: string | null;
  counts: boolean;
  created_at: string;
  answered_at: string | null;
};

export type QuizSettings = { mode: "practice" | "test"; count: number; plan: Slot[]; finishedAt?: string | null };

const SET_COLUMNS =
  "id, student_id, title, course_id, assignment_id, test_date, template, format, material, coverage, coverage_note, created_by_parent, archived_at, created_at, updated_at";

/** Sets that are done with: a test more than two days past. */
const ARCHIVE_AFTER_DAYS = 2;

// --- Reading ---------------------------------------------------------------------

export async function getSet(db: SupabaseClient, setId: string, studentId: string): Promise<SetRow | null> {
  const { data } = await db.from("tutor_study_sets").select(SET_COLUMNS).eq("id", setId).maybeSingle();
  return data && data.student_id === studentId ? (data as SetRow) : null;
}

/** Each live topic of these sets, with its level from every counted answer. */
export async function topicStates(
  db: SupabaseClient,
  setIds: string[],
  opts: { exceptThread?: string } = {},
): Promise<Map<string, TopicState[]>> {
  const out = new Map<string, TopicState[]>(setIds.map((id) => [id, []]));
  if (!setIds.length) return out;
  const [{ data: topics }, { data: answers }] = await Promise.all([
    db
      .from("tutor_study_topics")
      .select("id, set_id, name, weight, position, removed_at")
      .in("set_id", setIds)
      .is("removed_at", null)
      .order("position"),
    db
      .from("tutor_quiz_questions")
      .select("topic_id, thread_id, result, answered_at")
      .in("set_id", setIds)
      .eq("counts", true)
      .not("result", "is", null)
      .not("topic_id", "is", null),
  ]);
  const byTopic = new Map<string, Outcome[]>();
  for (const a of answers ?? []) {
    if (opts.exceptThread && a.thread_id === opts.exceptThread) continue;
    const list = byTopic.get(a.topic_id) ?? [];
    list.push({ result: a.result as Result, at: new Date(a.answered_at), quiz: a.thread_id });
    byTopic.set(a.topic_id, list);
  }
  for (const t of (topics ?? []) as TopicRow[]) {
    out.get(t.set_id)!.push({ id: t.id, name: t.name, weight: t.weight, ...topicProgress(byTopic.get(t.id) ?? []) });
  }
  return out;
}

export type SetSummary = {
  id: string;
  title: string;
  courseId: number | null;
  testDate: string | null;
  daysLeft: number | null;
  coverage: SetRow["coverage"];
  coverageNote: string | null;
  createdByParent: boolean;
  overall: Overall;
  topics: { id: string; name: string; weight: number; level: Level; asked: number; right: number; lastSeen: string | null }[];
  quizzes: number;
  lastQuizAt: string | null;
};

/** The kid's sets, most pressing first: the soonest test, then the most recently worked on. */
export async function setSummaries(
  db: SupabaseClient,
  studentId: string,
  opts: { archived?: boolean; now?: Date } = {},
): Promise<SetSummary[]> {
  const now = opts.now ?? new Date();
  await archiveFinished(db, studentId, now);
  let q = db.from("tutor_study_sets").select(SET_COLUMNS).eq("student_id", studentId);
  q = opts.archived ? q.not("archived_at", "is", null) : q.is("archived_at", null);
  const { data: sets } = await q.order("updated_at", { ascending: false }).limit(50);
  const rows = (sets ?? []) as SetRow[];
  const ids = rows.map((s) => s.id);
  const [states, { data: quizzes }] = await Promise.all([
    topicStates(db, ids),
    ids.length
      ? db.from("tutor_threads").select("study_set_id, created_at").in("study_set_id", ids).eq("kind", "quiz")
      : Promise.resolve({ data: [] as { study_set_id: string; created_at: string }[] }),
  ]);
  const summaries = rows.map((s): SetSummary => {
    const topics = states.get(s.id) ?? [];
    const mine = (quizzes ?? []).filter((t) => t.study_set_id === s.id);
    return {
      id: s.id,
      title: s.title,
      courseId: s.course_id,
      testDate: s.test_date,
      daysLeft: daysUntil(s.test_date, now),
      coverage: s.coverage,
      coverageNote: s.coverage_note,
      createdByParent: s.created_by_parent,
      overall: overallFor(topics, s.test_date, now),
      topics: topics.map((t) => ({
        id: t.id,
        name: t.name,
        weight: t.weight,
        level: t.level,
        asked: t.asked,
        right: t.right,
        lastSeen: t.lastSeen?.toISOString() ?? null,
      })),
      quizzes: mine.length,
      lastQuizAt: mine.map((t) => t.created_at).sort().at(-1) ?? null,
    };
  });
  const urgency = (s: SetSummary) => (s.daysLeft != null && s.daysLeft >= 0 ? s.daysLeft : 1000);
  return summaries.sort((a, b) => urgency(a) - urgency(b));
}

/** Puts away sets whose test was more than a couple of days ago. */
async function archiveFinished(db: SupabaseClient, studentId: string, now: Date) {
  const cutoff = new Date(now.getTime() - ARCHIVE_AFTER_DAYS * 864e5).toLocaleDateString("en-CA", {
    timeZone: "America/Los_Angeles",
  });
  await db
    .from("tutor_study_sets")
    .update({ archived_at: now.toISOString() })
    .eq("student_id", studentId)
    .is("archived_at", null)
    .lt("test_date", cutoff);
}

export async function setSources(db: SupabaseClient, setId: string) {
  const { data } = await db
    .from("tutor_study_sources")
    .select("id, kind, body, image_path, assignment_id, thread_id, created_at")
    .eq("set_id", setId)
    .order("created_at");
  return (data ?? []) as {
    id: string;
    kind: "photo" | "note" | "canvas";
    body: string;
    image_path: string | null;
    assignment_id: number | null;
    thread_id: string | null;
    created_at: string;
  }[];
}

// --- Writing a set -------------------------------------------------------------------

/**
 * Makes a set from the tutor's draft, or updates one. A draft's topic list,
 * when it has one, is the whole list: topics it leaves out are taken off
 * (their answers stay), new ones are added, and kept ones take its order and
 * weights. A template (an ISEE level) brings its own topics, format and notes.
 */
export async function saveSet(
  db: SupabaseClient,
  args: {
    student: TutoredStudent;
    by: string;
    setId: string | null;
    draft: SetDraft;
    assignmentId?: number | null;
    courseId?: number | null;
  },
): Promise<SetRow> {
  const { student, draft } = args;
  // Plain "isee": the level for the grade they're going into.
  const templateId = draft.template === "isee" ? iseeForGrade(gradeFor(student.birthdate)) : draft.template;
  const template = templateId ? (TEMPLATES[templateId] ?? null) : null;
  let courseId = args.courseId ?? null;
  if (draft.className && courseId == null) {
    const { data: courses } = await db.from("canvas_courses").select("id, name").eq("student_id", student.studentId);
    courseId = matchTopic(draft.className, courses ?? [])?.id ?? null;
  }

  const existing = args.setId ? await getSet(db, args.setId, student.studentId) : null;
  const now = new Date().toISOString();
  const fields: Record<string, unknown> = { updated_at: now };
  if (draft.title ?? (!existing ? template?.title : null)) fields.title = draft.title ?? template?.title;
  if (courseId != null) fields.course_id = courseId;
  if (args.assignmentId != null) fields.assignment_id = args.assignmentId;
  if (draft.testDate) fields.test_date = draft.testDate;
  if (template && !existing) fields.template = template.id;
  if (draft.format ?? (!existing ? template?.format : null)) fields.format = draft.format ?? template?.format;
  if (draft.material) {
    fields.material = template && !existing ? `${template.material}\n\n${draft.material}` : draft.material;
  } else if (template && !existing) {
    fields.material = template.material;
  }
  if (draft.coverage) fields.coverage = draft.coverage;
  if (draft.coverageNote !== null) fields.coverage_note = draft.coverageNote;
  if (template && !existing && !draft.coverage) fields.coverage = "okay";

  let set: SetRow;
  if (existing) {
    const { data, error } = await db.from("tutor_study_sets").update(fields).eq("id", existing.id).select(SET_COLUMNS).single();
    if (error) throw new Error(error.message);
    set = data as SetRow;
  } else {
    const { data, error } = await db
      .from("tutor_study_sets")
      .insert({
        title: "Study set",
        ...fields,
        student_id: student.studentId,
        created_by: args.by,
        created_by_parent: student.preview,
      })
      .select(SET_COLUMNS)
      .single();
    if (error) throw new Error(error.message);
    set = data as SetRow;
  }

  const topics = draft.topics ?? (template && !existing ? template.topics : null);
  if (topics) await replaceTopics(db, set.id, topics);
  return set;
}

async function replaceTopics(db: SupabaseClient, setId: string, topics: { name: string; weight: number }[]) {
  const { data: current } = await db.from("tutor_study_topics").select("id, name, removed_at").eq("set_id", setId);
  const rows = (current ?? []) as { id: string; name: string; removed_at: string | null }[];
  const kept = new Set<string>();
  for (const [position, t] of topics.entries()) {
    const same = rows.find((r) => r.name.toLowerCase() === t.name.toLowerCase());
    if (same) {
      kept.add(same.id);
      await db.from("tutor_study_topics").update({ weight: t.weight, position, removed_at: null }).eq("id", same.id);
    } else {
      await db.from("tutor_study_topics").insert({ set_id: setId, name: t.name, weight: t.weight, position });
    }
  }
  const gone = rows.filter((r) => !kept.has(r.id) && !r.removed_at).map((r) => r.id);
  if (gone.length) await db.from("tutor_study_topics").update({ removed_at: new Date().toISOString() }).in("id", gone);
}

/** Photos and notes that came with a set, so the set's page can show what it's built from. */
export async function addSources(
  db: SupabaseClient,
  setId: string,
  by: string,
  sources: { kind: "photo" | "note" | "canvas"; body?: string; imagePath?: string; assignmentId?: number; threadId?: string }[],
) {
  if (!sources.length) return;
  const { data: have } = await db.from("tutor_study_sources").select("image_path, assignment_id").eq("set_id", setId);
  const fresh = sources.filter(
    (s) =>
      !(s.imagePath && have?.some((h) => h.image_path === s.imagePath)) &&
      !(s.kind === "canvas" && have?.some((h) => h.assignment_id === s.assignmentId)),
  );
  if (!fresh.length) return;
  await db.from("tutor_study_sources").insert(
    fresh.map((s) => ({
      set_id: setId,
      kind: s.kind,
      body: s.body ?? "",
      image_path: s.imagePath ?? null,
      assignment_id: s.assignmentId ?? null,
      thread_id: s.threadId ?? null,
      created_by: by,
    })),
  );
}

// --- Quizzes ---------------------------------------------------------------------------

/** A new quiz chat on a set, with its plan of topics worked out now. */
export async function startQuiz(
  db: SupabaseClient,
  args: { threadId: string; ownerId: string; set: SetRow; mode: "practice" | "test"; count: number },
): Promise<QuizSettings> {
  const count = (QUIZ_LENGTHS as readonly number[]).includes(args.count) ? args.count : DEFAULT_LENGTH;
  const topics = (await topicStates(db, [args.set.id])).get(args.set.id) ?? [];
  const plan = planQuiz(topics, count, args.set.test_date);
  const quiz: QuizSettings = { mode: args.mode, count, plan, finishedAt: null };
  const now = new Date().toISOString();
  const { error } = await db.from("tutor_threads").insert({
    id: args.threadId,
    student_id: args.ownerId,
    kind: "quiz",
    study_set_id: args.set.id,
    course_id: args.set.course_id,
    quiz,
    title: `${args.mode === "test" ? "Test run" : "Quiz"}: ${args.set.title}`,
    created_at: now,
    updated_at: now,
  });
  if (error) throw new Error(error.message);
  return quiz;
}

export async function questions(db: SupabaseClient, threadId: string): Promise<QuestionRow[]> {
  const { data } = await db.from("tutor_quiz_questions").select("*").eq("thread_id", threadId).order("number");
  return (data ?? []) as QuestionRow[];
}

/** Saves a question the tutor just asked. */
export async function recordQuestion(
  db: SupabaseClient,
  args: { threadId: string; setId: string; draft: QuestionDraft; counts: boolean },
): Promise<QuestionRow> {
  const [{ data: topics }, asked] = await Promise.all([
    db.from("tutor_study_topics").select("id, name").eq("set_id", args.setId).is("removed_at", null),
    questions(db, args.threadId),
  ]);
  // An earlier question the tutor moved on from without a call stays
  // ungraded: it doesn't count either way.
  const { draft } = args;
  const { data, error } = await db
    .from("tutor_quiz_questions")
    .insert({
      thread_id: args.threadId,
      set_id: args.setId,
      topic_id: matchTopic(draft.topic, topics ?? [])?.id ?? null,
      number: (asked.at(-1)?.number ?? 0) + 1,
      kind: draft.kind,
      prompt: draft.prompt,
      choices: draft.choices,
      answer_index: draft.answerIndex,
      answer: draft.answer,
      explanation: draft.explanation,
      counts: args.counts,
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as QuestionRow;
}

export type AnswerOutcome = { question: QuestionRow; finished: boolean };

/**
 * Records an answer to a question. Multiple choice (and true/false) is graded
 * here against the stored answer, whatever anyone says; anything else takes
 * the tutor's call. An answered question keeps its first result.
 */
export async function recordAnswer(
  db: SupabaseClient,
  args: {
    question: QuestionRow;
    quiz: QuizSettings;
    choice?: number | string | null;
    result?: Result | null;
    response?: string | null;
  },
): Promise<AnswerOutcome> {
  const q = args.question;
  if (q.result) return { question: q, finished: Boolean(args.quiz.finishedAt) };
  let result: Result | null = args.result ?? null;
  let chosen: number | null = null;
  if (q.choices && q.answer_index != null) {
    chosen = args.choice != null ? choiceIndex(args.choice, q.choices) : null;
    if (chosen != null) {
      // A choice that's right after a hint stays "hinted"; otherwise the choice decides.
      result = chosen === q.answer_index ? (args.result === "hinted" ? "hinted" : "correct") : "wrong";
    } else if (result !== "skipped") {
      return { question: q, finished: false }; // no choice we can read: leave it open
    }
  }
  if (!result) return { question: q, finished: false };
  const now = new Date().toISOString();
  const { data, error } = await db
    .from("tutor_quiz_questions")
    .update({ result, chosen_index: chosen, response: args.response ?? null, answered_at: now })
    .eq("id", q.id)
    .is("result", null)
    .select("*")
    .maybeSingle();
  if (error) throw new Error(error.message);
  const saved = (data as QuestionRow | null) ?? q;
  const all = await questions(db, q.thread_id);
  const finished = quizDone(all, args.quiz.count);
  if (finished && !args.quiz.finishedAt) await finishQuiz(db, q.thread_id, args.quiz);
  return { question: saved, finished };
}

export async function finishQuiz(db: SupabaseClient, threadId: string, quiz: QuizSettings) {
  await db
    .from("tutor_threads")
    .update({ quiz: { ...quiz, finishedAt: new Date().toISOString() } })
    .eq("id", threadId);
}

/** Every question asked and the last one answered (or that many answered). */
export function quizDone(list: QuestionRow[], count: number): boolean {
  return list.filter((q) => q.result).length >= count || (list.length >= count && Boolean(list.at(-1)?.result));
}

/** The newest question still waiting for an answer, if one is. */
export function openQuestion(list: QuestionRow[]): QuestionRow | null {
  const last = list.at(-1);
  return last && !last.result ? last : null;
}

// --- What the phone sees --------------------------------------------------------------

/**
 * A question as the phone draws it. The answer is only there once it's been
 * answered, and in a test run only once the whole quiz is over.
 */
export function publicQuestion(q: QuestionRow, opts: { of: number; topic: string | null; reveal: boolean }) {
  const answered = Boolean(q.result);
  const show = answered && opts.reveal;
  return {
    id: q.id,
    number: q.number,
    of: opts.of,
    topic: opts.topic,
    kind: q.kind,
    prompt: q.prompt,
    choices: q.choices,
    answered,
    chosenIndex: q.chosen_index,
    result: show ? q.result : null,
    answerIndex: show ? q.answer_index : null,
    answer: show ? q.answer : null,
  };
}

export type PublicQuestion = ReturnType<typeof publicQuestion>;

/** The block a question becomes in the saved chat (no answer in it). */
export function questionBlock(q: QuestionRow, of: number, topic: string | null): string {
  const card = { id: q.id, number: q.number, of, topic, kind: q.kind, prompt: q.prompt, choices: q.choices };
  return "```question\n" + JSON.stringify(card) + "\n```\n";
}

export type QuizState = {
  setId: string;
  setTitle: string;
  mode: "practice" | "test";
  count: number;
  finished: boolean;
  questions: PublicQuestion[];
  /** Once finished: how it went, and which topics moved. */
  recap: {
    right: number;
    answered: number;
    topics: { name: string; before: Level; after: Level; right: number; asked: number }[];
    overall: Overall;
  } | null;
};

export async function quizState(db: SupabaseClient, threadId: string, set: SetRow, quiz: QuizSettings): Promise<QuizState> {
  const [list, after, before] = await Promise.all([
    questions(db, threadId),
    topicStates(db, [set.id]),
    quiz.finishedAt ? topicStates(db, [set.id], { exceptThread: threadId }) : Promise.resolve(null),
  ]);
  const topics = after.get(set.id) ?? [];
  const name = (id: string | null) => topics.find((t) => t.id === id)?.name ?? null;
  const finished = Boolean(quiz.finishedAt);
  const reveal = quiz.mode === "practice" || finished;
  let recap: QuizState["recap"] = null;
  if (finished && before) {
    const prior = before.get(set.id) ?? [];
    const touched = [...new Set(list.filter((q) => q.result && q.topic_id).map((q) => q.topic_id!))];
    recap = {
      right: list.filter((q) => q.result === "correct").length,
      answered: list.filter((q) => q.result).length,
      topics: touched
        .map((id) => {
          const now = topics.find((t) => t.id === id);
          if (!now) return null;
          const mine = list.filter((q) => q.topic_id === id && q.result);
          return {
            name: now.name,
            before: prior.find((t) => t.id === id)?.level ?? "new",
            after: now.level,
            right: mine.filter((q) => q.result === "correct").length,
            asked: mine.length,
          };
        })
        .filter((t): t is NonNullable<typeof t> => t != null),
      overall: overallFor(topics, set.test_date),
    };
  }
  return {
    setId: set.id,
    setTitle: set.title,
    mode: quiz.mode,
    count: quiz.count,
    finished,
    questions: list.map((q) => publicQuestion(q, { of: quiz.count, topic: name(q.topic_id), reveal })),
    recap,
  };
}

/** A quiz chat, its set and settings, if it's the caller's. */
export async function quizThread(
  db: SupabaseClient,
  threadId: string,
  ownerId: string,
  studentId: string,
): Promise<{ set: SetRow; quiz: QuizSettings } | null> {
  const { data: thread } = await db
    .from("tutor_threads")
    .select("student_id, kind, study_set_id, quiz")
    .eq("id", threadId)
    .maybeSingle();
  if (!thread || thread.student_id !== ownerId || thread.kind !== "quiz" || !thread.study_set_id || !thread.quiz) return null;
  const set = await getSet(db, thread.study_set_id, studentId);
  return set ? { set, quiz: thread.quiz as QuizSettings } : null;
}
