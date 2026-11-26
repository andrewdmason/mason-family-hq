/**
 * Math in the Tuttles app: what the phone is allowed to send, and what its
 * answers and runs are added up to for the phone and the parents
 * (src/lib/tuttles/math.ts).
 *
 * None of these throw when they break. A day reckoned in the wrong time zone
 * shows up as a kid's evening questions counting for tomorrow; a check on
 * what's sent that refuses too much as a phone sending the same bad answer
 * again, for ever, with every good one stuck behind it.
 *
 *   npm run verify:tuttles-math
 */

import assert from "node:assert/strict";
import {
  bestOf,
  board,
  countDays,
  dayIn,
  firstName,
  goalStreak,
  lastDays,
  MATH_DAY_GOAL,
  MAX_ANSWERS,
  MAX_RUNS,
  MAX_STATE_BYTES,
  parseSync,
  recentMisses,
  stateForPhone,
  summarize,
  topicStats,
  topRuns,
  type Answered,
  type SyncInput,
} from "@/lib/tuttles/math";

let checks = 0;
function check(what: string, fn: () => void) {
  fn();
  checks++;
  console.log(`  ok ${what}`);
}

const TZ = "America/Los_Angeles";
const RUN_ID = "0B1E6C1E-6B0B-4E0C-9C55-0D7C2E5B8A01";
const ANSWER_ID = "7f3c1f0a-51a4-4f58-9a0e-3f0d7b6a2c11";

const run = (over: Record<string, unknown> = {}) => ({
  id: RUN_ID,
  startedAt: "2026-11-25T16:00:00Z",
  endedAt: "2026-11-25T16:04:30Z",
  score: 1200,
  distance: 840,
  waves: 6,
  depth: 2,
  stars: 14,
  answered: 9,
  correct: 7,
  bestStreak: 4,
  ...over,
});
const answer = (over: Record<string, unknown> = {}) => ({
  id: ANSWER_ID,
  run: RUN_ID,
  question: "L-0001",
  topic: "Fractions",
  section: "qr",
  difficulty: 2,
  chosen: 1,
  correct: true,
  ms: 8400,
  at: "2026-11-25T16:01:00Z",
  ...over,
});

const taken = (body: unknown): SyncInput => {
  const out = parseSync(body);
  assert.ok(!("error" in out), `refused: ${"error" in out ? out.error : ""}`);
  return out;
};
/** A call with one thing wrong in it is still taken, with that one thing left out and counted. */
const droppedRun = (r: unknown) => {
  const out = taken({ runs: [run(), r], answers: [answer()] });
  assert.equal(out.runs.length, 1, `kept a bad run: ${JSON.stringify(r)}`);
  assert.equal(out.answers.length, 1);
  assert.deepEqual(out.dropped, { runs: 1, answers: 0, state: false });
};
const droppedAnswer = (a: unknown) => {
  const out = taken({ runs: [run()], answers: [a, answer()] });
  assert.equal(out.answers.length, 1, `kept a bad answer: ${JSON.stringify(a)}`);
  assert.equal(out.answers[0].id, ANSWER_ID);
  assert.equal(out.runs.length, 1);
  assert.deepEqual(out.dropped, { runs: 0, answers: 1, state: false });
};
const droppedState = (state: unknown, phoneRev: number) => {
  const out = taken({ runs: [run()], answers: [answer()], state });
  assert.equal(out.state, null, `kept a bad state: ${JSON.stringify(state)?.slice(0, 60)}`);
  assert.equal(out.phoneRev, phoneRev);
  assert.equal(out.runs.length, 1);
  assert.equal(out.answers.length, 1);
  assert.deepEqual(out.dropped, { runs: 0, answers: 0, state: true });
};
const refused = (body: unknown, status: number, reason: RegExp) => {
  const out = parseSync(body);
  assert.ok("error" in out, "taken, and shouldn't have been");
  assert.equal(out.status, status);
  assert.match(out.error, reason);
};

console.log("what the phone sends");

check("a whole call is taken, ids in lower case", () => {
  const out = taken({ runs: [run()], answers: [answer()], state: { rev: 3, json: { stars: 14 } } });
  assert.equal(out.runs.length, 1);
  assert.equal(out.runs[0].id, RUN_ID.toLowerCase());
  assert.equal(out.answers[0].run, RUN_ID.toLowerCase());
  assert.equal(out.runs[0].bestStreak, 4);
  assert.deepEqual(out.state, { rev: 3, json: { stars: 14 } });
  assert.equal(out.phoneRev, 3);
  assert.deepEqual(out.dropped, { runs: 0, answers: 0, state: false });
});

check("nothing to send is fine: empty lists, lists left out, no state", () => {
  const nothing = { runs: [], answers: [], state: null, phoneRev: null, dropped: { runs: 0, answers: 0, state: false } };
  assert.deepEqual(taken({ runs: [], answers: [], state: null }), nothing);
  assert.deepEqual(taken({}), nothing);
  assert.deepEqual(taken({ runs: null, answers: null }), nothing);
});

check("a body that isn't an object is refused", () => {
  for (const body of [null, undefined, "runs", 4, [run()]]) refused(body, 400, /JSON object/);
  refused({ runs: "all of them" }, 400, /runs must be a list/);
  refused({ answers: { 0: answer() } }, 400, /answers must be a list/);
});

check("a bad run is dropped, and the rest of the call is taken", () => {
  droppedRun(run({ id: "nope" }));
  droppedRun(run({ startedAt: "yesterday" }));
  droppedRun(run({ endedAt: null }));
  droppedRun(run({ score: -1 }));
  droppedRun(run({ distance: 12.5 }));
  droppedRun(run({ waves: "6" }));
  droppedRun(run({ depth: undefined }));
  droppedRun(run({ stars: 2 ** 31 }));
  droppedRun(run({ answered: NaN }));
  droppedRun(run({ bestStreak: Infinity }));
  droppedRun("a run");
  droppedRun(null);
});

check("a bad answer is dropped, and the rest of the call is taken", () => {
  droppedAnswer(answer({ id: 7 }));
  droppedAnswer(answer({ run: "the last one" }));
  droppedAnswer(answer({ question: "" }));
  droppedAnswer(answer({ question: "L".repeat(41) }));
  droppedAnswer(answer({ topic: "t".repeat(61) }));
  droppedAnswer(answer({ section: "vr" }));
  droppedAnswer(answer({ difficulty: 0 }));
  droppedAnswer(answer({ difficulty: 4 }));
  droppedAnswer(answer({ chosen: 4 }));
  droppedAnswer(answer({ chosen: -1 }));
  droppedAnswer(answer({ chosen: "b" }));
  droppedAnswer(answer({ correct: 1 }));
  droppedAnswer(answer({ ms: -5 }));
  droppedAnswer(answer({ ms: 8400.5 }));
  droppedAnswer(answer({ at: "noon" }));
  droppedAnswer(null);
  droppedAnswer([answer()]);
});

check("every bad thing in a call is counted, and a call of nothing else is still a 200", () => {
  const out = taken({ runs: [run({ score: -1 }), 4], answers: [answer({ section: "vr" }), "x", answer({ ms: null })], state: "saved" });
  assert.deepEqual(out.runs, []);
  assert.deepEqual(out.answers, []);
  assert.equal(out.state, null);
  assert.deepEqual(out.dropped, { runs: 2, answers: 3, state: true });
});

check("the clock running out is an answer with nothing chosen", () => {
  assert.equal(taken({ answers: [answer({ chosen: null, correct: false })] }).answers[0].chosen, null);
  assert.equal(taken({ answers: [answer({ chosen: undefined, correct: false })] }).answers[0].chosen, null);
  assert.equal(taken({ answers: [answer({ chosen: 0 })] }).answers[0].chosen, 0);
});

check("the same id twice in a call is one: a run's later copy, an answer's first", () => {
  const out = taken({
    runs: [run({ score: 100 }), run({ id: RUN_ID.toLowerCase(), score: 250 })],
    answers: [answer({ correct: true }), answer({ id: ANSWER_ID.toUpperCase(), correct: false })],
  });
  assert.equal(out.runs.length, 1);
  assert.equal(out.runs[0].score, 250);
  assert.equal(out.answers.length, 1);
  assert.equal(out.answers[0].correct, true);
});

check("a run says its economy: 1 when it doesn't, and a bad one is dropped", () => {
  assert.equal(taken({ runs: [run()] }).runs[0].economy, 1);
  assert.equal(taken({ runs: [run({ economy: 2 })] }).runs[0].economy, 2);
  const out = taken({ runs: [run({ economy: 0 }), run({ id: "11111111-1111-4111-8111-111111111111", economy: "2" })] });
  assert.equal(out.runs.length, 0);
  assert.equal(out.dropped.runs, 2);
});

check("more than a call may carry is refused whole", () => {
  taken({ runs: Array.from({ length: MAX_RUNS }, () => run()) });
  refused({ runs: Array.from({ length: MAX_RUNS + 1 }, () => run()) }, 413, /too many runs/);
  refused({ answers: Array.from({ length: MAX_ANSWERS + 1 }, () => answer()) }, 413, /too many answers/);
  // Counted as sent, bad ones and all: the phone can send it in pieces.
  refused({ answers: Array.from({ length: MAX_ANSWERS + 1 }, () => null) }, 413, /too many answers/);
});

check("the phone's state: an object with a rev, and not too big; one that isn't is left out", () => {
  const ok = taken({ state: { rev: 0, json: {} } });
  assert.deepEqual(ok.state, { rev: 0, json: {} });
  assert.equal(ok.phoneRev, 0);
  // No rev to go by: nothing kept here is to be taken for newer than the phone's.
  droppedState("saved", Infinity);
  droppedState([], Infinity);
  droppedState({ rev: -1, json: {} }, Infinity);
  droppedState({ rev: 1.5, json: {} }, Infinity);
  droppedState({ json: {} }, Infinity);
  // A rev that can be read still counts, whatever's wrong with the rest.
  droppedState({ rev: 7 }, 7);
  droppedState({ rev: 7, json: [1, 2] }, 7);
  droppedState({ rev: 7, json: "{}" }, 7);
  // {"pad":"…"} is ten characters more than what's in it.
  assert.ok(taken({ state: { rev: 1, json: { pad: "x".repeat(MAX_STATE_BYTES - 10) } } }).state);
  droppedState({ rev: 7, json: { pad: "x".repeat(MAX_STATE_BYTES - 9) } }, 7);
  // Counted in bytes, not characters.
  droppedState({ rev: 7, json: { pad: "é".repeat(MAX_STATE_BYTES / 2) } }, 7);
});

check("the state kept here goes back only when it's newer than the phone's", () => {
  const stored = { rev: 5, json: { stars: 40 } };
  assert.equal(stateForPhone(null, null), null);
  assert.equal(stateForPhone(null, 3), null);
  assert.deepEqual(stateForPhone(stored, null), stored);
  assert.deepEqual(stateForPhone(stored, 4), stored);
  assert.equal(stateForPhone(stored, 5), null);
  assert.equal(stateForPhone(stored, 6), null);
  // The phone sent a state that couldn't be read: its own stands.
  assert.equal(stateForPhone(stored, Infinity), null);
});

console.log("what it adds up to");

const given = (at: string, over: Partial<Answered> = {}): Answered => ({
  question: "L-0001",
  topic: "Fractions",
  section: "qr",
  chosen: 1,
  correct: true,
  ms: 5000,
  at,
  ...over,
});
/** `n` answers on a day, at noon in Los Angeles (8pm UTC in winter). */
const onDay = (day: string, n: number, over: Partial<Answered> = {}) => Array.from({ length: n }, () => given(`${day}T20:00:00Z`, over));

check("a day is the family's, not the server's", () => {
  const dayOf = dayIn(TZ);
  // Seven in the evening in Los Angeles is already tomorrow in UTC.
  assert.equal(dayOf("2026-11-26T03:00:00Z"), "2026-11-25");
  assert.equal(dayOf("2026-11-26T07:59:59Z"), "2026-11-25");
  assert.equal(dayOf("2026-11-26T08:00:00Z"), "2026-11-26");
  // Summer time: midnight is 7am UTC.
  assert.equal(dayOf("2026-07-04T06:59:59Z"), "2026-07-03");
  assert.equal(dayOf("2026-07-04T07:00:00Z"), "2026-07-04");
  assert.equal(dayOf(new Date("2026-11-26T03:00:00Z")), "2026-11-25");
  // However the phone wrote the time.
  assert.equal(dayOf("2026-11-25T19:00:00-08:00"), "2026-11-25");
  assert.equal(dayIn("Asia/Tokyo")("2026-11-25T16:00:00Z"), "2026-11-26");
});

check("answers are counted by day, right and wrong together", () => {
  const days = countDays(
    [given("2026-11-26T03:00:00Z"), given("2026-11-26T04:00:00Z", { correct: false }), given("2026-11-26T09:00:00Z")],
    TZ,
  );
  assert.deepEqual(days.get("2026-11-25"), { day: "2026-11-25", answered: 2, correct: 1 });
  assert.deepEqual(days.get("2026-11-26"), { day: "2026-11-26", answered: 1, correct: 1 });
  assert.equal(countDays([], TZ).size, 0);
});

check("the last 14 days, oldest first, with the empty ones", () => {
  const days = lastDays(countDays([...onDay("2026-11-25", 3), ...onDay("2026-11-12", 2), ...onDay("2026-11-11", 9)], TZ), "2026-11-25");
  assert.equal(days.length, 14);
  assert.equal(days[0].day, "2026-11-12");
  assert.equal(days[0].answered, 2);
  assert.equal(days[13].day, "2026-11-25");
  assert.equal(days[13].answered, 3);
  assert.deepEqual(days[5], { day: "2026-11-17", answered: 0, correct: 0 });
  // The 11th is a day too far back.
  assert.equal(days.reduce((n, d) => n + d.answered, 0), 5);
  // Across the turn of a month and a year.
  assert.equal(lastDays(new Map(), "2027-01-03")[0].day, "2026-12-21");
});

check("the streak: days in a row with 20 answered, up to today or yesterday", () => {
  const goal = MATH_DAY_GOAL;
  const streakOf = (answers: Answered[], today = "2026-11-25") => goalStreak(countDays(answers, TZ), today);
  assert.equal(streakOf([]), 0);
  assert.equal(streakOf(onDay("2026-11-25", goal)), 1);
  // One short doesn't count, and wrong answers count as much as right ones.
  assert.equal(streakOf(onDay("2026-11-25", goal - 1)), 0);
  assert.equal(streakOf(onDay("2026-11-25", goal, { correct: false })), 1);
  const three = [...onDay("2026-11-23", goal), ...onDay("2026-11-24", goal + 5), ...onDay("2026-11-25", goal)];
  assert.equal(streakOf(three), 3);
  // Today not done yet: yesterday's streak still stands.
  assert.equal(streakOf([...onDay("2026-11-23", goal), ...onDay("2026-11-24", goal), ...onDay("2026-11-25", 4)]), 2);
  // A day missed breaks it.
  assert.equal(streakOf([...onDay("2026-11-22", goal), ...onDay("2026-11-24", goal), ...onDay("2026-11-25", goal)]), 2);
  // Nothing yesterday or today: gone.
  assert.equal(streakOf(onDay("2026-11-23", goal)), 0);
  // Twenty across midnight is ten each side, not a day done.
  const late = Array.from({ length: 10 }, () => given("2026-11-26T07:30:00Z"));
  const early = Array.from({ length: 10 }, () => given("2026-11-26T08:30:00Z"));
  assert.equal(streakOf([...late, ...early], "2026-11-26"), 0);
});

check("topics: the worst first, then the one with more behind it", () => {
  const of = (section: "qr" | "ma", topic: string, right: number, wrong: number, ms = 1000) => [
    ...Array.from({ length: right }, () => given("2026-11-25T20:00:00Z", { section, topic, ms })),
    ...Array.from({ length: wrong }, () => given("2026-11-25T20:00:00Z", { section, topic, ms, correct: false })),
  ];
  const stats = topicStats([
    ...of("qr", "Fractions", 3, 1),
    ...of("ma", "Geometry", 1, 3),
    ...of("qr", "Ratios", 2, 6),
    ...of("ma", "Decimals", 5, 0),
    // The same name in the other section is its own topic.
    ...of("ma", "Fractions", 0, 2),
  ]);
  assert.deepEqual(
    stats.map((t) => `${t.section}:${t.topic}`),
    ["ma:Fractions", "qr:Ratios", "ma:Geometry", "qr:Fractions", "ma:Decimals"],
  );
  assert.deepEqual(stats[1], { section: "qr", topic: "Ratios", answered: 8, correct: 2, avgMs: 1000 });
  // The average is over every answer, to the nearest millisecond.
  const mixed = topicStats([given("x", { ms: 1000 }), given("x", { ms: 2000 }), given("x", { ms: 2001 })]);
  assert.equal(mixed[0].avgMs, 1667);
  assert.deepEqual(topicStats([]), []);
});

check("misses: the 30 latest wrong answers, newest first, and whether time ran out", () => {
  const answers = [
    given("2026-11-25T20:00:00Z", { question: "L-0001", correct: false, chosen: 2 }),
    given("2026-11-25T20:05:00Z", { question: "L-0002" }),
    given("2026-11-25T20:10:00-08:00", { question: "L-0003", correct: false, chosen: null }),
    given("2026-11-24T20:00:00Z", { question: "L-0004", correct: false, chosen: 0 }),
  ];
  const misses = recentMisses(answers);
  assert.deepEqual(misses.map((m) => m.question), ["L-0003", "L-0001", "L-0004"]);
  assert.deepEqual(misses[0], { question: "L-0003", topic: "Fractions", section: "qr", at: "2026-11-26T04:10:00.000Z", timedOut: true });
  assert.equal(misses[1].timedOut, false);
  // Picking the first choice isn't running out of time.
  assert.equal(misses[2].timedOut, false);
  const many = Array.from({ length: 45 }, (_, i) => given(new Date(Date.UTC(2026, 10, 1, 0, i)).toISOString(), { question: `L-${i}`, correct: false }));
  const latest = recentMisses(many);
  assert.equal(latest.length, 30);
  assert.equal(latest[0].question, "L-44");
  assert.equal(latest[29].question, "L-15");
});

check("bests are each thing's own best, not one run's", () => {
  assert.deepEqual(bestOf([]), { score: 0, waves: 0, depth: 0, streak: 0 });
  assert.deepEqual(
    bestOf([
      { stars: 900, economy: 2, waves: 3, depth: 4, bestStreak: 2 },
      { stars: 400, economy: 2, waves: 8, depth: 1, bestStreak: 11 },
    ]),
    { score: 900, waves: 8, depth: 4, streak: 11 },
  );
  // Stars from before they were the score don't count for it.
  assert.equal(bestOf([{ stars: 5000, economy: 1, waves: 1, depth: 0, bestStreak: 0 }]).score, 0);
});

check("the top 10s: runs not players, today's by the family's day, ties to the earlier", () => {
  const names = new Map([
    ["seb", "Sebastian Mason"],
    ["oscar", "Oscar"],
  ]);
  const at = (h: number, day = "2026-11-26") => `${day}T${String(h).padStart(2, "0")}:00:00Z`;
  const runs = [
    ...Array.from({ length: 12 }, (_, i) => ({ id: `s${i}`, userId: "seb", stars: 100 + i, endedAt: at(18, "2026-11-20") })),
    { id: "o1", userId: "oscar", stars: 300, endedAt: at(20) },
    { id: "o2", userId: "oscar", stars: 300, endedAt: at(19) },
    // 7pm in Los Angeles on the 25th, though it's the 26th in UTC.
    { id: "late", userId: "seb", stars: 999, endedAt: at(3) },
    { id: "who", userId: "someone", stars: 5000, endedAt: at(20) },
  ];
  const top = topRuns(runs, names, "oscar", "2026-11-26", TZ);
  assert.equal(top.all.length, 10);
  assert.deepEqual(top.all.slice(0, 3).map((r) => r.id), ["late", "o2", "o1"]);
  assert.equal(top.all[1].name, "Oscar");
  assert.equal(top.all[1].me, true);
  assert.equal(top.all[0].name, "Sebastian");
  assert.equal(top.all[0].me, false);
  assert.deepEqual(top.today.map((r) => r.id), ["o2", "o1"]);
  assert.ok(!top.all.some((r) => r.id === "who"));
});

check("the board has both brothers, one who hasn't played included", () => {
  const kids = [
    { kid: "seb", name: "Sebastian Mason" },
    { kid: "oscar", name: "Oscar" },
  ];
  const tallies = new Map([
    [
      "seb",
      {
        runs: [
          { stars: 900, economy: 2, waves: 3, depth: 4, bestStreak: 2 },
          { stars: 400, economy: 2, waves: 8, depth: 1, bestStreak: 11 },
        ],
        answeredToday: 12,
        answeredTotal: 340,
        correctTotal: 251,
      },
    ],
  ]);
  const out = board(kids, "oscar", tallies);
  assert.deepEqual(out[0], {
    kid: "seb",
    name: "Sebastian",
    me: false,
    bestScore: 900,
    bestWaves: 8,
    bestDepth: 4,
    bestStreak: 11,
    answeredToday: 12,
    answeredTotal: 340,
    correctTotal: 251,
  });
  assert.deepEqual(out[1], {
    kid: "oscar",
    name: "Oscar",
    me: true,
    bestScore: 0,
    bestWaves: 0,
    bestDepth: 0,
    bestStreak: 0,
    answeredToday: 0,
    answeredTotal: 0,
    correctTotal: 0,
  });
  assert.equal(firstName("  "), "Kid");
});

check("a kid's summary is all of it together", () => {
  const answers = [
    ...onDay("2026-11-24", 20),
    ...onDay("2026-11-25", 6, { topic: "Geometry", section: "ma" }),
    ...onDay("2026-11-25", 2, { topic: "Geometry", section: "ma", correct: false, chosen: null }),
  ];
  const s = summarize({
    kid: "oscar",
    name: "Oscar",
    level: "lower",
    today: "2026-11-25",
    tz: TZ,
    answers,
    runs: [{ stars: 700, economy: 2, waves: 5, depth: 2, bestStreak: 6 }],
  });
  assert.deepEqual(s.today, { day: "2026-11-25", answered: 8, correct: 6 });
  assert.equal(s.days.length, 14);
  assert.deepEqual(s.days[12], { day: "2026-11-24", answered: 20, correct: 20 });
  assert.equal(s.streak, 1);
  assert.deepEqual(s.topics.map((t) => t.topic), ["Geometry", "Fractions"]);
  assert.equal(s.misses.length, 2);
  assert.equal(s.misses[0].timedOut, true);
  assert.deepEqual(s.best, { score: 700, waves: 5, depth: 2, streak: 6 });
  assert.equal(s.runs, 1);
  assert.equal(s.answeredTotal, 28);
  assert.equal(s.correctTotal, 26);
  assert.equal(s.level, "lower");

  // Nobody's played: all there, all zeros.
  const none = summarize({ kid: "seb", name: "Sebastian", level: "middle", today: "2026-11-25", tz: TZ, answers: [], runs: [] });
  assert.deepEqual(none.today, { day: "2026-11-25", answered: 0, correct: 0 });
  assert.equal(none.days.length, 14);
  assert.equal(none.streak, 0);
  assert.deepEqual(none.topics, []);
  assert.deepEqual(none.misses, []);
  assert.deepEqual(none.best, { score: 0, waves: 0, depth: 0, streak: 0 });
});

console.log(`\ntuttles math: all ${checks} checks passed`);
