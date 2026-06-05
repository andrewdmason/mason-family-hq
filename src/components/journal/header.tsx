import { JournalHeaderClient } from "@/components/journal/header-client";
import { getUserTimezone, localDate } from "@/lib/date-utils";
import { getIsOwner, requireUserId } from "@/lib/members/auth";
import { getJournalNotifications } from "@/lib/journal/notifications";
import { createClient } from "@/lib/supabase/server";

export type JournalStreakStats = {
  currentStreak: number;
  daysThisWeek: number;
  thisWeekDays: boolean[];
  totalEntries: number;
  postedToday: boolean;
};

type StreakEntry = {
  id: string;
  entry_date: string;
  status: string;
  opening_question: string | null;
  freeform_started_at: string | null;
};

export async function JournalHeader() {
  const supabase = await createClient();
  const userId = await requireUserId(supabase);

  const [streak, notifications, isOwner] = await Promise.all([
    getJournalStreakStats(supabase, userId),
    getJournalNotifications(supabase, userId),
    getIsOwner(supabase),
  ]);

  return (
    <JournalHeaderClient
      streak={streak}
      notifications={notifications}
      isOwner={isOwner}
    />
  );
}

async function getJournalStreakStats(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string
): Promise<JournalStreakStats> {
  const [{ data }, tz] = await Promise.all([
    supabase
      .from("journal_entries")
      .select("id, entry_date, status, opening_question, freeform_started_at")
      .eq("user_id", userId),
    getUserTimezone(),
  ]);

  const entries = (data ?? []) as StreakEntry[];
  const blankOpenEntryIds = entries
    .filter(isBlankOpenEntry)
    .map((entry) => entry.id);
  const photoEntryIds = new Set<string>();

  if (blankOpenEntryIds.length > 0) {
    const { data: photos } = await supabase
      .from("journal_entry_photos")
      .select("entry_id")
      .eq("user_id", userId)
      .in("entry_id", blankOpenEntryIds);

    for (const photo of photos ?? []) {
      if (photo.entry_id) photoEntryIds.add(photo.entry_id as string);
    }
  }

  const realEntries = entries.filter(
    (entry) => !isBlankOpenEntry(entry) || photoEntryIds.has(entry.id)
  );
  const today = localDate(new Date(), tz);
  const entryDates = new Set(realEntries.map((entry) => entry.entry_date));
  const weekStart = getWeekStart(today);
  const thisWeekDays = Array.from({ length: 7 }, (_, i) =>
    entryDates.has(addDays(weekStart, i))
  );

  return {
    currentStreak: getCurrentStreak(entryDates, today),
    daysThisWeek: thisWeekDays.filter(Boolean).length,
    thisWeekDays,
    totalEntries: realEntries.length,
    postedToday: entryDates.has(today),
  };
}

function isBlankOpenEntry(entry: StreakEntry): boolean {
  return (
    entry.status === "open" &&
    !entry.opening_question &&
    !entry.freeform_started_at
  );
}

function getCurrentStreak(entryDates: Set<string>, today: string): number {
  let date = entryDates.has(today) ? today : addDays(today, -1);
  let streak = 0;

  while (entryDates.has(date)) {
    streak++;
    date = addDays(date, -1);
  }

  return streak;
}

function getWeekStart(date: string): string {
  const d = new Date(`${date}T12:00:00`);
  const day = d.getDay();
  const diff = (day - 1 + 7) % 7;
  d.setDate(d.getDate() - diff);
  return localDate(d);
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + days);
  return localDate(d);
}
