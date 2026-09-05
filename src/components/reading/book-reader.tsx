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
import {
  ArrowLeft,
  Bookmark,
  Headphones,
  Languages,
  List,
  Loader2,
  Settings2,
} from "lucide-react";
import { getReadingPosition, saveReadingPosition } from "@/app/(reading)/reader/actions";
import {
  useAudiobook,
  useAudiobookControls,
} from "@/components/audiobook/audiobook-provider";
import { useAudiobookFollow } from "@/components/reading/use-audiobook-follow";
import { AUDIOBOOK_BAR_HEIGHT } from "@/lib/reading/audio/constants";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ReaderAnnotationLayer } from "@/components/reading/annotations/reader-annotation-layer";
import type { MentionTarget } from "@/lib/reading/mentions";
import { blockIndexForCharOffset, blockMap } from "@/lib/reading/block-stream";
import { blockElements } from "@/lib/reading/annotation-anchors";
import { withInlineChats, type InlineChatMark } from "@/lib/reading/inline-chat-blocks";
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
  computeGeometry,
  sidePanelFits,
  type ChatPanelPresentation,
} from "@/lib/reading/paged-geometry";
import { note, startTimer, time } from "@/lib/reading/perf";
import {
  localPositionWins,
  readingHappened,
  shouldOfferElsewhere,
} from "@/lib/reading/position-sync";
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
import type { BookScope } from "@/lib/reading/book-documents";
import type { BookDocumentState } from "@/lib/reading/annotation-types";
import { getBookDocumentStates } from "@/app/(reading)/reader/annotation-actions";
import { cn } from "@/lib/utils";
import type { ReadingTocEntry } from "@/lib/types";
import { PagedView } from "./paged-view";
import { ReaderElsewhereBar } from "./reader-elsewhere-bar";
import { ReaderReturnPill } from "./reader-return-pill";
import { ReaderFooter } from "./reader-footer";
import { ReaderLayoutDialog } from "./reader-layout-dialog";
import { ContentsDialog, type ContentsBookmark } from "./contents-dialog";
import { BookmarkDialog } from "./bookmark-dialog";
import { BookmarkRemovedPill } from "./bookmark-removed-pill";
import { useBookmarks } from "./use-bookmarks";
import { bookmarkLabel, bookmarkPlace } from "@/lib/reading/bookmarks";
import { ReaderPerfOverlay } from "./reader-perf-overlay";
import {
  ARTICLE_PROSE,
  BOOK_PROSE,
  BOOK_PROSE_SCROLL,
  typographyStyle,
} from "./reader-prose";
import { usePagination } from "./use-pagination";
import { useReaderSettings } from "./use-reader-settings";
import { usePlainEnglish } from "./use-plain-english";
import { PlainEnglishDialog } from "./plain-english-dialog";
import { ParallelView } from "./parallel-view";
import { useParallelPagination } from "./use-parallel-pagination";
import { TermPopoverController } from "./term-popover";
import { PLAIN_MARK_ATTR, plainDocumentHtml } from "@/lib/reading/plain/render";
import type { ReadingFace } from "@/lib/reading/plain/types";

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

/** Stable identity, so a book with no glossary doesn't re-subscribe the term listener. */
const NO_TERMS: import("@/lib/reading/plain/types").PlainTerm[] = [];

const READING_SETTLE_CAP_MS = 2000;
const SAVE_DEBOUNCE_MS = 1500;

/** Vertical pitch when both bottom-edge pills are outstanding at once. */
const FLOATING_PILL_STACK = 44;

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
  openNotes = false,
  mentionTargets,
  openMarkId = null,
  backHref,
  canListen = false,
  readingFace = "original",
  fiction = null,
  charCount = null,
  hasRealPages = false,
}: {
  bookId: string;
  memberEmail: string | null;
  /** Which face this reader last chose for this book — see plain/types.ts. */
  readingFace?: ReadingFace;
  /** The book's fiction flag, for the Plain English warning. */
  fiction?: boolean | null;
  /** Characters of converted text, for the Plain English cost estimate. */
  charCount?: number | null;
  /**
   * Whether this book's page numbers come from the file itself. False for the
   * synthetic page map most books here carry, in which case a bookmark names
   * its place by percentage — "p. 212" that matches no printed copy is worse
   * than a number that is at least true.
   */
  hasRealPages?: boolean;
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
  /**
   * Open on the list of everything marked in this book, rather than on the book
   * alone. Set when you arrive from the shelf's annotation count, which promises
   * the notes and would otherwise land you in the text with the panel shut.
   */
  openNotes?: boolean;
  /** Everyone who can be named in a mark — resolved on the server, see the layer. */
  mentionTargets: MentionTarget[];
  /** A mark to open and jump to on arrival, from a mention's permalink. */
  openMarkId?: string | null;
  backHref: string;
  /**
   * Whether this account may have a book read aloud. Adults only, on purpose —
   * see lib/reading/audio/access.ts for why. The routes enforce it; this keeps
   * the control from being offered to someone it would refuse.
   */
  canListen?: boolean;
}) {
  const [html, setHtml] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // One menu in the middle of the header now — the book's name opens it, and it
  // holds both what to do with the book and where to go in it.
  const [menuOpen, setMenuOpen] = useState(false);
  /**
   * The conversations that leave a line in the page.
   *
   * Owned here rather than by the chat layer because they are part of the book's
   * markup: the paged reader has to fragment the text with them already in it,
   * or the mark would sit on top of a layout that never made room for it. See
   * inline-chat-blocks.ts.
   */
  const [inlineMarks, setInlineMarks] = useState<InlineChatMark[]>([]);
  const [layoutOpen, setLayoutOpen] = useState(false);
  const [plainDialogOpen, setPlainDialogOpen] = useState(false);
  const [contentsOpen, setContentsOpen] = useState(false);
  const [chatPanelOpen, setChatPanelOpen] = useState(false);
  /**
   * The reader's own preface and afterword, which bracket the Contents: whether
   * each exists yet and when it was last written.
   */
  const [bookDocuments, setBookDocuments] = useState<BookDocumentState[] | null>(
    null
  );
  /** Which one the Contents just asked for. Cleared once the layer has it. */
  const [documentRequest, setDocumentRequest] = useState<BookScope | null>(null);
  // The same store the paging engine derives its geometry from, so the chat
  // panel's presentation and the book's layout can never disagree about how wide
  // the window is.
  const { width: viewportWidth, height: viewportHeight } = useSyncExternalStore(
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

  // The player bar takes a strip off the foot of the window while this book is
  // the one being spoken. Read here rather than from the follow hook below
  // because the page's geometry needs it before anything is laid out.
  const { bookId: playingBookId, status: listenStatus } = useAudiobook();
  const listenInset =
    playingBookId === bookId && listenStatus !== "idle" ? AUDIOBOOK_BAR_HEIGHT : 0;

  // The paged reading area, as state: it doesn't exist until the book's HTML has
  // loaded, and everything that measures it needs something to re-run on when it
  // appears. A ref measured once against nothing and never tried again.
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null);
  const flowRef = useRef<HTMLDivElement>(null);
  const parallelFlowRef = useRef<HTMLDivElement>(null);
  const scrollContentRef = useRef<HTMLDivElement>(null);

  const blocks = useMemo(
    () =>
      html == null
        ? []
        : time("blockMap", () => blockMap(html), () => `${Math.round(html.length / 1000)}k chars`),
    [html]
  );
  const totalChars = useMemo(() => totalCharsOf(blocks), [blocks]);
  /**
   * What the scrolling view renders: the book with its chat marks set into it.
   * Paged mode does the same thing one window at a time, inside usePagination.
   *
   * Articles are left alone. Their markup is arbitrary sanitized HTML, so the
   * block stream above isn't the character space the anchors are stored in and
   * there is nothing safe to splice against — they keep the margin icon instead.
   */
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

  /**
   * Plain English: which face is shown, what the translation holds, and what
   * the renderer should swap. Sits before the pagination hook because the paged
   * window is rendered from it; takes its position from the shared scroll state
   * that both modes report into, so the two hooks don't depend on each other.
   */
  const plain = usePlainEnglish({
    bookId,
    enabled: !isArticle && html != null,
    initialFace: isArticle ? "original" : readingFace,
    currentCharOffset: scrollPosition.charOffset,
    paged,
    listening: listenInset > 0,
  });
  const scrollHtml = useMemo(
    () =>
      html == null || isArticle
        ? html
        : plain.render
          ? plainDocumentHtml(html, blocks, inlineMarks, plain.render)
          : withInlineChats(html, blocks, inlineMarks, 0),
    [blocks, html, inlineMarks, isArticle, plain.render]
  );
  /**
   * The position already written down — the one the book opened at, and then
   * every one saved since.
   *
   * A save is only worth making if the book has moved off it, because a save is
   * also the app's record that this book was read just now, and that record is
   * what decides which book opening Reader takes you to. Closing a book you only
   * glanced at must not nominate it as the book you were reading.
   */
  const recordedRef = useRef(resumeCharOffset);
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
  /**
   * How far past a visited passage counts as having carried on reading.
   *
   * Roughly two screens. Far enough that a stray scroll doesn't end the visit,
   * close enough that following a link and simply reading on gives you your
   * position back without having to notice a pill and dismiss it.
   */
  const VISIT_RELEASE_CHARS = 4000;

  const [pendingJump, setPendingJump] = useState<{
    charOffset: number;
    /**
     * Whether arriving here counts as reading.
     *
     * True for the two moves the reader made themselves — a position restored
     * from this device, or one accepted from another. False for a jump they were
     * SENT: visiting somebody else's passage must not become the place this book
     * opens at, nor the reason it becomes the book /reader resumes into.
     */
    record: boolean;
  } | null>(null);

  /**
   * While set, the reader's position is not written down at all.
   *
   * Held at flush() rather than at report(): report also feeds scrollPosition,
   * which the progress bar, the running foot and the whole annotation layer are
   * built on, so holding there would freeze the page's idea of where it is.
   * And held at flush rather than at the server call, because flush is also the
   * record that this book was read just now — suppress only the network write
   * and the local one syncs later and clobbers the position anyway, hours after
   * the visit.
   */
  const positionHoldRef = useRef(false);
  const [returnTo, setReturnTo] = useState<number | null>(null);

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
      // The book now opens here instead, and this position is already written
      // down — it's still owed to the server, but replayPending carries that up
      // with its own timestamp rather than needing a save from this reader.
      recordedRef.current = stored.charOffset;
      setPendingJump({ charOffset: stored.charOffset, record: true });
    });
    return () => {
      cancelled = true;
    };
  }, [bookId, resumeSavedAt]);

  // Local first, server second. The device write is the one that must not fail:
  // reading three chapters offline and having the book reopen at the start is
  // the only offline failure that would actually be felt.
  const flush = useCallback(() => {
    if (positionHoldRef.current) return;
    const charOffset = positionRef.current;
    // Nothing has moved, so there's nothing to say — and saying it anyway would
    // record a book that was merely opened as the one most recently read.
    if (!readingHappened(charOffset, recordedRef.current)) return;
    recordedRef.current = charOffset;
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

  /**
   * Side by side: the book in the left column, its translation in the right.
   *
   * Only when the reader is in Plain English, in pages, on a screen where two
   * columns fit — the same arithmetic the paging engine uses, run here so the
   * decision is made before the engine is asked, not a render after it. When it
   * is on, the page itself shows the ORIGINAL (the plain text moves to the
   * pane), so every anchor and position on the page is original-face.
   */
  const twoColumnsFit =
    paged &&
    viewportWidth > 0 &&
    computeGeometry(viewportWidth, Math.max(200, viewportHeight - listenInset), settings, chatPanel)
      .cols === 2;
  const sideBySide =
    twoColumnsFit && plain.shownFace === "plain" && settings.sideBySide;

  const pagination = usePagination({
    enabled: paged && !sideBySide,
    html,
    flowRef,
    blocks,
    inlineMarks,
    settings,
    chatPanel,
    bottomInset: listenInset,
    charOffset: scrollPosition.charOffset,
    onPositionChange: report,
    plain: plain.render,
    faceTextOf: plain.faceTextOf,
  });
  // The parallel spread has its own paging: rows, not columns. Its left cells
  // are the original blocks, so anchors and position are original-face there.
  const parallel = useParallelPagination({
    enabled: sideBySide,
    html,
    flowRef: parallelFlowRef,
    blocks,
    inlineMarks,
    plain: plain.render,
    settings,
    chatPanel,
    bottomInset: listenInset,
    charOffset: scrollPosition.charOffset,
    onPositionChange: report,
  });
  const contentRef = paged ? (sideBySide ? parallelFlowRef : flowRef) : scrollContentRef;
  const pagedWindowBase = sideBySide ? parallel.windowBase : pagination.windowBase;
  const pagedLayoutNonce = sideBySide ? parallel.layoutNonce : pagination.layoutNonce;

  // Where you are and how much is left are a pure function of the character
  // offset, so they're derived rather than pushed through state — which is what
  // lets a book opened halfway through show the right chapter and percentage on
  // its very first frame, in either mode.
  const currentCharOffset = paged
    ? sideBySide
      ? parallel.charOffset
      : pagination.charOffset
    : scrollPosition.charOffset;
  const atEnd = paged ? (sideBySide ? parallel.atEnd : pagination.atEnd) : scrollPosition.atEnd;
  const charEnd = paged ? (sideBySide ? parallel.charEnd : pagination.charEnd) : undefined;
  const progress: ReadingProgress = useMemo(
    () => progressAt(currentCharOffset, totalChars, wordCount, chapters, atEnd, charEnd),
    [atEnd, chapters, charEnd, currentCharOffset, totalChars, wordCount]
  );

  /**
   * The places this reader has saved in this book.
   *
   * Fed the same character offset everything else here is: a bookmark is a spot
   * in the conversion char space, so it survives a font change, a switch between
   * pages and scrolling, and a swap into Plain English without knowing that any
   * of those exist. `charEnd` is what lets a page ask about its whole window
   * rather than just its first line — see the hook.
   */
  const {
    bookmarks,
    active: activeBookmark,
    draft: bookmarkDraft,
    removed: removedBookmark,
    toggle: toggleBookmark,
    rename: renameBookmark,
    remove: removeBookmark,
    save: saveBookmark,
    closeDraft: closeBookmarkDraft,
    undoRemove: undoRemoveBookmark,
    dismissUndo: dismissBookmarkUndo,
  } = useBookmarks({
    bookId,
    memberEmail,
    enabled: !isArticle && html != null,
    blocks,
    currentCharOffset,
    visibleThroughChar: charEnd ?? null,
  });

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
    // Keyed on the rendered markup, not the book: setting a chat mark into the
    // page moves every block after it, and the cached block tops this reads
    // positions off would otherwise stay a mark's height out of date.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollHtml, paged, settings]);

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
      // Nor a chat mark set into the text: tapping one opens its conversation,
      // and toggling the chrome on the way is noise.
      if (
        target?.closest(
          'a, button, [role="menuitem"], input, textarea, select, [data-reader-chat]'
        )
      ) {
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

  const goToPagedChar = sideBySide ? parallel.goToChar : pagination.goToChar;
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
    // A visit reports nothing. report() would schedule a flush, and a jump is
    // almost always further than the threshold that counts as reading.
    if (pendingJump.record) report(pendingJump.charOffset, false);
    if (paged || restoredRef.current) goToChar(pendingJump.charOffset);
  }, [goToChar, html, paged, pendingJump, report]);

  const goToChapter = useCallback(
    (anchorId: string) => {
      const chapter = chapters.find((c) => c.anchorId === anchorId);
      if (chapter) goToChar(chapter.charStart);
    },
    [chapters, goToChar]
  );

  /**
   * Going to a bookmark is going somewhere, not visiting it.
   *
   * Deliberately the same call a chapter row makes, with no return pill and no
   * held position: you saved the place in order to come back to it, so arriving
   * IS the point. Offering a way back from somewhere you asked to be is the app
   * second-guessing the tap.
   */
  const goToBookmark = useCallback(
    (id: string) => {
      const found = bookmarks.find((b) => b.id === id);
      if (found) goToChar(found.charOffset);
    },
    [bookmarks, goToChar]
  );

  const removeBookmarkById = useCallback(
    (id: string) => {
      const found = bookmarks.find((b) => b.id === id);
      if (found) removeBookmark(found);
    },
    [bookmarks, removeBookmark]
  );

  const renameBookmarkById = useCallback(
    (id: string) => {
      const found = bookmarks.find((b) => b.id === id);
      if (found) renameBookmark(found);
    },
    [bookmarks, renameBookmark]
  );

  /**
   * Bookmark from the keyboard.
   *
   * Same guards the paged reader uses for its own keys: no modifiers, and
   * nothing while a field, a menu or a dialog has the focus — otherwise typing
   * the letter b into the name field would save a second bookmark under the
   * first.
   */
  useEffect(() => {
    if (isArticle || html == null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key !== "b" && e.key !== "B") return;
      const active = document.activeElement as HTMLElement | null;
      if (
        active?.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]')
      ) {
        return;
      }
      e.preventDefault();
      toggleBookmark();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [html, isArticle, toggleBookmark]);

  // ---- Listening ----------------------------------------------------------

  /**
   * Reading and listening are the same position.
   *
   * The narration's timing map is expressed in the conversion character space —
   * the same space this reader already stores its position in — so the voice
   * can simply report where it is and the ordinary save path takes it from
   * there. There is no second position to keep in step, which is the failure
   * every app that models them separately eventually has.
   *
   * Articles don't listen: a page of prose off the web is short enough that
   * chaptering it means nothing, and listening is a books feature.
   */
  const layoutNonce = paged ? pagedLayoutNonce : scrollLayoutNonce;

  const { listen } = useAudiobookControls();
  const reportListening = useCallback(
    (charOffset: number) => report(charOffset, false),
    [report]
  );
  const follow = useAudiobookFollow({
    bookId,
    blocks,
    contentRef,
    base: paged ? pagedWindowBase : 0,
    layoutNonce: paged ? pagedLayoutNonce : scrollLayoutNonce,
    eink: settings.eink,
    currentCharOffset,
    pageCharEnd: charEnd ?? null,
    goToChar,
    onPosition: reportListening,
  });

  const startListening = useCallback(() => {
    listen({ bookId, title, author }, currentCharOffset);
  }, [author, bookId, currentCharOffset, listen, title]);

  // ---- Plain English -------------------------------------------------------

  /** What the menu item says: the state of the translation, in one line. */
  const plainLabel = (() => {
    if (plain.face !== "plain") return "Plain English";
    const { total, ready, failed, pending } = plain.counts;
    if (total === 0 || pending > 0) return `Plain English · ${ready} of ${total || "…"} chapters`;
    if (failed > 0) return `Plain English · ${failed} chapter${failed === 1 ? "" : "s"} failed`;
    return "Plain English ✓";
  })();

  const onPlainMenu = useCallback(() => {
    if (plain.face === "plain") return;
    // A translation the family already has (or has under way) needs no
    // confirmation: nothing is being paid for. Only a first run asks.
    if (plain.exists) void plain.enable().catch(() => {});
    else setPlainDialogOpen(true);
  }, [plain]);

  /**
   * Where the reader was when a chapter's plain text was swapped in under a
   * scrolling document, so the text can be put back under their eye once the
   * document has re-laid. Paged mode needs none of this: it re-resolves the
   * character it already has.
   */
  const plainRestoreRef = useRef<number | null>(null);
  useEffect(() => {
    if (paged || html == null) return;
    const target = plainRestoreRef.current;
    if (target == null) return;
    plainRestoreRef.current = null;
    const frame = requestAnimationFrame(() => {
      goToChar(target);
      measureScroll();
      onScroll();
      setScrollLayoutNonce((n) => n + 1);
    });
    return () => cancelAnimationFrame(frame);
    // Keyed on the rendered markup: that is what a swap changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollHtml]);

  // A chapter's translation marker is the book's own markup, so it is opened
  // from here. (Glossary terms are handled by TermPopoverController, which owns
  // its own state on purpose — see there for why that matters.)
  useEffect(() => {
    const container = contentRef.current;
    if (!container || isArticle) return;
    const onClick = (e: MouseEvent) => {
      const marker = (e.target as HTMLElement | null)?.closest<HTMLElement>(`[${PLAIN_MARK_ATTR}]`);
      if (!marker) return;
      const index = Number(marker.getAttribute(PLAIN_MARK_ATTR));
      const status = marker.getAttribute("data-reader-plain-status");
      if (status === "ready") {
        if (!paged) plainRestoreRef.current = positionRef.current;
        plain.applyChapter(index);
      } else if (status === "failed") {
        void plain.retryChapter(index);
      }
    };
    container.addEventListener("click", onClick);
    return () => container.removeEventListener("click", onClick);
  }, [contentRef, isArticle, paged, plain]);

  // Where the contents opens, and what it marks. Opening it on where you are —
  // rather than on the front matter — is the dialog's job now; this is the
  // reader's half of that, the only two facts it needs from the book.
  const currentChapterAnchor = progress.chapter?.anchorId ?? null;
  const currentChapterMinutesLeft = progress.chapter?.minutesLeft ?? null;

  // ---- Render -------------------------------------------------------------

  // Memoised: the chat gutter re-places whenever this changes, and a fresh
  // object every render would put it in a render loop.
  const { geometry: pagedGeometry, pages: pagedPages, pageIndex } = pagination;
  const pagedChat = useMemo(
    () =>
      paged && !sideBySide && pagedGeometry
        ? { geom: pagedGeometry, pages: pagedPages, pageIndex, viewport }
        : null,
    [paged, pagedGeometry, pagedPages, pageIndex, sideBySide, viewport]
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
  const headerVisible = paged || hoverTop || menuOpen || chromeTapped || scrollRevealed;

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

  /**
   * The bookmarks as the Contents needs them: named, placed, and in the book's
   * own terms.
   *
   * Resolved here rather than in the dialog because the chapter a character
   * offset falls in is something only the reader knows — it comes from the
   * book's text, which the dialog has never had to read. Percentages are
   * computed the same way the running head computes its own, so a bookmark's
   * "14%" and the header's "14%" can't disagree.
   */
  const contentsBookmarks: ContentsBookmark[] = useMemo(
    () =>
      bookmarks.map((b) => {
        const at = progressAt(b.charOffset, totalChars, wordCount, chapters, false);
        return {
          id: b.id,
          label: bookmarkLabel(b),
          excerpt: b.excerpt,
          chapterTitle: at.chapter?.title ?? null,
          place: bookmarkPlace(b, at.percent, hasRealPages),
          current: b.id === activeBookmark?.id,
        };
      }),
    [activeBookmark?.id, bookmarks, chapters, hasRealPages, totalChars, wordCount]
  );

  const answerElsewhere = useCallback(
    (go: boolean) => {
      if (elsewhere == null) return;
      answeredRef.current = elsewhere;
      if (go) setPendingJump({ charOffset: elsewhere, record: true });
      setElsewhere(null);
    },
    [elsewhere]
  );

  /**
   * Where the strip of transient pills starts, above the bottom edge.
   *
   * Clear of the running foot in paged mode, clear of the thumb in scrolling
   * mode (where the bottom edge is where the text keeps going), and clear of the
   * player bar whenever it's showing.
   */
  /**
   * Go to a passage somebody sent you, without letting it become your place.
   *
   * The hold goes on BEFORE the jump, and the place to come back to is captured
   * before anything moves. Both matter: the scroll handler fires within a frame
   * of the jump landing, and by then positionRef is already the shared passage.
   */
  const visitAnchor = useCallback((charOffset: number) => {
    positionHoldRef.current = true;
    setReturnTo(recordedRef.current);
    setPendingJump({ charOffset, record: false });
  }, []);

  /** Let go, and let where you are now be where you are. */
  const releaseHold = useCallback(() => {
    positionHoldRef.current = false;
    setReturnTo(null);
  }, []);

  const goBackFromVisit = useCallback(() => {
    if (returnTo == null) return;
    positionHoldRef.current = false;
    setPendingJump({ charOffset: returnTo, record: true });
    setReturnTo(null);
  }, [returnTo]);

  /**
   * Read on and the visit is over.
   *
   * Two page-turns' worth of characters from where you landed: far enough that
   * an accidental nudge doesn't end it, near enough that somebody who followed a
   * link and simply carried on reading gets their position back without having
   * to notice a pill.
   */
  useEffect(() => {
    if (returnTo == null) return;
    const landed = pendingJump?.charOffset ?? null;
    if (landed == null) return;
    const moved = Math.abs(scrollPosition.charOffset - landed);
    if (moved > VISIT_RELEASE_CHARS) releaseHold();
  }, [pendingJump, releaseHold, returnTo, scrollPosition.charOffset]);

  const returnLabel = useMemo(() => {
    if (returnTo == null) return null;
    // Named the way the other-device bar names a place, for the same reason: a
    // chapter is what a reader recognises, and a percentage is what is always
    // true. Pages are deliberately not used — most books here have synthetic
    // ones, and "p. 212" that means nothing is worse than a number that does.
    const p = progressAt(returnTo, totalChars, wordCount, chapters, false);
    return p.chapter?.title ?? `${p.percent}%`;
  }, [chapters, returnTo, totalChars, wordCount]);

  const showReturn = loaded && returnTo != null && returnLabel != null;
  // Suppressed while the return pill is up. They occupy the same coordinate and
  // both say "go somewhere else" — and worse, the elsewhere check compares
  // against positionRef, which during a visit is the passage you were sent to
  // rather than anywhere you chose.
  const showElsewhere = loaded && elsewhereProgress != null && !showReturn;
  const floatingBottom = listenInset + (paged ? PAGE_PAD_BOTTOM + 8 : 24);

  // Loaded once, and again whenever the document page writes or deletes
  // something — the Contents dates what it offers, so a stale answer there
  // would be a lie about the reader's own writing. Articles have no Contents to
  // reach these from and are refused server-side regardless.
  const refreshBookDocuments = useCallback(() => {
    if (isArticle) return;
    void getBookDocumentStates(bookId, memberEmail)
      .then(setBookDocuments)
      .catch(() => {});
  }, [bookId, isArticle, memberEmail]);
  useEffect(() => {
    refreshBookDocuments();
  }, [refreshBookDocuments]);

  // Stable, so the layer's request effect isn't re-run every render.
  const clearDocumentRequest = useCallback(() => setDocumentRequest(null), []);

  // Books and articles both: the layer switches coordinate spaces on isArticle
  // rather than opting out. Articles never reach the paged branch, so the paged
  // context it gets there is always null.
  const annotationLayer = loaded && (
    <ReaderAnnotationLayer
      bookId={bookId}
      memberEmail={memberEmail}
      blocks={blocks}
      chapters={chapters}
      isArticle={isArticle}
      contentRef={contentRef}
      currentCharOffset={currentCharOffset}
      visibleThroughChar={charEnd ?? null}
      onInlineMarksChange={setInlineMarks}
      requestedDocument={documentRequest}
      onDocumentRequestHandled={clearDocumentRequest}
      onDocumentChanged={refreshBookDocuments}
      goToChar={goToChar}
      paged={pagedChat}
      panelOpen={chatPanelOpen}
      onPanelOpenChange={handleChatPanelOpenChange}
      openListOnMount={openNotes}
      preferSheet={chatAsSheet}
      docked={!chatCanFloat || settings.chatDocked}
      canFloat={chatCanFloat}
      windowBase={paged ? pagedWindowBase : 0}
      layoutNonce={layoutNonce}
      hideGutter={sideBySide}
      mentionTargets={mentionTargets}
      openMarkId={openMarkId}
      onVisitAnchor={visitAnchor}
      shownFace={plain.shownFace}
      faceTextOf={plain.faceTextOf}
      plainBlocks={plain.blocksByIndex}
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
              against the window edge, opposite the two chat controls that float
              there already (annotations-button.tsx). Margins are where a book
              puts its furniture.

              An arrow rather than a panel glyph: it goes back to the shelf, and
              nothing here opens a panel on the left. */}
          <Link
            href={backHref}
            aria-label="Back to my books"
            className="absolute top-1/2 left-2 z-10 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:left-3"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>

          {/* Where you are, on the other hand, is the running head of this page:
              the book, then the chapter inside it, centred over the text block
              and never wider than it. The padding is what keeps a long title
              from sliding under the margin controls on a narrow window.

              Two controls here, and they answer the book's two questions. The
              name holds what you DO to it — how it's laid out, whether it's read
              aloud. The contents beside it holds where you are in it, which
              outgrew a dropdown and has its own dialog now (contents-dialog).
              Both belong to the book, so both sit with its name rather than out
              in the margin, which is where the reading's own furniture lives. */}
          <div
            className="absolute inset-y-0 flex items-center justify-center gap-0.5 px-12"
            style={chromeBounds}
          >
            <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
              <DropdownMenuTrigger
                aria-label="This book"
                className="inline-flex min-w-0 items-center rounded-md px-2 py-1 transition-colors hover:bg-muted"
              >
                <div className="min-w-0 text-center">
                  <p
                    className={cn(
                      "reader-chrome-secondary flex items-center justify-center gap-1.5 truncate text-sm font-medium",
                      paged ? "text-muted-foreground/80" : "text-foreground"
                    )}
                  >
                    {/* The one visible sign that the page is the translation
                        rather than the author's words. The text itself is set
                        the same either way — a book in a sans face read as an
                        app, not a book — so this carries the whole distinction,
                        alongside the menu's check and the toolbar's label. */}
                    {plain.shownFace === "plain" && (
                      <span title="Showing in plain English" className="flex shrink-0">
                        <Languages
                          aria-label="Showing in plain English"
                          className="h-3.5 w-3.5 opacity-70"
                        />
                      </span>
                    )}
                    <span className="truncate">{title}</span>
                    {/* Scrolling has nowhere else to put this; a page has a footer. */}
                    {!paged && loaded && (
                      <span className="ml-1.5 text-xs font-normal tabular-nums text-muted-foreground">
                        ({progress.percent}%{bookTimeLeft ? ` · ${bookTimeLeft}` : ""})
                      </span>
                    )}
                  </p>
                  {/* The chapter reads as plain text — information, not a
                      target. Getting to a chapter is the contents' job, and it
                      has its own control in the margin. Paged mode names the
                      chapter in the footer and doesn't repeat it here. */}
                  {!paged && (
                    <p className="truncate text-xs text-muted-foreground">
                      {progress.chapter?.title ?? author}
                      {progress.chapter?.title && chapterTimeLeft && (
                        <span className="tabular-nums opacity-70">
                          {" · "}
                          {chapterTimeLeft}
                        </span>
                      )}
                    </p>
                  )}
                </div>
              </DropdownMenuTrigger>
              {/* Actions only. The chapter list moved out to its own dialog
                  (contents-dialog.tsx), which took the scrolling with it — so
                  this no longer needs the pinned header that kept Layout above
                  forty chapters. */}
              <DropdownMenuContent align="center" className="w-56">
                <DropdownMenuItem onClick={() => setLayoutOpen(true)}>
                  <Settings2 className="h-4 w-4" />
                  Layout
                </DropdownMenuItem>
                {/* Books only, and only when the voice isn't already on this
                    book — the player bar is right there when it is. Starting
                    from the character you're on is what makes read-then-listen
                    a continuation rather than a handover: it picks up on the
                    line you were reading. */}
                {canListen && !isArticle && loaded && !follow.listening && (
                  <DropdownMenuItem onClick={startListening}>
                    <Headphones className="h-4 w-4" />
                    Listen
                  </DropdownMenuItem>
                )}
                {/* Books only, anyone's account: a comprehension feature, not a
                    listening one. Reads as the state of the translation once
                    it's on; a second item turns it off, so the label can carry
                    progress without also being a toggle. */}
                {!isArticle && loaded && (
                  <DropdownMenuItem onClick={onPlainMenu} disabled={plain.loading}>
                    <Languages className="h-4 w-4" />
                    {plainLabel}
                  </DropdownMenuItem>
                )}
                {/* The translation beside the page rather than in its place.
                    Offered only where it can happen: pages, two columns' worth
                    of screen, and Plain English on. */}
                {!isArticle && loaded && plain.face === "plain" && twoColumnsFit && (
                  <DropdownMenuItem
                    onClick={() => updateSetting("sideBySide", !settings.sideBySide)}
                  >
                    <span className="ml-6">
                      Side by side{settings.sideBySide ? " ✓" : ""}
                    </span>
                  </DropdownMenuItem>
                )}
                {!isArticle && loaded && plain.face === "plain" && (
                  <DropdownMenuItem onClick={() => void plain.disable()}>
                    <span className="ml-6">Turn off Plain English</span>
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* A sibling of the title's menu rather than something inside it: a
                button cannot be nested in a button, and the two open different
                things anyway. Articles have no chapters to list. A book whose
                conversion found no headings has nothing of the AUTHOR's to
                show — but it can still hold the reader's own bookmarks, and a
                bookmark you can save and never reach would be a trap. */}
            {!isArticle && (toc.length > 0 || bookmarks.length > 0) && (
              <button
                type="button"
                onClick={() => setContentsOpen(true)}
                aria-label="Contents"
                title="Contents"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-muted hover:text-foreground"
              >
                <List className="h-4 w-4" />
              </button>
            )}

            {/* Saving the place, beside the way back to it.

                Solid when a bookmark is on the screen you're looking at, hollow
                otherwise — which also says what the tap will do, because tapping
                a solid one removes it. A ribbon rather than a star: the star is
                spoken for by marks, and one glyph meaning two different kinds of
                "kept this" would undo the distinction the feature is built on. */}
            {!isArticle && loaded && (
              <button
                type="button"
                onClick={toggleBookmark}
                aria-label={activeBookmark ? "Remove bookmark" : "Add a bookmark"}
                aria-pressed={activeBookmark != null}
                title={activeBookmark ? "Remove bookmark (B)" : "Bookmark this page (B)"}
                className={cn(
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-muted hover:text-foreground",
                  activeBookmark ? "text-foreground" : "text-muted-foreground/70"
                )}
              >
                <Bookmark className={cn("h-4 w-4", activeBookmark && "fill-current")} />
              </button>
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
      ) : paged && sideBySide ? (
        <>
          <ParallelView
            html={parallel.html ?? ""}
            viewport={viewport}
            onViewportRef={setViewport}
            flowRef={parallelFlowRef}
            geometry={parallel.geometry}
            pageHeight={parallel.pageHeight}
            settings={settings}
            isFirstPage={parallel.atStart}
            isLastPage={parallel.atEnd}
            onNext={parallel.next}
            onPrev={parallel.prev}
            onFirst={goToFirstPage}
            onLast={goToLastPage}
          >
            {annotationLayer}
          </ParallelView>
          <ReaderFooter
            chapterTitle={progress.chapter?.title ?? null}
            chapterMinutesLeft={progress.chapter?.minutesLeft ?? null}
            percent={progress.percent}
            minutesLeft={progress.minutesLeft}
            height={PAGE_PAD_BOTTOM}
            bottom={listenInset}
            left={parallel.geometry?.offsetX ?? null}
            width={parallel.geometry?.width ?? null}
          />
        </>
      ) : paged ? (
        <>
          <PagedView
            // The window, not the whole book — see usePagination.
            html={pagination.html ?? ""}
            viewport={viewport}
            onViewportRef={setViewport}
            flowRef={flowRef}
            geometry={pagination.geometry}
            pages={pagination.pages}
            pageIndex={pageIndex}
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
            bottom={listenInset}
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
              dangerouslySetInnerHTML={{ __html: scrollHtml ?? "" }}
            />
            {/* Books and articles both. Articles keep images/links/lists, so
                they have no conversion char space and no page map — the layer
                switches coordinate spaces on isArticle rather than opting out. */}
            {annotationLayer}
          </div>
        </article>
      )}

      {/* Two offers can be outstanding at once — another device left off
          somewhere, and the voice has walked away from the page you're on — so
          they stack rather than overlap, and both clear the player bar when
          it's there. Neither ever moves the page by itself: a page that
          rearranges itself mid-sentence is worse than a page showing the wrong
          place, whichever of the two put it there. */}
      {showReturn && (
        <ReaderReturnPill
          label={returnLabel}
          bottom={floatingBottom}
          onBack={goBackFromVisit}
          onDismiss={releaseHold}
        />
      )}

      {showElsewhere && (
        <ReaderElsewhereBar
          chapterTitle={elsewhereProgress.chapter?.title ?? null}
          percent={elsewhereProgress.percent}
          bottom={floatingBottom}
          onGo={() => answerElsewhere(true)}
          onDismiss={() => answerElsewhere(false)}
        />
      )}

      {/* Both ways back, because a page and a voice that have come apart can be
          put together at either end and only you know which one you meant.
          "Read from here" moves the narration to the page you turned to; "Back
          to the voice" moves you to the narration. Nothing decides for you —
          see use-audiobook-follow.ts for why not. */}
      {follow.listening && !follow.following && (
        <div
          className="pointer-events-none fixed inset-x-0 z-40 flex justify-center px-4"
          style={{ bottom: floatingBottom + (showElsewhere ? FLOATING_PILL_STACK : 0) }}
        >
          <div className="pointer-events-auto flex items-stretch overflow-hidden rounded-full border border-border bg-popover/95 text-sm font-medium shadow-lg backdrop-blur">
            <button
              type="button"
              onClick={follow.bringVoiceHere}
              className="px-4 py-1.5 transition-colors hover:bg-muted"
            >
              Read from here
            </button>
            <span aria-hidden className="w-px shrink-0 bg-border" />
            <button
              type="button"
              onClick={follow.resume}
              className="px-4 py-1.5 transition-colors hover:bg-muted"
            >
              Back to the voice
            </button>
          </div>
        </div>
      )}

      {/* Above whatever else is down there, because it is the newest thing said
          and the only one with a deadline on it. */}
      {removedBookmark && (
        <BookmarkRemovedPill
          bottom={
            floatingBottom +
            ((showReturn || showElsewhere ? 1 : 0) +
              (follow.listening && !follow.following ? 1 : 0)) *
              FLOATING_PILL_STACK
          }
          onUndo={undoRemoveBookmark}
          onDismiss={dismissBookmarkUndo}
        />
      )}

      {/* Keyed on what it is naming, so the field is empty for a new bookmark
          and holds the existing name for a rename — rather than keeping
          whatever was typed into it last time. */}
      {bookmarkDraft && (
        <BookmarkDialog
          key={
            bookmarkDraft.mode === "rename"
              ? bookmarkDraft.bookmark.id
              : `new-${bookmarkDraft.charOffset}`
          }
          draft={bookmarkDraft}
          onSave={saveBookmark}
          onCancel={closeBookmarkDraft}
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

      <PlainEnglishDialog
        open={plainDialogOpen}
        onOpenChange={setPlainDialogOpen}
        charCount={charCount}
        fiction={fiction}
        onConfirm={plain.enable}
      />

      <TermPopoverController
        contentRef={contentRef}
        terms={plain.plan?.terms ?? NO_TERMS}
        enabled={!isArticle && plain.shownFace === "plain"}
        layoutNonce={layoutNonce}
        positionKey={currentCharOffset}
      />

      <ContentsDialog
        open={contentsOpen}
        onOpenChange={setContentsOpen}
        toc={toc}
        bookTitle={title}
        wordCount={wordCount}
        currentAnchorId={currentChapterAnchor}
        currentMinutesLeft={currentChapterMinutesLeft}
        onGoToChapter={goToChapter}
        // Articles have no Contents of their own and no page map to cite
        // against, so they get neither document — see openBookDocument, which
        // refuses one regardless.
        documents={isArticle ? null : bookDocuments}
        onOpenDocument={setDocumentRequest}
        bookmarks={contentsBookmarks}
        onGoToBookmark={goToBookmark}
        onRenameBookmark={renameBookmarkById}
        onDeleteBookmark={removeBookmarkById}
      />
    </div>
  );
}
