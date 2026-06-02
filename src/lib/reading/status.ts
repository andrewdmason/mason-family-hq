import type { ReadingBookStatus, ReadingRating } from "@/lib/types";

/**
 * Whether a rating implies the reader got to the end. Loved/liked/okay do; a
 * "didn't finish" obviously doesn't, and a "didn't like" takes no position on
 * whether they read it — so neither is treated as finished.
 */
export function ratingImpliesFinished(rating: ReadingRating | null): boolean {
  return rating === "loved" || rating === "liked" || rating === "neutral";
}

/** Display order + labels for book statuses, shared by tabs, badges, and selects. */
export const READING_STATUSES: { value: ReadingBookStatus; label: string }[] = [
  { value: "in_progress", label: "Reading" },
  { value: "queued", label: "Queue" },
  { value: "archive", label: "Archive" },
  { value: "paused", label: "Paused" },
];

const LABELS: Record<ReadingBookStatus, string> = Object.fromEntries(
  READING_STATUSES.map((s) => [s.value, s.label])
) as Record<ReadingBookStatus, string>;

export function readingStatusLabel(status: ReadingBookStatus): string {
  return LABELS[status] ?? status;
}
