"use client";

import { useEffect } from "react";
import { blockElements, rangeForAnchor } from "@/lib/reading/annotation-anchors";
import {
  annotationKind,
  type AnnotationKind,
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
const REGISTRY: Record<AnnotationKind, string> = {
  highlight: "reader-annot-highlight",
  note: "reader-annot-note",
  chat: "reader-annot-chat",
};
const ACTIVE_REGISTRY: Record<AnnotationKind, string> = {
  highlight: "reader-annot-highlight-active",
  note: "reader-annot-note-active",
  chat: "reader-annot-chat-active",
};
const STYLE_ID = "reader-annotation-highlight-style";

/**
 * Three treatments, one per state:
 *   highlight - yellow wash, the plain "I marked this"
 *   note      - yellow underline, so a passage you wrote on reads differently
 *               from one you merely marked
 *   chat      - purple underline, the same grammar in a different colour
 *
 * The purple is spelled out rather than reusing `var(--primary)`, which is what
 * the chat highlight used before. That token is oklch(0.45 0.08 35) — a warm
 * terracotta, not a purple — so chats have never actually been the colour they
 * were described as. Marks are their own vocabulary and shouldn't drift with
 * the app's accent anyway.
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
  const PURPLE = "oklch(0.55 0.19 300)";
  const underline = (color: string, thickness: string) =>
    `text-decoration:underline;text-decoration-color:${color};` +
    `text-decoration-thickness:${thickness};text-underline-offset:3px;` +
    `text-decoration-skip-ink:none;`;
  style.textContent = [
    `::highlight(${REGISTRY.highlight}){background-color:color-mix(in oklab, ${YELLOW} 42%, transparent);}`,
    `::highlight(${ACTIVE_REGISTRY.highlight}){background-color:color-mix(in oklab, ${YELLOW} 68%, transparent);}`,

    `::highlight(${REGISTRY.note}){background-color:color-mix(in oklab, ${YELLOW} 16%, transparent);${underline(YELLOW, "2px")}}`,
    `::highlight(${ACTIVE_REGISTRY.note}){background-color:color-mix(in oklab, ${YELLOW} 34%, transparent);${underline(YELLOW, "3px")}}`,

    `::highlight(${REGISTRY.chat}){background-color:color-mix(in oklab, ${PURPLE} 10%, transparent);${underline(PURPLE, "2px")}}`,
    `::highlight(${ACTIVE_REGISTRY.chat}){background-color:color-mix(in oklab, ${PURPLE} 22%, transparent);${underline(PURPLE, "3px")}}`,
  ].join("\n");
  document.head.append(style);
}

export function useAnnotationHighlights(
  annotations: AnnotationSummary[],
  contentRef: React.RefObject<HTMLDivElement | null>,
  openAnnotationId: string | null,
  layoutNonce: number
) {
  useEffect(() => {
    if (typeof CSS === "undefined" || !("highlights" in CSS)) return;
    const container = contentRef.current;
    if (!container) return;
    ensureHighlightStyles();

    const buckets: Record<AnnotationKind, Range[]> = {
      highlight: [],
      note: [],
      chat: [],
    };
    const activeBuckets: Record<AnnotationKind, Range[]> = {
      highlight: [],
      note: [],
      chat: [],
    };
    // Queried once for the whole pass, not once per annotation.
    const els = blockElements(container);
    for (const a of annotations) {
      const range = rangeForAnchor(a.anchor, container, els);
      if (!range) continue;
      const target = a.id === openAnnotationId ? activeBuckets : buckets;
      target[annotationKind(a)].push(range);
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
    paint(REGISTRY.highlight, buckets.highlight, 1);
    paint(REGISTRY.note, buckets.note, 2);
    paint(REGISTRY.chat, buckets.chat, 3);
    paint(ACTIVE_REGISTRY.highlight, activeBuckets.highlight, 4);
    paint(ACTIVE_REGISTRY.note, activeBuckets.note, 5);
    paint(ACTIVE_REGISTRY.chat, activeBuckets.chat, 6);

    return () => {
      for (const name of Object.values(REGISTRY)) CSS.highlights.delete(name);
      for (const name of Object.values(ACTIVE_REGISTRY)) CSS.highlights.delete(name);
    };
  }, [annotations, contentRef, openAnnotationId, layoutNonce]);
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
  y: number
): AnnotationSummary | null {
  // Every tap in the book comes through here, including the ones that are just
  // turning a page, so it has to be free when there's nothing to hit.
  if (annotations.length === 0) return null;

  let best: AnnotationSummary | null = null;
  let bestSize = Infinity;
  const els = blockElements(container);
  for (const a of annotations) {
    const range = rangeForAnchor(a.anchor, container, els);
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
