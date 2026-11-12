/**
 * Tuttles study sets: the level rules, the quiz planner, reading what the
 * tutor writes, and lifting its blocks out of a streaming reply
 * (src/lib/tuttles/study.ts, src/lib/tuttles/fences.ts).
 *
 * None of these throw when they break. A wrong level shows up as Sebastian
 * being told he's "Mastered" a topic after one lucky night; a greedy planner as
 * a quiz that's all his worst topic; a leaky fence filter as a multiple choice
 * card whose answer reached his phone.
 *
 *   npx tsx --tsconfig scripts/tsconfig.json scripts/verify-tuttles-study.mts
 */

import assert from "node:assert/strict";
import { FenceFilter } from "@/lib/tuttles/fences";
import {
  choiceIndex,
  overallFor,
  parseGrade,
  parseQuestion,
  parseSetDraft,
  planQuiz,
  topicProgress,
  type Outcome,
  type Result,
  type TopicState,
} from "@/lib/tuttles/study";

const DAY = 864e5;
const t0 = new Date("2026-11-02T18:00:00Z").getTime();
/** One quiz's answers on a topic, `day` days after t0. */
const quiz = (id: string, day: number, ...results: Result[]): Outcome[] =>
  results.map((result, i) => ({ result, quiz: id, at: new Date(t0 + day * DAY + i * 60e3) }));
const level = (...quizzes: Outcome[][]) => topicProgress(quizzes.flat()).level;

// --- Levels ---
assert.equal(level(), "new");
assert.equal(level(quiz("a", 0, "correct")), "shaky", "right the first time: some of it's there");
assert.equal(level(quiz("a", 0, "wrong")), "learning");
assert.equal(level(quiz("a", 0, "correct", "correct", "correct")), "shaky", "one quiz moves a topic one step, however many right");
assert.equal(level(quiz("a", 0, "correct"), quiz("b", 1, "correct")), "solid");
assert.equal(level(quiz("a", 0, "correct"), quiz("b", 0.1, "correct"), quiz("c", 0.2, "correct")), "solid", "no mastery from one evening's cramming");
assert.equal(level(quiz("a", 0, "correct"), quiz("b", 1, "correct"), quiz("c", 4, "correct")), "mastered");
assert.equal(level(quiz("a", 0, "correct"), quiz("b", 1, "hinted")), "shaky", "a hint holds it where it is");

// A miss drops a step, and it takes two clean quizzes to climb again.
const solid = [quiz("a", 0, "correct"), quiz("b", 1, "correct")];
assert.equal(level(...solid, quiz("c", 2, "correct", "wrong")), "shaky");
assert.equal(level(...solid, quiz("c", 2, "wrong"), quiz("d", 3, "correct")), "shaky", "one clean quiz isn't enough after a miss");
assert.equal(level(...solid, quiz("c", 2, "wrong"), quiz("d", 3, "correct"), quiz("e", 4, "correct")), "solid");
assert.equal(level(...solid, quiz("c", 2, "skipped")), "shaky", "a skip is a miss");
assert.equal(level(quiz("a", 0, "wrong"), quiz("b", 1, "wrong")), "learning", "never below learning once tried");
const p = topicProgress([...quiz("a", 0, "correct", "wrong"), ...quiz("b", 1, "hinted")]);
assert.deepEqual([p.asked, p.right], [3, 1]);
// Answers out of order still count in the order they happened.
assert.equal(level([...quiz("b", 1, "correct"), ...quiz("a", 0, "correct")]), "solid");

// --- Overall ---
const topic = (id: string, lvl: TopicState["level"], weight = 2, lastSeenDaysAgo: number | null = 3): TopicState => ({
  id,
  name: id,
  weight,
  level: lvl,
  lastSeen: lastSeenDaysAgo == null ? null : new Date(t0 - lastSeenDaysAgo * DAY),
  asked: lvl === "new" ? 0 : 4,
  right: 2,
  recovering: 0,
});
const now = new Date(t0);
assert.equal(overallFor([topic("a", "new"), topic("b", "new")], null, now).level, "new");
assert.equal(overallFor([topic("a", "solid"), topic("b", "solid")], null, now).level, "solid");
assert.equal(overallFor([topic("a", "mastered", 1), topic("b", "learning", 3)], null, now).level, "shaky", "weighted by how much of the test");
const close = overallFor([topic("a", "solid", 3), topic("b", "shaky", 2), topic("c", "new", 1)], "2026-11-05", now);
assert.equal(close.ready, 1);
assert.equal(close.note, "1 big topic still shaky");
assert.equal(overallFor([topic("a", "shaky", 2)], "2026-12-30", now).note, null, "no warning weeks out");

// --- Planning ---
const mix = [
  topic("weak1", "learning", 3),
  topic("weak2", "shaky", 2),
  topic("solid1", "solid", 2, 10),
  topic("solid2", "solid", 2, 1),
  topic("mastered", "mastered", 1, 20),
  topic("new1", "new", 2, null),
  topic("new2", "new", 1, null),
];
const plan = planQuiz(mix, 10, null, now);
assert.equal(plan.length, 10);
const per = (name: string) => plan.filter((s) => s.name === name).length;
assert.ok(per("weak1") <= 3 && per("weak2") <= 3, "no weak topic takes over");
const weakShare = plan.filter((s) => s.name.startsWith("weak")).length;
assert.ok(weakShare >= 4 && weakShare <= 6, `about half weak (got ${weakShare})`);
assert.ok(plan.some((s) => s.name.startsWith("new")), "new topics get a look");
assert.ok(plan.some((s) => s.name.startsWith("solid")), "solid topics get reviewed");
assert.notEqual(plan[0].reason, "weak", "opens on a likely win");
assert.ok(["finish", "review", "new"].includes(plan[plan.length - 1].reason), "ends on a likely win");
for (let i = 1; i < plan.length; i++) {
  assert.notEqual(plan[i].topicId, plan[i - 1].topicId, `no topic twice in a row (at ${i})`);
}

// The day before: every topic once before any repeats.
const rehearsal = planQuiz(mix, 10, "2026-11-03", now);
assert.equal(new Set(rehearsal.slice(0, 10).map((s) => s.topicId)).size, mix.length, "dress rehearsal covers everything");

// A one-topic vocab set still makes a full quiz.
assert.equal(planQuiz([topic("words", "shaky")], 5, null, now).length, 5);
assert.deepEqual(planQuiz([], 10, null, now), []);

// --- Reading what the tutor writes ---
const mc = parseQuestion(
  '{"topic":"Cells","kind":"choice","prompt":"Which makes proteins?","choices":["Mitochondria","Ribosome","Golgi body","Vacuole"],"answer":"B","explanation":"…"}',
);
assert.equal(mc?.answerIndex, 1);
assert.equal(mc?.answer, "Ribosome");
assert.equal(parseQuestion('{"prompt":"x?","choices":["a","b"],"answer":"Q"}'), null, "multiple choice must have a gradable answer");
assert.equal(parseQuestion('{"prompt":"Define osmosis.","kind":"short","answer":"…"}')?.kind, "short");
const tf = parseQuestion('{"prompt":"Plants make oxygen.","kind":"truefalse","answer":"True"}');
assert.deepEqual([tf?.choices, tf?.answerIndex], [["True", "False"], 0]);

const opts = ["A cat", "Dog", "Bird"];
assert.equal(choiceIndex("A cat", opts), 0, "an option's own words beat reading it as a letter");
assert.equal(choiceIndex("b", opts), 1);
assert.equal(choiceIndex("C)", opts), 2);
assert.equal(choiceIndex("bird", opts), 2);
assert.equal(choiceIndex(1, opts), 1);
assert.equal(choiceIndex("E", opts), null);

assert.deepEqual(parseGrade('{"result":"hinted"}'), { result: "hinted", choice: null, response: null });
assert.equal(parseGrade('{"result":"great"}'), null);

const set = parseSetDraft(
  '{"title":"Spanish vocab","testDate":"2026-11-14","topics":["Food",{"name":"food","weight":3},{"name":"Family","weight":9}],"coverage":"thin"}',
);
assert.deepEqual(set?.topics, [
  { name: "Food", weight: 2 },
  { name: "Family", weight: 3 },
]);
assert.equal(parseSetDraft('{"template":"isee"}')?.template, "isee");
assert.equal(parseSetDraft('{"testDate":"next friday"}')?.testDate, null);

// --- Lifting blocks out of a stream ---
async function run(chunks: string[]): Promise<{ shown: string; got: string[] }> {
  const got: string[] = [];
  const f = new FenceFilter(new Set(["question", "grade"]), async (lang, body) => {
    got.push(`${lang}:${body}`);
    return lang === "question" ? "```question\n{\"id\":\"q1\"}\n```\n" : "";
  });
  let shown = "";
  for (const c of chunks) shown += await f.push(c);
  shown += await f.end();
  return { shown, got };
}
const reply = 'Nice!\n```grade\n{"result":"correct"}\n```\nNext one:\n```question\n{"prompt":"x","answer":"SECRET"}\n```\n';
// Split every way a stream might: whole, by character, and in odd chunks.
for (const chunks of [[reply], [...reply], reply.match(/[\s\S]{1,7}/g)!]) {
  const { shown, got } = await run(chunks);
  assert.equal(shown, 'Nice!\nNext one:\n```question\n{"id":"q1"}\n```\n');
  assert.ok(!shown.includes("SECRET"), "an answer never streams out");
  assert.deepEqual(got, ['grade:{"result":"correct"}', 'question:{"prompt":"x","answer":"SECRET"}']);
}
// Other fences pass through untouched, and so does a lone backtick.
const other = "Use `x` here.\n```visual\n{\"type\":\"math\"}\n```\nDone";
assert.equal((await run([...other])).shown, other);
// A block the reply forgot to close is still handled.
const open = await run(['Q:\n```question\n{"prompt":"y","answer":"Z"}']);
assert.deepEqual(open.got, ['question:{"prompt":"y","answer":"Z"}']);
assert.ok(!open.shown.includes('"Z"'));

console.log("verify-tuttles-study: ok");
