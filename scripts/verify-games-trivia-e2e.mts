// End-to-end check for Games · Trivia against LOCAL Supabase. Exercises deck
// assembly (level-matched, balanced, recently-seen exclusion, insufficiency) and
// the award_trivia_win payout RPC (winner/consolation, per-day cap, idempotency,
// tie). Generation/verification are mocked (seeded ready questions) so this runs
// with no Anthropic calls. Seeds throwaway rows and deletes them at the end.
// Run: npx tsx scripts/verify-games-trivia-e2e.mts

import { config } from "dotenv";
import { createHash } from "node:crypto";
config({ path: ".env.local" });

const { createAdminClient } = await import("../src/lib/supabase/admin");
const { assembleDeck } = await import("../src/lib/games/deck");

const admin = createAdminClient();

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const TOPIC = "E2E_TRIVIA";

/** Mirror the RPC's md5(game:kid)::uuid reference key. */
function refFor(gameId: string, kidId: string): string {
  const h = createHash("md5").update(`${gameId}:${kidId}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

async function ledgerAmount(refUuid: string): Promise<number> {
  const { data } = await admin
    .from("bucks_ledger")
    .select("amount")
    .eq("reference_id", refUuid)
    .eq("source", "games");
  return (data ?? []).reduce((s, r) => s + (r.amount as number), 0);
}

const createdQuestions: string[] = [];
const createdGames: string[] = [];
const createdRefs: string[] = [];

async function seedQuestions(level: string, n: number): Promise<string[]> {
  const rows = Array.from({ length: n }, (_, i) => ({
    topic: TOPIC,
    level,
    type: "mc",
    prompt: `E2E ${level} #${i}`,
    payload: { options: ["a", "b", "c", "d"], correctIndex: 0 },
    status: "ready",
    perishable: false,
  }));
  const { data, error } = await admin.from("trivia_questions").insert(rows).select("id");
  if (error) throw new Error(error.message);
  const ids = (data ?? []).map((r) => r.id as string);
  createdQuestions.push(...ids);
  return ids;
}

async function seedGame(opts: {
  winner: string;
  kidA: string;
  kidB: string;
  endedAt: string;
}): Promise<string> {
  const teams = [
    { key: "team1", name: "Team 1", memberUserIds: [opts.kidA], kidUserId: opts.kidA },
    { key: "team2", name: "Team 2", memberUserIds: [opts.kidB], kidUserId: opts.kidB },
  ];
  const { data, error } = await admin
    .from("trivia_games")
    .insert({
      status: "completed",
      teams,
      mode: "standard",
      scores: { team1: 10, team2: 6 },
      winner: opts.winner,
      ended_at: opts.endedAt,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "seed game failed");
  const id = data.id as string;
  createdGames.push(id);
  createdRefs.push(refFor(id, opts.kidA), refFor(id, opts.kidB));
  return id;
}

try {
  const { loadTriviaPlayers } = await import("../src/lib/games/players");
  const players = await loadTriviaPlayers();
  const older = players.find((p) => p.band === "older_kid");
  const younger = players.find((p) => p.band === "younger_kid");
  if (!older || !younger) {
    console.error("Need two kids (older + younger) in local DB; cannot run.");
    process.exit(1);
  }

  // ---- Deck assembly ----
  await seedQuestions("older_kid", 10);
  await seedQuestions("younger_kid", 10);

  const spotlight = [
    { userId: older.userId, band: "older_kid" as const },
    { userId: younger.userId, band: "younger_kid" as const },
  ];
  const deck1 = await assembleDeck({ spotlight, rounds: 3, topicScope: [TOPIC] });
  check("deck assembles", deck1.ok);
  if (deck1.ok) {
    check("deck has equal spotlight turns (6)", deck1.deck.length === 6);
    const perOlder = deck1.deck.filter((q) => q.spotlightUserId === older.userId).length;
    const perYounger = deck1.deck.filter((q) => q.spotlightUserId === younger.userId).length;
    check("each player gets 3 turns", perOlder === 3 && perYounger === 3);

    // Simulate a played game so deck1's questions are "recently seen".
    const playedId = (
      await admin
        .from("trivia_games")
        .insert({ status: "completed", teams: [], mode: "standard" })
        .select("id")
        .single()
    ).data!.id as string;
    createdGames.push(playedId);
    await admin.from("trivia_game_questions").insert(
      deck1.deck.map((q, i) => ({
        game_id: playedId,
        question_id: q.id,
        spotlight_user_id: q.spotlightUserId,
        ordinal: i,
      }))
    );

    const deck2 = await assembleDeck({ spotlight, rounds: 3, topicScope: [TOPIC] });
    if (deck2.ok) {
      const seen = new Set(deck1.deck.map((q) => q.id));
      const overlap = deck2.deck.filter((q) => seen.has(q.id)).length;
      check("recently-seen questions are excluded next game", overlap === 0, `overlap=${overlap}`);
    } else {
      check("second deck assembles", false);
    }
  }

  // Insufficient: a band with no seeded questions.
  const adultDeck = await assembleDeck({
    spotlight: [{ userId: older.userId, band: "adult" }],
    rounds: 3,
    topicScope: [TOPIC],
  });
  check("empty level pool returns insufficient (not a crash)", !adultDeck.ok);

  // ---- Payout RPC ----
  // The cap is "first completed game today pays", scoped to the real local day,
  // so each scenario plays a game ended now and cleans itself up before the next
  // — keeping each scenario's cap counter at a clean slate. (Assumes no real
  // trivia game has paid out today, true for a fresh bank.)
  const olderId = older.userId;
  const youngerId = younger.userId;
  const now = () => new Date().toISOString();
  async function clearGame(id: string) {
    await admin.from("bucks_ledger").delete().eq("reference_id", refFor(id, olderId));
    await admin.from("bucks_ledger").delete().eq("reference_id", refFor(id, youngerId));
    await admin.from("trivia_games").delete().eq("id", id);
  }

  // Winner path + consolation + idempotency.
  const gWin = await seedGame({
    winner: "team1",
    kidA: older.userId,
    kidB: younger.userId,
    endedAt: now(),
  });
  await admin.rpc("award_trivia_win", { p_game_id: gWin });
  check("winner kid earns 10", (await ledgerAmount(refFor(gWin, older.userId))) === 10);
  check("other kid earns 3", (await ledgerAmount(refFor(gWin, younger.userId))) === 3);
  await admin.rpc("award_trivia_win", { p_game_id: gWin });
  check(
    "re-awarding is idempotent (still 10)",
    (await ledgerAmount(refFor(gWin, older.userId))) === 10
  );
  await clearGame(gWin);

  // Daily cap: a second paying game on the same day pays nothing.
  const gCap1 = await seedGame({
    winner: "team1",
    kidA: older.userId,
    kidB: younger.userId,
    endedAt: now(),
  });
  await admin.rpc("award_trivia_win", { p_game_id: gCap1 });
  const gCap2 = await seedGame({
    winner: "team2",
    kidA: older.userId,
    kidB: younger.userId,
    endedAt: now(),
  });
  await admin.rpc("award_trivia_win", { p_game_id: gCap2 });
  check(
    "second game same day pays nothing (cap)",
    (await ledgerAmount(refFor(gCap2, older.userId))) === 0 &&
      (await ledgerAmount(refFor(gCap2, younger.userId))) === 0
  );
  await clearGame(gCap1);
  await clearGame(gCap2);

  // Tie: both kids get the consolation, no winner bonus.
  const gTie = await seedGame({
    winner: "tie",
    kidA: older.userId,
    kidB: younger.userId,
    endedAt: now(),
  });
  await admin.rpc("award_trivia_win", { p_game_id: gTie });
  check(
    "tie pays both kids the consolation (3 each)",
    (await ledgerAmount(refFor(gTie, older.userId))) === 3 &&
      (await ledgerAmount(refFor(gTie, younger.userId))) === 3
  );
  await clearGame(gTie);
} finally {
  for (const ref of createdRefs) {
    await admin.from("bucks_ledger").delete().eq("reference_id", ref);
  }
  for (const id of createdGames) {
    await admin.from("trivia_game_questions").delete().eq("game_id", id);
    await admin.from("trivia_games").delete().eq("id", id);
  }
  if (createdQuestions.length > 0) {
    await admin.from("trivia_questions").delete().in("id", createdQuestions);
  }
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
