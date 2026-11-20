/**
 * Runs the Words schedule (src/lib/words/schedule.ts) through every day from
 * now to the test for a few made-up students, and checks the promises it
 * makes: a miss comes back later in the session and the next day, a word is
 * never asked the same way twice running, reviews don't pile up past what a
 * day can clear, word parts are all met in the first weeks, and no new words
 * arrive in the last week.
 *
 *   npm run verify:words
 */
import { allParts, wordsFor } from "@/lib/words/content";
import { addDays, applyAnswer, daysBetween, newWordsAllowed, pickForm, pickNext, TEST_DATE } from "@/lib/words/schedule";
import { statusOf, type Level, type Progress, type Result } from "@/lib/words/types";

let failures = 0;
function check(ok: boolean, what: string) {
  if (!ok) {
    failures++;
    console.log(`  FAIL ${what}`);
  }
}

// A small seeded generator so a run can be repeated.
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

type Student = { name: string; level: Level; total: number; knows: number; learns: number; skips: number[]; perDay?: number };

function simulate(st: Student, start: string) {
  const rand = rng(st.name.length * 7919);
  const words = wordsFor(st.level);
  const parts = allParts();
  const progress = new Map<string, Progress>();
  // What they walk in knowing, and how many times they've been shown each of the rest.
  const known = new Set([...words, ...parts].filter(() => rand() < st.knows).map((it) => it.id));
  const shown = new Map<string, number>();
  const days = daysBetween(start, TEST_DATE);
  let maxDue = 0;
  let newInLastWeek = 0;
  let sessions = 0;

  for (let d = 0; d < days; d++) {
    const today = addDays(start, d);
    if (st.skips.includes(d)) continue;
    for (let round = 0; round < (st.perDay ?? 1); round++) {
    sessions++;
    const asked: string[] = [];
    let requeue: { item: string; at: number }[] = [];
    const due = [...progress.values()].filter((p) => p.due_on <= today).length;
    maxDue = Math.max(maxDue, due);
    const missedToday = new Map<string, number>();

    for (let position = 1; position <= st.total; position++) {
      const pick = pickNext({ words, parts, progress, today, position, total: st.total, asked, requeue });
      check(!!pick, `${st.name} day ${d} q${position}: nothing to ask`);
      if (!pick) break;
      const item = [...words, ...parts].find((it) => it.id === pick.item)!;
      const before = progress.get(item.id) ?? null;
      const form = pickForm(item, before);
      check(!before || before.last_form !== form || Object.keys(item.forms).length === 1, `${st.name}: ${item.id} asked as ${form} twice running`);
      if (!before && item.type === "word") {
        check(newWordsAllowed(today), `${st.name}: new word ${item.id} on ${today}, inside the last week`);
        if (!newWordsAllowed(today)) newInLastWeek++;
      }
      if (pick.why === "requeue") {
        const at = missedToday.get(item.id)!;
        check(position - at > 3 || st.total - position < requeue.length + 1, `${st.name}: ${item.id} came back after only ${position - at} questions`);
      }
      const times = shown.get(item.id) ?? 0;
      const chance = known.has(item.id) ? 0.95 : Math.min(0.95, times * st.learns);
      const roll = rand();
      const result: Result = roll < chance ? "correct" : roll < chance + (1 - chance) * 0.6 ? "dontknow" : "wrong";
      shown.set(item.id, times + 1);
      progress.set(item.id, applyAnswer(before, item.id, form, result, today, `${today}T20:00:00Z`));
      requeue = requeue.filter((r) => r.item !== item.id);
      if (result !== "correct" && pick.why !== "requeue") {
        requeue.push({ item: item.id, at: position });
        missedToday.set(item.id, position);
      }
      if (result !== "correct") check(progress.get(item.id)!.due_on === addDays(today, 1), `${st.name}: missed ${item.id} isn't due tomorrow`);
      asked.push(item.id);
    }
    }
  }

  const count = { new: 0, learning: 0, almost: 0, mastered: 0 };
  for (const w of words) count[statusOf(progress.get(w.id))]++;
  const partsMet = parts.filter((p) => progress.has(p.id)).length;
  const partsMastered = parts.filter((p) => statusOf(progress.get(p.id)) === "mastered").length;
  console.log(
    `${st.name} (${st.level}, knew ${Math.round(st.knows * 100)}% going in, ${sessions} sessions): met ${words.length - count.new} of ${words.length} words; mastered ${count.mastered}, almost ${count.almost}, learning ${count.learning}. Parts met ${partsMet}/${parts.length}, mastered ${partsMastered}. Most due on one morning: ${maxDue}.`
  );
  check(newInLastWeek === 0, `${st.name}: ${newInLastWeek} new words in the last week`);
  check(partsMet === parts.length, `${st.name}: only ${partsMet} parts met`);
  check(maxDue <= st.total * 3, `${st.name}: ${maxDue} due at once, more than three sessions' worth`);
  check(count.mastered >= 80, `${st.name}: only ${count.mastered} mastered`);
  return count;
}

// Unit checks on what one answer does.
{
  const day = "2026-12-01";
  const first = applyAnswer(null, "w:x", "syn1", "correct", day, "t");
  check(first.fast && first.stage === 2 && first.due_on === "2026-12-04", "right first time: fast, checked again in 3 days");
  const again = applyAnswer(first, "w:x", "sc1", "correct", "2026-12-04", "t");
  check(again.stage === 3 && !!again.mastered_at, "right again another way: mastered");
  const miss = applyAnswer(again, "w:x", "syn2", "wrong", "2026-12-20", "t");
  check(miss.stage === 0 && !miss.mastered_at && !miss.fast && miss.due_on === "2026-12-21", "a miss drops a mastered word back to learning, due tomorrow");
  const sameDay = applyAnswer(miss, "w:x", "sc2", "correct", "2026-12-20", "t");
  check(sameDay.stage === 0 && sameDay.due_on === "2026-12-21", "the catch-up later that session doesn't move it on");
  let p = sameDay;
  const steps: [string, number, string][] = [["2026-12-21", 1, "2026-12-24"], ["2026-12-24", 2, "2026-12-31"], ["2026-12-31", 3, "2027-01-21"]];
  for (const [on, stage, due] of steps) {
    p = applyAnswer(p, "w:x", pickFormName(p), "correct", on, "t");
    check(p.stage === stage && p.due_on === due, `after a miss: stage ${stage} due ${due} (got ${p.stage}, ${p.due_on})`);
  }
  check(p.correct_days === 3 && p.forms_right.length >= 2, "mastered after a miss takes three days and two ways of asking");
  function pickFormName(pr: Progress) {
    return ["syn1", "sc1", "syn2", "sc2"].find((f) => f !== pr.last_form && !pr.forms_right.includes(f)) ?? "syn1";
  }
}

const start = process.argv[2] ?? "2026-11-20";
simulate({ name: "Oscar-like", level: "lower", total: 18, knows: 0.5, learns: 0.35, skips: [] }, start);
simulate({ name: "Sebastian-like", level: "middle", total: 22, knows: 0.35, learns: 0.35, skips: [] }, start);
simulate({ name: "Knows-little", level: "middle", total: 22, knows: 0.1, learns: 0.25, skips: [] }, start);
simulate({ name: "Oscar-twice-a-day", level: "lower", total: 18, knows: 0.5, learns: 0.35, skips: [], perDay: 2 }, start);
simulate({ name: "Sebastian-twice-a-day", level: "middle", total: 22, knows: 0.35, learns: 0.35, skips: [], perDay: 2 }, start);
simulate({ name: "Misses-days", level: "lower", total: 18, knows: 0.5, learns: 0.35, skips: [5, 6, 13, 20, 21, 22, 30, 37, 38] }, start);

if (failures > 0) {
  console.log(`\n${failures} checks failed`);
  process.exit(1);
}
console.log("\nwords schedule: all checks passed");
