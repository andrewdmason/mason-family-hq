import { NextRequest } from "next/server";
import { readHomeCache, writeHomeCache } from "@/lib/home/cache";
import { generateGreeting } from "@/lib/home/greeting";
import { getIsOwner } from "@/lib/members/auth";
import { localDate, resolveTimezone } from "@/lib/date-utils";

export const runtime = "nodejs";

/**
 * Read-or-generate today's Home greeting for the signed-in member. Idempotent:
 * once a greeting is cached for the day it's returned as-is (handles reloads and
 * StrictMode double-mounts), so the AI call fires at most once per person per
 * day. A generation failure returns `{ greeting: null }` with 200 — the header
 * just falls back to a plain welcome.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { tz?: string };
  const tz = await resolveTimezone(body.tz);
  const date = localDate(new Date(), tz);

  const cached = await readHomeCache<string>("greeting", date);
  if (cached) return Response.json({ greeting: cached });

  const isOwner = await getIsOwner();
  const greeting = await generateGreeting(tz, isOwner);
  if (greeting) await writeHomeCache("greeting", date, greeting);
  return Response.json({ greeting });
}
