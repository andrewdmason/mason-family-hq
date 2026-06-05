import { createClient } from "@/lib/supabase/server";
import { requireUserId } from "@/lib/members/auth";
import {
  getCalendarMembers,
  getCalendarSources,
  getCalendarEvents,
} from "@/lib/calendar/queries";
import { CalendarClient } from "@/components/calendar/calendar-client";
import { SyncTrigger } from "@/components/calendar/sync-trigger";

export default async function CalendarPage() {
  const supabase = await createClient();
  const userId = await requireUserId(supabase);
  const { data: me } = await supabase
    .from("family_members")
    .select("email, role")
    .eq("user_id", userId)
    .maybeSingle();
  const canManage = me?.role === "owner" || me?.role === "parent";

  // RLS lets a member read only their own TeamSnap connection row.
  const { data: conn } = me?.email
    ? await supabase
        .from("teamsnap_connections")
        .select("member_email")
        .eq("member_email", me.email)
        .maybeSingle()
    : { data: null };
  const teamsnapConnected = !!conn;

  const [members, sources, events] = await Promise.all([
    getCalendarMembers(),
    getCalendarSources(),
    getCalendarEvents(),
  ]);

  return (
    <>
      <SyncTrigger />
      <CalendarClient
        members={members}
        sources={sources}
        events={events}
        canManage={canManage}
        teamsnapConnected={teamsnapConnected}
      />
    </>
  );
}
