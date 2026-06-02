"use client";

import { useState, useTransition } from "react";
import { rateBook } from "@/app/(reading)/reading/actions";
import { RatingPicker } from "@/components/reading/rating-picker";
import type { ReadingRating } from "@/lib/types";

/**
 * Inline rating for a book already on the shelf. Tapping an emoji saves it; tapping
 * the current rating again clears it. Optimistic, with a quiet revert on failure.
 */
export function RatingControl({
  bookId,
  rating,
  memberEmail = null,
}: {
  bookId: string;
  rating: ReadingRating | null;
  memberEmail?: string | null;
}) {
  const [value, setValue] = useState<ReadingRating | null>(rating);
  const [pending, startTransition] = useTransition();

  function handleSelect(next: ReadingRating) {
    const resolved = value === next ? null : next; // tap again to clear
    const previous = value;
    setValue(resolved);
    startTransition(async () => {
      try {
        await rateBook(bookId, resolved, memberEmail);
      } catch {
        setValue(previous);
      }
    });
  }

  return (
    <RatingPicker value={value} onSelect={handleSelect} disabled={pending} size="sm" />
  );
}
