// Agent API: set the linked player's TeamSnap RSVP for an event. Writes back
// to TeamSnap (the team sees it natively) and mirrors onto the local row.

import { NextResponse, type NextRequest } from "next/server";
import { agentAuthorized, agentUnauthorized } from "@/lib/agent/auth";
import { setEventRsvp } from "@/lib/calendar/attendance";

export const dynamic = "force-dynamic";

const STATUSES = ["going", "maybe", "not_going"] as const;
type Status = (typeof STATUSES)[number];

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!agentAuthorized(req)) return agentUnauthorized();
  const { id } = await params;

  let body: { status?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!STATUSES.includes(body.status as Status)) {
    return NextResponse.json(
      { error: 'status must be "going", "maybe", or "not_going".' },
      { status: 400 },
    );
  }

  const result = await setEventRsvp(id, body.status as Status);
  if ("error" in result) {
    return NextResponse.json(result, { status: 400 });
  }
  return NextResponse.json(result);
}
