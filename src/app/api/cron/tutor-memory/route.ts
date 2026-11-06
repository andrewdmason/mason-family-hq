// Tuttles' nightly memory rewrite (pg_cron, migration 00211): each kid who
// chatted since their last version gets their profile rewritten whole. See
// src/lib/tuttles/memory.ts.
//
// Auth matches the other sweeps: a bearer token equal to CRON_SECRET.

import { createAdminClient } from "@/lib/supabase/admin";
import { rewriteAllMemories } from "@/lib/tuttles/memory";

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
  const results = await rewriteAllMemories(createAdminClient());
  for (const [student, r] of Object.entries(results)) {
    if (r.startsWith("failed")) console.error("[tutor-memory]", student, r);
  }
  return Response.json({ ok: true, results });
}

export const GET = handle;
export const POST = handle;
