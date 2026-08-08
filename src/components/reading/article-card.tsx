"use client";

import { useState } from "react";
import Link from "next/link";
import { BookOpen } from "lucide-react";
import {
  ArticleActionsMenu,
  ArticleContextMenu,
  useArticleMenu,
} from "@/components/reading/article-actions-menu";
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

/** "12,345 words" from the stored word count. */
function wordLabel(wordCount: number | null): string | null {
  if (!wordCount || wordCount <= 0) return null;
  return `${wordCount.toLocaleString()} words`;
}

/** The article summary: a link into the reader where there is one, otherwise
 * the same block as plain markup. */
function ArticleSummaryShell({
  href,
  children,
}: {
  href: string | null;
  children: React.ReactNode;
}) {
  return href ? (
    <Link href={href} className="min-w-0 flex-1">
      {children}
    </Link>
  ) : (
    <div className="min-w-0 flex-1">{children}</div>
  );
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
  canRead = false,
}: {
  article: ReadingBookWithProgress;
  memberEmail?: string | null;
  /** Reader only — Bookshelf has no e-reader. */
  canRead?: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const menu = useArticleMenu({ article, memberEmail, onError: setError });

  const host = hostLabel(article.source_url);
  const site = article.site_name || host;
  const minutes = readingTime(article.word_count);
  const words = wordLabel(article.word_count);
  const favicon = host
    ? `https://www.google.com/s2/favicons?domain=${host}&sz=64`
    : null;

  return (
    <ArticleContextMenu
      menu={menu}
      className="rounded-lg border border-border px-4 py-3"
    >
      <div className="flex items-start gap-3">
        {/* Outside Reader there's nowhere to open an article, so the summary
            stops being a link rather than pointing at a blocked route. */}
        <ArticleSummaryShell
          href={canRead ? bookReaderHref(article.id, memberEmail) : null}
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
            {words && <span aria-hidden>·</span>}
            {words && <span>{words}</span>}
          </div>
        </ArticleSummaryShell>

        <div className="flex shrink-0 items-center gap-1.5">
          {canRead && (
            <Link
              href={bookReaderHref(article.id, memberEmail)}
              className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-2.5 py-1.5 text-xs font-medium text-background transition-opacity hover:opacity-90"
            >
              <BookOpen className="h-3.5 w-3.5" />
              {article.hasResumePoint ? "Continue" : "Read"}
            </Link>
          )}

          <ArticleActionsMenu
            menu={menu}
            className="-mr-1 inline-flex shrink-0 items-center justify-center rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
          />
        </div>
      </div>

      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
    </ArticleContextMenu>
  );
}
