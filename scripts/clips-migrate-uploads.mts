/**
 * One-time migration: turn website-uploaded at-bats into Clips Camera-style
 * at-bats — one finished video (title card, pitch windows, ¼-speed swing
 * replays, the phone's pill captions) that plays as-is, so the phone app
 * plays and shares them itself instead of sending you to the website.
 *
 * The finished video is rendered by the phone app's own renderer, run in the
 * iOS Simulator, so the two kinds look identical. Three steps:
 *
 *   1. fetch — download each upload at-bat's original and write a manifest:
 *        npx tsx --env-file=.env.local --tsconfig scripts/tsconfig.json \
 *          scripts/clips-migrate-uploads.mts fetch
 *   2. render — ios/ClipsCamera: run MigrationRenderTests in the Simulator
 *      (see the test's header); it writes edit-<id>.mp4 and results.json.
 *   3. apply — upload each edit and flip the at-bat over (dry run without --write):
 *        … scripts/clips-migrate-uploads.mts apply [--write]
 *
 * Reversible: the original stays in storage, and the at-bat's row and pitch
 * times as they were go to pre-migration.json next to it.
 *   … scripts/clips-migrate-uploads.mts revert [--write]
 *
 * Work files live in /tmp/clips-migrate (override with --dir).
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createWriteStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import path from "node:path";

const BUCKET = "baseball-clips";

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

const STEP = process.argv[2];
const WRITE = flag("write");
const DIR = arg("dir") ?? "/tmp/clips-migrate";

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

type PitchRow = { id: string; t: number; outcome: string | null; batted_ball: string | null };
type AtBatRow = {
  id: string;
  game_id: string;
  source: string;
  status: string;
  original_path: string;
  original_bytes: number | null;
  playback_path: string | null;
  duration_s: number | null;
  fps: number | null;
  width: number | null;
  height: number | null;
  codec: string | null;
  zoom: { x: number; y: number; s: number } | null;
  replay_zoom: boolean;
  result: string | null;
  recorded_at: string | null;
  created_at: string;
  clip_pitches: PitchRow[];
};
type GameRow = { id: string; name: string; played_on: string; clip_at_bats: AtBatRow[] };

/** What the Simulator renderer reads, one entry per at-bat. */
type ManifestItem = {
  id: string;
  gameId: string;
  /** Local copy of the original. */
  original: string;
  /** Its place in the game — the title card's "AB n", numbered as the website does. */
  number: number;
  game: string;
  playedOn: string;
  result: string | null;
  pitches: { id: string; t: number; outcome: string | null; battedBall: string | null }[];
  /** Replay zoom box (fractions of the frame), when set and switched on. */
  crop: { x: number; y: number; s: number } | null;
  /** Where the renderer writes the finished video. */
  out: string;
};

/** What the renderer writes back. */
type Result = { id: string; out: string; duration: number; bytes: number; pitchTimes: Record<string, number> };

/** Every game that has an upload at-bat, its at-bats in the website's order. */
async function loadGames(sb: SupabaseClient): Promise<GameRow[]> {
  const { data, error } = await sb
    .from("clip_games")
    .select(
      "id, name, played_on, clip_at_bats(id, game_id, source, status, original_path, original_bytes, playback_path, duration_s, fps, width, height, codec, zoom, replay_zoom, result, recorded_at, created_at, clip_pitches(id, t, outcome, batted_ball))",
    )
    .order("played_on");
  if (error) throw new Error(error.message);
  const games = (data as GameRow[]).map((g) => ({
    ...g,
    // As the website's sortAtBats: recorded time, then upload order.
    clip_at_bats: [...g.clip_at_bats].sort((a, b) => {
      const ka = a.recorded_at ?? a.created_at;
      const kb = b.recorded_at ?? b.created_at;
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    }),
  }));
  return games.filter((g) => g.clip_at_bats.some((ab) => ab.source === "upload"));
}

async function fetchStep(sb: SupabaseClient) {
  mkdirSync(DIR, { recursive: true });
  const items: ManifestItem[] = [];
  for (const g of await loadGames(sb)) {
    for (const [i, ab] of g.clip_at_bats.entries()) {
      if (ab.source !== "upload") continue;
      if (ab.status !== "ready" || ab.clip_pitches.length === 0) {
        console.log(`skip  ${g.name} AB ${i + 1}: ${ab.status}, ${ab.clip_pitches.length} pitches`);
        continue;
      }
      const original = path.join(DIR, `original-${ab.id}${path.extname(ab.original_path) || ".mov"}`);
      if (!existsSync(original) || (ab.original_bytes && statSync(original).size !== ab.original_bytes)) {
        const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(ab.original_path, 3600);
        if (error || !data) throw new Error(`sign ${ab.original_path}: ${error?.message}`);
        const res = await fetch(data.signedUrl);
        if (!res.ok || !res.body) throw new Error(`download ${ab.original_path}: ${res.status}`);
        await pipeline(Readable.fromWeb(res.body as never), createWriteStream(original));
      }
      console.log(
        `ready ${g.name} AB ${i + 1} (${ab.result ?? "no result"}, ${ab.clip_pitches.length} pitches) — ${(statSync(original).size / 1e6).toFixed(0)}MB`,
      );
      items.push({
        id: ab.id,
        gameId: g.id,
        original,
        number: i + 1,
        game: g.name,
        playedOn: g.played_on,
        result: ab.result,
        pitches: [...ab.clip_pitches]
          .sort((a, b) => a.t - b.t)
          .map((p) => ({ id: p.id, t: p.t, outcome: p.outcome, battedBall: p.batted_ball })),
        crop: ab.zoom && ab.replay_zoom ? ab.zoom : null,
        out: path.join(DIR, `edit-${ab.id}.mp4`),
      });
    }
  }
  writeFileSync(path.join(DIR, "manifest.json"), JSON.stringify(items, null, 2));
  console.log(`\n${items.length} at-bats → ${path.join(DIR, "manifest.json")}`);
}

const editPath = (ab: { game_id: string; id: string }) => `${ab.game_id}/${ab.id}/edit.mp4`;
const backupPath = (ab: { game_id: string; id: string }) => `${ab.game_id}/${ab.id}/pre-migration.json`;

async function applyStep(sb: SupabaseClient) {
  const results: Result[] = JSON.parse(readFileSync(path.join(DIR, "results.json"), "utf8"));
  const byId = new Map(
    (await loadGames(sb)).flatMap((g) => g.clip_at_bats.map((ab) => [ab.id, { ab, game: g.name }] as const)),
  );
  for (const r of results) {
    const found = byId.get(r.id);
    if (!found || found.ab.source !== "upload") {
      console.log(`skip  ${r.id}: no longer an upload at-bat`);
      continue;
    }
    const { ab, game } = found;
    const missing = ab.clip_pitches.filter((p) => !(p.id in r.pitchTimes));
    if (missing.length) throw new Error(`${r.id}: no edit time for ${missing.length} pitches — re-render`);
    console.log(
      `${WRITE ? "apply" : "would apply"} ${game} ${ab.result ?? ""}: ${ab.duration_s?.toFixed(0) ?? "?"}s original → ${r.duration.toFixed(1)}s edit, ` +
        `pitches ${ab.clip_pitches
          .sort((a, b) => a.t - b.t)
          .map((p) => `${p.t.toFixed(1)}→${r.pitchTimes[p.id].toFixed(1)}`)
          .join(" ")}`,
    );
    if (!WRITE) continue;

    const bucket = sb.storage.from(BUCKET);
    // The way back first: the row and pitch times as they are now.
    const backup = await bucket.upload(backupPath(ab), JSON.stringify(ab, null, 2), {
      contentType: "application/json",
      upsert: true,
    });
    if (backup.error) throw new Error(`backup ${r.id}: ${backup.error.message}`);
    const video = await bucket.upload(editPath(ab), readFileSync(r.out), { contentType: "video/mp4", upsert: true });
    if (video.error) throw new Error(`upload ${r.id}: ${video.error.message}`);

    for (const p of ab.clip_pitches) {
      const { error } = await sb.from("clip_pitches").update({ t: r.pitchTimes[p.id] }).eq("id", p.id);
      if (error) throw new Error(`pitch ${p.id}: ${error.message}`);
    }
    // Shaped like the phone's own at-bats: the finished video is both the
    // original and the playback copy.
    const { error } = await sb
      .from("clip_at_bats")
      .update({
        source: "camera",
        original_path: editPath(ab),
        playback_path: editPath(ab),
        original_bytes: r.bytes,
        duration_s: r.duration,
        fps: 60,
        width: 1920,
        height: 1080,
        codec: "h264",
        updated_at: new Date().toISOString(),
      })
      .eq("id", r.id);
    if (error) throw new Error(`at-bat ${r.id}: ${error.message}`);
  }
  if (!WRITE) console.log("\nDry run — pass --write to apply.");
}

async function revertStep(sb: SupabaseClient) {
  const { data, error } = await sb.from("clip_at_bats").select("id, game_id").eq("source", "camera");
  if (error) throw new Error(error.message);
  for (const ab of data as { id: string; game_id: string }[]) {
    const { data: file } = await sb.storage.from(BUCKET).download(backupPath(ab));
    if (!file) continue; // filmed on the phone — nothing to revert
    const before: AtBatRow = JSON.parse(await file.text());
    console.log(`${WRITE ? "revert" : "would revert"} ${ab.id}`);
    if (!WRITE) continue;
    for (const p of before.clip_pitches) {
      const { error: e } = await sb.from("clip_pitches").update({ t: p.t }).eq("id", p.id);
      if (e) throw new Error(`pitch ${p.id}: ${e.message}`);
    }
    const { clip_pitches: _, id: __, game_id: ___, created_at: ____, ...row } = before;
    const { error: e } = await sb.from("clip_at_bats").update(row).eq("id", ab.id);
    if (e) throw new Error(`at-bat ${ab.id}: ${e.message}`);
    await sb.storage.from(BUCKET).remove([editPath(ab), backupPath(ab)]);
  }
  if (!WRITE) console.log("\nDry run — pass --write to revert.");
}

const sb = client();
if (STEP === "fetch") await fetchStep(sb);
else if (STEP === "apply") await applyStep(sb);
else if (STEP === "revert") await revertStep(sb);
else throw new Error("Usage: clips-migrate-uploads.mts fetch | apply [--write] | revert [--write]");
