// End-to-end server-stack check (Phase 3): seed a CFO calendar event, run the
// parse + materialize pipeline, then read it back through the detail/history
// queries. Talks to LOCAL Supabase via the service-role admin client.
// Run: npx tsx scripts/verify-workout-e2e.mts

import { config } from "dotenv";
config({ path: ".env.local" });

const { createAdminClient } = await import("../src/lib/supabase/admin");
const { parseWorkoutDescription } = await import("../src/lib/workouts/parse");
const { loadMovementVocabulary } = await import("../src/lib/workouts/canonicalize");
const { materializeSession } = await import("../src/lib/workouts/materialize");
const { getSessionDetail, getMovementHistory } = await import(
  "../src/lib/workouts/queries"
);
const { formatSetMetric, formatScore } = await import("../src/lib/workouts/format");

const DESCRIPTION =
  "Pre-workout: 1 set of 5 strict presses at a moderate load (95 lb). Strength: Build to a heavy single strict press, then 3x3 push press. Workout: Fran — 21-15-9 Thrusters (95 lb) and Pull-ups, for time.";

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const admin = createAdminClient();

// Pick a signed-in member to own the test data.
const { data: member } = await admin
  .from("family_members")
  .select("user_id, email")
  .not("user_id", "is", null)
  .limit(1)
  .maybeSingle();
if (!member) throw new Error("No signed-in family member to attribute test data");
const userId = member.user_id as string;
const email = member.email as string;
console.log(`Owner: ${email}\n`);

// 1. Seed a CFO calendar event.
const { data: event, error: evErr } = await admin
  .from("calendar_events")
  .insert({
    member_email: email,
    title: "CFO: E2E Test Workout",
    description: DESCRIPTION,
    start_time: "2026-06-07T16:00:00Z",
    source_type: "manual",
  })
  .select("id")
  .single();
if (evErr || !event) throw new Error(`seed event: ${evErr?.message}`);
const eventId = event.id as string;

// 2. Create the session + parse + materialize (mirrors openWorkoutEvent core).
const { data: sessionRow, error: sErr } = await admin
  .from("workout_sessions")
  .insert({
    user_id: userId,
    session_date: "2026-06-07",
    title: "E2E Test Workout",
    source: "calendar",
    calendar_event_id: eventId,
    raw_description: DESCRIPTION,
  })
  .select("id")
  .single();
if (sErr || !sessionRow) throw new Error(`create session: ${sErr?.message}`);
const sessionId = sessionRow.id as string;

const vocab = await loadMovementVocabulary(admin);
const parsed = await parseWorkoutDescription(DESCRIPTION, vocab);
check("description parsed", parsed.parsed, `${parsed.blocks.length} blocks`);
const { setCount } = await materializeSession({
  user: admin,
  admin,
  userId,
  sessionId,
  parsed,
});
await admin
  .from("workout_sessions")
  .update({ parsed_at: new Date().toISOString(), parse_model: "test" })
  .eq("id", sessionId);
check("sets materialized", setCount > 0, `${setCount} sets`);

// 3. Read it back through the detail query.
const detail = await getSessionDetail(admin, sessionId);
check("session detail loads", detail !== null);
if (detail) {
  console.log(`\n  Session: "${detail.title}" (${detail.sessionDate})`);
  for (const b of detail.blocks) {
    const score = formatScore(b.scoreType, b.score);
    console.log(
      `    ▸ ${b.title ?? b.blockType} [${b.blockType}]${
        b.benchmarkName ? ` · benchmark=${b.benchmarkName}` : ""
      }${score ? ` · score ${score}` : ""}`
    );
    for (const e of b.entries) {
      const sets = e.sets
        .map(
          (s) =>
            formatSetMetric(s.metricType, s.actual) +
            (s.e1rm != null ? ` (e1RM ${s.e1rm}${s.e1rmIsLoose ? "≈" : ""})` : "")
        )
        .join(", ");
      console.log(`        ${e.canonicalName ?? e.rawName}: ${sets}`);
    }
  }

  const benchBlock = detail.blocks.find((b) => b.benchmarkName);
  check("Fran recognized as benchmark", !!benchBlock, benchBlock?.benchmarkName ?? "none");

  // Find the strict-press entry and confirm e1RM landed on a loaded set.
  const allSets = detail.blocks.flatMap((b) => b.entries.flatMap((e) => e.sets));
  check(
    "at least one loaded set has a stored e1RM",
    allSets.some((s) => s.e1rm != null)
  );
  check(
    "actual seeded equal to prescribed on insert",
    allSets.every(
      (s) =>
        s.actual.reps === s.prescribed.reps && s.actual.load === s.prescribed.load
    )
  );

  // 4. Movement history query runs.
  const pressEntry = detail.blocks
    .flatMap((b) => b.entries)
    .find((e) => e.canonicalName === "Strict Press" && e.movementId);
  if (pressEntry?.movementId) {
    const hist = await getMovementHistory(admin, pressEntry.movementId, {});
    check("movement history query runs", true, `best strict e1RM=${hist.bestE1rmStrict}`);
  }
}

// 5. Cleanup.
await admin.from("workout_sessions").delete().eq("id", sessionId);
await admin.from("calendar_events").delete().eq("id", eventId);

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
