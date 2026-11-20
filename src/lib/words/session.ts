import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { allParts, findItem, titleOf, wordsFor } from "@/lib/words/content";
import { wordsToday } from "@/lib/words/day";
import { applyAnswer, isTestDaySession, pickForm, pickNext, streak, troubleScore } from "@/lib/words/schedule";
import {
  statusOf,
  type ClientQuestion,
  type Feedback,
  type Item,
  type Level,
  type Progress,
  type Result,
  type SessionState,
  type SessionSummary,
  type Status,
  type WrongChoice,
} from "@/lib/words/types";

// Reading and writing what people have done in Words. Everything goes through
// the service role (the tables have no write policies), so every function here
// takes the user it's acting for, and callers pass the signed-in one.

/** Ten minutes, like half of the real section. */
export const SESSION_LIMIT_MS = 10 * 60 * 1000;
/** Questions in a session, paced to the real test: 34 in 20 minutes at Lower, 40 at Middle. */
export const QUESTIONS: Record<Level, number> = { lower: 18, middle: 22 };

export type Profile = { userId: string; level: Level; questions: number };

type Admin = ReturnType<typeof createAdminClient>;

type StoredChoice = WrongChoice & { right?: boolean };
type Current = {
  item: string;
  form: string;
  kind: ClientQuestion["kind"];
  stem: string;
  choices: StoredChoice[];
  correct: number;
  isNew: boolean;
  requeued: boolean;
};
type SessionRow = {
  id: string;
  user_id: string;
  level: Level;
  day: string;
  total: number;
  answered: number;
  correct: number;
  wrong: number;
  dontknow: number;
  elapsed_ms: number;
  limit_ms: number;
  no_dont_know: boolean;
  current: Current | null;
  requeue: { item: string; at: number }[];
  new_items: number;
  mastered_gained: number;
  started_at: string;
  finished_at: string | null;
};

export async function getProfile(userId: string): Promise<Profile | null> {
  const admin = createAdminClient();
  const { data } = await admin.from("words_profiles").select("level, questions").eq("user_id", userId).maybeSingle();
  if (data) return { userId, level: data.level as Level, questions: data.questions as number };

  // The kids are set up the first time they open it: Oscar is applying into
  // 6th (Lower Level), Sebastian into 8th (Middle).
  const { data: member } = await admin.from("family_members").select("name, role").eq("user_id", userId).maybeSingle();
  if (member?.role !== "kid") return null;
  const level: Level = /oscar/i.test(member.name ?? "") ? "lower" : "middle";
  return setProfile(userId, level);
}

export async function setProfile(userId: string, level: Level): Promise<Profile> {
  const admin = createAdminClient();
  const questions = QUESTIONS[level];
  const { error } = await admin
    .from("words_profiles")
    .upsert({ user_id: userId, level, questions, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
  if (error) throw new Error(error.message);
  return { userId, level, questions };
}

export async function loadProgress(userId: string, level: Level, admin: Admin = createAdminClient()): Promise<Map<string, Progress>> {
  const map = new Map<string, Progress>();
  // More rows than one page holds once a few hundred words are under way.
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin
      .from("words_progress")
      .select("item, stage, due_on, fast, first_seen_on, last_seen_on, last_correct_on, correct_days, forms_right, last_form, seen, right_count, wrong_count, dontknow_count, mastered_at")
      .eq("user_id", userId)
      .eq("level", level)
      .order("item")
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    for (const row of (data ?? []) as Progress[]) map.set(row.item, row);
    if (!data || data.length < 1000) break;
  }
  return map;
}

function shuffle<T>(list: T[]): T[] {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function toClient(session: SessionRow): ClientQuestion | null {
  const c = session.current;
  if (!c) return null;
  return {
    position: session.answered + 1,
    total: session.total,
    kind: c.kind,
    stem: c.stem,
    choices: c.choices.map((ch) => ch.text),
    isNew: c.isNew,
    allowDontKnow: !session.no_dont_know,
  };
}

async function sessionItems(admin: Admin, sessionId: string): Promise<{ item: string; result: Result }[]> {
  const { data } = await admin.from("words_answers").select("item, result, position").eq("session_id", sessionId).order("position");
  return (data ?? []) as { item: string; result: Result }[];
}

/** Choose the session's next question and put it on the session. Null when there's nothing left to ask. */
async function serveNext(admin: Admin, session: SessionRow, progress: Map<string, Progress>): Promise<Current | null> {
  const asked = (await sessionItems(admin, session.id)).map((a) => a.item);
  const pick = pickNext({
    words: wordsFor(session.level),
    parts: allParts(),
    progress,
    today: session.day,
    position: session.answered + 1,
    total: session.total,
    asked,
    requeue: session.requeue,
  });
  const item = pick ? findItem(session.level, pick.item) : undefined;
  if (!pick || !item) return null;

  const formKey = pickForm(item, progress.get(item.id));
  const form = item.forms[formKey];
  const choices = shuffle<StoredChoice>([{ text: form.answer, right: true }, ...form.traps]);
  const current: Current = {
    item: item.id,
    form: formKey,
    kind: form.kind,
    stem: form.stem,
    choices,
    correct: choices.findIndex((c) => c.right),
    isNew: !progress.has(item.id),
    requeued: pick.why === "requeue",
  };
  const { error } = await admin.from("words_sessions").update({ current }).eq("id", session.id);
  if (error) throw new Error(error.message);
  session.current = current;
  return current;
}

async function summarize(admin: Admin, session: SessionRow): Promise<SessionSummary> {
  const answers = await sessionItems(admin, session.id);
  const missed = new Map<string, { title: string; meaning: string }>();
  for (const a of answers) {
    if (a.result === "correct") continue;
    const item = findItem(session.level, a.item);
    if (item) missed.set(item.id, { title: titleOf(item), meaning: item.meaning });
  }
  return {
    id: session.id,
    total: session.total,
    correct: session.correct,
    wrong: session.wrong,
    dontknow: session.dontknow,
    elapsedMs: session.elapsed_ms,
    limitMs: session.limit_ms,
    newItems: session.new_items,
    masteredGained: session.mastered_gained,
    missed: [...missed.values()],
  };
}

function stateOf(session: SessionRow, summary: SessionSummary | null): SessionState {
  return {
    sessionId: session.id,
    elapsedMs: session.elapsed_ms,
    limitMs: session.limit_ms,
    noDontKnow: session.no_dont_know,
    question: summary ? null : toClient(session),
    summary,
  };
}

/** Today's unfinished session if there is one, or a new one. */
export async function startOrResume(profile: Profile): Promise<SessionState> {
  const admin = createAdminClient();
  const today = wordsToday();
  const { data: open } = await admin
    .from("words_sessions")
    .select("*")
    .eq("user_id", profile.userId)
    .eq("level", profile.level)
    .eq("day", today)
    .is("finished_at", null)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let session = open as SessionRow | null;
  if (!session) {
    const { data, error } = await admin
      .from("words_sessions")
      .insert({
        user_id: profile.userId,
        level: profile.level,
        day: today,
        total: profile.questions,
        limit_ms: SESSION_LIMIT_MS,
        no_dont_know: isTestDaySession(today),
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    session = data as SessionRow;
  }
  if (!session.current) {
    const progress = await loadProgress(profile.userId, profile.level, admin);
    const served = await serveNext(admin, session, progress);
    if (!served) return finish(admin, session);
  }
  return stateOf(session, null);
}

async function finish(admin: Admin, session: SessionRow): Promise<SessionState> {
  const finished_at = new Date().toISOString();
  await admin.from("words_sessions").update({ finished_at, current: null }).eq("id", session.id);
  session.finished_at = finished_at;
  session.current = null;
  return stateOf(session, await summarize(admin, session));
}

function feedbackFor(level: Level, item: Item, current: Current, result: Result, chosen: StoredChoice | null, mastered: boolean): Feedback {
  const form = item.forms[current.form];
  const parts =
    item.type === "word"
      ? item.parts.flatMap((id) => {
          const part = findItem(level, id);
          return part?.type === "part" ? [{ part: part.part, meaning: part.meaning }] : [];
        })
      : [];
  return {
    result,
    correctIndex: current.correct,
    chosenWhy: result === "wrong" ? (chosen?.why ?? null) : null,
    tip: form.tip,
    title: titleOf(item),
    pos: item.type === "word" ? item.pos : item.kind,
    meaning: item.meaning,
    example: item.type === "word" ? item.example : `As in ${item.examples.join(" and ")}.`,
    hook: item.hook,
    parts,
    mastered,
  };
}

/**
 * Grade the answer to the question on screen and serve the next one.
 * `choice` is the index picked, or null for "Don't know". `position` is the
 * question the browser thinks it's answering, so a double tap can't answer two.
 */
export async function answerQuestion(
  userId: string,
  sessionId: string,
  position: number,
  choice: number | null,
  ms: number
): Promise<{ feedback: Feedback; state: SessionState } | null> {
  const admin = createAdminClient();
  const { data } = await admin.from("words_sessions").select("*").eq("id", sessionId).eq("user_id", userId).maybeSingle();
  const session = data as SessionRow | null;
  if (!session || session.finished_at || !session.current) return null;
  if (position !== session.answered + 1) return null;

  const current = session.current;
  const item = findItem(session.level, current.item);
  if (!item) return null;
  if (choice === null && session.no_dont_know) return null;
  const chosen = choice === null ? null : (current.choices[choice] ?? null);
  if (choice !== null && !chosen) return null;
  const result: Result = choice === null ? "dontknow" : choice === current.correct ? "correct" : "wrong";
  const spent = Math.max(0, Math.min(Math.round(ms) || 0, 5 * 60 * 1000));

  const { error: insertError } = await admin.from("words_answers").insert({
    session_id: session.id,
    user_id: userId,
    level: session.level,
    item: item.id,
    form: current.form,
    position,
    result,
    chosen: chosen?.text ?? null,
    trap: result === "wrong" ? (chosen?.trap ?? null) : null,
    ms: spent,
  });
  // Already answered (the unique position): a second tap got here first.
  if (insertError) return null;

  const progress = await loadProgress(userId, session.level, admin);
  const before = progress.get(item.id) ?? null;
  const now = new Date().toISOString();
  const after = applyAnswer(before, item.id, current.form, result, session.day, now);
  progress.set(item.id, after);
  const { error: progressError } = await admin
    .from("words_progress")
    .upsert({ user_id: userId, level: session.level, ...after, updated_at: now }, { onConflict: "user_id,level,item" });
  if (progressError) throw new Error(progressError.message);

  const mastered = after.stage >= 3 && (before?.stage ?? 0) < 3;
  // A miss comes round once more this session; a miss on that second go waits for tomorrow.
  let requeue = session.requeue.filter((r) => r.item !== item.id);
  if (result !== "correct" && !current.requeued) requeue = [...requeue, { item: item.id, at: position }];

  session.answered = position;
  session.correct += result === "correct" ? 1 : 0;
  session.wrong += result === "wrong" ? 1 : 0;
  session.dontknow += result === "dontknow" ? 1 : 0;
  session.elapsed_ms += spent;
  session.requeue = requeue;
  session.new_items += before ? 0 : 1;
  session.mastered_gained += mastered ? 1 : 0;
  session.current = null;
  const { error: updateError } = await admin
    .from("words_sessions")
    .update({
      answered: session.answered,
      correct: session.correct,
      wrong: session.wrong,
      dontknow: session.dontknow,
      elapsed_ms: session.elapsed_ms,
      requeue: session.requeue,
      new_items: session.new_items,
      mastered_gained: session.mastered_gained,
      current: null,
    })
    .eq("id", session.id);
  if (updateError) throw new Error(updateError.message);

  const feedback = feedbackFor(session.level, item, current, result, chosen, mastered);
  if (session.answered >= session.total) return { feedback, state: await finish(admin, session) };
  const served = await serveNext(admin, session, progress);
  if (!served) return { feedback, state: await finish(admin, session) };
  return { feedback, state: stateOf(session, null) };
}

export type Overview = {
  level: Level;
  questions: number;
  today: string;
  /** Today's finished session, if there is one: the latest. */
  doneToday: { elapsedMs: number; limitMs: number; correct: number; total: number } | null;
  /** A session started today and not finished. */
  inProgress: { answered: number; total: number } | null;
  sessionsToday: number;
  streak: number;
  /** The last 14 days, oldest first: was a session finished? */
  recentDays: { day: string; done: boolean }[];
  counts: Record<Status, number>;
  totalWords: number;
  parts: { met: number; mastered: number; total: number };
  trouble: { id: string; title: string; meaning: string; misses: number }[];
  /** Right answers out of all answers, over the last 7 days; null before there are any. */
  accuracy: number | null;
};

export async function loadOverview(profile: Profile): Promise<Overview> {
  const admin = createAdminClient();
  const today = wordsToday();
  const [progress, { data: sessionRows }] = await Promise.all([
    loadProgress(profile.userId, profile.level, admin),
    admin
      .from("words_sessions")
      .select("day, total, answered, correct, wrong, dontknow, elapsed_ms, limit_ms, finished_at, started_at")
      .eq("user_id", profile.userId)
      .eq("level", profile.level)
      .order("started_at", { ascending: false })
      .limit(400),
  ]);
  const sessions = (sessionRows ?? []) as Pick<SessionRow, "day" | "total" | "answered" | "correct" | "wrong" | "dontknow" | "elapsed_ms" | "limit_ms" | "finished_at" | "started_at">[];
  const finished = sessions.filter((s) => s.finished_at);
  const finishedDays = [...new Set(finished.map((s) => s.day))];
  const done = finished.find((s) => s.day === today) ?? null;
  const open = sessions.find((s) => s.day === today && !s.finished_at) ?? null;

  const words = wordsFor(profile.level);
  const counts: Record<Status, number> = { new: 0, learning: 0, almost: 0, mastered: 0 };
  for (const w of words) counts[statusOf(progress.get(w.id))]++;
  const parts = allParts();
  const trouble = [...words, ...parts]
    .flatMap((it) => {
      const p = progress.get(it.id);
      const score = p ? troubleScore(p) : 0;
      return score > 0 ? [{ id: it.id, title: titleOf(it), meaning: it.meaning, misses: score }] : [];
    })
    .sort((a, b) => b.misses - a.misses)
    .slice(0, 12);

  const recentDays = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - (13 - i));
    const day = d.toISOString().slice(0, 10);
    return { day, done: finishedDays.includes(day) };
  });
  const weekAgo = recentDays[7].day;
  const week = sessions.filter((s) => s.day >= weekAgo);
  const answered = week.reduce((n, s) => n + s.answered, 0);

  return {
    level: profile.level,
    questions: profile.questions,
    today,
    doneToday: done ? { elapsedMs: done.elapsed_ms, limitMs: done.limit_ms, correct: done.correct, total: done.total } : null,
    inProgress: open && open.answered > 0 ? { answered: open.answered, total: open.total } : null,
    sessionsToday: finished.filter((s) => s.day === today).length,
    streak: streak(finishedDays, today),
    recentDays,
    counts,
    totalWords: words.length,
    parts: {
      met: parts.filter((p) => progress.has(p.id)).length,
      mastered: parts.filter((p) => statusOf(progress.get(p.id)) === "mastered").length,
      total: parts.length,
    },
    trouble,
    accuracy: answered > 0 ? week.reduce((n, s) => n + s.correct, 0) / answered : null,
  };
}

export type ListRow = {
  id: string;
  title: string;
  pos: string;
  meaning: string;
  example: string | null;
  hook: string;
  parts: { part: string; meaning: string }[];
  status: Status;
  dueOn: string | null;
  seen: number;
  right: number;
  misses: number;
  trouble: boolean;
  rank: number;
};

/** Every word (or every word part) with where this person is on it. */
export async function loadList(profile: Profile, which: "words" | "parts"): Promise<ListRow[]> {
  const progress = await loadProgress(profile.userId, profile.level);
  const items: Item[] = which === "words" ? wordsFor(profile.level) : allParts();
  return items.map((it) => {
    const p = progress.get(it.id);
    return {
      id: it.id,
      title: titleOf(it),
      pos: it.type === "word" ? it.pos : it.kind,
      meaning: it.meaning,
      example: it.type === "word" ? it.example : it.examples.join(", "),
      hook: it.hook,
      parts:
        it.type === "word"
          ? it.parts.flatMap((id) => {
              const part = findItem(profile.level, id);
              return part?.type === "part" ? [{ part: part.part, meaning: part.meaning }] : [];
            })
          : [],
      status: statusOf(p),
      dueOn: p?.due_on ?? null,
      seen: p?.seen ?? 0,
      right: p?.right_count ?? 0,
      misses: p ? p.wrong_count + p.dontknow_count : 0,
      trouble: p ? troubleScore(p) > 0 : false,
      rank: it.rank,
    };
  });
}

/** The kids who use Words, for the parents' view. */
export async function loadStudents(): Promise<{ userId: string; name: string; color: string | null; profile: Profile }[]> {
  const admin = createAdminClient();
  const { data } = await admin.from("family_members").select("user_id, name, color, role").eq("role", "kid").order("created_at");
  const out = [];
  for (const m of (data ?? []) as { user_id: string | null; name: string | null; color: string | null }[]) {
    if (!m.user_id) continue;
    const profile = await getProfile(m.user_id);
    if (profile) out.push({ userId: m.user_id, name: m.name ?? "Kid", color: m.color, profile });
  }
  return out;
}
