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

type Anchor = { pageNumber: number; docTop: number; id: string };

export function BookReader({
  bookId,
  memberEmail,
  title,
  author,
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

    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(flush, 1500);
  }, [flush, hasRealPages]);

  // After the HTML mounts: measure, restore the saved position, wire scrolling.
  useEffect(() => {
    if (html == null) return;

    measure();
    onScroll();

    // Restore once; re-measure shortly after in case fonts shifted layout.
    const restore = () => {
      if (restoredRef.current) return;
      restoredRef.current = true;
      if (resumeAnchorId) {
        const el = document.getElementById(resumeAnchorId);
        if (el) {
          window.scrollTo({
            top: el.getBoundingClientRect().top + window.scrollY - READING_LINE_OFFSET,
          });
          return;
        }
      }
      if (resumeScrollRatio && resumeScrollRatio > 0) {
        const max = document.documentElement.scrollHeight - window.innerHeight;
        window.scrollTo({ top: max * resumeScrollRatio });
      }
    };
    const t1 = setTimeout(() => {
      measure();
      restore();
      onScroll();
    }, 150);

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
      clearTimeout(t1);
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
        <article
          ref={contentRef}
          className="mx-auto w-full max-w-2xl px-6 pt-20 pb-32 font-serif text-[1.15rem] leading-8 text-foreground [&_blockquote]:my-4 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-4 [&_blockquote]:italic [&_p]:mb-5 [&_.page-anchor]:block [&_.page-anchor]:h-0 [&_.reader-heading]:scroll-mt-28 [&_.reader-heading]:text-center [&_.reader-heading]:font-serif [&_.reader-heading]:text-balance [&_.reader-h1]:mt-16 [&_.reader-h1]:mb-3 [&_.reader-h1]:text-3xl [&_.reader-h1]:font-semibold [&_.reader-h1]:tracking-tight first:[&_.reader-h1]:mt-2 [&_.reader-h2]:mt-8 [&_.reader-h2]:mb-7 [&_.reader-h2]:text-xl [&_.reader-h2]:font-medium [&_.reader-h2]:text-muted-foreground"
          dangerouslySetInnerHTML={{ __html: html }}
        />
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
