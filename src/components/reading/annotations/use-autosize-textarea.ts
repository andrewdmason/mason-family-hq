"use client";

import { useLayoutEffect } from "react";

/**
 * Grow a composer to fit what's been typed into it, up to a ceiling.
 *
 * The reader's two composers are both two rows tall, which is right for a
 * question and wrong for the thing you actually write into a preface — an
 * answer about why you're reading a book runs to a paragraph, and typing it
 * into a two-line slot means writing something you can only see the end of.
 *
 * The floor stays in CSS (`min-h-*` on the element) rather than being measured
 * here: a composer that shrank to one line the moment you cleared it would make
 * the panel's footer jump every time you sent something.
 *
 * Ceiling rather than unbounded, because this box shares a fixed-height column
 * with the transcript it belongs to — past a certain point growing the composer
 * is just taking the conversation off screen.
 */
export function useAutosizeTextarea(
  ref: React.RefObject<HTMLTextAreaElement | null>,
  /** Re-measures whenever this changes — including back to empty on send. */
  value: string,
  maxHeightPx = 160
) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    const fit = () => {
      // Collapsed first, so shortening the text shrinks the box again rather
      // than leaving it at its high-water mark.
      el.style.height = "auto";
      // scrollHeight covers content and padding but not the border, and these
      // boxes are border-box — without adding it back the text sits two pixels
      // short and the box scrolls by a hair on every line.
      const style = getComputedStyle(el);
      const border =
        parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
      const wanted = el.scrollHeight + border;
      el.style.height = `${Math.min(wanted, maxHeightPx)}px`;
      el.style.overflowY = wanted > maxHeightPx ? "auto" : "hidden";
    };

    fit();

    // Width changes rewrap the text, which changes how tall it needs to be:
    // docking the panel, dragging the window, rotating a phone. Guarded on the
    // width actually changing, because fit() alters the height and an unguarded
    // observer would answer its own callback forever.
    let lastWidth = el.clientWidth;
    const observer = new ResizeObserver(() => {
      if (el.clientWidth === lastWidth) return;
      lastWidth = el.clientWidth;
      fit();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [maxHeightPx, ref, value]);
}
