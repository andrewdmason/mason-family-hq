"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  listChapterLocationOptions,
  updateBook,
  type ChapterGoalOption,
} from "@/app/(reading)/reader/actions";
import type { ReadingBook } from "@/lib/types";

/** Sentinel "current location" value: the reader hasn't finished any chapter. */
export const LOCATION_NOT_STARTED = -1;

/** "Chapter 8" from a bare "8"; leaves named sections ("Prologue") untouched. */
function chapterDisplayName(title: string): string {
  const t = title.trim();
  return /^\d{1,3}$/.test(t) ? `Chapter ${t}` : t;
}

/**
 * The chapter to preselect for a book's current location: the last chapter the
 * reader has already finished, or "not started" when they're still in the first.
 */
export function preselectLocation(options: ChapterGoalOption[]): number {
  for (let i = options.length - 1; i >= 0; i--) {
    if (options[i].alreadyRead) return options[i].index;
  }
  return LOCATION_NOT_STARTED;
}

/** The page a chosen location maps to: the finished chapter's end page (0 = none). */
export function locationToPage(
  options: ChapterGoalOption[],
  value: number
): number {
  if (value === LOCATION_NOT_STARTED) return 0;
  return options.find((o) => o.index === value)?.endPage ?? 0;
}

/**
 * A "which chapter has the reader finished?" picker, shared by the standalone
 * ChangeLocationDialog and the Edit book dialog. Presentational and controlled —
 * the parent owns the chapter list and the selected value. Picking a chapter means
 * the reader has read *through* the end of it (current_page = its end page).
 */
export function CurrentLocationField({
  id,
  label = "Finished through",
  options,
  value,
  onChange,
}: {
  id: string;
  label?: string;
  options: ChapterGoalOption[];
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <select
        id={id}
        className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      >
        <option value={LOCATION_NOT_STARTED}>Not started yet</option>
        {options.map((c) => (
          <option key={c.index} value={c.index}>
            {chapterDisplayName(c.title)}
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * A focused editor for where a reader currently is in a book. Chapter books get
 * the chapter picker; everything else (real-page PDFs, articles) falls back to a
 * page number so the control still works for every book. Saving reuses updateBook,
 * which re-anchors this week's progress baseline and re-tracks the goal.
 */
export function ChangeLocationDialog({
  book,
  memberEmail = null,
  open,
  onOpenChange,
}: {
  book: ReadingBook;
  memberEmail?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [options, setOptions] = useState<ChapterGoalOption[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [value, setValue] = useState<number>(LOCATION_NOT_STARTED);
  const [page, setPage] = useState(String(book.current_page));
  const [note, setNote] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Reset to a fresh loading state (wrapped so the effect body has no direct
  // setState — see the same pattern in EditBookDialog.syncFromBook).
  function resetForm() {
    setNote(null);
    setOptions(null);
    setValue(LOCATION_NOT_STARTED);
    setPage(String(book.current_page));
    setLoading(true);
  }

  // Load the chapter list (and reset the form) each time the dialog opens.
  useEffect(() => {
    if (!open) return;
    resetForm();
    listChapterLocationOptions(book.id, memberEmail)
      .then((loaded) => {
        if (loaded) {
          setOptions(loaded.options);
          setValue(preselectLocation(loaded.options));
        } else {
          setOptions(null);
        }
      })
      .catch(() => setOptions(null))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, book.id, book.current_page, memberEmail]);

  const hasChapters = !!options && options.length > 0;

  function save() {
    setNote(null);
    let nextPage: number;
    if (hasChapters) {
      nextPage = locationToPage(options!, value);
    } else {
      const n = page.trim() === "" ? NaN : Number(page);
      if (!Number.isFinite(n) || n < 0) {
        setNote("Enter a page of 0 or more.");
        return;
      }
      nextPage = Math.floor(n);
    }
    startTransition(async () => {
      try {
        await updateBook(book.id, { currentPage: nextPage, memberEmail });
        onOpenChange(false);
        router.refresh();
      } catch (err) {
        setNote(
          err instanceof Error ? err.message : "Couldn't change the location."
        );
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !pending && onOpenChange(o)}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Change current location</DialogTitle>
          <DialogDescription>
            Set where {book.title} is being read now — the goal re-tracks from
            here.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <p className="text-xs text-muted-foreground">Loading chapters…</p>
        ) : hasChapters ? (
          <CurrentLocationField
            id="change-location-chapter"
            options={options!}
            value={value}
            onChange={setValue}
          />
        ) : (
          <div className="grid gap-1.5">
            <Label htmlFor="change-location-page">Current page</Label>
            <Input
              id="change-location-page"
              type="number"
              min={0}
              max={book.total_pages ?? undefined}
              value={page}
              onChange={(e) => setPage(e.target.value)}
            />
          </div>
        )}

        {note && <p className="text-xs text-destructive">{note}</p>}
        <DialogFooter>
          <Button type="button" onClick={save} disabled={pending || loading}>
            {pending ? "Saving…" : "Save location"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
