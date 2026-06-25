"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveMoneyScope } from "@/lib/bucks/scope";
import { balanceFromLedger, loadLedger } from "@/lib/bucks/ledger";
import { loadEarnTasksForKid } from "@/lib/bucks/tasks";
import { loadPrizesForKid } from "@/lib/bucks/prizes";
import type { BucksWallet } from "@/lib/bucks/types";

async function callerEmail(): Promise<string | null> {
  const {
    data: { user },
  } = await (await createClient()).auth.getUser();
  return user?.email?.toLowerCase() ?? null;
}

/** Friendly messages for the redeem RPC's raised errors. */
function redeemErrorMessage(raw: string): string {
  if (raw.includes("INSUFFICIENT_FUNDS")) return "Not enough Mason Bucks yet.";
  if (raw.includes("PRIZE_ARCHIVED")) return "That prize is no longer available.";
  if (raw.includes("PRIZE_WRONG_AUDIENCE")) return "That prize isn't available for this kid.";
  if (raw.includes("PRIZE_NOT_FOUND")) return "That prize is no longer available.";
  return "Couldn't redeem that prize.";
}

/** Everything the wallet page renders for one kid (self or owner-browsed). */
export async function loadWallet(memberEmail?: string | null): Promise<BucksWallet> {
  const { client, userId } = await resolveMoneyScope(memberEmail);
  const history = await loadLedger(client, userId);
  const balance = balanceFromLedger(history);
  const [earnTasks, prizes] = await Promise.all([
    loadEarnTasksForKid(client, userId),
    loadPrizesForKid(client, userId, balance),
  ]);
  return { balance, history, earnTasks, prizes };
}

/** A kid claims they did an earning task (quantity of its unit). Pending approval. */
export async function claimTask(
  taskId: string,
  quantity: number,
  memberEmail?: string | null
): Promise<void> {
  const { client, userId } = await resolveMoneyScope(memberEmail);

  const qty = Math.floor(quantity);
  if (!(qty > 0)) throw new Error("Quantity must be at least 1.");
  // Sanity ceiling so a fat-fingered (or gamed) quantity can't request an absurd
  // grant on a single tap; an adult still approves, but this keeps amounts sane
  // and well clear of integer overflow in the approval credit.
  if (qty > 1000) throw new Error("That's too many at once — claim in smaller batches.");

  // Read the task through the scoped client so audience/archived RLS applies.
  const { data: task } = await client
    .from("bucks_earning_tasks")
    .select("id, unit_value, audience_user_id, archived_at")
    .eq("id", taskId)
    .maybeSingle();
  if (!task || task.archived_at) throw new Error("That task isn't available.");
  if (task.audience_user_id && task.audience_user_id !== userId) {
    throw new Error("That task isn't available for this kid.");
  }

  // Claims have no user INSERT policy — write via the service role, scoped to the
  // trusted userId, snapshotting the value so a later edit can't change the payout.
  const admin = createAdminClient();
  const { error } = await admin.from("bucks_task_claims").insert({
    task_id: taskId,
    user_id: userId,
    quantity: qty,
    unit_value: task.unit_value as number,
  });
  if (error) throw new Error(error.message);

  revalidatePath("/bucks");
  revalidatePath("/bucks/manage");
}

/** A kid (or an adult on their behalf) redeems a prize. Instant debit via RPC. */
export async function redeemPrize(
  prizeId: string,
  memberEmail?: string | null
): Promise<void> {
  const { userId } = await resolveMoneyScope(memberEmail);
  const actor = await callerEmail();

  const admin = createAdminClient();
  const { error } = await admin.rpc("redeem_prize", {
    p_prize_id: prizeId,
    p_user_id: userId,
    p_actor_email: actor,
  });
  if (error) throw new Error(redeemErrorMessage(error.message));

  revalidatePath("/bucks");
  revalidatePath("/bucks/manage");
}
