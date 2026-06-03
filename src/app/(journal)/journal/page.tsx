import { HistoryList } from "@/components/journal/history-list";
import { JournalFeedToggle, type JournalFeed } from "@/components/journal/feed-toggle";
import { JournalListDropZone } from "@/components/journal/journal-list-drop-zone";
import { createClient } from "@/lib/supabase/server";
import { requireUserId } from "@/lib/members/auth";
import { getUnreadFamilyEntryIds } from "@/lib/journal/notifications";
import {
  getEntriesImageGenerationStates,
  getEntriesPhotos,
} from "@/app/(journal)/journal/actions";
import type { JournalEntry } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function JournalPage({
  searchParams,
}: {
  searchParams: Promise<{ feed?: string }>;
}) {
  const { feed } = await searchParams;
  const mode: JournalFeed =
    feed === "me" ? "me" : feed === "family" ? "family" : "all";
  const isFamily = mode === "family";
  // Feeds that surface *other* members' posts (Family and All) need the author
  // enrichment — names, photos, comment bylines, unread state.
  const showsOthers = mode !== "me";

  const supabase = await createClient();
  const userId = await requireUserId(supabase);

  const columns =
    "id, entry_date, user_id, status, entry_type, visibility, opening_question, freeform_started_at, summary, title, pull_quote, quote_attribution, summary_stale, closed_at, created_at, updated_at";

  // The entries SELECT policy is "own rows OR visibility = 'family'".
  // Me: the caller's own entries (private + family); the user_id filter keeps
  // out other members' shared rows the policy would otherwise allow.
  // Family: every member's closed, family-shared entries.
  // All: the caller's own rows (any status/visibility) plus every member's
  // closed, family-shared rows — one OR query; a row matching both arms is
  // still returned once, so no dedupe is needed.
  let query = supabase.from("journal_entries").select(columns);
  if (mode === "me") {
    query = query.eq("user_id", userId);
  } else if (mode === "family") {
    query = query.eq("visibility", "family").eq("status", "closed");
  } else {
    query = query.or(
      `user_id.eq.${userId},and(visibility.eq.family,status.eq.closed)`
    );
  }
  const { data } = await query;

  // Newest-first by entry_date — the date shown in the feed — with created_at
  // breaking ties within a day. Done client-side to defend against any
  // chained-order quirks in supabase-js.
  const entries = ((data ?? []) as JournalEntry[]).sort((a, b) => {
    if (a.entry_date !== b.entry_date) return a.entry_date < b.entry_date ? 1 : -1;
    return a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0;
  });

  // Author names and avatars for the Family feed (own rows can read every
  // member's name and photos via RLS now). Keyed by user_id; name falls back to
  // email, then a generic label.
  const authorByUser = new Map<string, string>();
  const authorPhotoByUser = new Map<string, string>();
  if (showsOthers && entries.length > 0) {
    const { data: members } = await supabase
      .from("family_members")
      .select("user_id, name, email");
    const emailByUser = new Map<string, string>();
    for (const m of members ?? []) {
      if (!m.user_id) continue;
      authorByUser.set(
        m.user_id as string,
        (m.name as string | null)?.trim() || (m.email as string) || "Family member"
      );
      emailByUser.set(m.user_id as string, m.email as string);
    }

    // Each author's primary profile photo, signed for display.
    const { data: primaryPhotos } = await supabase
      .from("journal_member_photos")
      .select("member_email, storage_path")
      .eq("is_primary", true);
    if (primaryPhotos && primaryPhotos.length > 0) {
      const pathByEmail = new Map<string, string>();
      for (const p of primaryPhotos) {
        pathByEmail.set(p.member_email as string, p.storage_path as string);
      }
      const userEmailPairs = [...emailByUser.entries()].filter(([, email]) =>
        pathByEmail.has(email)
      );
      const paths = userEmailPairs.map(([, email]) => pathByEmail.get(email)!);
      const { data: signed } = await supabase.storage
        .from("member-photos")
        .createSignedUrls(paths, 60 * 60);
      userEmailPairs.forEach(([userId], i) => {
        const url = signed?.[i]?.signedUrl;
        if (url) authorPhotoByUser.set(userId, url);
      });
    }
  }

  const entryIds = entries.map((e) => e.id);

  // Commenters per family entry, for the byline ("… with comments from Jenny").
  // One batched query over the visible entries; distinct commenters excluding
  // the post's author, in the order they first commented.
  const commenterNamesByEntry = new Map<string, string[]>();
  if (showsOthers && entryIds.length > 0) {
    const authorIdByEntry = new Map(entries.map((e) => [e.id, e.user_id]));
    const { data: commentRows } = await supabase
      .from("journal_inline_comments")
      .select("entry_id, user_id, created_at")
      .in("entry_id", entryIds)
      .order("created_at", { ascending: true });
    const seenByEntry = new Map<string, Set<string>>();
    for (const c of commentRows ?? []) {
      const eid = c.entry_id as string;
      const uid = c.user_id as string;
      if (uid === authorIdByEntry.get(eid)) continue;
      let seen = seenByEntry.get(eid);
      if (!seen) {
        seen = new Set<string>();
        seenByEntry.set(eid, seen);
      }
      if (seen.has(uid)) continue;
      seen.add(uid);
      const names = commenterNamesByEntry.get(eid) ?? [];
      names.push(authorByUser.get(uid) ?? "Family member");
      commenterNamesByEntry.set(eid, names);
    }
  }

  // Which family posts are unread for the caller — same definition as the
  // header notification badge (new post, or new comments since last view).
  const unreadEntryIds = showsOthers
    ? await getUnreadFamilyEntryIds(supabase, userId)
    : new Set<string>();

  const [photosByEntry, imageGenerationByEntry] = await Promise.all([
    getEntriesPhotos(entryIds),
    getEntriesImageGenerationStates(entryIds),
  ]);
  const entriesWithPhotos = entries
    .map((e) => {
      // In All, the byline/avatar/unread dot belong on *other* members' posts,
      // not the caller's own — own posts read like the Me feed. Family shows
      // them on every card.
      const showsAuthor = isFamily || (mode === "all" && e.user_id !== userId);
      return {
        ...e,
        photos: photosByEntry[e.id] ?? [],
        photoGenerationStatus: imageGenerationByEntry[e.id] ?? null,
        authorName: showsAuthor
          ? authorByUser.get(e.user_id) ?? "Family member"
          : null,
        commenterNames: showsAuthor ? commenterNamesByEntry.get(e.id) ?? [] : [],
        authorPhotoUrl: showsAuthor
          ? authorPhotoByUser.get(e.user_id) ?? null
          : null,
        unread: showsAuthor ? unreadEntryIds.has(e.id) : false,
      };
    })
    // Hide abandoned entries: an open entry never started (no opening question
    // picked, no freeform writing) with nothing attached is a row left behind
    // by visiting /journal/new without writing — not a real entry. (Family
    // entries are all closed, so this only affects Mine.)
    .filter(
      (e) =>
        !(
          e.status === "open" &&
          !e.opening_question &&
          !e.freeform_started_at &&
          e.photos.length === 0
        )
    );

  return (
    <div className="mx-auto w-full max-w-2xl px-6 pb-24 pt-12">
      <JournalListDropZone />
      <div className="mb-8">
        <JournalFeedToggle feed={mode} />
      </div>
      <HistoryList
        entries={entriesWithPhotos}
        emptyMessage={
          isFamily ? "Nothing shared with the family yet." : "No entries yet."
        }
      />
    </div>
  );
}
