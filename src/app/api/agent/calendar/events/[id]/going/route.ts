// Agent API: mark a family member as going (or not) to an event. The durable
// "who's attending" state — distinct from the kid's TeamSnap RSVP. When the
// event is materialized on a Google calendar this also updates its real guest
// list, and it reshapes any drive block the member holds (round trip ↔ one-way).

import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { agentAuthorized, agentUnauthorized } from "@/lib/agent/auth";
import { setGoing } from "@/lib/calendar/mutations";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!agentAuthorized(req)) return agentUnauthorized();
  const { id } = await params;

  let body: { member_email?: unknown; going?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const memberEmail =
    typeof body.member_email === "string"
      ? body.member_email.trim().toLowerCase()
      : "";
  if (!memberEmail || typeof body.going !== "boolean") {
    return NextResponse.json(
      { error: "member_email and going (boolean) are required." },
      { status: 400 },
    );
  }

  const admin = createAdminClient();
  const { data: member } = await admin
    .from("family_members")
    .select("email")
    .eq("email", memberEmail)
    .maybeSingle();
  if (!member) {
    return NextResponse.json(
      { error: `No family member with email ${memberEmail}.` },
      { status: 400 },
    );
  }

  const result = await setGoing(id, memberEmail, body.going);
  if ("error" in result) {
    return NextResponse.json(result, { status: 400 });
  }
  return NextResponse.json(result);
}
