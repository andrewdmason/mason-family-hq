"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { formatCost } from "@/lib/reading/audio/constants";
import { estimatePlainCost } from "@/lib/reading/plain/constants";

/**
 * The one question asked before a whole book is translated.
 *
 * Says what will happen (this paragraph, then this chapter, then the rest in
 * the background), what it will roughly cost, and — for a novel — that the
 * style may be the point. The estimate is labelled "about" because it is: the
 * model's thinking is billed and reruns re-bill, so the figure is a measured
 * rate rather than a list price. See PLAIN_DOLLARS_PER_1K_CHARS.
 */
export function PlainEnglishDialog({
  open,
  onOpenChange,
  charCount,
  fiction,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  charCount: number | null;
  fiction: boolean | null;
  onConfirm: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cost = charCount != null && charCount > 0 ? estimatePlainCost(charCount) : null;

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't turn on Plain English.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Read this book in plain English?</DialogTitle>
          <DialogDescription>
            Every paragraph, rewritten in plain prose. Same ideas, same length, the ornament
            taken out.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm text-muted-foreground">
              <p>
                Quotations stay in the author&apos;s words, and the original is always one tap
                away. The chapter you&apos;re in comes first, then the next one, and the rest of
                the book follows in the background. Anyone in the family who has this book
                gets the same translation.
              </p>
              {fiction === true && (
                <p className="text-foreground">
                  This is a novel. The style may be the point — Plain English works best on
                  books you&apos;re reading for the ideas.
                </p>
              )}
              {cost != null && (
                <p>
                  Cost: about <span className="tabular-nums text-foreground">{formatCost(cost)}</span>{" "}
                  for the whole book, once.
                </p>
              )}
              {error && <p className="text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Not now
          </Button>
          <Button onClick={() => void confirm()} disabled={busy}>
            {busy ? "Starting…" : "Turn on Plain English"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
