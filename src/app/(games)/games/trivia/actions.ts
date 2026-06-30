"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireUserId } from "@/lib/members/auth";
import { creditTriviaWin } from "@/lib/bucks/earn";
import { assembleDeck } from "@/lib/games/deck";
import { loadTriviaPlayers } from "@/lib/games/players";
import type {
  DeckQuestion,
  DeckResult,
  GameMode,
  ResolvedTeam,
  TeamInput,
  TriviaLevel,
} from "@/lib/games/types";

const ROUNDS: Record<GameMode, number> = { quick: 2, standard: 5, target: 5 };

export type TriviaSetupPlayer = {
  userId: string;
  name: string;
  role: "owner" | "parent" | "kid";
  band: TriviaLevel;
};

export type TriviaTopic = { topic: string; ready: number };

export type TriviaSetupData = {
  players: TriviaSetupPlayer[];
  topics: TriviaTopic[];
};

/** Players (for team building) + topics with ready-counts (for scoping). */
export async function loadSetupData(): Promise<TriviaSetupData> {
  await requireUserId();
  const players = await loadTriviaPlayers();
  const admin = createAdminClient();
  const { data } = await admin
    .from("trivia_questions")
    .select("topic")
    .eq("status", "ready");
  const counts = new Map<string, number>();
  for (const r of (data ?? []) as { topic: string }[]) {
    counts.set(r.topic, (counts.get(r.topic) ?? 0) + 1);
  }
  const topics = [...counts.entries()]
    .map(([topic, ready]) => ({ topic, ready }))
    .sort((a, b) => a.topic.localeCompare(b.topic));

  return {
    players: players.map((p) => ({
      userId: p.userId,
      name: p.name,
      role: p.role,
      band: p.band,
    })),
    topics,
  };
}

export type StartGameResult =
  | { ok: true; gameId: string; deck: DeckQuestion[]; teams: ResolvedTeam[] }
  | (Extract<DeckResult, { ok: false }>);

/** Create a game: resolve teams, assemble + persist the deck, mark it active. */
export async function startGame(input: {
  teams: TeamInput[];
  mode: GameMode;
  targetScore?: number | null;
  topicScope?: string[] | null;
}): Promise<StartGameResult> {
  await requireUserId();

  const players = await loadTriviaPlayers();
  const bandByUser = new Map(players.map((p) => [p.userId, p.band]));
  const roleByUser = new Map(players.map((p) => [p.userId, p.role]));

  const cleanTeams = input.teams
    .map((t) => ({
      ...t,
      memberUserIds: t.memberUserIds.filter((id) => bandByUser.has(id)),
    }))
    .filter((t) => t.memberUserIds.length > 0);
  if (cleanTeams.length < 2) {
    throw new Error("Pick at least two teams with players.");
  }

  const resolvedTeams: ResolvedTeam[] = cleanTeams.map((t) => ({
    key: t.key,
    name: t.name,
    memberUserIds: t.memberUserIds,
    kidUserId: t.memberUserIds.find((id) => roleByUser.get(id) === "kid") ?? null,
  }));

  // Interleave team members so spotlight alternates between teams round by round.
  const maxLen = Math.max(...cleanTeams.map((t) => t.memberUserIds.length));
  const spotlight: { userId: string; band: TriviaLevel }[] = [];
  for (let i = 0; i < maxLen; i++) {
    for (const t of cleanTeams) {
      const userId = t.memberUserIds[i];
      if (userId) spotlight.push({ userId, band: bandByUser.get(userId)! });
    }
  }

  const mode: GameMode = ["quick", "standard", "target"].includes(input.mode)
    ? input.mode
    : "standard";
  const deckResult = await assembleDeck({
    spotlight,
    rounds: ROUNDS[mode],
    topicScope: input.topicScope ?? null,
  });
  if (!deckResult.ok) return deckResult;

  const admin = createAdminClient();
  const { data: game, error } = await admin
    .from("trivia_games")
    .insert({
      status: "active",
      teams: resolvedTeams,
      mode,
      target_score: mode === "target" ? input.targetScore ?? null : null,
      topic_scope: input.topicScope && input.topicScope.length > 0 ? input.topicScope : null,
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error || !game) throw new Error(error?.message ?? "Couldn't start the game.");
  const gameId = game.id as string;

  const { error: deckErr } = await admin.from("trivia_game_questions").insert(
    deckResult.deck.map((q) => ({
      game_id: gameId,
      question_id: q.id,
      spotlight_user_id: q.spotlightUserId,
      ordinal: q.ordinal,
    }))
  );
  if (deckErr) throw new Error(deckErr.message);

  return { ok: true, gameId, deck: deckResult.deck, teams: resolvedTeams };
}

type GameRow = {
  id: string;
  status: string;
  teams: ResolvedTeam[];
};

/** Load a game and assert the caller is a participant; throws otherwise. */
async function assertParticipant(
  admin: ReturnType<typeof createAdminClient>,
  gameId: string,
  userId: string
): Promise<GameRow> {
  const { data } = await admin
    .from("trivia_games")
    .select("id, status, teams")
    .eq("id", gameId)
    .maybeSingle();
  if (!data) throw new Error("Game not found.");
  const game = data as GameRow;
  const isPlayer = game.teams.some((t) => t.memberUserIds.includes(userId));
  if (!isPlayer) throw new Error("You're not in this game.");
  return game;
}

export type TriviaAward = { userId: string; amount: number };
export type EndGameResult = { paid: boolean; awards: TriviaAward[] };

/** Mirror the payout RPC's md5(game:kid)::uuid ledger reference key. */
function payoutRef(gameId: string, kidId: string): string {
  const h = createHash("md5").update(`${gameId}:${kidId}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/**
 * Finish a game: record scores + winner, then settle Bucks. Guarded so only an
 * active game transitions, and only a participant can end it. `winner` is a team
 * key or "tie". Returns the Bucks actually credited (read back from the ledger,
 * so the results screen reflects what was paid rather than re-deriving it).
 */
export async function endGame(input: {
  gameId: string;
  scores: Record<string, number>;
  winner: string;
}): Promise<EndGameResult> {
  const userId = await requireUserId();
  const admin = createAdminClient();
  const game = await assertParticipant(admin, input.gameId, userId);
  if (game.status !== "active") return { paid: false, awards: [] };

  const validKeys = new Set(game.teams.map((t) => t.key));
  const winner = input.winner === "tie" || validKeys.has(input.winner) ? input.winner : "tie";

  const { error } = await admin
    .from("trivia_games")
    .update({
      status: "completed",
      scores: input.scores,
      winner,
      ended_at: new Date().toISOString(),
    })
    .eq("id", input.gameId)
    .eq("status", "active");
  if (error) throw new Error(error.message);

  await creditTriviaWin(input.gameId);

  // Read back what the RPC actually credited, keyed per (game, kid).
  const kidIds = game.teams
    .map((t) => t.kidUserId)
    .filter((id): id is string => id != null);
  const refs = kidIds.map((id) => payoutRef(input.gameId, id));
  const { data: rows } =
    refs.length > 0
      ? await admin
          .from("bucks_ledger")
          .select("user_id, amount")
          .eq("source", "games")
          .in("reference_id", refs)
      : { data: [] };
  const awards = ((rows ?? []) as { user_id: string; amount: number }[]).map((r) => ({
    userId: r.user_id,
    amount: r.amount,
  }));

  revalidatePath("/bucks");
  return { paid: awards.length > 0, awards };
}

/** Pull a bad question from the playable pool mid-game. No answer revealed. */
export async function tossQuestion(gameId: string, questionId: string): Promise<void> {
  const userId = await requireUserId();
  const admin = createAdminClient();
  await assertParticipant(admin, gameId, userId);
  const { error } = await admin
    .from("trivia_questions")
    .update({
      status: "quarantined",
      verification: { verdict: "quarantine", notes: "Tossed during a game." },
    })
    .eq("id", questionId);
  if (error) throw new Error(error.message);
}

/** Abandon an in-progress game (food arrived). No payout. */
export async function abandonGame(gameId: string): Promise<void> {
  const userId = await requireUserId();
  const admin = createAdminClient();
  await assertParticipant(admin, gameId, userId);
  const { error } = await admin
    .from("trivia_games")
    .update({ status: "abandoned", ended_at: new Date().toISOString() })
    .eq("id", gameId)
    .eq("status", "active");
  if (error) throw new Error(error.message);
}
