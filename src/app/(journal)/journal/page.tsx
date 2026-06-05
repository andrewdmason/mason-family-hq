import { HistoryList } from "@/components/journal/history-list";
import { JournalListDropZone } from "@/components/journal/journal-list-drop-zone";
import { createClient } from "@/lib/supabase/server";
import { requireUserId } from "@/lib/members/auth";
import { FEED_COLUMNS, loadFeedEntries } from "@/lib/journal/feed";
import type { JournalEntry } from "@/lib/types";

export const dynamic = "force-dynamic";

// The personal Journal: only your own private entries, at every stage. Posts you
// publish to the family live in the Family app, not here — there is no unified
// "all" view. (The entries SELECT policy is "own rows OR visibility='family'";
// the user_id + visibility filters keep this to just your private rows.)
export default async function JournalPage() {
  const supabase = await createClient();
  const userId = await requireUserId(supabase);

  const { data } = await supabase
    .from("journal_entries")
    .select(FEED_COLUMNS)
    .eq("user_id", userId)
    .eq("visibility", "private");

  const entries = await loadFeedEntries(
    (data ?? []) as JournalEntry[],
    userId,
    false
  );

  return (
    <div className="mx-auto w-full max-w-2xl px-6 pb-24 pt-12">
      <JournalListDropZone />
      <HistoryList entries={entries} emptyMessage="No entries yet." />
    </div>
  );
}
