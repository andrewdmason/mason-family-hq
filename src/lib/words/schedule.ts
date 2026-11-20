// How Words decides what to ask and what an answer does. Pure functions over
// plain data so the rules can be run through fifty simulated days without a
// database (scripts/verify-words.mts).
//
// The rules, which come from what's known about remembering things:
//   • Being tested on a word teaches it better than rereading it, so a word's
//     first appearance is already a question.
//   • A word answered right comes back after a growing gap (1 day, 3 days, a
//     week, two weeks): each recall just before it would have faded is the one
//     that makes it last.
//   • A word missed comes back twice: a few questions later, while the tip is
//     fresh, and again the next day.
//   • Reviews come before new words. When more is due than a session holds,
//     no new words are added, so the pile can't grow past what a day can clear.
//   • A word is never asked the same way twice in a row, so what's remembered
//     is the word and not the question.

import type { Item, Progress, Result } from "@/lib/words/types";

/** The day of the test. New words stop a week before it; the last days are all review. */
export const TEST_DATE = "2027-01-11";
export const NEW_WORDS_STOP_DAYS = 7;

/** New words a day that turned out not to be known. Words already known pass through without counting. */
export const DAILY_NEW_UNKNOWN = 8;
/** New word parts a day, until they've all been met. */
export const DAILY_NEW_PARTS = 4;
/** One question in this many is a word part, while there are parts to learn or review. */
const PART_EVERY = 4;
/** A missed item comes back after this many other questions. */
const REQUEUE_GAP = 3;

/** Days until an item is due again after a right answer, by the stage it moves to. */
const GAP_BY_STAGE = [1, 3, 7, 21];
const MASTERED_GAP_MAX = 30;
/** Far enough off that a word already known never comes back before the test. */
const RETIRED_GAP = 365;

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 864e5);
}

/** New words are held back in the last week before the test (and not after it's passed). */
export function newWordsAllowed(today: string): boolean {
  const left = daysBetween(today, TEST_DATE);
  return left < 0 || left > NEW_WORDS_STOP_DAYS;
}

/**
 * A test-day session has no "Don't know": the real test doesn't take marks off
 * for a wrong answer, so near the end they practise ruling choices out and
 * guessing. Every other day in the last three weeks, and every day in the last five.
 */
export function isTestDaySession(today: string): boolean {
  const left = daysBetween(today, TEST_DATE);
  if (left < 0 || left > 21) return false;
  return left <= 5 || left % 2 === 0;
}

/** What an answer does to an item. `progress` is null the first time it's ever asked. */
export function applyAnswer(
  progress: Progress | null,
  item: string,
  form: string,
  result: Result,
  today: string,
  now: string
): Progress {
  const base: Progress = progress ?? {
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
  const next: Progress = { ...base, seen: base.seen + 1, last_seen_on: today, last_form: form };

  if (result !== "correct") {
    if (result === "wrong") next.wrong_count += 1;
    else next.dontknow_count += 1;
    next.stage = 0;
    next.fast = false;
    next.correct_days = 0;
    next.forms_right = [];
    next.last_correct_on = null;
    next.mastered_at = null;
    next.due_on = addDays(today, 1);
    return next;
  }

  next.right_count += 1;
  if (!next.forms_right.includes(form)) next.forms_right = [...next.forms_right, form];

  // Right the first time it's ever asked: it skips the learning steps and is
  // checked once more, a few days on and asked another way, in case it was a guess.
  if (!progress) {
    next.fast = true;
    next.stage = 2;
    next.correct_days = 1;
    next.last_correct_on = today;
    next.due_on = addDays(today, 3);
    return next;
  }

  // A second right answer on the same day (the catch-up after a miss, or an
  // early look) is practice: it doesn't move the word on.
  if (base.last_correct_on === today || base.last_seen_on === today) {
    if (base.last_correct_on !== today && base.stage === 0) next.due_on = addDays(today, 1);
    return next;
  }

  next.correct_days = base.correct_days + 1;
  next.last_correct_on = today;
  if (base.stage >= 3) {
    const lastGap = Math.max(GAP_BY_STAGE[3], daysBetween(base.last_correct_on ?? base.last_seen_on, today));
    next.due_on = addDays(today, Math.min(MASTERED_GAP_MAX, Math.round(lastGap * 1.5)));
    return next;
  }
  next.stage = base.stage + 1;
  next.due_on = addDays(today, GAP_BY_STAGE[next.stage]);
  if (next.stage >= 3) next.mastered_at = now;
  // A word they knew before they ever saw it here, right both times and asked
  // two ways: it's retired, and its place goes to a word they don't know.
  if (next.stage >= 3 && base.fast) next.due_on = addDays(today, RETIRED_GAP);
  return next;
}

/** Which way to ask: never the way it was asked last, and ways not yet answered right come first. */
export function pickForm(item: Item, progress: Progress | null | undefined): string {
  const forms = Object.keys(item.forms);
  if (!progress) return forms[0];
  const start = progress.last_form ? forms.indexOf(progress.last_form) + 1 : 0;
  const rotated = forms.map((_, i) => forms[(start + i) % forms.length]);
  const others = rotated.filter((f) => f !== progress.last_form);
  const pool = others.length > 0 ? others : rotated;
  return pool.find((f) => !progress.forms_right.includes(f)) ?? pool[0];
}

export type PickContext = {
  /** Every word, then every part, each in the order they're met. */
  words: Item[];
  parts: Item[];
  progress: Map<string, Progress>;
  today: string;
  /** The question being chosen: 1 for the first. */
  position: number;
  total: number;
  /** Items already asked in this session (a missed one may still come round once more). */
  asked: string[];
  /** Missed this session and waiting: the item and the position it was missed at. */
  requeue: { item: string; at: number }[];
};

export type Pick = { item: string; why: "requeue" | "due" | "new" | "early" | "extra" };

/** The next thing to ask. */
export function pickNext(ctx: PickContext): Pick | null {
  const { words, parts, progress, today, position, total } = ctx;
  const asked = new Set(ctx.asked);
  const remaining = total - position + 1;
  const fresh = (it: Item) => !asked.has(it.id);

  // 1. A miss from earlier in this session, once a few other questions have gone by
  //    (or sooner if the session is about to run out).
  const waiting = [...ctx.requeue].sort((a, b) => a.at - b.at);
  const ripe = waiting.find((r) => position - r.at > REQUEUE_GAP);
  if (ripe) return { item: ripe.item, why: "requeue" };
  if (waiting.length > 0 && waiting.length >= remaining) return { item: waiting[0].item, why: "requeue" };

  const isDue = (it: Item) => {
    const p = progress.get(it.id);
    return !!p && p.due_on <= today;
  };
  const byUrgency = (a: Item, b: Item) => {
    const pa = progress.get(a.id)!;
    const pb = progress.get(b.id)!;
    return pa.stage - pb.stage || pa.due_on.localeCompare(pb.due_on) || a.rank - b.rank;
  };
  const dueWords = words.filter((it) => fresh(it) && isDue(it)).sort(byUrgency);
  const dueParts = parts.filter((it) => fresh(it) && isDue(it)).sort(byUrgency);
  const due = [...dueWords, ...dueParts].sort(byUrgency);

  const newPartsToday = parts.filter((it) => progress.get(it.id)?.first_seen_on === today).length;
  const nextNewPart = newPartsToday < DAILY_NEW_PARTS ? parts.find((it) => !progress.has(it.id)) : undefined;

  const newUnknownToday = words.filter((it) => {
    const p = progress.get(it.id);
    return !!p && p.first_seen_on === today && !p.fast;
  }).length;
  const mayAddWords = newWordsAllowed(today);
  const nextNewWord = mayAddWords ? words.find((it) => !progress.has(it.id)) : undefined;
  const withinBudget = newUnknownToday < DAILY_NEW_UNKNOWN;

  // 2. Every few questions, a word part: one that's due, or a new one.
  if (position % PART_EVERY === 2) {
    if (dueParts[0]) return { item: dueParts[0].id, why: "due" };
    if (nextNewPart) return { item: nextNewPart.id, why: "new" };
  }

  // 3. Reviews and new words, turn about, unless what's due would fill the rest
  //    of the session: then reviews only.
  const newTurn = position % 2 === 1;
  if (due.length > 0 && (due.length >= remaining || !newTurn || !nextNewWord || !withinBudget)) {
    return { item: due[0].id, why: "due" };
  }
  if (nextNewWord && withinBudget) return { item: nextNewWord.id, why: "new" };
  if (due.length > 0) return { item: due[0].id, why: "due" };

  // 4. Nothing due and today's new words are used up: look ahead at what's due
  //    soonest, the least settled first.
  const early = [...words, ...parts]
    .filter((it) => fresh(it) && progress.has(it.id) && progress.get(it.id)!.last_seen_on !== today)
    .sort((a, b) => {
      const pa = progress.get(a.id)!;
      const pb = progress.get(b.id)!;
      return pa.due_on.localeCompare(pb.due_on) || pa.stage - pb.stage || a.rank - b.rank;
    });
  if (early[0]) return { item: early[0].id, why: "early" };

  // 5. Still nothing (the first days, before there's anything to review): go
  //    on to more new words, then anything not yet asked this session.
  if (nextNewWord) return { item: nextNewWord.id, why: "new" };
  if (nextNewPart) return { item: nextNewPart.id, why: "new" };
  if (waiting[0]) return { item: waiting[0].item, why: "requeue" };
  const anything = [...words, ...parts].filter((it) => fresh(it) && progress.has(it.id)).sort(byUrgency);
  if (anything[0]) return { item: anything[0].id, why: "extra" };
  const again = [...words, ...parts].find((it) => progress.has(it.id));
  return again ? { item: again.id, why: "extra" } : null;
}

/** Days in a row with a finished session, counting back from today (or from yesterday if today's isn't done yet). */
export function streak(finishedDays: string[], today: string): number {
  const days = new Set(finishedDays);
  let cursor = days.has(today) ? today : addDays(today, -1);
  let n = 0;
  while (days.has(cursor)) {
    n++;
    cursor = addDays(cursor, -1);
  }
  return n;
}

/** Words to worry about: missed at least twice and not yet mastered, the most missed first. */
export function troubleScore(p: Progress): number {
  const misses = p.wrong_count + p.dontknow_count;
  return !p.removed_at && p.stage < 3 && misses >= 2 ? misses : 0;
}
