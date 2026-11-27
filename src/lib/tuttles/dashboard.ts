// The Parent Dashboard in the Tuttles app: each kid's practice over the last
// few weeks, Vocab and Math side by side, the handful of words worth going
// over with them at home today, and where Math is going wrong. It's the
// parents' one look at the kids: there's no page of Vocab's or Math's own
// beside it any more. Pure functions over plain data, so
// they run in a script (scripts/verify-tuttles-dashboard.mts); the reading is
// in the route (src/app/(tuttles)/tuttles/api/parent/dashboard/route.ts).

import { countDays, dayIn, type Answered, type KidSummary, type Miss, type TopicStat } from "@/lib/tuttles/math";
import { addDays, dayDone, streak, troubleScore } from "@/lib/words/schedule";
import { statusOf, type Item, type Progress, type Status } from "@/lib/words/types";

/** How many days back the dashboard looks. Four weeks: long enough to see a trend, short enough to read on a phone. */
export const DASHBOARD_DAYS = 28;

/** How many words to practice it offers a day. A few at dinner, not a list to get through. */
export const PRACTICE_WORDS = 8;

export type DashboardDay = {
  day: string;
  /** Time spent answering Vocab, over every session. */
  vocabMs: number;
  vocabAnswered: number;
  vocabCorrect: number;
  /** The day's ten minutes of Vocab were done. */
  vocabDone: boolean;
  mathAnswered: number;
  mathCorrect: number;
  /** Words mastered by the end of the day, all told. */
  mastered: number;
};

export type DashboardWeek = {
  /** The first day of the seven. */
  start: string;
  vocabMs: number;
  vocabAnswered: number;
  vocabCorrect: number;
  vocabDaysDone: number;
  mathAnswered: number;
  mathCorrect: number;
  /** Words mastered during the week. */
  masteredGained: number;
};

export type PracticeWord = {
  id: string;
  /** The word, or the word part as written ("bene-"). */
  title: string;
  kind: "word" | "part";
  /** Part of speech, or prefix/root/suffix. */
  pos: string;
  meaning: string;
  /** A sentence with the word in it, or words built from the part. */
  example: string;
  /** One line that makes it stick. */
  hook: string;
  status: Status;
  misses: number;
  /** Why it's on the list: missed again and again, or coming up for review now and not yet sure. */
  reason: "trouble" | "due";
};

/** How many topics of Math it names: the few going worst, not the whole test. */
export const MATH_TOPICS = 5;

/** A topic needs this many answers before it's said to be going badly. */
export const MATH_TOPIC_MIN = 3;

/** How many of the latest missed questions it keeps. */
export const MATH_MISSES = 12;

/** Math, past the day-by-day: the run of days at the goal, what's going wrong, and their bests. */
export type DashboardMath = {
  /** Days in a row with the day's questions answered. */
  streak: number;
  /** The topics they get wrong most, the worst first. */
  topics: TopicStat[];
  /** The questions missed lately, the newest first. */
  misses: Miss[];
  best: KidSummary["best"];
  runs: number;
  answeredTotal: number;
  correctTotal: number;
};

/** What a kid's purse holds, and how big their house has got. */
export type DashboardHouse = { coins: number; gems: number; rooms: number };

export type VocabSessionDay = { day: string; answered: number; correct: number; elapsed_ms: number; finished_at: string | null };

/** Each of the last `n` days, oldest first: what was done in Vocab and Math, and the words mastered so far. */
export function dashboardDays(input: {
  today: string;
  tz: string;
  sessions: VocabSessionDay[];
  answers: Pick<Answered, "at" | "correct">[];
  progress: Pick<Progress, "mastered_at" | "stage" | "removed_at">[];
  n?: number;
}): DashboardDay[] {
  const { today, tz, sessions, answers, progress, n = DASHBOARD_DAYS } = input;
  const vocab = new Map<string, { ms: number; answered: number; correct: number; finished: number }>();
  for (const s of sessions) {
    const d = vocab.get(s.day) ?? { ms: 0, answered: 0, correct: 0, finished: 0 };
    d.ms += s.elapsed_ms;
    d.answered += s.answered;
    d.correct += s.correct;
    d.finished += s.finished_at ? 1 : 0;
    vocab.set(s.day, d);
  }
  const math = countDays(answers, tz);
  // A word counts as mastered from the day it was, while it still is.
  const dayOf = dayIn(tz);
  const masteredOn = progress.filter((p) => p.mastered_at && p.stage >= 3 && !p.removed_at).map((p) => dayOf(p.mastered_at!)).sort();

  let m = 0;
  return Array.from({ length: n }, (_, i) => {
    const day = addDays(today, i - (n - 1));
    while (m < masteredOn.length && masteredOn[m] <= day) m++;
    const v = vocab.get(day);
    const a = math.get(day);
    return {
      day,
      vocabMs: v?.ms ?? 0,
      vocabAnswered: v?.answered ?? 0,
      vocabCorrect: v?.correct ?? 0,
      vocabDone: v ? dayDone(day, v.ms, v.finished) : false,
      mathAnswered: a?.answered ?? 0,
      mathCorrect: a?.correct ?? 0,
      mastered: m,
    };
  });
}

/** Days in a row with Vocab's practice done, counting back from today (or from yesterday if today's isn't done yet). */
export function vocabStreak(sessions: Pick<VocabSessionDay, "day" | "elapsed_ms" | "finished_at">[], today: string): number {
  const byDay = new Map<string, { ms: number; finished: number }>();
  for (const s of sessions) {
    const d = byDay.get(s.day) ?? { ms: 0, finished: 0 };
    d.ms += s.elapsed_ms;
    d.finished += s.finished_at ? 1 : 0;
    byDay.set(s.day, d);
  }
  return streak(
    [...byDay].filter(([day, d]) => dayDone(day, d.ms, d.finished)).map(([day]) => day),
    today,
  );
}

/** Math for the dashboard, from the whole of what the parents could see of it: the few topics going worst and the latest misses. */
export function dashboardMath(summary: KidSummary): DashboardMath {
  return {
    streak: summary.streak,
    topics: summary.topics.filter((t) => t.answered >= MATH_TOPIC_MIN).slice(0, MATH_TOPICS),
    misses: summary.misses.slice(0, MATH_MISSES),
    best: summary.best,
    runs: summary.runs,
    answeredTotal: summary.answeredTotal,
    correctTotal: summary.correctTotal,
  };
}

/** The purse and the size of the house, out of a house as a phone sent it; null when it isn't one. */
export function dashboardHouse(json: Record<string, unknown> | null | undefined): DashboardHouse | null {
  if (!json) return null;
  const count = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0);
  return { coins: count(json.coins), gems: count(json.gems), rooms: Array.isArray(json.rooms) ? json.rooms.length : 0 };
}

/** The days in weeks of seven, the newest last; the first week is whatever's left over at the start. */
export function dashboardWeeks(days: DashboardDay[], masteredBefore = 0): DashboardWeek[] {
  const weeks: DashboardWeek[] = [];
  const lead = days.length % 7;
  let prevMastered = masteredBefore;
  for (let at = lead === 0 ? 0 : lead - 7; at < days.length; at += 7) {
    const slice = days.slice(Math.max(at, 0), at + 7);
    if (slice.length === 0) continue;
    const last = slice[slice.length - 1].mastered;
    weeks.push({
      start: slice[0].day,
      vocabMs: sum(slice, (d) => d.vocabMs),
      vocabAnswered: sum(slice, (d) => d.vocabAnswered),
      vocabCorrect: sum(slice, (d) => d.vocabCorrect),
      vocabDaysDone: slice.filter((d) => d.vocabDone).length,
      mathAnswered: sum(slice, (d) => d.mathAnswered),
      mathCorrect: sum(slice, (d) => d.mathCorrect),
      masteredGained: Math.max(0, last - prevMastered),
    });
    prevMastered = last;
  }
  return weeks;
}

/**
 * The words to go over with a kid today: the ones they keep missing first
 * (the most missed first), then words met already and due for review now
 * that they aren't sure of yet (the longest overdue first). Skipped and
 * mastered words never; the list changes as they practice.
 */
export function practiceWords(items: Item[], progress: Map<string, Progress>, today: string, n = PRACTICE_WORDS): PracticeWord[] {
  const trouble: { item: Item; p: Progress; score: number }[] = [];
  const due: { item: Item; p: Progress }[] = [];
  for (const item of items) {
    const p = progress.get(item.id);
    if (!p || p.removed_at || p.stage >= 3) continue;
    const score = troubleScore(p);
    if (score > 0) trouble.push({ item, p, score });
    else if (p.seen > 0 && p.due_on <= today) due.push({ item, p });
  }
  trouble.sort((a, b) => b.score - a.score || a.item.rank - b.item.rank);
  due.sort((a, b) => a.p.due_on.localeCompare(b.p.due_on) || a.p.stage - b.p.stage || a.item.rank - b.item.rank);
  return [
    ...trouble.map(({ item, p }) => word(item, p, "trouble" as const)),
    ...due.map(({ item, p }) => word(item, p, "due" as const)),
  ].slice(0, n);
}

function word(item: Item, p: Progress, reason: PracticeWord["reason"]): PracticeWord {
  const misses = p.wrong_count + p.dontknow_count;
  if (item.type === "word") {
    return { id: item.id, title: item.word, kind: "word", pos: item.pos, meaning: item.meaning, example: item.example, hook: item.hook, status: statusOf(p), misses, reason };
  }
  return { id: item.id, title: item.part, kind: "part", pos: item.kind, meaning: item.meaning, example: item.examples.join(", "), hook: item.hook, status: statusOf(p), misses, reason };
}

function sum<T>(list: T[], f: (t: T) => number): number {
  return list.reduce((n, t) => n + f(t), 0);
}
