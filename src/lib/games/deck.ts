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
 * "winnable for the kid" promise means a KID's level band is NEVER relaxed. If a
 * player's level pool (any topic) can't cover their turns, the result is a typed
 * `insufficient` so the setup UI can send the adult to generate more — never a
 * silent off-level question or a crash.
 *
 * Selection (R23 — favor fresh questions): within a player's level pool we pick,
 * in order of preference, (1) questions in the chosen topic scope, then (2) the
 * fewest-times-asked across ALL game history (never-asked first), then (3) a less-
 * used type this game for variety, then (4) a per-build random tie-break so equally-
 * asked questions don't always surface in the same order. Topic scope only widens
 * to the whole bank once the in-scope pool is used up; a kid's level never widens.
 * Ask counts come from trivia_game_questions, the served-deck log of every game.
 */

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

/**
 * Pick the best question for a slot: in-scope first, then least-asked across all
 * history, then a less-used type this game, then a random tie-break. Sorting on
 * this composite key (rather than hard tiers) keeps the topic-scope preference
 * while always favoring the freshest available question.
 */
function pick(
  list: ReadyQuestion[],
  used: Set<string>,
  scope: Set<string> | null,
  askCount: Map<string, number>,
  jitter: Map<string, number>,
  typeCounts: Record<string, number>
): ReadyQuestion | null {
  const avail = list.filter((q) => !used.has(q.id));
  if (avail.length === 0) return null;
  const scopeRank = (q: ReadyQuestion) => (!scope || scope.has(q.topic) ? 0 : 1);
  avail.sort(
    (a, b) =>
      scopeRank(a) - scopeRank(b) ||
      (askCount.get(a.id) ?? 0) - (askCount.get(b.id) ?? 0) ||
      (typeCounts[a.type] ?? 0) - (typeCounts[b.type] ?? 0) ||
      (jitter.get(a.id) ?? 0) - (jitter.get(b.id) ?? 0)
  );
  return avail[0];
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

  // The ready-question pool and the served-question log are independent — fetch
  // them together. The served log spans all games, so its counts drive the
  // least-asked preference.
  const [readyRes, servedRes] = await Promise.all([
    admin.from("trivia_questions").select("id, level, type, topic, prompt, payload").eq("status", "ready"),
    admin.from("trivia_game_questions").select("question_id"),
  ]);
  const all = (readyRes.data ?? []) as ReadyQuestion[];

  // Lifetime ask count per question across every game (never-asked → 0).
  const askCount = new Map<string, number>();
  for (const s of (servedRes.data ?? []) as { question_id: string }[]) {
    askCount.set(s.question_id, (askCount.get(s.question_id) ?? 0) + 1);
  }
  // A stable random key per question, drawn once per build, so ties between
  // equally-asked questions resolve differently each game.
  const jitter = new Map(all.map((q) => [q.id, Math.random()] as const));

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
    const q = pick(eligibleByUser.get(p.userId) ?? [], used, scope, askCount, jitter, typeCounts);
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
