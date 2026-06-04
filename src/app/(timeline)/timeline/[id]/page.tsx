import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/server";
import { requireUserId } from "@/lib/members/auth";
import {
  getEntriesImageGenerationStates,
  getEntriesPhotos,
} from "@/app/(journal)/journal/actions";
import { HistoryList } from "@/components/journal/history-list";
import { ReflectOnEventButton } from "@/components/timeline/reflect-on-event-button";
import { CATEGORY_COLOR, CATEGORY_LABEL } from "@/lib/timeline/config";
import { formatTimelineRange, isUpcoming } from "@/lib/timeline/format";
import { loadTimelineEntryDetail } from "@/lib/timeline/queries";
import { getUserTimezone, localDate } from "@/lib/date-utils";
import type { JournalEntry } from "@/lib/types";

export const dynamic = "force-dynamic";

const ENTRY_COLUMNS =
  "id, entry_date, user_id, status, entry_type, visibility, opening_question, question_type, freeform_started_at, summary, title, pull_quote, quote_attribution, summary_stale, closed_at, created_at, updated_at";

export default async function TimelineEntryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const detail = await loadTimelineEntryDetail(id);
  if (!detail) notFound();
  const { entry, linkedEntryIds } = detail;

  const tz = await getUserTimezone();
  const today = localDate(new Date(), tz);
  const upcoming = isUpcoming(entry, today);
  const color = CATEGORY_COLOR[entry.category];

  // Load the linked reflections (newest first) + their photos, to render with
  // the existing journal feed component.
  const supabase = await createClient();
  const viewerId = await requireUserId(supabase);
  let linkedEntries: Awaited<ReturnType<typeof buildLinkedEntries>> = [];
  if (linkedEntryIds.length > 0) {
    linkedEntries = await buildLinkedEntries(supabase, viewerId, linkedEntryIds);
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-6 pb-24 pt-10">
      <Link
        href="/timeline"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Timeline
      </Link>

      <header className="mt-6">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm text-muted-foreground">
            {formatTimelineRange(entry)}
          </span>
          {upcoming && (
            <span className="rounded-full bg-muted px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Upcoming
            </span>
          )}
        </div>
        <h1 className="mt-1 font-serif text-3xl tracking-tight text-foreground">
          {entry.title}
        </h1>
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
              color.chip
            )}
          >
            {CATEGORY_LABEL[entry.category]}
          </span>
          {entry.location && (
            <span className="inline-flex items-center gap-0.5">
              <MapPin className="h-3.5 w-3.5" />
              {entry.location}
            </span>
          )}
        </div>
        {(entry.subjects.length > 0 || entry.mentions.length > 0) && (
          <p className="mt-3 text-sm text-muted-foreground">
            {entry.subjects.map((s, i) => (
              <span key={s.id}>
                {i > 0 && ", "}
                <span className="font-medium text-foreground">{s.name}</span>
              </span>
            ))}
            {entry.mentions.length > 0 && (
              <>
                {entry.subjects.length > 0 && " · with "}
                {entry.mentions.map((m, i) => (
                  <span key={m.id}>
                    {i > 0 && ", "}
                    {m.name}
                  </span>
                ))}
              </>
            )}
          </p>
        )}
      </header>

      <p className="mt-5 text-lg leading-relaxed text-foreground">
        {entry.description}
      </p>

      <section className="mt-12">
        <div className="mb-6 flex items-center justify-between gap-4">
          <h2 className="font-serif text-sm font-medium uppercase tracking-wider text-muted-foreground">
            Written about
          </h2>
          {linkedEntries.length > 0 && (
            <ReflectOnEventButton timelineEntryId={entry.id} label="Reflect again" />
          )}
        </div>
        {linkedEntries.length > 0 ? (
          <HistoryList entries={linkedEntries} />
        ) : (
          <div className="rounded-xl border border-dashed border-border px-6 py-10 text-center">
            <p className="font-serif italic text-muted-foreground">
              No journal entries about this yet.
            </p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
              Start one and we&apos;ll ask you a few questions about it.
            </p>
            <div className="mt-4 flex justify-center">
              <ReflectOnEventButton timelineEntryId={entry.id} />
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

async function buildLinkedEntries(
  supabase: Awaited<ReturnType<typeof createClient>>,
  viewerId: string,
  linkedEntryIds: string[]
) {
  const { data } = await supabase
    .from("journal_entries")
    .select(ENTRY_COLUMNS)
    .in("id", linkedEntryIds);
  const entries = ((data ?? []) as JournalEntry[]).sort(
    (a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0)
  );

  // Name other members' reflections (the family may write about shared events).
  const authorByUser = new Map<string, string>();
  const others = entries.some((e) => e.user_id !== viewerId);
  if (others) {
    const { data: members } = await supabase
      .from("family_members")
      .select("user_id, name, email");
    for (const m of members ?? []) {
      if (!m.user_id) continue;
      authorByUser.set(
        m.user_id as string,
        (m.name as string | null)?.trim() || (m.email as string) || "Family member"
      );
    }
  }

  const ids = entries.map((e) => e.id);
  const [photosByEntry, imageGenerationByEntry] = await Promise.all([
    getEntriesPhotos(ids),
    getEntriesImageGenerationStates(ids),
  ]);

  return entries.map((e) => ({
    ...e,
    photos: photosByEntry[e.id] ?? [],
    photoGenerationStatus: imageGenerationByEntry[e.id] ?? null,
    authorName: e.user_id !== viewerId ? authorByUser.get(e.user_id) ?? "Family member" : null,
    commenterNames: [],
    authorPhotoUrl: null,
    unread: false,
  }));
}
