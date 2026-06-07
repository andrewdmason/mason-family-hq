// Headless verification for the workout parse pipeline (Phase 1).
// Run: npx tsx scripts/verify-workout-parse.ts
//
// Exercises parseWorkoutDescription + canonicalize against the four real CFO
// example descriptions, plus a self-grow / alias-hit check. Talks to the LOCAL
// Supabase only (admin client uses the committed local service-role key).

// Load local env BEFORE importing modules that read process.env at load time
// (the supabase admin client resolves its URL at import).
import { config } from "dotenv";
config({ path: ".env.local" });

const { createAdminClient } = await import("../src/lib/supabase/admin");
const { parseWorkoutDescription } = await import("../src/lib/workouts/parse");
const { createMovementResolver, loadMovementVocabulary, normalizeName } =
  await import("../src/lib/workouts/canonicalize");
const { computeSetE1rm } = await import("../src/lib/workouts/e1rm");
type ParsedWorkout = import("../src/lib/workouts/types").ParsedWorkout;

const EXAMPLES = [
  "Pre-workout: 1 round of 7 pull-ups, :05 rest, 5 pull-ups, :05 rest, 7 thrusters, :05 rest, 5 thrusters. Workout: On an 18:00 clock: For time: 9-12-15 Pull-ups, 9-15-21 Thrusters (55 lb). In the remaining time: Build to a heavy single thruster.",
  "6 rounds, each for time: 400-m run. Rest 1:30 between rounds. Log each round; score is total run time. Post-workout: 3 rounds of :30 Chinese back plank, :30 side plank right, :30 plank on elbows, :30 side plank left.",
  "Pre-workout: 1 set of 5-4-3 tempo overhead squats (:03 hold at top, :03 descent, :03 hold at bottom), then 1 set of 7 overhead squats at workout load. Workout: For time: 100 overhead squats (65 lb). Every 1:00 starting at :00, perform 15 double-unders. Take the bar from the floor.",
  "Pre-workout: On a 10:00 clock: 8-6-4-2 Hang power cleans (increase load as reps decrease). Workout: For time with a partner: 1,000-m row, 25 alternating single-leg squats, 15 hang power cleans (105 lb). Partner 2 begins rowing as soon as Partner 1 exits.",
];

const NOVEL = "Strength: 4 sets of 6 Jefferson curls (95 lb).";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

function summarize(w: ParsedWorkout): string {
  return w.blocks
    .map(
      (b) =>
        `[${b.blockType}${b.benchmarkName ? `:${b.benchmarkName}` : ""} score=${b.score.scoreType}] ` +
        b.movements
          .map((m) => `${m.canonicalName}×${m.sets.length}`)
          .join(", ")
    )
    .join("  ||  ");
}

async function main() {
  const admin = createAdminClient();
  const vocab = await loadMovementVocabulary(admin);
  console.log(`Vocabulary: ${vocab.length} movements\n`);

  const { count: before } = await admin
    .from("movements")
    .select("*", { count: "exact", head: true });

  for (let i = 0; i < EXAMPLES.length; i++) {
    console.log(`Example ${i + 1}:`);
    const parsed = await parseWorkoutDescription(EXAMPLES[i], vocab);
    check("parsed ok", parsed.parsed, `${parsed.blocks.length} blocks`);
    console.log(`    ${summarize(parsed)}`);

    // Resolve every movement and show canonical mapping + e1RM where applicable.
    const resolver = await createMovementResolver(admin);
    for (const b of parsed.blocks) {
      for (const m of b.movements) {
        const r = await resolver.resolve(m.rawName, m.canonicalName, m.family);
        const loadedSet = m.sets.find(
          (s) => s.prescribed.load && s.prescribed.reps
        );
        let e1 = "";
        if (loadedSet) {
          const e = computeSetE1rm({
            load: loadedSet.prescribed.load,
            reps: loadedSet.prescribed.reps,
            unit: loadedSet.prescribed.unit,
            isLoadedMovement: r.isLoaded,
          });
          e1 = e ? ` e1RM≈${e.e1rm}${e.isLoose ? " (loose)" : ""}` : "";
        }
        console.log(
          `      ${m.rawName} → ${m.canonicalName} [${m.family}, loaded=${r.isLoaded}]${e1}`
        );
      }
    }
    console.log();
  }

  // Example 1 specifics: pre-workout + workout blocks; thruster & pull-up known.
  console.log("Targeted checks:");
  const ex1 = await parseWorkoutDescription(EXAMPLES[0], vocab);
  check("ex1 has ≥2 blocks (pre + workout)", ex1.blocks.length >= 2);
  const ex1names = ex1.blocks.flatMap((b) =>
    b.movements.map((m) => normalizeName(m.canonicalName))
  );
  check("ex1 canonicalizes Thruster", ex1names.includes("thruster"));
  check("ex1 canonicalizes Pull-Up", ex1names.includes("pullup"));

  // Self-grow + alias-hit: parse a novel movement twice, expect exactly one new row.
  const r1 = await createMovementResolver(admin);
  const nov1 = await parseWorkoutDescription(NOVEL, vocab);
  for (const b of nov1.blocks)
    for (const m of b.movements) await r1.resolve(m.rawName, m.canonicalName, m.family);
  const { count: mid } = await admin
    .from("movements")
    .select("*", { count: "exact", head: true });

  const r2 = await createMovementResolver(admin);
  const nov2 = await parseWorkoutDescription(NOVEL, vocab);
  for (const b of nov2.blocks)
    for (const m of b.movements) await r2.resolve(m.rawName, m.canonicalName, m.family);
  const { count: after } = await admin
    .from("movements")
    .select("*", { count: "exact", head: true });

  console.log(`  movement count: before=${before} afterNovel=${mid} afterRepeat=${after}`);
  check("novel movement created exactly once", (mid ?? 0) > (before ?? 0));
  check("second parse adds no new movement (alias hit)", after === mid);

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
