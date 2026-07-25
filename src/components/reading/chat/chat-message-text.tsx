"use client";

import { Fragment } from "react";

// Built per call: a shared /g regex carries `lastIndex` between renders, so a
// module-level one would start matching from wherever the previous message
// stopped and silently drop citations.
const citationRe = () => /\[p\.(\d+)\]/g;

/**
 * Assistant text with "[p.212]" citations turned into jump chips.
 *
 * The model always cites by page because that's the addressing scheme the book
 * text carries, but page numbers are only shown to the reader when the book has
 * real ones. On a synthetic-page book (the common case for EPUB uploads) the
 * reader sees a percentage in the progress pill, so the chip shows a percentage
 * too — same jump, a label that matches what's on screen.
 */
export function ChatMessageText({
  text,
  hasRealPages,
  labelForPage,
  onJumpToPage,
}: {
  text: string;
  hasRealPages: boolean;
  /** Percent-through-the-book for a page, when real page numbers aren't shown. */
  labelForPage: (page: number) => string | null;
  onJumpToPage: (page: number) => void;
}) {
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;

  const re = citationRe();
  while ((match = re.exec(text)) !== null) {
    const page = Number(match[1]);
    const label = hasRealPages ? `p.${page}` : labelForPage(page);
    // A citation we can't label meaningfully is dropped rather than shown as a
    // number that corresponds to nothing the reader can see.
    if (cursor < match.index) parts.push(text.slice(cursor, match.index));
    if (label) {
      parts.push(
        <button
          key={`${match.index}-${page}`}
          type="button"
          onClick={() => onJumpToPage(page)}
          className="mx-0.5 inline-flex items-baseline rounded bg-muted px-1.5 py-0.5 align-baseline text-[0.8em] font-medium tabular-nums text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
          title="Jump to this passage"
        >
          {label}
        </button>
      );
    }
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) parts.push(text.slice(cursor));

  return (
    <>
      {parts.map((p, i) => (
        <Fragment key={i}>{p}</Fragment>
      ))}
    </>
  );
}
