import type { createClient } from "@/lib/supabase/server";
import type { JournalNotification, JournalNotifications } from "@/lib/types";
import { typeLabel } from "@/lib/journal/candidates";
import { getUserTimezone, localDate } from "@/lib/date-utils";

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

type NotifEntry = {
  id: string;
  user_id: string;
  entry_date: string;
  title: string | null;
  pull_quote: string | null;
  summary: string | null;
  created_at: string;
};

type UnreadEntry = {
  entry: NotifEntry;
  isNewPost: boolean;
  unreadComments: number;
};

/**
 * The family posts that are unread for `userId`, newest first — either because
 * the post itself is new (someone else shared it and they've never opened it)
 * or because someone else has commented since they last viewed it.
 *
 * State lives in journal_entry_views (last_viewed_at per user/entry); opening a
 * post's page upserts that timestamp, which clears the unread status. A later
 * comment re-triggers it because its created_at is newer than the view again.
 *
 * Recomputed on each render — no realtime. Family scale is tiny, so the
 * unbounded scan over family entries and their comments is fine. Shared by the
 * header badge (getJournalNotifications) and the Family feed's per-post
 * indicator (getUnreadFamilyEntryIds) so the two never disagree.
 */
async function loadUnreadFamilyEntries(
  supabase: SupabaseClient,
  userId: string
): Promise<UnreadEntry[]> {
  // Every member's finished, shared posts — the same seam the Family feed uses.
  // RLS returns all of these (own rows OR visibility='family').
  const { data: entryRows } = await supabase
    .from("journal_entries")
    .select("id, user_id, entry_date, title, pull_quote, summary, created_at")
    .eq("visibility", "family")
    .eq("status", "closed");
  const entries = (entryRows ?? []) as NotifEntry[];
  if (entries.length === 0) return [];

  const entryIds = entries.map((e) => e.id);

  const [{ data: viewRows }, { data: commentRows }] = await Promise.all([
    supabase
      .from("journal_entry_views")
      .select("entry_id, last_viewed_at")
      .eq("user_id", userId)
      .in("entry_id", entryIds),
    supabase
      .from("journal_inline_comments")
      .select("entry_id, user_id, created_at")
      .in("entry_id", entryIds),
  ]);

  const lastViewedByEntry = new Map<string, string>();
  for (const v of viewRows ?? []) {
    lastViewedByEntry.set(v.entry_id as string, v.last_viewed_at as string);
  }

  // Count comments by someone other than the viewer that landed after their
  // last view of the post (all of them, if they've never viewed it).
  const unreadCommentsByEntry = new Map<string, number>();
  for (const c of commentRows ?? []) {
    const eid = c.entry_id as string;
    if ((c.user_id as string) === userId) continue;
    const lastViewed = lastViewedByEntry.get(eid);
    if (lastViewed && (c.created_at as string) <= lastViewed) continue;
    unreadCommentsByEntry.set(eid, (unreadCommentsByEntry.get(eid) ?? 0) + 1);
  }

  return entries
    .map((e) => {
      // The post itself is new only when it's someone else's and unseen — your
      // own posts are never "new" to you, but their comments still count.
      const isNewPost = e.user_id !== userId && !lastViewedByEntry.has(e.id);
      const unreadComments = unreadCommentsByEntry.get(e.id) ?? 0;
      return { entry: e, isNewPost, unreadComments };
    })
    .filter((u) => u.isNewPost || u.unreadComments > 0)
    // Newest first by entry_date, created_at breaking ties — mirrors the feed.
    .sort((a, b) => {
      if (a.entry.entry_date !== b.entry.entry_date) {
        return a.entry.entry_date < b.entry.entry_date ? 1 : -1;
      }
      return a.entry.created_at < b.entry.created_at ? 1 : -1;
    });
}

/**
 * The header notification badge for `userId`: the unread family posts as a
 * count and a list. A post appears at most once regardless of how many reasons
 * apply, so the count is simply the number of such posts.
 */
export async function getJournalNotifications(
  supabase: SupabaseClient,
  userId: string
): Promise<JournalNotifications> {
  const [due, unread] = await Promise.all([
    getRecurringDueNotifications(supabase, userId),
    loadUnreadFamilyEntries(supabase, userId),
  ]);

  const familyItems: JournalNotification[] = unread.map(
    ({ entry, isNewPost, unreadComments }) => ({
      id: entry.id,
      title: displayTitle(entry),
      reason: isNewPost
        ? "New post"
        : `${unreadComments} new comment${unreadComments === 1 ? "" : "s"}`,
      href: `/journal/${entry.id}`,
    })
  );

  // Due nudges sit on top of unread-family posts.
  const items = [...due, ...familyItems];
  return { count: items.length, items };
}

type RecurringType = {
  name: string;
  recurrence_days: number;
};

/**
 * Persistent "you're due" nudges for the user's recurring posts. A recurring
 * type is due when it has no closed entry of its kind yet, or its newest one is
 * at least `recurrence_days` old (a rolling interval). Computed on render like
 * the rest of the badge — it clears the moment a post of that type is made, and
 * needs no background job. Clicking takes the user straight into the new-post
 * flow for that type (`/journal/new?type=<name>`).
 */
export async function getRecurringDueNotifications(
  supabase: SupabaseClient,
  userId: string
): Promise<JournalNotification[]> {
  const { data: typeRows } = await supabase
    .from("journal_question_types")
    .select("name, recurrence_days")
    .eq("user_id", userId)
    .not("recurrence_days", "is", null);
  const types = (typeRows ?? []).filter(
    (t): t is RecurringType =>
      typeof t.name === "string" && typeof t.recurrence_days === "number"
  );
  if (types.length === 0) return [];

  const names = types.map((t) => t.name);
  const { data: entryRows } = await supabase
    .from("journal_entries")
    .select("question_type, entry_date")
    .eq("user_id", userId)
    .eq("status", "closed")
    .in("question_type", names)
    .order("entry_date", { ascending: false });

  // Newest closed entry_date per recurring type.
  const lastDateByType = new Map<string, string>();
  for (const row of entryRows ?? []) {
    const type = row.question_type as string;
    if (!lastDateByType.has(type)) {
      lastDateByType.set(type, row.entry_date as string);
    }
  }

  const today = localDate(new Date(), await getUserTimezone());

  // Each due type with how overdue it is, so the most overdue sorts first.
  const due: { item: JournalNotification; overdueBy: number }[] = [];
  for (const type of types) {
    const last = lastDateByType.get(type.name);
    const daysSince = last === undefined ? null : daysBetween(last, today);
    const overdue = daysSince === null || daysSince >= type.recurrence_days;
    if (!overdue) continue;

    const reason =
      daysSince === null
        ? "Never posted"
        : `Due — last posted ${daysSince} day${daysSince === 1 ? "" : "s"} ago`;
    due.push({
      item: {
        id: `recurring:${type.name}`,
        title: typeLabel(type.name) ?? type.name,
        reason,
        href: `/journal/new?type=${encodeURIComponent(type.name)}`,
      },
      overdueBy: daysSince === null ? Infinity : daysSince - type.recurrence_days,
    });
  }

  return due.sort((a, b) => b.overdueBy - a.overdueBy).map((d) => d.item);
}

/** Whole days from `from` (YYYY-MM-DD) to `to` (YYYY-MM-DD), never negative. */
function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.max(0, Math.round((b - a) / 86400000));
}

/**
 * The set of family entry ids that are unread for `userId`, used to mark posts
 * in the Family feed. Same unread definition as the header badge.
 */
export async function getUnreadFamilyEntryIds(
  supabase: SupabaseClient,
  userId: string
): Promise<Set<string>> {
  const unread = await loadUnreadFamilyEntries(supabase, userId);
  return new Set(unread.map((u) => u.entry.id));
}

function displayTitle(entry: NotifEntry): string {
  return (
    entry.title?.trim() ||
    entry.pull_quote?.trim() ||
    entry.summary?.trim() ||
    "Untitled"
  );
}
