// Agent API: the facts an agent needs before doing calendar work — family
// members (names → emails → roles), calendar sources (for create targets),
// and the logistics settings (home address, drive buffer).

import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { agentAuthorized, agentUnauthorized } from "@/lib/agent/auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!agentAuthorized(req)) return agentUnauthorized();

  const admin = createAdminClient();
  const [{ data: members }, { data: sources }, { data: logistics }] =
    await Promise.all([
      admin
        .from("family_members")
        .select("email, name, role, primary_calendar_id, primary_calendar_summary")
        .order("role")
        .order("name"),
      admin
        .from("calendar_sources")
        .select(
          "id, member_email, source_type, nickname, teamsnap_team_name, google_calendar_id, is_active",
        )
        .order("created_at"),
      admin
        .from("calendar_logistics_settings")
        .select("home_address, drive_buffer_minutes")
        .eq("id", 1)
        .maybeSingle(),
    ]);

  return NextResponse.json({
    members: (members ?? []).map((m) => ({
      email: m.email,
      name: m.name,
      role: m.role,
      // The Google calendar their events import into (null until set up).
      primary_calendar: m.primary_calendar_summary ?? m.primary_calendar_id,
    })),
    sources: (sources ?? []).map((s) => ({
      id: s.id,
      member_email: s.member_email,
      type: s.source_type,
      name: s.nickname ?? s.teamsnap_team_name ?? s.google_calendar_id,
      is_active: s.is_active,
    })),
    logistics: {
      home_address: logistics?.home_address ?? null,
      drive_buffer_minutes: logistics?.drive_buffer_minutes ?? null,
    },
  });
}
