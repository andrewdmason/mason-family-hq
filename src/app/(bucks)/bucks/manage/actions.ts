"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdult } from "@/lib/members/auth";
import { READING_MILESTONES_BUCKET } from "@/lib/reading/constants";
import {
  loadPendingClaims,
  loadTasksForAdmin,
} from "@/lib/bucks/tasks";
import {
  loadPrizesForAdmin,
  loadUnfulfilledRedemptions,
} from "@/lib/bucks/prizes";
import type {
  BucksAdminClaim,
  BucksAdminPrize,
  BucksAdminRedemption,
  BucksAdminTask,
} from "@/lib/bucks/types";

const IMAGE_EXT = new Set(["jpg", "jpeg", "png", "webp", "gif"]);

export type BucksKid = { email: string; name: string; userId: string };

export type BucksManageData = {
  tasks: BucksAdminTask[];
  prizes: BucksAdminPrize[];
  claims: BucksAdminClaim[];
  redemptions: BucksAdminRedemption[];
  kids: BucksKid[];
};

async function callerEmail(): Promise<string> {
  const {
    data: { user },
  } = await (await createClient()).auth.getUser();
  return user?.email?.toLowerCase() ?? "owner";
}

/** The family's kids, for audience pickers and redeem-on-behalf. Service role. */
async function loadKids(): Promise<BucksKid[]> {
  const admin = createAdminClient();
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

function revalidateBucks() {
  revalidatePath("/bucks");
  revalidatePath("/bucks/manage");
}

/** Everything the adult console renders. Adult-only. */
export async function loadManageData(): Promise<BucksManageData> {
  await requireAdult();
  const [tasks, prizes, claims, redemptions, kids] = await Promise.all([
    loadTasksForAdmin(),
    loadPrizesForAdmin(),
    loadPendingClaims(),
    loadUnfulfilledRedemptions(),
    loadKids(),
  ]);
  return { tasks, prizes, claims, redemptions, kids };
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
  revalidateBucks();
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
  revalidateBucks();
}

// ---- Prizes --------------------------------------------------------------

export async function createPrize(input: {
  title: string;
  price: number;
  audienceEmail?: string | null;
}): Promise<{ prizeId: string }> {
  await requireAdult();
  const title = input.title.trim();
  if (!title) throw new Error("Give the prize a title.");
  const price = Math.floor(input.price);
  if (!(price > 0)) throw new Error("Price must be a positive number.");
  const audience = await resolveAudience(input.audienceEmail);

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("bucks_prizes")
    .insert({
      title,
      price,
      audience_user_id: audience,
      created_by_email: await callerEmail(),
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Couldn't create the prize.");
  revalidateBucks();
  return { prizeId: data.id as string };
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
  revalidateBucks();
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
  revalidateBucks();
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
  revalidateBucks();
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
  revalidateBucks();
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
  revalidateBucks();
}
