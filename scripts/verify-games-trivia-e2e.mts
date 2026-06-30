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

  // Insufficient: request more questions than the whole adult pool can supply,
  // so the result is `insufficient` regardless of how many seed/real questions
  // exist (a band's level is never relaxed).
  const { count: adultPool } = await admin
    .from("trivia_questions")
    .select("id", { count: "exact", head: true })
    .eq("status", "ready")
    .in("level", ["adult", "all"]);
  const adultDeck = await assembleDeck({
    spotlight: [{ userId: older.userId, band: "adult" }],
    rounds: (adultPool ?? 0) + 1,
    topicScope: [TOPIC],
  });
  check("oversized request returns insufficient (not a crash)", !adultDeck.ok);

  // ---- Payout RPC ----
  // The cap counts paid games for the real local (Pacific/Honolulu) day across
  // the whole household. The positive-pay assertions therefore only hold when
  // nothing has paid out today (a fresh DB / db:reset). If the local DB already
  // has a paid game today (manual play-testing), the cap is consumed, so we
  // verify the cap + idempotency behavior instead and skip the pay amounts.
  const olderId = older.userId;
  const youngerId = younger.userId;
  const now = () => new Date().toISOString();
  async function clearGame(id: string) {
    await admin.from("bucks_ledger").delete().eq("reference_id", refFor(id, olderId));
    await admin.from("bucks_ledger").delete().eq("reference_id", refFor(id, youngerId));
    await admin.from("trivia_games").delete().eq("id", id);
  }

  const hstToday = new Date().toLocaleDateString("en-CA", { timeZone: "Pacific/Honolulu" });
  const { data: paidRows } = await admin
    .from("trivia_games")
    .select("ended_at")
    .eq("bucks_paid", true);
  const paidToday = ((paidRows ?? []) as { ended_at: string | null }[]).filter(
    (r) =>
      r.ended_at &&
      new Date(r.ended_at).toLocaleDateString("en-CA", { timeZone: "Pacific/Honolulu" }) ===
        hstToday
  ).length;
  const cleanSlate = paidToday === 0;
  if (!cleanSlate) {
    console.log(
      `  (note: ${paidToday} game already paid today — verifying cap + idempotency only)`
    );
  }

  // Winner path + consolation (clean slate) or cap behavior (dirty), + idempotency.
  const gWin = await seedGame({ winner: "team1", kidA: olderId, kidB: youngerId, endedAt: now() });
  await admin.rpc("award_trivia_win", { p_game_id: gWin });
  if (cleanSlate) {
    check("winner kid earns 10", (await ledgerAmount(refFor(gWin, olderId))) === 10);
    check("other kid earns 3", (await ledgerAmount(refFor(gWin, youngerId))) === 3);
  } else {
    check(
      "payout is capped when a game already paid today",
      (await ledgerAmount(refFor(gWin, olderId))) === 0 &&
        (await ledgerAmount(refFor(gWin, youngerId))) === 0
    );
  }
  const beforeRe = await ledgerAmount(refFor(gWin, olderId));
  await admin.rpc("award_trivia_win", { p_game_id: gWin });
  check(
    "re-awarding is idempotent (no change)",
    (await ledgerAmount(refFor(gWin, olderId))) === beforeRe
  );
  await clearGame(gWin);

  // Daily cap: two games the same day → at most one pays; the second pays nothing.
  const gCap1 = await seedGame({ winner: "team1", kidA: olderId, kidB: youngerId, endedAt: now() });
  await admin.rpc("award_trivia_win", { p_game_id: gCap1 });
  const gCap2 = await seedGame({ winner: "team2", kidA: olderId, kidB: youngerId, endedAt: now() });
  await admin.rpc("award_trivia_win", { p_game_id: gCap2 });
  check(
    "second game same day pays nothing (cap)",
    (await ledgerAmount(refFor(gCap2, olderId))) === 0 &&
      (await ledgerAmount(refFor(gCap2, youngerId))) === 0
  );
  if (cleanSlate) {
    check("first game of the day pays the winner 10", (await ledgerAmount(refFor(gCap1, olderId))) === 10);
  }
  await clearGame(gCap1);
  await clearGame(gCap2);

  // Tie → both kids get the consolation (clean slate), else capped to nothing.
  const gTie = await seedGame({ winner: "tie", kidA: olderId, kidB: youngerId, endedAt: now() });
  await admin.rpc("award_trivia_win", { p_game_id: gTie });
  if (cleanSlate) {
    check(
      "tie pays both kids the consolation (3 each)",
      (await ledgerAmount(refFor(gTie, olderId))) === 3 &&
        (await ledgerAmount(refFor(gTie, youngerId))) === 3
    );
  } else {
    check(
      "tie is capped when a game already paid today",
      (await ledgerAmount(refFor(gTie, olderId))) === 0 &&
        (await ledgerAmount(refFor(gTie, youngerId))) === 0
    );
  }
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
