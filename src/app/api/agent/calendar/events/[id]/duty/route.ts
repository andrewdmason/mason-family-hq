// Agent API: set who's doing drop-off / pick-up for a kid's event.
// `assignment` is a parent's email, a caregiver name (e.g. "Marina" — see
// caregivers.ts), "na" (explicitly no drive needed), or null to clear back to
// unset. Drive blocks on the parent's Google calendar are reconciled after the
// response, exactly like duty taps in the UI.

import { NextResponse, type NextRequest } from "next/server";
import { agentAuthorized, agentUnauthorized } from "@/lib/agent/auth";
import { setDuty, type DutyState } from "@/lib/calendar/mutations";
import { normalizeCaregiver } from "@/lib/calendar/caregivers";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!agentAuthorized(req)) return agentUnauthorized();
  const { id } = await params;

  let body: { duty?: unknown; assignment?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (body.duty !== "dropoff" && body.duty !== "pickup") {
    return NextResponse.json(
      { error: 'duty must be "dropoff" or "pickup".' },
      { status: 400 },
    );
  }

  let state: DutyState;
  if (body.assignment === null || body.assignment === undefined) {
    state = null; // clear back to unset
  } else if (body.assignment === "na") {
    state = { assignee: null, isNa: true };
  } else if (typeof body.assignment === "string") {
    const caregiver = normalizeCaregiver(body.assignment);
    state = caregiver
      ? { assignee: null, isNa: false, caregiver }
      : { assignee: body.assignment.trim().toLowerCase(), isNa: false };
  } else {
    return NextResponse.json(
      {
        error:
          'assignment must be a parent email, a caregiver name, "na", or null.',
      },
      { status: 400 },
    );
  }

  const result = await setDuty(id, body.duty, state);
  if ("error" in result) {
    return NextResponse.json(result, { status: 400 });
  }
  return NextResponse.json(result);
}
