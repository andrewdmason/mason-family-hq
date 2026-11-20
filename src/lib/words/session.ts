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
  type QuestionKey,
  type Result,
  type SessionState,
  type SessionSummary,
  type SortPage,
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
  /**
   * What's asked next if this one is answered right, chosen ahead of time so
   * the Tuttles app can show it at once. A right answer is then held to it.
   */
  ahead?: Current | null;
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
      .select("item, stage, due_on, fast, first_seen_on, last_seen_on, last_correct_on, correct_days, forms_right, last_form, seen, right_count, wrong_count, dontknow_count, mastered_at, removed_at")
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

/** Send the answer along with each question (the Tuttles app, which grades on the phone). */
export type Serve = { key?: boolean };

function toClient(session: SessionRow, c: Current | null | undefined, position: number, key?: QuestionKey | null): ClientQuestion | null {
  if (!c) return null;
  return {
    ...(key ? { key } : {}),
    position,
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

type Turn = { position: number; asked: string[]; requeue: SessionRow["requeue"] };

/** Choose the question for a place in the session. Null when there's nothing left to ask. */
function choose(session: SessionRow, progress: Map<string, Progress>, turn: Turn): Current | null {
  // Anything they've removed is out of the running altogether.
  const kept = <T extends Item>(list: T[]) => list.filter((it) => !progress.get(it.id)?.removed_at);
  const pick = pickNext({
    words: kept(wordsFor(session.level)),
    parts: kept(allParts()),
    progress,
    today: session.day,
    position: turn.position,
    total: session.total,
    asked: turn.asked,
    requeue: turn.requeue,
  });
  const item = pick ? findItem(session.level, pick.item) : undefined;
  if (!pick || !item) return null;

  const formKey = pickForm(item, progress.get(item.id));
  const form = item.forms[formKey];
  const choices = shuffle<StoredChoice>([{ text: form.answer, right: true }, ...form.traps]);
  return {
    item: item.id,
    form: formKey,
    kind: form.kind,
    stem: form.stem,
    choices,
    correct: choices.findIndex((c) => c.right),
    isNew: !progress.has(item.id),
    requeued: pick.why === "requeue",
  };
}

/** What a right answer to `current` leaves them having done. */
function afterRight(session: SessionRow, progress: Map<string, Progress>, current: Current): Map<string, Progress> {
  const after = new Map(progress);
  after.set(current.item, applyAnswer(progress.get(current.item) ?? null, current.item, current.form, "correct", session.day, new Date().toISOString()));
  return after;
}

/** The question that follows a right answer to `current`, the one on screen. Null on the last question. */
function chooseAhead(session: SessionRow, progress: Map<string, Progress>, current: Current, asked: string[]): Current | null {
  if (session.answered + 1 >= session.total) return null;
  return choose(session, afterRight(session, progress, current), {
    position: session.answered + 2,
    asked: [...asked, current.item],
    requeue: session.requeue.filter((r) => r.item !== current.item),
  });
}

/**
 * Put the session's next question on the session: `take` when it was chosen
 * ahead of time, or a fresh choice. Null when there's nothing left to ask.
 */
async function serveNext(
  admin: Admin,
  session: SessionRow,
  progress: Map<string, Progress>,
  serve: Serve = {},
  take?: Current | null
): Promise<Current | null> {
  const asked = (await sessionItems(admin, session.id)).map((a) => a.item);
  const chosen = take ?? choose(session, progress, { position: session.answered + 1, asked, requeue: session.requeue });
  if (!chosen) return null;
  const current: Current = { ...chosen, ahead: serve.key ? chooseAhead(session, progress, chosen, asked) : null };
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

/** `progress` is given when the answers go along with the questions (the Tuttles app). */
function stateOf(session: SessionRow, summary: SessionSummary | null, progress?: Map<string, Progress> | null): SessionState {
  const current = summary ? null : session.current;
  const ahead = progress ? current?.ahead : null;
  return {
    sessionId: session.id,
    elapsedMs: session.elapsed_ms,
    limitMs: session.limit_ms,
    noDontKnow: session.no_dont_know,
    question: toClient(session, current, session.answered + 1, progress && current ? keyFor(session, current, progress) : null),
    summary,
    // The item ahead is a different one, so the answer in between doesn't change its key.
    ...(progress ? { nextIfRight: toClient(session, ahead, session.answered + 2, ahead ? keyFor(session, ahead, progress) : null) } : {}),
  };
}

/** Today's unfinished session if there is one, or a new one. */
export async function startOrResume(profile: Profile, serve: Serve = {}): Promise<SessionState> {
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
  let progress: Map<string, Progress> | null = null;
  if (!session.current) {
    progress = await loadProgress(profile.userId, profile.level, admin);
    const served = await serveNext(admin, session, progress, serve);
    if (!served) return finish(admin, session);
  }
  if (!serve.key) return stateOf(session, null);
  progress ??= await loadProgress(profile.userId, profile.level, admin);
  // A question put there before answers were looked ahead (or by the website): look ahead now.
  if (session.current && !session.current.ahead && session.answered + 1 < session.total) {
    await serveNext(admin, session, progress, serve, session.current);
  }
  return stateOf(session, null, progress);
}

async function finish(admin: Admin, session: SessionRow): Promise<SessionState> {
  const finished_at = new Date().toISOString();
  await admin.from("words_sessions").update({ finished_at, current: null }).eq("id", session.id);
  session.finished_at = finished_at;
  session.current = null;
  return stateOf(session, await summarize(admin, session));
}

/** The word laid out for learning, however the answer went. */
function lessonFor(level: Level, item: Item, current: Current): Omit<Feedback, "result" | "chosenWhy" | "mastered"> {
  const form = item.forms[current.form];
  const parts =
    item.type === "word"
      ? item.parts.flatMap((id) => {
          const part = findItem(level, id);
          return part?.type === "part" ? [{ part: part.part, meaning: part.meaning }] : [];
        })
      : [];
  return {
    correctIndex: current.correct,
    tip: form.tip,
    title: titleOf(item),
    pos: item.type === "word" ? item.pos : item.kind,
    meaning: item.meaning,
    example: item.type === "word" ? item.example : `As in ${item.examples.join(" and ")}.`,
    hook: item.hook,
    parts,
  };
}

function feedbackFor(level: Level, item: Item, current: Current, result: Result, chosen: StoredChoice | null, mastered: boolean): Feedback {
  return { ...lessonFor(level, item, current), result, chosenWhy: result === "wrong" ? (chosen?.why ?? null) : null, mastered };
}

/** The answer takes the item to mastered. */
function nowMastered(before: Progress | null, after: Progress): boolean {
  // A word known at first sight is done with, but it wasn't learned here: nothing to cheer.
  return !!before && after.stage >= 3 && before.stage < 3;
}

/** The answer to the question on the session, for grading it where it's shown. */
function keyFor(session: SessionRow, current: Current, progress: Map<string, Progress>): QuestionKey | null {
  const item = findItem(session.level, current.item);
  if (!item) return null;
  const before = progress.get(item.id) ?? null;
  const ifRight = applyAnswer(before, item.id, current.form, "correct", session.day, new Date().toISOString());
  return {
    ...lessonFor(session.level, item, current),
    whys: current.choices.map((c) => (c.right ? null : (c.why ?? null))),
    masteredIfRight: nowMastered(before, ifRight),
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
  ms: number,
  serve: Serve = {}
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

  // What they've done so far is read while the answer is written, to save a trip.
  const [{ error: insertError }, progress] = await Promise.all([
    admin.from("words_answers").insert({
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
    }),
    loadProgress(userId, session.level, admin),
  ]);
  // Already answered (the unique position): a second tap got here first.
  if (insertError) return null;

  const before = progress.get(item.id) ?? null;
  const now = new Date().toISOString();
  const after = applyAnswer(before, item.id, current.form, result, session.day, now);
  progress.set(item.id, after);

  const mastered = nowMastered(before, after);
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
  // Their progress and the session are written together.
  const [{ error: progressError }, { error: updateError }] = await Promise.all([
    admin
      .from("words_progress")
      .upsert({ user_id: userId, level: session.level, ...after, updated_at: now }, { onConflict: "user_id,level,item" }),
    admin
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
      .eq("id", session.id),
  ]);
  if (progressError) throw new Error(progressError.message);
  if (updateError) throw new Error(updateError.message);

  const feedback = feedbackFor(session.level, item, current, result, chosen, mastered);
  if (session.answered >= session.total) return { feedback, state: await finish(admin, session) };
  // A right answer gets the question it was promised: the app may be showing it already.
  const served = await serveNext(admin, session, progress, serve, serve.key && result === "correct" ? current.ahead : null);
  if (!served) return { feedback, state: await finish(admin, session) };
  return { feedback, state: stateOf(session, null, serve.key ? progress : null) };
}

/**
 * Take the word on screen out for good (too easy, or one they don't want) and
 * serve another in its place. It isn't an answer: the question count doesn't move.
 */
export async function removeCurrent(
  userId: string,
  sessionId: string,
  position: number,
  ms: number,
  serve: Serve = {}
): Promise<SessionState | null> {
  const admin = createAdminClient();
  const { data } = await admin.from("words_sessions").select("*").eq("id", sessionId).eq("user_id", userId).maybeSingle();
  const session = data as SessionRow | null;
  if (!session || session.finished_at || !session.current) return null;
  if (position !== session.answered + 1) return null;

  const itemId = session.current.item;
  const progress = await loadProgress(userId, session.level, admin);
  await setRemoved(admin, userId, session.level, itemId, progress.get(itemId) ?? null, session.day, true);
  const now = new Date().toISOString();
  const existing = progress.get(itemId);
  progress.set(itemId, { ...(existing ?? blankProgress(itemId, session.day)), removed_at: now });

  const spent = Math.max(0, Math.min(Math.round(ms) || 0, 5 * 60 * 1000));
  session.elapsed_ms += spent;
  session.requeue = session.requeue.filter((r) => r.item !== itemId);
  session.current = null;
  await admin.from("words_sessions").update({ elapsed_ms: session.elapsed_ms, requeue: session.requeue, current: null }).eq("id", session.id);
  const served = await serveNext(admin, session, progress, serve);
  if (!served) return finish(admin, session);
  return stateOf(session, null, serve.key ? progress : null);
}

function blankProgress(item: string, today: string): Progress {
  return {
    item,
    stage: 0,
    due_on: today,
    fast: false,
    first_seen_on: today,
    last_seen_on: today,
    last_correct_on: null,
    correct_days: 0,
    forms_right: [],
    last_form: null,
    seen: 0,
    right_count: 0,
    wrong_count: 0,
    dontknow_count: 0,
    mastered_at: null,
  };
}

async function setRemoved(admin: Admin, userId: string, level: Level, itemId: string, existing: Progress | null, today: string, removed: boolean) {
  const now = new Date().toISOString();
  if (removed) {
    const row = { ...(existing ?? blankProgress(itemId, today)), removed_at: now };
    const { error } = await admin.from("words_progress").upsert({ user_id: userId, level, ...row, updated_at: now }, { onConflict: "user_id,level,item" });
    if (error) throw new Error(error.message);
    return;
  }
  // Brought back. A word removed before it was ever answered goes back to being new.
  const query = admin.from("words_progress");
  const { error } =
    existing && existing.seen === 0
      ? await query.delete().eq("user_id", userId).eq("level", level).eq("item", itemId)
      : await query.update({ removed_at: null, due_on: today, updated_at: now }).eq("user_id", userId).eq("level", level).eq("item", itemId);
  if (error) throw new Error(error.message);
}

/** Remove a word from the list, or bring a removed one back. */
export async function setItemRemoved(profile: Profile, itemId: string, removed: boolean): Promise<void> {
  if (!findItem(profile.level, itemId)) return;
  const admin = createAdminClient();
  const progress = await loadProgress(profile.userId, profile.level, admin);
  await setRemoved(admin, profile.userId, profile.level, itemId, progress.get(itemId) ?? null, wordsToday(), removed);
}

// Sorting out the words known already: a page of the commonest words not yet
// met, to tap the ones they're not sure of. The rest are skipped, after a
// couple of real questions on them to keep it honest.

/** Words on a page of the sort. */
export const SORT_PAGE = 20;

type Sorted = { through: number; done: boolean };

/** How far through the sort someone is. Nothing yet, too, when the columns aren't there. */
async function loadSorted(admin: Admin, userId: string): Promise<Sorted> {
  const { data } = await admin.from("words_profiles").select("sorted_through, sorted_at").eq("user_id", userId).maybeSingle();
  const row = data as { sorted_through: number | null; sorted_at: string | null } | null;
  return { through: row?.sorted_through ?? 0, done: !!row?.sorted_at };
}

/** The words still to sort: never met, and further down the list than they've looked. */
function unsorted(level: Level, progress: Map<string, Progress>, after: number) {
  return wordsFor(level).filter((w) => w.rank > after && !progress.has(w.id));
}

/** The next page of the sort after `after` (where they'd got to, when not given). Null when there's nothing left. */
export async function loadSortPage(profile: Profile, after?: number | null): Promise<SortPage | null> {
  const admin = createAdminClient();
  const [progress, sorted] = await Promise.all([loadProgress(profile.userId, profile.level, admin), loadSorted(admin, profile.userId)]);
  const rest = unsorted(profile.level, progress, after ?? sorted.through);
  const words = rest.slice(0, SORT_PAGE);
  if (words.length === 0) return null;
  return {
    through: words[words.length - 1].rank,
    left: rest.length,
    words: words.map((item, i) => {
      const formKey = pickForm(item, null);
      const form = item.forms[formKey];
      const choices = shuffle<StoredChoice>([{ text: form.answer, right: true }, ...form.traps]);
      const current: Current = {
        item: item.id,
        form: formKey,
        kind: form.kind,
        stem: form.stem,
        choices,
        correct: choices.findIndex((c) => c.right),
        isNew: true,
        requeued: false,
      };
      return {
        id: item.id,
        title: item.word,
        question: {
          position: i + 1,
          total: words.length,
          kind: form.kind,
          stem: form.stem,
          choices: choices.map((c) => c.text),
          isNew: true,
          allowDontKnow: true,
          key: {
            ...lessonFor(profile.level, item, current),
            whys: choices.map((c) => (c.right ? null : (c.why ?? null))),
            masteredIfRight: false,
          },
        },
      };
    }),
  };
}

/**
 * A page of the sort is done: skip the words they know, and remember how far
 * they've looked. `done` when they've reached the words they mostly don't know.
 */
export async function saveSort(profile: Profile, through: number, skip: string[], done: boolean): Promise<void> {
  const admin = createAdminClient();
  const today = wordsToday();
  const now = new Date().toISOString();
  const [progress, sorted] = await Promise.all([loadProgress(profile.userId, profile.level, admin), loadSorted(admin, profile.userId)]);
  // Only words of theirs that they've never been asked: a word under way is left alone.
  const rows = [...new Set(skip)]
    .map((id) => findItem(profile.level, id))
    .filter((it): it is Item => !!it && it.type === "word" && !progress.has(it.id))
    .map((it) => ({ user_id: profile.userId, level: profile.level, ...blankProgress(it.id, today), removed_at: now, updated_at: now }));
  if (rows.length > 0) {
    const { error } = await admin.from("words_progress").upsert(rows, { onConflict: "user_id,level,item" });
    if (error) throw new Error(error.message);
  }
  const { error } = await admin
    .from("words_profiles")
    .update({ sorted_through: Math.max(sorted.through, Math.floor(through)), ...(done ? { sorted_at: now } : {}), updated_at: now })
    .eq("user_id", profile.userId);
  if (error) throw new Error(error.message);
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
  /** Every session finished today, first to last, for a day with more than one. */
  sessionsDone: { elapsedMs: number; limitMs: number; correct: number; total: number }[];
  streak: number;
  /** The last 14 days, oldest first: was a session finished? */
  recentDays: { day: string; done: boolean }[];
  counts: Record<Status, number>;
  totalWords: number;
  parts: { met: number; mastered: number; total: number };
  trouble: { id: string; title: string; meaning: string; misses: number }[];
  /** Right answers out of all answers, over the last 7 days; null before there are any. */
  accuracy: number | null;
  /** Sorting out the words known already: whether they've had a go at it, and how many words are left to look at. */
  sort: { done: boolean; left: number };
};

export async function loadOverview(profile: Profile): Promise<Overview> {
  const admin = createAdminClient();
  const today = wordsToday();
  const [progress, sorted, { data: sessionRows }] = await Promise.all([
    loadProgress(profile.userId, profile.level, admin),
    loadSorted(admin, profile.userId),
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
  // Newest first as loaded: turned round, the day in the order it went.
  const doneToday = finished.filter((s) => s.day === today).reverse();
  const open = sessions.find((s) => s.day === today && !s.finished_at) ?? null;

  const words = wordsFor(profile.level);
  const counts: Record<Status, number> = { new: 0, learning: 0, almost: 0, mastered: 0, removed: 0 };
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
    sessionsToday: doneToday.length,
    sessionsDone: doneToday.map((s) => ({ elapsedMs: s.elapsed_ms, limitMs: s.limit_ms, correct: s.correct, total: s.total })),
    streak: streak(finishedDays, today),
    recentDays,
    counts,
    // What they're working through: the words they've removed don't count against them.
    totalWords: words.length - counts.removed,
    parts: {
      met: parts.filter((p) => progress.has(p.id) && !progress.get(p.id)?.removed_at).length,
      mastered: parts.filter((p) => statusOf(progress.get(p.id)) === "mastered").length,
      total: parts.length,
    },
    trouble,
    accuracy: answered > 0 ? week.reduce((n, s) => n + s.correct, 0) / answered : null,
    // Done once they've sat down to it at all, however far they got: the card asking them to is a one-time thing.
    sort: { done: sorted.done || sorted.through > 0, left: unsorted(profile.level, progress, sorted.through).length },
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
