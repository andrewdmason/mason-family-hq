import "server-only";

import { headers } from "next/headers";
import type { createClient } from "@/lib/supabase/server";
import type { PlanSegment } from "./plan";
import { CLIPS_BUCKET } from "./types";

// The clips worker (services/baseball-clips, on Modal) does the ffmpeg work:
// a seek-friendly playback copy + poster for each upload, and rendered quick
// versions for export. The app hands it signed URLs to read from and write to,
// and it POSTs back to /clips/api/callback when done — same shape as the
// practice worker, sharing its WORKER_SECRET.

type Client = Awaited<ReturnType<typeof createClient>>;

export function clipsWorkerConfigured(): boolean {
  return !!process.env.CLIPS_WORKER_URL;
}

async function callbackUrl(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? (host?.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}/clips/api/callback`;
}

async function signDownload(sb: Client, path: string): Promise<string> {
  // Long enough for a slow transcode of a big original to finish reading it.
  const { data, error } = await sb.storage.from(CLIPS_BUCKET).createSignedUrl(path, 4 * 60 * 60);
  if (error || !data) throw new Error(error?.message ?? "Could not sign source URL");
  return data.signedUrl;
}

async function signUpload(sb: Client, path: string): Promise<string> {
  const { data, error } = await sb.storage
    .from(CLIPS_BUCKET)
    .createSignedUploadUrl(path, { upsert: true });
  if (error || !data) throw new Error(error?.message ?? "Could not sign upload URL");
  return data.signedUrl;
}

async function post(payload: Record<string, unknown>): Promise<void> {
  const url = process.env.CLIPS_WORKER_URL;
  if (!url) throw new Error("The clips worker isn't set up yet (CLIPS_WORKER_URL)");
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...payload, secret: process.env.WORKER_SECRET, callbackUrl: await callbackUrl() }),
  });
  if (!res.ok) throw new Error(`Clips worker ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

export function atBatPaths(gameId: string, atBatId: string) {
  const dir = `${gameId}/${atBatId}`;
  return {
    dir,
    original: (ext: string) => `${dir}/original.${ext}`,
    playback: `${dir}/playback.mp4`,
    // Captured in the browser from a marked pitch.
    poster: `${dir}/poster.jpg`,
    // The worker's stand-in frame, used until someone marks a pitch.
    autoPoster: `${dir}/auto-poster.jpg`,
  };
}

/** Kick off the playback copy + poster + metadata probe for an uploaded at-bat. */
export async function startPrepare(
  sb: Client,
  atBat: { id: string; gameId: string; originalPath: string },
): Promise<void> {
  const paths = atBatPaths(atBat.gameId, atBat.id);
  await post({
    job: "prepare",
    atBatId: atBat.id,
    sourceUrl: await signDownload(sb, atBat.originalPath),
    playbackUpload: await signUpload(sb, paths.playback),
    playbackPath: paths.playback,
    posterUpload: await signUpload(sb, paths.autoPoster),
    posterPath: paths.autoPoster,
  });
}

export type ExportPart = {
  /** Title card shown before this at-bat (game reels only). */
  card: string | null;
  originalPath: string;
  segments: PlanSegment[];
};

/** Kick off rendering an export: one or more at-bats' quick versions, concatenated. */
export async function startExport(
  sb: Client,
  exportId: string,
  path: string,
  parts: ExportPart[],
): Promise<void> {
  const sources = [];
  for (const part of parts) {
    sources.push({
      card: part.card,
      url: await signDownload(sb, part.originalPath),
      segments: part.segments.map((s) => ({
        start: s.start,
        end: s.end,
        rate: s.rate,
        muted: s.muted,
        caption: s.caption,
      })),
    });
  }
  await post({ job: "export", exportId, sources, upload: await signUpload(sb, path), path });
}
