"use client";

import { useEffect } from "react";
import { rangeForAnchor } from "@/lib/reading/annotation-anchors";
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
const ACTIVE = "reader-annot-active";
const STYLE_ID = "reader-annotation-highlight-style";

/**
 * Three treatments, one per state:
 *   highlight - yellow wash, the plain "I marked this"
 *   note      - yellow underline, so a passage you wrote on reads differently
 *               from one you merely marked
 *   chat      - the existing purple wash, which already means "conversation"
 *
 * The note gets a faint yellow background IN ADDITION to its underline, and
 * that redundancy is deliberate. `::highlight()` accepts only a short list of
 * properties; text-decoration is on the spec's list and Chromium honours it,
 * but WebKit's original implementation took only colour and background-color
 * and I could not confirm from source that current Safari has caught up. If the
 * decoration is dropped there, a note still reads as a distinct, lighter yellow
 * rather than becoming indistinguishable from a highlight. Worth checking in
 * Safari; harmless either way.
 *
 * Text colour is deliberately left alone in all three, so the serif body reads
 * exactly as it does unmarked.
 */
function ensureHighlightStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  const YELLOW = "oklch(0.86 0.13 92)";
  style.textContent = [
    `::highlight(${REGISTRY.highlight}){background-color:color-mix(in oklab, ${YELLOW} 42%, transparent);}`,
    `::highlight(${REGISTRY.note}){background-color:color-mix(in oklab, ${YELLOW} 16%, transparent);` +
      `text-decoration:underline;text-decoration-color:${YELLOW};` +
      `text-decoration-thickness:2px;text-underline-offset:3px;}`,
    `::highlight(${REGISTRY.chat}){background-color:color-mix(in oklab, var(--primary) 14%, transparent);}`,
    `::highlight(${ACTIVE}){background-color:color-mix(in oklab, var(--primary) 30%, transparent);}`,
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
    const active: Range[] = [];
    for (const a of annotations) {
      const range = rangeForAnchor(a.anchor, container);
      if (!range) continue;
      if (a.id === openAnnotationId) active.push(range);
      else buckets[annotationKind(a)].push(range);
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
    paint(ACTIVE, active, 4);

    return () => {
      for (const name of Object.values(REGISTRY)) CSS.highlights.delete(name);
      CSS.highlights.delete(ACTIVE);
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
  let best: AnnotationSummary | null = null;
  let bestSize = Infinity;
  for (const a of annotations) {
    const range = rangeForAnchor(a.anchor, container);
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
