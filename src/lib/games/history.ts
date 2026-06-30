import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireUserId } from "@/lib/members/auth";
import type { ResolvedTeam } from "@/lib/games/types";

/** One team's line on a past game (name + final score + whether it won). */
export type GameTeamLine = { name: string; score: number; isWinner: boolean };

export type GameHistoryEntry = {
  id: string;
  endedAt: string | null;
  status: "completed" | "abandoned";
  tie: boolean;
  bucksPaid: boolean;
  teams: GameTeamLine[];
};

/** Per-topic freshness: how much of the bank is ready, unused, and how often asked. */
export type TopicStat = {
  topic: string;
  ready: number;
  neverAsked: number;
  totalAsks: number;
};

export type TriviaHistory = {
  games: GameHistoryEntry[];
  gamesPlayed: number;
  bankReady: number;
  bankNeverAsked: number;
  topics: TopicStat[];
};

type GameRow = {
  id: string;
  status: "completed" | "abandoned";
  teams: ResolvedTeam[] | null;
  scores: Record<string, number> | null;
  winner: string | null;
  ended_at: string | null;
  bucks_paid: boolean;
};

/**
 * Recent games + question-bank freshness for the history view. Reads across the
 * household (service role); any signed-in member may view it.
 */
export async function loadTriviaHistory(): Promise<TriviaHistory> {
  await requireUserId();
  const admin = createAdminClient();

  const [gamesRes, readyRes, servedRes, playedRes] = await Promise.all([
    admin
      .from("trivia_games")
      .select("id, status, teams, scores, winner, ended_at, bucks_paid")
      .in("status", ["completed", "abandoned"])
      .order("ended_at", { ascending: false, nullsFirst: false })
      .limit(30),
    admin.from("trivia_questions").select("id, topic").eq("status", "ready"),
    admin.from("trivia_game_questions").select("question_id"),
    admin
      .from("trivia_games")
      .select("id", { count: "exact", head: true })
      .eq("status", "completed"),
  ]);

  // Lifetime ask count per question.
  const askCount = new Map<string, number>();
  for (const s of (servedRes.data ?? []) as { question_id: string }[]) {
    askCount.set(s.question_id, (askCount.get(s.question_id) ?? 0) + 1);
  }

  const games: GameHistoryEntry[] = ((gamesRes.data ?? []) as GameRow[]).map((g) => {
    const teams = g.teams ?? [];
    const scores = g.scores ?? {};
    const lines = teams
      .map((t) => ({
        name: t.name,
        score: scores[t.key] ?? 0,
        isWinner: g.winner != null && g.winner !== "tie" && g.winner === t.key,
      }))
      .sort((a, b) => b.score - a.score);
    return {
      id: g.id,
      endedAt: g.ended_at,
      status: g.status,
      tie: g.status === "completed" && (g.winner === "tie" || g.winner == null),
      bucksPaid: g.bucks_paid,
      teams: lines,
    };
  });

  // Per-topic freshness over the ready pool.
  const byTopic = new Map<string, { ready: number; neverAsked: number; totalAsks: number }>();
  for (const q of (readyRes.data ?? []) as { id: string; topic: string }[]) {
    const t = byTopic.get(q.topic) ?? { ready: 0, neverAsked: 0, totalAsks: 0 };
    const asks = askCount.get(q.id) ?? 0;
    t.ready += 1;
    t.totalAsks += asks;
    if (asks === 0) t.neverAsked += 1;
    byTopic.set(q.topic, t);
  }
  const topics = [...byTopic.entries()]
    .map(([topic, s]) => ({ topic, ...s }))
    .sort((a, b) => b.ready - a.ready || a.topic.localeCompare(b.topic));

  return {
    games,
    gamesPlayed: playedRes.count ?? 0,
    bankReady: (readyRes.data ?? []).length,
    bankNeverAsked: topics.reduce((n, t) => n + t.neverAsked, 0),
    topics,
  };
}
