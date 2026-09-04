"use client";

import { MessageSquare, Star } from "lucide-react";
import { MemberAvatar } from "@/components/journal/member-avatar";
import { memberPhotoUrl } from "@/lib/media/member-photo-url";
import { cn } from "@/lib/utils";
import { annotationKind, annotationOrigin } from "@/lib/reading/annotation-types";
import { GUTTER_X_CLASS, MARKER_PITCH, type GutterRow } from "./gutter-placement";

/**
 * The icons in the right margin that say "there's something here you can't see".
 *
 * Notes and chats — plus anything starred, and anything somebody left you. Plain
 * highlights of your own are filtered out upstream in gutter-placement.ts,
 * because a highlight has no hidden content to advertise; a STARRED one is here
 * because otherwise it would be invisible everywhere except the marks panel,
 * which is the whole thing starring is supposed to fix.
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
          // A mark somebody else left you gets their face rather than an icon.
          // It is the strongest "this came from a person" signal available and
          // it costs nothing structurally — the button is already a 24px circle.
          const kind = annotationKind(annotation);
          const theirs = annotationOrigin(annotation) === "theirs";
          const who = theirs
            ? (annotation.participants.find(
                (p) => p.userId === annotation.sharedFromUserId
              ) ?? null)
            : null;
          const starred = annotation.starred;
          // A starred CONVERSATION keeps its speech bubble: swapping it for a
          // star would erase "there are words in here", which is the marker's
          // first job. A starred plain highlight has no conversation to announce
          // and would have no marker at all otherwise, so the star is the glyph.
          const Icon = starred && kind === "highlight" ? Star : MessageSquare;
          const label = theirs
            ? `${who?.name ?? "shared"} note`
            : kind === "thread"
              ? "note"
              : "highlight";
          return (
            <button
              key={annotation.id}
              type="button"
              onClick={() => onOpen(annotation.id)}
              style={{
                top: row.top + i * MARKER_PITCH,
                ...(row.left != null ? { left: row.left } : null),
              }}
              aria-label={
                row.annotations.length > 1
                  ? `Open ${label} ${i + 1} of ${row.annotations.length} here`
                  : `Open ${label} here`
              }
              className={cn(
                "pointer-events-auto absolute flex h-6 w-6 items-center justify-center rounded-full border transition-colors",
                // Paged mode measures an exact x per marker (its column decides
                // whether it lands in the gap or the outer margin); scrolling
                // has one gutter for the lot.
                row.left == null && GUTTER_X_CLASS,
                annotation.id === openAnnotationId
                  ? "border-foreground/30 bg-foreground text-background"
                  : starred
                    ? // Gold, plus a heavier ring. The ring is not decoration: on
                      // e-ink there is no colour at all and gold dithers to a
                      // grey stipple, so a starred marker has to be tellable
                      // from an unstarred one by weight alone.
                      "border-2 border-star/60 bg-background text-star hover:border-star"
                    : "border-border bg-background text-muted-foreground hover:border-foreground/30 hover:text-foreground"
              )}
            >
              {who ? (
                <MemberAvatar
                  name={who.name}
                  url={who.email ? memberPhotoUrl(who.email) : null}
                  size="xs"
                  className="h-full w-full"
                />
              ) : (
                <Icon className={cn("h-3 w-3", starred && kind === "highlight" && "fill-current")} />
              )}
              {annotation.unreadCount > 0 && (
                <span
                  aria-hidden
                  className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-primary ring-2 ring-background"
                />
              )}
            </button>
          );
        })
      )}
    </div>
  );
}
