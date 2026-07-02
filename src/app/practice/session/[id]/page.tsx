import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeftIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { parsePerformanceMidi, type PedalSpan, type PerformanceNote } from "@/lib/practice/midi";
import { proposalKey } from "@/lib/practice/autolog";
import { SessionDebugView } from "@/components/practice/session-debug-view";
import {
  SessionLinkPanel,
  type AcceptedDisplay,
  type LinkProposal,
} from "@/components/practice/session-link-panel";
import type {
  AcceptedLinkSegment,
  PracticeAlignmentResult,
  PracticeSessionLinkStatus,
  PracticeSessionStatus,
} from "@/lib/types";

export const metadata = { title: "Session" };

export default async function SessionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: session } = await supabase
    .from("practice_sessions")
    .select(
      "id, date, status, error_message, confidence, result, transcription_path, recording_path, link_status, link_error, accepted_segments"
    )
    .eq("id", id)
    .maybeSingle();
  if (!session) notFound();

  let notes: PerformanceNote[] = [];
  let pedals: PedalSpan[] = [];
  let durationSec = 0;
  if (session.transcription_path) {
    const { data: file } = await supabase.storage
      .from("practice-session-midi")
      .download(session.transcription_path);
    if (file) {
      try {
        const parsed = parsePerformanceMidi(await file.arrayBuffer());
        notes = parsed.notes;
        pedals = parsed.pedals;
        durationSec = parsed.durationSec;
      } catch {
        /* leave empty */
      }
    }
  }

  const result = session.result as PracticeAlignmentResult | null;
  const segments = result?.segments ?? [];
  const windows = result?.windows ?? [];
  durationSec = Math.max(
    durationSec,
    ...segments.map((s) => s.endSec),
    ...windows.map((w) => w.endSec),
    1
  );

  const accepted = (session.accepted_segments ?? []) as AcceptedLinkSegment[];
  const pieceIds = [
    ...new Set([
      ...segments.filter((s) => s.pieceId).map((s) => s.pieceId as string),
      ...accepted.map((a) => a.pieceId),
    ]),
  ];
  const pieceNames: Record<string, string> = {};
  if (pieceIds.length) {
    const { data } = await supabase.from("pieces").select("id, name").in("id", pieceIds);
    for (const p of (data ?? []) as { id: string; name: string }[]) {
      pieceNames[p.id] = p.name;
    }
  }

  // Linking proposals (F4): piece-kind recognition segments minus already
  // accepted ones (accepted entries never re-propose — KTD9). Only sessions
  // that went through the link job propose anything — legacy autolog sessions
  // (link_status 'none') also carry result.segments, but those were already
  // written to the log at the time, so offering them as acceptable proposals
  // would double-log. They still show in the debug view below.
  const linkStatus = (session.link_status ?? "none") as PracticeSessionLinkStatus;
  const acceptedKeys = new Set(accepted.map((a) => a.key));
  const proposals: LinkProposal[] =
    linkStatus !== "linked"
      ? []
      : segments
          .filter((s) => s.kind === "piece" && s.pieceId)
          .map((s) => ({
            key: proposalKey(s),
            pieceName: pieceNames[s.pieceId as string] ?? "Unknown piece",
            startSec: s.startSec,
            endSec: s.endSec,
            region: s.region,
            confidence: s.confidence,
          }))
          .filter((p) => !acceptedKeys.has(p.key));
  const acceptedDisplay: AcceptedDisplay[] = accepted.map((a) => ({
    key: a.key,
    pieceName: pieceNames[a.pieceId] ?? "Unknown piece",
    startSec: a.startSec,
    endSec: a.endSec,
  }));

  // Kept audio (KTD8) plays back straight from storage.
  let audioUrl: string | null = null;
  if (session.recording_path) {
    const { data: signed } = await supabase.storage
      .from("task-audio")
      .createSignedUrl(session.recording_path, 3600);
    audioUrl = signed?.signedUrl ?? null;
  }

  return (
    <div className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6">
      <Link
        href="/practice/session"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeftIcon className="size-3.5" /> Back to sessions
      </Link>
      <div className="mb-4 flex items-baseline justify-between">
        <h1 className="text-xl font-semibold tracking-tight">Session — {session.date}</h1>
        <span className="text-xs text-muted-foreground">
          {session.status}
          {session.confidence != null ? ` · confidence ${Math.round(session.confidence * 100)}%` : ""}
        </span>
      </div>

      {audioUrl && (
        <audio controls preload="none" src={audioUrl} className="mb-4 w-full" />
      )}

      <SessionLinkPanel
        sessionId={session.id}
        status={session.status as PracticeSessionStatus}
        errorMessage={session.error_message}
        linkStatus={linkStatus}
        linkError={session.link_error}
        canLink={session.status === "ready" && !!session.recording_path}
        proposals={proposals}
        accepted={acceptedDisplay}
      />

      <SessionDebugView
        notes={notes}
        pedals={pedals}
        durationSec={durationSec}
        segments={segments}
        windows={windows}
        pieceNames={pieceNames}
      />
    </div>
  );
}
