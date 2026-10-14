import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { clipsWorkerConfigured, startTrace, type TraceTap } from "@/lib/clips/worker";

export const runtime = "nodejs";

/**
 * Trace the batted ball through an at-bat's GameChanger field view — the
 * Clips Camera app calls this after attaching a field view, and again with a
 * `tap` when someone fixes the ball (docs/clips-ball-trail.md).
 *
 *   POST { atBatId, tap? }   Authorization: Bearer <supabase access token>
 *   → 202 { status: "pending" }
 *
 * The phone has a Supabase session but no website cookies, so it sends its
 * access token and this validates it with Supabase Auth (signed-in users only;
 * watch-only viewers have no token and can't trace). Excluded from the session
 * gate in middleware for that reason, and writes with the service-role client.
 * The worker POSTs the trail to /clips/api/callback.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseTap(raw: unknown): TraceTap | null | "invalid" {
  if (raw == null) return null;
  if (typeof raw !== "object") return "invalid";
  const { t, x, y } = raw as Record<string, unknown>;
  const ok =
    typeof t === "number" && Number.isFinite(t) && t >= 0 &&
    typeof x === "number" && x >= 0 && x <= 1 &&
    typeof y === "number" && y >= 0 && y <= 1;
  return ok ? { t, x, y } : "invalid";
}

export async function POST(request: Request) {
  const token = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const sb = createAdminClient();
  const {
    data: { user },
  } = await sb.auth.getUser(token);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { atBatId?: unknown; tap?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const atBatId = typeof body.atBatId === "string" ? body.atBatId : "";
  if (!UUID.test(atBatId)) return NextResponse.json({ error: "bad atBatId" }, { status: 400 });
  const tap = parseTap(body.tap);
  if (tap === "invalid") {
    return NextResponse.json({ error: "tap must be {t, x, y} with t ≥ 0 and x, y in 0–1" }, { status: 400 });
  }

  if (!clipsWorkerConfigured()) {
    return NextResponse.json(
      { error: "Ball trails need the clips video worker, which isn't set up here (CLIPS_WORKER_URL)" },
      { status: 503 },
    );
  }

  const { data: atBat, error: readErr } = await sb
    .from("clip_at_bats")
    .select("id, field_view_path, field_view_start_s, field_view_end_s, ball_trail_tap")
    .eq("id", atBatId)
    .maybeSingle();
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 });
  if (!atBat) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!atBat.field_view_path) {
    return NextResponse.json({ error: "This at-bat has no field view to trace" }, { status: 409 });
  }

  // A new tap replaces the stored one; without one, a re-trace stays anchored
  // to the last tap.
  const stored = parseTap(atBat.ball_trail_tap);
  const anchor = tap ?? (stored === "invalid" ? null : stored);
  const { error: writeErr } = await sb
    .from("clip_at_bats")
    .update({
      ball_trail_status: "pending",
      ...(tap ? { ball_trail_tap: tap } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("id", atBatId);
  if (writeErr) return NextResponse.json({ error: writeErr.message }, { status: 500 });

  try {
    await startTrace(sb, {
      id: atBatId,
      fieldViewPath: atBat.field_view_path,
      trimStart: atBat.field_view_start_s,
      trimEnd: atBat.field_view_end_s,
      tap: anchor,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    // Don't leave the phone polling a job that never started.
    await sb.from("clip_at_bats").update({ ball_trail_status: "failed" }).eq("id", atBatId);
    return NextResponse.json({ error: message }, { status: 502 });
  }
  return NextResponse.json({ status: "pending" }, { status: 202 });
}
