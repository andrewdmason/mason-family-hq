import "server-only";

import type { createClient } from "@/lib/supabase/server";
import { getIsAdult } from "@/lib/members/auth";
import { loadPendingClaims } from "@/lib/bucks/tasks";
import { loadUnfulfilledRedemptions } from "@/lib/bucks/prizes";
import type { JournalNotification } from "@/lib/types";

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

/**
 * Bell items for kids' pending earning-task claims, surfaced to every adult so one
 * of them can approve and grant the Bucks. Computed each render like the other
 * sources; adult-only (it reads across kids via the service role). Clears when an
 * adult approves or rejects the claim.
 */
export async function getBucksClaimNotifications(
  supabase: SupabaseClient
): Promise<JournalNotification[]> {
  if (!(await getIsAdult(supabase))) return [];
  const claims = await loadPendingClaims();
  return claims.map((c) => ({
    id: `bucks-claim:${c.id}`,
    title: `${c.kidName} claimed “${c.taskTitle}”`,
    reason: `${c.amount} Mason Bucks — approve to grant`,
    href: "/bucks/manage",
  }));
}

/**
 * Bell items for unfulfilled prize redemptions, reminding an adult to hand over
 * the real-world prize. Adult-only; clears when an adult marks it fulfilled.
 */
export async function getBucksRedemptionNotifications(
  supabase: SupabaseClient
): Promise<JournalNotification[]> {
  if (!(await getIsAdult(supabase))) return [];
  const redemptions = await loadUnfulfilledRedemptions();
  return redemptions.map((r) => ({
    id: `bucks-redeem:${r.id}`,
    title: `${r.kidName} redeemed “${r.prizeTitle}”`,
    reason: `Hand over the prize (${r.price} Bucks)`,
    href: "/bucks/manage",
  }));
}
