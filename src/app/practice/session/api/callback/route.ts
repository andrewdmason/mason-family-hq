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
import type { AlignmentSpan } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 120;

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/**
 * Hand-written runtime validation for the segment branch (the body is an
 * untrusted POST). Malformed span ENTRIES are dropped; a wholly wrong shape
 * (non-array spans, bad totalMeasures/transcriptionMidiB64) returns null so
 * the row is marked failed instead of storing garbage.
 */
function sanitizeSegmentResult(body: {
  spans?: unknown;
  totalMeasures?: unknown;
  transcriptionMidiB64?: unknown;
  transcriptionError?: unknown;
}): SegmentWorkerResult | null {
  if (body.spans !== undefined && !Array.isArray(body.spans)) return null;
  if (
    body.totalMeasures !== undefined &&
    (!isFiniteNumber(body.totalMeasures) || body.totalMeasures < 0)
  ) {
    return null;
  }
  if (body.transcriptionMidiB64 != null && typeof body.transcriptionMidiB64 !== "string") {
    return null;
  }
  const spans = ((body.spans as unknown[] | undefined) ?? []).filter(
    (s): s is AlignmentSpan => {
      if (typeof s !== "object" || s === null) return false;
      const o = s as Record<string, unknown>;
      return (
        isFiniteNumber(o.startSec) &&
        isFiniteNumber(o.endSec) &&
        isFiniteNumber(o.measureStart) &&
        isFiniteNumber(o.measureEnd) &&
        isFiniteNumber(o.confidence) &&
        o.confidence >= 0 &&
        o.confidence <= 1
      );
    }
  );
  return {
    spans,
    totalMeasures: isFiniteNumber(body.totalMeasures) ? body.totalMeasures : undefined,
    transcriptionMidiB64:
      typeof body.transcriptionMidiB64 === "string" ? body.transcriptionMidiB64 : null,
    transcriptionError:
      typeof body.transcriptionError === "string" ? body.transcriptionError : null,
  };
}

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
  // reprocessable. Failure writes are guarded to 'processing' (like the apply)
  // so a stale/duplicate callback can't overwrite a settled row — those are
  // acknowledged as "stale" without revalidating. Session behavior below is
  // untouched.
  if (!body.sessionId && body.recordingId) {
    if (typeof body.recordingId !== "string") {
      return NextResponse.json(
        { error: "recordingId must be a string" },
        { status: 400 }
      );
    }
    const recordingId = body.recordingId;
    const supabase = createAdminClient();
    try {
      if (!body.ok) {
        const { data: failed } = await supabase
          .from("practice_recordings")
          .update({
            status: "failed",
            error_message: String(body.error ?? "Worker failed").slice(0, 500),
          })
          .eq("id", recordingId)
          .eq("status", "processing")
          .select("id");
        if (!failed?.length) {
          console.warn(`[callback] stale segment failure for ${recordingId}; ignored`);
          return NextResponse.json({ status: "stale" });
        }
        revalidatePath("/practice");
        return NextResponse.json({ status: "failed" });
      }
      const sanitized = sanitizeSegmentResult(body);
      if (!sanitized) {
        await supabase
          .from("practice_recordings")
          .update({ status: "failed", error_message: "malformed worker result" })
          .eq("id", recordingId)
          .eq("status", "processing");
        revalidatePath("/practice");
        return NextResponse.json({ status: "failed" });
      }
      const status = await applySegmentResult(supabase, recordingId, sanitized);
      if (status === "stale") return NextResponse.json({ status });
      revalidatePath("/practice");
      return NextResponse.json({ status });
    } catch (e) {
      const message = e instanceof Error ? e.message : "callback failed";
      await supabase
        .from("practice_recordings")
        .update({ status: "failed", error_message: message.slice(0, 500) })
        .eq("id", recordingId)
        .eq("status", "processing");
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
  // link_status and never trashes a ready session. Stale results (apply's
  // status guards matched no in-flight row) are acknowledged without
  // revalidating.
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
    if (status === "stale") return NextResponse.json({ status });
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
