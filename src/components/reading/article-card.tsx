"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import {
  Archive,
  BookOpen,
  ExternalLink,
  Loader2,
  MoreHorizontal,
  RotateCcw,
  Trash2,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { removeBook, updateBook } from "@/app/(reading)/reader/actions";
import { bookReaderHref } from "@/lib/reading/links";
import type { ReadingBookWithProgress } from "@/lib/types";

/** Domain of a saved article, without the leading www. */
function hostLabel(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** "N min read" from the stored word count (≈200 wpm). */
function readingTime(wordCount: number | null): string | null {
  if (!wordCount || wordCount <= 0) return null;
  return `${Math.max(1, Math.round(wordCount / 200))} min read`;
}

function savedLabel(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

/**
 * A saved web article in the reading list. Mirrors BookCard's shape but with
 * article-appropriate metadata (site + favicon, reading time) instead of cover
 * art and page counts. Reading always works — article content is stored ready.
 */
export function ArticleCard({
  article,
  memberEmail = null,
}: {
  article: ReadingBookWithProgress;
  memberEmail?: string | null;
}) {
  const [busy, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const host = hostLabel(article.source_url);
  const site = article.site_name || host;
  const minutes = readingTime(article.word_count);
  const favicon = host
    ? `https://www.google.com/s2/favicons?domain=${host}&sz=64`
    : null;

  function setStatus(status: "queued" | "archive") {
    setError(null);
    startTransition(async () => {
      try {
        await updateBook(article.id, { status, memberEmail });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't update.");
      }
    });
  }

  function handleDelete() {
    if (!window.confirm(`Delete "${article.title}" from your reading?`)) return;
    setError(null);
    startTransition(async () => {
      try {
        await removeBook(article.id, memberEmail);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't delete.");
      }
    });
  }

  return (
    <div className="rounded-lg border border-border px-4 py-3">
      <div className="flex items-start gap-3">
        <Link
          href={bookReaderHref(article.id, memberEmail)}
          className="min-w-0 flex-1"
        >
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {favicon && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={favicon}
                alt=""
                width={16}
                height={16}
                className="size-4 shrink-0 rounded-sm"
              />
            )}
            {site && <span className="truncate">{site}</span>}
          </div>
          <p className="mt-1 font-serif text-sm text-foreground">
            {article.title}
          </p>
          {article.excerpt && (
            <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
              {article.excerpt}
            </p>
          )}
          <div className="mt-2 flex items-center gap-2 text-[11px] tabular-nums text-muted-foreground">
            {minutes && <span>{minutes}</span>}
            {minutes && <span aria-hidden>·</span>}
            <span>Saved {savedLabel(article.created_at)}</span>
          </div>
        </Link>

        <div className="flex shrink-0 items-center gap-1.5">
          <Link
            href={bookReaderHref(article.id, memberEmail)}
            className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-2.5 py-1.5 text-xs font-medium text-background transition-opacity hover:opacity-90"
          >
            <BookOpen className="h-3.5 w-3.5" />
            {article.hasResumePoint ? "Continue" : "Read"}
          </Link>

          <DropdownMenu>
            <DropdownMenuTrigger
              className="-mr-1 shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
              aria-label={`Actions for ${article.title}`}
              disabled={busy}
            >
              {busy ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <MoreHorizontal className="h-5 w-5" />
              )}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" side="bottom" className="w-48">
              {article.source_url && (
                <DropdownMenuItem
                  render={
                    <a
                      href={article.source_url}
                      target="_blank"
                      rel="noopener noreferrer"
                    />
                  }
                >
                  <ExternalLink />
                  Open original
                </DropdownMenuItem>
              )}
              {article.status === "archive" ? (
                <DropdownMenuItem onClick={() => setStatus("queued")}>
                  <RotateCcw />
                  Unarchive
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onClick={() => setStatus("archive")}>
                  <Archive />
                  Archive
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={handleDelete}>
                <Trash2 />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
    </div>
  );
}
