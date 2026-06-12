// Forced-tool output contract for assessment generation, plus the
// all-or-nothing validator. This deliberately DIVERGES from quiz-generate's
// fail-soft posture: a half-valid assessment is exactly the "overconfident
// output on bad data" failure the requirements treat as worst-case, so any
// validation problem — including a hallucinated evidence-still path — lands
// the whole generation in analysis_failed for retry.
//
// Pure module: the validator runs in the verify script against canned model
// outputs without any API calls.

export const ASSESSMENT_PROMPT_VERSION = "v1";

export interface AssessmentToolOutput {
  narrative: string;
  confidence_notes: string;
  focus_areas: {
    rank: number;
    issue_key: string;
    library_gap: boolean;
    diagnosis: string;
    cue: string;
    drills: { name: string; steps: string[]; equipment?: string }[];
    tell: string;
    evidence_stills: { path: string; caption: string }[];
    continues_prior_focus_area_id: string | null;
  }[];
  parked: { issue_key: string; summary: string }[];
  progress: {
    prior_focus_area_id: string;
    verdict: "keep" | "advance" | "replace";
    evidence: string;
  }[];
}

export const ASSESSMENT_TOOL = {
  name: "deliver_assessment",
  description:
    "Deliver the structured coaching assessment for this player's swing session.",
  // Kept strict-mode friendly: additionalProperties false, everything required
  // (nullable where genuinely optional).
  input_schema: {
    type: "object" as const,
    additionalProperties: false,
    required: ["narrative", "confidence_notes", "focus_areas", "parked", "progress"],
    properties: {
      narrative: {
        type: "string",
        description:
          "Short coach-facing summary of what the batch showed (3-6 sentences, plain language).",
      },
      confidence_notes: {
        type: "string",
        description:
          "Honest one-or-two-sentence note on data quality: swing count, any low-confidence metrics, fps caveats. Empty string if nothing to caveat.",
      },
      focus_areas: {
        type: "array",
        minItems: 1,
        maxItems: 2,
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "rank",
            "issue_key",
            "library_gap",
            "diagnosis",
            "cue",
            "drills",
            "tell",
            "evidence_stills",
            "continues_prior_focus_area_id",
          ],
          properties: {
            rank: { type: "integer", enum: [1, 2] },
            issue_key: { type: "string" },
            library_gap: {
              type: "boolean",
              description:
                "True ONLY when no library entry fits and you had to improvise — this flags the gap for curation.",
            },
            diagnosis: { type: "string" },
            cue: { type: "string" },
            drills: {
              type: "array",
              minItems: 1,
              maxItems: 2,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["name", "steps"],
                properties: {
                  name: { type: "string" },
                  steps: { type: "array", items: { type: "string" }, minItems: 1 },
                  equipment: { type: "string" },
                },
              },
            },
            tell: { type: "string" },
            evidence_stills: {
              type: "array",
              minItems: 0,
              maxItems: 2,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["path", "caption"],
                properties: {
                  path: {
                    type: "string",
                    description: "MUST be one of the provided still paths, verbatim.",
                  },
                  caption: { type: "string" },
                },
              },
            },
            continues_prior_focus_area_id: {
              type: ["string", "null"],
              description:
                "When this focus area keeps/refines a prior active focus area, its id (verbatim from the prior-assessment context). Null for new areas.",
            },
          },
        },
      },
      parked: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["issue_key", "summary"],
          properties: {
            issue_key: { type: "string" },
            summary: { type: "string" },
          },
        },
      },
      progress: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["prior_focus_area_id", "verdict", "evidence"],
          properties: {
            prior_focus_area_id: { type: "string" },
            verdict: { type: "string", enum: ["keep", "advance", "replace"] },
            evidence: { type: "string" },
          },
        },
      },
    },
  },
};

export interface ValidationContext {
  /** Paths of stills that actually exist for this session's ok clips. */
  validStillPaths: Set<string>;
  /** Ids of the prior assessment's focus-area rows (continuity + progress targets). */
  priorFocusAreaIds: Set<string>;
  /** Library issue keys (an unknown key without library_gap is a failure). */
  libraryKeys: Set<string>;
  /** Whether this player has prior active focus areas (progress required iff so). */
  expectsProgress: boolean;
}

/**
 * All-or-nothing validation. Returns the typed output or a list of problems —
 * never a partially-salvaged result.
 */
export function validateAssessmentOutput(
  input: unknown,
  ctx: ValidationContext
): { ok: true; output: AssessmentToolOutput } | { ok: false; problems: string[] } {
  const problems: string[] = [];
  const o = input as AssessmentToolOutput;

  if (typeof o !== "object" || o === null) {
    return { ok: false, problems: ["output is not an object"] };
  }
  if (typeof o.narrative !== "string" || o.narrative.trim().length < 20) {
    problems.push("narrative missing or too short");
  }
  if (typeof o.confidence_notes !== "string") problems.push("confidence_notes missing");

  if (!Array.isArray(o.focus_areas) || o.focus_areas.length < 1 || o.focus_areas.length > 2) {
    problems.push("focus_areas must contain 1-2 entries");
  } else {
    o.focus_areas.forEach((fa, i) => {
      const where = `focus_areas[${i}]`;
      if (fa.rank !== 1 && fa.rank !== 2) problems.push(`${where}.rank invalid`);
      if (!fa.issue_key) problems.push(`${where}.issue_key missing`);
      if (!fa.library_gap && fa.issue_key && !ctx.libraryKeys.has(fa.issue_key)) {
        problems.push(`${where}.issue_key "${fa.issue_key}" not in library and library_gap not set`);
      }
      for (const field of ["diagnosis", "cue", "tell"] as const) {
        if (typeof fa[field] !== "string" || fa[field].trim().length < 10) {
          problems.push(`${where}.${field} missing or too short`);
        }
      }
      if (!Array.isArray(fa.drills) || fa.drills.length < 1 || fa.drills.length > 2) {
        problems.push(`${where}.drills must contain 1-2 entries`);
      } else {
        fa.drills.forEach((d, j) => {
          if (!d.name || !Array.isArray(d.steps) || d.steps.length === 0) {
            problems.push(`${where}.drills[${j}] malformed`);
          }
        });
      }
      if (!Array.isArray(fa.evidence_stills) || fa.evidence_stills.length > 2) {
        problems.push(`${where}.evidence_stills must contain 0-2 entries`);
      } else {
        fa.evidence_stills.forEach((s, j) => {
          // Models hallucinate identifiers; a focus card pointing at a
          // nonexistent still is a quiet R7 failure. Hard-fail it.
          if (!ctx.validStillPaths.has(s.path)) {
            problems.push(`${where}.evidence_stills[${j}].path is not a provided still`);
          }
          if (typeof s.caption !== "string" || s.caption.length === 0) {
            problems.push(`${where}.evidence_stills[${j}].caption missing`);
          }
        });
      }
      if (
        fa.continues_prior_focus_area_id !== null &&
        !ctx.priorFocusAreaIds.has(fa.continues_prior_focus_area_id)
      ) {
        problems.push(`${where}.continues_prior_focus_area_id is not a prior focus area`);
      }
    });
    const ranks = o.focus_areas.map((f) => f.rank);
    if (new Set(ranks).size !== ranks.length) problems.push("duplicate focus_area ranks");
  }

  if (!Array.isArray(o.parked)) {
    problems.push("parked missing");
  }

  if (!Array.isArray(o.progress)) {
    problems.push("progress missing");
  } else {
    if (ctx.expectsProgress && o.progress.length === 0) {
      problems.push("player has prior focus areas but progress is empty (AE2)");
    }
    if (!ctx.expectsProgress && o.progress.length > 0) {
      problems.push("first assessment must not contain progress verdicts");
    }
    o.progress.forEach((p, i) => {
      if (!ctx.priorFocusAreaIds.has(p.prior_focus_area_id)) {
        problems.push(`progress[${i}].prior_focus_area_id is not a prior focus area`);
      }
      if (!["keep", "advance", "replace"].includes(p.verdict)) {
        problems.push(`progress[${i}].verdict invalid`);
      }
      if (typeof p.evidence !== "string" || p.evidence.trim().length < 10) {
        problems.push(`progress[${i}].evidence missing (R8 requires evidence)`);
      }
    });
  }

  return problems.length === 0 ? { ok: true, output: o } : { ok: false, problems };
}
