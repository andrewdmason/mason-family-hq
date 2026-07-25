"use client";

import { MessageSquare, StickyNote } from "lucide-react";
import { cn } from "@/lib/utils";
import { annotationKind } from "@/lib/reading/annotation-types";
import { GUTTER_X_CLASS, MARKER_PITCH, type GutterRow } from "./gutter-placement";

/**
 * The icons in the right margin that say "there's something here you can't see".
 *
 * Notes and chats only — plain highlights are filtered out upstream in
 * gutter-placement.ts, because a highlight has no hidden content to advertise.
 *
 * Several on the same paragraph stack vertically, one icon each, rather than
 * collapsing into a counted badge. Each is a separate thing you wrote, so each
 * gets its own target; a badge made you open one to find the other.
 *
 * Rendered as <button>s on purpose: the reader's mobile tap-to-toggle-chrome
 * handler explicitly ignores taps on buttons, so a marker never fights it.
 */
export function GutterMarkers({
  rows,
  openAnnotationId,
  onOpen,
}: {
  rows: GutterRow[];
  openAnnotationId: string | null;
  onOpen: (annotationId: string) => void;
}) {
  if (rows.length === 0) return null;

  return (
    <div className="pointer-events-none absolute inset-0">
      {rows.map((row) =>
        row.annotations.map((annotation, i) => {
          // Chat wins when an annotation has both a note and a conversation —
          // the same rule the text treatment uses, so the margin and the passage
          // never disagree about what something is.
          const kind = annotationKind(annotation);
          const Icon = kind === "chat" ? MessageSquare : StickyNote;
          const label = kind === "chat" ? "chat" : "note";
          return (
            <button
              key={annotation.id}
              type="button"
              onClick={() => onOpen(annotation.id)}
              style={{ top: row.top + i * MARKER_PITCH }}
              aria-label={
                row.annotations.length > 1
                  ? `Open ${label} ${i + 1} of ${row.annotations.length} here`
                  : `Open ${label} here`
              }
              className={cn(
                "pointer-events-auto absolute flex h-6 w-6 items-center justify-center rounded-full border transition-colors",
                GUTTER_X_CLASS,
                annotation.id === openAnnotationId
                  ? "border-foreground/30 bg-foreground text-background"
                  : "border-border bg-background text-muted-foreground hover:border-foreground/30 hover:text-foreground"
              )}
            >
              <Icon className="h-3 w-3" />
            </button>
          );
        })
      )}
    </div>
  );
}
