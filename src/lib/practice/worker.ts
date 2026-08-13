import { headers } from "next/headers";

// Alignment-worker plumbing shared by segment-kickoff.ts and
// session-kickoff.ts (plan U5/U8): the job POST and the callback URL.

/** POST a job to the worker, adding the shared secret. Throws on any failure
 * — callers' catch blocks record it on the row/session. */
export async function postWorkerJob(body: Record<string, unknown>): Promise<void> {
  const workerUrl = process.env.PRACTICE_WORKER_URL;
  if (!workerUrl) throw new Error("PRACTICE_WORKER_URL not configured");

  const res = await fetch(workerUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...body, secret: process.env.WORKER_SECRET }),
  });
  if (!res.ok) {
    throw new Error(`Worker kickoff ${res.status}: ${await res.text()}`);
  }
}

/** Callback URL for kickoffs started from a server action, derived from the
 * request headers. (The process route derives the same URL from its own
 * request URL instead.) */
export async function workerCallbackUrl(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (!host) throw new Error("Cannot determine request host");
  const proto =
    h.get("x-forwarded-proto") ??
    (/^(localhost|127\.)/.test(host) ? "http" : "https");
  return `${proto}://${host}/practice/session/api/callback`;
}
