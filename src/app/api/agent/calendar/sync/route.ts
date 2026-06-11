// Agent API: trigger a calendar sync before reading, so the agent sees fresh
// TeamSnap/ICS/Google state. Default is the light sync (no per-player RSVP
// fetch, no Google writes); pass {"full": true} for the everything pass the
// manual Sync button runs.

import { NextResponse, type NextRequest } from "next/server";
import { agentAuthorized, agentUnauthorized } from "@/lib/agent/auth";
import { runCalendarSync } from "@/lib/calendar/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  if (!agentAuthorized(req)) return agentUnauthorized();

  let full = false;
  try {
    const body = await req.json();
    full = body?.full === true;
  } catch {
    // empty body = light sync
  }

  try {
    const result = await runCalendarSync(
      full ? {} : { teamsnapRsvp: false, materialize: false },
    );
    return NextResponse.json({ ok: true, full, ...result });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Sync failed" },
      { status: 500 },
    );
  }
}
