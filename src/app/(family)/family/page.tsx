import { HistoryList } from "@/components/journal/history-list";
import { createClient } from "@/lib/supabase/server";
import { requireUserId } from "@/lib/members/auth";
import { FEED_COLUMNS, loadFeedEntries } from "@/lib/journal/feed";
import type { JournalEntry } from "@/lib/types";

export const dynamic = "force-dynamic";

// The Family app: the shared family record. Shows every member's finished
// (closed) family entries, plus your own family entries at every stage — so a
// post you're still writing lives here for you while others only see it once you
// finish it. There is no unified "all my posts" view; your private posts live in
// the Journal app. (RLS already gates other members to closed family rows; the
// `user_id=me OR status=closed` filter narrows that to what belongs in the feed.)
export default async function FamilyPage() {
  const supabase = await createClient();
  const userId = await requireUserId(supabase);

  const { data } = await supabase
    .from("journal_entries")
    .select(FEED_COLUMNS)
    .eq("visibility", "family")
    .or(`user_id.eq.${userId},status.eq.closed`);

  const entries = await loadFeedEntries(
    (data ?? []) as JournalEntry[],
    userId,
    true
  );

  return (
    <div className="mx-auto w-full max-w-2xl px-6 pb-24 pt-12">
      <HistoryList
        entries={entries}
        emptyMessage="Nothing shared with the family yet."
      />
    </div>
  );
}
