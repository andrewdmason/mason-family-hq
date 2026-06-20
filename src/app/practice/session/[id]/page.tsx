import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeftIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { parsePerformanceMidi, type PerformanceNote } from "@/lib/practice/midi";
import { SessionDebugView } from "@/components/practice/session-debug-view";
import type { PracticeAlignmentResult } from "@/lib/types";

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
    .select("id, date, status, confidence, result, transcription_path")
    .eq("id", id)
    .maybeSingle();
  if (!session) notFound();

  let notes: PerformanceNote[] = [];
  let durationSec = 0;
  if (session.transcription_path) {
    const { data: file } = await supabase.storage
      .from("practice-session-midi")
      .download(session.transcription_path);
    if (file) {
      try {
        const parsed = parsePerformanceMidi(await file.arrayBuffer());
        notes = parsed.notes;
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

  const pieceIds = [
    ...new Set(segments.filter((s) => s.pieceId).map((s) => s.pieceId as string)),
  ];
  const pieceNames: Record<string, string> = {};
  if (pieceIds.length) {
    const { data } = await supabase.from("pieces").select("id, name").in("id", pieceIds);
    for (const p of (data ?? []) as { id: string; name: string }[]) {
      pieceNames[p.id] = p.name;
    }
  }

  return (
    <div className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6">
      <Link
        href="/practice/session"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeftIcon className="size-3.5" /> Back to Listen
      </Link>
      <div className="mb-4 flex items-baseline justify-between">
        <h1 className="text-xl font-semibold tracking-tight">Session — {session.date}</h1>
        <span className="text-xs text-muted-foreground">
          {session.status}
          {session.confidence != null ? ` · confidence ${Math.round(session.confidence * 100)}%` : ""}
        </span>
      </div>
      <SessionDebugView
        notes={notes}
        durationSec={durationSec}
        segments={segments}
        windows={windows}
        pieceNames={pieceNames}
      />
    </div>
  );
}
