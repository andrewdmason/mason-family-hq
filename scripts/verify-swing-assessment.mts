// Assessment-layer verification: aggregation (R4 enforcement), prompt
// assembly rules (history exclusions, library inclusion), and the
// all-or-nothing output validator (hallucinated-still rejection, AE2/AE3
// shape rules). No DB, no network — the LLM call itself is exercised live
// only when SWING_VERIFY_LIVE=1 (and ANTHROPIC_API_KEY is set).
// Run: npx tsx scripts/verify-swing-assessment.mts

import { aggregateClips } from "../src/lib/swing/assessment/aggregate";
import {
  buildSystemPrompt,
  buildUserPrompt,
} from "../src/lib/swing/assessment/prompt";
import {
  validateAssessmentOutput,
  type AssessmentToolOutput,
} from "../src/lib/swing/assessment/schema";
import { DRILL_LIBRARY } from "../src/lib/swing/library/drills";
import {
  sanitizeAnnotations,
  sanitizeBats,
  sanitizeEvents,
  sanitizeMetrics,
} from "../src/lib/swing/sanitize";
import type { SwingMetrics } from "../src/lib/swing/types";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

const metric = (value: number, confidence: "high" | "medium" | "low" = "high") => ({
  value,
  confidence,
  unit: "ratio" as const,
});

console.log("Aggregation (R4 enforcement):");
{
  check("2 swings → null (no single/duo-swing judgments)", aggregateClips([{}, {}]) === null);
  const batch: SwingMetrics[] = [
    { head_drift: metric(0.05), stride_length_ratio: metric(0.3) },
    { head_drift: metric(0.09) },
    { head_drift: metric(0.07) },
  ];
  const agg = aggregateClips(batch)!;
  check("3 swings aggregates", agg !== null && agg.swingCount === 3);
  check("lowSample flagged under 5", agg.lowSample === true);
  const head = agg.metrics.find((m) => m.key === "head_drift")!;
  check("median right", head.median === 0.07, `${head.median}`);
  check("spread right", Math.abs(head.spread - 0.04) < 1e-9, `${head.spread}`);
  const stride = agg.metrics.find((m) => m.key === "stride_length_ratio")!;
  check(
    "metric present in under half the batch → low pooled confidence",
    stride.count === 1 && stride.confidence === "low"
  );
}

console.log("Prompt assembly:");
{
  const agg = aggregateClips([
    { head_drift: metric(0.12) },
    { head_drift: metric(0.13) },
    { head_drift: metric(0.11) },
  ])!;
  const player = {
    id: "p1",
    name: "Oscar",
    birthYear: 2017,
    bats: "R" as const,
    notes: null,
    archivedAt: null,
    createdAt: "2026-06-12T00:00:00Z",
  };
  const noHistory = buildUserPrompt({
    player,
    aggregates: agg,
    priors: [],
    library: DRILL_LIBRARY,
    stills: [
      {
        path: "s/c/still-contact.webp",
        phase: "contact",
        contentType: "image/webp",
        annotations: ["head_drift"],
        clipLabel: "swing 1",
      },
    ],
    sessionDate: "2026-06-12",
  });
  check("first-assessment path says leave progress empty", noHistory.includes("leave `progress` empty"));
  check("library JSON embedded", noHistory.includes("head_movement"));
  check("still path listed verbatim", noHistory.includes("s/c/still-contact.webp"));
  check("low-sample warning present", noHistory.includes("LOW SAMPLE"));
  check("system prompt carries the ≤2 rule", buildSystemPrompt().includes("AT MOST TWO"));

  const withHistory = buildUserPrompt({
    player,
    aggregates: agg,
    priors: [
      {
        assessment: {
          id: "a1",
          sessionId: "s1",
          playerId: "p1",
          status: "complete",
          narrative: "PRIOR_NARRATIVE_TEXT",
          progress: [],
          parked: [{ issueKey: "overstriding", summary: "long stride" }],
          confidenceNotes: null,
          swingCount: 6,
          model: null,
          promptVersion: null,
          error: null,
          createdAt: "2026-05-20T00:00:00Z",
        },
        focusAreas: [
          {
            id: "fa1",
            assessmentId: "a1",
            playerId: "p1",
            rank: 1,
            disposition: "focus",
            priorFocusAreaId: null,
            issueKey: "head_movement",
            diagnosis: "d",
            cue: "Keep your nose on the ball",
            drills: [],
            tell: "watch the chin",
            evidenceStills: [],
            libraryGap: false,
            createdAt: "2026-05-20T00:00:00Z",
          },
        ],
      },
    ],
    library: DRILL_LIBRARY,
    stills: [],
    sessionDate: "2026-06-12",
  });
  check("AE2: prior assessment TEXT included, not just labels", withHistory.includes("PRIOR_NARRATIVE_TEXT"));
  check("prior focus-area id exposed for verdict targeting", withHistory.includes("id=fa1"));
  check("prior parked issues surfaced for promotion", withHistory.includes("Parked then: overstriding"));
}

console.log("Output validation (all-or-nothing):");
{
  const ctx = {
    validStillPaths: new Set(["s/c/still-contact.webp"]),
    priorFocusAreaIds: new Set(["fa1"]),
    libraryKeys: new Set(DRILL_LIBRARY.map((e) => e.key)),
    expectsProgress: true,
  };
  const good: AssessmentToolOutput = {
    narrative: "He is doing many things well, and two patterns stood out across the batch.",
    confidence_notes: "Based on 3 swings — low sample.",
    focus_areas: [
      {
        rank: 1,
        issue_key: "head_movement",
        library_gap: false,
        diagnosis: "His head travels forward through the swing and his eyes lose the ball.",
        cue: "Keep your nose on the ball",
        drills: [{ name: "Tee freeze finish", steps: ["Hit and freeze for two seconds"] }],
        tell: "Watch his chin — past the front shoulder at contact means he pulled his head.",
        evidence_stills: [
          { path: "s/c/still-contact.webp", caption: "Yellow circle shows where his head started." },
        ],
        continues_prior_focus_area_id: "fa1",
      },
    ],
    parked: [{ issue_key: "overstriding", summary: "Stride is long but secondary." }],
    progress: [
      { prior_focus_area_id: "fa1", verdict: "keep", evidence: "Head drift unchanged at 0.12 heights." },
    ],
  };
  check("valid output passes", validateAssessmentOutput(good, ctx).ok === true);

  const hallucinated = structuredClone(good);
  hallucinated.focus_areas[0].evidence_stills[0].path = "s/c/still-FAKE.webp";
  const r1 = validateAssessmentOutput(hallucinated, ctx);
  check("hallucinated still path → rejected (R7 guard)", !r1.ok);

  const threeAreas = structuredClone(good);
  threeAreas.focus_areas.push(
    { ...good.focus_areas[0], rank: 2 },
    { ...good.focus_areas[0], rank: 2 }
  );
  check("3 focus areas → rejected (AE3/R6)", !validateAssessmentOutput(threeAreas, ctx).ok);

  const offLibrary = structuredClone(good);
  offLibrary.focus_areas[0].issue_key = "made_up_issue";
  check("unknown issue key without library_gap → rejected", !validateAssessmentOutput(offLibrary, ctx).ok);
  offLibrary.focus_areas[0].library_gap = true;
  check("unknown issue key WITH library_gap → allowed (flagged gap)", validateAssessmentOutput(offLibrary, ctx).ok);

  const noProgress = structuredClone(good);
  noProgress.progress = [];
  check("history present but no progress → rejected (AE2)", !validateAssessmentOutput(noProgress, ctx).ok);

  const firstCtx = { ...ctx, priorFocusAreaIds: new Set<string>(), expectsProgress: false };
  const first = structuredClone(good);
  first.progress = [];
  first.focus_areas[0].continues_prior_focus_area_id = null;
  check("first assessment with empty progress → passes", validateAssessmentOutput(first, firstCtx).ok);
  const firstWithProgress = structuredClone(good);
  check("first assessment WITH progress → rejected", !validateAssessmentOutput(firstWithProgress, firstCtx).ok);

  const badContinuity = structuredClone(good);
  badContinuity.focus_areas[0].continues_prior_focus_area_id = "not-a-real-id";
  check("bogus continuity link → rejected", !validateAssessmentOutput(badContinuity, ctx).ok);
}

console.log("Sanitize (server-side shape validation):");
{
  const valid = sanitizeMetrics({
    head_drift: { value: 0.05, confidence: "high", unit: "norm" },
  });
  check(
    "valid metric passes through",
    valid.head_drift?.value === 0.05 &&
      valid.head_drift.confidence === "high" &&
      valid.head_drift.unit === "norm"
  );
  check(
    "unknown metric key dropped",
    Object.keys(
      sanitizeMetrics({ bat_speed: { value: 1, confidence: "high", unit: "ms" } })
    ).length === 0
  );
  check(
    "NaN value dropped",
    Object.keys(
      sanitizeMetrics({ head_drift: { value: NaN, confidence: "high", unit: "norm" } })
    ).length === 0
  );
  check(
    "bad confidence dropped",
    Object.keys(
      sanitizeMetrics({ head_drift: { value: 0.05, confidence: "certain", unit: "norm" } })
    ).length === 0
  );
  check("non-object metrics → {}", Object.keys(sanitizeMetrics("nope")).length === 0);

  const events = sanitizeEvents({ contact: 1650, warmup: 100, plant: -5 });
  check(
    "valid event kept; unknown phase and negative time dropped",
    events.contact === 1650 && Object.keys(events).length === 1
  );

  check("bats L/R pass", sanitizeBats("L") === "L" && sanitizeBats("R") === "R");
  check("bats junk → null", sanitizeBats("S") === null && sanitizeBats(7) === null);

  const annotations = sanitizeAnnotations(
    Array.from({ length: 20 }, () => "a".repeat(100))
  );
  check(
    "annotations truncated to 12 items of ≤60 chars",
    annotations.length === 12 && annotations.every((a) => a.length === 60)
  );
  check("non-array annotations → []", sanitizeAnnotations("x").length === 0);
}

if (process.env.SWING_VERIFY_LIVE === "1") {
  console.log("Live LLM call: set up a real session in the app — not covered here.");
}

console.log(failures === 0 ? "\nAll assessment checks passed." : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
