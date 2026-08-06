"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, PenLine } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  buildContents,
  pathToAnchor,
  type ContentsNode,
} from "@/lib/reading/contents-tree";
import { formatDuration, formatTimeLeft } from "@/lib/reading/reading-time";
import {
  BOOK_DOCUMENT_BLURB,
  BOOK_DOCUMENT_LABEL,
  type BookScope,
} from "@/lib/reading/book-documents";
import type { BookDocumentState } from "@/lib/reading/annotation-types";
import { cn } from "@/lib/utils";
import type { ReadingTocEntry } from "@/lib/types";

/**
 * The book's contents, as a place rather than a menu.
 *
 * This used to be a list hanging off the book's title, which could only ever be
 * a column of titles at one indent — so a book's chapters, the sections inside
 * them, its copyright page and the twenty-six letters of its index all arrived
 * looking equally important. A dialog has room to show what the book actually
 * says about its own shape: nesting, and how long each part takes.
 *
 * What's shown is decided in contents-tree.ts, which is pure and verified
 * separately. Everything here is presentation.
 *
 * The reader's own two documents bracket all of it — a preface above the book's
 * contents, an afterword below them — and they sit OUTSIDE the tree on purpose.
 * Plenty of books ship with a preface or an afterword of their own; those stay
 * where the author put them, in the tree, and yours are the ones with your name
 * on them at either end of it.
 */
export function ContentsDialog({
  open,
  onOpenChange,
  toc,
  bookTitle,
  wordCount,
  currentAnchorId,
  currentMinutesLeft,
  onGoToChapter,
  documents,
  onOpenDocument,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  toc: ReadingTocEntry[];
  /** Skipped when an entry merely repeats it. */
  bookTitle: string;
  /** Total body words, for the last entry's length. */
  wordCount: number | null;
  /** The chapter the reader is in, marked and expanded on open. */
  currentAnchorId: string | null;
  /** Minutes left in that chapter, so its row reads "left" rather than a length. */
  currentMinutesLeft: number | null;
  onGoToChapter: (anchorId: string) => void;
  /**
   * The reader's preface and afterword. Null until the annotations have loaded,
   * which is when the two rows appear — showing them before we know whether
   * they've been written would mean two rows that silently change their
   * subtitle a moment later.
   */
  documents: BookDocumentState[] | null;
  onOpenDocument: (scope: BookScope) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[80vh] flex-col gap-3 sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Contents</DialogTitle>
          <DialogDescription className="sr-only">
            Jump to a chapter of {bookTitle}.
          </DialogDescription>
        </DialogHeader>
        {/* Mounted per opening, which is what lets "expand the chapter I'm in"
            be the body's INITIAL state rather than an effect that corrects it a
            render later. It also means a group you opened once to reach the
            bibliography doesn't stay open for the rest of the book. */}
        {open && (
          <ContentsBody
            toc={toc}
            bookTitle={bookTitle}
            wordCount={wordCount}
            currentAnchorId={currentAnchorId}
            currentMinutesLeft={currentMinutesLeft}
            onGoToChapter={(anchorId) => {
              onGoToChapter(anchorId);
              onOpenChange(false);
            }}
            documents={documents}
            onOpenDocument={(scope) => {
              onOpenDocument(scope);
              onOpenChange(false);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ContentsBody({
  toc,
  bookTitle,
  wordCount,
  currentAnchorId,
  currentMinutesLeft,
  onGoToChapter,
  documents,
  onOpenDocument,
}: {
  toc: ReadingTocEntry[];
  bookTitle: string;
  wordCount: number | null;
  currentAnchorId: string | null;
  currentMinutesLeft: number | null;
  onGoToChapter: (anchorId: string) => void;
  documents: BookDocumentState[] | null;
  onOpenDocument: (scope: BookScope) => void;
}) {
  const contents = useMemo(
    () => buildContents(toc, bookTitle, wordCount),
    [bookTitle, toc, wordCount]
  );

  const where = useMemo(() => {
    const front = pathToAnchor(contents.front, currentAnchorId ?? "");
    const body = pathToAnchor(contents.body, currentAnchorId ?? "");
    const back = pathToAnchor(contents.back, currentAnchorId ?? "");
    return { front, body, back };
  }, [contents, currentAnchorId]);

  // Every ancestor ABOVE the reader's chapter, expanded. Not the chapter itself:
  // opening its subsections is a different question from showing where you are.
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set([...where.front, ...where.body, ...where.back].slice(0, -1))
  );
  const [groupsOpen, setGroupsOpen] = useState<{ front: boolean; back: boolean }>(
    () => ({ front: where.front.length > 0, back: where.back.length > 0 })
  );

  // Bring the current chapter into view once the dialog has been laid out. Two
  // frames: one to mount, one to lay out.
  const scrollerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!currentAnchorId) return;
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => {
        const list = scrollerRef.current;
        const item = list?.querySelector<HTMLElement>('[data-contents-current="true"]');
        if (!list || !item) return;
        const delta = item.getBoundingClientRect().top - list.getBoundingClientRect().top;
        list.scrollTop = Math.max(0, list.scrollTop + delta - 12);
      });
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, [currentAnchorId]);

  function toggle(anchorId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(anchorId)) next.delete(anchorId);
      else next.add(anchorId);
      return next;
    });
  }

  const rows = (nodes: ContentsNode[], indent: number) =>
    nodes.map((node) => (
      <Row
        key={node.anchorId}
        node={node}
        indent={indent}
        current={node.anchorId === currentAnchorId}
        currentMinutesLeft={currentMinutesLeft}
        expanded={expanded.has(node.anchorId)}
        onToggle={() => toggle(node.anchorId)}
        onGo={() => onGoToChapter(node.anchorId)}
      >
        {rows(node.children, indent + 1)}
      </Row>
    ));

  // A book with no contents of its own still has yours, so this is a branch in
  // the middle of the list rather than the early return it used to be.
  const noContents =
    contents.front.length === 0 &&
    contents.body.length === 0 &&
    contents.back.length === 0;

  const preface = documents?.find((d) => d.scope === "preface") ?? null;
  const afterword = documents?.find((d) => d.scope === "afterword") ?? null;

  return (
    <div ref={scrollerRef} className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
      {preface && (
        <DocumentRow state={preface} onOpen={() => onOpenDocument("preface")} />
      )}

      {noContents ? (
        <p className="py-3 text-sm text-muted-foreground">
          This book didn&rsquo;t come with a table of contents.
        </p>
      ) : (
        <>
          {contents.front.length > 0 && (
            <MatterGroup
              label="Front matter"
              count={contents.front.length}
              open={groupsOpen.front}
              onToggle={() => setGroupsOpen((g) => ({ ...g, front: !g.front }))}
            >
              {rows(contents.front, 1)}
            </MatterGroup>
          )}

          {rows(contents.body, 0)}

          {contents.back.length > 0 && (
            <MatterGroup
              label="Back matter"
              count={contents.back.length}
              open={groupsOpen.back}
              onToggle={() => setGroupsOpen((g) => ({ ...g, back: !g.back }))}
            >
              {rows(contents.back, 1)}
            </MatterGroup>
          )}
        </>
      )}

      {afterword && (
        <DocumentRow
          state={afterword}
          onOpen={() => onOpenDocument("afterword")}
        />
      )}
    </div>
  );
}

/**
 * The reader's preface or afterword, at the edge of the book's own contents.
 *
 * Set apart by a rule and by the hand icon rather than by indentation, because
 * indentation in this list means "inside the thing above you" and these are
 * inside nothing. The subtitle carries the whole state: an invitation before
 * it's written, a date afterwards, and the reason it's closed when it is.
 */
function DocumentRow({
  state,
  onOpen,
}: {
  state: BookDocumentState;
  onOpen: () => void;
}) {
  const written = state.written ? shortDate(state.writtenAt) : null;
  const subtitle = written
    ? `Written ${written}`
    : BOOK_DOCUMENT_BLURB[state.scope];

  return (
    <div
      className={cn(
        "my-1",
        state.scope === "preface"
          ? "mb-2 border-b border-border pb-2"
          : "mt-2 border-t border-border pt-2"
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-center gap-2.5 rounded-md px-1 py-1.5 text-left transition-colors hover:bg-muted"
      >
        <PenLine className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm text-foreground">
            {BOOK_DOCUMENT_LABEL[state.scope]}
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            {subtitle}
          </span>
        </span>
      </button>
    </div>
  );
}

function shortDate(value: string | null): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/**
 * One chapter, and its subsections underneath it.
 *
 * The disclosure arrow and the title are separate targets on purpose: a chapter
 * with sections in it is still somewhere you can go, and folding "open this" and
 * "read this" into one tap would make the commonest row in the list ambiguous.
 */
function Row({
  node,
  indent,
  current,
  currentMinutesLeft,
  expanded,
  onToggle,
  onGo,
  children,
}: {
  node: ContentsNode;
  indent: number;
  current: boolean;
  currentMinutesLeft: number | null;
  expanded: boolean;
  onToggle: () => void;
  onGo: () => void;
  children: React.ReactNode;
}) {
  const hasChildren = node.children.length > 0;
  // The chapter you're in reports what's LEFT of it; every other row reports how
  // long it is. Same number for a chapter you haven't started, but the label has
  // to be honest about which one it is when you're halfway through.
  const time = current
    ? formatTimeLeft(currentMinutesLeft) ?? formatDuration(node.minutes)
    : formatDuration(node.minutes);

  return (
    <>
      <div
        data-contents-current={current || undefined}
        className={cn(
          "relative flex items-baseline gap-1 rounded-md",
          current && "bg-muted/50"
        )}
      >
        {/* Marked three ways over — a rule in the margin, the weight of the
            type, and the word itself. In e-ink mode every fill in the palette
            collapses to white, so the rule and the weight are what survive;
            both are drawn in the primary colour, which is true black there. */}
        {current && (
          <span
            aria-hidden
            className="absolute inset-y-1 left-0 w-[3px] rounded-full bg-primary"
          />
        )}

        <button
          type="button"
          onClick={onToggle}
          aria-label={expanded ? `Collapse ${node.title}` : `Expand ${node.title}`}
          aria-expanded={expanded}
          className={cn(
            "mt-1 shrink-0 self-start rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
            !hasChildren && "pointer-events-none opacity-0"
          )}
          style={{ marginLeft: `${indent * 0.875 + 0.25}rem` }}
          tabIndex={hasChildren ? undefined : -1}
        >
          <ChevronRight
            className={cn("h-3.5 w-3.5 transition-transform", expanded && "rotate-90")}
          />
        </button>

        <button
          type="button"
          onClick={onGo}
          aria-current={current ? "true" : undefined}
          className="flex min-w-0 flex-1 items-baseline justify-between gap-3 rounded-md py-1.5 pr-2 text-left transition-colors hover:bg-muted"
        >
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-sm",
              indent === 0 ? "text-foreground" : "text-muted-foreground",
              current && "font-semibold text-foreground"
            )}
          >
            {node.title}
          </span>
          {time && (
            <span
              className={cn(
                "shrink-0 text-xs tabular-nums",
                current ? "font-medium text-primary" : "text-muted-foreground/70"
              )}
            >
              {time}
            </span>
          )}
        </button>
      </div>

      {expanded && children}
    </>
  );
}

/**
 * The matter bracketing the book. Collapsed by default and labelled with a
 * count, so it reads as "there are five of these and you don't want them" rather
 * than as something having gone missing.
 */
function MatterGroup({
  label,
  count,
  open,
  onToggle,
  children,
}: {
  label: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-1 rounded-md py-1.5 pr-2 pl-1 text-left text-xs font-medium tracking-wide text-muted-foreground/80 uppercase transition-colors hover:bg-muted hover:text-foreground"
      >
        <ChevronRight
          className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-90")}
        />
        <span>{label}</span>
        <span className="tabular-nums opacity-60">{count}</span>
      </button>
      {open && children}
    </>
  );
}
