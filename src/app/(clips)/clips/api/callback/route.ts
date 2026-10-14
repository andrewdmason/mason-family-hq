import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/**
 * The clips worker POSTs here when a job finishes: a prepared at-bat (playback
 * copy, poster, probed metadata), a rendered export, or a traced ball trail. Authenticated by the
 * shared WORKER_SECRET and excluded from the session gate in middleware, so it
 * writes with the service-role client.
 */
type PrepareResult = {
  job: "prepare";
  atBatId: string;
  playbackPath?: string;
  posterPath?: string;
  meta?: {
    durationS?: number;
    fps?: number;
    width?: number;
    height?: number;
    codec?: string;
    recordedAt?: string | null;
  };
};
type ExportResult = { job: "export"; exportId: string; path?: string };
type Tap = { t: number; x: number; y: number };
/** A traced ball trail (docs/clips-ball-trail.md); `tap` echoes the tap the job ran with. */
type TraceResult = {
  job: "trace";
  atBatId: string;
  status?: "ready" | "needs_tap" | "failed";
  trail?: Record<string, unknown> | null;
  tap?: Tap | null;
};
type Body = (PrepareResult | ExportResult | TraceResult) & { ok?: boolean; error?: string; secret?: string };

function sameTap(a: Tap | null | undefined, b: Tap | null | undefined): boolean {
  if (!a || !b) return !a && !b;
  return Math.abs(a.t - b.t) < 1e-3 && Math.abs(a.x - b.x) < 1e-4 && Math.abs(a.y - b.y) < 1e-4;
}

export async function POST(request: Request) {
  const body = (await request.json()) as Body;
  if (!process.env.WORKER_SECRET || body.secret !== process.env.WORKER_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const sb = createAdminClient();
  const error = String(body.error ?? "Worker failed").slice(0, 500);

  if (body.job === "prepare") {
    const m = body.meta ?? {};
    // Metadata is worth keeping even when the transcode failed — the player
    // needs the frame rate to step frames on the original.
    const meta = {
      duration_s: m.durationS ?? null,
      fps: m.fps ?? null,
      width: m.width ?? null,
      height: m.height ?? null,
      codec: m.codec ?? null,
      recorded_at: m.recordedAt ?? null,
    };
    // Keep a thumbnail someone already captured from a marked pitch; the
    // worker's frame is only a stand-in.
    const { data: current } = await sb
      .from("clip_at_bats")
      .select("poster_path")
      .eq("id", body.atBatId)
      .maybeSingle();
    const update = body.ok
      ? {
          ...meta,
          status: "ready",
          error_message: null,
          playback_path: body.playbackPath ?? null,
          poster_path: current?.poster_path ?? body.posterPath ?? null,
        }
      : { ...meta, status: "ready", error_message: `Playback copy not made: ${error}`.slice(0, 500) };
    const { error: dbErr } = await sb
      .from("clip_at_bats")
      .update({ ...update, updated_at: new Date().toISOString() })
      .eq("id", body.atBatId);
    if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 500 });
    return NextResponse.json({ status: "ok" });
  }

  if (body.job === "export") {
    const { error: dbErr } = await sb
      .from("clip_exports")
      .update(
        body.ok
          ? { status: "ready", path: body.path ?? null, finished_at: new Date().toISOString() }
          : { status: "failed", error_message: error, finished_at: new Date().toISOString() },
      )
      .eq("id", body.exportId);
    if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 500 });
    return NextResponse.json({ status: "ok" });
  }

  if (body.job === "trace") {
    // A newer "Fix the ball" tap supersedes a trace that was still running:
    // drop this result and let the newer job's land.
    const { data: current } = await sb
      .from("clip_at_bats")
      .select("ball_trail_tap")
      .eq("id", body.atBatId)
      .maybeSingle();
    if (!current) return NextResponse.json({ error: "not found" }, { status: 404 });
    if (!sameTap(current.ball_trail_tap as Tap | null, body.tap ?? null)) {
      return NextResponse.json({ status: "stale" });
    }
    const status = body.ok && body.status ? body.status : "failed";
    if (status === "failed") console.error(`clips trace ${body.atBatId} failed: ${error}`);
    // The phone draws only a `ready` trail. needs_tap clears the old one (the
    // latest trace doesn't stand behind it); a failed run leaves it alone.
    const trail =
      status === "ready" ? { ball_trail: body.trail ?? null } : status === "needs_tap" ? { ball_trail: null } : {};
    const { error: dbErr } = await sb
      .from("clip_at_bats")
      .update({ ...trail, ball_trail_status: status, updated_at: new Date().toISOString() })
      .eq("id", body.atBatId);
    if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 500 });
    return NextResponse.json({ status: "ok" });
  }

  return NextResponse.json({ error: "unknown job" }, { status: 400 });
}
