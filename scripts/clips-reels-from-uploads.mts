/**
 * One-time conversion: the website-uploaded at-bats (already turned into
 * Clips Camera-style finished edits by clips-migrate-uploads.mts) become pitch
 * reels, so they play in the live player with slow motion, live captions and
 * relabeling like everything filmed since.
 *
 * Each reel is cut from the at-bat's playback copy (1080p, SDR, same timeline
 * as the original; the original itself, brought down to that, when there's no
 * copy) using the pitch times it had before the first migration —
 * the same windows the phone cuts — at the copy's own frame rate (30 or 60fps;
 * there's no 240fps footage for these). Labels are taken as they are now.
 *
 *   npx tsx --env-file=.env.local --tsconfig scripts/tsconfig.json \
 *     scripts/clips-reels-from-uploads.mts apply [--write]
 *
 * Reversible: the row and pitch times as they are now go to pre-reel.json
 * beside the at-bat, and the finished edit stays in storage.
 *     … scripts/clips-reels-from-uploads.mts revert [--write]
 *
 * Needs ffmpeg. Work files live in /tmp/clips-reels (override with --dir).
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import { buildQuickPlan } from "../src/lib/clips/plan";
import type { ClipPitch } from "../src/lib/clips/types";

const BUCKET = "baseball-clips";

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
}
const STEP = process.argv[2];
const WRITE = process.argv.includes("--write");
const DIR = arg("dir") ?? "/tmp/clips-reels";

function client(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_PROD_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_PROD_URL is not set.");
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required.");
  if (url.includes("127.0.0.1") || url.includes("localhost")) {
    throw new Error(`Refusing to run: ${url} is a local instance, not production.`);
  }
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

type PitchRow = { id: string; t: number; outcome: ClipPitch["outcome"]; batted_ball: string | null };
/** The at-bat as the first migration saved it (pre-migration.json). */
type Before = { id: string; game_id: string; original_path: string; playback_path: string | null; duration_s: number | null; fps: number | null; clip_pitches: PitchRow[] };
type Segment = { start: number; end: number; fps: number; pitch: number };

const dirOf = (ab: { game_id: string; id: string }) => `${ab.game_id}/${ab.id}`;

/** At-bats the first migration converted that aren't reels yet. */
async function candidates(sb: SupabaseClient) {
  const { data, error } = await sb
    .from("clip_at_bats")
    .select("id, game_id, original_path, playback_path, original_bytes, duration_s, fps, width, height, codec, result, reel, closeup_path, field_view_at_s, clip_pitches(id, t, outcome, batted_ball)")
    .eq("source", "camera")
    .is("reel", null);
  if (error) throw new Error(error.message);
  const out = [];
  for (const ab of data ?? []) {
    const { data: file } = await sb.storage.from(BUCKET).download(`${dirOf(ab)}/pre-migration.json`);
    if (!file) continue; // filmed on the phone — the phone converts those itself
    out.push({ now: ab, before: JSON.parse(await file.text()) as Before });
  }
  return out;
}

async function download(sb: SupabaseClient, storagePath: string, dest: string) {
  if (existsSync(dest) && statSync(dest).size > 0) return;
  const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(storagePath, 3600);
  if (error || !data) throw new Error(`sign ${storagePath}: ${error?.message}`);
  const res = await fetch(data.signedUrl);
  if (!res.ok || !res.body) throw new Error(`download ${storagePath}: ${res.status}`);
  await pipeline(Readable.fromWeb(res.body as never), createWriteStream(dest));
}

/** The first video stream's details (JSON: an iPhone original adds side-data lines to CSV output). */
function videoStream(file: string): { avg_frame_rate?: string; r_frame_rate?: string; color_transfer?: string } {
  const out = execFileSync("ffprobe", [
    "-v", "error", "-select_streams", "v:0",
    "-show_entries", "stream=avg_frame_rate,r_frame_rate,color_transfer", "-of", "json", file,
  ]).toString();
  return JSON.parse(out).streams?.[0] ?? {};
}

function probeFps(file: string): number {
  const ratio = (r?: string) => {
    const [n, d] = (r ?? "").split("/").map(Number);
    return d ? n / d : n;
  };
  const v = videoStream(file);
  const fps = ratio(v.avg_frame_rate) || ratio(v.r_frame_rate);
  return fps > 0 && fps <= 240 ? Math.round(fps) : 30;
}

/**
 * The windows, back to back, in one ffmpeg pass: each trimmed exactly, then
 * concatenated and encoded so any frame is a quick seek away (a keyframe every
 * half second, no B-frames).
 */
// iPhone HDR to SDR, as the clips worker does it.
const TONEMAP =
  "zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p,";
const FIT = "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black,setsar=1";

function isHdr(file: string): boolean {
  const t = videoStream(file).color_transfer;
  return t === "smpte2084" || t === "arib-std-b67";
}

/**
 * `fit` brings a full-size original (4K, maybe HDR) down to the 1080p SDR a
 * playback copy already is.
 */
function cutReel(
  src: string,
  out: string,
  windows: { start: number; end: number; startFrame: number; endFrame: number }[],
  fps: number,
  fit: boolean,
) {
  const look = fit ? `,${isHdr(src) ? TONEMAP : ""}${FIT}` : "";
  // Each window is its own input, seeked to just before it (so a 4K original
  // isn't decoded end to end once per window), with the original timestamps
  // kept so it can be trimmed on them. The trim sits half a frame outside the
  // window's first and last frames, so rounding never drops or adds one.
  const half = 0.5 / fps;
  const inputs = windows.flatMap((w) => ["-ss", Math.max(0, w.start - 2).toFixed(4), "-i", src]);
  const parts = windows.map((w, i) => {
    const range = `start=${(w.startFrame / fps - half).toFixed(5)}:end=${(w.endFrame / fps - half).toFixed(5)}`;
    return (
      `[${i}:v]trim=${range},setpts=PTS-STARTPTS${look}[v${i}];` +
      `[${i}:a]atrim=${range},asetpts=PTS-STARTPTS[a${i}]`
    );
  });
  const joined = windows.map((_, i) => `[v${i}][a${i}]`).join("");
  const filter = `${parts.join(";")};${joined}concat=n=${windows.length}:v=1:a=1[v][a]`;
  execFileSync("ffmpeg", [
    "-y", "-v", "error", "-copyts", ...inputs, "-filter_complex", filter, "-map", "[v]", "-map", "[a]",
    "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-r", String(fps),
    "-g", String(Math.max(1, Math.round(fps / 2))), "-bf", "0",
    "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-movflags", "+faststart", out,
  ]);
}

async function applyStep(sb: SupabaseClient) {
  mkdirSync(DIR, { recursive: true });
  for (const { now, before } of await candidates(sb)) {
    // The playback copy when there is one, else the original (brought down to 1080p SDR).
    const fromOriginal = !before.playback_path;
    const src = path.join(DIR, fromOriginal ? `original-${now.id}${path.extname(before.original_path)}` : `playback-${now.id}.mp4`);
    await download(sb, before.playback_path ?? before.original_path, src);
    const fps = probeFps(src);
    const duration = Number(
      execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", src]).toString().trim(),
    );
    // Source times from before the first migration; labels as they are now.
    const label = new Map(now.clip_pitches.map((p: PitchRow) => [p.id, p]));
    const pitches: ClipPitch[] = [...before.clip_pitches]
      .sort((a, b) => a.t - b.t)
      .map((p) => ({ id: p.id, t: p.t, outcome: label.get(p.id)?.outcome ?? p.outcome, source: "camera" }));
    // Snapped to whole frames, so the cut and the pitch times agree exactly.
    const windows = buildQuickPlan(pitches, duration, null)
      .filter((s) => !s.replay)
      .map((w) => ({
        ...w,
        start: Math.round(w.start * fps) / fps,
        end: Math.round(w.end * fps) / fps,
        startFrame: Math.round(w.start * fps),
        endFrame: Math.round(w.end * fps),
      }));
    const segments: Segment[] = [];
    let at = 0;
    for (const w of windows) {
      segments.push({ start: at, end: at + (w.end - w.start), fps, pitch: w.pitchIndex });
      at += w.end - w.start;
    }
    // Each pitch's time in the reel: inside the window showing it.
    const reelTimes = new Map<string, number>();
    pitches.forEach((p, i) => {
      const k = windows.findIndex((w) => p.t >= w.start && p.t <= w.end);
      reelTimes.set(p.id, k >= 0 ? segments[k].start + p.t - windows[k].start : (segments.find((s) => s.pitch > i)?.start ?? at));
    });

    const out = path.join(DIR, `reel-${now.id}.mp4`);
    cutReel(src, out, windows, fps, fromOriginal);
    const reelLength = Number(
      execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", out]).toString().trim(),
    );
    console.log(
      `${WRITE ? "apply" : "would apply"} ${now.id} (${now.result ?? "no result"}): ${duration.toFixed(0)}s at ${fps}fps` +
        `${fromOriginal ? " (from the original)" : ""} → ` +
        `${reelLength.toFixed(1)}s reel (planned ${at.toFixed(1)}s), pitches ` +
        pitches.map((p) => `${p.t.toFixed(1)}→${reelTimes.get(p.id)!.toFixed(1)}`).join(" "),
    );
    if (!WRITE) continue;

    const bucket = sb.storage.from(BUCKET);
    const dir = dirOf(now);
    // The way back first: the row and pitch times as they are now.
    const backup = await bucket.upload(`${dir}/pre-reel.json`, JSON.stringify(now, null, 2), {
      contentType: "application/json",
      upsert: true,
    });
    if (backup.error) throw new Error(`backup ${now.id}: ${backup.error.message}`);
    const video = await bucket.upload(`${dir}/reel.mp4`, readFileSync(out), { contentType: "video/mp4", upsert: true });
    if (video.error) throw new Error(`upload ${now.id}: ${video.error.message}`);
    for (const [id, t] of reelTimes) {
      const { error } = await sb.from("clip_pitches").update({ t }).eq("id", id);
      if (error) throw new Error(`pitch ${id}: ${error.message}`);
    }
    const { error } = await sb
      .from("clip_at_bats")
      .update({
        original_path: `${dir}/reel.mp4`,
        playback_path: `${dir}/reel.mp4`,
        original_bytes: statSync(out).size,
        duration_s: reelLength,
        fps,
        width: 1920,
        height: 1080,
        codec: "h264",
        reel: { segments },
        closeup_path: null,
        field_view_at_s: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", now.id);
    if (error) throw new Error(`at-bat ${now.id}: ${error.message}`);
  }
  if (!WRITE) console.log("\nDry run — pass --write to apply.");
}

async function revertStep(sb: SupabaseClient) {
  const { data, error } = await sb.from("clip_at_bats").select("id, game_id").eq("source", "camera").not("reel", "is", null);
  if (error) throw new Error(error.message);
  for (const ab of data as { id: string; game_id: string }[]) {
    const { data: file } = await sb.storage.from(BUCKET).download(`${dirOf(ab)}/pre-reel.json`);
    if (!file) continue; // a reel from the phone — nothing to revert here
    const before = JSON.parse(await file.text());
    console.log(`${WRITE ? "revert" : "would revert"} ${ab.id}`);
    if (!WRITE) continue;
    for (const p of before.clip_pitches as PitchRow[]) {
      const { error: e } = await sb.from("clip_pitches").update({ t: p.t }).eq("id", p.id);
      if (e) throw new Error(`pitch ${p.id}: ${e.message}`);
    }
    const { clip_pitches: _, id: __, game_id: ___, ...row } = before;
    const { error: e } = await sb.from("clip_at_bats").update(row).eq("id", ab.id);
    if (e) throw new Error(`at-bat ${ab.id}: ${e.message}`);
    await sb.storage.from(BUCKET).remove([`${dirOf(ab)}/reel.mp4`, `${dirOf(ab)}/pre-reel.json`]);
  }
  if (!WRITE) console.log("\nDry run — pass --write to revert.");
}

const sb = client();
if (STEP === "apply") await applyStep(sb);
else if (STEP === "revert") await revertStep(sb);
else throw new Error("Usage: clips-reels-from-uploads.mts apply [--write] | revert [--write]");
