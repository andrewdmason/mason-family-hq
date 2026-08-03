"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  renderedBlocks,
  textPositionAt,
  type RenderedBlocks,
} from "@/lib/reading/annotation-anchors";
import { blockIndexForCharOffset, type BookBlock } from "@/lib/reading/block-stream";
import { cueOnPage, type AudioCue } from "@/lib/reading/audio/types";
import {
  useAudiobook,
  useAudiobookControls,
} from "@/components/audiobook/audiobook-provider";

/**
 * Keeping the page and the voice together, in whichever direction you meant.
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
 * It doesn't hold you in place. Turn a single page while it's speaking and it
 * notices you've gone somewhere of your own accord and stops steering, and
 * offers both ways back: send the page to the voice, or send the voice to the
 * page. Being yanked back mid-sentence because the narrator is elsewhere is the
 * single most irritating thing a follow-along can do — and having to hunt for
 * the passage you just read with your eyes is the second.
 *
 * Neither direction happens by itself. Moving the voice to every page you turn
 * to would make flicking back a page to re-read a sentence rewind the narration
 * and lose the place you were actually up to, and flicking ahead to see how long
 * the chapter is would drag the voice with you. Both are worse than a button.
 *
 * It doesn't highlight on e-ink. A sentence highlight is a screen repaint every
 * few seconds, which on a Boox is either visible flashing or accumulated
 * ghosting. There it follows at page granularity only: the page turns when the
 * voice gets there and nothing else on screen moves.
 */

const HIGHLIGHT_NAME = "reader-listen";
const STYLE_ID = "reader-listen-highlight-style";

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

/**
 * Whether an element is currently on screen, allowing for the reader's chrome.
 *
 * Scrolling mode only, where "further on" means "further down" and this is the
 * whole question. A paged book runs sideways instead — see cueOnPage, which
 * answers it in characters and is what paged mode uses.
 */
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
  /** Put the voice where the reader is, and resume steering. */
  bringVoiceHere: () => void;
};

export function useAudiobookFollow({
  bookId,
  blocks,
  contentRef,
  base,
  layoutNonce,
  eink,
  currentCharOffset,
  pageCharEnd,
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
  /**
   * First character past the bottom of the page, in paged mode; null while the
   * book is scrolling, where the page has no end and the DOM is asked instead.
   */
  pageCharEnd: number | null;
  goToChar: (charOffset: number) => void;
  /** Report the voice's position as the reading position. */
  onPosition: (charOffset: number) => void;
}): AudiobookFollow {
  const { bookId: playingBookId, cue, status } = useAudiobook();
  const { listenFrom } = useAudiobookControls();
  const listening = playingBookId === bookId && status !== "idle";

  const lastCueRef = useRef<number | null>(null);
  const [following, setFollowing] = useState(true);

  /**
   * The sentence being spoken, readable without depending on it.
   *
   * The effect that notices YOU moved has to know where the VOICE is, but must
   * not re-run when the voice moves — that's the other effect's job, and the two
   * answer the same "not on this page" with opposite actions.
   */
  const cueRef = useRef<AudioCue | null>(null);
  cueRef.current = cue;

  /**
   * Whether we are the ones who just moved the page.
   *
   * Set by the steering effect, cleared by the one below it, which is what makes
   * the pair work: within one commit a steer runs first and the "you moved"
   * check has to sit that round out, because it is still holding the page
   * position from before the steer landed.
   */
  const steeredRef = useRef(false);

  /**
   * Is the voice on the page in front of you?
   *
   * Two answers, because the two reading modes disagree about what a page is.
   * Paged mode knows exactly which characters are showing, so it's arithmetic —
   * and it has to be, since every page of a paged book occupies the same
   * vertical band and asking the DOM whether an element is on screen would say
   * yes to the whole chapter. Scrolling has no such bounds, so it asks.
   */
  const voiceOnPage = useCallback(
    (at: AudioCue): boolean => {
      if (pageCharEnd != null) return cueOnPage(at, currentCharOffset, pageCharEnd);
      const container = contentRef.current;
      if (!container) return true;
      const view = renderedBlocks(container, base);
      const el = view.els[blockIndexForCharOffset(blocks, at.s) - view.base];
      return !!el && isVisible(el);
    },
    [base, blocks, contentRef, currentCharOffset, pageCharEnd]
  );

  const resume = useCallback(() => {
    setFollowing(true);
    const at = lastCueRef.current;
    if (at != null) {
      steeredRef.current = true;
      goToChar(at);
    }
  }, [goToChar]);

  const bringVoiceHere = useCallback(() => {
    setFollowing(true);
    listenFrom(currentCharOffset);
  }, [currentCharOffset, listenFrom]);

  /**
   * The voice reached a new sentence.
   *
   * Two things, deliberately together: recording the position and turning the
   * page have to see the same moment, and splitting them means the second reads
   * a world the first has already changed.
   */
  useEffect(() => {
    if (!listening) {
      steeredRef.current = false;
      lastCueRef.current = null;
      setFollowing(true);
      return;
    }
    if (!cue) return;

    // The voice's position IS the reading position — saved even when you've
    // wandered off, because what you last heard is still the furthest you've got.
    lastCueRef.current = cue.s;
    onPosition(cue.s);

    if (!following || voiceOnPage(cue)) {
      steeredRef.current = false;
      return;
    }
    // Read past the bottom of the page, or off into another chapter of the
    // rendered window — either way, go there.
    steeredRef.current = true;
    goToChar(cue.s);
    // voiceOnPage is read, not depended on: it changes whenever the PAGE moves,
    // and this runs when the VOICE does. Listing it would turn every page turn
    // of yours into a page turn of ours, which is the opposite of the point.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cue, following, goToChar, layoutNonce, listening, onPosition]);

  /**
   * You moved the page.
   *
   * The same "the voice isn't on this page" the effect above acts on, arrived at
   * from the other side: there the voice moved, here the page did, and only one
   * of those is an instruction. A single page turn is enough — nothing is
   * measured in a tolerance, so a nudge forward to see how the paragraph ends
   * counts exactly as much as skipping a chapter, which is what makes the two
   * controls appear when you'd expect them to and not two turns later.
   *
   * We never catch ourselves doing it: a steer of ours ends with the voice on
   * the page by construction, and steeredRef covers the commit where the page
   * has moved but this effect is still holding the position from before it.
   */
  useEffect(() => {
    if (!listening || !following) return;
    if (steeredRef.current) {
      steeredRef.current = false;
      return;
    }
    const at = cueRef.current;
    if (!at || voiceOnPage(at)) return;
    setFollowing(false);
  }, [following, listening, voiceOnPage]);

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

  return { listening, following, resume, bringVoiceHere };
}
