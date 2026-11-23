/**
 * Plays made-up students through the Words schedule and writes down every
 * question it chose and where it left them, for the Tuttles app's tests to
 * play the same sessions through its own copy of the rules
 * (ios/Tuttles/Shared/VocabEngine.swift) and arrive at the same place.
 *
 *   npm run words:parity     writes ios/Tuttles/Tests/vocab-parity.json (scripts/words/write-parity.mts)
 *
 * `npm run verify:words` makes it again and fails if the file is out of date,
 * which is how a change to the schedule is noticed before the phone and the
 * website disagree.
 */
import { resolve } from "node:path";
import { buildOverview } from "@/lib/words/overview";
import { packItem } from "@/lib/words/pack";
import { addDays, applyAnswer, isTestDaySession, pickForm, pickNext, RULES } from "@/lib/words/schedule";
import type { Form, Item, PartItem, Progress, Result, WordItem } from "@/lib/words/types";

/** Where it's kept, from the top of the repo (where npm runs scripts). */
export const PARITY_FILE = resolve("ios/Tuttles/Tests/vocab-parity.json");

function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

function form(kind: Form["kind"], id: string, key: string): Form {
  return {
    kind,
    stem: `${id} ${key}?`,
    answer: `${id} ${key} right`,
    traps: [1, 2, 3].map((n) => ({ text: `${id} ${key} wrong ${n}`, why: n === 1 ? `Why not ${n}.` : undefined })),
    tip: `Tip for ${id} ${key}.`,
  };
}

// Made-up words: enough to run out of, most asked four ways, some two, a few only one.
const WORDS: WordItem[] = Array.from({ length: 140 }, (_, i) => {
  const name = `w${String(i + 1).padStart(3, "0")}`;
  const keys = i % 11 === 5 ? ["syn1"] : i % 7 === 3 ? ["syn1", "sc1"] : ["syn1", "sc1", "syn2", "sc2"];
  return {
    id: `w:${name}`,
    type: "word",
    word: name,
    pos: "adjective",
    meaning: `meaning of ${name}`,
    example: `An example of ${name}.`,
    hook: `A hook for ${name}.`,
    tone: "neutral",
    parts: i % 9 === 0 ? ["p:p01", "p:p02"] : [],
    tier: i < 60 ? "core" : "ext",
    rank: i + 1,
    forms: Object.fromEntries(keys.map((k) => [k, form(k.startsWith("syn") ? "syn" : "sc", name, k)])),
  };
});
const PARTS: PartItem[] = Array.from({ length: 14 }, (_, i) => {
  const name = `p${String(i + 1).padStart(2, "0")}`;
  return {
    id: `p:${name}`,
    type: "part",
    part: `${name}-`,
    kind: "prefix",
    meaning: `meaning of ${name}`,
    examples: [`${name}one`, `${name}two`],
    hook: `A hook for ${name}.`,
    rank: i + 1,
    forms: Object.fromEntries(["mean", "apply1", "apply2"].map((k) => [k, form("part", name, k)])),
  };
});
const ITEMS = new Map<string, Item>([...WORDS, ...PARTS].map((it) => [it.id, it]));

type Student = { name: string; start: string; days: number; perDay: number; total: number; knows: number; learns: number; skips: number[]; seed: number };

/** One student's sessions, kept the way the website keeps them (answerQuestion in src/lib/words/session.ts). */
function play(st: Student) {
  const rand = rng(st.seed);
  const progress = new Map<string, Progress>();
  const known = new Set([...WORDS, ...PARTS].filter(() => rand() < st.knows).map((it) => it.id));
  const shown = new Map<string, number>();
  const sessions = [];
  let today = st.start;

  for (let d = 0; d < st.days; d++) {
    today = addDays(st.start, d);
    if (st.skips.includes(d)) continue;
    for (let round = 0; round < st.perDay; round++) {
      const asked: string[] = [];
      let requeue: { item: string; at: number }[] = [];
      const steps = [];
      const tally = { correct: 0, wrong: 0, dontknow: 0, newItems: 0, masteredGained: 0, elapsedMs: 0 };
      // The last session of the run is left part way through, to check one that's still open.
      const stopAt = d === st.days - 1 && round === st.perDay - 1 ? 9 : st.total;
      for (let position = 1; position <= stopAt; position++) {
        const pick = pickNext({ words: WORDS, parts: PARTS, progress, today, position, total: st.total, asked, requeue });
        if (!pick) break;
        const item = ITEMS.get(pick.item)!;
        const before = progress.get(item.id) ?? null;
        const formKey = pickForm(item, before);
        const times = shown.get(item.id) ?? 0;
        const chance = known.has(item.id) ? 0.93 : Math.min(0.9, times * st.learns);
        const roll = rand();
        const result: Result = roll < chance ? "correct" : roll < chance + (1 - chance) * 0.5 ? "dontknow" : "wrong";
        const ms = 4000 + Math.floor(rand() * 16000);
        shown.set(item.id, times + 1);
        const after = applyAnswer(before, item.id, formKey, result, today, `${today}T20:00:00.000Z`);
        progress.set(item.id, after);
        const requeued = pick.why === "requeue";
        requeue = requeue.filter((r) => r.item !== item.id);
        if (result !== "correct" && !requeued) requeue.push({ item: item.id, at: position });
        asked.push(item.id);
        tally[result] += 1;
        tally.newItems += before ? 0 : 1;
        tally.masteredGained += before && after.stage >= 3 && before.stage < 3 ? 1 : 0;
        tally.elapsedMs += ms;
        steps.push({ item: item.id, form: formKey, isNew: !before, requeued, result, ms });
      }
      sessions.push({
        day: today,
        total: st.total,
        noDontKnow: isTestDaySession(today),
        finished: steps.length >= st.total,
        steps,
        ...tally,
        requeue,
      });
    }
  }

  const sorted = { through: 12, done: false };
  const overview = buildOverview({
    level: "lower",
    questions: st.total,
    today,
    words: WORDS,
    parts: PARTS,
    progress,
    // The newest first, as they're read from the database.
    sessions: sessions
      .map((s) => ({
        day: s.day,
        total: s.total,
        answered: s.steps.length,
        correct: s.correct,
        elapsed_ms: s.elapsedMs,
        limit_ms: 600_000,
        finished_at: s.finished ? `${s.day}T20:00:00.000Z` : null,
      }))
      .reverse(),
    sorted,
  });
  return { name: st.name, today, sort: sorted, sessions, progress: [...progress.values()].sort((a, b) => a.item.localeCompare(b.item)), overview };
}

export function parity(): string {
  const students: Student[] = [
    // The ordinary weeks: several sessions a day, about half the words known going in.
    { name: "several-a-day", start: "2026-11-23", days: 7, perDay: 3, total: 25, knows: 0.5, learns: 0.3, skips: [], seed: 11 },
    // Runs out of new words, misses days, and goes through the last week (no new words, test-day sessions) and past the test.
    { name: "to-the-test", start: "2026-12-27", days: 18, perDay: 2, total: 25, knows: 0.75, learns: 0.4, skips: [3, 4, 9], seed: 29 },
    // Knows very little: the reviews pile up and crowd the new words out.
    { name: "knows-little", start: "2026-12-01", days: 8, perDay: 2, total: 18, knows: 0.05, learns: 0.2, skips: [5], seed: 5 },
  ];
  return (
    JSON.stringify({
      rules: RULES,
      words: WORDS.map(packItem),
      parts: PARTS.map(packItem),
      runs: students.map(play),
    }) + "\n"
  );
}
