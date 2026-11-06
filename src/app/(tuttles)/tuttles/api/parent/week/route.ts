import { NextResponse } from "next/server";
import { tuttlesCaller } from "@/lib/tuttles/context";
import { weekBrief, type WeekBrief } from "@/lib/tuttles/week";

export const runtime = "nodejs";
// The first look of the day makes the brief (src/lib/tuttles/week.ts).
export const maxDuration = 120;

/**
 * The parents' "This week" in the Tuttles app: what the kid is learning in
 * each class, how they seem to be doing, ways to bring it up, and what's
 * coming up.
 *
 *   GET   Authorization: Bearer <supabase access token>   → { kid, brief }
 *
 * Parents only; the kid is the one a parent is tutored as
 * (src/lib/tuttles/tutoring-as.ts).
 */
export async function GET(request: Request) {
  const caller = await tuttlesCaller(request);
  if ("error" in caller) return NextResponse.json({ error: caller.error }, { status: caller.status });
  const { db, student } = caller;
  if (!student.preview) return NextResponse.json({ error: "parents only" }, { status: 403 });
  try {
    const brief: WeekBrief | null = await weekBrief(db, student.studentId);
    return NextResponse.json(
      { kid: { id: student.studentId, name: student.name }, brief },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't make the brief." }, { status: 502 });
  }
}
