"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOwner } from "@/lib/members/auth";
import { resolveReadingScope } from "@/lib/reading/scope";
import { READING_MILESTONES_BUCKET } from "@/lib/reading/constants";
import {
  loadAdvanceLedger,
  signedMilestoneImageUrl,
  sumFromLedger,
  sumMetricSince,
  type MilestoneMetric,
} from "@/lib/reading/milestones";
import type { ReadingAdminMilestone } from "@/lib/types";

const IMAGE_EXT = new Set(["jpg", "jpeg", "png", "webp", "gif"]);
const METRICS: MilestoneMetric[] = ["bonus_pages", "total_pages"];

function normalizeStartOn(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * Stamp achieved_at when the kid already meets a milestone — so a parent who sets
 * (or lowers) a threshold the kid has already passed gets the dashboard celebration
 * and bell notification immediately, not only after the kid's next advance. Runs on
 * the owner's scoped (service-role) client; no-op if not yet reached.
 */
async function stampIfAlreadyReached(
  client: Awaited<ReturnType<typeof resolveReadingScope>>["client"],
  userId: string,
  milestoneId: string,
  metric: MilestoneMetric,
  threshold: number,
  startOn: string | null
): Promise<void> {
  const current = await sumMetricSince(client, userId, metric, startOn);
  if (current >= threshold) {
    await client
      .from("reading_milestones")
      .update({ achieved_at: new Date().toISOString() })
      .eq("id", milestoneId)
      .eq("user_id", userId)
      .is("achieved_at", null);
  }
}

/**
 * Sign an upload URL for a milestone's reward image. Owner-only. Mirrors
 * createBookUploadUrl: the path lives under the kid's folder
 * ({user_id}/{milestone_id}.{ext}), which the owner's own session couldn't write
 * — so member-mode uploads sign via the service role. The userId is always the
 * trusted email→id lookup from the scope, never client input.
 */
export async function createMilestoneImageUploadUrl(
  milestoneId: string,
  ext: string,
  memberEmail?: string | null
): Promise<{ path: string; token: string }> {
  await requireOwner();
  const { client, userId, isMemberMode } = await resolveReadingScope(memberEmail);

  const cleanExt = ext.trim().toLowerCase().replace(/^\./, "");
  if (!IMAGE_EXT.has(cleanExt)) throw new Error("Unsupported image type.");

  // Confirm the milestone belongs to the scoped kid before handing out a URL.
  const { data: milestone, error } = await client
    .from("reading_milestones")
    .select("id")
    .eq("id", milestoneId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!milestone) throw new Error("Milestone not found.");

  const path = `${userId}/${milestoneId}.${cleanExt}`;
  const storage = (isMemberMode ? createAdminClient() : await createClient())
    .storage;
  const signed = await storage
    .from(READING_MILESTONES_BUCKET)
    .createSignedUploadUrl(path, { upsert: true });
  if (signed.error || !signed.data) {
    throw new Error(signed.error?.message ?? "Failed to create upload URL.");
  }
  return { path: signed.data.path, token: signed.data.token };
}

function revalidateMilestones() {
  revalidatePath("/reader");
  revalidatePath("/reader/quizzes");
}

/**
 * A kid's milestones for the Parent Admin console: all not-yet-awarded ones with
 * their current count, achieved state, and a signed reward-image URL. Owner-only.
 */
export async function getReadingMilestonesForAdmin(
  memberEmail?: string | null
): Promise<ReadingAdminMilestone[]> {
  await requireOwner();
  const { client, userId } = await resolveReadingScope(memberEmail);

  const [{ data: rows }, ledger] = await Promise.all([
    client
      .from("reading_milestones")
      .select("id, title, metric, threshold, image_path, start_on, achieved_at, awarded_at")
      .eq("user_id", userId)
      .is("awarded_at", null)
      .order("created_at", { ascending: true }),
    loadAdvanceLedger(client, userId),
  ]);
  if (!rows || rows.length === 0) return [];

  return Promise.all(
    rows.map(async (m): Promise<ReadingAdminMilestone> => {
      const metric = m.metric as MilestoneMetric;
      const startOn = (m.start_on as string | null) ?? null;
      return {
        id: m.id as string,
        title: m.title as string,
        metric,
        threshold: m.threshold as number,
        current: sumFromLedger(ledger, metric, startOn),
        imageUrl: await signedMilestoneImageUrl(
          client,
          (m.image_path as string | null) ?? null
        ),
        startOn,
        achieved: m.achieved_at != null,
        awarded: false,
      };
    })
  );
}

/**
 * Preview a kid's current count for a metric + start date, so the create form can
 * show "Oscar has 240 bonus pages since all time" before a threshold is set.
 */
export async function previewMilestoneCount(
  memberEmail: string | null | undefined,
  metric: MilestoneMetric,
  startOn?: string | null
): Promise<number> {
  await requireOwner();
  if (!METRICS.includes(metric)) throw new Error("Unknown metric.");
  const { client, userId } = await resolveReadingScope(memberEmail);
  return sumMetricSince(client, userId, metric, normalizeStartOn(startOn));
}

/** Create a milestone for a kid (image is attached separately). Owner-only. */
export async function createMilestone(input: {
  memberEmail?: string | null;
  title: string;
  metric: MilestoneMetric;
  threshold: number;
  startOn?: string | null;
}): Promise<{ milestoneId: string }> {
  await requireOwner();
  const { client, userId } = await resolveReadingScope(input.memberEmail);
  const {
    data: { user },
  } = await (await createClient()).auth.getUser();
  const callerEmail = user?.email?.toLowerCase() ?? "owner";

  const title = input.title.trim();
  if (!title) throw new Error("Give the milestone a title.");
  if (!METRICS.includes(input.metric)) throw new Error("Unknown metric.");
  const threshold = Math.floor(input.threshold);
  if (!(threshold > 0)) throw new Error("Threshold must be a positive number.");

  const { data, error } = await client
    .from("reading_milestones")
    .insert({
      user_id: userId,
      created_by_email: callerEmail,
      title,
      metric: input.metric,
      threshold,
      start_on: normalizeStartOn(input.startOn),
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Couldn't create the milestone.");

  const milestoneId = data.id as string;
  await stampIfAlreadyReached(
    client,
    userId,
    milestoneId,
    input.metric,
    threshold,
    normalizeStartOn(input.startOn)
  );

  revalidateMilestones();
  return { milestoneId };
}

/** Edit a milestone (any subset of fields, including its reward image). Owner-only. */
export async function updateMilestone(
  milestoneId: string,
  patch: {
    title?: string;
    metric?: MilestoneMetric;
    threshold?: number;
    startOn?: string | null;
    imagePath?: string | null;
  },
  memberEmail?: string | null
): Promise<void> {
  await requireOwner();
  const { client, userId } = await resolveReadingScope(memberEmail);

  const update: Record<string, unknown> = {};
  if (patch.title !== undefined) {
    const title = patch.title.trim();
    if (!title) throw new Error("Give the milestone a title.");
    update.title = title;
  }
  if (patch.metric !== undefined) {
    if (!METRICS.includes(patch.metric)) throw new Error("Unknown metric.");
    update.metric = patch.metric;
  }
  if (patch.threshold !== undefined) {
    const threshold = Math.floor(patch.threshold);
    if (!(threshold > 0)) throw new Error("Threshold must be a positive number.");
    update.threshold = threshold;
  }
  if ("startOn" in patch) update.start_on = normalizeStartOn(patch.startOn);
  if ("imagePath" in patch) update.image_path = patch.imagePath ?? null;
  if (Object.keys(update).length === 0) return;

  // Editing the metric/threshold/start can change whether it's reached — let the
  // next advance re-stamp it, so clear a stale achievement when the bar moves.
  if (
    update.metric !== undefined ||
    update.threshold !== undefined ||
    update.start_on !== undefined
  ) {
    update.achieved_at = null;
  }

  const { error } = await client
    .from("reading_milestones")
    .update(update)
    .eq("id", milestoneId)
    .eq("user_id", userId);
  if (error) throw new Error(error.message);

  // The bar may have moved (or an image-only edit left it unchanged) — re-stamp if
  // the kid already meets the current threshold, so it isn't stuck unreached.
  const { data: current } = await client
    .from("reading_milestones")
    .select("metric, threshold, start_on, achieved_at")
    .eq("id", milestoneId)
    .eq("user_id", userId)
    .maybeSingle();
  if (current && current.achieved_at == null) {
    await stampIfAlreadyReached(
      client,
      userId,
      milestoneId,
      current.metric as MilestoneMetric,
      current.threshold as number,
      (current.start_on as string | null) ?? null
    );
  }

  revalidateMilestones();
}

/** Mark a milestone's reward handed over — retires it from the dashboard. Owner-only. */
export async function markMilestoneAwarded(
  milestoneId: string,
  memberEmail?: string | null
): Promise<void> {
  await requireOwner();
  const { client, userId } = await resolveReadingScope(memberEmail);
  const { error } = await client
    .from("reading_milestones")
    .update({ awarded_at: new Date().toISOString() })
    .eq("id", milestoneId)
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
  revalidateMilestones();
}

/** Delete a milestone (and its reward image, best-effort). Owner-only. */
export async function deleteMilestone(
  milestoneId: string,
  memberEmail?: string | null
): Promise<void> {
  await requireOwner();
  const { client, userId } = await resolveReadingScope(memberEmail);

  const { data: existing } = await client
    .from("reading_milestones")
    .select("image_path")
    .eq("id", milestoneId)
    .eq("user_id", userId)
    .maybeSingle();

  const { error } = await client
    .from("reading_milestones")
    .delete()
    .eq("id", milestoneId)
    .eq("user_id", userId);
  if (error) throw new Error(error.message);

  const imagePath = (existing?.image_path as string | null) ?? null;
  if (imagePath) {
    await client.storage.from(READING_MILESTONES_BUCKET).remove([imagePath]);
  }
  revalidateMilestones();
}
