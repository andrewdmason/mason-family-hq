"use client";

// Chooses the event panel's container: a flyout drawer parked on the right
// edge on desktop, or a bottom sheet on phones. Also owns the dismissal rules
// shared by both: an outside-press / Escape close request is ignored while a
// nested picker (date grid, time list, select) is open, and blocked with a
// save-bar pulse while there are unsaved edits — explicit Cancel/X/save are
// the ways out of a dirty panel.
//
// The desktop drawer is hand-rolled (fixed, portal) rather than Base UI
// Dialog: it must NOT be modal — no backdrop, the grid stays clickable so
// pressing another event block switches the panel's subject in one click —
// and we need bespoke dismissal anyway.

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

export function EventPanelHost({
  mode,
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
    <DrawerPanel open={open} onDismiss={handleDismiss}>
      {content}
    </DrawerPanel>
  );
}

// A non-modal flyout drawer parked on the right edge of the viewport. No
// backdrop — the grid stays visible and clickable beside it, so pressing
// another event block switches the panel's subject in one click.
function DrawerPanel({
  open,
  onDismiss,
  children,
}: {
  open: boolean;
  onDismiss: (reason: "outside-press" | "escape-key") => void;
  children: React.ReactNode;
}) {
  const panelRef = React.useRef<HTMLDivElement>(null);

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
      className="fixed inset-y-0 right-0 z-50 flex w-96 flex-col border-l bg-background text-sm text-foreground shadow-lg animate-in slide-in-from-right duration-200 ease-out"
    >
      {children}
    </div>,
    document.body,
  );
}
