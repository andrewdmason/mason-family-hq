import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeftIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { PieceDetailHeader } from "@/components/repertoire/piece-detail-header";
import { SectionEditor } from "@/components/repertoire/section-editor";
import { AssignmentList } from "@/components/repertoire/assignment-list";
import dynamic from "next/dynamic";

const PieceCumulativeChart = dynamic(() =>
  import("@/components/repertoire/piece-cumulative-chart").then(
    (m) => m.PieceCumulativeChart
  )
);
const ProgressGrid = dynamic(() =>
  import("@/components/repertoire/progress-grid").then(
    (m) => m.ProgressGrid
  )
);
import { Separator } from "@/components/ui/separator";
import {
  getAssignmentsForPiece,
} from "@/app/practice/focus-panel/actions";
import { getSections, getProgressSnapshots } from "@/app/practice/repertoire/section-actions";
import { getVideos, getTimestamps } from "@/app/practice/repertoire/video-actions";
import { getPerformances } from "@/app/practice/repertoire/performance-actions";
import { PerformancesPanel } from "@/components/repertoire/performances-panel";
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

  const [{ data: allWorks }, focusData, cumulativeData, sections, videos, progressSnapshots, performances] = await Promise.all([
    supabase.from("works").select("*").order("name"),
    getAssignmentsForPiece(id),
    getPieceCumulativeData(id),
    getSections(id),
    getVideos(id),
    getProgressSnapshots(id),
    getPerformances({ pieceId: id }),
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

  return (
    <div className="mx-auto w-full max-w-3xl flex-1 px-4 py-6 sm:px-6">
      <Link
        href="/practice/repertoire"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
      >
        <ArrowLeftIcon className="size-3.5" />
        Back to repertoire
      </Link>

      <PerformancesPanel performances={performances} owner={{ pieceId: id }} />

      <PieceDetailHeader piece={typedPiece} work={work} works={works} />

      <div className="mt-6 space-y-6">
        <SectionEditor
          pieceId={typedPiece.id}
          pieceTargetTempo={typedPiece.target_tempo}
          initialSections={sections}
          initialVideos={videos}
          initialTimestamps={videoTimestamps}
        />

        <Separator />

        <AssignmentList pieceId={id} initialAssignments={[...focusData.openAssignments, ...focusData.completedAssignments]} />

        <Separator />

        <PieceCumulativeChart data={chartData} />

        <Separator />

        <ProgressGrid sections={sections} snapshots={progressSnapshots} />
      </div>
    </div>
  );
}
