// Agent API: the "what needs attention" digest. One call returns everything
// the family assistant should notice on the upcoming calendar: overlapping
// events, kid events with no drop-off/pick-up assigned, unanswered TeamSnap
// RSVPs, and kid events no parent is marked as attending.

import { NextResponse, type NextRequest } from "next/server";
import { agentAuthorized, agentUnauthorized } from "@/lib/agent/auth";
import { loadAgentCalendar, computeReview } from "@/lib/agent/calendar";

export const dynamic = "force-dynamic";

const DAY_MS = 86_400_000;

export async function GET(req: NextRequest) {
  if (!agentAuthorized(req)) return agentUnauthorized();

  const url = new URL(req.url);
  const daysRaw = Number(url.searchParams.get("days") ?? 14);
  const days = Number.isFinite(daysRaw) ? Math.min(Math.max(daysRaw, 1), 60) : 14;

  const now = new Date();
  // Reach a few hours back so in-progress events still count.
  const range = {
    from: new Date(now.getTime() - DAY_MS / 4),
    to: new Date(now.getTime() + days * DAY_MS),
  };
  const data = await loadAgentCalendar(range);

  return NextResponse.json({
    from: range.from.toISOString(),
    to: range.to.toISOString(),
    ...computeReview(data, now),
  });
}
