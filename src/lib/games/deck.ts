import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type {
  DeckQuestion,
  DeckResult,
  TriviaLevel,
  TriviaPayload,
  TriviaType,
} from "@/lib/games/types";

/**
 * Assemble a per-game deck from the verified question bank.
 *
 * Each spotlight slot gets a question matched to that player's level band; the
 * "winnable for the kid" promise means a KID's level band is NEVER relaxed. When
 * a slot can't be filled in the ideal way, we relax in this order: recently-seen
 * → topic scope (widen toward the whole bank). Level is never relaxed; if a
 * player's level pool (any topic) can't cover their turns, the result is a typed
 * `insufficient` so the setup UI can send the adult to generate more — never a
 * silent off-level question or a crash.
 *
 * Recently-seen exclusion (R23) draws on the household's last few games so
 * back-to-back games don't repeat until a pool is exhausted.
 */

const RECENT_GAMES = 5;

/** Which question levels a player of this band may be served (band + general). */
function allowedLevels(band: TriviaLevel): TriviaLevel[] {
  if (band === "adult") return ["adult", "all"];
  if (band === "older_kid") return ["older_kid", "all"];
  if (band === "younger_kid") return ["younger_kid", "all"];
  return ["all"];
}

type ReadyQuestion = {
  id: string;
  level: TriviaLevel;
  type: TriviaType;
  topic: string;
  prompt: string;
  payload: TriviaPayload;
};

/** Pick the best question for a slot, relaxing recently-seen then topic scope. */
function pick(
  list: ReadyQuestion[],
  used: Set<string>,
  scope: Set<string> | null,
  recent: Set<string>,
  typeCounts: Record<string, number>
): ReadyQuestion | null {
  const avail = list.filter((q) => !used.has(q.id));
  const inScope = (q: ReadyQuestion) => !scope || scope.has(q.topic);
  const tiers: ((q: ReadyQuestion) => boolean)[] = [
    (q) => inScope(q) && !recent.has(q.id),
    (q) => inScope(q),
    (q) => !recent.has(q.id),
    () => true,
  ];
  for (const tier of tiers) {
    const pool = avail.filter(tier);
    if (pool.length > 0) {
      // Prefer the least-used type this game for variety.
      pool.sort((a, b) => (typeCounts[a.type] ?? 0) - (typeCounts[b.type] ?? 0));
      return pool[0];
    }
  }
  return null;
}

export async function assembleDeck(input: {
  /** The per-round spotlight order, one entry per player, already interleaved. */
  spotlight: { userId: string; band: TriviaLevel }[];
  /** How many times the spotlight cycles (questions per player). */
  rounds: number;
  /** Topic names to scope the deck to, or null for the whole bank. */
  topicScope: string[] | null;
}): Promise<DeckResult> {
  const admin = createAdminClient();

  // The ready-question pool and the recent-games lookup are independent — fetch
  // them together.
  const [readyRes, recentGamesRes] = await Promise.all([
    admin.from("trivia_questions").select("id, level, type, topic, prompt, payload").eq("status", "ready"),
    admin.from("trivia_games").select("id").order("created_at", { ascending: false }).limit(RECENT_GAMES),
  ]);
  const all = (readyRes.data ?? []) as ReadyQuestion[];

  // Recently-seen question ids from the household's last few games.
  const recentIds = (recentGamesRes.data ?? []).map((g) => g.id as string);
  const recent = new Set<string>();
  if (recentIds.length > 0) {
    const { data: served } = await admin
      .from("trivia_game_questions")
      .select("question_id")
      .in("game_id", recentIds);
    for (const s of (served ?? []) as { question_id: string }[]) {
      recent.add(s.question_id);
    }
  }

  // Per-player eligible pools (level-matched; topic relaxation happens in pick()).
  const eligibleByUser = new Map<string, ReadyQuestion[]>();
  for (const p of input.spotlight) {
    if (eligibleByUser.has(p.userId)) continue;
    const levels = new Set(allowedLevels(p.band));
    eligibleByUser.set(
      p.userId,
      all.filter((q) => levels.has(q.level))
    );
  }

  const scope =
    input.topicScope && input.topicScope.length > 0
      ? new Set(input.topicScope)
      : null;

  const used = new Set<string>();
  const typeCounts: Record<string, number> = {};
  const deck: DeckQuestion[] = [];
  const shortBands = new Map<TriviaLevel, { needed: number; available: number }>();

  const total = input.rounds * input.spotlight.length;
  for (let ordinal = 0; ordinal < total; ordinal++) {
    const p = input.spotlight[ordinal % input.spotlight.length];
    const q = pick(eligibleByUser.get(p.userId) ?? [], used, scope, recent, typeCounts);
    if (!q) {
      if (!shortBands.has(p.band)) {
        const playersWithBand = input.spotlight.filter((s) => s.band === p.band).length;
        shortBands.set(p.band, {
          needed: playersWithBand * input.rounds,
          available: (eligibleByUser.get(p.userId) ?? []).length,
        });
      }
      continue;
    }
    used.add(q.id);
    typeCounts[q.type] = (typeCounts[q.type] ?? 0) + 1;
    deck.push({
      id: q.id,
      type: q.type,
      prompt: q.prompt,
      payload: q.payload,
      spotlightUserId: p.userId,
      ordinal,
    });
  }

  if (shortBands.size > 0) {
    return {
      ok: false,
      reason: "insufficient",
      shortfall: [...shortBands.entries()].map(([band, s]) => ({ band, ...s })),
    };
  }

  return { ok: true, deck };
}
