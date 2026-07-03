"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdult } from "@/lib/members/auth";
import { READING_MILESTONES_BUCKET } from "@/lib/reading/constants";
import { resolveMoneyScope } from "@/lib/bucks/scope";
import { balanceFromLedger, loadLedger } from "@/lib/bucks/ledger";
import { loadEarnTasksForKid } from "@/lib/bucks/tasks";
import { loadPrizesForKid } from "@/lib/bucks/prizes";
import type { BucksWallet } from "@/lib/bucks/types";

const IMAGE_EXT = new Set(["jpg", "jpeg", "png", "webp", "gif"]);

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

// ===========================================================================
// Kid-facing (self) actions
// ===========================================================================

/** Everything the wallet page renders for the signed-in kid. */
export async function loadWallet(): Promise<BucksWallet> {
  const { client, userId } = await resolveMoneyScope();
  const history = await loadLedger(client, userId);
  const balance = balanceFromLedger(history);
  const [earnTasks, prizes, pendingRequests] = await Promise.all([
    loadEarnTasksForKid(client, userId),
    loadPrizesForKid(client, userId, balance),
    // The kid's own task-less requests still awaiting an adult (RLS lets a kid
    // read their own claims). count: "exact"/head keeps it off the row payload.
    client
      .from("bucks_task_claims")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .is("task_id", null)
      .eq("status", "pending")
      .then(({ count }) => count ?? 0),
  ]);
  return { balance, history, earnTasks, prizes, pendingRequests };
}

/**
 * A kid asks for an arbitrary one-off amount of Bucks with a note explaining why.
 * Recorded as a task-less claim (task_id null, quantity 1, unit_value = amount) so
 * it flows through the same approve/reject queue as task claims — nothing lands
 * until an adult approves. Self-scoped; the amount is a positive integer.
 */
export async function requestBucks(input: {
  amount: number;
  note: string;
}): Promise<void> {
  const { userId } = await resolveMoneyScope();

  const amount = Math.floor(input.amount);
  if (!(amount > 0)) throw new Error("Amount must be a positive number.");
  // Sanity ceiling: an adult still approves, but this keeps a fat-fingered (or
  // gamed) ask sane and well clear of overflow in the approval credit.
  if (amount > 100000) throw new Error("That's a lot at once — ask for a smaller amount.");
  const note = input.note.trim();
  if (!note) throw new Error("Add a note so your parent knows what it's for.");

  // Claims have no user INSERT policy — write via the service role, scoped to the
  // trusted userId. unit_value carries the amount (quantity 1); the note explains it.
  const admin = createAdminClient();
  const { error } = await admin.from("bucks_task_claims").insert({
    task_id: null,
    user_id: userId,
    quantity: 1,
    unit_value: amount,
    note,
  });
  if (error) throw new Error(error.message);

  revalidatePath("/bucks");
}

/** A kid claims they did an earning task (quantity of its unit). Pending approval. */
export async function claimTask(taskId: string, quantity: number): Promise<void> {
  const { client, userId } = await resolveMoneyScope();

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
}

/** A kid redeems a prize from their own balance. Instant debit via RPC. */
export async function redeemPrize(prizeId: string): Promise<void> {
  const { userId } = await resolveMoneyScope();
  const actor = await callerEmail();

  const admin = createAdminClient();
  const { error } = await admin.rpc("redeem_prize", {
    p_prize_id: prizeId,
    p_user_id: userId,
    p_actor_email: actor,
  });
  if (error) throw new Error(redeemErrorMessage(error.message));

  revalidatePath("/bucks");
}

// ===========================================================================
// Adult management actions
// ===========================================================================

/** Resolve an audience email to a kid's user_id; null/blank = shared by both. */
async function resolveAudience(audienceEmail?: string | null): Promise<string | null> {
  const email = audienceEmail?.trim().toLowerCase();
  if (!email) return null;
  const admin = createAdminClient();
  const { data } = await admin
    .from("family_members")
    .select("user_id")
    .eq("email", email)
    .maybeSingle();
  if (!data?.user_id) throw new Error("That kid hasn't signed in yet.");
  return data.user_id as string;
}

/** A trimmed http(s) purchase link, or null when blank. Rejects other schemes. */
function normalizePurchaseUrl(raw?: string | null): string | null {
  const value = raw?.trim();
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Enter a full link, e.g. https://example.com/item");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Purchase link must start with http:// or https://");
  }
  return url.toString();
}

// ---- Manual awards -------------------------------------------------------

/**
 * Hand a kid an arbitrary one-off grant of Bucks with a note explaining it.
 * Posts an `adjustment` ledger row (reference_id NULL, so these may repeat —
 * see migration 00151). Adult-only. Amount is a positive integer.
 */
export async function awardBucks(input: {
  userId: string;
  amount: number;
  note: string;
}): Promise<void> {
  await requireAdult();
  const amount = Math.floor(input.amount);
  if (!(amount > 0)) throw new Error("Amount must be a positive number.");
  const note = input.note.trim();
  if (!note) throw new Error("Add a note so the kid knows what it's for.");

  const admin = createAdminClient();
  // Only real kids in the family can receive an award.
  const { data: kid } = await admin
    .from("family_members")
    .select("user_id")
    .eq("user_id", input.userId)
    .eq("role", "kid")
    .maybeSingle();
  if (!kid) throw new Error("Pick a kid to award Bucks to.");

  const { error } = await admin.from("bucks_ledger").insert({
    user_id: input.userId,
    amount,
    source: "adjustment",
    note,
    created_by_email: await callerEmail(),
  });
  if (error) throw new Error(error.message);
  revalidatePath("/bucks");
}

/**
 * An adult records an earning task for a kid and grants it straight away — no
 * pending approval. Creates the claim, then runs it through the same
 * approve_task_claim RPC the kid flow uses, so the ledger credit, value snapshot,
 * and one-time archiving stay identical.
 */
export async function grantTaskForKid(
  taskId: string,
  userId: string,
  quantity: number
): Promise<void> {
  await requireAdult();
  const qty = Math.floor(quantity);
  if (!(qty > 0)) throw new Error("Quantity must be at least 1.");
  if (qty > 1000) throw new Error("That's too many at once — claim in smaller batches.");

  const admin = createAdminClient();

  // Target must be a real kid.
  const { data: kid } = await admin
    .from("family_members")
    .select("user_id")
    .eq("user_id", userId)
    .eq("role", "kid")
    .maybeSingle();
  if (!kid) throw new Error("Pick a kid to claim for.");

  // Task must exist, be active, and be available to this kid.
  const { data: task } = await admin
    .from("bucks_earning_tasks")
    .select("id, unit_value, audience_user_id, archived_at")
    .eq("id", taskId)
    .maybeSingle();
  if (!task || task.archived_at) throw new Error("That task isn't available.");
  if (task.audience_user_id && task.audience_user_id !== userId) {
    throw new Error("That task isn't available for this kid.");
  }

  const { data: claim, error: claimErr } = await admin
    .from("bucks_task_claims")
    .insert({
      task_id: taskId,
      user_id: userId,
      quantity: qty,
      unit_value: task.unit_value as number,
    })
    .select("id")
    .single();
  if (claimErr || !claim) {
    throw new Error(claimErr?.message ?? "Couldn't record the claim.");
  }

  const { error } = await admin.rpc("approve_task_claim", {
    p_claim_id: claim.id,
    p_actor_email: await callerEmail(),
  });
  if (error) {
    if (error.message.includes("TASK_ALREADY_CLAIMED")) {
      throw new Error("That one-time task has already been granted.");
    }
    throw new Error(error.message);
  }
  revalidatePath("/bucks");
}

/** An adult redeems a prize on a chosen kid's behalf. Instant debit via RPC. */
export async function redeemPrizeForKid(prizeId: string, userId: string): Promise<void> {
  await requireAdult();
  const admin = createAdminClient();

  // Guard the target is a real kid before spending from their balance.
  const { data: kid } = await admin
    .from("family_members")
    .select("user_id")
    .eq("user_id", userId)
    .eq("role", "kid")
    .maybeSingle();
  if (!kid) throw new Error("Pick a kid to redeem for.");

  const { error } = await admin.rpc("redeem_prize", {
    p_prize_id: prizeId,
    p_user_id: userId,
    p_actor_email: await callerEmail(),
  });
  if (error) throw new Error(redeemErrorMessage(error.message));
  revalidatePath("/bucks");
}

// ---- Earning tasks -------------------------------------------------------

export async function createEarningTask(input: {
  title: string;
  unitValue: number;
  unitLabel: string;
  isOneTime: boolean;
  audienceEmail?: string | null;
}): Promise<void> {
  await requireAdult();
  const title = input.title.trim();
  if (!title) throw new Error("Give the task a title.");
  const unitValue = Math.floor(input.unitValue);
  if (!(unitValue > 0)) throw new Error("Value must be a positive number.");
  const unitLabel = input.unitLabel.trim() || "time";
  const audience = await resolveAudience(input.audienceEmail);

  const admin = createAdminClient();
  const { error } = await admin.from("bucks_earning_tasks").insert({
    title,
    unit_value: unitValue,
    unit_label: unitLabel,
    is_one_time: input.isOneTime,
    audience_user_id: audience,
    created_by_email: await callerEmail(),
  });
  if (error) throw new Error(error.message);
  revalidatePath("/bucks");
}

export async function updateEarningTask(input: {
  taskId: string;
  title: string;
  unitValue: number;
  unitLabel: string;
  isOneTime: boolean;
  audienceEmail?: string | null;
}): Promise<void> {
  await requireAdult();
  const title = input.title.trim();
  if (!title) throw new Error("Give the task a title.");
  const unitValue = Math.floor(input.unitValue);
  if (!(unitValue > 0)) throw new Error("Value must be a positive number.");
  const unitLabel = input.unitLabel.trim() || "time";
  const audience = await resolveAudience(input.audienceEmail);

  const admin = createAdminClient();
  const { error } = await admin
    .from("bucks_earning_tasks")
    .update({
      title,
      unit_value: unitValue,
      unit_label: unitLabel,
      is_one_time: input.isOneTime,
      audience_user_id: audience,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.taskId)
    .is("archived_at", null);
  if (error) throw new Error(error.message);
  revalidatePath("/bucks");
}

export async function archiveEarningTask(taskId: string): Promise<void> {
  await requireAdult();
  const admin = createAdminClient();
  const { error } = await admin
    .from("bucks_earning_tasks")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", taskId)
    .is("archived_at", null);
  if (error) throw new Error(error.message);
  revalidatePath("/bucks");
}

// ---- Prizes --------------------------------------------------------------

export async function createPrize(input: {
  title: string;
  price: number;
  audienceEmail?: string | null;
  purchaseUrl?: string | null;
}): Promise<{ prizeId: string }> {
  await requireAdult();
  const title = input.title.trim();
  if (!title) throw new Error("Give the prize a title.");
  const price = Math.floor(input.price);
  if (!(price > 0)) throw new Error("Price must be a positive number.");
  const audience = await resolveAudience(input.audienceEmail);
  const purchaseUrl = normalizePurchaseUrl(input.purchaseUrl);

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("bucks_prizes")
    .insert({
      title,
      price,
      audience_user_id: audience,
      purchase_url: purchaseUrl,
      created_by_email: await callerEmail(),
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Couldn't create the prize.");
  revalidatePath("/bucks");
  return { prizeId: data.id as string };
}

export async function updatePrize(input: {
  prizeId: string;
  title: string;
  price: number;
  audienceEmail?: string | null;
  purchaseUrl?: string | null;
}): Promise<void> {
  await requireAdult();
  const title = input.title.trim();
  if (!title) throw new Error("Give the prize a title.");
  const price = Math.floor(input.price);
  if (!(price > 0)) throw new Error("Price must be a positive number.");
  const audience = await resolveAudience(input.audienceEmail);
  const purchaseUrl = normalizePurchaseUrl(input.purchaseUrl);

  const admin = createAdminClient();
  const { error } = await admin
    .from("bucks_prizes")
    .update({
      title,
      price,
      audience_user_id: audience,
      purchase_url: purchaseUrl,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.prizeId)
    .is("archived_at", null);
  if (error) throw new Error(error.message);
  revalidatePath("/bucks");
}

/** Sign an upload URL for a prize image (reused reading-milestones bucket). */
export async function createPrizeImageUploadUrl(
  prizeId: string,
  ext: string
): Promise<{ path: string; token: string }> {
  await requireAdult();
  const cleanExt = ext.trim().toLowerCase().replace(/^\./, "");
  if (!IMAGE_EXT.has(cleanExt)) throw new Error("Unsupported image type.");

  const admin = createAdminClient();
  const { data: prize } = await admin
    .from("bucks_prizes")
    .select("id, audience_user_id")
    .eq("id", prizeId)
    .maybeSingle();
  if (!prize) throw new Error("Prize not found.");

  // Per-kid prizes live under the kid's folder; shared ones under "shared".
  const folder = (prize.audience_user_id as string | null) ?? "shared";
  const path = `${folder}/${prizeId}.${cleanExt}`;
  const signed = await admin.storage
    .from(READING_MILESTONES_BUCKET)
    .createSignedUploadUrl(path, { upsert: true });
  if (signed.error || !signed.data) {
    throw new Error(signed.error?.message ?? "Failed to create upload URL.");
  }
  return { path: signed.data.path, token: signed.data.token };
}

export async function attachPrizeImage(prizeId: string, path: string): Promise<void> {
  await requireAdult();
  const admin = createAdminClient();
  const { error } = await admin
    .from("bucks_prizes")
    .update({ image_path: path })
    .eq("id", prizeId);
  if (error) throw new Error(error.message);
  revalidatePath("/bucks");
}

export async function archivePrize(prizeId: string): Promise<void> {
  await requireAdult();
  const admin = createAdminClient();
  const { error } = await admin
    .from("bucks_prizes")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", prizeId)
    .is("archived_at", null);
  if (error) throw new Error(error.message);
  revalidatePath("/bucks");
}

// ---- Approvals & fulfillment --------------------------------------------

export async function approveClaim(claimId: string): Promise<void> {
  await requireAdult();
  const admin = createAdminClient();
  const { error } = await admin.rpc("approve_task_claim", {
    p_claim_id: claimId,
    p_actor_email: await callerEmail(),
  });
  if (error) {
    if (error.message.includes("CLAIM_NOT_PENDING")) {
      throw new Error("That claim was already handled.");
    }
    if (error.message.includes("TASK_ALREADY_CLAIMED")) {
      throw new Error("That one-time task has already been granted.");
    }
    throw new Error(error.message);
  }
  revalidatePath("/bucks");
}

export async function rejectClaim(claimId: string): Promise<void> {
  await requireAdult();
  const admin = createAdminClient();
  const { error } = await admin.rpc("reject_task_claim", {
    p_claim_id: claimId,
    p_actor_email: await callerEmail(),
  });
  if (error) {
    if (error.message.includes("CLAIM_NOT_PENDING")) {
      throw new Error("That claim was already handled.");
    }
    throw new Error(error.message);
  }
  revalidatePath("/bucks");
}

export async function fulfillRedemption(redemptionId: string): Promise<void> {
  await requireAdult();
  const admin = createAdminClient();
  const { error } = await admin
    .from("bucks_redemptions")
    .update({
      status: "fulfilled",
      fulfilled_at: new Date().toISOString(),
      fulfilled_by_email: await callerEmail(),
    })
    .eq("id", redemptionId)
    .eq("status", "unfulfilled");
  if (error) throw new Error(error.message);
  revalidatePath("/bucks");
}
