"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronLeft, List, Loader2 } from "lucide-react";
import { saveReadingPosition } from "@/app/(reading)/reader/actions";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { ReadingTocEntry } from "@/lib/types";

// The reader has no global chrome; its book header is hidden until hovered.
// Offset the "current page" reading line to where text actually begins (the
// reserved top margin) so the page shown matches what's at the top of the view.
const READING_LINE_OFFSET = 72;

const READING_SETTLE_CAP_MS = 2000;

// Article-only prose styles. Books reflow to plain text (images/links/lists are
// stripped at conversion), so these only ever apply to saved web articles and
// never collide with the book heading classes below.
const ARTICLE_PROSE = [
  "[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2",
  "[&_img]:my-4 [&_img]:mx-auto [&_img]:max-w-full [&_img]:h-auto [&_img]:rounded-md",
  "[&_figure]:my-5 [&_figcaption]:mt-1.5 [&_figcaption]:text-center [&_figcaption]:text-sm [&_figcaption]:text-muted-foreground",
  "[&_ul]:my-5 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-5 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:mb-2",
  "[&_h1]:mt-8 [&_h1]:mb-3 [&_h1]:text-2xl [&_h1]:font-semibold [&_h1]:tracking-tight",
  "[&_h2]:mt-7 [&_h2]:mb-2 [&_h2]:text-xl [&_h2]:font-semibold",
  "[&_h3]:mt-6 [&_h3]:mb-2 [&_h3]:text-lg [&_h3]:font-medium",
  "[&_h4]:mt-5 [&_h4]:mb-2 [&_h4]:font-medium",
  "[&_pre]:my-5 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-muted [&_pre]:p-4 [&_pre]:text-sm",
  "[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[0.9em]",
  "[&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-inherit",
  "[&_hr]:my-8 [&_hr]:border-border",
  "[&_table]:my-5 [&_table]:w-full [&_table]:text-sm [&_th]:border [&_th]:border-border [&_th]:p-2 [&_th]:text-left [&_td]:border [&_td]:border-border [&_td]:p-2",
].join(" ");

type Anchor = { pageNumber: number; docTop: number; id: string };

export function BookReader({
  bookId,
  memberEmail,
  title,
  author,
  isArticle = false,
  dek = null,
  heroImageUrl = null,
  contentUrl,
  hasRealPages,
  pageCount,
  toc,
  resumeAnchorId,
  resumeScrollRatio,
  backHref,
}: {
  bookId: string;
  memberEmail: string | null;
  title: string;
  author: string | null;
  isArticle?: boolean;
  dek?: string | null;
  heroImageUrl?: string | null;
  contentUrl: string;
  hasRealPages: boolean;
  pageCount: number | null;
  toc: ReadingTocEntry[];
  resumeAnchorId: string | null;
  resumeScrollRatio: number | null;
  backHref: string;
}) {
  const [html, setHtml] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState<number | null>(null);
  const [percent, setPercent] = useState(0);
  // The book header stays out of the way: revealed only when the mouse is up in
  // the top region, or while the contents menu is open.
  const [hoverTop, setHoverTop] = useState(false);
  const [tocOpen, setTocOpen] = useState(false);
  const headerVisible = hoverTop || tocOpen;

  const contentRef = useRef<HTMLDivElement>(null);
  const anchorsRef = useRef<Anchor[]>([]);
  const positionRef = useRef({ anchorId: resumeAnchorId, scrollRatio: 0, pageNumber: null as number | null });
  const restoredRef = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load the reflowed HTML from its signed URL.
  useEffect(() => {
    let cancelled = false;
    fetch(contentUrl)
      .then((res) => {
        if (!res.ok) throw new Error("Couldn't load this book.");
        return res.text();
      })
      .then((text) => {
        if (!cancelled) setHtml(text);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "Couldn't load this book.");
      });
    return () => {
      cancelled = true;
    };
  }, [contentUrl]);

  // Measure anchor positions (document-relative) once the content is laid out.
  const measure = useCallback(() => {
    const container = contentRef.current;
    if (!container) return;
    const els = container.querySelectorAll<HTMLElement>(".page-anchor");
    const anchors: Anchor[] = [];
    els.forEach((el) => {
      const num = parseInt(el.id.replace("page-", ""), 10);
      if (Number.isNaN(num)) return;
      anchors.push({
        pageNumber: num,
        docTop: el.getBoundingClientRect().top + window.scrollY,
        id: el.id,
      });
    });
    anchors.sort((a, b) => a.docTop - b.docTop);
    anchorsRef.current = anchors;
  }, []);

  const flush = useCallback(() => {
    const pos = positionRef.current;
    void saveReadingPosition(
      bookId,
      { anchorId: pos.anchorId, scrollRatio: pos.scrollRatio, pageNumber: pos.pageNumber },
      memberEmail
    ).catch(() => {});
  }, [bookId, memberEmail]);

  const onScroll = useCallback(() => {
    const doc = document.documentElement;
    const max = doc.scrollHeight - window.innerHeight;
    const ratio = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
    setPercent(Math.round(ratio * 100));

    const line = window.scrollY + READING_LINE_OFFSET;
    const anchors = anchorsRef.current;
    let current: Anchor | null = null;
    for (const a of anchors) {
      if (a.docTop <= line) current = a;
      else break;
    }
    const pageNumber = current?.pageNumber ?? (anchors[0]?.pageNumber ?? null);
    setCurrentPage(pageNumber);

    positionRef.current = {
      anchorId: current?.id ?? null,
      scrollRatio: ratio,
      pageNumber: hasRealPages ? pageNumber : null,
    };

    // Don't persist a position until we've restored the saved one — otherwise the
    // initial scroll-0 reading frame would overwrite the resume point before the
    // restore runs (especially while waiting on images/fonts to settle).
    if (!restoredRef.current) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(flush, 1500);
  }, [flush, hasRealPages]);

  // Resolve once the document height has stopped changing (images decoding,
  // web-font swaps), so a ratio/anchor restore lands in the right place instead
  // of against a too-short page. Capped so a perpetually-shifting page still
  // restores eventually.
  const waitForLayoutToSettle = useCallback(async () => {
    const container = contentRef.current;
    if (container) {
      const pending = Array.from(
        container.querySelectorAll("img")
      ).filter((img) => !img.complete);
      if (pending.length > 0) {
        await Promise.race([
          Promise.all(
            pending.map(
              (img) =>
                new Promise<void>((resolve) => {
                  img.addEventListener("load", () => resolve(), { once: true });
                  img.addEventListener("error", () => resolve(), { once: true });
                })
            )
          ),
          new Promise<void>((resolve) =>
            setTimeout(resolve, READING_SETTLE_CAP_MS)
          ),
        ]);
      }
    }
    // Then wait for scrollHeight to hold steady across two frames.
    await new Promise<void>((resolve) => {
      let last = -1;
      let stableFrames = 0;
      let frames = 0;
      const tick = () => {
        const h = document.documentElement.scrollHeight;
        if (h === last) {
          if (++stableFrames >= 2) return resolve();
        } else {
          stableFrames = 0;
          last = h;
        }
        if (++frames > 120) return resolve(); // ~2s cap at 60fps
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }, []);

  // After the HTML mounts: measure, restore the saved position, wire scrolling.
  useEffect(() => {
    if (html == null) return;

    measure();
    onScroll();

    const restore = () => {
      if (restoredRef.current) return;
      // If the reader already scrolled away while we waited for layout, don't
      // yank them back — just stop blocking saves.
      if (window.scrollY > READING_LINE_OFFSET) {
        restoredRef.current = true;
        return;
      }
      if (resumeAnchorId) {
        const el = document.getElementById(resumeAnchorId);
        if (el) {
          restoredRef.current = true;
          window.scrollTo({
            top: el.getBoundingClientRect().top + window.scrollY - READING_LINE_OFFSET,
          });
          return;
        }
      }
      restoredRef.current = true;
      if (resumeScrollRatio && resumeScrollRatio > 0) {
        const max = document.documentElement.scrollHeight - window.innerHeight;
        window.scrollTo({ top: max * resumeScrollRatio });
      }
    };

    // If every image already reserves its space (width/height present, as the
    // capture extension stamps), the page is its final height on first paint —
    // restore on the next frame so resume is instant. Otherwise wait for the
    // layout to settle before restoring, so the saved position lands accurately.
    let cancelled = false;
    const imgs = Array.from(
      contentRef.current?.querySelectorAll("img") ?? []
    );
    const layoutStable =
      imgs.length === 0 ||
      imgs.every((img) => img.hasAttribute("width") && img.hasAttribute("height"));

    if (layoutStable) {
      requestAnimationFrame(() => {
        if (cancelled) return;
        measure();
        restore();
        onScroll();
      });
    } else {
      void waitForLayoutToSettle().then(() => {
        if (cancelled) return;
        measure();
        restore();
        onScroll();
      });
    }

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", measure);
    const onHide = () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      flush();
    };
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") onHide();
    });

    return () => {
      cancelled = true;
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", measure);
      window.removeEventListener("pagehide", onHide);
      if (saveTimer.current) clearTimeout(saveTimer.current);
      flush();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [html]);

  const scrollToAnchor = useCallback((anchorId: string) => {
    const el = document.getElementById(anchorId);
    if (!el) return;
    window.scrollTo({
      top: el.getBoundingClientRect().top + window.scrollY - READING_LINE_OFFSET,
    });
  }, []);

  return (
    <div className="flex flex-1 flex-col">
      {/* The book header: a fixed bar at the very top that the reader only sees
          when their mouse is up here (or the contents menu is open). The h-14
          region doubles as the hover target and the space reserved for it. */}
      <div
        className="fixed inset-x-0 top-0 z-40 h-14"
        onMouseEnter={() => setHoverTop(true)}
        onMouseLeave={() => setHoverTop(false)}
      >
        <div
          className={cn(
            "h-full border-b border-border/60 bg-background/80 backdrop-blur transition-opacity duration-200 focus-within:opacity-100 focus-within:pointer-events-auto",
            headerVisible ? "opacity-100" : "pointer-events-none opacity-0"
          )}
        >
          <div className="mx-auto flex h-full max-w-2xl items-center gap-3 px-6">
            <Link
              href={backHref}
              aria-label="Back to my books"
              className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              <ChevronLeft className="h-4 w-4" />
            </Link>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground">{title}</p>
              {author && <p className="truncate text-xs text-muted-foreground">{author}</p>}
            </div>
            {toc.length > 0 && (
              <DropdownMenu open={tocOpen} onOpenChange={setTocOpen}>
                <DropdownMenuTrigger
                  aria-label="Table of contents"
                  className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <List className="h-4 w-4" />
                  <span className="hidden sm:inline">Contents</span>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="max-h-80 w-64 overflow-y-auto">
                  {toc.map((entry) => (
                    <DropdownMenuItem
                      key={entry.anchorId}
                      onClick={() => scrollToAnchor(entry.anchorId)}
                      className={cn(
                        "flex items-baseline justify-between gap-3",
                        entry.level <= 1
                          ? "font-medium text-foreground"
                          : "pl-4 text-muted-foreground"
                      )}
                    >
                      <span className="truncate">{entry.title}</span>
                      {entry.page != null && (
                        <span className="shrink-0 text-xs tabular-nums opacity-60">
                          {entry.page}
                        </span>
                      )}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>
      </div>

      {loadError ? (
        <p className="mx-auto mt-16 max-w-md px-6 text-center text-sm text-destructive">
          {loadError}
        </p>
      ) : html == null ? (
        <div className="mx-auto mt-24 flex flex-col items-center gap-2 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="text-sm">Opening your book…</span>
        </div>
      ) : (
        <article className="mx-auto w-full max-w-2xl px-6 pt-20 pb-32 font-serif text-[1.15rem] leading-8 text-foreground">
          {/* Readability returns the title/dek/hero separately from the body, so
              the reader reconstructs the article header for web articles. */}
          {isArticle && (
            <header className="mb-8">
              <h1 className="font-serif text-3xl font-semibold tracking-tight text-balance text-foreground">
                {title}
              </h1>
              {dek && (
                <p className="mt-3 text-lg leading-snug text-muted-foreground">
                  {dek}
                </p>
              )}
              {author && (
                <p className="mt-4 text-sm text-muted-foreground">By {author}</p>
              )}
              {heroImageUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={heroImageUrl}
                  alt=""
                  className="mt-6 aspect-[16/9] w-full rounded-lg object-cover"
                />
              )}
            </header>
          )}
          <div
            ref={contentRef}
            className={cn(
              "[&_blockquote]:my-4 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-4 [&_blockquote]:italic [&_p]:mb-5 [&_.page-anchor]:block [&_.page-anchor]:h-0 [&_.reader-heading]:scroll-mt-28 [&_.reader-heading]:text-center [&_.reader-heading]:font-serif [&_.reader-heading]:text-balance [&_.reader-h1]:mt-16 [&_.reader-h1]:mb-3 [&_.reader-h1]:text-3xl [&_.reader-h1]:font-semibold [&_.reader-h1]:tracking-tight first:[&_.reader-h1]:mt-2 [&_.reader-h2]:mt-8 [&_.reader-h2]:mb-7 [&_.reader-h2]:text-xl [&_.reader-h2]:font-medium [&_.reader-h2]:text-muted-foreground",
              isArticle && "article-content",
              isArticle && ARTICLE_PROSE
            )}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </article>
      )}

      {/* Fixed progress indicator, Kindle-style. */}
      {html != null && !loadError && (
        <div className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center">
          <span className="rounded-full bg-foreground/85 px-3 py-1 text-xs font-medium tabular-nums text-background shadow-sm backdrop-blur">
            {hasRealPages && currentPage != null
              ? `Page ${currentPage}${pageCount ? ` of ${pageCount}` : ""}`
              : `${percent}%`}
          </span>
        </div>
      )}
    </div>
  );
}
