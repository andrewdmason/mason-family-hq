"use client";

// Chooses the event panel's container: an anchored popover next to the clicked
// event block on desktop (Notion Calendar style — the grid stays visible), or
// a snap-point bottom sheet on phones. Also owns the dismissal rules shared by
// both: an outside-press / Escape close request is ignored while a nested
// picker (date grid, time list, select) is open, and blocked with a save-bar
// pulse while there are unsaved edits — explicit Cancel/X/save are the ways
// out of a dirty panel.
//
// The desktop popover is hand-positioned (fixed, right of the anchor, flipping
// left and clamping into the viewport) rather than Base UI Popover: a
// triggerless controlled popover anchored to an arbitrary grid block fights
// the library's trigger-centric store, and we need bespoke dismissal anyway.

import * as React from "react";
import { createPortal } from "react-dom";
import { XIcon } from "lucide-react";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { NestedOverlayContext } from "@/components/ui/nested-overlay";
import { Button } from "@/components/ui/button";
import type {
  CalendarMember,
  CalendarSource,
  EventDuties,
  EventDuty,
} from "@/lib/calendar/types";
import { EventPanelContent, type PanelMode } from "./event-panel";

const PANEL_WIDTH = 384; // w-96
const MARGIN = 8; // viewport edge + anchor gap

export function EventPanelHost({
  mode,
  anchorEventId,
  panelKey,
  onClose,
  members,
  sources,
  canManage,
  canRsvp,
  sourceLabel,
  going,
  onToggleGoing,
  onChangeOwner,
  duties,
  parents,
  showLogistics,
  onSetDuty,
}: {
  mode: PanelMode | null; // null = closed
  // The data-event-id of the grid block to anchor the popover to (the clicked
  // block, or "draft:new" while creating).
  anchorEventId: string | null;
  // Remounts the panel content (re-seeding its form state) when the subject
  // changes — a different event, or a fresh draft.
  panelKey: string;
  onClose: () => void;
  members: CalendarMember[];
  sources: CalendarSource[];
  canManage: boolean;
  canRsvp: boolean;
  sourceLabel: string | null;
  going: string[];
  onToggleGoing: (
    eventId: string,
    email: string,
    willGo: boolean,
  ) => Promise<{ warning?: string }>;
  onChangeOwner: (
    eventId: string,
    email: string,
  ) => Promise<{ warning?: string }>;
  duties: EventDuties;
  parents: CalendarMember[];
  showLogistics: boolean;
  onSetDuty: (
    eventId: string,
    duty: "dropoff" | "pickup",
    state: EventDuty | null,
  ) => Promise<void>;
}) {
  const open = mode != null;

  // Same breakpoint the day view resolves its column layout at.
  const [isMobile, setIsMobile] = React.useState(false);
  React.useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const sync = () => setIsMobile(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  const dirtyRef = React.useRef(false);
  const [pulse, setPulse] = React.useState(0);
  // How many nested pickers are currently open inside the panel, and when the
  // last one closed — an outside-press that lands while (or just after) a
  // picker is open is the picker's dismissal, not the panel's.
  const overlayDepth = React.useRef(0);
  const overlayClosedAt = React.useRef(0);
  const reportOverlay = React.useCallback((isOpen: boolean) => {
    overlayDepth.current = Math.max(0, overlayDepth.current + (isOpen ? 1 : -1));
    if (!isOpen) overlayClosedAt.current = Date.now();
  }, []);

  React.useEffect(() => {
    if (open) {
      dirtyRef.current = false;
      overlayDepth.current = 0;
    }
  }, [open, panelKey]);

  const handleDismiss = React.useCallback(
    (reason: "outside-press" | "escape-key" | "explicit") => {
      if (reason !== "explicit") {
        if (
          overlayDepth.current > 0 ||
          Date.now() - overlayClosedAt.current < 150
        ) {
          return; // the press belonged to a nested picker
        }
        if (dirtyRef.current) {
          setPulse((p) => p + 1); // unsaved edits — draw the eye to the save bar
          return;
        }
      }
      onClose();
    },
    [onClose],
  );

  const content = mode ? (
    <NestedOverlayContext.Provider value={reportOverlay}>
      <div className="relative flex min-h-0 flex-1 flex-col">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Close"
          onClick={() => {
            dirtyRef.current = false;
            onClose();
          }}
          className="absolute top-2.5 right-2.5 z-10 text-muted-foreground"
        >
          <XIcon />
        </Button>
        <EventPanelContent
          key={panelKey}
          mode={mode}
          container={isMobile ? "sheet" : "popover"}
          members={members}
          sources={sources}
          canManage={canManage}
          canRsvp={canRsvp}
          sourceLabel={sourceLabel}
          going={going}
          onToggleGoing={onToggleGoing}
          onChangeOwner={onChangeOwner}
          duties={duties}
          parents={parents}
          showLogistics={showLogistics}
          onSetDuty={onSetDuty}
          onClose={onClose}
          dirtyRef={dirtyRef}
          attentionPulse={pulse}
        />
      </div>
    </NestedOverlayContext.Provider>
  ) : null;

  if (isMobile) {
    return (
      <BottomSheet
        open={open}
        onOpenChange={(next, details) => {
          if (next) return;
          const reason = (details as { reason?: string } | undefined)?.reason;
          if (reason === "escape-key") handleDismiss("escape-key");
          else if (reason === "swipe-dismiss") handleDismiss("explicit");
          else handleDismiss("outside-press");
        }}
      >
        {content}
      </BottomSheet>
    );
  }

  return (
    <AnchoredPanel
      open={open}
      anchorEventId={anchorEventId}
      // Re-evaluate the anchor position when the subject changes.
      positionKey={panelKey}
      onDismiss={handleDismiss}
    >
      {content}
    </AnchoredPanel>
  );
}

// A fixed-position card placed beside the anchor block: right of it when there
// is room, left otherwise, vertically clamped into the viewport. Re-measured
// after mount (the card's height depends on its content) and on resize. It
// deliberately does NOT track page scroll — the grid scrolling under a parked
// panel is fine, and re-anchoring on every scroll frame is jitter for nothing.
function AnchoredPanel({
  open,
  anchorEventId,
  positionKey,
  onDismiss,
  children,
}: {
  open: boolean;
  anchorEventId: string | null;
  positionKey: string;
  onDismiss: (reason: "outside-press" | "escape-key") => void;
  children: React.ReactNode;
}) {
  const panelRef = React.useRef<HTMLDivElement>(null);
  const [pos, setPos] = React.useState<{ top: number; left: number } | null>(
    null,
  );

  // Find the anchor block. The same event can render in several responsive
  // variants (e.g. the agenda's desktop grid and its mobile list), so take the
  // first one that's actually visible.
  const anchorRect = React.useCallback((): DOMRect | null => {
    if (!anchorEventId) return null;
    const els = document.querySelectorAll(
      `[data-event-id="${CSS.escape(anchorEventId)}"]`,
    );
    for (const el of els) {
      const rects = el.getClientRects();
      if (rects.length > 0) return el.getBoundingClientRect();
    }
    return null;
  }, [anchorEventId]);

  // Position after mount (and when the subject changes): the panel's height is
  // content-driven, so measure the rendered card and clamp.
  React.useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const place = () => {
      const panel = panelRef.current;
      if (!panel) return;
      const height = panel.offsetHeight;
      const rect = anchorRect();
      if (!rect) {
        // No block to anchor to (e.g. the + button in a non-grid view):
        // settle upper-center.
        setPos({
          top: Math.max(MARGIN, window.innerHeight * 0.2),
          left: Math.max(MARGIN, (window.innerWidth - PANEL_WIDTH) / 2),
        });
        return;
      }
      let left = rect.right + MARGIN;
      if (left + PANEL_WIDTH > window.innerWidth - MARGIN) {
        left = rect.left - MARGIN - PANEL_WIDTH; // flip to the left side
      }
      left = Math.min(
        Math.max(left, MARGIN),
        window.innerWidth - PANEL_WIDTH - MARGIN,
      );
      const top = Math.min(
        Math.max(rect.top, MARGIN),
        Math.max(MARGIN, window.innerHeight - height - MARGIN),
      );
      setPos({ top, left });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open, positionKey, anchorRect]);

  // Outside press + Escape. pointerdown (not click) so a drag starting outside
  // dismisses immediately, matching popover conventions.
  React.useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const panel = panelRef.current;
      if (!panel || panel.contains(e.target as Node)) return;
      // A press on an event block (or the new-event button) is not a
      // dismissal — its click handler replaces the panel's subject. Closing
      // here would also re-render mid-gesture, which swallows that click.
      const el = e.target as Element;
      if (el.closest?.("[data-event-id],[data-panel-trigger]")) return;
      onDismiss("outside-press");
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDismiss("escape-key");
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onDismiss]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      className="fixed z-50 flex w-96 flex-col rounded-lg bg-popover text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10 animate-in fade-in-0 zoom-in-95 duration-100"
      style={{
        top: pos?.top ?? -9999,
        left: pos?.left ?? -9999,
        // Hide until measured+placed so the first paint doesn't flash at 0,0.
        visibility: pos ? "visible" : "hidden",
      }}
    >
      {children}
    </div>,
    document.body,
  );
}
