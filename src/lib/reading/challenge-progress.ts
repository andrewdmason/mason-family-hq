import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays, getWeekStart } from "@/lib/date-utils";
import type {
  ChallengeWeek,
  ReadingChallenge,
  ReadingChallengeProgress,
} from "@/lib/types";

type Checkin = { on: string; page: number };

/**
 * A book's check-in series sorted ascending by date, plus its live current page.
 * Progress is derived from check-ins (the same source as the weekly home math in
 * getReadingHome), generalized from "this week" to the challenge's whole window.
 */
type BookSeries = { currentPage: number; checkins: Checkin[] };

/** Page at the most recent check-in on or before `date`, or null if none. */
function posOnOrBefore(checkins: Checkin[], date: string): number | null {
  let page: number | null = null;
  for (const c of checkins) {
    if (c.on <= date) page = c.page;
    else break;
  }
  return page;
}

/** Page at the most recent check-in strictly before `date`, or null if none. */
function posBefore(checkins: Checkin[], date: string): number | null {
  let page: number | null = null;
  for (const c of checkins) {
    if (c.on < date) page = c.page;
    else break;
  }
  return page;
}

/** Whole days from `from` to `to` (negative if `to` is before `from`). */
function daysBetween(from: string, to: string): number {
  const a = new Date(`${from}T12:00:00`).getTime();
  const b = new Date(`${to}T12:00:00`).getTime();
  return Math.round((b - a) / 86_400_000);
}

/**
 * Pages a book contributed across [start, endValueDate]. Baseline is the page
 * entering the window (its latest check-in before `start`), or — for a book first
 * checked in during the window — that first check-in's page (its floor, so the
 * first check-in itself reads as 0, exactly like getReadingHome). `endPage` is the
 * live page to measure up to (current_page while the window is open).
 */
function pagesInWindow(
  series: BookSeries,
  start: string,
  windowEnd: string,
  liveEndPage: number,
  useLive: boolean,
): number {
  const { checkins } = series;
  if (checkins.length === 0) return 0;

  const first = checkins[0];
  // The book is only in this window if its earliest check-in lands on/before the end.
  if (first.on > windowEnd) return 0;

  const baseline = posBefore(checkins, start) ?? first.page;
  const endPage = useLive ? liveEndPage : posOnOrBefore(checkins, windowEnd) ?? baseline;
  return Math.max(0, endPage - baseline);
}

/**
 * Derive a challenge's progress from the kid's reading check-ins: total pages in
 * the window, a per-week breakdown vs. their weekly baseline, batting-cage tokens,
 * and days remaining. `client`/`userId` come from resolveReadingScope, so this
 * works for a kid viewing their own and a parent viewing a kid's.
 */
export async function computeChallengeProgress(
  client: SupabaseClient,
  userId: string,
  challenge: ReadingChallenge,
  weeklyBaseline: number,
  today: string,
): Promise<ReadingChallengeProgress> {
  const { start_date: start, end_date: end } = challenge;

  const { data: bookRows } = await client
    .from("reading_books")
    .select("id, current_page")
    .eq("user_id", userId);
  const books = (bookRows ?? []) as { id: string; current_page: number }[];
  const bookIds = books.map((b) => b.id);

  const series = new Map<string, BookSeries>();
  for (const b of books) {
    series.set(b.id, { currentPage: b.current_page ?? 0, checkins: [] });
  }

  if (bookIds.length > 0) {
    const { data: checkinRows } = await client
      .from("reading_checkins")
      .select("book_id, page, checked_on")
      .eq("user_id", userId)
      .in("book_id", bookIds);
    for (const c of checkinRows ?? []) {
      series
        .get(c.book_id as string)
        ?.checkins.push({ on: c.checked_on as string, page: c.page as number });
    }
    for (const s of series.values()) {
      s.checkins.sort((a, b) => (a.on < b.on ? -1 : a.on > b.on ? 1 : 0));
    }
  }

  // The window is "live" (measure to current_page) up to today; once it's over,
  // measure to the check-in position at the end date.
  const windowOpen = today <= end;
  const totalEnd = windowOpen ? today : end;

  let totalPages = 0;
  for (const s of series.values()) {
    totalPages += pagesInWindow(s, start, totalEnd, s.currentPage, windowOpen);
  }

  // Per-week breakdown across Mon–Sun weeks spanning the window.
  const weeks: ChallengeWeek[] = [];
  let cursor = getWeekStart(start);
  let index = 1;
  while (cursor <= end) {
    const fullWeekEnd = addDays(cursor, 6);
    const weekEnd = fullWeekEnd < end ? fullWeekEnd : end;
    const isCurrent = today >= cursor && today <= fullWeekEnd;
    const isFuture = cursor > today;

    let pages = 0;
    if (!isFuture) {
      const measureEnd = isCurrent ? today : weekEnd;
      for (const s of series.values()) {
        pages += pagesInWindow(s, cursor, measureEnd, s.currentPage, isCurrent);
      }
    }

    weeks.push({
      weekStart: cursor,
      weekEnd,
      index,
      pages,
      beatBaseline: weeklyBaseline > 0 && !isFuture && pages >= weeklyBaseline,
      isCurrent,
      isFuture,
    });
    cursor = addDays(cursor, 7);
    index += 1;
  }

  const percent =
    challenge.page_goal > 0
      ? Math.min(100, Math.round((totalPages / challenge.page_goal) * 100))
      : 0;
  const tokens =
    challenge.pages_per_token > 0
      ? Math.floor(totalPages / challenge.pages_per_token)
      : 0;
  const daysRemaining = Math.max(0, daysBetween(today, end));

  return {
    challenge,
    totalPages,
    percent,
    tokens,
    weeklyBaseline,
    weeks,
    daysRemaining,
  };
}
