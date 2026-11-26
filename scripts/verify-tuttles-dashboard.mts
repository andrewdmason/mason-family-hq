/**
 * The Parent Dashboard's sums (src/lib/tuttles/dashboard.ts): each day's
 * Vocab and Math, the weeks they add up to, and the words to practice.
 *
 *   npm run verify:tuttles-dashboard
 */

import assert from "node:assert/strict";
import { dashboardDays, dashboardWeeks, practiceWords } from "../src/lib/tuttles/dashboard";
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

console.log("tuttles dashboard: ok");
