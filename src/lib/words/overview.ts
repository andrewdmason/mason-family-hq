// Where someone stands in Words, worked out from what they've done: today
// against the ten minutes, the streak, how many words are at each stage and
// which are giving trouble. No database in it, so it can be run in a script,
// and the Tuttles app works the same thing out on the phone
// (VocabEngine.overview in ios/Tuttles/Shared/VocabEngine.swift).

import { DAY_GOAL_MS, addDays, dayDone, streak, troubleScore } from "@/lib/words/schedule";
import { statusOf, type Item, type Level, type PartItem, type Progress, type Status, type WordItem } from "@/lib/words/types";

export type Overview = {
  level: Level;
  questions: number;
  today: string;
  /** Today against the ten minutes: time spent answering, over every session, and whether that's the day done. */
  day: { ms: number; goalMs: number; done: boolean };
  /** Today's finished session, if there is one: the latest. (Not the day done: that's `day.done`.) */
  doneToday: { elapsedMs: number; limitMs: number; correct: number; total: number } | null;
  /** A session started today and not finished. */
  inProgress: { answered: number; total: number } | null;
  sessionsToday: number;
  /** Every session finished today, first to last, for a day with more than one. */
  sessionsDone: { elapsedMs: number; limitMs: number; correct: number; total: number }[];
  streak: number;
  /** The last 14 days, oldest first: was the day's practice done? */
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

/** What the overview needs of a session. */
export type OverviewSession = {
  day: string;
  total: number;
  answered: number;
  correct: number;
  elapsed_ms: number;
  limit_ms: number;
  finished_at: string | null;
};

/** The words still to sort: never met, and further down the list than they've looked. */
export function unsortedWords<T extends Item>(words: T[], progress: Map<string, Progress>, after: number): T[] {
  return words.filter((w) => w.rank > after && !progress.has(w.id));
}

export function buildOverview(input: {
  level: Level;
  questions: number;
  today: string;
  words: WordItem[];
  parts: PartItem[];
  progress: Map<string, Progress>;
  /** The newest first. */
  sessions: OverviewSession[];
  sorted: { through: number; done: boolean };
}): Overview {
  const { level, questions, today, words, parts, progress, sessions, sorted } = input;
  const finished = sessions.filter((s) => s.finished_at);
  // Each day's answering time and finished sessions, which is what makes it done.
  const byDay = new Map<string, { ms: number; finished: number }>();
  for (const s of sessions) {
    const d = byDay.get(s.day) ?? { ms: 0, finished: 0 };
    d.ms += s.elapsed_ms;
    d.finished += s.finished_at ? 1 : 0;
    byDay.set(s.day, d);
  }
  const doneDays = [...byDay].filter(([day, d]) => dayDone(day, d.ms, d.finished)).map(([day]) => day);
  const todayMs = byDay.get(today)?.ms ?? 0;
  const done = finished.find((s) => s.day === today) ?? null;
  // Newest first as loaded: turned round, the day in the order it went.
  const doneToday = finished.filter((s) => s.day === today).reverse();
  const open = sessions.find((s) => s.day === today && !s.finished_at) ?? null;

  const counts: Record<Status, number> = { new: 0, learning: 0, almost: 0, mastered: 0, removed: 0 };
  for (const w of words) counts[statusOf(progress.get(w.id))]++;
  const trouble = [...words, ...parts]
    .flatMap((it) => {
      const p = progress.get(it.id);
      const score = p ? troubleScore(p) : 0;
      return score > 0 ? [{ id: it.id, title: it.type === "word" ? it.word : it.part, meaning: it.meaning, misses: score }] : [];
    })
    .sort((a, b) => b.misses - a.misses)
    .slice(0, 12);

  const recentDays = Array.from({ length: 14 }, (_, i) => {
    const day = addDays(today, i - 13);
    return { day, done: doneDays.includes(day) };
  });
  const weekAgo = recentDays[7].day;
  const week = sessions.filter((s) => s.day >= weekAgo);
  const answered = week.reduce((n, s) => n + s.answered, 0);

  return {
    level,
    questions,
    today,
    day: { ms: todayMs, goalMs: DAY_GOAL_MS, done: doneDays.includes(today) },
    doneToday: done ? { elapsedMs: done.elapsed_ms, limitMs: done.limit_ms, correct: done.correct, total: done.total } : null,
    inProgress: open && open.answered > 0 ? { answered: open.answered, total: open.total } : null,
    sessionsToday: doneToday.length,
    sessionsDone: doneToday.map((s) => ({ elapsedMs: s.elapsed_ms, limitMs: s.limit_ms, correct: s.correct, total: s.total })),
    streak: streak(doneDays, today),
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
    sort: { done: sorted.done || sorted.through > 0, left: unsortedWords(words, progress, sorted.through).length },
  };
}
