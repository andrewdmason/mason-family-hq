import { NextResponse, type NextRequest } from "next/server";
import { getFamilyReadingStatus } from "@/lib/reading/family-status";

// Public, unauthenticated (see the matcher exception in src/lib/supabase/middleware.ts).
// A snapshot of every kid's current book, reading goal, and next check-in quiz,
// for the family assistant to read on a schedule. Never cached — it should
// reflect the latest progress each time it's hit.
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const status = await getFamilyReadingStatus(new URL(request.url).origin);
  return NextResponse.json(status);
}
