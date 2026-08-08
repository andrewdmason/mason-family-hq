import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serializeTimelineForPrompt } from "@/lib/timeline/serialize";
import type { TimelineEntryWithPeople, TimelinePerson, TimelinePersonRole } from "@/lib/types";

/**
 * Who the reader is, as the journal already knows them.
 *
 * The reader used to know a person only by what they had finished and who had
 * recommended the book in front of them, which is almost nothing — and an
 * interviewer with almost nothing to go on retreats to offering menus ("was it
 * X, or Y?"), because a menu is a guess that cannot be wrong. This is the
 * material that lets it make a claim instead. Asked point-blank "do you know who
 * Jenny is?", the preface interview used to answer no; now it does.
 *
 * Three sources, all of them small, hand-authored and slow to change — which is
 * why they can sit in the cached half of a prompt that carries a whole novel.
 * Journal ENTRIES are deliberately not here: they are large, different every
 * day, and would re-bill the book behind them on every chat turn. The Present
 * doc says in a line what a year of entries implies, which is what it is for.
 */

/**
 * Why this does not call the journal's own loaders.
 *
 * loadAgentFiles, loadFamilyDoc and loadTimelineBlock each build their own
 * RLS-scoped client and resolve to whoever is signed in. That is right in the
 * journal, where the reader of a page is always its subject, and wrong here: a
 * parent can open a kid's book, and in member mode the reading scope hands back
 * a service-role client and the KID's id. Called there, those loaders would
 * quietly splice the parent's life into the kid's preface — a bug with no error
 * and no symptom except a document that sounds like the wrong person.
 *
 * So everything below takes the client, the id and the email explicitly, and
 * filters on them. The user_id filters are not belt-and-braces: in member mode
 * the admin client bypasses RLS entirely, and without them this returns whatever
 * row happens to come first.
 */
export type ReaderProfile = {
  /** The shared family doc: who is around this person. Owner-authored. */
  family: string | null;
  /** Their own Present doc: their life now, the people in it, what they're doing. */
  present: string | null;
  /** Their life as dated events, already compacted, or null if they have none. */
  timeline: string | null;
};

/** True when there is nothing to say — so callers can skip the block entirely. */
export function isReaderProfileEmpty(profile: ReaderProfile): boolean {
  return !profile.family && !profile.present && !profile.timeline;
}

type TimelineRow = {
  id: string;
  title: string;
  description: string;
  category: TimelineEntryWithPeople["category"];
  prominence: TimelineEntryWithPeople["prominence"];
  location: string | null;
  start_date: string;
  start_precision: TimelineEntryWithPeople["start_precision"];
  end_date: string | null;
  end_precision: TimelineEntryWithPeople["end_precision"];
  approximate: boolean;
  created_at: string;
  updated_at: string;
  timeline_entry_people: { role: TimelinePersonRole; people: TimelinePerson | null }[];
};

/**
 * The reader's own life events, in the same compact vocabulary the journal's
 * interviewer reads.
 *
 * Every event is one canonical row shared by everyone it happened to, so "mine"
 * means the ones this person is a SUBJECT of — being mentioned in someone else's
 * event is not your life. Filtered in JS rather than in the query because the
 * subject lives two joins away and the whole table is a few hundred rows.
 *
 * linkedCount is fixed at zero on purpose. In the journal it drives an
 * "[elaborated]" flag meaning "don't re-ask about this one", which is a fact
 * about the journal's own questions and means nothing to a book.
 */
async function loadTimelineBlock(
  client: SupabaseClient,
  email: string | null,
  today: string
): Promise<string | null> {
  if (!email) return null;

  const { data } = await client
    .from("timeline_entries")
    .select(
      "id, title, description, category, prominence, location, start_date, start_precision, end_date, end_precision, approximate, created_at, updated_at, timeline_entry_people(role, people(id, name, member_email))"
    )
    .order("start_date", { ascending: true });

  // PostgREST returns the to-one `people` relation as an object at runtime but
  // types it as an array; cast through unknown, as the timeline's own queries do.
  const rows = (data ?? []) as unknown as TimelineRow[];
  const wanted = email.toLowerCase();

  const entries: TimelineEntryWithPeople[] = [];
  for (const row of rows) {
    const subjects: TimelinePerson[] = [];
    const mentions: TimelinePerson[] = [];
    for (const link of row.timeline_entry_people ?? []) {
      if (!link.people) continue;
      (link.role === "subject" ? subjects : mentions).push(link.people);
    }
    if (!subjects.some((s) => s.member_email?.toLowerCase() === wanted)) continue;

    const { timeline_entry_people: _people, ...entry } = row;
    void _people;
    entries.push({
      ...entry,
      subjects,
      mentions,
      linkedCount: 0,
      linkedPosts: [],
      photos: [],
      coverPhotoUrl: null,
      coverVideoUrl: null,
    });
  }

  if (entries.length === 0) return null;
  const block = serializeTimelineForPrompt(entries, today).trim();
  return block.length > 0 ? block : null;
}

/**
 * Gather everything the reader's prompts know about the person reading.
 *
 * Never throws and never blocks a chat: a journal the family hasn't filled in
 * yet is the ordinary case, and a book conversation that failed because a
 * profile doc was missing would be a strictly worse product than one that simply
 * knows less. Every field is independently nullable for the same reason.
 */
export async function gatherReaderProfile(
  client: SupabaseClient,
  userId: string,
  email: string | null,
  today: string
): Promise<ReaderProfile> {
  const [familyResult, presentResult, timeline] = await Promise.all([
    client.from("journal_family").select("content").maybeSingle(),
    client
      .from("journal_agent_files")
      .select("content")
      .eq("user_id", userId)
      .eq("name", "Present")
      .maybeSingle(),
    loadTimelineBlock(client, email, today).catch(() => null),
  ]);

  const clean = (value: unknown): string | null => {
    const text = ((value as string | null) ?? "").trim();
    return text.length > 0 ? text : null;
  };

  return {
    family: clean(familyResult.data?.content),
    present: clean(presentResult.data?.content),
    timeline,
  };
}
