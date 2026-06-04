import { getUserTimezone, localDate } from "@/lib/date-utils";
import { createClient } from "@/lib/supabase/server";
import { loadTimeline } from "@/lib/timeline/queries";
import { VerticalTimeline } from "@/components/timeline/vertical-timeline";

export const dynamic = "force-dynamic";

export default async function TimelinePage() {
  // The whole family's timeline; per-person / per-category filtering happens
  // client-side via the filter chips (which replace the old My/Family toggle).
  const supabase = await createClient();
  const [entries, tz, { data: userData }] = await Promise.all([
    loadTimeline("family", { withCovers: true }),
    getUserTimezone(),
    supabase.auth.getUser(),
  ]);
  const today = localDate(new Date(), tz);
  const currentUserEmail = userData.user?.email ?? null;

  // Fill the viewport below the header so the timeline can pin to the bottom.
  return (
    <div className="flex min-h-[calc(100dvh-3.5rem)] w-full flex-col">
      <VerticalTimeline entries={entries} today={today} currentUserEmail={currentUserEmail} />
    </div>
  );
}
