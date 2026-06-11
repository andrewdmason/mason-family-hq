// Agent API: the whole team's TeamSnap RSVP roster for an event (live read).
// Useful before nudging — e.g. "12 going, Theo hasn't replied".

import { NextResponse, type NextRequest } from "next/server";
import { agentAuthorized, agentUnauthorized } from "@/lib/agent/auth";
import { getEventTeamAvailability } from "@/lib/calendar/attendance";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!agentAuthorized(req)) return agentUnauthorized();
  const { id } = await params;

  const result = await getEventTeamAvailability(id);
  if ("error" in result) {
    return NextResponse.json(result, { status: 400 });
  }
  return NextResponse.json(result);
}
