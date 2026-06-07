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
  const { data: me } = await supabase
    .from("family_members")
    .select("role")
    .eq("user_id", userId)
    .maybeSingle();
  const canManage = me?.role === "owner" || me?.role === "parent";

  const [members, sources, events] = await Promise.all([
    getCalendarMembers(),
    getCalendarSources(),
    getCalendarEvents(),
  ]);
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
      />
    </>
  );
}
