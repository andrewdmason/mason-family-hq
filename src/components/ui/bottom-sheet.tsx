"use client";

// Snap-point bottom sheet on Base UI Dialog — the mobile container for the
// event panel. Opens at full height (dragging a half-open sheet the rest of
// the way up proved too fiddly); the grab handle can still park it at half to
// peek at the calendar behind, and dragging well below half dismisses. Inputs
// snap the sheet back to full on focus so the iOS keyboard doesn't bury them.
//
// Hand-rolled rather than a library: the codebase is Base UI end-to-end and the
// snap controller is ~80 lines of the same imperative-transform gesture code
// the calendar already uses for swipe-day navigation.

import * as React from "react";
import { Dialog } from "@base-ui/react/dialog";

import { cn } from "@/lib/utils";

type Snap = "half" | "full";

// Sheet height and the half-snap offset, as fractions of the viewport.
const FULL_FRACTION = 0.92;
const HALF_FRACTION = 0.5;
// Dragging this far below the half position dismisses.
const DISMISS_SLACK_PX = 80;

export function BottomSheet({
  open,
  onOpenChange,
  children,
  className,
}: {
  open: boolean;
  onOpenChange: NonNullable<Dialog.Root.Props["onOpenChange"]>;
  children: React.ReactNode;
  className?: string;
}) {
  const [snap, setSnap] = React.useState<Snap>("full");
  // Live translateY during a drag; null = resting at `snap` (CSS-animated).
  const [dragY, setDragY] = React.useState<number | null>(null);
  const dragRef = React.useRef<{ startY: number; base: number } | null>(null);
  const dragYRef = React.useRef<number | null>(null);

  // Every open starts fully expanded.
  React.useEffect(() => {
    if (open) {
      setSnap("full");
      setDragY(null);
      dragYRef.current = null;
      dragRef.current = null;
    }
  }, [open]);

  const halfOffsetPx = () =>
    window.innerHeight * (FULL_FRACTION - HALF_FRACTION);

  function onHandlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    dragRef.current = {
      startY: e.clientY,
      base: snap === "half" ? halfOffsetPx() : 0,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onHandlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragRef.current) return;
    const y = Math.max(0, dragRef.current.base + e.clientY - dragRef.current.startY);
    dragYRef.current = y;
    setDragY(y);
  }

  function onHandlePointerEnd() {
    if (!dragRef.current) return;
    const y = dragYRef.current;
    dragRef.current = null;
    dragYRef.current = null;
    setDragY(null);
    if (y == null) return; // never moved — treat as a tap
    const half = halfOffsetPx();
    if (y > half + DISMISS_SLACK_PX) {
      onOpenChange(false, { reason: "swipe-dismiss" } as never);
    } else {
      setSnap(y < half / 2 ? "full" : "half");
    }
  }

  // Focusing a field while at half height pulls the sheet to full so the
  // on-screen keyboard doesn't cover it.
  function onFocusCapture(e: React.FocusEvent<HTMLDivElement>) {
    const tag = (e.target as HTMLElement).tagName;
    if (snap === "half" && (tag === "INPUT" || tag === "TEXTAREA")) {
      setSnap("full");
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop
          className="fixed inset-0 z-50 bg-black/10 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0 supports-backdrop-filter:backdrop-blur-xs"
        />
        {/* The popup spans the full sheet height but stays transparent and
            click-through — the visible panel is the inner div, translated down
            to the current snap. Clicks above the panel reach the backdrop. */}
        <Dialog.Popup
          className="pointer-events-none fixed inset-x-0 bottom-0 z-50 transition-opacity duration-200 data-ending-style:opacity-0 data-starting-style:opacity-0"
          style={{ height: `${FULL_FRACTION * 100}dvh` }}
          onFocusCapture={onFocusCapture}
        >
          <div
            className={cn(
              "pointer-events-auto mx-auto flex h-full w-full max-w-lg flex-col rounded-t-2xl bg-background shadow-lg ring-1 ring-foreground/10",
              dragY == null && "transition-transform duration-200 ease-out",
              className,
            )}
            style={{
              transform:
                dragY != null
                  ? `translateY(${dragY}px)`
                  : snap === "half"
                    ? `translateY(${(FULL_FRACTION - HALF_FRACTION) * 100}dvh)`
                    : "translateY(0)",
            }}
          >
            <div
              className="flex shrink-0 cursor-grab touch-none items-center justify-center pt-2.5 pb-1.5 active:cursor-grabbing"
              onPointerDown={onHandlePointerDown}
              onPointerMove={onHandlePointerMove}
              onPointerUp={onHandlePointerEnd}
              onPointerCancel={onHandlePointerEnd}
            >
              <div className="h-1 w-9 rounded-full bg-muted-foreground/30" />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              {children}
            </div>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
