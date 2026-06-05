// Background calendar sync endpoint. Hit every 15 minutes by the pg_cron job in
// migration 00103 so RSVP/event changes made directly in TeamSnap (or an ICS
// feed) flow back into the app even when nobody has the page open. Reuses the
// same runCalendarSync() the on-load trigger and the manual button call, so the
// sync logic lives in one place.
//
// Auth: a bearer token matching CRON_SECRET (or, as a fallback, the service-role
// key the cron job already sends). Without a configured secret the route refuses
// to run, so it can't be triggered anonymously.

import { runCalendarSync } from "@/lib/calendar/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(req: Request): boolean {
  const expected =
    process.env.CRON_SECRET ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!expected) return false;
  const header = req.headers.get("authorization") ?? "";
  const token = header.replace(/^Bearer\s+/i, "");
  return token === expected;
}

async function handle(req: Request): Promise<Response> {
  if (!authorized(req)) {
    return new Response("Unauthorized", { status: 401 });
  }
  try {
    const result = await runCalendarSync();
    return Response.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sync failed";
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}

// pg_net sends POST; allow GET too so the job (or a manual curl) can use either.
export const POST = handle;
export const GET = handle;
