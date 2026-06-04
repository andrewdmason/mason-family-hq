import { getUserTimezone, localDate } from "@/lib/date-utils";
import { createClient } from "@/lib/supabase/server";
import { loadTimeline } from "@/lib/timeline/queries";
import { VerticalTimeline } from "@/components/timeline/vertical-timeline";

export const dynamic = "force-dynamic";

export default async function TimelinePage() {
  // The whole family's timeline; scope (All / Family / Me) and per-person /
  // per-category filtering both happen client-side.
  const supabase = await createClient();
  const [entries, tz, { data: userData }, { data: members }] = await Promise.all([
    loadTimeline("family", { withCovers: true }),
    getUserTimezone(),
    supabase.auth.getUser(),
    // Roles are family-readable; we only need them to know which subjects are
    // grown-ups, so the "Family" scope can hide a single adult's solo events.
    supabase.from("family_members").select("email, role"),
  ]);
  const today = localDate(new Date(), tz);
  const currentUserEmail = userData.user?.email ?? null;
  const adultEmails = (members ?? [])
    .filter((m) => m.role === "owner" || m.role === "parent")
    .map((m) => (m.email as string).toLowerCase());

  // Fill the viewport below the header so the timeline can pin to the bottom.
  return (
    <div className="flex min-h-[calc(100dvh-3.5rem)] w-full flex-col">
      <VerticalTimeline
        entries={entries}
        today={today}
        currentUserEmail={currentUserEmail}
        adultEmails={adultEmails}
      />
    </div>
  );
}
