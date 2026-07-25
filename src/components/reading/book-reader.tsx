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
import { ReaderChatLayer } from "@/components/reading/chat/reader-chat-layer";
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
type Chapter = { title: string; docTop: number; startPage: number | null };

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
  // The chapter the reading line currently sits in, plus how far through it we
  // are — shown in the header alongside the overall progress.
  const [chapter, setChapter] = useState<{ title: string; detail: string | null } | null>(null);
  // The book header stays out of the way: revealed only when the mouse is up in
  // the top region, or while the contents menu is open.
  const [hoverTop, setHoverTop] = useState(false);
  const [tocOpen, setTocOpen] = useState(false);
  // Touch devices have no hover: a tap (not a scroll) anywhere toggles the chrome,
  // the way the Kindle app reveals/hides its bars.
  const [chromeTapped, setChromeTapped] = useState(false);
  const headerVisible = hoverTop || tocOpen || chromeTapped;
  // Reader chat lives in the margin; opening its panel narrows the column.
  const [chatPanelOpen, setChatPanelOpen] = useState(false);
  // Bumped whenever the layout moves, so chat markers re-place themselves.
  const [layoutNonce, setLayoutNonce] = useState(0);

  const contentRef = useRef<HTMLDivElement>(null);
  const anchorsRef = useRef<Anchor[]>([]);
  const chaptersRef = useRef<Chapter[]>([]);
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

    // Resolve each table-of-contents heading to its document position, plus the
    // source page it starts on, so the header can show progress within a chapter.
    // Skip the entry that's just the book's own title (some TOCs lead with it) —
    // it isn't a chapter, and treating it as one makes the readout repeat itself.
    const bookTitle = title.trim().toLowerCase();
    const chapters: Chapter[] = [];
    for (const entry of toc) {
      if (entry.title.trim().toLowerCase() === bookTitle) continue;
      const el = document.getElementById(entry.anchorId);
      if (!el) continue;
      const docTop = el.getBoundingClientRect().top + window.scrollY;
      let startPage: number | null = null;
      for (const a of anchors) {
        if (a.docTop <= docTop + READING_LINE_OFFSET) startPage = a.pageNumber;
        else break;
      }
      chapters.push({ title: entry.title, docTop, startPage });
    }
    chapters.sort((a, b) => a.docTop - b.docTop);
    chaptersRef.current = chapters;
  }, [toc, title]);

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

    // Which chapter is the reading line in, and how far through it are we? With
    // real pages we show "page N of M to the next chapter"; otherwise a chapter-
    // relative percent. Before the first heading (front matter) there's no chapter.
    // Only worth showing chapter context when the book actually has multiple
    // chapters — with one (or none) it would just echo the overall progress.
    const chapters = chaptersRef.current;
    let chIdx = -1;
    for (let i = 0; i < chapters.length; i++) {
      if (chapters[i].docTop <= line) chIdx = i;
      else break;
    }
    const cur = chIdx >= 0 && chapters.length >= 2 ? chapters[chIdx] : null;
    if (cur) {
      const next = chapters[chIdx + 1] ?? null;
      let detail: string | null = null;
      if (hasRealPages && cur.startPage != null && pageNumber != null) {
        const inChapter = pageNumber - cur.startPage + 1;
        const endPage = next?.startPage ?? pageCount;
        const span = endPage != null ? endPage - cur.startPage : null;
        detail = span && span > 0 ? `Page ${inChapter} of ${span}` : `Page ${inChapter}`;
      } else {
        const endTop =
          next?.docTop ?? document.documentElement.scrollHeight - window.innerHeight;
        const span = endTop - cur.docTop;
        const chPct = span > 0 ? Math.round(((line - cur.docTop) / span) * 100) : 0;
        detail = `${Math.min(100, Math.max(0, chPct))}% through`;
      }
      setChapter({ title: cur.title, detail });
    } else {
      setChapter(null);
    }

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
  }, [flush, hasRealPages, pageCount]);

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
        setLayoutNonce((n) => n + 1);
      });
    } else {
      void waitForLayoutToSettle().then(() => {
        if (cancelled) return;
        measure();
        restore();
        onScroll();
        setLayoutNonce((n) => n + 1);
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

  // Opening the chat panel narrows the reading column, which re-wraps every
  // line and changes the height of the whole document — and every position in
  // here is document-absolute. Without pinning it, the reader visibly loses
  // their place. So: note which block is at the reading line BEFORE the shift,
  // then put it back afterwards.
  const preserveRef = useRef<{ el: HTMLElement; delta: number } | null>(null);

  const captureReadingLine = useCallback(() => {
    const container = contentRef.current;
    if (!container) return;
    const line = window.scrollY + READING_LINE_OFFSET;
    let best: HTMLElement | null = null;
    for (const el of container.querySelectorAll<HTMLElement>(
      "p, h1, h2, h3, h4, h5, h6"
    )) {
      if (el.getBoundingClientRect().top + window.scrollY <= line) best = el;
      else break;
    }
    if (!best) return;
    preserveRef.current = {
      el: best,
      delta: best.getBoundingClientRect().top + window.scrollY - line,
    };
  }, []);

  const restoreReadingLine = useCallback(() => {
    const pinned = preserveRef.current;
    preserveRef.current = null;
    if (!pinned || !pinned.el.isConnected) return;
    window.scrollTo({
      top:
        pinned.el.getBoundingClientRect().top +
        window.scrollY -
        pinned.delta -
        READING_LINE_OFFSET,
    });
  }, []);

  const handleChatPanelOpenChange = useCallback(
    (open: boolean) => {
      // Capture while the DOM is still at its pre-shift width.
      captureReadingLine();
      setChatPanelOpen(open);
    },
    [captureReadingLine]
  );

  // Re-measure and re-pin once the margin transition has finished.
  useEffect(() => {
    if (html == null) return;
    const timer = setTimeout(() => {
      measure();
      restoreReadingLine();
      onScroll();
      setLayoutNonce((n) => n + 1);
    }, 240);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatPanelOpen]);

  const scrollToAnchor = useCallback((anchorId: string) => {
    const el = document.getElementById(anchorId);
    if (!el) return;
    window.scrollTo({
      top: el.getBoundingClientRect().top + window.scrollY - READING_LINE_OFFSET,
    });
  }, []);

  // Mobile: a clean tap (not a scroll, not a tap on a link/button) toggles the
  // reader chrome. A drag past a few pixels or a long press is treated as a
  // scroll/select and left alone.
  useEffect(() => {
    let startX = 0;
    let startY = 0;
    let startT = 0;
    let moved = false;
    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) {
        moved = true;
        return;
      }
      const t = e.touches[0];
      startX = t.clientX;
      startY = t.clientY;
      startT = e.timeStamp;
      moved = false;
    };
    const onMove = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t) return;
      if (Math.abs(t.clientX - startX) > 10 || Math.abs(t.clientY - startY) > 10) {
        moved = true;
      }
    };
    const onEnd = (e: TouchEvent) => {
      if (moved || e.timeStamp - startT > 500) return;
      const target = e.target as HTMLElement | null;
      // Don't hijack taps meant for links, buttons, or the contents menu.
      if (target?.closest('a, button, [role="menuitem"], input, textarea, select')) {
        return;
      }
      setChromeTapped((v) => !v);
    };
    document.addEventListener("touchstart", onStart, { passive: true });
    document.addEventListener("touchmove", onMove, { passive: true });
    document.addEventListener("touchend", onEnd);
    return () => {
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onEnd);
    };
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
            "relative h-full border-b border-border/60 bg-background/80 backdrop-blur transition-opacity duration-200 focus-within:opacity-100 focus-within:pointer-events-auto",
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
          {/* Slim completion bar along the header's bottom edge. */}
          {html != null && !loadError && (
            <div className="absolute inset-x-0 bottom-0 h-0.5 bg-border/50">
              <div
                className="h-full bg-foreground/70 transition-[width] duration-200"
                style={{ width: `${percent}%` }}
              />
            </div>
          )}
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
          className={cn(
            "mx-auto w-full max-w-2xl px-6 pt-20 pb-32 font-serif text-[1.15rem] leading-8 text-foreground",
            // Shift rather than overlay: the text has to stay readable and
            // selectable while the chat is open. 28rem, not the panel's 26rem —
            // the extra 2rem is clearance for the chat gutter, which sits
            // outside the text column and would otherwise slide under the panel.
            "transition-[margin] duration-200",
            chatPanelOpen && "md:mr-[28rem]"
          )}
        >
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
          {/* Positioned so the chat marker gutter can sit against the column. */}
          <div className="relative">
            <div
              ref={contentRef}
              className={cn(
                "[&_blockquote]:my-4 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-4 [&_blockquote]:italic [&_p]:mb-5 [&_.page-anchor]:block [&_.page-anchor]:h-0 [&_.reader-heading]:scroll-mt-28 [&_.reader-heading]:text-center [&_.reader-heading]:font-serif [&_.reader-heading]:text-balance [&_.reader-h1]:mt-16 [&_.reader-h1]:mb-3 [&_.reader-h1]:text-3xl [&_.reader-h1]:font-semibold [&_.reader-h1]:tracking-tight first:[&_.reader-h1]:mt-2 [&_.reader-h2]:mt-8 [&_.reader-h2]:mb-7 [&_.reader-h2]:text-xl [&_.reader-h2]:font-medium [&_.reader-h2]:text-muted-foreground",
                isArticle && "article-content",
                isArticle && ARTICLE_PROSE
              )}
              dangerouslySetInnerHTML={{ __html: html }}
            />
            {/* Books only: articles keep images/links/lists, which breaks the
                flat block model anchors are addressed in. */}
            {!isArticle && (
              <ReaderChatLayer
                bookId={bookId}
                memberEmail={memberEmail}
                html={html}
                contentRef={contentRef}
                currentPage={currentPage}
                scrollToAnchor={scrollToAnchor}
                panelOpen={chatPanelOpen}
                onPanelOpenChange={handleChatPanelOpenChange}
                layoutNonce={layoutNonce}
              />
            )}
          </div>
        </article>
      )}

      {/* Progress indicator, bottom-center where it's always lived — but it only
          fades in while the top bar is active (hovered or contents open), so it
          stays out of the way during reading. */}
      {html != null && !loadError && (
        <div
          className={cn(
            "pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center px-6 transition-opacity duration-200",
            headerVisible ? "opacity-100" : "opacity-0"
          )}
        >
          <span className="flex max-w-full items-center gap-2 rounded-full bg-foreground/85 px-3.5 py-1.5 text-xs font-medium text-background shadow-sm backdrop-blur">
            <span className="whitespace-nowrap tabular-nums">
              {hasRealPages && currentPage != null
                ? `Page ${currentPage}${pageCount ? ` of ${pageCount}` : ""}`
                : `${percent}%`}
            </span>
            {chapter && (
              <>
                <span className="opacity-40">·</span>
                <span className="truncate opacity-90">
                  {chapter.title}
                  {chapter.detail ? ` · ${chapter.detail}` : ""}
                </span>
              </>
            )}
          </span>
        </div>
      )}
    </div>
  );
}
