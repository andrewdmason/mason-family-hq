"use client";

import { X } from "lucide-react";
import { PAGE_PAD_BOTTOM } from "@/lib/reading/paged-geometry";
import { cn } from "@/lib/utils";

/**
 * "The passage you started is still open — say where it ends."
 *
 * Shown from the moment Continue turns the page until the reader acts on a
 * selection or gives up. It is the only sign that the next selection will be
 * joined to the last one, so it stays until one of those happens.
 *
 * Bottom strip, above the running foot, where the other transient pills sit.
 */
export function ContinuePill({ onCancel }: { onCancel: () => void }) {
  return (
    <div
      className="pointer-events-none fixed inset-x-0 z-40 flex justify-center px-4"
      style={{ bottom: PAGE_PAD_BOTTOM + 8 }}
    >
      <div
        role="status"
        className={cn(
          "pointer-events-auto flex max-w-full items-center gap-3 rounded-full border border-border",
          "bg-popover/95 py-1.5 pr-1.5 pl-4 text-sm shadow-lg backdrop-blur"
        )}
      >
        <span className="min-w-0 truncate text-muted-foreground">
          Passage continues · select where it ends
        </span>
        <button
          type="button"
          onClick={onCancel}
          aria-label="Cancel"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
