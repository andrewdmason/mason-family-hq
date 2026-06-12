"use server";

import { createClient } from "@/lib/supabase/server";
import {
  BIRTH_YEAR_MAX,
  BIRTH_YEAR_MIN,
  playerFromRow,
  type Bats,
  type SwingPlayer,
} from "@/lib/swing/types";

/**
 * Roster mutations for the Swing Coach app. RLS is household-wide ("Family
 * access"), so these don't need ownership filters.
 *
 * Like the todos actions, these deliberately do NOT revalidatePath: the
 * roster shell reconciles client-side with router.refresh() after each
 * mutation, and the swing pages are force-dynamic — revalidation here would
 * only bolt a second full re-render onto every mutation's POST.
 *
 * Players are never hard-deleted: archiving stamps archived_at so the
 * player's sessions, assessments, and focus-area history stay queryable
 * (and restorable) forever.
 */

function validatePlayerInput(input: {
  name: string;
  birthYear: number;
  bats: Bats;
  notes?: string | null;
}) {
  const name = input.name.trim();
  if (!name) throw new Error("Player name is required");
  if (
    !Number.isInteger(input.birthYear) ||
    input.birthYear < BIRTH_YEAR_MIN ||
    input.birthYear > BIRTH_YEAR_MAX
  ) {
    throw new Error(
      `Birth year must be between ${BIRTH_YEAR_MIN} and ${BIRTH_YEAR_MAX}`
    );
  }
  if (input.bats !== "L" && input.bats !== "R") {
    throw new Error("Bats must be L or R");
  }
  return {
    name,
    birth_year: input.birthYear,
    bats: input.bats,
    notes: input.notes?.trim() || null,
  };
}

export async function createPlayer(input: {
  name: string;
  birthYear: number;
  bats: Bats;
  notes?: string | null;
}): Promise<SwingPlayer> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("swing_players")
    .insert(validatePlayerInput(input))
    .select("*")
    .single();
  if (error) throw new Error(`Couldn't add player: ${error.message}`);
  return playerFromRow(data);
}

export async function updatePlayer(
  playerId: string,
  input: {
    name: string;
    birthYear: number;
    bats: Bats;
    notes?: string | null;
  }
): Promise<SwingPlayer> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("swing_players")
    .update(validatePlayerInput(input))
    .eq("id", playerId)
    .select("*")
    .single();
  if (error) throw new Error(`Couldn't save player: ${error.message}`);
  return playerFromRow(data);
}

/** Soft delete: the player leaves the roster but all history is retained. */
export async function archivePlayer(playerId: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("swing_players")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", playerId);
  if (error) throw new Error(`Couldn't archive player: ${error.message}`);
}

/* ===================================================================== *
 * Sessions & clips (U8)
 *
 * Trust boundary rules (see plan: Key Technical Decisions):
 *   • The issuing action CREATES THE CLIP ROW FIRST and writes the artifact
 *     paths it generated — client-echoed paths are never stored.
 *   • Client-computed metrics/events are shape-validated (sanitize.ts); the
 *     server can't recompute them (raw video never reaches it) but controls
 *     what it stores.
 *   • Session readiness is DERIVED — nothing here writes 'extracted' or
 *     'insufficient'; the analyze route re-verifies at the moment it runs.
 * ===================================================================== */

import { SWING_BUCKET } from "@/lib/swing/queries";
import {
  sanitizeAnnotations,
  sanitizeBats,
  sanitizeEvents,
  sanitizeFiniteNumber,
  sanitizeMetrics,
} from "@/lib/swing/sanitize";
import { SWING_PHASES, type StillInfo, type SwingPhase } from "@/lib/swing/types";

export async function createSession(
  playerId: string,
  filmedOn?: string
): Promise<string> {
  // The client passes its local date — the DB default (CURRENT_DATE, UTC)
  // would be off by one for evening sessions in US timezones.
  if (filmedOn !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(filmedOn)) {
    throw new Error("Invalid date");
  }
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("swing_sessions")
    .insert({
      player_id: playerId,
      ...(filmedOn ? { filmed_on: filmedOn } : {}),
    })
    .select("id")
    .single();
  if (error) throw new Error(`Couldn't create session: ${error.message}`);
  return data.id as string;
}

export async function updateSessionFilmedOn(
  sessionId: string,
  filmedOn: string
): Promise<void> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(filmedOn)) throw new Error("Invalid date");
  const supabase = await createClient();
  const { error } = await supabase
    .from("swing_sessions")
    .update({ filmed_on: filmedOn })
    .eq("id", sessionId)
    .eq("status", "draft");
  if (error) throw new Error(`Couldn't update session date: ${error.message}`);
}

export interface ClipUploadGrant {
  kind: "grant";
  clipId: string;
  /** path + token pairs for uploadToSignedUrl, keyed by artifact. */
  keypoints: { path: string; token: string };
  stills: { phase: SwingPhase; path: string; token: string }[];
  /** Present when the client rendered an annotated swing video. */
  video: { path: string; token: string } | null;
}

export interface ClipAlreadyDone {
  kind: "already_done";
  clipId: string;
}

/**
 * Row-first artifact upload issuance. Upserts on UNIQUE(session_id,
 * content_hash): an ok clip short-circuits (duplicate add / resume), anything
 * else (pending/extracting/rejected — e.g. crashed mid-extract or re-add
 * after upload failure) RESETS that row rather than inserting beside it.
 */
export async function issueClipArtifactUploads(
  sessionId: string,
  input: {
    contentHash: string;
    fileName: string | null;
    stills: { phase: SwingPhase; contentType: string; annotations: string[] }[];
    hasVideo: boolean;
  }
): Promise<ClipUploadGrant | ClipAlreadyDone> {
  if (!/^[0-9a-f]{64}$/.test(input.contentHash)) throw new Error("Bad content hash");
  if (input.stills.length > SWING_PHASES.length) throw new Error("Too many stills");
  const supabase = await createClient();

  const { data: session } = await supabase
    .from("swing_sessions")
    .select("id, status")
    .eq("id", sessionId)
    .maybeSingle();
  if (!session) throw new Error("Session not found");
  if (session.status !== "draft") {
    throw new Error("Clips can only be added while the session is a draft");
  }

  const { data: existing } = await supabase
    .from("swing_clips")
    .select("id, status")
    .eq("session_id", sessionId)
    .eq("content_hash", input.contentHash)
    .maybeSingle();
  if (existing?.status === "ok") {
    return { kind: "already_done", clipId: existing.id };
  }

  // Server-generated paths — never client-echoed. {session}/{clip}/... keeps
  // mutable foreign keys (player) out of storage paths by design.
  const clipId = existing?.id ?? crypto.randomUUID();
  const keypointsPath = `${sessionId}/${clipId}/keypoints.json.gz`;
  const stillsInfo: StillInfo[] = input.stills.map((s) => {
    const phase = SWING_PHASES.includes(s.phase) ? s.phase : "contact";
    const ext = s.contentType === "image/jpeg" ? "jpg" : "webp";
    return {
      path: `${sessionId}/${clipId}/still-${phase}.${ext}`,
      phase,
      contentType: s.contentType === "image/jpeg" ? "image/jpeg" : "image/webp",
      annotations: sanitizeAnnotations(s.annotations),
    };
  });

  const videoPath = input.hasVideo ? `${sessionId}/${clipId}/swing.mp4` : null;
  const row = {
    id: clipId,
    session_id: sessionId,
    status: "extracting",
    rejection_reason: null,
    content_hash: input.contentHash,
    file_name: input.fileName?.slice(0, 200) ?? null,
    keypoints_path: keypointsPath,
    stills: stillsInfo,
    // startMs/slowdown land in recordClipExtracted once uploads are acked.
    video: videoPath ? { path: videoPath, contentType: "video/mp4" } : null,
  };
  const { error: upsertError } = await supabase
    .from("swing_clips")
    .upsert(row, { onConflict: "session_id,content_hash" });
  if (upsertError) throw new Error(`Couldn't record clip: ${upsertError.message}`);

  const storage = supabase.storage.from(SWING_BUCKET);
  const grants: ClipUploadGrant = {
    kind: "grant",
    clipId,
    keypoints: await signUpload(storage, keypointsPath),
    stills: [],
    video: videoPath ? await signUpload(storage, videoPath) : null,
  };
  for (const s of stillsInfo) {
    grants.stills.push({ phase: s.phase, ...(await signUpload(storage, s.path)) });
  }
  return grants;
}

async function signUpload(
  storage: ReturnType<Awaited<ReturnType<typeof createClient>>["storage"]["from"]>,
  path: string
): Promise<{ path: string; token: string }> {
  // upsert:true because a reset row reuses its clipId — re-upload overwrites.
  const { data, error } = await storage.createSignedUploadUrl(path, { upsert: true });
  if (error || !data) throw new Error(`Couldn't sign upload: ${error?.message}`);
  return { path: data.path, token: data.token };
}

/** Mark a clip ok after its artifacts uploaded. Payload is shape-validated. */
export async function recordClipExtracted(
  clipId: string,
  payload: {
    events: unknown;
    metrics: unknown;
    detectedBats: unknown;
    hitterHeight: unknown;
    sourceFps: unknown;
    durationSeconds: unknown;
    filmedAt: string | null;
    /** Timeline mapping for the annotated video (when one was uploaded). */
    videoMeta: { startMs: unknown; slowdown: unknown } | null;
  }
): Promise<void> {
  const supabase = await createClient();

  // The video path was server-issued at grant time; only the timeline
  // mapping comes from the client, and only as bounded finite numbers.
  let video: Record<string, unknown> | undefined;
  if (payload.videoMeta) {
    const { data: existing } = await supabase
      .from("swing_clips")
      .select("video")
      .eq("id", clipId)
      .maybeSingle();
    const startMs = sanitizeFiniteNumber(payload.videoMeta.startMs);
    const slowdown = sanitizeFiniteNumber(payload.videoMeta.slowdown);
    if (existing?.video && startMs !== null && startMs >= 0 && slowdown !== null) {
      video = {
        ...existing.video,
        startMs,
        slowdown: Math.min(Math.max(slowdown, 1), 32),
      };
    }
  }

  const { error } = await supabase
    .from("swing_clips")
    .update({
      status: "ok",
      rejection_reason: null,
      events: sanitizeEvents(payload.events),
      metrics: sanitizeMetrics(payload.metrics),
      detected_bats: sanitizeBats(payload.detectedBats),
      hitter_height: sanitizeFiniteNumber(payload.hitterHeight),
      source_fps: sanitizeFiniteNumber(payload.sourceFps),
      duration_seconds: sanitizeFiniteNumber(payload.durationSeconds),
      filmed_at: payload.filmedAt,
      ...(video !== undefined ? { video } : {}),
    })
    .eq("id", clipId)
    .eq("status", "extracting");
  if (error) throw new Error(`Couldn't record clip result: ${error.message}`);
}

/** Record a clip the pipeline rejected (no artifacts uploaded). */
export async function recordClipRejected(
  sessionId: string,
  input: {
    contentHash: string;
    fileName: string | null;
    reason: string;
    sourceFps: unknown;
    durationSeconds: unknown;
    filmedAt: string | null;
  }
): Promise<void> {
  if (!/^[0-9a-f]{64}$/.test(input.contentHash)) throw new Error("Bad content hash");
  const supabase = await createClient();

  const { data: session } = await supabase
    .from("swing_sessions")
    .select("id, status")
    .eq("id", sessionId)
    .maybeSingle();
  if (!session) throw new Error("Session not found");
  if (session.status !== "draft") {
    throw new Error("Clips can only be recorded while the session is a draft");
  }

  // Never downgrade an ok clip (or null its artifact paths) — a stale
  // rejection arriving after a successful extract is a no-op.
  const { data: existing } = await supabase
    .from("swing_clips")
    .select("id, status")
    .eq("session_id", sessionId)
    .eq("content_hash", input.contentHash)
    .maybeSingle();
  if (existing?.status === "ok") return;

  const { error } = await supabase.from("swing_clips").upsert(
    {
      session_id: sessionId,
      status: "rejected",
      rejection_reason: input.reason.slice(0, 500),
      content_hash: input.contentHash,
      file_name: input.fileName?.slice(0, 200) ?? null,
      keypoints_path: null,
      stills: [],
      source_fps: sanitizeFiniteNumber(input.sourceFps),
      duration_seconds: sanitizeFiniteNumber(input.durationSeconds),
      filmed_at: input.filmedAt,
    },
    { onConflict: "session_id,content_hash" }
  );
  if (error) throw new Error(`Couldn't record rejection: ${error.message}`);
}

/** Coach-initiated exclusion (e.g. "different player?" outlier confirm). */
export async function excludeClip(clipId: string, reason: string): Promise<void> {
  const supabase = await createClient();

  // Only allowed while the clip's session is still a draft — excluding a
  // clip after analysis would silently desync the assessment's inputs.
  const { data: clip } = await supabase
    .from("swing_clips")
    .select("id, session_id")
    .eq("id", clipId)
    .maybeSingle();
  if (!clip) throw new Error("Clip not found");
  const { data: session } = await supabase
    .from("swing_sessions")
    .select("status")
    .eq("id", clip.session_id)
    .maybeSingle();
  if (!session || session.status !== "draft") {
    throw new Error("Clips can only be excluded while the session is a draft");
  }

  const { error } = await supabase
    .from("swing_clips")
    .update({ status: "rejected", rejection_reason: reason.slice(0, 500) })
    .eq("id", clipId)
    .eq("status", "ok");
  if (error) throw new Error(`Couldn't exclude clip: ${error.message}`);
}

/**
 * Delete an abandoned session: rows + the {session_id}/ storage prefix.
 * Only draft/never-successfully-assessed sessions qualify — this is the
 * cleanup lever for dead weight and upload orphans, not assessment removal.
 */
export async function deleteSession(sessionId: string): Promise<void> {
  const supabase = await createClient();
  // Only a LIVE assessment blocks deletion: void first, then delete. Voided,
  // superseded, and failed assessment rows are part of the session and go
  // with it (FK cascade) — that's the full wrong-kid/garbage cleanup path.
  const { data: assessments } = await supabase
    .from("swing_assessments")
    .select("id, status")
    .eq("session_id", sessionId)
    .in("status", ["complete", "generating"]);
  if ((assessments ?? []).length > 0) {
    throw new Error("This session has a live assessment — void it first, then delete");
  }

  // Derive object paths from rows (no recursive bucket walking needed).
  const { data: clips } = await supabase
    .from("swing_clips")
    .select("keypoints_path, stills, video")
    .eq("session_id", sessionId);
  const paths: string[] = [];
  for (const clip of clips ?? []) {
    if (clip.keypoints_path) paths.push(clip.keypoints_path);
    for (const s of (clip.stills ?? []) as StillInfo[]) paths.push(s.path);
    if (clip.video?.path) paths.push(clip.video.path as string);
  }
  if (paths.length > 0) {
    const { error: storageError } = await supabase.storage
      .from(SWING_BUCKET)
      .remove(paths);
    if (storageError) {
      throw new Error(`Couldn't delete session media: ${storageError.message}`);
    }
  }
  const { error } = await supabase
    .from("swing_sessions")
    .delete()
    .eq("id", sessionId);
  if (error) throw new Error(`Couldn't delete session: ${error.message}`);
}

/**
 * Reassign a session to another player (wrong-kid recovery). Storage paths
 * contain no player linkage by design, so this is a one-column update.
 * Allowed while no live (non-voided) assessment exists.
 */
export async function reassignSession(
  sessionId: string,
  newPlayerId: string
): Promise<void> {
  const supabase = await createClient();
  const { data: live } = await supabase
    .from("swing_assessments")
    .select("id")
    .eq("session_id", sessionId)
    .in("status", ["complete", "superseded", "generating"]);
  if ((live ?? []).length > 0) {
    throw new Error("Void the assessment before reassigning this session");
  }
  const { error } = await supabase
    .from("swing_sessions")
    .update({ player_id: newPlayerId, status: "draft" })
    .eq("id", sessionId);
  if (error) throw new Error(`Couldn't reassign session: ${error.message}`);
}

/* ===================================================================== *
 * Assessments (U10): void. Derived current-ness means void is ONE status
 * flip — the previous complete assessment's focus areas become current
 * automatically, with no compensating writes to get wrong.
 * ===================================================================== */

export async function voidAssessment(assessmentId: string): Promise<void> {
  const supabase = await createClient();
  const { data: assessment, error: loadError } = await supabase
    .from("swing_assessments")
    .select("id, session_id, status")
    .eq("id", assessmentId)
    .maybeSingle();
  if (loadError || !assessment) throw new Error("Assessment not found");
  if (assessment.status !== "complete") {
    throw new Error("Only a complete assessment can be voided");
  }

  const { error } = await supabase
    .from("swing_assessments")
    .update({ status: "voided" })
    .eq("id", assessmentId)
    .eq("status", "complete");
  if (error) throw new Error(`Couldn't void assessment: ${error.message}`);

  // Cascade: voiding the live assessment also voids the same session's
  // superseded history — otherwise a superseded row would keep the session
  // looking "assessed" and block the draft reset below.
  const { error: cascadeError } = await supabase
    .from("swing_assessments")
    .update({ status: "voided" })
    .eq("session_id", assessment.session_id)
    .eq("status", "superseded");
  if (cascadeError) {
    throw new Error(`Couldn't void superseded assessments: ${cascadeError.message}`);
  }

  // A session whose only assessments are voided is analyzable (and
  // reassignable) again — wrong-kid recovery composes with reassign even
  // after analysis ran.
  const { data: live, error: liveError } = await supabase
    .from("swing_assessments")
    .select("id")
    .eq("session_id", assessment.session_id)
    .in("status", ["complete", "generating", "superseded"]);
  if (liveError) {
    throw new Error(`Couldn't check live assessments: ${liveError.message}`);
  }
  if ((live ?? []).length === 0) {
    const { error: resetError } = await supabase
      .from("swing_sessions")
      .update({ status: "draft" })
      .eq("id", assessment.session_id);
    if (resetError) {
      throw new Error(`Couldn't reset session to draft: ${resetError.message}`);
    }
  }
}

/**
 * Remove a non-ok clip row (rejected / interrupted) so the coach can clear
 * errors and re-add the file for a fresh run. Frees the (session, hash) slot;
 * any partially-uploaded artifacts are removed first. Usable clips are
 * excluded via excludeClip instead — they keep their row as an audit trail.
 */
export async function deleteClip(clipId: string): Promise<void> {
  const supabase = await createClient();
  const { data: clip, error: loadError } = await supabase
    .from("swing_clips")
    .select("id, session_id, status, keypoints_path, stills")
    .eq("id", clipId)
    .maybeSingle();
  if (loadError || !clip) throw new Error("Clip not found");
  if (clip.status === "ok") {
    throw new Error("This clip analyzed fine — exclude it instead of deleting");
  }
  const { data: session } = await supabase
    .from("swing_sessions")
    .select("status")
    .eq("id", clip.session_id)
    .maybeSingle();
  if (session?.status !== "draft") {
    throw new Error("Clips can only be removed while the session is a draft");
  }

  const paths: string[] = [];
  if (clip.keypoints_path) paths.push(clip.keypoints_path);
  for (const s of (clip.stills ?? []) as StillInfo[]) paths.push(s.path);
  if (paths.length > 0) {
    const { error: storageError } = await supabase.storage
      .from(SWING_BUCKET)
      .remove(paths);
    if (storageError) {
      throw new Error(`Couldn't clean up clip artifacts: ${storageError.message}`);
    }
  }

  const { error } = await supabase.from("swing_clips").delete().eq("id", clipId);
  if (error) throw new Error(`Couldn't remove clip: ${error.message}`);
}
