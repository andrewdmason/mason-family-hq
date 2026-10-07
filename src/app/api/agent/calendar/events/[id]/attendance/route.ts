// Agent API: mark whether a kid is going to their own event. Not going takes
// the event off every calendar (the Google event is cancelled, so anyone going
// along loses their copy) and tears down drop-off/pick-up blocks; going
// restores all of it. Local only — nothing is sent to TeamSnap.

import { NextResponse, type NextRequest } from "next/server";
import { agentAuthorized, agentUnauthorized } from "@/lib/agent/auth";
import { setOwnerGoing } from "@/lib/calendar/mutations";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!agentAuthorized(req)) return agentUnauthorized();
  const { id } = await params;

  let body: { going?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (typeof body.going !== "boolean") {
    return NextResponse.json(
      { error: "going (boolean) is required." },
      { status: 400 },
    );
  }

  const result = await setOwnerGoing(id, body.going);
  if ("error" in result) {
    return NextResponse.json(result, { status: 400 });
  }
  return NextResponse.json(result);
}
