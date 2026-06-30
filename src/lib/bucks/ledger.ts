import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { BucksLedgerEntry, BucksSource } from "@/lib/bucks/types";

/** Default labels for ledger rows whose `note` is null. */
const SOURCE_LABELS: Record<BucksSource, string> = {
  reading: "Reading bonus pages",
  journal: "Journal entry",
  task: "Earning task",
  redemption: "Prize redeemed",
  migration: "Starting balance",
  adjustment: "Adjustment",
  games: "Trivia game",
};

type LedgerRow = {
  id: string;
  amount: number;
  source: BucksSource;
  note: string | null;
  created_at: string;
};

/**
 * One kid's full ledger, newest first. Scoped to a single user_id (no large
 * .in() that could 414), so the balance can be summed in memory. Must be called
 * with an already-scoped client + userId.
 */
export async function loadLedger(
  client: SupabaseClient,
  userId: string
): Promise<BucksLedgerEntry[]> {
  const { data } = await client
    .from("bucks_ledger")
    .select("id, amount, source, note, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  return ((data ?? []) as LedgerRow[]).map((r) => ({
    id: r.id,
    amount: r.amount,
    source: r.source,
    label: r.note?.trim() || SOURCE_LABELS[r.source] || "Mason Bucks",
    createdAt: r.created_at,
  }));
}

/** Sum a loaded ledger into the current balance. */
export function balanceFromLedger(entries: BucksLedgerEntry[]): number {
  return entries.reduce((sum, e) => sum + e.amount, 0);
}
