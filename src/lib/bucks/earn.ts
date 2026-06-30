import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  JOURNAL_BUCKS,
  JOURNAL_MIN_SECONDS,
  JOURNAL_MIN_WORDS,
  countWords,
} from "@/lib/bucks/gate";
import { ESSAY_BONUS_BUCKS } from "@/lib/reading/essay-scoring";

/**
 * Credit a reading advance's bonus pages to the wallet, 1:1. Keyed to the advance
 * row id, so the ledger's unique (source, reference_id) makes a double-fired
 * advance a no-op. Best-effort: a failure here never rolls back the advance.
 */
export async function creditReadingBonus(
  userId: string,
  advanceId: string,
  bonusPages: number
): Promise<void> {
  if (bonusPages <= 0) return;
  try {
    const admin = createAdminClient();
    const { error } = await admin.from("bucks_ledger").insert({
      user_id: userId,
      amount: bonusPages,
      source: "reading",
      reference_id: advanceId,
      note: "Reading bonus pages",
    });
    // 23505 = unique violation: this advance was already credited. Expected.
    if (error && error.code !== "23505") {
      console.error("[bucks] reading credit failed:", error.message);
    }
  } catch (err) {
    console.error(
      "[bucks] creditReadingBonus failed:",
      err instanceof Error ? err.message : String(err)
    );
  }
}

/**
 * Credit the one-time bonus for a standout essay (a top-band rubric total) to the
 * wallet. Keyed to the submission id, so the ledger's unique (source, reference_id)
 * makes a double-fire a no-op. Best-effort: a failure here never rolls back the
 * pass the reader earned.
 */
export async function creditEssayBonus(
  userId: string,
  submissionId: string
): Promise<void> {
  try {
    const admin = createAdminClient();
    const { error } = await admin.from("bucks_ledger").insert({
      user_id: userId,
      amount: ESSAY_BONUS_BUCKS,
      source: "reading",
      reference_id: submissionId,
      note: "Standout essay bonus",
    });
    // 23505 = unique violation: this submission was already credited. Expected.
    if (error && error.code !== "23505") {
      console.error("[bucks] essay bonus credit failed:", error.message);
    }
  } catch (err) {
    console.error(
      "[bucks] creditEssayBonus failed:",
      err instanceof Error ? err.message : String(err)
    );
  }
}

/**
 * Settle a completed trivia game's Bucks via the award_trivia_win RPC, which
 * handles the daily cap, tie/winner resolution, and idempotency atomically (see
 * migration 00155). Best-effort: a failure here never rolls back the game. The
 * RPC swallows the idempotency no-op internally, so any error surfaced here is a
 * real failure worth logging (a permission error would mean the wrong client —
 * this must run through the service-role admin client).
 */
export async function creditTriviaWin(gameId: string): Promise<void> {
  try {
    const admin = createAdminClient();
    const { error } = await admin.rpc("award_trivia_win", { p_game_id: gameId });
    if (error) {
      console.error("[bucks] trivia payout failed:", error.message);
    }
  } catch (err) {
    console.error(
      "[bucks] creditTriviaWin failed:",
      err instanceof Error ? err.message : String(err)
    );
  }
}

/**
 * Award the flat journal grant for an entry, once, if it clears the gate: at least
 * JOURNAL_MIN_WORDS of the kid's own writing AND at least JOURNAL_MIN_SECONDS of
 * wall-clock from when writing started to when it closed. Idempotent per entry via
 * the ledger's unique (source, reference_id); re-runnable on a later close so a
 * once-short entry can qualify after more writing. Best-effort.
 */
export async function awardJournalEntryBucks(entryId: string): Promise<void> {
  try {
    const admin = createAdminClient();

    const { data: entry } = await admin
      .from("journal_entries")
      .select("id, user_id, created_at, freeform_started_at, closed_at")
      .eq("id", entryId)
      .maybeSingle();
    if (!entry) return;

    const { data: messages } = await admin
      .from("journal_messages")
      .select("role, content, created_at")
      .eq("entry_id", entryId)
      .order("created_at", { ascending: true });

    const words = (messages ?? [])
      .filter((m) => m.role === "user")
      .reduce((sum, m) => sum + countWords((m.content as string) ?? ""), 0);
    if (words < JOURNAL_MIN_WORDS) return;

    // Start: when freeform writing began, else the first message, else creation.
    const firstMessageAt = (messages ?? [])[0]?.created_at as string | undefined;
    const startIso =
      (entry.freeform_started_at as string | null) ??
      firstMessageAt ??
      (entry.created_at as string);
    const endIso = (entry.closed_at as string | null) ?? new Date().toISOString();
    const elapsedSeconds =
      (new Date(endIso).getTime() - new Date(startIso).getTime()) / 1000;
    if (elapsedSeconds < JOURNAL_MIN_SECONDS) return;

    const { error } = await admin.from("bucks_ledger").insert({
      user_id: entry.user_id as string,
      amount: JOURNAL_BUCKS,
      source: "journal",
      reference_id: entryId,
      note: "Journal entry",
    });
    if (error && error.code !== "23505") {
      console.error("[bucks] journal award failed:", error.message);
    }
  } catch (err) {
    console.error(
      "[bucks] awardJournalEntryBucks failed:",
      err instanceof Error ? err.message : String(err)
    );
  }
}
