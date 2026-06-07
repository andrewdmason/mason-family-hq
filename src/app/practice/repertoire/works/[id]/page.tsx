import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeftIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { AssignmentList } from "@/components/repertoire/assignment-list";
import { WorkDetailHeader } from "@/components/repertoire/work-detail-header";
import { Separator } from "@/components/ui/separator";
import {
  getWorkFocusData,
} from "@/app/practice/repertoire/actions";
import { getPerformances } from "@/app/practice/repertoire/performance-actions";
import { PerformancesPanel } from "@/components/repertoire/performances-panel";
import type { Work, Piece } from "@/lib/types";

export const metadata = {
  title: "Work",
};

export default async function WorkDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: work } = await supabase
    .from("works")
    .select("*")
    .eq("id", id)
    .single();

  if (!work) {
    notFound();
  }

  const typedWork = work as Work;

  const [{ data: rawPieces }, focusData, performances] = await Promise.all([
    supabase
      .from("pieces")
      .select("*")
      .eq("work_id", id)
      .order("name"),
    getWorkFocusData(id),
    getPerformances({ workId: id }),
  ]);

  const pieces = (rawPieces ?? []) as Piece[];

  return (
    <div className="mx-auto w-full max-w-3xl flex-1 px-4 py-6 sm:px-6">
      <Link
        href="/practice/repertoire"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
      >
        <ArrowLeftIcon className="size-3.5" />
        Back to repertoire
      </Link>

      <PerformancesPanel performances={performances} owner={{ workId: id }} />

      <WorkDetailHeader work={typedWork} />

      <div className="space-y-6">
        {/* Child pieces */}
        {pieces.length > 0 && (
          <div>
            <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
              Pieces ({pieces.length})
            </h3>
            <div className="space-y-1">
              {pieces.map((piece) => (
                <Link
                  key={piece.id}
                  href={`/practice/repertoire/${piece.id}`}
                  className="flex items-center justify-between rounded-md px-3 py-2 hover:bg-muted/50 transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{piece.name}</p>
                    {piece.composer && (
                      <p className="text-xs text-muted-foreground truncate">
                        {piece.composer}
                      </p>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}

        {focusData.assignments.length > 0 && <Separator />}

        <AssignmentList initialAssignments={focusData.assignments} />
      </div>
    </div>
  );
}
