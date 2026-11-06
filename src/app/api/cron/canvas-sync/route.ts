// Canvas for every connected student, every two hours (pg_cron, migration
// 00209): see src/lib/canvas/sync.ts. Also sends the monthly key-renewal
// reminder (src/lib/canvas/reminders.ts).
//
// Auth matches the reader's sweeps: a bearer token equal to CRON_SECRET.

import { createAdminClient } from "@/lib/supabase/admin";
import { syncAllCanvas } from "@/lib/canvas/sync";
import { remindExpiringCanvasKeys } from "@/lib/canvas/reminders";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorized(req: Request): boolean {
  const expected = process.env.CRON_SECRET ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!expected) return false;
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  return token === expected;
}

async function handle(req: Request): Promise<Response> {
  if (!authorized(req)) return new Response("Unauthorized", { status: 401 });
  const db = createAdminClient();
  const results = await syncAllCanvas(db);
  for (const [student, r] of Object.entries(results)) {
    if (!r.ok) console.error("[canvas-sync] failed", student, r.error);
  }
  // A key about to run out (or just refused) gets the parents one email.
  const reminders = await remindExpiringCanvasKeys(db, new URL(req.url).origin).catch((err) => {
    console.error("[canvas-sync] reminder failed", err);
    return 0;
  });
  return Response.json({ ok: true, results, reminders });
}

export const GET = handle;
export const POST = handle;
