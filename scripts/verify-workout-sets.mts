/**
 * Checks how a parsed workout's sets are saved: a loaded movement's reps always
 * get a place for the weight, and an AMRAP's movement is one set however many
 * rounds the parser guessed at.
 *
 *   npm run verify:workouts
 */
import { loggedMetricType } from "@/lib/workouts/materialize";
import { normalizeBlock } from "@/lib/workouts/parse";
import type { ParsedSet } from "@/lib/workouts/types";

let failures = 0;
function check(ok: boolean, what: string) {
  if (!ok) {
    failures++;
    console.log(`  FAIL ${what}`);
  }
}

const set = (metricType: ParsedSet["metricType"], reps: number | null): ParsedSet => ({
  metricType,
  context: "metcon",
  prescribed: { reps },
});

// "5 split jerks, use 75% of 1-rep max": no number for the bar.
check(loggedMetricType(set("reps", 5), true) === "load_reps", "a loaded movement's reps take a weight");
check(loggedMetricType(set("reps", 5), false) === "reps", "a bodyweight movement's reps stay reps");
check(loggedMetricType(set("reps", null), true) === "reps", "a set with no rep count stays as it is");
check(loggedMetricType(set("calories", null), true) === "calories", "other measures are untouched");
check(loggedMetricType(set("load_reps", 5), false) === "load_reps", "load × reps stays load × reps");

const five = { metric_type: "reps", context: "metcon", reps: 5 };
const movement = (sets: object[]) => ({ raw_name: "5 split jerks", canonical_name: "Split Jerk", family: "jerk", sets });

const amrap = normalizeBlock({ block_type: "metcon", score_type: "rounds_reps", movements: [movement([five, five, five, five, five])] });
check(amrap.movements[0].sets.length === 1, "an AMRAP's repeated rounds fold into one set");

const ladder = normalizeBlock({
  block_type: "metcon",
  score_type: "rounds_reps",
  movements: [movement([{ ...five, reps: 3 }, { ...five, reps: 6 }, { ...five, reps: 9 }])],
});
check(ladder.movements[0].sets.length === 3, "an AMRAP ladder keeps a set per step");

const rounds = normalizeBlock({ block_type: "metcon", score_type: "time", movements: [movement([five, five, five])] });
check(rounds.movements[0].sets.length === 3, "rounds for time keep a set per round");

console.log(failures === 0 ? "workout sets: ok" : `workout sets: ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
