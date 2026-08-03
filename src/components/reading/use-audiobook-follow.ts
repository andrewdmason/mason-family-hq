"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  renderedBlocks,
  textPositionAt,
  type RenderedBlocks,
} from "@/lib/reading/annotation-anchors";
import { blockIndexForCharOffset, type BookBlock } from "@/lib/reading/block-stream";
import { useAudiobook } from "@/components/audiobook/audiobook-provider";

/**
 * Keeping the page with the voice.
 *
 * The reader stores where you are as a character offset into the converted
 * text, and the narration's timing map says which characters are being spoken
 * right now. Those are the same numbers, so following along needs no measuring,
 * no matching and no second notion of position: the sentence being spoken IS a
 * character range, the page turns when that range leaves the page, and the
 * moment you stop listening your reading position is wherever the voice got to.
 *
 * That last part is the point. Listening position and reading position are one
 * value, not two — close the phone mid-chapter, open the laptop, and you are at
 * that paragraph with nothing to reconcile.
 *
 * Two things it deliberately does NOT do:
 *
 * It doesn't hold you in place. Turn a page while it's speaking and it notices
 * you've gone somewhere of your own accord and stops steering; a control
 * appears to send you back to the voice when you want it. Being yanked back
 * mid-sentence because the narrator is elsewhere is the single most irritating
 * thing a follow-along can do.
 *
 * It doesn't highlight on e-ink. A sentence highlight is a screen repaint every
 * few seconds, which on a Boox is either visible flashing or accumulated
 * ghosting. There it follows at page granularity only: the page turns when the
 * voice gets there and nothing else on screen moves.
 */

const HIGHLIGHT_NAME = "reader-listen";
const STYLE_ID = "reader-listen-highlight-style";

/**
 * How far the reader can be from where we put them before we conclude they
 * moved themselves. Comfortably more than a page turn's worth of characters at
 * the largest type size, so following never switches itself off by accident.
 */
const WANDER_CHARS = 3_000;

/**
 * A soft wash rather than the annotation yellow.
 *
 * It has to be legible for hours and it has to be distinguishable at a glance
 * from a passage you marked — those two live in the same text and mean
 * completely different things. Injected at runtime for the same reason as the
 * annotation highlights: Tailwind's CSS parser doesn't recognise `::highlight()`
 * and drops the rule at build time.
 */
function ensureHighlightStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `::highlight(${HIGHLIGHT_NAME}){background-color:color-mix(in oklab, oklch(0.62 0.11 240) 20%, transparent);}`;
  document.head.append(style);
}

/** A DOM range covering a book character range, if it's on the page at all. */
function rangeForChars(
  blocks: BookBlock[],
  view: RenderedBlocks,
  from: number,
  to: number
): Range | null {
  const startIndex = blockIndexForCharOffset(blocks, from);
  const endIndex = blockIndexForCharOffset(blocks, Math.max(from, to - 1));
  const startEl = view.els[startIndex - view.base];
  const endEl = view.els[endIndex - view.base];
  if (!startEl || !endEl) return null;

  const startBlock = blocks[startIndex];
  const endBlock = blocks[endIndex];
  if (!startBlock || !endBlock) return null;

  const start = textPositionAt(startEl, Math.max(0, from - startBlock.charStart));
  const end = textPositionAt(
    endEl,
    Math.min(endBlock.text.length, Math.max(0, to - endBlock.charStart))
  );
  if (!start || !end) return null;

  const range = startEl.ownerDocument.createRange();
  try {
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
  } catch {
    return null;
  }
  return range.collapsed ? null : range;
}

/** Whether an element is currently on screen, allowing for the reader's chrome. */
function isVisible(el: HTMLElement): boolean {
  const rect = el.getBoundingClientRect();
  if (rect.height === 0 && rect.width === 0) return false;
  return rect.bottom > 72 && rect.top < window.innerHeight - 16;
}

export type AudiobookFollow = {
  /** True when this book is the one being spoken. */
  listening: boolean;
  /** True while the page is steering itself to match the voice. */
  following: boolean;
  /** Put the reader back where the voice is, and resume steering. */
  resume: () => void;
};

export function useAudiobookFollow({
  bookId,
  blocks,
  contentRef,
  base,
  layoutNonce,
  eink,
  currentCharOffset,
  goToChar,
  onPosition,
}: {
  bookId: string;
  blocks: BookBlock[];
  contentRef: React.RefObject<HTMLDivElement | null>;
  /** Global index of the first rendered block — see RenderedBlocks. */
  base: number;
  layoutNonce: number;
  eink: boolean;
  currentCharOffset: number;
  goToChar: (charOffset: number) => void;
  /** Report the voice's position as the reading position. */
  onPosition: (charOffset: number) => void;
}): AudiobookFollow {
  const { bookId: playingBookId, cue, status } = useAudiobook();
  const listening = playingBookId === bookId && status !== "idle";

  /**
   * Where we last steered the reader, and where the reader was when we did.
   *
   * Both are read only when a new sentence arrives, never during render, and
   * together they answer the one question that matters: between that sentence
   * and this one, did the page move because we moved it, or because you did?
   */
  const steeredToRef = useRef<number | null>(null);
  const lastCueRef = useRef<number | null>(null);
  const [following, setFollowing] = useState(true);

  const resume = useCallback(() => {
    setFollowing(true);
    const at = lastCueRef.current;
    if (at != null) {
      steeredToRef.current = at;
      goToChar(at);
    }
  }, [goToChar]);

  /**
   * Everything that happens when the voice reaches a new sentence.
   *
   * Deliberately one effect rather than three. The three things — noticing you
   * moved, turning the page, recording the position — have to see the same
   * "before" state, and splitting them means each reads a world the others have
   * already changed. Reading is a sequence of moments; this is one of them.
   */
  useEffect(() => {
    if (!listening) {
      steeredToRef.current = null;
      lastCueRef.current = null;
      setFollowing(true);
      return;
    }
    if (!cue) return;

    // The voice's position IS the reading position — saved even when you've
    // wandered off, because what you last heard is still the furthest you've got.
    lastCueRef.current = cue.s;
    onPosition(cue.s);

    // Did the page move under its own steam since the last sentence? Compared
    // against where we put it, not against the voice: the voice has just moved
    // on, so comparing to that would read every ordinary sentence as a wander.
    const steered = steeredToRef.current;
    let steering = following;
    if (steering && steered != null && Math.abs(currentCharOffset - steered) > WANDER_CHARS) {
      steering = false;
      setFollowing(false);
    }
    if (!steering) return;

    const container = contentRef.current;
    if (!container) return;
    const view = renderedBlocks(container, base);
    const el = view.els[blockIndexForCharOffset(blocks, cue.s) - view.base];

    // Off the page entirely (another chapter of the rendered window), or on it
    // but scrolled past — either way, go there.
    if (!el || !isVisible(el)) {
      steeredToRef.current = cue.s;
      goToChar(cue.s);
    }
    // currentCharOffset is read, not depended on: this runs when the VOICE
    // moves, not when the page does. Listing it would re-run the wander check on
    // every page turn and compare the reader against a position they had already
    // left, which reads every deliberate page turn as a wander.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, blocks, contentRef, cue, following, goToChar, layoutNonce, listening, onPosition]);

  // Paint the sentence being spoken. Skipped entirely on e-ink.
  useEffect(() => {
    if (eink || !listening || !cue) return;
    if (typeof CSS === "undefined" || !("highlights" in CSS)) return;
    const container = contentRef.current;
    if (!container) return;

    ensureHighlightStyle();
    const view = renderedBlocks(container, base);
    const range = rangeForChars(blocks, view, cue.s, cue.e);
    if (!range) {
      CSS.highlights.delete(HIGHLIGHT_NAME);
      return;
    }
    // Above the annotation marks, which sit at 1-6: the spoken line is the one
    // thing on the page that is moving, and it has to stay findable inside a
    // passage you have also highlighted.
    const highlight = new Highlight(range);
    highlight.priority = 10;
    CSS.highlights.set(HIGHLIGHT_NAME, highlight);

    return () => {
      CSS.highlights.delete(HIGHLIGHT_NAME);
    };
  }, [base, blocks, contentRef, cue, eink, layoutNonce, listening]);

  return { listening, following, resume };
}
