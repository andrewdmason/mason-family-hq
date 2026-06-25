"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { changeStretchTarget } from "@/app/(reading)/reader/actions";

/**
 * A small "Change" affordance next to a book's "Goal: Page N", so the reader can
 * push their target past the weekly goal (for bonus pages) — or dial it back down —
 * right where the goal is shown. Saving regenerates the stretch quiz to the new
 * range; bonus banks when that quiz is passed.
 */
export function ChangeTargetButton({
  bookId,
  targetPage,
  currentPage,
  totalPages,
  memberEmail = null,
}: {
  bookId: string;
  targetPage: number;
  currentPage: number;
  totalPages: number;
  memberEmail?: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(String(targetPage));
  const [note, setNote] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function openDialog() {
    setPage(String(targetPage));
    setNote(null);
    setOpen(true);
  }

  function save() {
    const n = page.trim() === "" ? NaN : Number(page);
    if (!Number.isFinite(n)) {
      setNote("Enter a page number.");
      return;
    }
    setNote(null);
    startTransition(async () => {
      try {
        await changeStretchTarget(bookId, Math.floor(n), memberEmail);
        setOpen(false);
        router.refresh();
      } catch (err) {
        setNote(err instanceof Error ? err.message : "Couldn't change the goal.");
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={openDialog}
        className="font-medium text-muted-foreground underline decoration-dotted underline-offset-2 transition-colors hover:text-foreground"
      >
        Change
      </button>

      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Change this week&apos;s goal</DialogTitle>
            <DialogDescription>
              Read past your goal for bonus pages, or set it back down to your
              weekly goal. The book ends at page {totalPages}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="goal-page">Goal page</Label>
            <Input
              id="goal-page"
              type="number"
              min={currentPage + 1}
              max={totalPages}
              value={page}
              onChange={(e) => setPage(e.target.value)}
              autoFocus
            />
          </div>
          {note && <p className="text-xs text-destructive">{note}</p>}
          <DialogFooter>
            <Button type="button" onClick={save} disabled={pending}>
              {pending ? "Updating…" : "Save goal"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
