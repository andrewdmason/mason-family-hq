// Math in the Tuttles app: an endless runner in which the kids answer ISEE
// math questions. The phone plays it with no connection and keeps the
// questions itself; when it can reach the website it sends the runs and
// answers since (/tuttles/api/math/sync) and takes back the day's count and
// how the brothers compare. The parents see what it adds up to
// (/tuttles/api/math/summary, and the parents' view of /words).
//
// This file is what the phone may send and what's made of it: no database in
// it, so it can be run in a script (scripts/verify-tuttles-math.mts). The
// reading and writing is src/lib/tuttles/math-db.ts.

import { addDays, streak } from "@/lib/words/schedule";
import type { Level } from "@/lib/words/types";

/** Questions answered in a day, right or wrong, that make the day done. */
export const MATH_DAY_GOAL = 20;

/** The most one call may carry. The phone sends what's left the next time. */
export const MAX_RUNS = 200;
export const MAX_ANSWERS = 2000;
/** The most the phone's own state may come to, as JSON. */
export const MAX_STATE_BYTES = 64 * 1024;

/**
 * The economy from which a run's stars are its score (2026-11-26): runs
 * played before it counted stars another way, so the bests and the top 10
 * count only runs from this one on.
 */
export const STARS_ECONOMY = 2;

export type Section = "qr" | "ma";

/** A go at the game, as the phone sends it. */
export type MathRun = {
  id: string;
  startedAt: string;
  endedAt: string;
  score: number;
  /** Metres. */
  distance: number;
  waves: number;
  /** The furthest zone reached: 0 is the first. */
  depth: number;
  stars: number;
  answered: number;
  correct: number;
  bestStreak: number;
  /** The economy it was played under: 1 from a phone that doesn't say. */
  economy: number;
};

/** A question answered, as the phone sends it. */
export type MathAnswer = {
  id: string;
  run: string;
  /** The question's id in the phone's bank: "L-0001". */
  question: string;
  topic: string;
  section: Section;
  difficulty: 1 | 2 | 3;
  /** Which of the four they picked; null when the clock ran out. */
  chosen: number | null;
  correct: boolean;
  ms: number;
  at: string;
};

/** What the phone keeps between runs. Only the phone knows what's in `json`. */
export type MathState = { rev: number; json: Record<string, unknown> };

export type SyncInput = {
  runs: MathRun[];
  answers: MathAnswer[];
  /** The phone's state to keep, if it sent one that can be. */
  state: MathState | null;
  /**
   * The rev of the state the phone holds, for deciding whether what's kept
   * here is news to it: null when it sent none. When it sent one that
   * couldn't be read at all this is Infinity, so nothing here is ever taken
   * for newer and sent back over the top of it.
   */
  phoneRev: number | null;
  /** What was sent and couldn't be taken, so the phone can tell. */
  dropped: { runs: number; answers: number; state: boolean };
};

// MARK: What the phone sends

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** What fits an integer column. */
const INT_MAX = 2_147_483_647;

const text = (v: unknown, max: number): v is string => typeof v === "string" && v.length > 0 && v.length <= max;
const uuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
const whole = (v: unknown, min = 0, max = INT_MAX): v is number => typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
const when = (v: unknown): v is string => text(v, 40) && Number.isFinite(Date.parse(v));
const record = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

const RUN_COUNTS = ["score", "distance", "waves", "depth", "stars", "answered", "correct", "bestStreak"] as const;

/** A run, or what's wrong with it (said for whoever is working out why one was dropped). */
function run(v: unknown): MathRun | string {
  if (!record(v)) return "not an object";
  if (!uuid(v.id)) return "id must be a uuid";
  if (!when(v.startedAt)) return "startedAt must be a time";
  if (!when(v.endedAt)) return "endedAt must be a time";
  for (const key of RUN_COUNTS) if (!whole(v[key])) return `${key} must be a whole number, 0 or more`;
  if (v.economy != null && !whole(v.economy, 1, 100)) return "economy must be 1 to 100, or left out";
  const n = v as Record<(typeof RUN_COUNTS)[number], number>;
  return {
    id: v.id.toLowerCase(),
    startedAt: v.startedAt,
    endedAt: v.endedAt,
    score: n.score,
    distance: n.distance,
    waves: n.waves,
    depth: n.depth,
    stars: n.stars,
    answered: n.answered,
    correct: n.correct,
    bestStreak: n.bestStreak,
    economy: (v.economy as number | null | undefined) ?? 1,
  };
}

/** An answer, or what's wrong with it. */
function answer(v: unknown): MathAnswer | string {
  if (!record(v)) return "not an object";
  if (!uuid(v.id)) return "id must be a uuid";
  if (!uuid(v.run)) return "run must be a uuid";
  if (!text(v.question, 40)) return "question must be 1 to 40 characters";
  if (!text(v.topic, 60)) return "topic must be 1 to 60 characters";
  if (v.section !== "qr" && v.section !== "ma") return 'section must be "qr" or "ma"';
  if (!whole(v.difficulty, 1, 3)) return "difficulty must be 1, 2 or 3";
  if (v.chosen != null && !whole(v.chosen, 0, 3)) return "chosen must be 0 to 3, or null";
  if (typeof v.correct !== "boolean") return "correct must be true or false";
  if (!whole(v.ms)) return "ms must be a whole number, 0 or more";
  if (!when(v.at)) return "at must be a time";
  return {
    id: v.id.toLowerCase(),
    run: v.run.toLowerCase(),
    question: v.question,
    topic: v.topic,
    section: v.section,
    difficulty: v.difficulty as 1 | 2 | 3,
    chosen: (v.chosen as number | null | undefined) ?? null,
    correct: v.correct,
    ms: v.ms,
    at: v.at,
  };
}

/**
 * What a call to sync carries, or why it can't be taken (the status to answer
 * with, and a reason someone can read).
 *
 * Only a call that makes no sense as a whole is refused: a body that isn't an
 * object, a list that isn't one, or more than a call may carry (which the
 * phone can send in pieces). A run or answer that's malformed is dropped
 * rather than holding up the rest, as Vocab's are: the phone sends what it
 * has until it's told it arrived, so refusing over one bad answer would stop
 * every answer after it for good. The same goes for a state that can't be
 * kept. How many were dropped is counted, and goes back to the phone.
 *
 * A list left out, or null, is an empty one. The same id twice in one call is
 * one thing: the later copy of a run, the first of an answer.
 */
export function parseSync(body: unknown): SyncInput | { error: string; status: 400 | 413 } {
  const bad = (error: string) => ({ error, status: 400 as const });
  if (!record(body)) return bad("the body must be a JSON object");
  for (const key of ["runs", "answers"] as const) {
    if (body[key] != null && !Array.isArray(body[key])) return bad(`${key} must be a list`);
  }
  const runsIn = (body.runs ?? []) as unknown[];
  const answersIn = (body.answers ?? []) as unknown[];
  if (runsIn.length > MAX_RUNS) return { error: `too many runs at once: ${MAX_RUNS} at most`, status: 413 };
  if (answersIn.length > MAX_ANSWERS) return { error: `too many answers at once: ${MAX_ANSWERS} at most`, status: 413 };

  const dropped = { runs: 0, answers: 0, state: false };
  const runs = new Map<string, MathRun>();
  for (const v of runsIn) {
    const r = run(v);
    if (typeof r === "string") dropped.runs += 1;
    else runs.set(r.id, r);
  }
  const answers = new Map<string, MathAnswer>();
  for (const v of answersIn) {
    const a = answer(v);
    if (typeof a === "string") dropped.answers += 1;
    else if (!answers.has(a.id)) answers.set(a.id, a);
  }

  let state: MathState | null = null;
  let phoneRev: number | null = null;
  if (body.state != null) {
    const s = body.state;
    // Even when the rest of it can't be kept, a rev that can be read still says how new the phone's is.
    phoneRev = record(s) && whole(s.rev) ? s.rev : Infinity;
    if (record(s) && whole(s.rev) && record(s.json) && new TextEncoder().encode(JSON.stringify(s.json)).length <= MAX_STATE_BYTES) {
      state = { rev: s.rev, json: s.json };
    } else {
      dropped.state = true;
    }
  }
  return { runs: [...runs.values()], answers: [...answers.values()], state, phoneRev, dropped };
}

// MARK: What it adds up to

/** The day a moment falls on in a time zone, as YYYY-MM-DD. Made once per zone: there can be thousands to place. */
export function dayIn(tz: string): (at: string | Date) => string {
  const format = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
  return (at) => {
    const parts = format.formatToParts(typeof at === "string" ? new Date(at) : at);
    const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
    return `${part("year")}-${part("month")}-${part("day")}`;
  };
}

/** What the sums need of an answer. */
export type Answered = {
  question: string;
  topic: string;
  section: Section;
  chosen: number | null;
  correct: boolean;
  ms: number;
  at: string;
};

/** What the sums need of a run. */
export type RunBests = { stars: number; economy: number; waves: number; depth: number; bestStreak: number };

export type DayCount = { day: string; answered: number; correct: number };

/** Each day's answers, by the day they were given on in `tz`. */
export function countDays(answers: Pick<Answered, "at" | "correct">[], tz: string): Map<string, DayCount> {
  const dayOf = dayIn(tz);
  const days = new Map<string, DayCount>();
  for (const a of answers) {
    const day = dayOf(a.at);
    const d = days.get(day) ?? { day, answered: 0, correct: 0 };
    d.answered += 1;
    d.correct += a.correct ? 1 : 0;
    days.set(day, d);
  }
  return days;
}

/** The last `n` days up to today, oldest first, the empty ones as zeros. */
export function lastDays(days: Map<string, DayCount>, today: string, n = 14): DayCount[] {
  return Array.from({ length: n }, (_, i) => {
    const day = addDays(today, i - (n - 1));
    return days.get(day) ?? { day, answered: 0, correct: 0 };
  });
}

/** Days in a row with the goal met, counting back from today (or from yesterday if today's isn't there yet). */
export function goalStreak(days: Map<string, DayCount>, today: string): number {
  const done = [...days.values()].filter((d) => d.answered >= MATH_DAY_GOAL).map((d) => d.day);
  return streak(done, today);
}

export type TopicStat = { section: Section; topic: string; answered: number; correct: number; avgMs: number };

/**
 * How each topic has gone, over everything: the one they get wrong most
 * first. Two as bad as each other: the one with more answers first, since
 * there's more behind it.
 */
export function topicStats(answers: Pick<Answered, "section" | "topic" | "correct" | "ms">[]): TopicStat[] {
  const topics = new Map<string, { section: Section; topic: string; answered: number; correct: number; ms: number }>();
  for (const a of answers) {
    // The same name can be a topic of both sections.
    const key = `${a.section}:${a.topic}`;
    const t = topics.get(key) ?? { section: a.section, topic: a.topic, answered: 0, correct: 0, ms: 0 };
    t.answered += 1;
    t.correct += a.correct ? 1 : 0;
    t.ms += a.ms;
    topics.set(key, t);
  }
  return [...topics.values()]
    .map(({ ms, ...t }) => ({ ...t, avgMs: Math.round(ms / t.answered) }))
    .sort(
      (a, b) =>
        a.correct / a.answered - b.correct / b.answered ||
        b.answered - a.answered ||
        a.section.localeCompare(b.section) ||
        a.topic.localeCompare(b.topic),
    );
}

export type Miss = { question: string; topic: string; section: Section; at: string; timedOut: boolean };

/** The latest wrong answers, newest first. Running out of time is a wrong answer. */
export function recentMisses(answers: Answered[], n = 30): Miss[] {
  return answers
    .filter((a) => !a.correct)
    .map((a) => ({ question: a.question, topic: a.topic, section: a.section, at: new Date(a.at).toISOString(), timedOut: a.chosen === null }))
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, n);
}

/**
 * The best of each thing over some runs: not one run's, each its own best.
 * The score is the most stars in a run, of the runs since stars were the score.
 */
export function bestOf(runs: RunBests[]): { score: number; waves: number; depth: number; streak: number } {
  const best = { score: 0, waves: 0, depth: 0, streak: 0 };
  for (const r of runs) {
    if (r.economy >= STARS_ECONOMY) best.score = Math.max(best.score, r.stars);
    best.waves = Math.max(best.waves, r.waves);
    best.depth = Math.max(best.depth, r.depth);
    best.streak = Math.max(best.streak, r.bestStreak);
  }
  return best;
}

/** A name as the game shows it: the first one. */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || "Kid";
}

export type BoardEntry = {
  kid: string;
  name: string;
  me: boolean;
  bestScore: number;
  bestWaves: number;
  bestDepth: number;
  bestStreak: number;
  answeredToday: number;
  answeredTotal: number;
  correctTotal: number;
};

/** What the board needs of one kid. */
export type KidTally = { runs: RunBests[]; answeredToday: number; answeredTotal: number; correctTotal: number };

/** The brothers side by side, in the order given. One who hasn't played is there too, with nothing yet. */
export function board(kids: { kid: string; name: string }[], me: string, tallies: Map<string, KidTally>): BoardEntry[] {
  return kids.map(({ kid, name }) => {
    const t = tallies.get(kid) ?? { runs: [], answeredToday: 0, answeredTotal: 0, correctTotal: 0 };
    const best = bestOf(t.runs);
    return {
      kid,
      name: firstName(name),
      me: kid === me,
      bestScore: best.score,
      bestWaves: best.waves,
      bestDepth: best.depth,
      bestStreak: best.streak,
      answeredToday: t.answeredToday,
      answeredTotal: t.answeredTotal,
      correctTotal: t.correctTotal,
    };
  });
}

/** A run on the stars top 10. */
export type TopRun = { id: string; name: string; me: boolean; stars: number; at: string };

/** A run as the top 10 is made from: whose, how many stars, when it ended. */
export type StarRun = { id: string; userId: string; stars: number; endedAt: string };

/**
 * The stars top 10s: the ten runs with the most stars today (by the day it
 * ended in `tz`) and of all time. Runs, not players: one kid can be on it
 * more than once. Two the same: the earlier first, as it got there first.
 * Only the people in `names` are on it.
 */
export function topRuns(
  runs: StarRun[],
  names: Map<string, string>,
  me: string,
  today: string,
  tz: string,
  n = 10,
): { today: TopRun[]; all: TopRun[] } {
  const dayOf = dayIn(tz);
  const rows = runs
    .filter((r) => names.has(r.userId))
    .sort((a, b) => b.stars - a.stars || Date.parse(a.endedAt) - Date.parse(b.endedAt) || a.id.localeCompare(b.id))
    .map((r) => ({
      id: r.id,
      name: firstName(names.get(r.userId) ?? ""),
      me: r.userId === me,
      stars: r.stars,
      at: new Date(r.endedAt).toISOString(),
    }));
  return { today: rows.filter((r) => dayOf(r.at) === today).slice(0, n), all: rows.slice(0, n) };
}

/** Whether the state kept here is news to a phone that sent `sent` (null: it has none). */
export function stateForPhone(stored: MathState | null, sent: number | null): MathState | null {
  if (!stored) return null;
  return sent === null || stored.rev > sent ? stored : null;
}

export type KidSummary = {
  kid: string;
  name: string;
  level: Level;
  today: DayCount;
  /** The last 14 days, oldest first. */
  days: DayCount[];
  streak: number;
  topics: TopicStat[];
  misses: Miss[];
  best: { score: number; waves: number; depth: number; streak: number };
  runs: number;
  answeredTotal: number;
  correctTotal: number;
};

/** Everything the parents see of one kid, from all their answers and runs. */
export function summarize(input: {
  kid: string;
  name: string;
  level: Level;
  today: string;
  tz: string;
  answers: Answered[];
  runs: RunBests[];
}): KidSummary {
  const { kid, name, level, today, tz, answers, runs } = input;
  const days = countDays(answers, tz);
  return {
    kid,
    name: firstName(name),
    level,
    today: days.get(today) ?? { day: today, answered: 0, correct: 0 },
    days: lastDays(days, today),
    streak: goalStreak(days, today),
    topics: topicStats(answers),
    misses: recentMisses(answers),
    best: bestOf(runs),
    runs: runs.length,
    answeredTotal: answers.length,
    correctTotal: answers.filter((a) => a.correct).length,
  };
}
