/**
 * This Week: where the week ends, and what the When box's type-ahead offers.
 *
 * Neither of these throws when it breaks. A wrong week boundary shows up as next
 * Monday's snoozes appearing in the reveal under This Week; a greedy suggestion
 * shows up as "th" + Enter filing a task under This Week instead of snoozing it
 * to Thursday.
 *
 *   npx tsx --tsconfig scripts/tsconfig.json scripts/verify-todos-week.mts
 */

import assert from "node:assert/strict";
import { deriveViewTasks, deriveWeekSnoozedTasks } from "@/lib/todos/derive";
import { snoozePresets, startOfNextWeek } from "@/lib/todos/snooze";
import type { TodoTask } from "@/lib/todos/types";
import { suggestWhen } from "@/lib/todos/when-suggest";

const ME = "me@example.com";

function task(id: string, overrides: Partial<TodoTask>): TodoTask {
  return {
    id,
    title: id,
    bucket: "today",
    assigneeEmail: ME,
    creatorEmail: ME,
    snoozedUntil: null,
    sortOrder: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as TodoTask;
}

// 2026-11-02 is a Monday; months are 0-based.
const monday = new Date(2026, 10, 2, 9);
const wednesday = new Date(2026, 10, 4, 9);
const sunday = new Date(2026, 10, 8, 20);
const followingMonday = new Date(2026, 10, 9);

// The week runs through Sunday night, and a Monday's week is a full one.
assert.equal(startOfNextWeek(monday).getTime(), followingMonday.getTime());
assert.equal(startOfNextWeek(wednesday).getTime(), followingMonday.getTime());
assert.equal(startOfNextWeek(sunday).getTime(), followingMonday.getTime());

// The "Next week" snooze still lands where the week turns over, and still drops
// off on Sunday, when "Tomorrow" already says it.
const nextWeekPreset = (now: Date) =>
  snoozePresets(now).find((p) => p.key === "next-week");
assert.equal(
  nextWeekPreset(wednesday)?.when.getTime(),
  followingMonday.getTime()
);
assert.equal(nextWeekPreset(sunday), undefined);

const iso = (d: Date) => d.toISOString();
const tasks = [
  task("friday", { snoozedUntil: iso(new Date(2026, 10, 6)) }),
  task("thursday", { snoozedUntil: iso(new Date(2026, 10, 5)) }),
  task("sunday-night", { snoozedUntil: iso(new Date(2026, 10, 8, 23, 59)) }),
  // "Next week" wakes at exactly Monday midnight — that's next week's.
  task("next-monday", { snoozedUntil: iso(followingMonday) }),
  task("someone-elses", {
    assigneeEmail: "other@example.com",
    snoozedUntil: iso(new Date(2026, 10, 5)),
  }),
  task("filed", { bucket: "week" }),
  task("filed-then-snoozed", {
    bucket: "week",
    snoozedUntil: iso(new Date(2026, 10, 7)),
  }),
  task("anytime", { bucket: "anytime" }),
];

// The reveal: mine, soonest first, stopping at Sunday night.
assert.deepEqual(
  deriveWeekSnoozedTasks(tasks, ME, wednesday).map((t) => t.id),
  ["thursday", "friday", "filed-then-snoozed", "sunday-night"]
);

// The list itself: only what's filed there and awake, so the sidebar count
// never includes the snoozed tasks.
assert.deepEqual(
  deriveViewTasks(tasks, "week", ME).map((t) => t.id),
  ["filed"]
);

const first = (q: string) => {
  const top = suggestWhen(q, wednesday)[0];
  return top?.kind === "bucket" ? top.bucket : top?.label;
};

// Spelled out, it's the list — ahead of "This weekend".
assert.equal(first("this"), "week");
assert.equal(first("this week"), "week");
assert.equal(first("week"), "week");
assert.equal(first("wee"), "week");
assert.ok(suggestWhen("this week", wednesday).some((s) => s.label === "This weekend"));

// Shorter prefixes keep what they already meant.
assert.equal(first("t"), "today");
assert.notEqual(first("th"), "week");
assert.notEqual(first("w"), "week");
assert.notEqual(first("we"), "week");

// "this weekend" and "next week" are still dates.
assert.equal(first("this weeke"), "This weekend");
assert.equal(first("next week"), "Next week");

console.log("verify-todos-week: all checks passed");
