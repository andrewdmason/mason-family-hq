"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireUserId } from "@/lib/members/auth";
import { buildQuickPlan, type PlanSegment } from "@/lib/clips/plan";
import { formatGameDate } from "@/lib/clips/format";
import { getAtBat, getGame } from "@/lib/clips/queries";
import { playResultOf, reelSharePlan, scorebookResult, type PlayResult } from "@/lib/clips/reel";
import {
  AT_BAT_RESULTS,
  CLIPS_BUCKET,
  PITCH_OUTCOMES,
  resultName,
  type AtBatResult,
  type BattedBall,
  type ClipAtBat,
  type ClipPitch,
  type ClipZoom,
  type PitchOutcome,
} from "@/lib/clips/types";
import {
  atBatPaths,
  clipsWorkerConfigured,
  startExport,
  startPrepare,
  type ExportPart,
} from "@/lib/clips/worker";

// Pitch-marker edits deliberately skip revalidatePath: the player holds its own
// state, and a revalidation would re-render the page under someone mid-edit.
// The feed is force-dynamic, so it's fresh on the next visit anyway.

const VIDEO_EXTS = new Set(["mov", "mp4", "m4v"]);

export async function createGame(input: {
  kidId: string;
  name: string;
  playedOn: string;
}): Promise<{ id: string }> {
  const sb = await createClient();
  const userId = await requireUserId(sb);
  const name = input.name.trim();
  if (!name) throw new Error("Give the game a name");
  const { data, error } = await sb
    .from("clip_games")
    .insert({ kid_id: input.kidId, name, played_on: input.playedOn, created_by: userId })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  revalidatePath("/clips");
  return { id: data.id };
}

export async function updateGame(
  gameId: string,
  patch: { name?: string; playedOn?: string; kidId?: string },
): Promise<void> {
  const sb = await createClient();
  await requireUserId(sb);
  const row: Record<string, string> = {};
  if (patch.name !== undefined) {
    if (!patch.name.trim()) throw new Error("Give the game a name");
    row.name = patch.name.trim();
  }
  if (patch.playedOn) row.played_on = patch.playedOn;
  if (patch.kidId) row.kid_id = patch.kidId;
  const { error } = await sb.from("clip_games").update(row).eq("id", gameId);
  if (error) throw new Error(error.message);
  revalidatePath("/clips");
}

async function removeStoragePrefix(sb: Awaited<ReturnType<typeof createClient>>, dir: string) {
  const { data } = await sb.storage.from(CLIPS_BUCKET).list(dir, { limit: 100 });
  const paths = (data ?? []).map((f) => `${dir}/${f.name}`);
  if (paths.length) await sb.storage.from(CLIPS_BUCKET).remove(paths);
}

export async function deleteGame(gameId: string): Promise<void> {
  const sb = await createClient();
  await requireUserId(sb);
  const { data: atBats } = await sb.from("clip_at_bats").select("id").eq("game_id", gameId);
  for (const ab of atBats ?? []) await removeStoragePrefix(sb, atBatPaths(gameId, ab.id).dir);
  const { error } = await sb.from("clip_games").delete().eq("id", gameId);
  if (error) throw new Error(error.message);
  revalidatePath("/clips");
}

/**
 * Reserve an at-bat row and its storage path before the browser uploads the
 * original. Passing `resumeId` (remembered by the upload screen) reuses an
 * at-bat whose earlier upload was interrupted, so re-picking the same video
 * resumes it rather than starting a duplicate.
 */
export async function beginAtBatUpload(input: {
  gameId: string;
  fileName: string;
  bytes: number;
  resumeId?: string;
}): Promise<{ atBatId: string; path: string; resumed: boolean }> {
  const sb = await createClient();
  const userId = await requireUserId(sb);

  if (input.resumeId) {
    const { data: prior } = await sb
      .from("clip_at_bats")
      .select("id, game_id, status, original_path")
      .eq("id", input.resumeId)
      .maybeSingle();
    if (prior && prior.game_id === input.gameId && prior.status === "uploading") {
      return { atBatId: prior.id, path: prior.original_path, resumed: true };
    }
  }

  const raw = input.fileName.split(".").pop()?.toLowerCase() ?? "";
  const ext = VIDEO_EXTS.has(raw) ? raw : "mov";
  const atBatId = crypto.randomUUID();
  const path = atBatPaths(input.gameId, atBatId).original(ext);
  const { error } = await sb.from("clip_at_bats").insert({
    id: atBatId,
    game_id: input.gameId,
    status: "uploading",
    original_path: path,
    original_name: input.fileName,
    original_bytes: input.bytes,
    created_by: userId,
  });
  if (error) throw new Error(error.message);
  return { atBatId, path, resumed: false };
}

/**
 * The original is in storage: hand it to the worker for the playback copy. If
 * the worker isn't configured (or won't take the job), the at-bat is still
 * watchable — the player streams the original until a copy exists.
 */
export async function finishAtBatUpload(atBatId: string): Promise<void> {
  const sb = await createClient();
  await requireUserId(sb);
  const { data: ab } = await sb
    .from("clip_at_bats")
    .select("id, game_id, original_path")
    .eq("id", atBatId)
    .single();
  if (!ab) throw new Error("At-bat not found");
  await prepare(sb, { id: ab.id, gameId: ab.game_id, originalPath: ab.original_path });
  revalidatePath("/clips");
}

/** Re-run the playback-copy job (after a failure, or once the worker is set up). */
export async function reprocessAtBat(atBatId: string): Promise<void> {
  await finishAtBatUpload(atBatId);
}

async function prepare(
  sb: Awaited<ReturnType<typeof createClient>>,
  ab: { id: string; gameId: string; originalPath: string },
) {
  if (!clipsWorkerConfigured()) {
    await sb.from("clip_at_bats").update({ status: "ready", error_message: null }).eq("id", ab.id);
    return;
  }
  await sb
    .from("clip_at_bats")
    .update({ status: "processing", error_message: null, updated_at: new Date().toISOString() })
    .eq("id", ab.id);
  try {
    await startPrepare(sb, ab);
  } catch (e) {
    await sb
      .from("clip_at_bats")
      .update({
        status: "ready",
        error_message: `Playback copy not made: ${e instanceof Error ? e.message : "worker error"}`.slice(0, 500),
      })
      .eq("id", ab.id);
  }
}

export async function deleteAtBat(atBatId: string): Promise<void> {
  const sb = await createClient();
  await requireUserId(sb);
  const { data: ab } = await sb.from("clip_at_bats").select("game_id").eq("id", atBatId).maybeSingle();
  if (!ab) return;
  await removeStoragePrefix(sb, atBatPaths(ab.game_id, atBatId).dir);
  const { error } = await sb.from("clip_at_bats").delete().eq("id", atBatId);
  if (error) throw new Error(error.message);
  revalidatePath("/clips");
}

/**
 * Fresh signed URLs for the player. Fetched on mount rather than baked into the
 * page, so a stale page served from the app-shell cache never holds an expired
 * video link.
 */
export async function getAtBatMedia(
  atBatId: string,
): Promise<{ videoUrl: string; isPlaybackCopy: boolean }> {
  const sb = await createClient();
  await requireUserId(sb);
  const { data: ab } = await sb
    .from("clip_at_bats")
    .select("original_path, playback_path")
    .eq("id", atBatId)
    .single();
  if (!ab) throw new Error("At-bat not found");
  const path = ab.playback_path ?? ab.original_path;
  const { data, error } = await sb.storage.from(CLIPS_BUCKET).createSignedUrl(path, 6 * 60 * 60);
  if (error || !data) throw new Error(error?.message ?? "Could not load the video");
  return { videoUrl: data.signedUrl, isPlaybackCopy: !!ab.playback_path };
}

/**
 * Fresh signed URLs for a pitch reel and its GameChanger field view (the
 * player runs on from one into the other).
 */
export async function getReelMedia(atBatId: string): Promise<{ reelUrl: string; fieldViewUrl: string | null }> {
  const sb = await createClient();
  await requireUserId(sb);
  const { data: ab } = await sb
    .from("clip_at_bats")
    .select("playback_path, original_path, field_view_path")
    .eq("id", atBatId)
    .single();
  if (!ab) throw new Error("At-bat not found");
  const sign = async (path: string) => {
    const { data, error } = await sb.storage.from(CLIPS_BUCKET).createSignedUrl(path, 6 * 60 * 60);
    if (error || !data) throw new Error(error?.message ?? "Could not load the video");
    return data.signedUrl;
  };
  return {
    reelUrl: await sign(ab.playback_path ?? ab.original_path),
    fieldViewUrl: ab.field_view_path ? await sign(ab.field_view_path) : null,
  };
}

/**
 * Relabel one of a camera at-bat's pitches, the way the phone does: the
 * outcome (and for a ball in play its kind and what it did), with the at-bat's
 * result worked out again from all its pitches. Returns the new result.
 */
export async function relabelCameraPitch(
  atBatId: string,
  pitchId: string,
  label: { outcome: PitchOutcome; battedBall: BattedBall | null; playResult: PlayResult | null },
): Promise<AtBatResult | null> {
  const sb = await createClient();
  await requireUserId(sb);
  checkOutcome(label.outcome);
  const inPlay = label.outcome === "in_play";
  const { error } = await sb
    .from("clip_pitches")
    .update({ outcome: label.outcome, batted_ball: inPlay ? label.battedBall : null })
    .eq("id", pitchId)
    .eq("at_bat_id", atBatId);
  if (error) throw new Error(error.message);
  const ab = await getAtBat(atBatId);
  if (!ab) throw new Error("At-bat not found");
  // The play's result lives on the at-bat: the new one when this pitch is the
  // ball in play, else whatever the at-bat already says.
  const result = scorebookResult(ab.pitches, inPlay ? label.playResult : playResultOf(ab.result));
  const { error: e2 } = await sb
    .from("clip_at_bats")
    .update({ result, updated_at: new Date().toISOString() })
    .eq("id", atBatId);
  if (e2) throw new Error(e2.message);
  return result;
}

/** Signed upload for a new feed thumbnail (captured in the browser from a marked pitch). */
export async function getPosterUpload(atBatId: string): Promise<{ signedUrl: string; token: string; path: string }> {
  const sb = await createClient();
  await requireUserId(sb);
  const { data: ab } = await sb.from("clip_at_bats").select("game_id").eq("id", atBatId).single();
  if (!ab) throw new Error("At-bat not found");
  const path = atBatPaths(ab.game_id, atBatId).poster;
  const { data, error } = await sb.storage.from(CLIPS_BUCKET).createSignedUploadUrl(path, { upsert: true });
  if (error || !data) throw new Error(error?.message ?? "Could not sign poster upload");
  return { signedUrl: data.signedUrl, token: data.token, path };
}

export async function posterSaved(atBatId: string, path: string): Promise<void> {
  const sb = await createClient();
  await requireUserId(sb);
  await sb.from("clip_at_bats").update({ poster_path: path, updated_at: new Date().toISOString() }).eq("id", atBatId);
}

// --- Pitch markers -----------------------------------------------------------

type PitchRow = { id: string; t: number; outcome: PitchOutcome | null; source: "manual" | "auto" };

function checkOutcome(outcome: PitchOutcome | null | undefined) {
  if (outcome && !PITCH_OUTCOMES.some((o) => o.value === outcome)) throw new Error("Unknown pitch outcome");
}

export async function addPitch(
  atBatId: string,
  t: number,
  outcome: PitchOutcome | null = null,
): Promise<ClipPitch> {
  const sb = await createClient();
  await requireUserId(sb);
  checkOutcome(outcome);
  const { data, error } = await sb
    .from("clip_pitches")
    .insert({ at_bat_id: atBatId, t: Math.max(0, t), outcome })
    .select("id, t, outcome, source")
    .single();
  if (error) throw new Error(error.message);
  return data as PitchRow;
}

export async function updatePitch(
  pitchId: string,
  patch: { t?: number; outcome?: PitchOutcome | null },
): Promise<void> {
  const sb = await createClient();
  await requireUserId(sb);
  const row: Record<string, unknown> = {};
  if (patch.t !== undefined) row.t = Math.max(0, patch.t);
  if (patch.outcome !== undefined) {
    checkOutcome(patch.outcome);
    row.outcome = patch.outcome;
  }
  // An edited auto marker is now a human's call.
  row.source = "manual";
  const { error } = await sb.from("clip_pitches").update(row).eq("id", pitchId);
  if (error) throw new Error(error.message);
}

export async function deletePitch(pitchId: string): Promise<void> {
  const sb = await createClient();
  await requireUserId(sb);
  const { error } = await sb.from("clip_pitches").delete().eq("id", pitchId);
  if (error) throw new Error(error.message);
}

/** Set or clear the replay zoom box (fractions of the frame). */
export async function setAtBatZoom(atBatId: string, zoom: ClipZoom | null): Promise<void> {
  const sb = await createClient();
  await requireUserId(sb);
  if (zoom) {
    const ok = [zoom.x, zoom.y, zoom.s].every((n) => Number.isFinite(n)) &&
      zoom.s > 0.05 && zoom.s <= 1 && zoom.x >= 0 && zoom.y >= 0 &&
      zoom.x + zoom.s <= 1.0001 && zoom.y + zoom.s <= 1.0001;
    if (!ok) throw new Error("Zoom box is off the frame");
  }
  const { error } = await sb
    .from("clip_at_bats")
    .update({ zoom, replay_zoom: true, updated_at: new Date().toISOString() })
    .eq("id", atBatId);
  if (error) throw new Error(error.message);
}

/** Turn the replay zoom on or off (the box itself is kept). */
export async function setReplayZoom(atBatId: string, on: boolean): Promise<void> {
  const sb = await createClient();
  await requireUserId(sb);
  const { error } = await sb.from("clip_at_bats").update({ replay_zoom: on }).eq("id", atBatId);
  if (error) throw new Error(error.message);
}

/**
 * "Sebastian Mason" over "AB 2 · Flyout · Merchants Scrimmage · Sat, Sep 26,
 * 2026" — who's watching knows whose at-bat it is and what they're seeing.
 * Without the kid's name, the at-bat leads as before.
 */
function titleCard(
  game: { name: string; playedOn: string },
  index: number,
  result: AtBatResult | null,
  kid: string | null,
) {
  const name = resultName(result);
  const ab = `AB ${index + 1}${name ? ` · ${name}` : ""}`;
  const where = `${game.name} · ${formatGameDate(game.playedOn, true)}`;
  return kid ? { title: kid, subtitle: `${ab} · ${where}` } : { title: ab, subtitle: where };
}

/** The kid's full name ("Sebastian Mason"), for the title cards. */
async function kidFullName(sb: Awaited<ReturnType<typeof createClient>>, kidId: string): Promise<string | null> {
  const { data } = await sb.from("baseball_people").select("display_name").eq("id", kidId).maybeSingle();
  return (data?.display_name as string | undefined)?.trim() || null;
}

/**
 * A camera at-bat is already the finished quick version (captions and all), so
 * a game reel plays it whole. The worker always draws a caption, so it gets a
 * small "AB 2" in the corner, clear of the phone's own captions at the bottom.
 */
function finishedEditSegments(ab: { durationS: number | null }, index: number): PlanSegment[] {
  if (!ab.durationS) return [];
  return [
    { start: 0, end: ab.durationS, rate: 1, muted: false, caption: `AB ${index + 1}`, pitchIndex: 0, replay: false },
  ];
}

/**
 * Sharing a camera at-bat needs no render — the file is the finished video.
 * The export row is born ready so the share dialog works the same way.
 */
async function shareFinishedEdit(atBatId: string, path: string): Promise<{ exportId: string }> {
  const sb = await createClient();
  const userId = await requireUserId(sb);
  const exportId = crypto.randomUUID();
  const { error } = await sb.from("clip_exports").insert({
    id: exportId,
    at_bat_id: atBatId,
    status: "ready",
    path,
    created_by: userId,
    finished_at: new Date().toISOString(),
  });
  if (error) throw new Error(error.message);
  return { exportId };
}

/** Replays zoom to the at-bat's box when it has one and it's switched on. */
function withReplayZoom(segments: PlanSegment[], ab: { zoom: ClipZoom | null; replayZoom: boolean }) {
  if (!ab.zoom || !ab.replayZoom) return segments;
  return segments.map((s) => (s.replay ? { ...s, crop: ab.zoom! } : s));
}

/** Finish marking: the at-bat now opens in the watch view. */
export async function markAtBatDone(atBatId: string): Promise<void> {
  const sb = await createClient();
  await requireUserId(sb);
  const now = new Date().toISOString();
  const { error } = await sb.from("clip_at_bats").update({ marked_at: now, updated_at: now }).eq("id", atBatId);
  if (error) throw new Error(error.message);
}

export async function setAtBatResult(atBatId: string, result: AtBatResult | null): Promise<void> {
  const sb = await createClient();
  await requireUserId(sb);
  if (result && !AT_BAT_RESULTS.some((r) => r.value === result)) throw new Error("Unknown result");
  const { error } = await sb
    .from("clip_at_bats")
    .update({ result, updated_at: new Date().toISOString() })
    .eq("id", atBatId);
  if (error) throw new Error(error.message);
}

// --- Exports -----------------------------------------------------------------

async function beginExport(
  target: { atBatId: string } | { gameId: string },
  parts: ExportPart[],
): Promise<{ exportId: string }> {
  const sb = await createClient();
  const userId = await requireUserId(sb);
  if (parts.every((p) => p.segments.length === 0)) {
    throw new Error("Mark at least one pitch first — the quick version is built from the markers");
  }
  const exportId = crypto.randomUUID();
  const path = `exports/${exportId}.mp4`;
  const { error } = await sb.from("clip_exports").insert({
    id: exportId,
    at_bat_id: "atBatId" in target ? target.atBatId : null,
    game_id: "gameId" in target ? target.gameId : null,
    status: "rendering",
    plan: parts,
    created_by: userId,
  });
  if (error) throw new Error(error.message);
  try {
    await startExport(sb, exportId, path, parts);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Export failed to start";
    await sb.from("clip_exports").update({ status: "failed", error_message: message }).eq("id", exportId);
    throw new Error(message);
  }
  return { exportId };
}

/**
 * A pitch reel's export: its share plan (captions, and a ¼-speed replay after
 * each swing unless `replays` is off), then its GameChanger field view at real
 * speed with no caption.
 */
function reelParts(
  ab: ClipAtBat,
  paths: { reel: string; fieldView: string | null },
  card: ExportPart["card"],
  replays: boolean,
): ExportPart[] {
  const parts: ExportPart[] = [
    { card, originalPath: paths.reel, segments: reelSharePlan(ab.reel ?? [], ab.pitches, ab.result, replays) },
  ];
  if (ab.fieldView && paths.fieldView) {
    parts.push({
      card: null,
      originalPath: paths.fieldView,
      segments: [
        { start: ab.fieldView.start, end: ab.fieldView.end, rate: 1, muted: false, caption: "", pitchIndex: 0, replay: false },
      ],
    });
  }
  return parts;
}

/** The latest finished export of exactly these parts, if one was made. */
async function readyExport(atBatId: string, parts: ExportPart[]): Promise<string | null> {
  const sb = await createClient();
  const { data } = await sb
    .from("clip_exports")
    .select("id, plan")
    .eq("at_bat_id", atBatId)
    .eq("status", "ready")
    .order("created_at", { ascending: false })
    .limit(10);
  const want = JSON.stringify(parts);
  return data?.find((e) => JSON.stringify(e.plan) === want)?.id ?? null;
}

export async function exportAtBat(
  atBatId: string,
  opts: { replays?: boolean } = {},
): Promise<{ exportId: string }> {
  const sb = await createClient();
  const ab = await getAtBat(atBatId);
  if (!ab) throw new Error("At-bat not found");
  const { data: row } = await sb
    .from("clip_at_bats")
    .select("original_path, playback_path, field_view_path")
    .eq("id", atBatId)
    .single();
  if (ab.reel) {
    const game = await getGame(ab.gameId);
    const index = game?.atBats.findIndex((x) => x.id === atBatId) ?? 0;
    const kid = game ? await kidFullName(sb, game.kidId) : null;
    const parts = reelParts(
      ab,
      { reel: row!.playback_path ?? row!.original_path, fieldView: row!.field_view_path },
      game ? titleCard(game, index, ab.result, kid) : null,
      opts.replays ?? true,
    );
    const ready = await readyExport(atBatId, parts);
    return ready ? { exportId: ready } : beginExport({ atBatId }, parts);
  }
  if (ab.source === "camera") return shareFinishedEdit(atBatId, row!.original_path);
  const game = await getGame(ab.gameId);
  const index = game?.atBats.findIndex((x) => x.id === atBatId) ?? 0;
  const kid = game ? await kidFullName(sb, game.kidId) : null;
  const segments = withReplayZoom(buildQuickPlan(ab.pitches, ab.durationS ?? Infinity, ab.result), ab);
  return beginExport({ atBatId }, [
    { card: game ? titleCard(game, index, ab.result, kid) : null, originalPath: row!.original_path, segments },
  ]);
}

export async function exportGame(gameId: string): Promise<{ exportId: string }> {
  const sb = await createClient();
  const game = await getGame(gameId);
  if (!game) throw new Error("Game not found");
  const { data: rows } = await sb
    .from("clip_at_bats")
    .select("id, original_path, playback_path, field_view_path")
    .eq("game_id", gameId);
  const rowById = new Map((rows ?? []).map((r) => [r.id as string, r]));
  const kid = await kidFullName(sb, game.kidId);
  // Cards number at-bats by their place in the game, even when an unmarked
  // one is skipped. A reel brings its replays and its field view.
  const parts: ExportPart[] = game.atBats
    .flatMap((ab, i): ExportPart[] => {
      const row = rowById.get(ab.id)!;
      const card = titleCard(game, i, ab.result, kid);
      if (ab.reel) {
        return reelParts(ab, { reel: row.playback_path ?? row.original_path, fieldView: row.field_view_path }, card, true);
      }
      return [
        {
          card,
          originalPath: row.original_path,
          segments:
            ab.source === "camera"
              ? finishedEditSegments(ab, i)
              : withReplayZoom(buildQuickPlan(ab.pitches, ab.durationS ?? Infinity, ab.result), ab),
        },
      ];
    })
    .filter((part) => part.segments.length > 0);
  return beginExport({ gameId }, parts);
}

export async function getExportStatus(exportId: string): Promise<{
  status: "rendering" | "ready" | "failed";
  url?: string;
  fileName?: string;
  error?: string;
}> {
  const sb = await createClient();
  await requireUserId(sb);
  const { data } = await sb
    .from("clip_exports")
    .select("status, path, error_message, at_bat_id, game_id")
    .eq("id", exportId)
    .single();
  if (!data) throw new Error("Export not found");
  if (data.status !== "ready" || !data.path) {
    return { status: data.status, error: data.error_message ?? undefined };
  }
  const fileName = await exportFileName(data.at_bat_id, data.game_id);
  // `download` makes storage send it as an attachment under that name, so the
  // link saves the file instead of opening it (a cross-site link's own
  // download attribute is ignored by browsers).
  const { data: signed } = await sb.storage
    .from(CLIPS_BUCKET)
    .createSignedUrl(data.path, 60 * 60, { download: fileName });
  return { status: "ready", url: signed?.signedUrl, fileName };
}

/**
 * "Sebastian - Merchants Scrimmage - AB 1 (Flyout) - 2026-09-26.mp4", or
 * without the AB part for a game reel.
 */
async function exportFileName(atBatId: string | null, gameId: string | null): Promise<string> {
  const ab = atBatId ? await getAtBat(atBatId) : null;
  const game = await getGame(ab?.gameId ?? gameId ?? "");
  if (!game) return "baseball-clip.mp4";
  const sb = await createClient();
  const { data: kid } = await sb.from("baseball_people").select("display_name").eq("id", game.kidId).maybeSingle();
  const parts = [kid?.display_name?.split(" ")[0], game.name];
  if (ab) {
    const n = game.atBats.findIndex((x) => x.id === ab.id) + 1;
    const result = resultName(ab.result);
    parts.push(`AB ${n}${result ? ` (${result})` : ""}`);
  } else {
    parts.push("Game reel");
  }
  parts.push(game.playedOn);
  const name = parts
    .filter(Boolean)
    .join(" - ")
    .replace(/[\\/:*?"<>|]+/g, "")
    .trim();
  return `${name}.mp4`;
}
