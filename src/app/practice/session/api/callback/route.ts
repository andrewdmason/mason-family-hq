import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { applySessionResult, type WorkerResult } from "@/lib/practice/apply-result";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Async result callback: the Modal worker POSTs here when a session finishes
 * processing (it can take minutes for long recordings, with no Vercel function
 * holding open the whole time). Authenticated by the shared WORKER_SECRET. Runs
 * with the service-role client since there's no user session on this path.
 */
export async function POST(request: Request) {
  const body = (await request.json()) as WorkerResult & {
    sessionId?: string;
    ok?: boolean;
    error?: string;
    secret?: string;
  };

  if (!process.env.WORKER_SECRET || body.secret !== process.env.WORKER_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!body.sessionId) {
    return NextResponse.json({ error: "sessionId required" }, { status: 400 });
  }

  const supabase = createAdminClient();
  try {
    if (!body.ok) {
      await supabase
        .from("practice_sessions")
        .update({
          status: "failed",
          error_message: String(body.error ?? "Worker failed").slice(0, 500),
        })
        .eq("id", body.sessionId);
      return NextResponse.json({ status: "failed" });
    }
    const taskCount = await applySessionResult(supabase, body.sessionId, body);
    return NextResponse.json({ status: "ready", taskCount });
  } catch (e) {
    const message = e instanceof Error ? e.message : "callback failed";
    await supabase
      .from("practice_sessions")
      .update({ status: "failed", error_message: message })
      .eq("id", body.sessionId);
    return NextResponse.json({ status: "failed", error: message }, { status: 500 });
  }
}
