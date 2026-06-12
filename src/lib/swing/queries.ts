import "server-only";

import { createClient } from "@/lib/supabase/server";
import {
  MIN_USABLE_CLIPS,
  assessmentFromRow,
  clipFromRow,
  focusAreaFromRow,
  playerFromRow,
  sessionFromRow,
  type SwingAssessment,
  type SwingClip,
  type SwingFocusArea,
  type SwingPlayer,
  type SwingSession,
} from "@/lib/swing/types";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export const SWING_BUCKET = "swing-artifacts";

/**
 * Evidence stills are images of non-family minors, so signed URLs use a short
 * TTL (refreshed per page load) instead of the 3600s todo-images default —
 * bounds exposure if a URL is ever shared or screenshotted.
 */
export const STILL_URL_TTL_SECONDS = 300;

/* ------------------------------------------------------------- players --- */

export async function getPlayers(
  supabase: Supabase,
  { includeArchived = false } = {}
): Promise<SwingPlayer[]> {
  let query = supabase.from("swing_players").select("*").order("name");
  if (!includeArchived) query = query.is("archived_at", null);
  const { data } = await query;
  return (data ?? []).map(playerFromRow);
}

export async function getPlayer(
  supabase: Supabase,
  playerId: string
): Promise<SwingPlayer | null> {
  const { data } = await supabase
    .from("swing_players")
    .select("*")
    .eq("id", playerId)
    .maybeSingle();
  return data ? playerFromRow(data) : null;
}

/* ----------------------------------------------- derived current state --- */

/**
 * The player's latest non-superseded, non-voided complete assessment. This is
 * the single derivation behind "current focus areas" everywhere (F3 field
 * view, roster summaries, prompt context anchoring) — focus-area rows are
 * immutable snapshots, so current-ness is always computed, never stored.
 */
export async function getCurrentAssessment(
  supabase: Supabase,
  playerId: string
): Promise<SwingAssessment | null> {
  const { data } = await supabase
    .from("swing_assessments")
    .select("*")
    .eq("player_id", playerId)
    .eq("status", "complete")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ? assessmentFromRow(data) : null;
}

export async function getFocusAreas(
  supabase: Supabase,
  assessmentId: string
): Promise<SwingFocusArea[]> {
  const { data } = await supabase
    .from("swing_focus_areas")
    .select("*")
    .eq("assessment_id", assessmentId)
    .order("rank");
  return (data ?? []).map(focusAreaFromRow);
}

export async function getCurrentFocusAreas(
  supabase: Supabase,
  playerId: string
): Promise<{ assessment: SwingAssessment; focusAreas: SwingFocusArea[] } | null> {
  const assessment = await getCurrentAssessment(supabase, playerId);
  if (!assessment) return null;
  return { assessment, focusAreas: await getFocusAreas(supabase, assessment.id) };
}

/** Roster-home summaries: current focus-area cue per player, in one sweep. */
export async function getRosterFocusSummaries(
  supabase: Supabase,
  playerIds: string[]
): Promise<Record<string, { focusCount: number; topCue: string | null }>> {
  if (playerIds.length === 0) return {};
  const { data: assessments } = await supabase
    .from("swing_assessments")
    .select("id, player_id, created_at")
    .in("player_id", playerIds)
    .eq("status", "complete")
    .order("created_at", { ascending: false });
  const latestByPlayer = new Map<string, string>();
  for (const row of assessments ?? []) {
    if (!latestByPlayer.has(row.player_id)) latestByPlayer.set(row.player_id, row.id);
  }
  if (latestByPlayer.size === 0) return {};
  const { data: areas } = await supabase
    .from("swing_focus_areas")
    .select("assessment_id, player_id, rank, cue")
    .in("assessment_id", [...latestByPlayer.values()])
    .eq("disposition", "focus")
    .order("rank");
  const summaries: Record<string, { focusCount: number; topCue: string | null }> = {};
  for (const row of areas ?? []) {
    if (latestByPlayer.get(row.player_id) !== row.assessment_id) continue;
    const entry = (summaries[row.player_id] ??= { focusCount: 0, topCue: null });
    entry.focusCount += 1;
    if (entry.topCue === null) entry.topCue = row.cue;
  }
  return summaries;
}

/* ------------------------------------------------------------ sessions --- */

export async function getSession(
  supabase: Supabase,
  sessionId: string
): Promise<SwingSession | null> {
  const { data } = await supabase
    .from("swing_sessions")
    .select("*")
    .eq("id", sessionId)
    .maybeSingle();
  return data ? sessionFromRow(data) : null;
}

export async function getSessionClips(
  supabase: Supabase,
  sessionId: string
): Promise<SwingClip[]> {
  const { data } = await supabase
    .from("swing_clips")
    .select("*")
    .eq("session_id", sessionId)
    .order("created_at");
  return (data ?? []).map(clipFromRow);
}

export async function getPlayerSessions(
  supabase: Supabase,
  playerId: string
): Promise<SwingSession[]> {
  const { data } = await supabase
    .from("swing_sessions")
    .select("*")
    .eq("player_id", playerId)
    .order("created_at", { ascending: false });
  return (data ?? []).map(sessionFromRow);
}

/**
 * Session readiness is a DERIVED predicate (never a stored status): the
 * analyze route re-runs this exact check server-side at the moment it fires.
 */
export function countUsableClips(clips: SwingClip[]): number {
  return clips.filter((c) => c.status === "ok").length;
}

export function isReadyToAnalyze(clips: SwingClip[]): boolean {
  return countUsableClips(clips) >= MIN_USABLE_CLIPS;
}

/* ----------------------------------------------------------- history ----- */

export async function getPlayerAssessments(
  supabase: Supabase,
  playerId: string
): Promise<SwingAssessment[]> {
  const { data } = await supabase
    .from("swing_assessments")
    .select("*")
    .eq("player_id", playerId)
    .order("created_at", { ascending: false });
  return (data ?? []).map(assessmentFromRow);
}

export async function getAssessment(
  supabase: Supabase,
  assessmentId: string
): Promise<SwingAssessment | null> {
  const { data } = await supabase
    .from("swing_assessments")
    .select("*")
    .eq("id", assessmentId)
    .maybeSingle();
  return data ? assessmentFromRow(data) : null;
}

/**
 * Prompt history: the last N COMPLETE assessments with their focus areas.
 * Voided text is the wrong kid's mechanics (the content voiding expunges) and
 * superseded text was never delivered — both are excluded by the status
 * filter, mirroring the current-ness derivation.
 */
export async function getPriorAssessmentsForPrompt(
  supabase: Supabase,
  playerId: string,
  limit = 3
): Promise<{ assessment: SwingAssessment; focusAreas: SwingFocusArea[] }[]> {
  const { data } = await supabase
    .from("swing_assessments")
    .select("*")
    .eq("player_id", playerId)
    .eq("status", "complete")
    .order("created_at", { ascending: false })
    .limit(limit);
  const assessments = (data ?? []).map(assessmentFromRow);
  return Promise.all(
    assessments.map(async (assessment) => ({
      assessment,
      focusAreas: await getFocusAreas(supabase, assessment.id),
    }))
  );
}

/* -------------------------------------------------------------- stills --- */

/** Batch-sign artifact paths for display. Returns path → signed URL. */
export async function signArtifactUrls(
  supabase: Supabase,
  paths: string[]
): Promise<Map<string, string>> {
  if (paths.length === 0) return new Map();
  const { data } = await supabase.storage
    .from(SWING_BUCKET)
    .createSignedUrls(paths, STILL_URL_TTL_SECONDS);
  return new Map(
    (data ?? [])
      .filter((s) => s.signedUrl)
      .map((s) => [s.path ?? "", s.signedUrl] as const)
  );
}
