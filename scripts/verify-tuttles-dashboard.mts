/**
 * The Parent Dashboard's sums (src/lib/tuttles/dashboard.ts): each day's
 * Vocab and Math, the weeks they add up to, and the words to practice.
 *
 *   npm run verify:tuttles-dashboard
 */

import assert from "node:assert/strict";
import { dashboardDays, dashboardHouse, dashboardMath, dashboardWeeks, practiceWords, vocabStreak } from "../src/lib/tuttles/dashboard";
import { summarize, type Answered } from "../src/lib/tuttles/math";
import type { Item, Progress } from "../src/lib/words/types";

const tz = "America/Los_Angeles";
const today = "2026-11-26";

// Days: Vocab sessions add up by day, Math answers by the day they were given on here, mastered words count from their day.
const days = dashboardDays({
  today,
  tz,
  n: 10,
  sessions: [
    { day: "2026-11-26", answered: 25, correct: 20, elapsed_ms: 400_000, finished_at: "2026-11-26T18:00:00Z" },
    { day: "2026-11-26", answered: 10, correct: 9, elapsed_ms: 250_000, finished_at: null },
    { day: "2026-11-21", answered: 25, correct: 15, elapsed_ms: 120_000, finished_at: null },
  ],
  answers: [
    // 2am UTC on the 26th is still the 25th in California.
    { at: "2026-11-26T02:00:00Z", correct: true },
    { at: "2026-11-26T20:00:00Z", correct: false },
    { at: "2026-11-26T21:00:00Z", correct: true },
  ],
  progress: [
    { mastered_at: "2026-11-18T20:00:00Z", stage: 3, removed_at: null },
    { mastered_at: "2026-11-24T20:00:00Z", stage: 3, removed_at: null },
    // Mastered once, slipped back: not counted.
    { mastered_at: "2026-11-24T20:00:00Z", stage: 1, removed_at: null },
    { mastered_at: null, stage: 0, removed_at: null },
  ],
});
assert.equal(days.length, 10);
assert.equal(days[0].day, "2026-11-17");
assert.equal(days[9].day, today);
const t = days[9];
assert.deepEqual(
  { ms: t.vocabMs, answered: t.vocabAnswered, correct: t.vocabCorrect, done: t.vocabDone, math: t.mathAnswered, mathRight: t.mathCorrect, mastered: t.mastered },
  { ms: 650_000, answered: 35, correct: 29, done: true, math: 2, mathRight: 1, mastered: 2 },
);
assert.equal(days[8].mathAnswered, 1);
assert.equal(days[0].mastered, 0);
assert.equal(days[1].mastered, 1);
assert.equal(days[7].mastered, 2);
assert.equal(days.find((d) => d.day === "2026-11-21")!.vocabDone, false, "two minutes, unfinished, isn't the day done");

// Weeks: whole weeks counted back from today, a short one first for what's left.
const weeks = dashboardWeeks(days, 0);
assert.deepEqual(weeks.map((w) => w.start), ["2026-11-17", "2026-11-20"]);
assert.equal(weeks[1].vocabAnswered, 60);
assert.equal(weeks[0].masteredGained, 1);
assert.equal(weeks[1].masteredGained, 1);
assert.equal(dashboardWeeks(days.slice(3), 1)[0].masteredGained, 1);

// Words to practice: the most missed first, then the ones due and not yet sure; never mastered, skipped or unmet.
const item = (id: string, rank: number): Item => ({
  id, type: "word", word: id.slice(2), pos: "adj", meaning: `means ${id}`, example: `an ${id} example`, hook: "", tone: "neutral",
  parts: [], tier: "core", rank, forms: {},
});
const prog = (item: string, p: Partial<Progress>): Progress => ({
  item, stage: 0, due_on: today, fast: false, first_seen_on: "2026-11-01", last_seen_on: "2026-11-25", last_correct_on: null,
  correct_days: 0, forms_right: [], last_form: null, seen: 3, right_count: 1, wrong_count: 0, dontknow_count: 0, mastered_at: null, ...p,
});
const items = ["w:a", "w:b", "w:c", "w:d", "w:e", "w:f", "w:g"].map(item);
const progress = new Map<string, Progress>([
  ["w:a", prog("w:a", { wrong_count: 2 })],
  ["w:b", prog("w:b", { wrong_count: 3, dontknow_count: 2 })],
  ["w:c", prog("w:c", { stage: 3, wrong_count: 5 })],
  ["w:d", prog("w:d", { removed_at: "2026-11-02", wrong_count: 5 })],
  ["w:e", prog("w:e", { due_on: "2026-11-20", stage: 1 })],
  ["w:f", prog("w:f", { due_on: "2026-12-01" })],
]);
const words = practiceWords(items, progress, today);
assert.deepEqual(words.map((w) => [w.id, w.reason, w.misses]), [["w:b", "trouble", 5], ["w:a", "trouble", 2], ["w:e", "due", 0]]);
assert.equal(words[0].meaning, "means w:b");
assert.equal(practiceWords(items, progress, today, 1).length, 1);

// Vocab's streak: days done in a row back from today, a day's sessions added up, and today not yet done doesn't break it.
const ten = 600_000;
const done = (day: string) => ({ day, elapsed_ms: ten, finished_at: `${day}T18:00:00Z` });
assert.equal(vocabStreak([done("2026-11-26"), done("2026-11-25"), done("2026-11-24"), done("2026-11-22")], today), 3);
assert.equal(vocabStreak([done("2026-11-25"), done("2026-11-24")], today), 2, "today still to do");
assert.equal(vocabStreak([{ day: today, elapsed_ms: 200_000, finished_at: null }, done("2026-11-25")], today), 1, "four minutes isn't the day done");
assert.equal(
  vocabStreak([{ day: today, elapsed_ms: 350_000, finished_at: null }, { day: today, elapsed_ms: 300_000, finished_at: null }], today),
  1,
  "two sessions make the ten minutes",
);
assert.equal(vocabStreak([done("2026-11-20")], today), 0);

// Math: the topics going worst that have enough answers behind them, and the latest misses.
const answer = (n: number, topic: string, correct: boolean): Answered => ({
  question: `M-${String(n).padStart(4, "0")}`, topic, section: "ma", chosen: correct ? 1 : n % 2 === 0 ? null : 2, correct, ms: 30_000,
  at: new Date(Date.parse("2026-11-26T18:00:00Z") + n * 60_000).toISOString(),
});
const answers: Answered[] = [
  // Fractions: 1 of 4. Geometry: 3 of 4. Ratios: 0 of 2, too few to say.
  answer(1, "fractions", false), answer(2, "fractions", false), answer(3, "fractions", true), answer(4, "fractions", false),
  answer(5, "geometry", true), answer(6, "geometry", true), answer(7, "geometry", false), answer(8, "geometry", true),
  answer(9, "ratios", false), answer(10, "ratios", false),
];
const math = dashboardMath(
  summarize({ kid: "k", name: "Sebastian Mason", level: "middle", today, tz, answers, runs: [{ stars: 900, economy: 2, waves: 4, depth: 3, bestStreak: 5 }] }),
);
assert.deepEqual(math.topics.map((t) => [t.topic, t.correct, t.answered]), [["fractions", 1, 4], ["geometry", 3, 4]]);
assert.deepEqual(math.misses.map((m) => m.question).slice(0, 3), ["M-0010", "M-0009", "M-0007"]);
assert.equal(math.misses.length, 6);
assert.equal(math.misses[0].timedOut, true, "no choice made is running out of time");
assert.deepEqual([math.runs, math.answeredTotal, math.correctTotal, math.best.streak], [1, 10, 4, 5]);
assert.equal(math.streak, 0, "ten answers isn't the day's twenty");
const many = Array.from({ length: 40 }, (_, i) => answer(100 + i, `topic${i % 8}`, false));
const lots = dashboardMath(summarize({ kid: "k", name: "K", level: "lower", today, tz, answers: many, runs: [] }));
assert.equal(lots.topics.length, 5);
assert.equal(lots.misses.length, 12);
assert.equal(lots.streak, 1);

// The purse: what the phone's house says it holds, and nothing made of a house that isn't there.
assert.deepEqual(dashboardHouse({ coins: 1240, gems: 3, rooms: ["bedroom", "kitchen"], placed: {} }), { coins: 1240, gems: 3, rooms: 2 });
assert.deepEqual(dashboardHouse({ coins: "lots", gems: -2 }), { coins: 0, gems: 0, rooms: 0 });
assert.equal(dashboardHouse(null), null);
assert.equal(dashboardHouse(undefined), null);

console.log("tuttles dashboard: ok");
