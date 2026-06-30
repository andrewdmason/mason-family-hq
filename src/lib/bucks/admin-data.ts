import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdult } from "@/lib/members/auth";
import { balanceFromLedger, loadLedger } from "@/lib/bucks/ledger";
import { loadPendingClaims, loadTasksForAdmin } from "@/lib/bucks/tasks";
import { loadPrizesForAdmin, loadUnfulfilledRedemptions } from "@/lib/bucks/prizes";
import type { BucksAdminData, BucksAdminLedgerEntry } from "@/lib/bucks/types";

type KidRow = { email: string; name: string; userId: string };

/** The family's signed-in kids, ordered by name. Service role. */
export async function loadKids(admin: SupabaseClient): Promise<KidRow[]> {
  const { data } = await admin
    .from("family_members")
    .select("email, name, user_id")
    .eq("role", "kid")
    .not("user_id", "is", null)
    .order("name", { ascending: true });
  return ((data ?? []) as { email: string; name: string | null; user_id: string }[]).map(
    (m) => ({ email: m.email, name: m.name?.trim() || m.email, userId: m.user_id })
  );
}

/**
 * Everything the unified adult management view renders: every kid with their
 * balance, all active tasks/prizes, the pending claim + redemption queues, and a
 * combined newest-first history across both kids. Adult-only.
 */
export async function loadAdminBucks(): Promise<BucksAdminData> {
  await requireAdult();
  const admin = createAdminClient();

  const kidRows = await loadKids(admin);
  const [tasks, prizes, claims, redemptions, ledgers] = await Promise.all([
    loadTasksForAdmin(),
    loadPrizesForAdmin(),
    loadPendingClaims(),
    loadUnfulfilledRedemptions(),
    // One scoped ledger read per kid (no large .in() that could 414); reused for
    // both the per-kid balance and the merged history below.
    Promise.all(kidRows.map((k) => loadLedger(admin, k.userId))),
  ]);

  const kids = kidRows.map((k, i) => ({
    userId: k.userId,
    email: k.email,
    name: k.name,
    balance: balanceFromLedger(ledgers[i]),
  }));

  const history: BucksAdminLedgerEntry[] = kidRows
    .flatMap((k, i) =>
      ledgers[i].map((e) => ({ ...e, kidUserId: k.userId, kidName: k.name }))
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return { kids, tasks, prizes, claims, redemptions, history };
}
