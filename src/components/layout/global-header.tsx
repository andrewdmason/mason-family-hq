import { Suspense } from "react";
import {
  GlobalHeaderClient,
  GlobalHeaderShell,
} from "@/components/layout/global-header-client";
import { getUserTimezone, localDate } from "@/lib/date-utils";
import { getIsAdult, getIsOwner, requireUserId } from "@/lib/members/auth";
import { getJournalNotifications } from "@/lib/journal/notifications";
import { getTodoNotifications } from "@/lib/todos/notifications";
import {
  getBucksClaimNotifications,
  getBucksRedemptionNotifications,
} from "@/lib/bucks/notifications";
import { balanceFromLedger, loadLedger } from "@/lib/bucks/ledger";
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

/**
 * The global header, shared by every family-wide app (Family, Journal, Timeline,
 * Reader, Settings). It carries the app switcher plus notifications, which are
 * always present, and your journaling streak, which only renders on the journal
 * apps where it applies (see showsStreak in the client). The "New" action is
 * app-specific and lives in each app's own content, not here.
 *
 * The data-bearing part streams in behind Suspense: the streak/notification
 * queries take real time, and the header sits in every layout — without the
 * boundary they'd hold up the first byte of every page, so a cold PWA launch
 * sat on a blank screen until the slowest header query finished. The shell
 * paints immediately; the badges stream in place.
 */
export function GlobalHeader() {
  return (
    <Suspense fallback={<GlobalHeaderShell />}>
      <GlobalHeaderData />
    </Suspense>
  );
}

async function GlobalHeaderData() {
  const supabase = await createClient();
  const userId = await requireUserId(supabase);

  const [
    streak,
    journalNotifications,
    todoItems,
    bucksClaimItems,
    bucksRedemptionItems,
    isOwner,
    isAdult,
    ledger,
  ] = await Promise.all([
    getJournalStreakStats(supabase, userId),
    getJournalNotifications(supabase, userId),
    getTodoNotifications(supabase, userId).catch(() => []),
    getBucksClaimNotifications(supabase).catch(() => []),
    getBucksRedemptionNotifications(supabase).catch(() => []),
    getIsOwner(supabase),
    getIsAdult(supabase),
    loadLedger(supabase, userId).catch(() => []),
  ]);

  // Kids carry their Mason Bucks balance in the header; adults don't have a wallet.
  const bucksBalance = isAdult ? null : balanceFromLedger(ledger);

  // Todo tasks and Mason Bucks approvals ride in the same bell. (Reading reward
  // milestones were retired in favor of Mason Bucks prizes.)
  const bucksItems = [...bucksClaimItems, ...bucksRedemptionItems];
  const notifications = {
    count: journalNotifications.count + todoItems.length + bucksItems.length,
    items: [...bucksItems, ...todoItems, ...journalNotifications.items],
  };

  return (
    <GlobalHeaderClient
      streak={streak}
      notifications={notifications}
      isOwner={isOwner}
      bucksBalance={bucksBalance}
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
