import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserTimezone, localDate } from "@/lib/date-utils";

/** Whole years between a birthdate and a given date, or null if unknown/invalid. */
export function ageFromBirthdate(
  birthdate: string | null,
  on: string
): number | null {
  if (!birthdate) return null;
  const birth = new Date(`${birthdate}T12:00:00`);
  const at = new Date(`${on}T12:00:00`);
  if (Number.isNaN(birth.getTime())) return null;
  let age = at.getFullYear() - birth.getFullYear();
  const monthDiff = at.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && at.getDate() < birth.getDate())) age--;
  return age >= 0 && age < 130 ? age : null;
}

/**
 * The reader's age today, for age-fitting generated quizzes. Reads via the
 * service role (RLS hides other members), so it works whether the kid generates
 * for themselves or the owner generates on their behalf.
 */
export async function readerAge(email: string | null): Promise<number | null> {
  if (!email) return null;
  const { data } = await createAdminClient()
    .from("family_members")
    .select("birthdate")
    .eq("email", email)
    .maybeSingle();
  const tz = await getUserTimezone();
  return ageFromBirthdate(
    (data?.birthdate as string | null) ?? null,
    localDate(new Date(), tz)
  );
}
