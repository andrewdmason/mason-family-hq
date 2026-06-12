import "server-only";

// Assessment generation: aggregate the session's clip metrics, assemble
// history + library context, run the forced-tool LLM call, validate
// all-or-nothing, persist via the COMMIT-FLAG pattern.
//
// Atomicity (PostgREST has no multi-statement transactions): insert the
// assessment as `generating` → insert the complete focus-area snapshot
// (children of an invisible parent) → single-statement flip to `complete`
// with the content. Current-ness keys strictly on `complete`, so every
// partial state is invisible and retry is idempotent — abandoned
// `generating` rows are inert garbage the stale-takeover rule reaps.
//
// Retry NEVER touches video: everything here reads stored rows + storage.

import type { SupabaseClient } from "@supabase/supabase-js";
import { anthropic, SWING_MODEL } from "@/lib/swing/anthropic";
import { SWING_BUCKET } from "@/lib/swing/bucket";
import { DRILL_LIBRARY } from "@/lib/swing/library/drills";
import {
  getPlayer,
  getPriorAssessmentsForPrompt,
  getSession,
  getSessionClips,
} from "@/lib/swing/queries";
import { MIN_USABLE_CLIPS, type SwingClip } from "@/lib/swing/types";
import { aggregateClips } from "./aggregate";
import {
  buildSystemPrompt,
  buildUserPrompt,
  type PromptStill,
  type PriorContext,
} from "./prompt";
import {
  ASSESSMENT_OUTPUT_SCHEMA,
  ASSESSMENT_PROMPT_VERSION,
  validateAssessmentOutput,
  type AssessmentToolOutput,
} from "./schema";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Supabase = SupabaseClient<any, any, any>;
/* eslint-enable @typescript-eslint/no-explicit-any */

export class AssessmentError extends Error {
  constructor(
    message: string,
    /** true → the coach can fix this (add clips); false → retryable system failure */
    readonly isUserError: boolean
  ) {
    super(message);
  }
}

export async function runAssessment(
  supabase: Supabase,
  sessionId: string,
  { regenerate = false } = {}
): Promise<{ assessmentId: string }> {
  const session = await getSession(supabase, sessionId);
  if (!session) throw new AssessmentError("Session not found", true);
  const player = await getPlayer(supabase, session.playerId);
  if (!player) throw new AssessmentError("Player not found", true);

  /* Derived-readiness re-verification — the analyze action is the sole
   * gatekeeper; the client's CTA gating is just convenience. */
  const clips = await getSessionClips(supabase, sessionId);
  const okClips = clips.filter((c) => c.status === "ok");
  if (okClips.length < MIN_USABLE_CLIPS) {
    throw new AssessmentError(
      `Need at least ${MIN_USABLE_CLIPS} usable swings (have ${okClips.length}). Add more clips.`,
      true
    );
  }

  /* Storage-object existence check: rows are created before uploads, so a
   * crashed tab can leave rows pointing at nothing. Signing fails for
   * missing objects, which is exactly the verification we need. */
  await verifyArtifactsExist(supabase, okClips);

  const aggregates = aggregateClips(okClips.map((c) => c.metrics ?? {}));
  if (!aggregates) {
    throw new AssessmentError("Couldn't aggregate metrics across the batch", false);
  }

  /* History: COMPLETE assessments only (voided = wrong kid's text,
   * superseded = never delivered), and never this session's own. */
  const priors: PriorContext[] = (
    await getPriorAssessmentsForPrompt(supabase, player.id, 4)
  ).filter((p) => p.assessment.sessionId !== sessionId).slice(0, 3);
  const priorActive = priors[0]?.focusAreas ?? [];

  const stills: PromptStill[] = okClips.flatMap((clip, i) =>
    clip.stills.map((s) => ({ ...s, clipLabel: `swing ${i + 1}` }))
  );

  /* Commit-flag step 1: the invisible parent row. */
  const { data: inserted, error: insertError } = await supabase
    .from("swing_assessments")
    .insert({
      session_id: sessionId,
      player_id: player.id,
      status: "generating",
      swing_count: aggregates.swingCount,
      model: SWING_MODEL,
      prompt_version: ASSESSMENT_PROMPT_VERSION,
    })
    .select("id")
    .single();
  if (insertError || !inserted) {
    throw new AssessmentError(`Couldn't start assessment: ${insertError?.message}`, false);
  }
  if (typeof inserted.id !== "string") {
    throw new AssessmentError("Unexpected id type", false);
  }
  const assessmentId = inserted.id;

  try {
    const output = await callModel({
      player,
      aggregates,
      priors,
      stills,
      sessionDate: session.filmedOn,
      priorActiveIds: new Set(priorActive.map((fa) => fa.id)),
      validStillPaths: new Set(stills.map((s) => s.path)),
    });

    /* Commit-flag step 2: the focus-area snapshot (children of an invisible
     * parent — immutable after creation, complete by construction). */
    const focusRows = output.focus_areas.map((fa) => ({
      assessment_id: assessmentId,
      player_id: player.id,
      rank: fa.rank,
      disposition: "focus",
      prior_focus_area_id: fa.continues_prior_focus_area_id,
      issue_key: fa.issue_key,
      diagnosis: fa.diagnosis,
      cue: fa.cue,
      drills: fa.drills,
      tell: fa.tell,
      evidence_stills: fa.evidence_stills.map((s) => {
        const info = stills.find((st) => st.path === s.path);
        if (!info) {
          throw new AssessmentError(
            "evidence still path not found after validation",
            false
          );
        }
        return {
          path: s.path,
          phase: info.phase,
          contentType: info.contentType,
          caption: s.caption,
        };
      }),
      library_gap: fa.library_gap,
    }));
    const { error: faError } = await supabase.from("swing_focus_areas").insert(focusRows);
    if (faError) {
      throw new AssessmentError(`Couldn't save focus areas: ${faError.message}`, false);
    }

    /* Commit-flag step 3: the single-statement commit point. */
    const { error: flipError } = await supabase
      .from("swing_assessments")
      .update({
        status: "complete",
        narrative: output.narrative,
        confidence_notes: output.confidence_notes || null,
        progress: output.progress.map((p) => ({
          priorFocusAreaId: p.prior_focus_area_id,
          verdict: p.verdict,
          evidence: p.evidence,
        })),
        parked: output.parked.map((p) => ({ issueKey: p.issue_key, summary: p.summary })),
        error: null,
      })
      .eq("id", assessmentId)
      .eq("status", "generating");
    if (flipError) {
      throw new AssessmentError(`Couldn't finalize assessment: ${flipError.message}`, false);
    }

    /* Post-commit: regenerate supersedes the previous complete assessment(s)
     * for this session. (Brief two-complete window is harmless — current-ness
     * picks the latest by created_at, which is this one.) */
    if (regenerate) {
      await supabase
        .from("swing_assessments")
        .update({ status: "superseded" })
        .eq("session_id", sessionId)
        .eq("status", "complete")
        .neq("id", assessmentId);
    }

    return { assessmentId };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Assessment generation failed";
    // Orphan cleanup: focus areas may have landed before a later step failed —
    // delete them so the failed parent leaves no half-written children behind.
    const { error: faCleanupError } = await supabase
      .from("swing_focus_areas")
      .delete()
      .eq("assessment_id", assessmentId);
    if (faCleanupError) {
      console.error(
        `Failed to clean up focus areas for assessment ${assessmentId}: ${faCleanupError.message}`
      );
    }
    const { error: failError } = await supabase
      .from("swing_assessments")
      .update({ status: "analysis_failed", error: message })
      .eq("id", assessmentId)
      .eq("status", "generating");
    if (failError) {
      console.error(
        `Failed to mark assessment ${assessmentId} analysis_failed: ${failError.message}`
      );
    }
    throw error;
  }
}

async function verifyArtifactsExist(supabase: Supabase, okClips: SwingClip[]) {
  const paths = okClips.flatMap((c) => [
    ...(c.keypointsPath ? [c.keypointsPath] : []),
    ...c.stills.map((s) => s.path),
  ]);
  if (paths.length === 0) {
    throw new AssessmentError("No artifacts recorded for this session's clips", true);
  }
  const { data, error } = await supabase.storage
    .from(SWING_BUCKET)
    .createSignedUrls(paths, 60);
  if (error) throw new AssessmentError(`Couldn't verify artifacts: ${error.message}`, false);
  const missing = (data ?? []).filter((d) => !d.signedUrl).length;
  if (missing > 0) {
    throw new AssessmentError(
      `${missing} artifact(s) missing from storage — an interrupted upload. Re-add the affected clips, then retry.`,
      true
    );
  }
}

async function callModel(input: {
  player: NonNullable<Awaited<ReturnType<typeof getPlayer>>>;
  aggregates: NonNullable<ReturnType<typeof aggregateClips>>;
  priors: PriorContext[];
  stills: PromptStill[];
  sessionDate: string;
  priorActiveIds: Set<string>;
  validStillPaths: Set<string>;
}): Promise<AssessmentToolOutput> {
  const client = anthropic();
  // Structured outputs (output_config.format), not forced tool use —
  // claude-fable-5 rejects tool_choice forcing. The installed SDK's types
  // predate output_config on the GA surface; the API accepts it, so the
  // params object carries one localized cast.
  const message = await client.messages.create(
    {
      model: SWING_MODEL,
      max_tokens: 8000,
      system: buildSystemPrompt(),
      output_config: {
        format: {
          type: "json_schema",
          schema: ASSESSMENT_OUTPUT_SCHEMA,
        },
      },
      messages: [
        {
          role: "user",
          content: buildUserPrompt({
            player: input.player,
            aggregates: input.aggregates,
            priors: input.priors,
            library: DRILL_LIBRARY,
            stills: input.stills,
            sessionDate: input.sessionDate,
          }),
        },
      ],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
    // Must fail before Vercel's maxDuration 300s hard kill (SDK default 10min).
    { timeout: 250_000 }
  );

  if (message.stop_reason === "refusal") {
    throw new AssessmentError("Model refused to generate the assessment", false);
  }
  const textBlock = message.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new AssessmentError("Model returned no structured assessment", false);
  }
  let parsedOutput: unknown;
  try {
    parsedOutput = JSON.parse(textBlock.text);
  } catch {
    throw new AssessmentError("Model output was not valid JSON", false);
  }

  /* ALL-OR-NOTHING validation — deliberate divergence from quiz-generate's
   * fail-soft posture: a half-valid assessment is the overconfident-output
   * failure mode. Any problem → analysis_failed → retry. */
  const result = validateAssessmentOutput(parsedOutput, {
    validStillPaths: input.validStillPaths,
    priorFocusAreaIds: input.priorActiveIds,
    libraryKeys: new Set(DRILL_LIBRARY.map((e) => e.key)),
    expectsProgress: input.priorActiveIds.size > 0,
  });
  if (!result.ok) {
    throw new AssessmentError(
      `Model output failed validation: ${result.problems.slice(0, 4).join("; ")}`,
      false
    );
  }
  return result.output;
}
