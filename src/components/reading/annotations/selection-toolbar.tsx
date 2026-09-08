"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import {
  ArrowRightToLine,
  BookOpenText,
  Highlighter,
  Languages,
  MessageSquareQuote,
} from "lucide-react";
import { PAGE_PAD_BOTTOM, PAGE_PAD_TOP } from "@/lib/reading/paged-geometry";
import { cn } from "@/lib/utils";
import { useFinePointer, useSelectionRange } from "./use-selection-range";

/**
 * Two things a passage can become.
 *
 * "Highlight" marks it on the page and lands it in your notes, where the
 * thought about it goes — and where, by typing @, it can become a conversation
 * with the AI or with somebody in the family. "Ask" is the fast path to the
 * first of those: a conversation about the passage, now, without going through
 * the notes. There used to be a "Note" here that started a conversation with
 * nobody in it; the notepad is where that writing goes now.
 *
 * Two most of the time. A book that ALREADY has a Plain English translation
 * gets a third: "face" shows the passage in the other face — plain for a
 * passage you're reading in the original, the author's words for one you're
 * reading in plain. It opens the panel and makes no mark. Books nobody has
 * translated don't offer it: the peek would be the first the reader ever heard
 * of the feature, out of a menu that should stay about the passage. The touch
 * bar lays actions out flex-1 inside PAGE_PAD_BOTTOM, so the third is budgeted
 * as an icon with a short label rather than by growing the bar.
 */
export type SelectionIntent = "highlight" | "ask" | "face";

/** Air between the popover and the line it hangs off. */
const GAP = 8;
/** Closest the popover comes to the window's edge. */
const MARGIN = 8;

const ACTIONS: {
  intent: SelectionIntent;
  label: string;
  Icon: typeof Highlighter;
}[] = [
  { intent: "highlight", label: "Highlight", Icon: Highlighter },
  { intent: "ask", label: "Ask", Icon: MessageSquareQuote },
];

/**
 * Select a passage, get a few things to do with it.
 *
 * Two shells, same actions:
 *
 * - Fine pointer: a small popover floating above the line the reader let go
 *   on, where the cursor already is. Above it, unless that line is the first
 *   on the page — then there is nothing up there but the running head, and the
 *   popover drops beneath the line instead. Measured after render and clamped
 *   to the window, the same way the glossary popover is (term-popover.tsx).
 * - Touch: a fixed bar along the bottom edge. NOT a bottom sheet — that is a
 *   Base UI Dialog with a backdrop (see bottom-sheet.tsx), and opening one moves
 *   focus and dims the page, which on iOS collapses the selection you just made.
 *
 * The bottom edge is chosen because iOS puts its own callout menu (Copy, Look
 * Up, Share) adjacent to the selection, and no web API can suppress, extend or
 * move it. Rather than fight for that space we stay out of it, and long-press
 * selection stays entirely native — which is what the reader has always
 * deliberately protected.
 *
 * Android is the one platform where the native menu CAN be taken away, and it
 * is: see the displace step in use-selection-range.ts, which is what stops
 * Chrome's action bar (Copy / Share / Select all / Web search) from burying
 * these actions on the Boox. The bottom placement stays regardless — it is
 * still right for iOS, and there is nothing to gain from two touch layouts.
 *
 * `-webkit-touch-callout: none` would be the wrong tool on either: it governs
 * the long-press callout on links and images, not the text-selection edit menu,
 * and applying it to the content would break normal link behaviour in articles.
 */
export function SelectionToolbar({
  contentRef,
  onAct,
  disabled,
  faceAction = null,
  onContinue = null,
  onSelectionChange,
}: {
  contentRef: React.RefObject<HTMLDivElement | null>;
  onAct: (range: Range, intent: SelectionIntent) => void;
  disabled: boolean;
  /**
   * Which way the fourth action points, or null for none (articles). "plain"
   * offers Plain English; "original" offers the author's words.
   */
  faceAction?: "plain" | "original" | null;
  /**
   * "Continue": hold this selection's start and turn the page, so the passage
   * can end on the next one — see use-held-selection.ts. Null when there is no
   * next page to turn to, or no pages at all (scrolling, articles).
   */
  onContinue?: ((range: Range) => void) | null;
  /** The settled selection, or null once it's gone — for painting the held start up to it. */
  onSelectionChange?: (range: Range | null) => void;
}) {
  const { spot, clear } = useSelectionRange(contentRef, disabled);
  const finePointer = useFinePointer();

  const range = spot?.range ?? null;
  useEffect(() => {
    onSelectionChange?.(range);
  }, [range, onSelectionChange]);

  // Placed by hand, before paint, straight onto the element: the popover has to
  // be measured to be centred and clamped, and a render round-trip for that
  // would paint it once in the wrong place first.
  const popoverRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = popoverRef.current;
    if (!el || !spot) return;
    const box = el.getBoundingClientRect();
    const left = Math.min(
      Math.max(spot.x - box.width / 2, MARGIN),
      window.innerWidth - box.width - MARGIN
    );
    // Above the line unless that would put it in the header band. Below is
    // always available: a line at the very foot of the page still has the
    // running foot under it, which is more than the popover needs.
    const above = spot.top - GAP - box.height;
    const top = above >= PAGE_PAD_TOP ? above : spot.bottom + GAP;
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }, [spot, faceAction, onContinue]);

  // Hidden rather than cleared while busy, so a stale position can't flash back.
  if (!spot || disabled) return null;

  const act = (intent: SelectionIntent) => {
    onAct(spot.range, intent);
    clear();
  };

  const actions: { key: string; label: string; Icon: typeof Highlighter; run: () => void }[] =
    ACTIONS.map(({ intent, label, Icon }) => ({ key: intent, label, Icon, run: () => act(intent) }));
  if (faceAction) {
    actions.push(
      faceAction === "plain"
        ? { key: "face", label: "Plain", Icon: Languages, run: () => act("face") }
        : { key: "face", label: "Original", Icon: BookOpenText, run: () => act("face") }
    );
  }
  if (onContinue && spot.atPageEnd) {
    // Only for a selection that has run into the edge of the page — see
    // SelectionSpot.atPageEnd. Last, and after the passage's own actions: it's
    // the one that doesn't finish anything. The touch bar has room for it as
    // an icon with a word.
    actions.push({
      key: "continue",
      label: "Continue",
      Icon: ArrowRightToLine,
      run: () => {
        onContinue(spot.range);
        clear();
      },
    });
  }

  const buttons = actions.map(({ key, label, Icon, run }) => (
    <button
      key={key}
      type="button"
      // Keep the selection alive: a pointerdown elsewhere would collapse it
      // before the click handler ever runs. pointerdown rather than mousedown,
      // because on touch the synthesized mousedown arrives far too late.
      onPointerDown={(e) => e.preventDefault()}
      onClick={run}
      className={cn(
        "flex items-center gap-1.5 rounded-md font-medium text-foreground transition-colors hover:bg-muted",
        finePointer
          ? "px-2.5 py-1.5 text-xs"
          : "flex-1 justify-center px-3 py-2.5 text-sm"
      )}
    >
      <Icon className={finePointer ? "h-3.5 w-3.5" : "h-4 w-4"} />
      {label}
    </button>
  ));

  if (finePointer) {
    return (
      <div
        ref={popoverRef}
        className="fixed z-50 flex items-center gap-0.5 rounded-md border border-border bg-background p-0.5 shadow-md"
        // Overwritten by the layout effect above before the first paint. React
        // leaves these alone on later renders because the props never change.
        style={{ left: 0, top: 0 }}
      >
        {buttons}
      </div>
    );
  }

  return (
    <div
      // Opaque, not the usual translucent-with-a-blur chrome. This lands on top
      // of the running foot (reader-footer.tsx, z-30, PAGE_PAD_BOTTOM tall), and
      // in e-ink mode that foot is forced to pure black — so even a 5% bleed
      // through a /95 background came back as legible text once the panel's
      // dithering was done with it, and the bar read as two labels printed over
      // each other. A backdrop blur is the wrong instinct on e-ink anyway: it
      // costs a grey wash the display then has to approximate.
      className="fixed inset-x-0 bottom-0 z-50 flex items-center border-t border-border bg-background shadow-lg"
      style={{
        // Cover the foot rather than sit on it — anything shorter leaves a strip
        // of progress text peering out under the buttons.
        minHeight: PAGE_PAD_BOTTOM,
        // Clear of the home indicator on iPhone; a no-op everywhere else.
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
    >
      <div className="mx-auto flex w-full max-w-md items-center gap-1 px-2 py-1.5">
        {buttons}
      </div>
    </div>
  );
}
