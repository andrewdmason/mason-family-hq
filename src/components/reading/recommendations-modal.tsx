"use client";

import { useEffect, useState, useTransition } from "react";
import { BookPlus, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { BookCover } from "@/components/reading/book-cover";
import { InlineMarkdown } from "@/components/reading/inline-markdown";
import { RatingPicker } from "@/components/reading/rating-picker";
import { bookByline } from "@/lib/reading/byline";
import {
  dismissRecommendation,
  generateRecommendations,
  queueRecommendation,
  rateRecommendation,
} from "@/app/(reading)/reader/discover/actions";
import type { ReadingRating, ReadingRecommendation } from "@/lib/types";

/**
 * Reviews a batch of recommendations one at a time — a focused, cover-forward
 * card you act on (queue / rate / not interested) before advancing to the next.
 * After the last one it shows an "all caught up" screen with the option to pull a
 * fresh batch (now that the queue's been cleared) or close out.
 */
export function RecommendationsModal({
  recs,
  open,
  onOpenChange,
  memberEmail = null,
}: {
  recs: ReadingRecommendation[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  memberEmail?: string | null;
}) {
  const [items, setItems] = useState<ReadingRecommendation[]>(recs);
  const [index, setIndex] = useState(0);
  const [done, setDone] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Seed (and reset) from the batch each time the modal opens.
  useEffect(() => {
    if (open) {
      setItems(recs);
      setIndex(0);
      setDone(false);
      setNote(null);
    }
  }, [open, recs]);

  const total = items.length;
  const current = items[index];
  const byline = current
    ? bookByline(current.author, current.published_year)
    : null;

  function act(action: () => Promise<void>) {
    startTransition(async () => {
      try {
        await action();
      } catch {
        // Let the page state settle; advance regardless so review flows on.
      }
      if (index + 1 >= total) setDone(true);
      else setIndex(index + 1);
    });
  }

  function getMore() {
    startTransition(async () => {
      setNote(null);
      try {
        const next = await generateRecommendations(memberEmail);
        if (next.length === 0) {
          setNote("No fresh picks right now — try again after rating a few books.");
        } else {
          setItems(next);
          setIndex(0);
          setDone(false);
        }
      } catch {
        setNote("Couldn’t reach the recommender — try again.");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-center text-xs font-medium tracking-wide text-muted-foreground">
            {done
              ? "All caught up"
              : total > 0
                ? `${Math.min(index + 1, total)} of ${total}`
                : "Recommendations"}
          </DialogTitle>
        </DialogHeader>

        {done ? (
          <div className="flex flex-col items-center gap-4 px-2 pb-2 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-violet-500/20 to-indigo-500/15 text-violet-500">
              <Sparkles className="h-7 w-7" />
            </div>
            <div className="space-y-1">
              <p className="font-serif text-lg leading-tight text-foreground">
                You’re all caught up
              </p>
              <p className="text-sm text-muted-foreground">
                You’ve gone through all your recommendations.
              </p>
            </div>
            <div className="mt-1 flex w-full flex-col gap-2">
              <Button type="button" disabled={pending} onClick={getMore}>
                <Sparkles className={pending ? "animate-pulse" : undefined} />
                {pending ? "Finding books…" : "Get more recommendations"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={pending}
                onClick={() => onOpenChange(false)}
              >
                Close
              </Button>
            </div>
            {note && <p className="text-xs text-muted-foreground">{note}</p>}
          </div>
        ) : (
          current && (
            <div className="flex flex-col items-center gap-4 px-2 pb-2 text-center">
              <div className="w-40 sm:w-44">
                <BookCover
                  url={current.cover_image_url}
                  title={current.title}
                  size="lg"
                />
              </div>

              <div className="space-y-1">
                <p className="font-serif text-lg leading-tight text-foreground">
                  {current.title}
                </p>
                {byline && (
                  <p className="text-sm text-muted-foreground">{byline}</p>
                )}
              </div>

              {current.rationale && (
                <p className="text-sm italic leading-relaxed text-muted-foreground">
                  <InlineMarkdown text={current.rationale} />
                </p>
              )}

              <div className="mt-1 flex w-full flex-col items-center gap-3">
                <Button
                  type="button"
                  disabled={pending}
                  className="w-full"
                  onClick={() =>
                    act(() => queueRecommendation(current.id, memberEmail))
                  }
                >
                  <BookPlus />
                  Add to queue
                </Button>

                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Rate it</span>
                  <RatingPicker
                    value={null}
                    disabled={pending}
                    onSelect={(r: ReadingRating) =>
                      act(() => rateRecommendation(current.id, r, memberEmail))
                    }
                  />
                </div>

                <button
                  type="button"
                  disabled={pending}
                  className="text-xs text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline disabled:opacity-50"
                  onClick={() =>
                    act(() => dismissRecommendation(current.id, memberEmail))
                  }
                >
                  Not interested
                </button>
              </div>
            </div>
          )
        )}
      </DialogContent>
    </Dialog>
  );
}
