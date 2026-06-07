// Pure-math verification for e1RM / normalization / family ratios (Phase 2).
// No DB, no network. Run: npx tsx scripts/verify-workout-math.mts

import {
  epleyE1rm,
  inverseEpleyLoad,
  isLooseReps,
  computeSetE1rm,
} from "../src/lib/workouts/e1rm";
import { suggestedLoad, percentOfE1rm } from "../src/lib/workouts/normalization";
import {
  chooseRatio,
  convertWithRatio,
  personalRatio,
  bandFromPersonalRatio,
} from "../src/lib/workouts/families";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}
const near = (a: number, b: number, tol = 0.5) => Math.abs(a - b) <= tol;

console.log("e1RM:");
check("epley 225×5 = 262.5", epleyE1rm(225, 5) === 262.5, `${epleyE1rm(225, 5)}`);
check("epley 1-rep = load", epleyE1rm(185, 1) === 185);
check(
  "inverse(262.5, 3) ≈ 238.6 (~240)",
  near(inverseEpleyLoad(262.5, 3), 238.6),
  `${inverseEpleyLoad(262.5, 3)}`
);
check("loose at 13 reps", isLooseReps(13) === true);
check("not loose at 12 reps", isLooseReps(12) === false);
check(
  "kg normalized to lb (100kg×1 ≈ 220.5)",
  near(
    computeSetE1rm({ load: 100, reps: 1, unit: "kg", isLoadedMovement: true })?.e1rm ?? 0,
    220.5
  )
);
check(
  "non-loaded movement → no e1RM",
  computeSetE1rm({ load: 50, reps: 5, unit: "lb", isLoadedMovement: false }) === null
);

console.log("normalization:");
check("suggested load for 5 reps off 262.5 e1RM = 225", suggestedLoad(262.5, 5) === 225);
check("% of e1RM: 155 of 200 = 78", percentOfE1rm(155, 200) === 78, `${percentOfE1rm(155, 200)}`);
check("% of e1RM with no max → null", percentOfE1rm(155, 0) === null);

console.log("families:");
const seed = { low: 1.15, high: 1.3 };
const r1 = chooseRatio(null, seed);
check("falls back to seed (typical)", r1?.basis === "typical");
const r2 = chooseRatio({ low: 1.3, high: 1.4 }, seed);
check("prefers personal over seed", r2?.basis === "personal" && r2.low === 1.3);
const est = convertWithRatio(150, { low: 1.2, high: 1.3, basis: "typical" });
check(
  "convert 150 by 1.2–1.3 → 180–195 (mid 187.5)",
  est.low === 180 && est.high === 195 && est.mid === 187.5,
  JSON.stringify(est)
);
check("personal ratio 150→195 = 1.3", personalRatio(150, 195) === 1.3);
const band = bandFromPersonalRatio(1.3, 0.05);
check("band around 1.3 = [1.235, 1.365]", band.low === 1.235 && band.high === 1.365, JSON.stringify(band));

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
