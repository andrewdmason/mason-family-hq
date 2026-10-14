import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/**
 * Watch-only Baseball Clips for the Clips Camera app when nobody's signed in
 * (a coach on TestFlight). Authenticated by the viewer key the app is built
 * with (migration 00203) and excluded from the session gate in middleware, so
 * it reads with the service-role client — and only reads:
 *
 *   GET                → { kids }            kids with games in Clips
 *   GET ?kid=<id>      → { games, posters }  a kid's games, as the app's own query returns them
 *   GET ?path=<path>   → { url }             a short-lived link to one at-bat file
 */

const BUCKET = "baseball-clips";
const LINK_SECONDS = 3600;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** `{game}/{at-bat}/{file}`: every at-bat file lives in its own folder. */
const AT_BAT_FILE = /^[0-9a-f-]{36}\/([0-9a-f-]{36})\/[A-Za-z0-9._-]+$/i;

const AT_BAT_COLUMNS =
  "id, source, status, result, poster_path, playback_path, duration_s, recorded_at, created_at, " +
  "closeup_path, field_view_path, field_view_start_s, field_view_end_s, field_view_at_s, reel, " +
  "ball_trail, ball_trail_status, ball_trail_tap";

let cachedKey: { key: string; at: number } | null = null;

async function viewerKey(sb: ReturnType<typeof createAdminClient>): Promise<string | null> {
  if (cachedKey && Date.now() - cachedKey.at < 5 * 60_000) return cachedKey.key;
  const { data } = await sb.from("clips_viewer_keys").select("key").eq("id", 1).maybeSingle();
  if (!data?.key) return null;
  cachedKey = { key: data.key, at: Date.now() };
  return data.key;
}

function matches(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(request: Request) {
  const sb = createAdminClient();
  const expected = await viewerKey(sb);
  const given = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!expected || !given || !matches(given, expected)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const params = new URL(request.url).searchParams;

  const path = params.get("path");
  if (path !== null) {
    // Only a file in an at-bat's folder, and only of an at-bat that exists.
    const atBatID = AT_BAT_FILE.exec(path)?.[1];
    if (!atBatID || !UUID.test(atBatID)) {
      return NextResponse.json({ error: "not an at-bat file" }, { status: 400 });
    }
    const { data: atBat } = await sb.from("clip_at_bats").select("id").eq("id", atBatID).maybeSingle();
    if (!atBat) return NextResponse.json({ error: "not found" }, { status: 404 });
    const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(path, LINK_SECONDS);
    if (error || !data) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ url: data.signedUrl });
  }

  const kid = params.get("kid");
  if (kid !== null) {
    if (!UUID.test(kid)) return NextResponse.json({ error: "bad kid" }, { status: 400 });
    const { data: games, error } = await sb
      .from("clip_games")
      .select(`id, name, played_on, clip_at_bats(${AT_BAT_COLUMNS}, clip_pitches(id, t, outcome, batted_ball))`)
      .eq("kid_id", kid)
      .order("played_on", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(40);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const posterPaths = (games ?? []).flatMap((g) =>
      (g.clip_at_bats as { poster_path: string | null }[]).map((ab) => ab.poster_path).filter((p): p is string => !!p),
    );
    const posters: Record<string, string> = {};
    if (posterPaths.length > 0) {
      const { data: signed } = await sb.storage.from(BUCKET).createSignedUrls(posterPaths, LINK_SECONDS);
      for (const s of signed ?? []) if (s.path && s.signedUrl) posters[s.path] = s.signedUrl;
    }
    return NextResponse.json({ games: games ?? [], posters });
  }

  const { data: people, error } = await sb
    .from("baseball_people")
    .select("id, display_name, clip_games!inner(id)")
    .eq("kind", "kid")
    .limit(1, { referencedTable: "clip_games" })
    .order("display_name");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ kids: (people ?? []).map((p) => ({ id: p.id, display_name: p.display_name })) });
}
