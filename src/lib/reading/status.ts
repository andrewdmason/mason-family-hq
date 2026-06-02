import type { ReadingBookStatus } from "@/lib/types";

/** Display order + labels for book statuses, shared by tabs, badges, and selects. */
export const READING_STATUSES: { value: ReadingBookStatus; label: string }[] = [
  { value: "in_progress", label: "Reading" },
  { value: "queued", label: "Queue" },
  { value: "completed", label: "Completed" },
  { value: "paused", label: "Paused" },
  { value: "archived", label: "Archived" },
];

const LABELS: Record<ReadingBookStatus, string> = Object.fromEntries(
  READING_STATUSES.map((s) => [s.value, s.label])
) as Record<ReadingBookStatus, string>;

export function readingStatusLabel(status: ReadingBookStatus): string {
  return LABELS[status] ?? status;
}
