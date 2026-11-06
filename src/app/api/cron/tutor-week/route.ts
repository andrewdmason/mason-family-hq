// Tuttles' parent brief, each morning (pg_cron, migration 00212): what each
// kid with Canvas is learning this week. See src/lib/tuttles/week.ts.
//
// Auth matches the other sweeps: a bearer token equal to CRON_SECRET.

import { createAdminClient } from "@/lib/supabase/admin";
import { generateAllWeekBriefs } from "@/lib/tuttles/week";

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
  const results = await generateAllWeekBriefs(createAdminClient());
  for (const [kid, r] of Object.entries(results)) {
    if (r.startsWith("failed")) console.error("[tutor-week]", kid, r);
  }
  return Response.json({ ok: true, results });
}

export const GET = handle;
export const POST = handle;
