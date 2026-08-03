"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import Link from "next/link";
import { List, Loader2, MoreHorizontal, PanelLeft, Settings2 } from "lucide-react";
import { getReadingPosition, saveReadingPosition } from "@/app/(reading)/reader/actions";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ReaderAnnotationLayer } from "@/components/reading/annotations/reader-annotation-layer";
import { blockIndexForCharOffset, blockMap } from "@/lib/reading/block-stream";
import { blockElements } from "@/lib/reading/annotation-anchors";
import { describeDownload, loadBookHtml } from "@/lib/reading/offline/content-cache";
import {
  markPositionSynced,
  pendingPositions,
  readPosition,
  rememberPosition,
} from "@/lib/reading/offline/positions";
import {
  PAGE_PAD_BOTTOM,
  bookAreaWidth,
  sidePanelFits,
  type ChatPanelPresentation,
} from "@/lib/reading/paged-geometry";
import { note, startTimer, time } from "@/lib/reading/perf";
import { localPositionWins, shouldOfferElsewhere } from "@/lib/reading/position-sync";
import {
  getServerViewportSize,
  getViewportSize,
  subscribeViewport,
} from "@/lib/reading/viewport-size";
import { MARGIN_MEASURE_PX } from "@/lib/reading/reader-settings";
import {
  chapterBounds,
  progressAt,
  totalCharsOf,
  type ReadingProgress,
} from "@/lib/reading/reading-progress";
import { formatTimeLeft } from "@/lib/reading/reading-time";
import { cn } from "@/lib/utils";
import type { ReadingTocEntry } from "@/lib/types";
import { PagedView } from "./paged-view";
import { ReaderElsewhereBar } from "./reader-elsewhere-bar";
import { ReaderFooter } from "./reader-footer";
import { ReaderLayoutDialog } from "./reader-layout-dialog";
import { ReaderPerfOverlay } from "./reader-perf-overlay";
import {
  ARTICLE_PROSE,
  BOOK_PROSE,
  BOOK_PROSE_SCROLL,
  typographyStyle,
} from "./reader-prose";
import { usePagination } from "./use-pagination";
import { useReaderSettings } from "./use-reader-settings";

/**
 * Reading a book.
 *
 * Two ways to read it, one idea of where you are. Paged mode lays the whole book
 * out as columns and moves sideways a screenful at a time; scrolling mode is the
 * long single column it has always been. Which one you get is a per-device
 * setting, because the right answer on a wide desktop and on a phone are not the
 * same answer.
 *
 * The thing that makes the two coexist is that position is stored as a character
 * offset into the converted text (block-stream.ts) rather than as a scroll
 * position or a page number. Characters don't move when the font size changes,
 * when a second column appears, or when you pick the book up on another device —
 * so all of those are free, and both modes agree on what "43%" means.
 */

// Where "the top of the screen" is for the scrolling reader, allowing for the
// space the header occupies.
const READING_LINE_OFFSET = 72;

const READING_SETTLE_CAP_MS = 2000;
const SAVE_DEBOUNCE_MS = 1500;

export function BookReader({
  bookId,
  memberEmail,
  title,
  author,
  isArticle = false,
  dek = null,
  heroImageUrl = null,
  contentUrl,
  wordCount = null,
  toc,
  resumeCharOffset,
  resumeSavedAt = null,
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
  /** Total body words, for the "time left" estimates. Null on books converted
   * before word counts were recorded — the estimates are then simply omitted. */
  wordCount?: number | null;
  toc: ReadingTocEntry[];
  /** Where to open, in the conversion char space. Resolved server-side. */
  resumeCharOffset: number;
  /**
   * When that position was recorded. The book's own "as of", so a reader that
   * has been opened and left alone still knows how old the place it is showing
   * is, and can recognise another device's later reading as later.
   */
  resumeSavedAt?: string | null;
  backHref: string;
}) {
  const [html, setHtml] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tocOpen, setTocOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [layoutOpen, setLayoutOpen] = useState(false);
  const [chatPanelOpen, setChatPanelOpen] = useState(false);
  // The same store the paging engine derives its geometry from, so the chat
  // panel's presentation and the book's layout can never disagree about how wide
  // the window is.
  const { width: viewportWidth } = useSyncExternalStore(
    subscribeViewport,
    getViewportSize,
    getServerViewportSize
  );

  // Scrolling only: the header stays out of the way until you reach for it.
  const [hoverTop, setHoverTop] = useState(false);
  const [chromeTapped, setChromeTapped] = useState(false);
  const [scrollRevealed, setScrollRevealed] = useState(false);
  // Bumped whenever the scrolling layout moves, so chat markers re-place.
  const [scrollLayoutNonce, setScrollLayoutNonce] = useState(0);

  const { settings, update: updateSetting } = useReaderSettings();
  // Articles keep their images, tables and code, which column pagination breaks
  // in ways that would take figure-aware fragmentation to fix. They're short
  // enough that scrolling costs nothing, so they simply don't page.
  const paged = !isArticle && settings.paged;

  // The paged reading area, as state: it doesn't exist until the book's HTML has
  // loaded, and everything that measures it needs something to re-run on when it
  // appears. A ref measured once against nothing and never tried again.
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null);
  const flowRef = useRef<HTMLDivElement>(null);
  const scrollContentRef = useRef<HTMLDivElement>(null);
  const contentRef = paged ? flowRef : scrollContentRef;

  const blocks = useMemo(
    () =>
      html == null
        ? []
        : time("blockMap", () => blockMap(html), () => `${Math.round(html.length / 1000)}k chars`),
    [html]
  );
  const totalChars = useMemo(() => totalCharsOf(blocks), [blocks]);
  const chapters = useMemo(
    () => (blocks.length === 0 ? [] : chapterBounds(toc, title, blocks)),
    [blocks, title, toc]
  );

  // Load the book — from the device when we already have it, which is what makes
  // opening it again later work with no network at all. Opening a book is what
  // downloads it; there's no separate step.
  useEffect(() => {
    let cancelled = false;
    const stopLoad = startTimer("load");
    loadBookHtml(bookId, contentUrl)
      .then(({ html: text, fromCache }) => {
        if (cancelled) return;
        stopLoad(`${fromCache ? "device" : "network"} ${Math.round(text.length / 1000)}k chars`);
        setHtml(text);
        // Only the reader page knows what the book is called, so the shelf's
        // "available offline" list is filled in from here.
        void describeDownload(bookId, { title, author, isArticle });
      })
      .catch((err) => {
        if (!cancelled) {
          setLoadError(
            err instanceof Error && navigator.onLine
              ? err.message
              : "This book isn't downloaded yet — open it once while you're online."
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [author, bookId, contentUrl, isArticle, title]);


  // ---- Position -----------------------------------------------------------

  // Where the reader is, in characters, while scrolling — paged mode keeps its
  // own and is read below. Mirrored in a ref so the save and the scroll handler
  // can read it without re-subscribing, and held in state so the chat layer and
  // a mode switch see the current value rather than the one the book opened at.
  const [scrollPosition, setScrollPosition] = useState({
    charOffset: resumeCharOffset,
    atEnd: false,
  });
  const positionRef = useRef(resumeCharOffset);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const totalCharsRef = useRef(0);
  totalCharsRef.current = totalChars;

  /**
   * How old this device's idea of its own place is.
   *
   * Starts as the timestamp on the position the page was rendered with, and
   * moves on with every save. It's the thing another device's position is
   * measured against: a later timestamp somewhere else means someone has been
   * reading since, which is the only case worth interrupting anybody over.
   *
   * Server clock against device clock, strictly speaking. A few seconds of skew
   * either way doesn't matter, because a difference in time alone never shows
   * anything — the position has to have genuinely moved as well.
   */
  const ourSavedAtRef = useRef<string | null>(resumeSavedAt);
  /**
   * Whether the server has told us where this book actually is.
   *
   * Until it has, a page turn goes to the device but is not published. The page
   * we're looking at may have come from the service worker's cache, and
   * publishing its resume point would make a days-old place the newest thing
   * there is — a phone's evening of reading destroyed by one page turn on a
   * tablet that was merely woken up. The device write still happens either way,
   * and the replay carries it up afterwards with its own timestamp, which the
   * server checks against what it already has.
   */
  const publishReadyRef = useRef(false);
  /** Somewhere else's position, in characters, once it's worth offering. */
  const [elsewhere, setElsewhere] = useState<number | null>(null);
  /**
   * The place already offered and answered.
   *
   * Kept as a position rather than a timestamp, because "no thanks" means no
   * thanks to that place — and a device left open on it goes on re-saving the
   * same position with a new time. Somewhere genuinely different is new
   * information and gets to ask again.
   */
  const answeredRef = useRef<number | null>(null);
  /**
   * A place to move to that isn't the reader's own doing: a position restored
   * from the device, or one accepted from another device. Applied through the
   * jump both reading modes already share, once there's a book to jump in.
   */
  const [pendingJump, setPendingJump] = useState<number | null>(null);

  // A position the server never received usually outranks the one the page was
  // rendered with — either we read offline since, or this page itself came from
  // the service worker's cache and its resume point is however old that copy is.
  // Once a position has synced, the server's answer already includes it.
  useEffect(() => {
    let cancelled = false;
    void readPosition(bookId).then((stored) => {
      if (cancelled || !stored?.dirty) return;
      if (!localPositionWins(stored.savedAt, resumeSavedAt)) return;
      ourSavedAtRef.current = stored.savedAt;
      setPendingJump(stored.charOffset);
    });
    return () => {
      cancelled = true;
    };
  }, [bookId, resumeSavedAt]);

  // Local first, server second. The device write is the one that must not fail:
  // reading three chapters offline and having the book reopen at the start is
  // the only offline failure that would actually be felt.
  const flush = useCallback(() => {
    const charOffset = positionRef.current;
    const total = totalCharsRef.current;
    // The shelf reads this for each book's percent label, so it keeps being
    // written — just derived from the character offset instead of pixels.
    const scrollRatio = total > 0 ? Math.min(1, charOffset / total) : null;

    void rememberPosition(bookId, charOffset, scrollRatio).then((record) => {
      ourSavedAtRef.current = record.savedAt;
      if (!publishReadyRef.current) return;
      return saveReadingPosition(
        bookId,
        { charOffset, scrollRatio, anchorId: null, pageNumber: null },
        memberEmail
      )
        .then(() => markPositionSynced(record))
        .catch(() => {});
    });
  }, [bookId, memberEmail]);

  // Hand back anything the server never got. Positions carry the time they were
  // taken, so replaying an old one can't overwrite newer reading from another
  // device — which is also what makes it safe to hold saves back until the
  // check below has run: nothing is lost, it just arrives timestamped.
  const replayPending = useCallback(() => {
    void pendingPositions().then((pending) => {
      for (const p of pending) {
        void saveReadingPosition(
          p.bookId,
          {
            charOffset: p.charOffset,
            scrollRatio: p.scrollRatio,
            anchorId: null,
            pageNumber: null,
            savedAt: p.savedAt,
          },
          memberEmail
        )
          .then(() => markPositionSynced(p))
          .catch(() => {});
      }
    });
  }, [memberEmail]);

  /**
   * Ask where this book actually is, and offer the answer if it isn't ours.
   *
   * Runs on open and every time the book comes back to the foreground, which is
   * the case that matters: a reading device is rarely closed, it's put down. A
   * Boox with the book still on screen from yesterday never reloads the page and
   * so never learns anything — this is the only thing that tells it.
   */
  const checkElsewhere = useCallback(() => {
    void getReadingPosition(bookId, memberEmail)
      .then((remote) => {
        publishReadyRef.current = true;
        replayPending();
        if (
          remote &&
          shouldOfferElsewhere({
            remote,
            ourSavedAt: ourSavedAtRef.current,
            current: positionRef.current,
            answered: answeredRef.current,
          })
        ) {
          setElsewhere(remote.charOffset);
        }
      })
      .catch(() => {
        // Offline, most likely. Publishing has to resume regardless, or a device
        // that opened the book with no network would never save again; the
        // timestamps on the replay are what keep that safe.
        publishReadyRef.current = true;
      });
  }, [bookId, memberEmail, replayPending]);

  const report = useCallback(
    (next: number, atEnd: boolean) => {
      positionRef.current = next;
      setScrollPosition({ charOffset: next, atEnd });
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(flush, SAVE_DEBOUNCE_MS);
    },
    [flush]
  );

  useEffect(() => {
    // Going away is the moment to publish: the position is final, and on a phone
    // it's the last thing that runs before the tab is frozen.
    const onHide = () => {
      if (document.visibilityState !== "hidden" && document.hidden) return;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      flush();
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") onHide();
      else checkElsewhere();
    };
    checkElsewhere();
    window.addEventListener("pagehide", onHide);
    window.addEventListener("online", checkElsewhere);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", onHide);
      window.removeEventListener("online", checkElsewhere);
      document.removeEventListener("visibilitychange", onVisibility);
      if (saveTimer.current) clearTimeout(saveTimer.current);
      flush();
    };
  }, [checkElsewhere, flush]);

  // ---- Paged --------------------------------------------------------------

  /**
   * Whether the chat has to be presented over the book rather than beside it.
   *
   * A 448px panel needs a column's width left over, and on a phone or an iPad
   * held upright there isn't one — the book would be squeezed to a ribbon. It's
   * a sheet there instead, and the point of a sheet is that it doesn't move the
   * book at all: the geometry below never hears about it, so opening the chat
   * costs nothing. That was a real bug on a phone, where the sheet was already
   * shown but the book was still being re-fragmented to 240px underneath it.
   */
  const chatAsSheet =
    paged && viewportWidth > 0 && !sidePanelFits(viewportWidth, settings);
  /**
   * ...and, if it's beside the book, whether it takes width from it.
   *
   * A floating panel has the sheet's best property on a desktop too: the book is
   * never told about it. Not a cheaper re-layout — no re-layout. The page keeps
   * its columns, its position and its margins, and the panel sits over the outer
   * one, because a page that rearranges itself under your eye mid-sentence is
   * worse than a page partly covered.
   *
   * Docking is the old behaviour, now opt-in: two columns at a comfortable
   * measure plus a docked panel needs about 1780px of window, and a 15" laptop is
   * 80px short, so docking costs a column there. See PanelDockToggle.
   */
  const chatCanFloat = paged && !chatAsSheet;
  const chatPanel: ChatPanelPresentation = !chatPanelOpen || chatAsSheet
    ? "closed"
    : chatCanFloat && !settings.chatDocked
      ? "floating"
      : "docked";

  const pagination = usePagination({
    enabled: paged,
    html,
    flowRef,
    blocks,
    settings,
    chatPanel,
    charOffset: scrollPosition.charOffset,
    onPositionChange: report,
  });

  // Where you are and how much is left are a pure function of the character
  // offset, so they're derived rather than pushed through state — which is what
  // lets a book opened halfway through show the right chapter and percentage on
  // its very first frame, in either mode.
  const currentCharOffset = paged ? pagination.charOffset : scrollPosition.charOffset;
  const atEnd = paged ? pagination.atEnd : scrollPosition.atEnd;
  const charEnd = paged ? pagination.charEnd : undefined;
  const progress: ReadingProgress = useMemo(
    () => progressAt(currentCharOffset, totalChars, wordCount, chapters, atEnd, charEnd),
    [atEnd, chapters, charEnd, currentCharOffset, totalChars, wordCount]
  );

  // A paged reader owns the whole window; letting the document scroll behind it
  // just produces rubber-banding with nothing underneath.
  useEffect(() => {
    if (!paged) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [paged]);

  // ---- Scrolling ----------------------------------------------------------

  const blockTopsRef = useRef<number[]>([]);
  const restoredRef = useRef(false);
  const firstLayoutRef = useRef(true);
  const lastScrollY = useRef(0);
  const scrollRevealedRef = useRef(false);

  const measureScroll = useCallback(() => {
    const container = scrollContentRef.current;
    if (!container) return;
    blockTopsRef.current = blockElements(container).map(
      (el) => el.getBoundingClientRect().top + window.scrollY
    );
  }, []);

  const onScroll = useCallback(() => {
    // Reading is downward, so scrolling back up reads as "I want the chrome" —
    // the header slides in on the way up and gets out of the way on the way
    // down. The few pixels of slack keep a trackpad's jitter from flickering it.
    const y = window.scrollY;
    const dy = y - lastScrollY.current;
    const atTop = y <= 8;
    if (atTop || Math.abs(dy) > 4) {
      const reveal = atTop || dy < 0;
      if (reveal !== scrollRevealedRef.current) {
        scrollRevealedRef.current = reveal;
        setScrollRevealed(reveal);
      }
      lastScrollY.current = y;
    }

    const tops = blockTopsRef.current;
    if (tops.length === 0) return;
    const line = y + READING_LINE_OFFSET;
    let lo = 0;
    let hi = tops.length - 1;
    let index = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (tops[mid] <= line) {
        index = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    const charOffset = blocks[index]?.charStart ?? 0;
    const atEnd =
      y + window.innerHeight >= document.documentElement.scrollHeight - 4;

    // Don't persist a position until we've restored the saved one — otherwise
    // the initial scroll-0 frame would overwrite the resume point before the
    // restore runs. (The readouts are derived from the resume point meanwhile,
    // so they're already right; it's only the save that has to wait.)
    if (!restoredRef.current) return;
    report(charOffset, atEnd);
  }, [blocks, report]);

  // Resolve once the document height has stopped changing (images decoding, web
  // fonts swapping), so a restore lands in the right place instead of against a
  // too-short page. Capped so a perpetually-shifting page still restores.
  const waitForLayoutToSettle = useCallback(async () => {
    const container = scrollContentRef.current;
    if (container) {
      const pending = Array.from(container.querySelectorAll("img")).filter(
        (img) => !img.complete
      );
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
          new Promise<void>((resolve) => setTimeout(resolve, READING_SETTLE_CAP_MS)),
        ]);
      }
    }
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

  useEffect(() => {
    if (paged || html == null) return;
    restoredRef.current = false;

    const restore = () => {
      if (restoredRef.current) return;
      // Opening the book only: if they already started reading while we waited
      // for layout, don't yank them back — just stop blocking saves. On a later
      // relayout (they changed the type size) the opposite is true: the pixels
      // moved underneath them and we do have to put the text back.
      if (firstLayoutRef.current && window.scrollY > READING_LINE_OFFSET) {
        restoredRef.current = true;
        return;
      }
      restoredRef.current = true;
      const container = scrollContentRef.current;
      // positionRef, not the resume point: this effect also re-runs when the
      // typography changes, and putting them back where the book was *opened*
      // would be a worse bug than not restoring at all.
      const target = positionRef.current;
      if (!container || target <= 0) return;
      const el = blockElements(container)[blockIndexForCharOffset(blocks, target)];
      if (!el) return;
      window.scrollTo({
        top: el.getBoundingClientRect().top + window.scrollY - READING_LINE_OFFSET,
      });
    };

    const settle = () => {
      measureScroll();
      restore();
      measureScroll();
      onScroll();
      setScrollLayoutNonce((n) => n + 1);
      firstLayoutRef.current = false;
    };

    let cancelled = false;
    const imgs = Array.from(scrollContentRef.current?.querySelectorAll("img") ?? []);
    // If every image already reserves its space (width/height present, as the
    // capture extension stamps), the page is its final height on first paint.
    const layoutStable =
      imgs.length === 0 ||
      imgs.every((img) => img.hasAttribute("width") && img.hasAttribute("height"));

    if (layoutStable) {
      requestAnimationFrame(() => {
        if (!cancelled) settle();
      });
    } else {
      void waitForLayoutToSettle().then(() => {
        if (!cancelled) settle();
      });
    }

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", measureScroll);
    return () => {
      cancelled = true;
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", measureScroll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [html, paged, settings]);

  // Opening the chat panel narrows the scrolling column, which re-wraps every
  // line and changes the height of the whole document. Note which block is at
  // the reading line before the shift, then put it back afterwards. (Paged mode
  // needs none of this: it re-resolves the character offset it already has.)
  const preserveRef = useRef<{ el: HTMLElement; delta: number } | null>(null);

  const handleChatPanelOpenChange = useCallback(
    (open: boolean) => {
      const container = scrollContentRef.current;
      if (!paged && container) {
        const line = window.scrollY + READING_LINE_OFFSET;
        let best: HTMLElement | null = null;
        for (const el of blockElements(container)) {
          if (el.getBoundingClientRect().top + window.scrollY <= line) best = el;
          else break;
        }
        preserveRef.current = best
          ? { el: best, delta: best.getBoundingClientRect().top + window.scrollY - line }
          : null;
      }
      // Marked so the timings that follow can be read as "this is what opening
      // the chat cost" — the whole question is whether it still re-fragments.
      note("chat panel", `${open ? "open" : "close"} @${window.innerWidth}px`);
      setChatPanelOpen(open);
    },
    [paged]
  );

  useEffect(() => {
    if (paged || html == null) return;
    const timer = setTimeout(() => {
      const pinned = preserveRef.current;
      preserveRef.current = null;
      if (pinned?.el.isConnected) {
        window.scrollTo({
          top:
            pinned.el.getBoundingClientRect().top +
            window.scrollY -
            pinned.delta -
            READING_LINE_OFFSET,
        });
      }
      measureScroll();
      onScroll();
      setScrollLayoutNonce((n) => n + 1);
    }, 240);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatPanelOpen]);

  // Scrolling on touch: a clean tap (not a scroll, not a tap on a control)
  // toggles the chrome, the way the Kindle app reveals its bars. Paged mode has
  // no use for it — a tap turns the page there, and the chrome never hides.
  useEffect(() => {
    if (paged) return;
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
      if (target?.closest('a, button, [role="menuitem"], input, textarea, select')) {
        return;
      }
      // Nor the tap that dismisses a selection. Once selecting text is the way
      // you annotate, toggling the chrome on every such tap is constant noise.
      const selection = window.getSelection();
      if (selection && !selection.isCollapsed) return;
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
  }, [paged]);

  // ---- Navigation ---------------------------------------------------------

  const goToPagedChar = pagination.goToChar;
  const goToChar = useCallback(
    (charOffset: number) => {
      if (paged) {
        goToPagedChar(charOffset);
        return;
      }
      const container = scrollContentRef.current;
      if (!container) return;
      const el = blockElements(container)[blockIndexForCharOffset(blocks, charOffset)];
      if (!el) return;
      window.scrollTo({
        top: el.getBoundingClientRect().top + window.scrollY - READING_LINE_OFFSET,
      });
    },
    [blocks, goToPagedChar, paged]
  );

  /**
   * Apply a jump that came from outside the reading itself.
   *
   * Both sources — the device's own unsynced position, and one accepted from
   * another device — arrive after the book has been asked for, so they can't be
   * an opening value; they have to be a move. Paged mode needs this because its
   * page is derived from the character it was seeded with and nothing re-seeds
   * it, so an offline position that only ever reached the scroll state was
   * silently ignored on every device reading in pages, which is most of them.
   *
   * Scrolling mode gets it for free while the book is already on screen, but on
   * open its own restore hasn't run yet and knows how to wait for images and web
   * fonts to settle — scrolling before that lands against a half-height page. So
   * that case just moves the mark and lets the restore do the scrolling.
   */
  useEffect(() => {
    if (pendingJump == null || html == null) return;
    setPendingJump(null);
    report(pendingJump, false);
    if (paged || restoredRef.current) goToChar(pendingJump);
  }, [goToChar, html, paged, pendingJump, report]);

  const goToChapter = useCallback(
    (anchorId: string) => {
      const chapter = chapters.find((c) => c.anchorId === anchorId);
      if (chapter) goToChar(chapter.charStart);
    },
    [chapters, goToChar]
  );

  // Open the contents on where you are, not on the front matter: a long book's
  // menu is otherwise a wall of chapters you have to hunt through.
  const tocListRef = useRef<HTMLDivElement>(null);
  const currentChapterAnchor = progress.chapter?.anchorId ?? null;
  useEffect(() => {
    if (!tocOpen || !currentChapterAnchor) return;
    // Two frames: one for the popup to mount, one for it to be laid out.
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => {
        const list = tocListRef.current;
        const item = list?.querySelector<HTMLElement>('[data-toc-current="true"]');
        if (!list || !item) return;
        const delta =
          item.getBoundingClientRect().top - list.getBoundingClientRect().top;
        list.scrollTop = Math.max(0, list.scrollTop + delta - 28);
      });
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, [tocOpen, currentChapterAnchor]);

  // ---- Render -------------------------------------------------------------

  const layoutNonce = paged ? pagination.layoutNonce : scrollLayoutNonce;
  // Memoised: the chat gutter re-places whenever this changes, and a fresh
  // object every render would put it in a render loop.
  const { geometry: pagedGeometry, pageIndex } = pagination;
  const pagedChat = useMemo(
    () =>
      paged && pagedGeometry
        ? { geom: pagedGeometry, pageIndex, viewport }
        : null,
    [paged, pagedGeometry, pageIndex, viewport]
  );

  // Stable, so PagedView's window keydown listener isn't torn down and re-added
  // on every render. Expressed in characters rather than pages because a page
  // number only means something within the chapter currently rendered — Home and
  // End mean the ends of the BOOK.
  const goToFirstPage = useCallback(() => goToPagedChar(0), [goToPagedChar]);
  const goToLastPage = useCallback(
    () => goToPagedChar(Math.max(0, totalChars - 1)),
    [goToPagedChar, totalChars]
  );

  // A page has fixed bounds, so the chrome can simply stay: it never covers
  // text, which is the only reason it had to hide when scrolling.
  const headerVisible = paged || hoverTop || tocOpen || menuOpen || chromeTapped || scrollRevealed;

  // The header and footer keep to the book's own margins rather than the
  // window's, so the running head sits over the text block the way it does in a
  // printed book. Paged mode knows its column bounds exactly; scrolling mode
  // re-uses the article's measure (the +48 adds back its border-box px-6, so
  // both come out at the same text edges).
  const chromeBounds: React.CSSProperties =
    paged && pagedGeometry
      ? { left: pagedGeometry.offsetX, width: pagedGeometry.viewW }
      : {
          left: 0,
          right: 0,
          marginInline: "auto",
          maxWidth: MARGIN_MEASURE_PX[settings.margins] + 48,
        };

  const bookTimeLeft = formatTimeLeft(progress.minutesLeft);
  const chapterTimeLeft = formatTimeLeft(progress.chapter?.minutesLeft ?? null);
  const loaded = html != null && !loadError;

  // Named in the book's own terms — "chapter nine" is a place, "62%" is a
  // measurement, and only one of them tells you whether you want to go.
  const elsewhereProgress = useMemo(
    () =>
      elsewhere == null
        ? null
        : progressAt(elsewhere, totalChars, wordCount, chapters, false),
    [chapters, elsewhere, totalChars, wordCount]
  );

  const answerElsewhere = useCallback(
    (go: boolean) => {
      if (elsewhere == null) return;
      answeredRef.current = elsewhere;
      if (go) setPendingJump(elsewhere);
      setElsewhere(null);
    },
    [elsewhere]
  );

  // Books and articles both: the layer switches coordinate spaces on isArticle
  // rather than opting out. Articles never reach the paged branch, so the paged
  // context it gets there is always null.
  const annotationLayer = loaded && (
    <ReaderAnnotationLayer
      bookId={bookId}
      memberEmail={memberEmail}
      blocks={blocks}
      isArticle={isArticle}
      contentRef={contentRef}
      currentCharOffset={currentCharOffset}
      goToChar={goToChar}
      paged={pagedChat}
      panelOpen={chatPanelOpen}
      onPanelOpenChange={handleChatPanelOpenChange}
      preferSheet={chatAsSheet}
      docked={!chatCanFloat || settings.chatDocked}
      canFloat={chatCanFloat}
      windowBase={paged ? pagination.windowBase : 0}
      layoutNonce={layoutNonce}
    />
  );

  return (
    <div className="flex flex-1 flex-col">
      <div
        className={cn("fixed inset-x-0 top-0 z-40 h-14", paged && "pointer-events-none")}
        onMouseEnter={paged ? undefined : () => setHoverTop(true)}
        onMouseLeave={paged ? undefined : () => setHoverTop(false)}
      >
        <div
          className={cn(
            "relative h-full transition-opacity duration-200 focus-within:pointer-events-auto focus-within:opacity-100",
            // Scrolling needs the bar to be opaque, because text runs under it.
            // A page stops short of it, so it can be nothing but its contents.
            paged
              ? "pointer-events-none [&_a]:pointer-events-auto [&_button]:pointer-events-auto"
              : "border-b border-border/60 bg-background/80 backdrop-blur",
            headerVisible ? "opacity-100" : "pointer-events-none opacity-0"
          )}
        >
          {/* Two different things, so two different rules.

              The way out of the book is a navigation control, not part of the
              page — it belongs to the app. So it sits in the margin, hard
              against the window edge, along with the reader's own options and
              the annotations button that floats there already
              (annotations-button.tsx). Margins are where a book puts its
              furniture. */}
          <Link
            href={backHref}
            aria-label="Back to my books"
            className="absolute top-1/2 left-2 z-10 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:left-3"
          >
            <PanelLeft className="h-4 w-4" />
          </Link>

          <div className="absolute top-1/2 right-12 z-10 -translate-y-1/2">
            <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
              <DropdownMenuTrigger
                aria-label="Reader options"
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <MoreHorizontal className="h-4 w-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-40">
                <DropdownMenuItem onClick={() => setLayoutOpen(true)}>
                  <Settings2 className="h-4 w-4" />
                  Layout
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Where you are, on the other hand, is the running head of this page:
              the book, then the chapter inside it, centred over the text block
              and never wider than it. The padding is what keeps a long title
              from sliding under the margin controls on a narrow window. */}
          <div
            className="absolute inset-y-0 flex items-center justify-center gap-2 px-12"
            style={chromeBounds}
          >
            <div className="min-w-0 text-center">
              <p
                className={cn(
                  "reader-chrome-secondary truncate text-sm font-medium",
                  paged ? "text-muted-foreground/80" : "text-foreground"
                )}
              >
                {title}
                {/* Scrolling has nowhere else to put this; a page has a footer. */}
                {!paged && loaded && (
                  <span className="ml-1.5 text-xs font-normal tabular-nums text-muted-foreground">
                    ({progress.percent}%{bookTimeLeft ? ` · ${bookTimeLeft}` : ""})
                  </span>
                )}
              </p>
              {author && !paged && (
                <p className="truncate text-xs text-muted-foreground">{author}</p>
              )}
            </div>

            {toc.length > 0 && (
              <DropdownMenu open={tocOpen} onOpenChange={setTocOpen}>
                <DropdownMenuTrigger
                  aria-label="Table of contents"
                  className="inline-flex min-w-0 max-w-[32vw] shrink items-center gap-1.5 rounded-md px-2 py-1 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <List className="h-4 w-4 shrink-0" />
                  {/* Where you are, not what the menu is — the icon already says
                      "contents". In paged mode the footer names the chapter, so
                      the trigger stays an icon and the bar stays quiet. */}
                  {!paged && (
                    <>
                      <span className="hidden truncate sm:inline">
                        {progress.chapter?.title ?? "Contents"}
                      </span>
                      {chapterTimeLeft && (
                        <span className="hidden shrink-0 text-xs tabular-nums opacity-70 sm:inline">
                          · {chapterTimeLeft}
                        </span>
                      )}
                    </>
                  )}
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  ref={tocListRef}
                  align="center"
                  className="max-h-80 w-64 overflow-y-auto"
                >
                  {toc.map((entry) => {
                    const current = entry.anchorId === currentChapterAnchor;
                    return (
                      <DropdownMenuItem
                        key={entry.anchorId}
                        data-toc-current={current || undefined}
                        onClick={() => goToChapter(entry.anchorId)}
                        className={cn(
                          "flex items-baseline justify-between gap-3",
                          entry.level <= 1
                            ? "font-medium text-foreground"
                            : "pl-4 text-muted-foreground",
                          current && "bg-accent font-medium text-accent-foreground"
                        )}
                      >
                        <span className="truncate">{entry.title}</span>
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>

          {/* Slim completion bar along the header's bottom edge. */}
          {!paged && loaded && (
            <div className="absolute inset-x-0 bottom-0 h-0.5 bg-border/50">
              <div
                className="h-full bg-foreground/70 transition-[width] duration-200"
                style={{ width: `${progress.percent}%` }}
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
        // reader-opening: e-ink drops the spinner and keeps the words — see
        // globals.css. A spinning glyph on a panel that repaints in tenths of a
        // second is a smear, and this is the one loading state you see every
        // time you open a book.
        <div className="reader-opening mx-auto mt-24 flex flex-col items-center gap-2 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="text-sm">Opening your book…</span>
        </div>
      ) : paged ? (
        <>
          <PagedView
            // The window, not the whole book — see usePagination.
            html={pagination.html ?? ""}
            viewport={viewport}
            onViewportRef={setViewport}
            flowRef={flowRef}
            geometry={pagination.geometry}
            settings={settings}
            isFirstPage={pagination.atStart}
            isLastPage={pagination.atEnd}
            onNext={pagination.next}
            onPrev={pagination.prev}
            onFirst={goToFirstPage}
            onLast={goToLastPage}
          >
            {annotationLayer}
          </PagedView>
          <ReaderFooter
            chapterTitle={progress.chapter?.title ?? null}
            chapterMinutesLeft={progress.chapter?.minutesLeft ?? null}
            percent={progress.percent}
            minutesLeft={progress.minutesLeft}
            height={PAGE_PAD_BOTTOM}
            left={pagedGeometry?.offsetX ?? null}
            width={pagedGeometry?.viewW ?? null}
          />
        </>
      ) : (
        <article
          className={cn(
            "mx-auto w-full px-6 pt-20 pb-32 font-serif text-foreground",
            // Shift rather than overlay: the text has to stay readable and
            // selectable while the chat is open. 28rem, not the panel's 26rem —
            // the extra 2rem is clearance for the chat gutter, which sits
            // outside the text column and would otherwise slide under the panel.
            //
            // Always, unlike paged mode, which floats by default. There is no
            // second column here to save by covering one, and on any window wide
            // enough for the panel the shift only moves the column — its measure
            // is capped, so nothing re-wraps.
            "transition-[margin] duration-200",
            chatPanelOpen && "md:mr-[28rem]"
          )}
          // Scrolling honours the Margins setting too, so the choice means the
          // same thing in both modes. The padding is added back because the box
          // is border-box, and it's the text that should be this wide.
          style={{
            ...typographyStyle(settings),
            maxWidth: MARGIN_MEASURE_PX[settings.margins] + 48,
          }}
        >
          {/* Readability returns the title/dek/hero separately from the body, so
              the reader reconstructs the article header for web articles. */}
          {isArticle && (
            <header className="mb-8">
              <h1 className="font-serif text-3xl font-semibold tracking-tight text-balance text-foreground">
                {title}
              </h1>
              {dek && (
                <p className="mt-3 text-lg leading-snug text-muted-foreground">{dek}</p>
              )}
              {author && <p className="mt-4 text-sm text-muted-foreground">By {author}</p>}
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
              ref={scrollContentRef}
              className={cn(
                BOOK_PROSE,
                BOOK_PROSE_SCROLL,
                isArticle && "article-content",
                isArticle && ARTICLE_PROSE
              )}
              dangerouslySetInnerHTML={{ __html: html }}
            />
            {/* Books and articles both. Articles keep images/links/lists, so
                they have no conversion char space and no page map — the layer
                switches coordinate spaces on isArticle rather than opting out. */}
            {annotationLayer}
          </div>
        </article>
      )}

      {loaded && elsewhereProgress && (
        <ReaderElsewhereBar
          chapterTitle={elsewhereProgress.chapter?.title ?? null}
          percent={elsewhereProgress.percent}
          // Clear of the running foot in paged mode; clear of the thumb in
          // scrolling mode, where the bottom edge is where the text keeps going.
          bottom={paged ? PAGE_PAD_BOTTOM + 8 : 24}
          onGo={() => answerElsewhere(true)}
          onDismiss={() => answerElsewhere(false)}
        />
      )}

      <ReaderPerfOverlay />

      <ReaderLayoutDialog
        open={layoutOpen}
        onOpenChange={setLayoutOpen}
        settings={settings}
        onChange={updateSetting}
        supportsPaging={!isArticle}
        // The live answer, chat panel included: what the Columns control offers
        // has to match what the book is doing behind the dialog. A floating panel
        // isn't counted, because the book genuinely still has that width.
        availableWidth={bookAreaWidth(viewportWidth, chatPanel === "docked")}
      />
    </div>
  );
}
