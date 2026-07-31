"use client";

import { Highlighter, MessageSquare, StickyNote, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  annotationKind,
  type AnnotationSummary,
} from "@/lib/reading/annotation-types";

/**
 * Everything you've marked in this book, in reading order.
 *
 * Plain highlights are included and rendered lighter than notes and chats. They
 * are deliberately absent from the MARGIN — an icon out there would mean
 * "content you can't see", which a highlight doesn't have — but they belong
 * here, because this is the retrieval surface. A highlight you can never find
 * again is the write-only failure mode this list exists to prevent.
 */
export function AnnotationList({
  annotations,
  openAnnotationId,
  hasRealPages,
  onOpen,
  onClose,
  dockToggle,
}: {
  annotations: AnnotationSummary[];
  openAnnotationId: string | null;
  hasRealPages: boolean;
  onOpen: (id: string) => void;
  onClose: () => void;
  /** The float/dock control, when the panel is presented in a way that can dock. */
  dockToggle?: React.ReactNode;
}) {
  // Reading order, not creation order: this is a companion to the text, so it
  // should run the way the text does. created_at breaks ties for two marks on
  // the same passage.
  const ordered = [...annotations].sort(
    (a, b) =>
      a.anchorCharOffset - b.anchorCharOffset ||
      a.createdAt.localeCompare(b.createdAt)
  );

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2.5">
        <p className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
          {ordered.length === 0
            ? "Nothing marked yet"
            : `${ordered.length} ${ordered.length === 1 ? "mark" : "marks"}`}
        </p>
        {dockToggle}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      {ordered.length === 0 ? (
        <p className="px-4 py-6 text-xs leading-relaxed text-muted-foreground">
          Select a passage to highlight it, write a note on it, or ask about it.
          Whatever you mark shows up here, in the order you&apos;ll read it.
        </p>
      ) : (
        <ul className="min-h-0 flex-1 overflow-y-auto">
          {ordered.map((a) => {
            const kind = annotationKind(a);
            const Icon =
              kind === "chat"
                ? MessageSquare
                : kind === "note"
                  ? StickyNote
                  : Highlighter;
            return (
              <li key={a.id}>
                <button
                  type="button"
                  onClick={() => onOpen(a.id)}
                  className={cn(
                    "flex w-full gap-2.5 border-b border-border/60 px-4 py-3 text-left transition-colors hover:bg-muted/60",
                    a.id === openAnnotationId && "bg-muted"
                  )}
                >
                  <Icon
                    className={cn(
                      "mt-0.5 h-3.5 w-3.5 shrink-0",
                      kind === "highlight"
                        ? "text-muted-foreground/60"
                        : "text-muted-foreground"
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    {a.quotedText ? (
                      <p
                        className={cn(
                          "line-clamp-3 font-serif text-[13px] leading-snug",
                          // A highlight is only its passage, so it stays quiet.
                          // A note or chat has its own content below, and the
                          // quote is context for it.
                          kind === "highlight"
                            ? "text-muted-foreground"
                            : "text-foreground"
                        )}
                      >
                        {a.quotedText}
                      </p>
                    ) : (
                      <p className="text-[13px] italic text-muted-foreground">
                        In the text
                      </p>
                    )}
                    {a.note && (
                      <p className="mt-1 line-clamp-2 text-xs leading-snug text-foreground">
                        {a.note}
                      </p>
                    )}
                    {a.messageCount > 0 && (
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        {a.messageCount}{" "}
                        {a.messageCount === 1 ? "message" : "messages"}
                        {a.anchorPage != null && hasRealPages
                          ? ` · p.${a.anchorPage}`
                          : ""}
                      </p>
                    )}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
