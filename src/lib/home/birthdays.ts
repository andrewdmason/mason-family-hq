import "server-only";

import { createClient } from "@/lib/supabase/server";
import { localDate } from "@/lib/date-utils";
import type { UpcomingBirthday } from "./types";

/** Whole days from date string `a` to `b` (both YYYY-MM-DD), via UTC midnight. */
function daysBetween(a: string, b: string): number {
  const ms = Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

/**
 * The family's next upcoming birthdays, soonest first. Each member's birthday is
 * projected onto this year (or next, if it's already passed) so the countdown is
 * always forward-looking. Members without a stored birthdate are skipped.
 */
export async function getUpcomingBirthdays(
  tz: string,
  limit = 3
): Promise<UpcomingBirthday[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("family_members")
    .select("name, birthdate");

  const today = localDate(new Date(), tz);
  const todayYear = Number(today.slice(0, 4));

  const upcoming: UpcomingBirthday[] = [];
  for (const row of data ?? []) {
    const birthdate = row.birthdate as string | null;
    const name = (row.name as string | null)?.trim();
    if (!birthdate || !name) continue;

    const monthDay = birthdate.slice(5); // "MM-DD"
    const birthYear = Number(birthdate.slice(0, 4));

    // This year's occurrence; if it's already behind us, roll to next year.
    let occurrence = `${todayYear}-${monthDay}`;
    let occurrenceYear = todayYear;
    if (daysBetween(today, occurrence) < 0) {
      occurrenceYear = todayYear + 1;
      occurrence = `${occurrenceYear}-${monthDay}`;
    }

    upcoming.push({
      name,
      date: occurrence,
      daysUntil: daysBetween(today, occurrence),
      turningAge: Number.isFinite(birthYear) ? occurrenceYear - birthYear : null,
    });
  }

  return upcoming
    .sort((a, b) => a.daysUntil - b.daysUntil)
    .slice(0, limit);
}
