// Finishing the translations nobody is watching.
//
// Most of a book is translated as a Message Batch, which can take hours. While
// somebody is reading in plain mode the reader ingests results itself; this is
// the sweep for the batch that finishes overnight, so the book is ready before
// anyone opens it. Never calls the model: a chunk that failed is handed back to
// the reader's reach-ahead, flagged for the fallback.
//
// Auth matches the annotation email sweep: a bearer token equal to CRON_SECRET.

import { createAdminClient } from "@/lib/supabase/admin";
import { hashesWithOpenBatches, reconcileHash } from "@/lib/reading/plain/batch";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

function authorized(req: Request): boolean {
  const expected = process.env.CRON_SECRET ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!expected) return false;
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  return token === expected;
}

async function handle(req: Request): Promise<Response> {
  if (!authorized(req)) return new Response("Unauthorized", { status: 401 });

  const admin = createAdminClient();
  const hashes = await hashesWithOpenBatches(admin);
  let readied = 0;
  let failed = 0;
  for (const hash of hashes) {
    try {
      readied += await reconcileHash(admin, hash);
    } catch (err) {
      failed += 1;
      console.error("[plain-reconcile] failed", hash.slice(0, 12), err);
    }
  }
  return Response.json({ ok: true, hashes: hashes.length, readied, failed });
}

export const GET = handle;
export const POST = handle;
