"use client";

import { useEffect } from "react";
import { rangeForAnchor } from "@/lib/reading/chat-anchors";
import type { ReaderChatSummary } from "@/lib/reading/chat-types";

/**
 * Keeps the passages you've started chats on highlighted in the book, the way
 * Kindle and Notion do.
 *
 * Uses the CSS Custom Highlight API rather than wrapping the text in <mark>
 * elements. That matters here: the book HTML is React-owned via
 * dangerouslySetInnerHTML, and the whole anchoring scheme depends on the DOM
 * matching the converter's block/character stream exactly. Painting highlights
 * without touching the DOM keeps both invariants intact — and it survives
 * highlights that overlap, which nested <mark>s would not.
 *
 * The styling is injected here rather than living in globals.css: Lightning CSS
 * (Tailwind v4's parser) doesn't recognise `::highlight()` and drops the rule at
 * build time. Injecting it at runtime hands the selector to the browser, which
 * does understand it — and ties the stylesheet's existence to the same feature
 * check as the highlights themselves.
 */
const ALL = "reader-chat";
const ACTIVE = "reader-chat-active";
const STYLE_ID = "reader-chat-highlight-style";

/**
 * Only the background is set: ::highlight() honours a short list of properties,
 * and leaving the text colour alone keeps the serif body reading exactly as it
 * does unhighlighted.
 */
function ensureHighlightStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = [
    `::highlight(${ALL}){background-color:color-mix(in oklab, var(--primary) 14%, transparent);}`,
    `::highlight(${ACTIVE}){background-color:color-mix(in oklab, var(--primary) 30%, transparent);}`,
  ].join("\n");
  document.head.append(style);
}

export function useChatHighlights(
  chats: ReaderChatSummary[],
  contentRef: React.RefObject<HTMLDivElement | null>,
  openChatId: string | null,
  layoutNonce: number
) {
  useEffect(() => {
    if (typeof CSS === "undefined" || !("highlights" in CSS)) return;
    const container = contentRef.current;
    if (!container) return;
    ensureHighlightStyles();

    const resting: Range[] = [];
    const active: Range[] = [];
    for (const chat of chats) {
      const range = rangeForAnchor(chat.anchor, container);
      if (!range) continue;
      (chat.id === openChatId ? active : resting).push(range);
    }

    CSS.highlights.set(ALL, new Highlight(...resting));
    CSS.highlights.set(ACTIVE, new Highlight(...active));

    return () => {
      CSS.highlights.delete(ALL);
      CSS.highlights.delete(ACTIVE);
    };
  }, [chats, contentRef, openChatId, layoutNonce]);
}

/**
 * The chat whose highlighted passage contains a click, if any — so tapping the
 * highlight opens its conversation, not just the margin icon.
 */
export function chatAtPoint(
  chats: ReaderChatSummary[],
  container: HTMLElement,
  x: number,
  y: number
): ReaderChatSummary | null {
  for (const chat of chats) {
    const range = rangeForAnchor(chat.anchor, container);
    if (!range) continue;
    for (const rect of range.getClientRects()) {
      if (
        x >= rect.left &&
        x <= rect.right &&
        y >= rect.top &&
        y <= rect.bottom
      ) {
        return chat;
      }
    }
  }
  return null;
}
