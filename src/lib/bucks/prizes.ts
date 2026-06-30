import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { READING_MILESTONES_BUCKET } from "@/lib/reading/constants";
import { firstNameFor } from "@/lib/bucks/members";
import type { BucksAdminPrize, BucksAdminRedemption, BucksPrize } from "@/lib/bucks/types";

type PrizeRow = {
  id: string;
  title: string;
  price: number;
  image_path: string | null;
  purchase_url: string | null;
  audience_user_id: string | null;
  archived_at: string | null;
};

/**
 * A short-lived signed URL for a prize image. Prize images live in the reused
 * reading-milestones bucket. Signed via the service role so shared-prize images
 * (no per-kid folder) resolve regardless of the viewer.
 */
export async function signedPrizeImageUrl(
  imagePath: string | null
): Promise<string | null> {
  if (!imagePath) return null;
  try {
    const admin = createAdminClient();
    const { data } = await admin.storage
      .from(READING_MILESTONES_BUCKET)
      .createSignedUrl(imagePath, 60 * 60);
    return data?.signedUrl ?? null;
  } catch {
    // A storage hiccup (e.g. 502 after a local reset) must degrade to a missing
    // thumbnail, never blank the whole wallet/admin render.
    return null;
  }
}

/**
 * Available prizes for a kid — non-archived, shared or their own — each with a
 * signed image URL and whether their current balance can afford it. Filters by
 * userId explicitly so it's correct on the admin client (member mode) too.
 */
export async function loadPrizesForKid(
  client: SupabaseClient,
  userId: string,
  balance: number
): Promise<BucksPrize[]> {
  const { data: rows } = await client
    .from("bucks_prizes")
    .select("id, title, price, image_path, audience_user_id, archived_at")
    .is("archived_at", null)
    .or(`audience_user_id.is.null,audience_user_id.eq.${userId}`)
    .order("price", { ascending: true });

  return Promise.all(
    ((rows ?? []) as PrizeRow[]).map(async (p) => ({
      id: p.id,
      title: p.title,
      price: p.price,
      imageUrl: await signedPrizeImageUrl(p.image_path),
      audienceUserId: p.audience_user_id,
      affordable: balance >= p.price,
    }))
  );
}

/** All non-archived prizes for the adult console. Service role. */
export async function loadPrizesForAdmin(): Promise<BucksAdminPrize[]> {
  const admin = createAdminClient();
  const { data: rows } = await admin
    .from("bucks_prizes")
    .select("id, title, price, image_path, purchase_url, audience_user_id, archived_at")
    .is("archived_at", null)
    .order("created_at", { ascending: true });

  return Promise.all(
    ((rows ?? []) as PrizeRow[]).map(async (p) => ({
      id: p.id,
      title: p.title,
      price: p.price,
      imageUrl: await signedPrizeImageUrl(p.image_path),
      purchaseUrl: p.purchase_url,
      audienceUserId: p.audience_user_id,
      archivedAt: p.archived_at,
    }))
  );
}

/** Unfulfilled redemptions across all kids, for the adult fulfillment list. */
export async function loadUnfulfilledRedemptions(): Promise<BucksAdminRedemption[]> {
  const admin = createAdminClient();
  const { data: rows } = await admin
    .from("bucks_redemptions")
    .select("id, user_id, prize_title, price, redeemed_at")
    .eq("status", "unfulfilled")
    .order("redeemed_at", { ascending: true });
  if (!rows || rows.length === 0) return [];

  const names = await firstNameFor(
    admin,
    rows.map((r) => r.user_id as string)
  );

  return rows.map((r) => ({
    id: r.id as string,
    prizeTitle: r.prize_title as string,
    kidUserId: r.user_id as string,
    kidName: names.get(r.user_id as string) ?? "A kid",
    price: r.price as number,
    redeemedAt: r.redeemed_at as string,
  }));
}
