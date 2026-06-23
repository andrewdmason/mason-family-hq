import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeftIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { PieceDetailView } from "@/components/repertoire/piece-detail-view";
import { getAssignmentsForPiece } from "@/app/practice/focus-panel/actions";
import { getSections, getProgressSnapshots } from "@/app/practice/repertoire/section-actions";
import { getVideos, getTimestamps } from "@/app/practice/repertoire/video-actions";
import { getPerformances } from "@/app/practice/repertoire/performance-actions";
import { getReferenceMidi } from "@/app/practice/repertoire/midi-actions";
import { parseReferenceRoll, type ParsedReferenceRoll } from "@/lib/practice/midi";
import { getRecordings } from "@/app/practice/recordings/actions";
import { getPieceCumulativeData, getPieceCompletionByWeek } from "@/app/practice/reports/actions";
import type { Piece, Work } from "@/lib/types";

export const metadata = {
  title: "Piece",
};

export default async function PieceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: piece } = await supabase
    .from("pieces")
    .select("*")
    .eq("id", id)
    .single();

  if (!piece) {
    notFound();
  }

  const typedPiece = piece as Piece;

  const [{ data: allWorks }, focusData, cumulativeData, sections, videos, progressSnapshots, performances, recordings, referenceMidi] = await Promise.all([
    supabase.from("works").select("*").order("name"),
    getAssignmentsForPiece(id),
    getPieceCumulativeData(id),
    getSections(id),
    getVideos(id),
    getProgressSnapshots(id),
    getPerformances({ pieceId: id }),
    getRecordings(id),
    getReferenceMidi(id),
  ]);

  const works = (allWorks ?? []) as Work[];
  const work = typedPiece.work_id
    ? works.find((w) => w.id === typedPiece.work_id) ?? null
    : null;

  const [videoTimestamps, completionByWeek] = await Promise.all([
    videos[0] ? getTimestamps(videos[0].id) : Promise.resolve([]),
    getPieceCompletionByWeek(id, cumulativeData.map((d) => d.weekStart)),
  ]);

  const chartData = cumulativeData.map((d) => ({
    ...d,
    completionPct: completionByWeek.get(d.weekStart) ?? 0,
  }));

  // Parse the reference MIDI into a tick-positioned roll for the MIDI tab's
  // measure view (download server-side, pass plain data down).
  let roll: ParsedReferenceRoll | null = null;
  if (referenceMidi?.status === "ready" && referenceMidi.midi_path) {
    const { data: file } = await supabase.storage
      .from("piece-midi")
      .download(referenceMidi.midi_path);
    if (file) {
      try {
        roll = parseReferenceRoll(await file.arrayBuffer());
      } catch {
        /* leave null — the MIDI tab falls back to its empty/failed state */
      }
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl flex-1 px-4 py-6 sm:px-6">
      <Link
        href="/practice/repertoire"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeftIcon className="size-3.5" />
        Back to repertoire
      </Link>

      <PieceDetailView
        piece={typedPiece}
        work={work}
        works={works}
        initialSections={sections}
        initialVideos={videos}
        initialTimestamps={videoTimestamps}
        assignments={[...focusData.openAssignments, ...focusData.completedAssignments]}
        performances={performances}
        recordings={recordings}
        referenceMidi={referenceMidi}
        roll={roll}
        chartData={chartData}
        progressSnapshots={progressSnapshots}
      />
    </div>
  );
}
