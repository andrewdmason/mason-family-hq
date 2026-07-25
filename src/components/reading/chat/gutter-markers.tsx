"use client";

import { MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import { GUTTER_X_CLASS, MARKER_PITCH, type GutterRow } from "./gutter-placement";

/**
 * The icons in the right margin that say "you talked about this bit".
 *
 * Several chats on the same paragraph stack vertically — one icon each — rather
 * than collapsing into a counted badge. Each chat is a separate conversation, so
 * each gets its own target; a badge made you open one to find the other.
 *
 * Rendered as <button>s on purpose: the reader's mobile tap-to-toggle-chrome
 * handler explicitly ignores taps on buttons, so a marker never fights it.
 */
export function GutterMarkers({
  rows,
  openChatId,
  onOpen,
}: {
  rows: GutterRow[];
  openChatId: string | null;
  onOpen: (chatId: string) => void;
}) {
  if (rows.length === 0) return null;

  return (
    <div className="pointer-events-none absolute inset-0">
      {rows.map((row) =>
        row.chats.map((chat, i) => (
          <button
            key={chat.id}
            type="button"
            onClick={() => onOpen(chat.id)}
            style={{
              top: row.top + i * MARKER_PITCH,
              ...(row.left != null ? { left: row.left } : null),
            }}
            aria-label={
              row.chats.length > 1
                ? `Open chat ${i + 1} of ${row.chats.length} here`
                : "Open chat here"
            }
            className={cn(
              "pointer-events-auto absolute flex h-6 w-6 items-center justify-center rounded-full border transition-colors",
              // Paged mode measures an exact x per marker (its column decides
              // whether it lands in the gap or the outer margin); scrolling has
              // one gutter for the lot.
              row.left == null && GUTTER_X_CLASS,
              chat.id === openChatId
                ? "border-foreground/30 bg-foreground text-background"
                : "border-border bg-background text-muted-foreground hover:border-foreground/30 hover:text-foreground"
            )}
          >
            <MessageSquare className="h-3 w-3" />
          </button>
        ))
      )}
    </div>
  );
}
