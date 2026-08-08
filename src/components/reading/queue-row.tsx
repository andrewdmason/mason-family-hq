"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import {
  AlertCircle,
  GripVertical,
  Loader2,
  Newspaper,
  Upload,
} from "lucide-react";
import {
  ArticleActionsMenu,
  ArticleContextMenu,
  useArticleMenu,
} from "@/components/reading/article-actions-menu";
import {
  BookActionsMenu,
  BookContextMenu,
  useBookMenu,
} from "@/components/reading/book-actions-menu";
import { BookCover } from "@/components/reading/book-cover";
import { readerProgressPercent } from "@/components/reading/reader-book-tile";
import { useIsDownloaded } from "@/lib/reading/offline/use-is-downloaded";
import { bookNotesHref, bookReaderHref } from "@/lib/reading/links";
import { useBookFileActions } from "@/lib/reading/use-book-file-actions";
import { updateBook } from "@/app/(reading)/reader/actions";
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

/** "N min read" from the stored word count (≈200 wpm). */
function readingTime(wordCount: number | null): string | null {
  if (!wordCount || wordCount <= 0) return null;
  return `${Math.max(1, Math.round(wordCount / 200))} min read`;
}

/** The trade paperback rule of thumb, for books with no page count of their own. */
const WORDS_PER_PAGE = 275;

/**
 * How long a book is — the question the queue keeps asking and couldn't answer.
 * Deciding between Dominion and Giovanni's Room is partly deciding between 624
 * pages and 224, and that was nowhere on the row.
 *
 * Open Library's count where there is one; otherwise the converted file's word
 * count, divided down. Pages either way rather than one row in pages and the next
 * in hours — a length you can't compare against the row above it isn't much use,
 * and a page count is already edition-dependent enough that the extra precision
 * of a derived estimate would be false comfort.
 */
function bookLength(book: ReadingBookWithProgress): string | null {
  const words = book.content?.word_count ?? null;
  const pages =
    book.total_pages ??
    (words && words > 0 ? Math.round(words / WORDS_PER_PAGE) : null);
  if (!pages || pages <= 0) return null;
  return `${pages.toLocaleString()} pages`;
}

function savedLabel(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

/** Quiet on a pointer until you reach for the row; always there on touch. */
const MENU_TRIGGER =
  "mt-4 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 sm:opacity-0 sm:group-hover:opacity-100";

/** What dnd-kit needs wired onto the grab handle, handed down by the list. Two
 * flat props rather than one object: the activator is a callback ref, and lint
 * reads member access on a bundle that feeds `ref=` as touching a ref mid-render. */
export type DragHandleProps = {
  handleRef?: (node: HTMLElement | null) => void;
  handleProps?: Record<string, unknown>;
};

/**
 * One book (or saved article) in the Queue, as a row rather than a cover tile.
 *
 * The Queue is a decision surface — you come here to answer "what next?" — and a
 * grid of covers gives you nothing to decide with. So the row leads with why the
 * book is here: the recommender's rationale, the family member's note, or a line
 * you wrote yourself. Everything the tile carried is still here, demoted to a
 * quiet meta line, because file state matters much less than the argument for
 * reading the thing.
 */
export function QueueRow({
  book,
  memberEmail = null,
  handleRef,
  handleProps,
  dragging = false,
}: DragHandleProps & {
  book: ReadingBookWithProgress;
  memberEmail?: string | null;
  dragging?: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const file = useBookFileActions(book, memberEmail);
  const {
    inputRef,
    openFilePicker,
    handleFile,
    retryConvert,
    busy,
    uploadError,
    retrying,
    hasFile,
    isReady,
    isProcessing,
    isFailed,
  } = file;

  const isArticle = book.type === "article";
  // Both built every render — hooks can't be conditional — but only the one that
  // matches gets shown. An article has no file to replace and no edition to buy.
  const bookMenu = useBookMenu({ book, memberEmail, file, onError: setError });
  const articleMenu = useArticleMenu({
    article: book,
    memberEmail,
    onError: setError,
  });
  const percent = readerProgressPercent(book);
  const downloaded = useIsDownloaded(book.id);
  const showNotes =
    book.annotationCount > 0 && isReady && !busy && !isProcessing && !isFailed;

  // An article is stored ready to read; a book needs its file first.
  const canOpen = isArticle || isReady;
  const host = hostLabel(book.source_url);
  const site = book.site_name || host;

  // An article has no cover art, so its source stands in for one: a favicon in a
  // cover-shaped box. Enough to tell you at a glance that this row is 54 minutes
  // rather than three weeks, which is the whole reason it's in the list.
  const favicon = host
    ? `https://www.google.com/s2/favicons?domain=${host}&sz=64`
    : null;

  // What's left worth saying about the file — and often nothing at all. "No file
  // yet" and "Not started" were the resting state of most of the queue: a line on
  // every row saying nothing, sitting under a reason that says everything. The
  // cover's badge already reports a missing file, so this is only the states you'd
  // act on, plus what you've marked up and whether it's on the plane with you.
  const meta: React.ReactNode[] = [];
  if (isArticle) {
    meta.push(readingTime(book.word_count) ?? "Article");
    meta.push(`Saved ${savedLabel(book.created_at)}`);
  } else {
    // Length leads: it's the first thing you weigh when the reasons are all
    // good and you can only start one of them.
    const length = bookLength(book);
    if (length) meta.push(length);
    if (busy || isProcessing) {
      meta.push("Preparing…");
    } else if (isFailed) {
      meta.push("Couldn't prepare");
    } else if (percent != null) {
      meta.push(`${percent}%`);
    }
  }
  if (showNotes) {
    meta.push(
      <Link
        href={bookNotesHref(book.id)}
        className="underline-offset-2 hover:text-foreground hover:underline"
      >
        {book.annotationCount} {book.annotationCount === 1 ? "note" : "notes"}
      </Link>
    );
  }
  if (downloaded && !isFailed && !isProcessing) {
    meta.push(<span className="text-muted-foreground/60">Offline</span>);
  }

  const cover = (
    <span className="relative block shrink-0">
      {isArticle ? (
        <span className="flex h-16 w-11 shrink-0 items-center justify-center overflow-hidden rounded bg-muted">
          {favicon ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={favicon} alt="" width={20} height={20} className="size-5 rounded-sm" />
          ) : (
            <Newspaper className="h-4 w-4 text-muted-foreground" aria-hidden />
          )}
        </span>
      ) : (
        <BookCover url={book.cover_image_url} title={book.title} size="sm" />
      )}
      {/* Kindle-style progress along the foot of the cover, same as the grid. */}
      {percent != null && percent > 0 && (
        <span className="absolute inset-x-0 bottom-0 block h-0.5 bg-black/40">
          <span
            className="block h-full bg-white/95"
            style={{ width: `${percent}%` }}
          />
        </span>
      )}
      {/* The file's state, as a badge sitting *inside* the cover the way the grid
          tile does it. Hung off the corner it was half-eaten by the cover's own
          rounded clip — and now that the row no longer spells out "No file yet",
          this badge is the only thing saying so. */}
      {!isArticle &&
        (isProcessing || busy ? (
          <span className="absolute bottom-1 left-1 inline-flex items-center justify-center rounded-full bg-foreground/85 p-1 text-background shadow-sm backdrop-blur">
            <Loader2 className="h-2.5 w-2.5 animate-spin" />
          </span>
        ) : isFailed ? (
          <span className="absolute bottom-1 left-1 inline-flex items-center justify-center rounded-full bg-destructive/90 p-1 text-white shadow-sm backdrop-blur">
            <AlertCircle className="h-2.5 w-2.5" />
          </span>
        ) : !hasFile ? (
          <span className="absolute bottom-1 left-1 inline-flex items-center justify-center rounded-full bg-background/85 p-1 text-muted-foreground shadow-sm backdrop-blur">
            <Upload className="h-2.5 w-2.5" />
          </span>
        ) : null)}
    </span>
  );

  const rowClass = cn(
    "group relative flex items-start gap-3 rounded-lg border border-transparent px-2 py-3 transition-colors hover:border-border hover:bg-accent/30",
    dragging && "border-border bg-card shadow-lg"
  );

  const row = (
    <>
      {/* A handle rather than a grabbable row: the row holds a link, an
          expandable block and an editable field, all of which would fight a
          whole-row drag. Quiet on a pointer, always there on touch. */}
      {handleRef && (
        <button
          ref={handleRef}
          {...handleProps}
          type="button"
          aria-label={`Reorder ${book.title}`}
          className="-ml-1 mt-5 shrink-0 cursor-grab touch-none rounded p-0.5 text-muted-foreground/50 transition-opacity hover:text-foreground focus-visible:opacity-100 active:cursor-grabbing sm:opacity-0 sm:group-hover:opacity-100"
        >
          <GripVertical className="h-4 w-4" />
        </button>
      )}

      {/* The cover still opens the book. Without a file there's nothing to open,
          so it asks for one instead — the only thing standing between you and
          reading it. */}
      {canOpen ? (
        <Link
          href={bookReaderHref(book.id, memberEmail)}
          aria-label={`${book.hasResumePoint ? "Continue" : "Read"} ${book.title}`}
          className="shrink-0 overflow-hidden rounded shadow-sm ring-1 ring-foreground/10"
        >
          {cover}
        </Link>
      ) : (
        <button
          type="button"
          onClick={isFailed ? retryConvert : openFilePicker}
          disabled={busy || isProcessing || retrying}
          aria-label={
            isFailed
              ? `Try preparing ${book.title} again`
              : isProcessing
                ? `${book.title} is still being prepared`
                : `Add a file for ${book.title}`
          }
          className="shrink-0 overflow-hidden rounded shadow-sm ring-1 ring-foreground/10 disabled:cursor-default"
        >
          {cover}
        </button>
      )}

      <div className="min-w-0 flex-1">
        {/* The title opens it too — an article has no cover art to aim at, and
            on a phone a 44px thumbnail is a mean target either way. */}
        {canOpen ? (
          <Link
            href={bookReaderHref(book.id, memberEmail)}
            className="font-serif text-sm leading-snug text-foreground hover:underline"
          >
            {book.title}
          </Link>
        ) : (
          <p className="font-serif text-sm leading-snug text-foreground">
            {book.title}
          </p>
        )}
        {(book.author || site) && (
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {book.author || site}
          </p>
        )}

        <QueueReason
          book={book}
          memberEmail={memberEmail}
          assessing={!isArticle && bookMenu.assessing}
          onError={setError}
        />

        {/* Whatever's left worth saying about the file, and only when there is
            something. "No file yet" and "Not started" were the default state of
            most of the queue — a line on every row telling you nothing, under a
            reason that's telling you everything. The cover's badge already says a
            file is missing; this is for the states you'd actually act on. */}
        {meta.length > 0 && (
          <p
            className={cn(
              "mt-1.5 text-[11px] tabular-nums text-muted-foreground",
              isFailed && "text-destructive"
            )}
          >
            {meta.map((part, i) => (
              <span key={i}>
                {i > 0 && " · "}
                {part}
              </span>
            ))}
          </p>
        )}

        {(error || uploadError) && (
          <p className="mt-1 text-[11px] text-destructive">
            {error ?? uploadError}
          </p>
        )}
      </div>

      {isArticle ? (
        <ArticleActionsMenu menu={articleMenu} className={MENU_TRIGGER} />
      ) : (
        <>
          <BookActionsMenu menu={bookMenu} className={MENU_TRIGGER} />
          <input
            ref={inputRef}
            type="file"
            accept=".pdf,.epub,application/pdf,application/epub+zip"
            className="hidden"
            onChange={(e) => {
              void handleFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          {bookMenu.dialog}
        </>
      )}
    </>
  );

  // Right-click hits the whole row, not just the "…" at its end.
  return isArticle ? (
    <ArticleContextMenu menu={articleMenu} className={rowClass}>
      {row}
    </ArticleContextMenu>
  ) : (
    <BookContextMenu menu={bookMenu} className={rowClass}>
      {row}
    </BookContextMenu>
  );
}

/**
 * Why this book is in your queue — shown in full, and always yours to change.
 *
 * Whether the line came from the recommender, from a family member, or from you
 * is not worth a label above it: the text itself nearly always says. What matters
 * is that you can reach in and correct it — note that it was Dad who pressed the
 * book on you, cut a rationale down to the sentence that actually landed, or write
 * the reason that until now only existed in your head and evaporated the moment
 * you closed the Add-a-book dialog.
 *
 * Never truncated. A queue of fifteen books is short enough to read, and the
 * argument for a book is the one thing on the row you came here for.
 *
 * It's also where "Will I like this?" lands: the menu overwrites this line with
 * the AI's verdict, so a fresh read arrives in the place you were already
 * reading, rather than in a panel beside it.
 */
function QueueReason({
  book,
  memberEmail,
  assessing = false,
  onError,
}: {
  book: ReadingBookWithProgress;
  memberEmail: string | null;
  /** The menu's taste check is running, and its answer will replace this line. */
  assessing?: boolean;
  onError: (message: string | null) => void;
}) {
  const [note, setNote] = useState(book.recommendation_note ?? "");
  const [editing, setEditing] = useState(false);
  const [saving, startSave] = useTransition();

  // The server is the source of truth once a refresh brings something new back —
  // adopt it, unless the field is currently being typed into. Adjusted during
  // render rather than in an effect: this is state derived from a prop, and an
  // effect would render the stale note first and then immediately re-render.
  const [serverNote, setServerNote] = useState(book.recommendation_note);
  if (!editing && book.recommendation_note !== serverNote) {
    setServerNote(book.recommendation_note);
    setNote(book.recommendation_note ?? "");
  }

  function save() {
    setEditing(false);
    const next = note.trim();
    if (next === (book.recommendation_note ?? "")) return;
    onError(null);
    startSave(async () => {
      try {
        await updateBook(book.id, { recommendationNote: next, memberEmail });
      } catch (err) {
        setNote(book.recommendation_note ?? "");
        onError(err instanceof Error ? err.message : "Couldn't save that note.");
      }
    });
  }

  // The taste check is about to replace this line, so say so where the answer
  // will appear — not in a spinner at the far end of the row.
  if (assessing && !editing) {
    return (
      <p className="mt-1 flex items-center gap-1.5 px-1 py-0.5 text-xs leading-relaxed text-muted-foreground">
        <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
        Sizing up whether you&apos;ll like this…
      </p>
    );
  }

  if (editing) {
    return (
      <textarea
        autoFocus
        value={note}
        onChange={(e) => setNote(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setNote(book.recommendation_note ?? "");
            setEditing(false);
          }
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) save();
        }}
        rows={2}
        placeholder="Why this book?"
        // Grows with the text: the field you're editing in should hold as much as
        // the paragraph it replaced, or editing a long rationale means scrolling a
        // three-line box.
        className="mt-1 w-full resize-none rounded-md border border-border bg-background px-2 py-1.5 text-xs leading-relaxed text-foreground outline-none [field-sizing:content] focus:border-foreground/30"
      />
    );
  }

  // The reason at rest. Hovering lifts a faint panel behind it — the hint that
  // this paragraph is a field, not a caption — and clicking puts the cursor in it.
  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      aria-label={note ? `Edit why ${book.title} is in your queue` : undefined}
      className={cn(
        "-mx-1 mt-1 block w-full rounded-md px-1 py-0.5 text-left text-xs leading-relaxed transition-colors hover:bg-accent/60",
        note
          ? "text-muted-foreground hover:text-foreground"
          : // Nothing to say yet: present but almost silent, so a queue you never
            // annotate doesn't look like a form you failed to fill in. It fades in
            // on hover — but only where hovering exists, or on a phone it would be
            // an invisible full-width tap target sitting in the middle of the row.
            "text-muted-foreground/40 hover:text-muted-foreground focus-visible:opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
      )}
    >
      {note || "Why this book?"}
      {saving && <span className="ml-1 text-muted-foreground/60">Saving…</span>}
    </button>
  );
}
