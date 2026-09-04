"use client";

import { useMemo } from "react";
import { blockIndexForCharOffset, type BookBlock } from "@/lib/reading/block-stream";
import type { PageGeometry } from "@/lib/reading/paged-geometry";
import { PAGE_PAD_TOP } from "@/lib/reading/paged-geometry";
import {
  PLAIN_TERM_ATTR,
  PLAIN_TERM_CLASS,
  escapeHtml,
  termsHtml,
} from "@/lib/reading/plain/render";
import type { PlainBlock, PlainChapter, PlainTerm } from "@/lib/reading/plain/types";
import type { ReaderSettings } from "@/lib/reading/reader-settings";
import { cn } from "@/lib/utils";
import { BOOK_PROSE, typographyStyle } from "./reader-prose";

/**
 * The translation, beside the page.
 *
 * In side-by-side the book itself is laid out exactly as before, one column
 * wide, in the LEFT half of a two-column spread; this pane sits where the right
 * column would be and shows the plain English of whatever paragraphs the left
 * page is showing. Turning the page turns both.
 *
 * Deliberately a companion, not a second paged flow. Aligning two paginated
 * columns paragraph for paragraph would mean a new pagination engine (rows, not
 * columns) for a layout that is only ever read on a wide screen; showing the
 * plain paragraphs for the page's blocks gets the reader the same comparison
 * and reuses every position primitive the reader already has. Whole
 * paragraphs, so a paragraph that starts on the previous page is still shown
 * in full; if they run longer than the page, the pane scrolls.
 *
 * Positioned as a sibling of the paged view rather than inside it, so a tap or
 * a drag in here never turns a page.
 */
export function SideBySidePane({
  blocks,
  fromChar,
  toChar,
  chapters,
  plainBlocks,
  terms,
  geometry,
  settings,
  bottomInset,
  onTermTap,
}: {
  blocks: BookBlock[];
  /** The char range the page shows, half-open. */
  fromChar: number;
  toChar: number | null;
  chapters: PlainChapter[];
  plainBlocks: ReadonlyMap<number, PlainBlock>;
  terms: PlainTerm[];
  /** The book's geometry, with `cols` already forced to one — see usePagination. */
  geometry: PageGeometry;
  settings: ReaderSettings;
  bottomInset: number;
  onTermTap: (anchor: HTMLElement, term: PlainTerm) => void;
}) {
  const html = useMemo(() => {
    if (blocks.length === 0) return "";
    const first = blockIndexForCharOffset(blocks, fromChar);
    const end = toChar == null ? blocks.length : Math.max(first + 1, blockIndexForCharOffset(blocks, Math.max(fromChar, toChar - 1)) + 1);
    const ready = new Set(chapters.filter((c) => c.status === "ready").map((c) => c.index));
    const patterns = terms
      .map((t) => {
        const escaped = t.term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        return escaped
          ? { term: t.term, firstChapterIndex: t.firstChapterIndex, pattern: new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "iu") }
          : null;
      })
      .filter((t): t is { term: string; firstChapterIndex: number; pattern: RegExp } => t != null);
    const seen = new Set<string>();
    const noted = new Set<number>();

    let out = "";
    for (let i = first; i < end && i < blocks.length; i++) {
      const block = blocks[i];
      if (block.tag !== "p" || block.text.trim().length === 0) continue;
      const chapter = chapters.find((c) => i >= c.blockStart && i < c.blockEnd);
      const plain = plainBlocks.get(i);
      if (chapter && ready.has(chapter.index) && plain) {
        if (plain.kept || plain.text == null) {
          out += `<p class="opacity-70">${escapeHtml(block.text)}</p>`;
        } else {
          const eligible = patterns.filter((t) => t.firstChapterIndex <= chapter.index);
          out += `<p>${termsHtml(plain.text, eligible, seen)}</p>`;
        }
        continue;
      }
      // Not translated yet. One note per chapter, not one per paragraph.
      const key = chapter?.index ?? -1;
      if (noted.has(key)) continue;
      noted.add(key);
      const label =
        chapter?.status === "failed"
          ? "Couldn't translate this chapter. Retry from the menu."
          : chapter
            ? "Translating this chapter…"
            : "No translation for this part of the book.";
      out += `<p class="font-sans text-[0.8em] text-muted-foreground">${escapeHtml(label)}</p>`;
    }
    return out;
  }, [blocks, chapters, fromChar, plainBlocks, terms, toChar]);

  return (
    <div
      aria-label="Plain English, beside the page"
      className={cn(
        "fixed z-30 overflow-y-auto font-serif text-foreground",
        BOOK_PROSE,
        // Same paragraph rhythm as the page; the hairline says which half is which.
        "border-l border-border/60 pl-6"
      )}
      style={{
        left: geometry.offsetX + geometry.colStride,
        top: PAGE_PAD_TOP,
        width: geometry.colW,
        height: geometry.pageH - bottomInset,
        ...typographyStyle(settings),
      }}
      onClick={(e) => {
        const span = (e.target as HTMLElement | null)?.closest<HTMLElement>(`.${PLAIN_TERM_CLASS}`);
        if (!span) return;
        const name = span.getAttribute(PLAIN_TERM_ATTR);
        const term = terms.find((t) => t.term === name);
        if (term) onTermTap(span, term);
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
