"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArticleActionsMenu,
  ArticleContextMenu,
  useArticleMenu,
} from "@/components/reading/article-actions-menu";
import { useIsDownloaded } from "@/lib/reading/offline/use-is-downloaded";
import { bookNotesHref, bookReaderHref } from "@/lib/reading/links";
import { cn } from "@/lib/utils";
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

/** "18 min" from the stored word count (≈200 wpm). */
function readingTime(wordCount: number | null): string | null {
  if (!wordCount || wordCount <= 0) return null;
  return `${Math.max(1, Math.round(wordCount / 200))} min`;
}

/**
 * A saved article on the Reader shelf, wearing a jacket.
 *
 * An article has no cover, but it nearly always ships a lead image, and that
 * image plus its own headline is a book jacket in everything but name: art
 * across the top, the publication where a publisher's name would go, the title
 * set in the same serif the shelf uses everywhere else. Building the jacket
 * rather than cropping the image is what makes it work — these images are all
 * 16:9 press photos, and squeezing one into a 2:3 cover would cut the faces in
 * half to no purpose.
 *
 * The point isn't decoration: it's that the shelf becomes one shelf. An article
 * you saved on Tuesday sits in the grid at the same size and shape as the books
 * beside it, and picking one is the same gesture as picking the other, instead
 * of the articles being exiled to a list of wide rows underneath the shelf.
 */
export function ReaderArticleTile({
  article,
}: {
  article: ReadingBookWithProgress;
}) {
  const [error, setError] = useState<string | null>(null);
  const [broken, setBroken] = useState(false);
  const menu = useArticleMenu({ article, memberEmail: null, onError: setError });

  const host = hostLabel(article.source_url);
  const site = article.site_name || host;
  const minutes = readingTime(article.word_count);
  const percent = article.readerPercent;
  const downloaded = useIsDownloaded(article.id);
  const image = article.cover_image_url && !broken ? article.cover_image_url : null;

  const jacket = (
    <>
      <div className="flex h-full w-full flex-col bg-card">
        {image && (
          <div className="h-[40%] w-full shrink-0 overflow-hidden bg-muted">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={image}
              alt=""
              className="h-full w-full object-cover"
              onError={() => setBroken(true)}
            />
          </div>
        )}

        {/* The type block. Without art it takes the whole jacket and centres
            itself — a plain typographic cover, which is a real kind of cover
            rather than a hole where the picture failed to load. */}
        <div
          className={cn(
            "flex min-h-0 flex-1 flex-col overflow-hidden p-2 sm:p-2.5",
            !image && "justify-center"
          )}
        >
          {site && (
            <span className="truncate text-[8px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
              {site}
            </span>
          )}
          <span
            className={cn(
              "mt-1 border-t border-border pt-1 font-serif leading-[1.2] text-foreground",
              "text-[11px] sm:text-xs md:text-[13px]",
              image ? "line-clamp-3" : "line-clamp-5"
            )}
          >
            {article.title}
          </span>
          {minutes && (
            <span
              className={cn(
                "pt-1 text-[8px] uppercase tracking-[0.1em] text-muted-foreground",
                // Under art the length sits at the foot of the jacket, where a
                // publisher's mark goes. On a jacket that's type all the way
                // down, it stays with the block so the whole thing centres.
                image ? "mt-auto" : "mt-1.5"
              )}
            >
              {minutes}
            </span>
          )}
        </div>
      </div>

      {/* Same hairline the books carry, in the same place, for the same reason. */}
      {percent != null && percent > 0 && article.status !== "archive" && (
        <div className="absolute inset-x-0 bottom-0 h-1 bg-black/40">
          <div className="h-full bg-white/95" style={{ width: `${percent}%` }} />
        </div>
      )}
    </>
  );

  return (
    <ArticleContextMenu menu={menu} className="group flex flex-col gap-1.5 text-left">
      <div className="relative transition-transform duration-150 group-hover:-translate-y-1">
        <Link
          href={bookReaderHref(article.id)}
          aria-label={`${article.hasResumePoint ? "Continue" : "Read"} ${article.title}`}
          className="relative block aspect-[2/3] w-full overflow-hidden rounded shadow-sm ring-1 ring-foreground/10"
        >
          {jacket}
        </Link>

        <ArticleActionsMenu
          menu={menu}
          className="absolute right-1.5 top-1.5 inline-flex h-7 w-7 items-center justify-center rounded-full bg-background/85 text-muted-foreground shadow-sm backdrop-blur transition-opacity hover:text-foreground focus-visible:opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
        />
      </div>

      {/* No title underneath: unlike a book cover, the jacket's own headline is
          set to be read at this size, and printing it twice in a row is noise. */}
      <span className="text-[11px] tabular-nums text-muted-foreground">
        {article.status === "archive"
          ? "Read"
          : percent != null && percent > 0
            ? `${percent}%`
            : "Not started"}
        {article.annotationCount > 0 && (
          <>
            {" · "}
            <Link
              href={bookNotesHref(article.id)}
              className="underline-offset-2 hover:text-foreground hover:underline"
            >
              {article.annotationCount}{" "}
              {article.annotationCount === 1 ? "note" : "notes"}
            </Link>
          </>
        )}
        {downloaded && <span className="text-muted-foreground/60"> · Offline</span>}
      </span>

      {error && <span className="text-[11px] text-destructive">{error}</span>}
    </ArticleContextMenu>
  );
}
