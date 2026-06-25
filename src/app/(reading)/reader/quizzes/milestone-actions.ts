"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOwner } from "@/lib/members/auth";
import { resolveReadingScope } from "@/lib/reading/scope";
import { READING_MILESTONES_BUCKET } from "@/lib/reading/constants";

const IMAGE_EXT = new Set(["jpg", "jpeg", "png", "webp", "gif"]);

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
