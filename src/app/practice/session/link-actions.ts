"use server";

// Server actions for the open-session linking flow (plan U8, F4/R16) and for
// reprocessing a failed transcription (the regression fix for the old
// delete-on-failure behavior — audio is kept, so a retry is always possible).

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { kickoffSessionProcessing } from "@/lib/practice/session-kickoff";
import { workerCallbackUrl } from "@/lib/practice/worker";
import { proposalKey, writeAcceptedSegmentTask } from "@/lib/practice/autolog";
import type { AcceptedLinkSegment, PracticeAlignmentResult } from "@/lib/types";

/**
 * Reprocess a session whose transcription failed: reset failed -> uploaded
 * (clearing the error and lease), then run the same transcription-only
 * kickoff as a fresh upload.
 */
export async function reprocessSession(
  sessionId: string
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not authenticated" };

  const { data: reset, error } = await supabase
    .from("practice_sessions")
    .update({ status: "uploaded", error_message: null, claimed_at: null })
    .eq("id", sessionId)
    .eq("status", "failed")
    .select("id");
  if (error) return { ok: false, error: error.message };
  if (!reset?.length) {
    return { ok: false, error: "Session is not in a reprocessable state" };
  }

  const outcome = await kickoffSessionProcessing(
    supabase,
    sessionId,
    await workerCallbackUrl()
  );
  revalidatePath("/practice/recordings");
  revalidatePath("/practice/session");
  revalidatePath(`/practice/session/${sessionId}`);
  if (outcome.status === "failed") return { ok: false, error: outcome.error };
  return { ok: true };
}

/**
 * Accept one linking proposal (KTD9): write an ordinary completed
 * practice_task tagged with the session, then record the acceptance on
 * accepted_segments so re-links never re-propose (or delete) it. Idempotent
 * per proposal key. The proposal is looked up in the session's CURRENT
 * result.segments — a stale key (superseded by a re-link) is refused rather
 * than logging something the user isn't looking at.
 */
export async function acceptLinkProposal(
  sessionId: string,
  key: string
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not authenticated" };

  const { data: session } = await supabase
    .from("practice_sessions")
    .select("id, date, session_number, result, accepted_segments")
    .eq("id", sessionId)
    .maybeSingle();
  if (!session) return { ok: false, error: "Session not found" };

  const accepted = (session.accepted_segments ?? []) as AcceptedLinkSegment[];
  if (accepted.some((a) => a.key === key)) return { ok: true };

  const result = session.result as PracticeAlignmentResult | null;
  const seg = (result?.segments ?? []).find(
    (s) => s.kind === "piece" && s.pieceId && proposalKey(s) === key
  );
  if (!seg) {
    return { ok: false, error: "Proposal no longer exists — refresh and retry" };
  }

  try {
    const taskId = await writeAcceptedSegmentTask(supabase, sessionId, seg, {
      date: session.date as string,
      sessionNumber: session.session_number as number,
    });
    const entry: AcceptedLinkSegment = {
      key,
      pieceId: seg.pieceId as string,
      startSec: seg.startSec,
      endSec: seg.endSec,
      taskId,
      acceptedAt: new Date().toISOString(),
    };
    const { error: upErr } = await supabase
      .from("practice_sessions")
      .update({ accepted_segments: [...accepted, entry] })
      .eq("id", sessionId);
    if (upErr) return { ok: false, error: upErr.message };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Failed to log the entry",
    };
  }

  revalidatePath("/practice");
  revalidatePath(`/practice/session/${sessionId}`);
  return { ok: true };
}
