import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireUserId } from "@/lib/members/auth";
import { getCalendarMembers, getCalendarSources } from "@/lib/calendar/queries";
import {
  hasTeamsnapConnection,
  listGoogleConnectedEmails,
  getLogisticsSettingsView,
} from "@/app/(calendar)/calendar/actions";
import { CalendarsManager } from "@/components/journal/calendars-manager";
import { LogisticsSettings } from "@/components/journal/logistics-settings";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Calendar Settings",
};

export default async function CalendarsSettingsPage() {
  // Owner/parent only — the roles that manage calendars. Kids are bounced to
  // the first settings tab.
  const supabase = await createClient();
  const userId = await requireUserId(supabase);
  const { data: me } = await supabase
    .from("family_members")
    .select("email, role")
    .eq("user_id", userId)
    .maybeSingle();
  if (me?.role !== "owner" && me?.role !== "parent") {
    redirect("/settings/user");
  }

  const [
    members,
    sources,
    teamsnapConnected,
    googleConnectedEmails,
    logistics,
  ] = await Promise.all([
    getCalendarMembers(),
    getCalendarSources(),
    hasTeamsnapConnection(),
    listGoogleConnectedEmails(),
    getLogisticsSettingsView(),
  ]);

  return (
    <>
      <CalendarsManager
        members={members}
        sources={sources}
        teamsnapConnected={teamsnapConnected}
        googleConnectedEmails={googleConnectedEmails}
        currentUserEmail={me.email as string}
      />
      <LogisticsSettings settings={logistics} />
    </>
  );
}
