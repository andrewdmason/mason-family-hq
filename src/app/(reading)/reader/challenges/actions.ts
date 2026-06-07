"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireParent } from "@/lib/members/auth";
import { resolveReadingScope } from "@/lib/reading/scope";
import { computeChallengeProgress } from "@/lib/reading/challenge-progress";
import { getUserTimezone, localDate } from "@/lib/date-utils";
import type {
  ReadingChallenge,
  ReadingChallengeProgress,
  ReadingChallengeStatus,
} from "@/lib/types";

const CHALLENGE_COLUMNS =
  "id, kid_email, created_by_email, title, description, start_date, end_date, page_goal, pages_per_token, status, created_at, updated_at";

/** Today (YYYY-MM-DD) in the caller's timezone. */
async function today(): Promise<string> {
  return localDate(new Date(), await getUserTimezone());
}

/** This kid's weekly page goal (the baseline the breakdown is measured against). */
async function weeklyBaselineFor(
  client: Awaited<ReturnType<typeof createClient>> | ReturnType<typeof createAdminClient>,
  email: string | null,
): Promise<number> {
  if (!email) return 0;
  const { data } = await client
    .from("reading_settings")
    .select("weekly_page_goal")
    .eq("member_email", email)
    .maybeSingle();
  return (data?.weekly_page_goal as number) ?? 0;
}

/**
 * The active challenge for the scoped kid plus its derived progress, or null if
 * they have none. A kid sees their own (no arg); the owner passes a kid's email.
 */
export async function getChallengeForKid(
  memberEmail?: string | null,
): Promise<ReadingChallengeProgress | null> {
  const { client, userId, email } = await resolveReadingScope(memberEmail);
  if (!email) return null;

  const { data } = await client
    .from("reading_challenges")
    .select(CHALLENGE_COLUMNS)
    .eq("kid_email", email)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;

  const challenge = data as ReadingChallenge;
  const baseline = await weeklyBaselineFor(client, email);
  return computeChallengeProgress(client, userId, challenge, baseline, await today());
}

export type ChallengeAdminItem = {
  challenge: ReadingChallenge;
  kidName: string | null;
  /** Null when the kid hasn't signed in yet (no reading data to derive). */
  progress: ReadingChallengeProgress | null;
};

/**
 * Every challenge (active + archived), newest first, with the kid's name and
 * derived progress for the parent management list. Parent/owner only.
 */
export async function listChallengesAdmin(): Promise<ChallengeAdminItem[]> {
  await requireParent();
  const admin = createAdminClient();

  const [{ data: challengeRows }, { data: memberRows }] = await Promise.all([
    admin
      .from("reading_challenges")
      .select(CHALLENGE_COLUMNS)
      .order("created_at", { ascending: false }),
    admin.from("family_members").select("email, name, user_id"),
  ]);

  const challenges = (challengeRows ?? []) as ReadingChallenge[];
  const memberByEmail = new Map(
    (memberRows ?? []).map((m) => [
      m.email as string,
      { name: (m.name as string | null) ?? null, userId: (m.user_id as string | null) ?? null },
    ]),
  );

  const day = await today();
  return Promise.all(
    challenges.map(async (challenge) => {
      const member = memberByEmail.get(challenge.kid_email);
      let progress: ReadingChallengeProgress | null = null;
      if (member?.userId) {
        const baseline = await weeklyBaselineFor(admin, challenge.kid_email);
        progress = await computeChallengeProgress(
          admin,
          member.userId,
          challenge,
          baseline,
          day,
        );
      }
      return { challenge, kidName: member?.name ?? null, progress };
    }),
  );
}

/** The kids a parent can create a challenge for. Parent/owner only. */
export async function listKidOptions(): Promise<{ email: string; name: string | null }[]> {
  await requireParent();
  const admin = createAdminClient();
  const { data } = await admin
    .from("family_members")
    .select("email, name, role, created_at")
    .eq("role", "kid")
    .order("created_at", { ascending: true });
  return (data ?? []).map((m) => ({
    email: m.email as string,
    name: (m.name as string | null) ?? null,
  }));
}

/** One challenge by id, for the edit screen. Parent/owner only. */
export async function getChallengeAdmin(id: string): Promise<ReadingChallenge | null> {
  await requireParent();
  const admin = createAdminClient();
  const { data } = await admin
    .from("reading_challenges")
    .select(CHALLENGE_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  return (data as ReadingChallenge) ?? null;
}

export type ChallengeInput = {
  kidEmail: string;
  title: string;
  description?: string;
  startDate: string;
  endDate: string;
  pageGoal: number;
  pagesPerToken?: number;
};

function validate(input: ChallengeInput): void {
  if (!input.title.trim()) throw new Error("Give the challenge a title.");
  if (!input.startDate || !input.endDate) throw new Error("Pick a start and end date.");
  if (input.endDate < input.startDate) throw new Error("The end date must come after the start date.");
  if (!Number.isFinite(input.pageGoal) || input.pageGoal <= 0) {
    throw new Error("Set a page goal above zero.");
  }
}

/**
 * Create a challenge for a kid. Parent/owner only. The unique partial index
 * enforces one active challenge per kid — surface that as a clear message.
 */
export async function createChallenge(input: ChallengeInput): Promise<{ id: string }> {
  const { email: createdBy } = await requireParent();
  validate(input);
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("reading_challenges")
    .insert({
      kid_email: input.kidEmail.trim().toLowerCase(),
      created_by_email: createdBy,
      title: input.title.trim(),
      description: input.description ?? "",
      start_date: input.startDate,
      end_date: input.endDate,
      page_goal: Math.round(input.pageGoal),
      pages_per_token: Math.max(0, Math.round(input.pagesPerToken ?? 30)),
      status: "active",
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") {
      throw new Error("That kid already has an active challenge. Archive it first.");
    }
    throw new Error(error.message);
  }

  revalidatePath("/reader/challenges");
  revalidatePath("/reader");
  return { id: data.id as string };
}

/** Edit a challenge's fields (including the markdown description). Parent/owner only. */
export async function updateChallenge(
  id: string,
  fields: Partial<ChallengeInput>,
): Promise<void> {
  await requireParent();
  const admin = createAdminClient();

  const patch: Record<string, unknown> = {};
  if (fields.title !== undefined) {
    if (!fields.title.trim()) throw new Error("Give the challenge a title.");
    patch.title = fields.title.trim();
  }
  if (fields.description !== undefined) patch.description = fields.description;
  if (fields.startDate !== undefined) patch.start_date = fields.startDate;
  if (fields.endDate !== undefined) patch.end_date = fields.endDate;
  if (fields.pageGoal !== undefined) {
    if (!Number.isFinite(fields.pageGoal) || fields.pageGoal <= 0) {
      throw new Error("Set a page goal above zero.");
    }
    patch.page_goal = Math.round(fields.pageGoal);
  }
  if (fields.pagesPerToken !== undefined) {
    patch.pages_per_token = Math.max(0, Math.round(fields.pagesPerToken));
  }
  if (Object.keys(patch).length === 0) return;

  const { error } = await admin.from("reading_challenges").update(patch).eq("id", id);
  if (error) throw new Error(error.message);

  revalidatePath("/reader/challenges");
  revalidatePath(`/reader/challenges/${id}/edit`);
  revalidatePath("/reader");
}

/** Archive or reactivate a challenge. Parent/owner only. */
export async function setChallengeStatus(
  id: string,
  status: ReadingChallengeStatus,
): Promise<void> {
  await requireParent();
  const admin = createAdminClient();
  const { error } = await admin
    .from("reading_challenges")
    .update({ status })
    .eq("id", id);
  if (error) {
    if (error.code === "23505") {
      throw new Error("That kid already has an active challenge. Archive it first.");
    }
    throw new Error(error.message);
  }
  revalidatePath("/reader/challenges");
  revalidatePath("/reader");
}
