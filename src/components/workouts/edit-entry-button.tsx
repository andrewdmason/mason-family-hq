"use client";

import { useMemo, useState, useTransition } from "react";
import { Pencil, Search, Loader2, ArrowRight } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  swapEntryMovement,
  getMovementOptions,
} from "@/app/(workouts)/workouts/actions";
import { SetEditor } from "@/components/workouts/set-editor";
import type { SetView } from "@/lib/workouts/queries";

type PickerMovement = { id: string; name: string; aliases: string[] };

/**
 * Per-entry edit affordance: a pencil next to a movement that opens a dialog to
 * change the movement (typeahead over the whole library). When `sets` are passed
 * (WOD movements, whose sets have no inline editors), the dialog also lets you
 * log what you actually did — e.g. a scaled load or fewer reps than prescribed.
 */
export function EditEntryButton({
  entryId,
  sessionId,
  movementName,
  sets = [],
}: {
  entryId: string;
  sessionId: string;
  movementName: string;
  sets?: SetView[];
}) {
  const [open, setOpen] = useState(false);
  const [movements, setMovements] = useState<PickerMovement[] | null>(null);
  const [loadingList, setLoadingList] = useState(false);
  const [query, setQuery] = useState("");
  const [pending, startTransition] = useTransition();

  function openDialog() {
    setOpen(true);
    if (!movements) {
      setLoadingList(true);
      startTransition(async () => {
        const list = await getMovementOptions();
        setMovements(list);
        setLoadingList(false);
      });
    }
  }

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !movements) return [];
    return movements
      .filter((m) => m.name.toLowerCase() !== movementName.toLowerCase())
      .filter(
        (m) =>
          m.name.toLowerCase().includes(q) ||
          m.aliases.some((a) => a.toLowerCase().includes(q)),
      )
      .slice(0, 8);
  }, [query, movements, movementName]);

  function changeMovement(id: string) {
    startTransition(async () => {
      await swapEntryMovement(entryId, sessionId, id);
      setOpen(false);
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={openDialog}
        aria-label={`Edit ${movementName}`}
        className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <Pencil className="size-3.5" />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col text-left">
          <DialogHeader>
            <DialogTitle>Edit “{movementName}”</DialogTitle>
            <DialogDescription>
              {sets.length > 0
                ? "Change the movement, or log what you actually did."
                : "Change the movement for this entry."}
            </DialogDescription>
          </DialogHeader>

          <div className="-mx-1 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-1">
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Movement
              </span>
              <div className="relative">
                <Search className="absolute top-1/2 left-2 size-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  autoFocus={sets.length === 0}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search to change the movement…"
                  className="h-9 w-full rounded-md border border-input bg-background pr-2 pl-8 text-sm focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
              {loadingList && (
                <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Loader2 className="size-3.5 animate-spin" />
                  Loading movements…
                </p>
              )}
              {results.length > 0 && (
                <div className="max-h-48 divide-y divide-border/60 overflow-y-auto rounded-md border border-border">
                  {results.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      disabled={pending}
                      onClick={() => changeMovement(m.id)}
                      className="flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-accent disabled:opacity-60"
                    >
                      <span className="truncate text-foreground">{m.name}</span>
                      <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" />
                    </button>
                  ))}
                </div>
              )}
              {query.trim() && !loadingList && results.length === 0 && (
                <p className="text-xs text-muted-foreground">No matches.</p>
              )}
            </div>

            {sets.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Your result
                </span>
                {sets.map((s, i) => (
                  <SetEditor
                    key={s.id}
                    set={s}
                    sessionId={sessionId}
                    index={i}
                    label={sets.length === 1 ? "Rx" : undefined}
                  />
                ))}
              </div>
            )}
          </div>

          <DialogFooter>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
            >
              Done
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
