"use client";

import { cn } from "@/lib/utils";
import type { ReadingRating } from "@/lib/types";

/**
 * The rating scale, in display order, shared by every rating surface. The first
 * four are emoji sentiments for a book you read; "didnt_finish" is an outcome
 * (you put it down), shown as a "DNF" chip so it reads differently from a feeling.
 */
export const RATING_OPTIONS: {
  value: ReadingRating;
  emoji: string | null;
  chip: string | null;
  label: string;
}[] = [
  { value: "loved", emoji: "❤️", chip: null, label: "Loved" },
  { value: "liked", emoji: "👍", chip: null, label: "Liked" },
  { value: "neutral", emoji: "😐", chip: null, label: "Okay" },
  { value: "didnt_finish", emoji: null, chip: "DNF", label: "Didn’t finish" },
  { value: "disliked", emoji: "👎", chip: null, label: "Didn’t like" },
];

/** The glyph for a stored rating (emoji, or "DNF"), e.g. for read-only display. */
export function ratingGlyph(rating: ReadingRating): string {
  const option = RATING_OPTIONS.find((o) => o.value === rating);
  return option?.emoji ?? option?.chip ?? "";
}

/**
 * A row of buttons for rating a book. Controlled: the parent owns `value` and
 * decides what `onSelect` does (e.g. toggle off when the same one is tapped).
 */
export function RatingPicker({
  value,
  onSelect,
  disabled = false,
  size = "default",
}: {
  value: ReadingRating | null;
  onSelect: (rating: ReadingRating) => void;
  disabled?: boolean;
  size?: "sm" | "default";
}) {
  return (
    <div className="flex items-center gap-1" role="group" aria-label="Rate this book">
      {RATING_OPTIONS.map((option) => {
        const selected = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            disabled={disabled}
            aria-label={option.label}
            aria-pressed={selected}
            title={option.label}
            onClick={() => onSelect(option.value)}
            className={cn(
              "flex items-center justify-center rounded-md border transition-all disabled:opacity-50",
              size === "sm" ? "h-8 min-w-8 px-1.5" : "h-10 min-w-10 px-2",
              option.emoji
                ? size === "sm"
                  ? "text-base"
                  : "text-lg"
                : "text-[11px] font-semibold uppercase tracking-wide",
              selected
                ? "border-primary bg-primary/10 scale-105"
                : "border-transparent opacity-50 hover:opacity-100 hover:border-border"
            )}
          >
            <span aria-hidden>{option.emoji ?? option.chip}</span>
          </button>
        );
      })}
    </div>
  );
}
