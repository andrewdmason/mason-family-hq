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
import {
  changeStretchTarget,
  listChapterGoalOptions,
  type ChapterGoalOption,
} from "@/app/(reading)/reader/actions";

/**
 * A small "Change" affordance next to a book's goal, so the reader can push their
 * target past the weekly goal (for bonus pages) — or dial it back down — right
 * where the goal is shown. Books with a real chapter list get a chapter picker
 * ("Finish Chapter 8"); everything else keeps the exact-page input. Saving
 * regenerates the stretch quiz to the new range; bonus banks when it's passed.
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
  const [chapters, setChapters] = useState<ChapterGoalOption[] | null>(null);
  const [loadingChapters, setLoadingChapters] = useState(false);
  const [chapterIndex, setChapterIndex] = useState<number | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // A book with a chapter list gets the chapter picker; everything else keeps the
  // exact-page input. (Chapter books have no real page numbers to offer.)
  const hasChapters = !!chapters && chapters.length > 0;

  function openDialog() {
    setPage(String(targetPage));
    setNote(null);
    setChapters(null);
    setChapterIndex(null);
    setOpen(true);
    // Chapter goals are only offered for books with a real chapter list; fetch
    // them lazily so the reading list stays light.
    setLoadingChapters(true);
    listChapterGoalOptions(bookId, memberEmail)
      .then((opts) => {
        setChapters(opts);
        if (opts.length > 0) setChapterIndex(opts[0].index);
      })
      .catch(() => setChapters([]))
      .finally(() => setLoadingChapters(false));
  }

  function save() {
    setNote(null);
    if (hasChapters) {
      if (chapterIndex == null) {
        setNote("Pick a chapter.");
        return;
      }
      startTransition(async () => {
        try {
          await changeStretchTarget(bookId, { chapterIndex }, memberEmail);
          setOpen(false);
          router.refresh();
        } catch (err) {
          setNote(err instanceof Error ? err.message : "Couldn't change the goal.");
        }
      });
      return;
    }
    const n = page.trim() === "" ? NaN : Number(page);
    if (!Number.isFinite(n)) {
      setNote("Enter a page number.");
      return;
    }
    startTransition(async () => {
      try {
        await changeStretchTarget(bookId, { targetPage: Math.floor(n) }, memberEmail);
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
              Aim further for bonus reading, or set it back to your weekly goal.
              {/* Only reference a page number for books with real pages — a
                  chapter book's pages are estimates and just confuse. */}
              {!loadingChapters && !hasChapters
                ? ` The book ends at page ${totalPages}.`
                : ""}
            </DialogDescription>
          </DialogHeader>

          {loadingChapters ? (
            <p className="text-xs text-muted-foreground">Loading chapters…</p>
          ) : hasChapters ? (
            <div className="space-y-1.5">
              <Label htmlFor="goal-chapter">Read through</Label>
              <select
                id="goal-chapter"
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={chapterIndex ?? ""}
                onChange={(e) => setChapterIndex(Number(e.target.value))}
                autoFocus
              >
                {chapters!.map((c) => (
                  <option key={c.index} value={c.index}>
                    {c.title}
                  </option>
                ))}
              </select>
            </div>
          ) : (
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
          )}

          {note && <p className="text-xs text-destructive">{note}</p>}
          <DialogFooter>
            <Button type="button" onClick={save} disabled={pending || loadingChapters}>
              {pending ? "Updating…" : "Save goal"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
