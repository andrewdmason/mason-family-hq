"use client";

import { useEffect, useState } from "react";
import { ClipboardCopy, MoreHorizontal } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { RATING_OPTIONS } from "@/components/reading/rating-picker";
import { Toast, ToastViewport } from "@/components/ui/toast";
import type { ReadingRating } from "@/lib/types";

/**
 * The reader's toolbar overflow menu. Today it holds one thing: copy the whole
 * archived shelf as markdown, grouped by rating, so you can paste your taste
 * into a chatbot and ask for recommendations. The books are already on the
 * client, so the copy happens synchronously inside the click — no await between
 * the gesture and `writeText`, which browsers would treat as a lost user
 * activation.
 */

export type CopyableBook = {
  title: string;
  author: string | null;
  rating: ReadingRating | null;
  published_year: number | null;
};

// Best verdict first, unrated last — the opposite of the shelf, which floats
// unrated to the top to nudge a rating. Here the strongest signal leads.
const MARKDOWN_ORDER: (ReadingRating | "unrated")[] = [
  "loved",
  "liked",
  "neutral",
  "disliked",
  "didnt_finish",
  "unrated",
];

function groupHeading(group: ReadingRating | "unrated"): string {
  if (group === "unrated") return "Unrated";
  const option = RATING_OPTIONS.find((o) => o.value === group);
  if (!option) return group;
  // Emoji verdicts keep their glyph; "didn't finish" reads as its label alone
  // (its shelf glyph is a "DNF" chip, which would just stutter the heading).
  return option.emoji ? `${option.emoji} ${option.label}` : option.label;
}

function bookLine(book: CopyableBook): string {
  const parts = [`_${book.title}_`];
  if (book.author) parts.push(book.author);
  const line = parts.join(" — ");
  return book.published_year ? `- ${line} (${book.published_year})` : `- ${line}`;
}

export function archiveMarkdown(books: CopyableBook[], title: string): string {
  const sections = MARKDOWN_ORDER.flatMap((group) => {
    const inGroup = books.filter((b) => (b.rating ?? "unrated") === group);
    if (inGroup.length === 0) return [];
    return [`## ${groupHeading(group)}\n\n${inGroup.map(bookLine).join("\n")}`];
  });
  return `# ${title}\n\n${sections.join("\n\n")}\n`;
}

export function ReaderOverflowMenu({
  books,
  title,
}: {
  books: CopyableBook[];
  /** Heading for the copied markdown, e.g. "Books I've read". */
  title: string;
}) {
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(timer);
  }, [toast]);

  async function copyBooks() {
    try {
      await navigator.clipboard.writeText(archiveMarkdown(books, title));
      setToast(
        `Copied ${books.length} book${books.length === 1 ? "" : "s"} as markdown.`
      );
    } catch {
      // Clipboard can be blocked (insecure context, denied permission).
      setToast("Couldn't reach the clipboard.");
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label="More reader actions"
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground data-popup-open:bg-accent data-popup-open:text-foreground"
        >
          <MoreHorizontal className="h-4 w-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" side="bottom" className="w-56">
          <DropdownMenuItem onClick={copyBooks} disabled={books.length === 0}>
            <ClipboardCopy />
            Copy books as markdown
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {toast && (
        <ToastViewport>
          <Toast>{toast}</Toast>
        </ToastViewport>
      )}
    </>
  );
}
