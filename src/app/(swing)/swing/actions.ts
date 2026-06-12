"use server";

import { createClient } from "@/lib/supabase/server";
import { playerFromRow, type Bats, type SwingPlayer } from "@/lib/swing/types";

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

const BIRTH_YEAR_MIN = 1990;
const BIRTH_YEAR_MAX = 2030;

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

export async function createSession(playerId: string): Promise<string> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("swing_sessions")
    .insert({ player_id: playerId })
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

  const row = {
    id: clipId,
    session_id: sessionId,
    status: "extracting",
    rejection_reason: null,
    content_hash: input.contentHash,
    file_name: input.fileName?.slice(0, 200) ?? null,
    keypoints_path: keypointsPath,
    stills: stillsInfo,
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
  }
): Promise<void> {
  const supabase = await createClient();
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
  const { data: assessments } = await supabase
    .from("swing_assessments")
    .select("id, status")
    .eq("session_id", sessionId)
    .in("status", ["complete", "superseded", "voided", "generating"]);
  if ((assessments ?? []).length > 0) {
    throw new Error("This session has an assessment — void it instead of deleting");
  }

  // Derive object paths from rows (no recursive bucket walking needed).
  const { data: clips } = await supabase
    .from("swing_clips")
    .select("keypoints_path, stills")
    .eq("session_id", sessionId);
  const paths: string[] = [];
  for (const clip of clips ?? []) {
    if (clip.keypoints_path) paths.push(clip.keypoints_path);
    for (const s of (clip.stills ?? []) as StillInfo[]) paths.push(s.path);
  }
  if (paths.length > 0) {
    await supabase.storage.from(SWING_BUCKET).remove(paths);
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
