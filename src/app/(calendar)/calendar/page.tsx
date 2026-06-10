import { createClient } from "@/lib/supabase/server";
import { requireUserId } from "@/lib/members/auth";
import {
  getCalendarMembers,
  getCalendarSources,
  getCalendarEvents,
  getEventAttendees,
} from "@/lib/calendar/queries";
import { CalendarClient } from "@/components/calendar/calendar-client";
import { SyncTrigger } from "@/components/calendar/sync-trigger";

export default async function CalendarPage() {
  const supabase = await createClient();
  const userId = await requireUserId(supabase);

  // One round trip for everything that only needs the user id; only the
  // attendee lookup (keyed by event ids) has to wait for a prior result.
  const [{ data: me }, members, sources, events] = await Promise.all([
    supabase
      .from("family_members")
      .select("role, email")
      .eq("user_id", userId)
      .maybeSingle(),
    getCalendarMembers(),
    getCalendarSources(),
    getCalendarEvents(),
  ]);
  const canManage = me?.role === "owner" || me?.role === "parent";
  const currentMemberEmail = me?.email ?? null;
  const goingByEvent = await getEventAttendees(events.map((e) => e.id));

  // getCalendarMembers returns kids-first (Oscar, Sebastian, Andrew, Jenny);
  // the calendar reads better with adults first, so reverse for the chips and
  // agenda columns (Jenny, Andrew, Sebastian, Oscar).
  const calendarMembers = [...members].reverse();

  return (
    <>
      <SyncTrigger />
      <CalendarClient
        members={calendarMembers}
        sources={sources}
        events={events}
        goingByEvent={goingByEvent}
        canManage={canManage}
        currentMemberEmail={currentMemberEmail}
      />
    </>
  );
}
