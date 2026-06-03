import { getUserTimezone, localDate } from "@/lib/date-utils";
import { loadTimeline } from "@/lib/timeline/queries";
import { VerticalTimeline } from "@/components/timeline/vertical-timeline";
import { TimelineViewToggle } from "@/components/timeline/timeline-view-toggle";

export const dynamic = "force-dynamic";

export default async function TimelinePage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const { view: viewParam } = await searchParams;
  // Default to the whole-family timeline; "?view=mine" narrows to just you.
  const view = viewParam === "mine" ? "mine" : "family";

  const [entries, tz] = await Promise.all([
    loadTimeline(view, { withCovers: true }),
    getUserTimezone(),
  ]);
  const today = localDate(new Date(), tz);

  return (
    <div className="mx-auto w-full max-w-4xl px-6 pb-24 pt-12">
      <div className="mb-10 flex items-center justify-between gap-4">
        <h1 className="font-serif text-2xl tracking-tight text-foreground">Timeline</h1>
        <TimelineViewToggle view={view} />
      </div>
      <VerticalTimeline entries={entries} today={today} view={view} />
    </div>
  );
}
