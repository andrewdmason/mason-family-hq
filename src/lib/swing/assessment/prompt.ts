// Assessment prompt assembly. Pure module (verify script inspects output).
//
// Context rules (load-bearing, from the plan):
//   • History = COMPLETE assessments only — voided text is the wrong kid's
//     mechanics, superseded text was never delivered. Callers guarantee this
//     by sourcing from getPriorAssessmentsForPrompt; this module trusts it.
//   • AE2 needs prior assessment TEXT, not labels — full narratives included.
//   • The model prescribes FROM THE LIBRARY or flags library_gap.
//   • Uncertainty flows in (per-metric confidence, low-sample) and the model
//     is instructed to carry it into the language, never to paper over it.

import type { LibraryEntry } from "@/lib/swing/library/drills";
import type {
  StillInfo,
  SwingFocusArea,
  SwingAssessment,
  SwingPlayer,
} from "@/lib/swing/types";
import { ageFromBirthYear } from "@/lib/swing/types";
import type { BatchAggregates } from "./aggregate";

export interface PromptStill extends StillInfo {
  clipLabel: string;
}

export interface PriorContext {
  assessment: SwingAssessment;
  focusAreas: SwingFocusArea[];
}

export function buildSystemPrompt(): string {
  return [
    "You are a youth baseball hitting expert writing for a volunteer Little League coach — a dad without deep baseball expertise. He can see a swing 'looks off' but can't diagnose, prioritize, or prescribe. Your assessment is the coaching he will deliver verbally at practice.",
    "",
    "Hard rules:",
    "- AT MOST TWO focus areas, ranked. When more issues are visible, name the rest in `parked` so a later assessment can promote them. Fixing one thing at a time is the point.",
    "- Each focus area has three layers: (a) diagnosis in plain language a dad understands, (b) how to coach it — one kid-appropriate cue plus 1-2 drills, (c) the naked-eye TELL: what the coach watches on any rep, with no device, to judge right/wrong execution. The tell is the most important sentence you write.",
    "- Prescribe cues and drills FROM THE PROVIDED LIBRARY whenever an entry fits, adapting wording to this kid's age. If no entry fits, set library_gap=true and improvise carefully — that flags the library for curation.",
    "- You see METRICS, not video. Reason only from the aggregates provided. Respect their confidence grades: never build a focus area primarily on low-confidence metrics, and carry uncertainty into your language ('based on these 4 swings...'). An overconfident wrong assessment is the worst possible output.",
    "- Cross-swing patterns only: the aggregates already pool the batch; never speak as if you judged a single swing (the spread tells you consistency).",
    "- When prior assessments exist: evaluate progress on each prior ACTIVE focus area with a keep/advance/replace verdict and concrete evidence from the new aggregates. Do NOT re-prescribe a solved problem from scratch — if it improved, say so and advance or move on.",
    "- Evidence stills: pick at most 2 per focus area from the provided list (verbatim paths) whose phase shows the tell. Write captions that point the coach's eye ('yellow circle = where his head started').",
    "- Voice: direct, warm, zero jargon. Cues must be sayable to a 9-year-old between pitches.",
  ].join("\n");
}

export function buildUserPrompt(input: {
  player: SwingPlayer;
  aggregates: BatchAggregates;
  priors: PriorContext[];
  library: LibraryEntry[];
  stills: PromptStill[];
  sessionDate: string;
}): string {
  const { player, aggregates, priors, library, stills, sessionDate } = input;
  const sections: string[] = [];

  sections.push(
    `# Player\n${player.name}, age ${ageFromBirthYear(player.birthYear)}, bats ${player.bats === "L" ? "left" : "right"}.${player.notes ? ` Coach notes: ${player.notes}` : ""}`
  );

  const metricLines = aggregates.metrics.map((m) => {
    const fmt = (v: number) =>
      m.unit === "ms" ? `${Math.round(v)}ms` : m.unit === "deg" ? `${v.toFixed(1)}°` : v.toFixed(3);
    return `- ${m.key} (${m.unit}, confidence ${m.confidence}, ${m.count}/${aggregates.swingCount} swings): median ${fmt(m.median)}, range ${fmt(m.min)}–${fmt(m.max)}, spread ${fmt(m.spread)}`;
  });
  sections.push(
    `# This session (${sessionDate})\n${aggregates.swingCount} usable swings${aggregates.lowSample ? " — LOW SAMPLE (under 5): hedge accordingly and say so in confidence_notes" : ""}.\n\nBatch aggregates (medians are the signal; spread is consistency):\n${metricLines.join("\n")}\n\nMetric meanings: head_drift = head travel stance→contact in hitter-heights (quiet head ≈ <0.06); stride_length_ratio = stride width ÷ height (youth good ≈ 0.2–0.35); spine angles in degrees from vertical; posture_loss = stance→contact change (≈0 is ideal); front_knee_angle_contact = 180 is a firm straight front leg; back_elbow_slot = rear elbow height vs shoulder line in heights (negative = below shoulders, good slot); durations in ms (load→plant→launch→contact); weight_transfer = hip travel toward pitcher ÷ stance width (≈0.3–0.7 healthy; ≫1 lunging, ≤0 stuck on back side); hip_shoulder_timing = shoulder rotation onset minus hip onset in ms (positive = hips first, good sequence).`
  );

  if (priors.length > 0) {
    const priorBlocks = priors.map((p, i) => {
      const areas = p.focusAreas
        .map(
          (fa) =>
            `  - focus area id=${fa.id} rank ${fa.rank} [${fa.issueKey}]: ${fa.diagnosis}\n    cue: "${fa.cue}" | tell: "${fa.tell}"`
        )
        .join("\n");
      const parked = p.assessment.parked.length
        ? `\n  Parked then: ${p.assessment.parked.map((x) => x.issueKey).join(", ")}`
        : "";
      return `## Prior assessment ${i + 1} (${p.assessment.createdAt.slice(0, 10)}${i === 0 ? ", most recent — progress verdicts target ITS focus areas" : ""})\n${p.assessment.narrative ?? ""}\nActive focus areas then:\n${areas}${parked}`;
    });
    sections.push(`# History (newest first)\n${priorBlocks.join("\n\n")}`);
  } else {
    sections.push(
      "# History\nFirst assessment for this player — no progress section (leave `progress` empty)."
    );
  }

  sections.push(
    `# Drill/cue library\n${JSON.stringify(
      library.map((e) => ({
        issue_key: e.key,
        label: e.label,
        signals: e.addressesMetrics,
        diagnosis_language: e.diagnosis,
        cues: e.cues,
        drills: e.drills,
        tell: e.tell,
      })),
      null,
      1
    )}`
  );

  sections.push(
    `# Available evidence stills (use paths verbatim, ≤2 per focus area)\n${stills
      .map((s) => `- ${s.path} — ${s.clipLabel}, ${s.phase} frame, overlays: ${s.annotations.join(", ") || "skeleton"}`)
      .join("\n")}`
  );

  sections.push("Deliver the assessment now as JSON matching the required schema.");
  return sections.join("\n\n");
}
