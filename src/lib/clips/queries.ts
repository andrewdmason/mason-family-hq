import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { AtBatResult, AtBatStatus, ClipAtBat, ClipGame, ClipKid, ClipPitch } from "./types";

type Client = Awaited<ReturnType<typeof createClient>>;

const AT_BAT_COLUMNS =
  "id, game_id, status, error_message, original_name, original_bytes, playback_path, poster_path, duration_s, fps, width, height, recorded_at, marked_at, result, created_at, updated_at, clip_pitches(id, t, outcome, source)";

type AtBatRow = {
  id: string;
  game_id: string;
  status: AtBatStatus;
  error_message: string | null;
  original_name: string | null;
  original_bytes: number | null;
  playback_path: string | null;
  poster_path: string | null;
  duration_s: number | null;
  fps: number | null;
  width: number | null;
  height: number | null;
  recorded_at: string | null;
  marked_at: string | null;
  result: AtBatResult | null;
  created_at: string;
  updated_at: string;
  clip_pitches: ClipPitch[] | null;
};

function toAtBat(r: AtBatRow): ClipAtBat {
  return {
    id: r.id,
    gameId: r.game_id,
    status: r.status,
    errorMessage: r.error_message,
    originalName: r.original_name,
    originalBytes: r.original_bytes,
    hasPlayback: !!r.playback_path,
    hasPoster: !!r.poster_path,
    durationS: r.duration_s,
    fps: r.fps,
    width: r.width,
    height: r.height,
    recordedAt: r.recorded_at,
    markedAt: r.marked_at,
    result: r.result,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    pitches: [...(r.clip_pitches ?? [])].sort((a, b) => a.t - b.t),
  };
}

/** A game's at-bats in the order they happened: recorded time, then upload order. */
export function sortAtBats(list: ClipAtBat[]): ClipAtBat[] {
  return [...list].sort((a, b) => {
    const ka = a.recordedAt ?? a.createdAt;
    const kb = b.recordedAt ?? b.createdAt;
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
}

type GameRow = { id: string; kid_id: string; name: string; played_on: string };
const toGame = (g: GameRow): ClipGame => ({
  id: g.id,
  kidId: g.kid_id,
  name: g.name,
  playedOn: g.played_on,
});

export async function getClipKids(client?: Client): Promise<ClipKid[]> {
  const sb = client ?? (await createClient());
  const { data } = await sb
    .from("baseball_people")
    .select("id, slug, display_name")
    .eq("kind", "kid")
    .order("display_name");
  return (data ?? []).map((p) => ({ id: p.id, slug: p.slug, displayName: p.display_name }));
}

export type FeedGame = ClipGame & { atBats: ClipAtBat[] };

/** Games newest first, each with its at-bats — optionally for one kid. */
export async function getFeed(kidId?: string): Promise<FeedGame[]> {
  const sb = await createClient();
  let q = sb
    .from("clip_games")
    .select(`id, kid_id, name, played_on, clip_at_bats(${AT_BAT_COLUMNS})`)
    .order("played_on", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(60);
  if (kidId) q = q.eq("kid_id", kidId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []).map((g) => ({
    ...toGame(g as GameRow),
    atBats: sortAtBats(((g as { clip_at_bats: AtBatRow[] }).clip_at_bats ?? []).map(toAtBat)),
  }));
}

export async function getGame(gameId: string): Promise<FeedGame | null> {
  const sb = await createClient();
  const { data } = await sb
    .from("clip_games")
    .select(`id, kid_id, name, played_on, clip_at_bats(${AT_BAT_COLUMNS})`)
    .eq("id", gameId)
    .maybeSingle();
  if (!data) return null;
  return {
    ...toGame(data as GameRow),
    atBats: sortAtBats(((data as { clip_at_bats: AtBatRow[] }).clip_at_bats ?? []).map(toAtBat)),
  };
}

/** Recent games for the upload picker, newest first. */
export async function getRecentGames(): Promise<ClipGame[]> {
  const sb = await createClient();
  const { data } = await sb
    .from("clip_games")
    .select("id, kid_id, name, played_on")
    .order("played_on", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(40);
  return (data ?? []).map((g) => toGame(g as GameRow));
}

export async function getAtBat(atBatId: string): Promise<ClipAtBat | null> {
  const sb = await createClient();
  const { data } = await sb
    .from("clip_at_bats")
    .select(AT_BAT_COLUMNS)
    .eq("id", atBatId)
    .maybeSingle();
  return data ? toAtBat(data as unknown as AtBatRow) : null;
}
