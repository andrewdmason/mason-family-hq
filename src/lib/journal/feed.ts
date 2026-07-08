import { createClient } from "@/lib/supabase/server";
import { memberPhotoUrl } from "@/lib/media/member-photo-url";
import { getUnreadFamilyEntryIds } from "@/lib/journal/notifications";
import {
  getEntriesImageGenerationStates,
  getEntriesPhotos,
} from "@/app/(journal)/journal/actions";
import type { JournalEntry } from "@/lib/types";

// The columns every feed (personal Journal and shared Family) selects.
export const FEED_COLUMNS =
  "id, entry_date, user_id, status, entry_type, visibility, opening_question, question_type, freeform_started_at, summary, title, pull_quote, quote_attribution, summary_stale, closed_at, created_at, updated_at";

// An entry ready to render in a feed, with the author byline, photos, comment
// bylines, and unread state folded in.
export type FeedEntry = JournalEntry & {
  photos: Awaited<ReturnType<typeof getEntriesPhotos>>[string];
  photoGenerationStatus: Awaited<
    ReturnType<typeof getEntriesImageGenerationStates>
  >[string] | null;
  authorName: string | null;
  commenterNames: string[];
  authorPhotoUrl: string | null;
  unread: boolean;
};

/**
 * Sort, enrich, and clean a feed's raw entry rows. `showsOthers` is true for the
 * Family app — the only feed that surfaces other members' posts — and drives the
 * author/commenter/unread enrichment that the personal Journal doesn't need.
 * Every card in the Family feed shows its author (your own posts included), so
 * the byline maps to `showsOthers` directly; there is no longer a mixed "All"
 * view that hides the byline on your own rows.
 */
export async function loadFeedEntries(
  rawEntries: JournalEntry[],
  userId: string,
  showsOthers: boolean
): Promise<FeedEntry[]> {
  const supabase = await createClient();

  // Newest-first by entry_date — the date shown in the feed — with created_at
  // breaking ties within a day. Done here to defend against any chained-order
  // quirks in supabase-js.
  const entries = rawEntries.slice().sort((a, b) => {
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

    // Each author's primary profile photo, addressed by a stable same-origin URL
    // (not a baked-in signed URL, which expires and breaks when the feed is
    // served stale from the PWA cache — see src/lib/media/member-photo-url.ts).
    const { data: primaryPhotos } = await supabase
      .from("journal_member_photos")
      .select("member_email")
      .eq("is_primary", true);
    if (primaryPhotos && primaryPhotos.length > 0) {
      const emailsWithPhoto = new Set(
        primaryPhotos.map((p) => (p.member_email as string).toLowerCase())
      );
      for (const [uid, email] of emailByUser) {
        if (emailsWithPhoto.has(email.toLowerCase())) {
          authorPhotoByUser.set(uid, memberPhotoUrl(email));
        }
      }
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

  return (
    entries
      .map((e) => ({
        ...e,
        photos: photosByEntry[e.id] ?? [],
        photoGenerationStatus: imageGenerationByEntry[e.id] ?? null,
        authorName: showsOthers
          ? authorByUser.get(e.user_id) ?? "Family member"
          : null,
        commenterNames: showsOthers ? commenterNamesByEntry.get(e.id) ?? [] : [],
        authorPhotoUrl: showsOthers
          ? authorPhotoByUser.get(e.user_id) ?? null
          : null,
        unread: showsOthers ? unreadEntryIds.has(e.id) : false,
      }))
      // Hide abandoned entries: an open entry never started (no opening question
      // picked, no freeform writing) with nothing attached is a row left behind
      // by visiting /journal/new without writing — not a real entry. (Closed
      // family posts can't match, so this only affects your own open drafts.)
      .filter(
        (e) =>
          !(
            e.status === "open" &&
            !e.opening_question &&
            !e.freeform_started_at &&
            e.photos.length === 0
          )
      )
  );
}
