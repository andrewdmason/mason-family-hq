"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserTimezone, localDate } from "@/lib/date-utils";
import { resolveReadingScope } from "@/lib/reading/scope";
import { genresForAge } from "@/lib/reading/genres";
import { ratingImpliesFinished } from "@/lib/reading/status";
import {
  assessBookFit,
  generateRecommendationCandidates,
  type BookAssessment,
  type RatedTitle,
  type TasteProfile,
} from "@/lib/reading/recommend";
import type { ReadingRating, ReadingRecommendation } from "@/lib/types";

const REC_COLUMNS =
  "id, user_id, title, author, total_pages, cover_image_url, isbn, rationale, status, suppressed_until, acted_at, created_at, updated_at";

/** How many suggestions a single "Get recommendations" pass keeps. */
const BATCH_SIZE = 5;
/** Shown on queued books that came from the recommender (the "recommended by"). */
const AI_RECOMMENDER_LABEL = "AI";

/** What the Discover surface renders for the (scoped) member. */
export type DiscoverView = {
  recommendations: ReadingRecommendation[];
  /** True once the member has any ratings — i.e. real taste signal exists. */
  hasSignal: boolean;
  /** Age-appropriate genres for the "by genre" menu. */
  genres: string[];
};

/** A member's birthdate (via the service role, since RLS hides other members). */
async function memberBirthdate(email: string | null): Promise<string | null> {
  if (!email) return null;
  const { data } = await createAdminClient()
    .from("family_members")
    .select("birthdate")
    .eq("email", email)
    .maybeSingle();
  return (data?.birthdate as string | null) ?? null;
}

function ageFromBirthdate(birthdate: string | null, on: string): number | null {
  if (!birthdate) return null;
  const birth = new Date(`${birthdate}T12:00:00`);
  const at = new Date(`${on}T12:00:00`);
  if (Number.isNaN(birth.getTime())) return null;
  let age = at.getFullYear() - birth.getFullYear();
  const monthDiff = at.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && at.getDate() < birth.getDate())) age--;
  return age >= 0 && age < 130 ? age : null;
}

/** Whole years between two YYYY-MM-DD dates (>= 0). */
function yearsBetween(from: string, to: string): number {
  const a = new Date(`${from}T12:00:00`);
  const b = new Date(`${to}T12:00:00`);
  const ms = b.getTime() - a.getTime();
  return Math.max(0, Math.floor(ms / (365.25 * 24 * 60 * 60 * 1000)));
}

/**
 * Assemble the member's taste profile and the set of titles that must never be
 * recommended. Built fresh each generation pass (stateless replay): ratings on
 * their books + the feedback history on past recommendations.
 */
async function buildTasteProfile(
  client: Awaited<ReturnType<typeof resolveReadingScope>>["client"],
  userId: string,
  email: string | null,
  today: string
): Promise<TasteProfile> {
  const [{ data: bookRows }, { data: recRows }, birthdate] = await Promise.all([
    client
      .from("reading_books")
      .select("title, author, rating, rated_at")
      .eq("user_id", userId),
    client
      .from("reading_recommendations")
      .select("title")
      .eq("user_id", userId),
    memberBirthdate(email),
  ]);

  const loved: RatedTitle[] = [];
  const liked: RatedTitle[] = [];
  const disliked: RatedTitle[] = [];
  const didNotFinish: RatedTitle[] = [];
  const exclude = new Set<string>();

  for (const b of bookRows ?? []) {
    const ratedOn = (b.rated_at as string | null) ?? null;
    const entry: RatedTitle = {
      title: b.title as string,
      author: (b.author as string) ?? null,
      // When they formed the opinion — lets the engine weight taste drift by age.
      ageAtRating: ratedOn ? ageFromBirthdate(birthdate, ratedOn) : null,
      yearsAgo: ratedOn ? yearsBetween(ratedOn, today) : null,
    };
    exclude.add(entry.title); // never recommend a book they're already tracking
    if (b.rating === "didnt_finish") didNotFinish.push(entry);
    else if (b.rating === "loved") loved.push(entry);
    else if (b.rating === "liked") liked.push(entry);
    else if (b.rating === "disliked") disliked.push(entry);
  }

  // Never re-surface a title we've already shown them (pending, queued, or rated).
  for (const r of recRows ?? []) exclude.add(r.title as string);

  return {
    age: ageFromBirthdate(birthdate, today),
    loved,
    liked,
    disliked,
    didNotFinish,
    exclude: [...exclude],
  };
}

/** The member's current pending suggestions + whether they have taste signal yet. */
export async function getDiscover(memberEmail?: string | null): Promise<DiscoverView> {
  const { client, userId, email } = await resolveReadingScope(memberEmail);
  const tz = await getUserTimezone();
  const today = localDate(new Date(), tz);

  const [{ data: recRows, error: recError }, { data: ratedRows }, birthdate] =
    await Promise.all([
      client
        .from("reading_recommendations")
        .select(REC_COLUMNS)
        .eq("user_id", userId)
        .eq("status", "pending")
        .order("created_at", { ascending: false }),
      client
        .from("reading_books")
        .select("id")
        .eq("user_id", userId)
        .not("rating", "is", null)
        .limit(1),
      memberBirthdate(email),
    ]);
  if (recError) throw new Error(recError.message);

  return {
    recommendations: (recRows ?? []) as ReadingRecommendation[],
    hasSignal: (ratedRows ?? []).length > 0,
    genres: genresForAge(ageFromBirthdate(birthdate, today)),
  };
}

/**
 * Generate a fresh batch of suggestions for the member and store them as pending.
 * Returns how many were added (0 means the AI had nothing new to offer). Existing
 * pending titles are excluded, so repeated passes don't duplicate.
 */
export async function generateRecommendations(
  memberEmail?: string | null,
  genre?: string | null,
  request?: string | null
): Promise<ReadingRecommendation[]> {
  const { client, userId, email } = await resolveReadingScope(memberEmail);
  const tz = await getUserTimezone();
  const today = localDate(new Date(), tz);

  const profile = await buildTasteProfile(client, userId, email, today);
  // Only honor a genre that's valid for this reader's age; otherwise go general.
  // The free-text request is trimmed and capped so it can't bloat the prompt.
  const focusGenre =
    genre && genresForAge(profile.age).includes(genre) ? genre : null;
  const focusRequest = (request ?? "").trim().slice(0, 300) || null;
  const candidates = await generateRecommendationCandidates(profile, {
    genre: focusGenre,
    request: focusRequest,
  });

  // Belt-and-suspenders: drop anything that slipped past the prompt's exclude list.
  const excluded = new Set(profile.exclude.map((t) => t.trim().toLowerCase()));
  const fresh = candidates
    .filter((c) => !excluded.has(c.title.trim().toLowerCase()))
    .slice(0, BATCH_SIZE);
  if (fresh.length === 0) return [];

  const { data, error } = await client
    .from("reading_recommendations")
    .insert(
      fresh.map((c) => ({
        user_id: userId,
        title: c.title,
        author: c.author,
        total_pages: c.totalPages,
        cover_image_url: c.coverImageUrl,
        isbn: c.isbn,
        rationale: c.rationale,
        status: "pending",
      }))
    )
    .select(REC_COLUMNS);
  if (error) throw new Error(error.message);

  revalidatePath("/reader");
  return (data ?? []) as ReadingRecommendation[];
}

/**
 * Predict whether the (scoped) member will enjoy one specific book — the same
 * taste engine the recommender uses, aimed at a single title they're considering
 * (a manual add, or a book already sitting in their queue). Returns null when the
 * AI couldn't form a verdict, so the caller can show a gentle retry.
 */
export async function assessBook(input: {
  title: string;
  author?: string | null;
  memberEmail?: string | null;
}): Promise<BookAssessment | null> {
  const title = input.title.trim();
  if (!title) throw new Error("Enter a book title.");
  const { client, userId, email } = await resolveReadingScope(input.memberEmail ?? null);
  const tz = await getUserTimezone();
  const today = localDate(new Date(), tz);
  const profile = await buildTasteProfile(client, userId, email, today);
  return assessBookFit(profile, {
    title,
    author: input.author?.trim() || null,
  });
}

/** Fetch a member's recommendation row, scoped to them. */
async function getRec(
  client: Awaited<ReturnType<typeof resolveReadingScope>>["client"],
  userId: string,
  recId: string
): Promise<ReadingRecommendation> {
  const { data, error } = await client
    .from("reading_recommendations")
    .select(REC_COLUMNS)
    .eq("id", recId)
    .eq("user_id", userId)
    .single();
  if (error) throw new Error(error.message);
  return data as ReadingRecommendation;
}

/** Add a suggestion to the member's reading queue. */
export async function queueRecommendation(
  recId: string,
  memberEmail?: string | null
): Promise<void> {
  const { client, userId } = await resolveReadingScope(memberEmail);
  const rec = await getRec(client, userId, recId);

  // Stamp the provenance using the existing recommendation fields: there's no AI
  // "member" to reference, so leave the email null and record the AI label + the
  // rationale as the note, so the queued book shows where it came from and why.
  const { error: bookError } = await client.from("reading_books").insert({
    user_id: userId,
    title: rec.title,
    author: rec.author,
    total_pages: rec.total_pages,
    current_page: 0,
    status: "queued",
    cover_image_url: rec.cover_image_url,
    recommended_by_email: null,
    recommended_by_label: AI_RECOMMENDER_LABEL,
    recommendation_note: rec.rationale,
  });
  if (bookError) throw new Error(bookError.message);

  const { error } = await client
    .from("reading_recommendations")
    .update({ status: "queued", acted_at: new Date().toISOString() })
    .eq("id", recId)
    .eq("user_id", userId);
  if (error) throw new Error(error.message);

  revalidatePath("/reader");
}

/**
 * Record the member's verdict on a suggestion: files it on the archive shelf with
 * the chosen rating and clears it from the recommendations. Loved/liked/okay imply
 * they read it (finished); "didn't finish" and "didn't like" make no such claim,
 * so the book isn't marked finished. A "didn't like" here is the merged
 * "not for me" — a strong negative the next pass steers away from.
 */
export async function rateRecommendation(
  recId: string,
  rating: ReadingRating,
  memberEmail?: string | null
): Promise<void> {
  const { client, userId } = await resolveReadingScope(memberEmail);
  const rec = await getRec(client, userId, recId);

  const tz = await getUserTimezone();
  const today = localDate(new Date(), tz);

  const finished = ratingImpliesFinished(rating);
  const { error: bookError } = await client.from("reading_books").insert({
    user_id: userId,
    title: rec.title,
    author: rec.author,
    total_pages: rec.total_pages,
    current_page: finished ? rec.total_pages ?? 0 : 0,
    status: "archive",
    cover_image_url: rec.cover_image_url,
    finished_at: finished ? today : null,
    rating,
    rated_at: today,
  });
  if (bookError) throw new Error(bookError.message);

  const { error } = await client
    .from("reading_recommendations")
    .update({ status: "already_read", acted_at: new Date().toISOString() })
    .eq("id", recId)
    .eq("user_id", userId);
  if (error) throw new Error(error.message);

  revalidatePath("/reader");
}

/**
 * Clear a suggestion off the list without recording a verdict. It's not a taste
 * signal — just "not this one" — but every title we've shown is excluded from
 * future passes, so it won't come back. (Reuses the dormant not_for_me status.)
 */
export async function dismissRecommendation(
  recId: string,
  memberEmail?: string | null
): Promise<void> {
  const { client, userId } = await resolveReadingScope(memberEmail);
  const { error } = await client
    .from("reading_recommendations")
    .update({ status: "not_for_me", acted_at: new Date().toISOString() })
    .eq("id", recId)
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
  revalidatePath("/reader");
}
