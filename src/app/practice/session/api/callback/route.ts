import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  applySessionResult,
  markSessionFailed,
  type WorkerResult,
} from "@/lib/practice/apply-result";
import {
  applySegmentResult,
  type SegmentWorkerResult,
} from "@/lib/practice/apply-segment";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Async result callback: the Modal worker POSTs here when a session — or, with
 * a `recordingId` body, a practice segment (plan U5) — finishes processing (it
 * can take minutes for long recordings, with no Vercel function holding open
 * the whole time). Authenticated by the shared WORKER_SECRET. Runs with the
 * service-role client since there's no user session on this path.
 */
export async function POST(request: Request) {
  const body = (await request.json()) as WorkerResult &
    SegmentWorkerResult & {
      sessionId?: string;
      recordingId?: string;
      ok?: boolean;
      error?: string;
      secret?: string;
    };

  if (!process.env.WORKER_SECRET || body.secret !== process.env.WORKER_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Segment branch (plan U5/KTD8): result for one practice_recordings row.
  // Audio is never deleted on this path — failure keeps everything and stays
  // reprocessable. Session behavior below is untouched.
  if (!body.sessionId && body.recordingId) {
    const supabase = createAdminClient();
    try {
      if (!body.ok) {
        await supabase
          .from("practice_recordings")
          .update({
            status: "failed",
            error_message: String(body.error ?? "Worker failed").slice(0, 500),
          })
          .eq("id", body.recordingId);
        revalidatePath("/practice");
        return NextResponse.json({ status: "failed" });
      }
      const status = await applySegmentResult(supabase, body.recordingId, body);
      revalidatePath("/practice");
      return NextResponse.json({ status });
    } catch (e) {
      const message = e instanceof Error ? e.message : "callback failed";
      await supabase
        .from("practice_recordings")
        .update({ status: "failed", error_message: message.slice(0, 500) })
        .eq("id", body.recordingId);
      revalidatePath("/practice");
      return NextResponse.json({ status: "failed", error: message }, { status: 500 });
    }
  }

  if (!body.sessionId) {
    return NextResponse.json(
      { error: "sessionId or recordingId required" },
      { status: 400 }
    );
  }

  // Session branch (plan U8): transcription-only results settle `status`;
  // recognition-shaped results settle `link_status` and store the linking
  // proposals. Neither writes practice_tasks (AE6) — acceptance does that.
  // Failures route through markSessionFailed so a failed LINK job lands on
  // link_status and never trashes a ready session.
  const supabase = createAdminClient();
  try {
    if (!body.ok) {
      await markSessionFailed(
        supabase,
        body.sessionId,
        String(body.error ?? "Worker failed")
      );
      revalidateSessionPaths(body.sessionId);
      return NextResponse.json({ status: "failed" });
    }
    const status = await applySessionResult(supabase, body.sessionId, body);
    revalidateSessionPaths(body.sessionId);
    return NextResponse.json({ status });
  } catch (e) {
    const message = e instanceof Error ? e.message : "callback failed";
    await markSessionFailed(supabase, body.sessionId, message);
    revalidateSessionPaths(body.sessionId);
    return NextResponse.json({ status: "failed", error: message }, { status: 500 });
  }
}

function revalidateSessionPaths(sessionId: string) {
  revalidatePath("/practice/recordings");
  revalidatePath("/practice/session");
  revalidatePath(`/practice/session/${sessionId}`);
}
