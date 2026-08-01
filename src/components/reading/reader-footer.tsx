"use client";

import { formatTimeLeft } from "@/lib/reading/reading-time";
import { cn } from "@/lib/utils";

/**
 * The quiet line along the bottom of a page: where you are in the chapter on the
 * left, how far through the book on the right.
 *
 * A page has fixed bounds, so unlike the scrolling header this never covers
 * text and never has to hide. That's why it can just stay there — the same
 * reason a printed book can afford a running foot.
 *
 * It ends where the text ends. A running foot that ran to the window edge read
 * as browser chrome sitting under the book; aligned to the column it reads as
 * part of the page, which is what it is.
 *
 * No page numbers, deliberately. Ours would change with the font size, and the
 * book's own are either absent (most EPUBs) or offset by however much front
 * matter the PDF had. A number that's quietly wrong is worse than no number.
 */
export function ReaderFooter({
  chapterTitle,
  chapterMinutesLeft,
  percent,
  minutesLeft,
  height,
  left,
  width,
}: {
  chapterTitle: string | null;
  chapterMinutesLeft: number | null;
  percent: number;
  minutesLeft: number | null;
  height: number;
  /** The text column's viewport bounds. Null until the page has been measured. */
  left: number | null;
  width: number | null;
}) {
  const chapterLeft = formatTimeLeft(chapterMinutesLeft);
  const bookLeft = formatTimeLeft(minutesLeft);
  const bounded = left != null && width != null;

  return (
    <div
      className={cn(
        "reader-chrome-secondary pointer-events-none fixed bottom-0 z-30 flex items-center justify-between gap-6 text-xs text-muted-foreground/70",
        !bounded && "inset-x-0 px-6"
      )}
      style={bounded ? { height, left, width } : { height }}
    >
      <span className="min-w-0 truncate">
        {chapterTitle}
        {chapterTitle && chapterLeft && " · "}
        {chapterLeft && <span className="tabular-nums">{chapterLeft}</span>}
      </span>
      <span className={cn("shrink-0 tabular-nums")}>
        {percent}%{bookLeft ? ` · ${bookLeft}` : ""}
      </span>
    </div>
  );
}
