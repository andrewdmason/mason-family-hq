"use client";

import { useState } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GenerateRecommendationsButton } from "@/components/reading/generate-recommendations-button";
import { RecommendationsModal } from "@/components/reading/recommendations-modal";
import type { ReadingRecommendation } from "@/lib/types";

/**
 * The recommender entry point at the top of the Queue tab. Two states:
 *  - picks waiting → a highlighted "ready to review" card; you must clear them
 *    (review the batch) before pulling more, so the focus stays on one set.
 *  - nothing waiting → the generate control (whole taste, by genre, or custom).
 * Either way, reviewing opens the focused one-at-a-time modal.
 */
export function QueueRecommendations({
  recommendations,
  hasSignal,
  genres = [],
  memberEmail = null,
}: {
  recommendations: ReadingRecommendation[];
  hasSignal: boolean;
  genres?: string[];
  memberEmail?: string | null;
}) {
  const [batch, setBatch] = useState<ReadingRecommendation[]>([]);
  const [open, setOpen] = useState(false);

  function review(recs: ReadingRecommendation[]) {
    if (recs.length === 0) return;
    setBatch(recs);
    setOpen(true);
  }

  const pendingCount = recommendations.length;
  const hasPending = pendingCount > 0;

  return (
    <>
      {hasPending ? (
        <div className="mt-3 flex flex-col gap-3 rounded-lg border border-violet-400/40 bg-gradient-to-br from-violet-500/15 via-fuchsia-500/10 to-indigo-500/10 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2.5">
            <Sparkles className="h-5 w-5 shrink-0 text-violet-500" />
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">
                Recommendations ready for you
              </p>
              <p className="text-xs text-muted-foreground">
                Review your {pendingCount} pick{pendingCount === 1 ? "" : "s"} —
                clear them to get more.
              </p>
            </div>
          </div>
          <Button
            type="button"
            onClick={() => review(recommendations)}
            className="bg-violet-600 text-white hover:bg-violet-700"
          >
            Review {pendingCount} pick{pendingCount === 1 ? "" : "s"}
          </Button>
        </div>
      ) : (
        <div className="mt-3 flex flex-col gap-3 rounded-lg border border-dashed border-border px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">
              Looking for your next read?
            </p>
            <p className="text-xs text-muted-foreground">
              {hasSignal
                ? "Get fresh picks based on what you’ve loved, one at a time."
                : "Rate a few books you’ve read so the picks fit your taste."}
            </p>
          </div>
          <GenerateRecommendationsButton
            memberEmail={memberEmail}
            genres={genres}
            onResults={review}
          />
        </div>
      )}

      <RecommendationsModal
        recs={batch}
        open={open}
        onOpenChange={setOpen}
        memberEmail={memberEmail}
      />
    </>
  );
}
