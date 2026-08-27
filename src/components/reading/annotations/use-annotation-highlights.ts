"use client";

import { useEffect } from "react";
import { rangeForAnchor, renderedBlocks } from "@/lib/reading/annotation-anchors";
import {
  annotationKind,
  annotationOrigin,
  type AnnotationKind,
  type AnnotationOrigin,
  type AnnotationSummary,
} from "@/lib/reading/annotation-types";

/**
 * Keeps annotated passages marked in the text, the way Kindle and Instapaper do.
 *
 * Uses the CSS Custom Highlight API rather than wrapping the text in <mark>
 * elements. That matters here: the content is React-owned via
 * dangerouslySetInnerHTML, and the whole anchoring scheme depends on the DOM
 * matching what the anchors were measured against. Painting without touching
 * the DOM keeps both invariants intact — and it survives overlapping ranges,
 * which nested <mark>s would not.
 *
 * The styling is injected here rather than living in globals.css: Lightning CSS
 * (Tailwind v4's parser) doesn't recognise `::highlight()` and drops the rule at
 * build time. Injecting it at runtime hands the selector to the browser, which
 * does understand it — and ties the stylesheet's existence to the same feature
 * check as the highlights themselves.
 */
type Treatment = `${AnnotationOrigin}-${AnnotationKind}`;

const REGISTRY: Record<Treatment, string> = {
  "mine-highlight": "reader-annot-mine-highlight",
  "mine-thread": "reader-annot-mine-thread",
  "theirs-highlight": "reader-annot-theirs-highlight",
  "theirs-thread": "reader-annot-theirs-thread",
};
const ACTIVE_REGISTRY: Record<Treatment, string> = {
  "mine-highlight": "reader-annot-mine-highlight-active",
  "mine-thread": "reader-annot-mine-thread-active",
  "theirs-highlight": "reader-annot-theirs-highlight-active",
  "theirs-thread": "reader-annot-theirs-thread-active",
};
const STYLE_ID = "reader-annotation-highlight-style";

/**
 * Four treatments: two colours, two weights.
 *
 * COLOUR says whose mark it is — yellow for yours, teal for one somebody left
 * you. WEIGHT says what is in it — a wash for a passage merely marked, an
 * underline for one with words on it.
 *
 * Purple is retired. It existed only to tell a chat from a note, and that
 * distinction is gone; reclaiming yellow for everything of yours is what lets
 * somebody else's marks own a second colour without the page carrying three.
 *
 * ONE colour for "somebody else", not one per person. The API is keyed by name
 * and its rules are static, so per-member tints would mean a registry entry and
 * an injected rule per family member, re-injected whenever the family changed.
 * More to the point: a page can carry two colour meanings — mine and not mine —
 * and cannot carry six without becoming a chart. WHO it was lives in the gutter,
 * where there is room for a face.
 *
 * Both underlined states also carry a faint wash of their own colour, and that
 * redundancy is deliberate: `::highlight()` accepts only a short list of
 * properties, and while text-decoration is on the spec's list and Chromium
 * honours it, WebKit shipped colour and background-color only and I could not
 * confirm current Safari has caught up. If the decoration is dropped there, a
 * note and a chat still read as distinct tints instead of collapsing together.
 *
 * Opening something intensifies its own colour rather than switching to a
 * shared "active" look, so a mark never changes identity just by being open.
 *
 * Text colour is left alone throughout, so the serif body reads exactly as it
 * does unmarked.
 */
function ensureHighlightStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  const YELLOW = "oklch(0.86 0.13 92)";
  const THEIRS = "oklch(0.68 0.11 195)";
  const underline = (color: string, thickness: string) =>
    `text-decoration:underline;text-decoration-color:${color};` +
    `text-decoration-thickness:${thickness};text-underline-offset:3px;` +
    `text-decoration-skip-ink:none;`;
  style.textContent = [
    `::highlight(${REGISTRY["mine-highlight"]}){background-color:color-mix(in oklab, ${YELLOW} 42%, transparent);}`,
    `::highlight(${ACTIVE_REGISTRY["mine-highlight"]}){background-color:color-mix(in oklab, ${YELLOW} 68%, transparent);}`,

    `::highlight(${REGISTRY["mine-thread"]}){background-color:color-mix(in oklab, ${YELLOW} 16%, transparent);${underline(YELLOW, "2px")}}`,
    `::highlight(${ACTIVE_REGISTRY["mine-thread"]}){background-color:color-mix(in oklab, ${YELLOW} 34%, transparent);${underline(YELLOW, "3px")}}`,

    // Dashed, and no wash at all, for a passage somebody pointed at without
    // saying anything about it — the lightest mark the page can carry.
    `::highlight(${REGISTRY["theirs-highlight"]}){${underline(THEIRS, "2px").replace("underline;", "underline;text-decoration-style:dashed;")}}`,
    `::highlight(${ACTIVE_REGISTRY["theirs-highlight"]}){background-color:color-mix(in oklab, ${THEIRS} 20%, transparent);${underline(THEIRS, "3px")}}`,

    `::highlight(${REGISTRY["theirs-thread"]}){background-color:color-mix(in oklab, ${THEIRS} 10%, transparent);${underline(THEIRS, "2px")}}`,
    `::highlight(${ACTIVE_REGISTRY["theirs-thread"]}){background-color:color-mix(in oklab, ${THEIRS} 24%, transparent);${underline(THEIRS, "3px")}}`,
  ].join("\n");
  document.head.append(style);
}

export function useAnnotationHighlights(
  annotations: AnnotationSummary[],
  contentRef: React.RefObject<HTMLDivElement | null>,
  openAnnotationId: string | null,
  layoutNonce: number,
  /** Global index of the first rendered block — see RenderedBlocks. */
  base: number
) {
  useEffect(() => {
    if (typeof CSS === "undefined" || !("highlights" in CSS)) return;
    const container = contentRef.current;
    if (!container) return;
    ensureHighlightStyles();

    const empty = (): Record<Treatment, Range[]> => ({
      "mine-highlight": [],
      "mine-thread": [],
      "theirs-highlight": [],
      "theirs-thread": [],
    });
    const buckets = empty();
    const activeBuckets = empty();
    // Queried once for the whole pass, not once per annotation. Annotations
    // whose blocks aren't in this window resolve to null and simply don't paint.
    const view = renderedBlocks(container, base);
    for (const a of annotations) {
      const range = rangeForAnchor(a.anchor, container, view);
      if (!range) continue;
      // An unplaced share has an anchor only as a formality — the passage was
      // never found in this copy — so it must not paint over an arbitrary
      // sentence. It is still in the index and still reachable by its link.
      if (a.anchorStatus === "unplaced") continue;
      const target = a.id === openAnnotationId ? activeBuckets : buckets;
      target[`${annotationOrigin(a)}-${annotationKind(a)}`].push(range);
    }

    // The one-annotation model removes the common overlap — a note and a chat on
    // the same passage are one row with one treatment. Two DISTINCT annotations
    // can still overlap though (mark half a sentence, then chat about the whole
    // paragraph), so priority decides who paints on top: the one carrying more
    // content wins, and whatever is open wins outright.
    const paint = (name: string, ranges: Range[], priority: number) => {
      const highlight = new Highlight(...ranges);
      highlight.priority = priority;
      CSS.highlights.set(name, highlight);
    };
    // Priority: more content wins over less, somebody else's wins over your own
    // — a passage you both marked should show that it came from them — and
    // whatever is open wins outright.
    paint(REGISTRY["mine-highlight"], buckets["mine-highlight"], 1);
    paint(REGISTRY["theirs-highlight"], buckets["theirs-highlight"], 2);
    paint(REGISTRY["mine-thread"], buckets["mine-thread"], 3);
    paint(REGISTRY["theirs-thread"], buckets["theirs-thread"], 4);
    paint(ACTIVE_REGISTRY["mine-highlight"], activeBuckets["mine-highlight"], 5);
    paint(ACTIVE_REGISTRY["theirs-highlight"], activeBuckets["theirs-highlight"], 6);
    paint(ACTIVE_REGISTRY["mine-thread"], activeBuckets["mine-thread"], 7);
    paint(ACTIVE_REGISTRY["theirs-thread"], activeBuckets["theirs-thread"], 8);

    return () => {
      for (const name of Object.values(REGISTRY)) CSS.highlights.delete(name);
      for (const name of Object.values(ACTIVE_REGISTRY)) CSS.highlights.delete(name);
    };
  }, [annotations, base, contentRef, openAnnotationId, layoutNonce]);
}

/**
 * The annotation whose passage contains a click, if any — so tapping the mark
 * opens it, not just the margin icon.
 *
 * Smallest match wins. With overlapping annotations the tighter range is the
 * more specific thing you were pointing at; picking the first would hand every
 * click to whichever happens to be earliest in the list.
 */
export function annotationAtPoint(
  annotations: AnnotationSummary[],
  container: HTMLElement,
  x: number,
  y: number,
  /** Global index of the first rendered block — see RenderedBlocks. */
  base: number
): AnnotationSummary | null {
  // Every tap in the book comes through here, including the ones that are just
  // turning a page, so it has to be free when there's nothing to hit.
  if (annotations.length === 0) return null;

  let best: AnnotationSummary | null = null;
  let bestSize = Infinity;
  const view = renderedBlocks(container, base);
  for (const a of annotations) {
    const range = rangeForAnchor(a.anchor, container, view);
    if (!range) continue;
    let hit = false;
    let size = 0;
    for (const rect of range.getClientRects()) {
      size += rect.width * rect.height;
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
        hit = true;
      }
    }
    if (hit && size < bestSize) {
      best = a;
      bestSize = size;
    }
  }
  return best;
}
