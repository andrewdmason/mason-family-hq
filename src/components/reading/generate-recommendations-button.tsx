"use client";

import { useState, useTransition } from "react";
import { Sparkles, ChevronDown, MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { generateRecommendations } from "@/app/(reading)/reading/discover/actions";
import type { ReadingRecommendation } from "@/lib/types";

/**
 * Segmented "Get recommendations" control: the main button pulls from the whole
 * taste profile; the caret opens an age-appropriate genre menu to narrow a batch,
 * plus a "Custom…" option that opens a modal for a free-text request (e.g.
 * "historical fiction under 200 pages") appended to the recommender prompt.
 */
export function GenerateRecommendationsButton({
  memberEmail = null,
  genres = [],
  variant = "default",
  label = "Get recommendations",
  onResults,
}: {
  memberEmail?: string | null;
  genres?: string[];
  variant?: "default" | "outline";
  label?: string;
  /** Called with the freshly generated batch, so the parent can open the review. */
  onResults?: (recs: ReadingRecommendation[]) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState<string | null>(null);
  const [customOpen, setCustomOpen] = useState(false);
  const [customText, setCustomText] = useState("");

  function go(genre: string | null, request: string | null) {
    startTransition(async () => {
      setNote(null);
      try {
        const recs = await generateRecommendations(memberEmail, genre, request);
        if (recs.length === 0) {
          setNote(
            genre || request
              ? "No fresh picks matched — try a different ask."
              : "No fresh picks right now — try again after rating a few books."
          );
        } else {
          onResults?.(recs);
        }
      } catch {
        setNote("Couldn’t reach the recommender — try again.");
      }
    });
  }

  function submitCustom(e: React.FormEvent) {
    e.preventDefault();
    const text = customText.trim();
    if (!text) return;
    setCustomOpen(false);
    setCustomText("");
    go(null, text);
  }

  return (
    <div className="flex flex-col items-start gap-1.5">
      <div className="inline-flex">
        <Button
          type="button"
          variant={variant}
          disabled={pending}
          onClick={() => go(null, null)}
          className={genres.length > 0 ? "rounded-r-none" : undefined}
        >
          <Sparkles className={pending ? "animate-pulse" : undefined} />
          {pending ? "Finding books…" : label}
        </Button>
        {genres.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  type="button"
                  variant={variant}
                  disabled={pending}
                  aria-label="Recommend by genre or a custom request"
                  className="-ml-px rounded-l-none border-l border-l-black/15 px-2 dark:border-l-white/15"
                />
              }
            >
              <ChevronDown />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-auto min-w-44">
              <div className="px-1.5 py-1 text-xs font-medium text-muted-foreground">
                Recommend by genre
              </div>
              {genres.map((g) => (
                <DropdownMenuItem key={g} onClick={() => go(g, null)}>
                  {g}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setCustomOpen(true)}>
                <MoreHorizontal />
                Something specific…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {note && <p className="text-xs text-muted-foreground">{note}</p>}

      <Dialog
        open={customOpen}
        onOpenChange={(next) => {
          setCustomOpen(next);
          if (!next) setCustomText("");
        }}
      >
        <DialogContent>
          <form onSubmit={submitCustom} className="grid gap-3">
            <DialogHeader>
              <DialogTitle>What are you in the mood for?</DialogTitle>
              <DialogDescription>
                Describe the kind of book you want and we’ll fold it into the
                picks — still tuned to taste and age.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-1.5">
              <Label htmlFor="custom-request" className="sr-only">
                Your request
              </Label>
              <Textarea
                id="custom-request"
                value={customText}
                onChange={(e) => setCustomText(e.target.value)}
                placeholder="e.g. historical fiction set at sea, under 200 pages"
                rows={3}
                autoFocus
                maxLength={300}
              />
            </div>
            <DialogFooter showCloseButton>
              <Button type="submit" disabled={!customText.trim()}>
                <Sparkles />
                Get recommendations
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
