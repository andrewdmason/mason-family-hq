import { createClient } from "@/lib/supabase/server";
import { getEntriesPhotos } from "@/app/(journal)/journal/actions";
import type {
  TimelineEntry,
  TimelineEntryWithPeople,
  TimelinePerson,
  TimelinePersonRole,
} from "@/lib/types";

const ENTRY_COLUMNS =
  "id, title, description, category, prominence, location, start_date, start_precision, end_date, end_precision, approximate, created_at, updated_at";

type RawRow = TimelineEntry & {
  timeline_entry_people: { role: TimelinePersonRole; people: TimelinePerson | null }[];
};

export type TimelineView = "mine" | "family";

/** Split the embedded people join into subjects and mentions. */
function shape(row: RawRow): Omit<TimelineEntryWithPeople, "linkedCount" | "coverPhotoUrl"> {
  const subjects: TimelinePerson[] = [];
  const mentions: TimelinePerson[] = [];
  for (const tep of row.timeline_entry_people ?? []) {
    if (!tep.people) continue;
    (tep.role === "subject" ? subjects : mentions).push(tep.people);
  }
  const { timeline_entry_people: _omit, ...entry } = row;
  void _omit;
  return { ...entry, subjects, mentions };
}

/**
 * Map each timeline entry id to the ids of journal entries that link to it. RLS
 * already scopes journal_entries to what the viewer can see (their own +
 * family-visible closed posts). Pass `ownerUserId` to keep only that user's own
 * reflections (used for the prompt's "[elaborated]" flag, where another member's
 * post about the same event shouldn't suppress the question for you).
 */
async function linkedJournalIds(
  entryIds: string[],
  ownerUserId?: string
): Promise<Map<string, string[]>> {
  const byEntry = new Map<string, string[]>();
  if (entryIds.length === 0) return byEntry;
  const supabase = await createClient();
  let query = supabase
    .from("journal_entries")
    .select("id, timeline_entry_id, created_at")
    .in("timeline_entry_id", entryIds)
    .order("created_at", { ascending: false });
  if (ownerUserId) query = query.eq("user_id", ownerUserId);
  const { data, error } = await query;
  if (error) throw error;
  for (const row of (data ?? []) as { id: string; timeline_entry_id: string | null }[]) {
    if (!row.timeline_entry_id) continue;
    const arr = byEntry.get(row.timeline_entry_id) ?? [];
    arr.push(row.id);
    byEntry.set(row.timeline_entry_id, arr);
  }
  return byEntry;
}

/**
 * Signed primary-avatar URL per family member email. The member-photos bucket is
 * family-readable, so this signs for any member (no owner-admin needed).
 */
async function memberAvatarUrls(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const supabase = await createClient();
  const { data } = await supabase
    .from("journal_member_photos")
    .select("member_email, storage_path")
    .eq("is_primary", true);
  if (!data?.length) return map;
  const { data: signed } = await supabase.storage
    .from("member-photos")
    .createSignedUrls(
      data.map((d) => d.storage_path as string),
      60 * 60
    );
  data.forEach((d, i) => {
    const url = signed?.[i]?.signedUrl;
    if (url) map.set((d.member_email as string).toLowerCase(), url);
  });
  return map;
}

function withAvatars(people: TimelinePerson[], avatars: Map<string, string>): TimelinePerson[] {
  return people.map((p) => ({
    ...p,
    avatarUrl: p.member_email ? avatars.get(p.member_email.toLowerCase()) ?? null : null,
  }));
}

async function fetchEntries(): Promise<{ rows: RawRow[]; email: string | null; userId: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from("timeline_entries")
    .select(`${ENTRY_COLUMNS}, timeline_entry_people(role, people(id, name, member_email))`)
    .order("start_date", { ascending: true });
  if (error) throw error;
  return {
    // PostgREST returns the to-one `people` relation as a single object at
    // runtime, but types it as an array; cast through unknown.
    rows: (data ?? []) as unknown as RawRow[],
    email: user?.email?.toLowerCase() ?? null,
    userId: user?.id ?? null,
  };
}

/**
 * Load the timeline for rendering.
 *
 * "mine"   — events where the viewer is a subject (resolved member_email ->
 *            family_members.email -> the viewer's auth email).
 * "family" — every event (each is one canonical row, so shared events appear
 *            once, no dedup needed).
 *
 * `ownLinksOnly` makes linkedCount count only the viewer's own reflections
 * (for the prompt); by default it counts everything the viewer can see.
 * `withCovers` additionally resolves a representative photo per entry (for the
 * visualization); skip it for the prompt path, which doesn't need images.
 */
export async function loadTimeline(
  view: TimelineView,
  { ownLinksOnly = false, withCovers = false }: { ownLinksOnly?: boolean; withCovers?: boolean } = {}
): Promise<TimelineEntryWithPeople[]> {
  const { rows, email, userId } = await fetchEntries();
  let entries = rows.map(shape);
  if (view === "mine") {
    entries = email
      ? entries.filter((e) => e.subjects.some((s) => s.member_email?.toLowerCase() === email))
      : [];
  }

  const linked = await linkedJournalIds(
    entries.map((e) => e.id),
    ownLinksOnly && userId ? userId : undefined
  );

  // A representative photo per entry: the first photo on its newest linked entry
  // that has one. getEntriesPhotos handles signing (and the owner-sees-all path).
  // Avatars come along for the rendering path so cards can show whose event it is.
  const coverByEntry = new Map<string, string>();
  let avatars = new Map<string, string>();
  if (withCovers) {
    const [photos, avatarMap] = await Promise.all([
      getEntriesPhotos([...new Set([...linked.values()].flat())]),
      memberAvatarUrls(),
    ]);
    avatars = avatarMap;
    for (const [entryId, journalIds] of linked) {
      for (const jid of journalIds) {
        const url = photos[jid]?.[0]?.displayUrl;
        if (url) {
          coverByEntry.set(entryId, url);
          break;
        }
      }
    }
  }

  return entries.map((e) => ({
    ...e,
    subjects: withCovers ? withAvatars(e.subjects, avatars) : e.subjects,
    mentions: withCovers ? withAvatars(e.mentions, avatars) : e.mentions,
    linkedCount: linked.get(e.id)?.length ?? 0,
    coverPhotoUrl: coverByEntry.get(e.id) ?? null,
  }));
}

/**
 * One entry with its people, for grounding a forced reminiscence question about
 * it. No covers/avatars/linked work — just what withTimelineSource needs. Loaded
 * by id (not the viewer's "mine" set) so you can reflect on any visible event,
 * including a family member's.
 */
export async function loadTimelineEntryById(
  id: string
): Promise<TimelineEntryWithPeople | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("timeline_entries")
    .select(`${ENTRY_COLUMNS}, timeline_entry_people(role, people(id, name, member_email))`)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return { ...shape(data as unknown as RawRow), linkedCount: 0, coverPhotoUrl: null };
}

/**
 * One entry plus its people and the ids of journal entries (visible to the
 * viewer) that elaborate it, newest first. The detail page loads those full
 * entries + photos via the existing journal helpers.
 */
export async function loadTimelineEntryDetail(
  id: string
): Promise<{ entry: TimelineEntryWithPeople; linkedEntryIds: string[] } | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("timeline_entries")
    .select(`${ENTRY_COLUMNS}, timeline_entry_people(role, people(id, name, member_email))`)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const { data: linked, error: linkErr } = await supabase
    .from("journal_entries")
    .select("id, created_at")
    .eq("timeline_entry_id", id)
    .order("created_at", { ascending: false });
  if (linkErr) throw linkErr;

  const linkedEntryIds = (linked ?? []).map((r) => (r as { id: string }).id);
  const shaped = shape(data as unknown as RawRow);
  return {
    // The detail page renders photos via the linked entries themselves, so the
    // entry-level cover isn't needed here.
    entry: { ...shaped, linkedCount: linkedEntryIds.length, coverPhotoUrl: null },
    linkedEntryIds,
  };
}
