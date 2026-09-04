"use client";

import {
  Highlighter,
  MessageSquare,
  MessageSquarePlus,
  Star,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { MemberAvatar } from "@/components/journal/member-avatar";
import { memberPhotoUrl } from "@/lib/media/member-photo-url";
import {
  annotationKind,
  annotationOrigin,
  type AnnotationSummary,
} from "@/lib/reading/annotation-types";
import { chapterIndexAt, type ChapterBound } from "@/lib/reading/reading-progress";
import { useFinePointer } from "./use-selection-range";

/** A run of marks that fall in the same chapter. */
type MarkGroup = {
  key: string;
  /** Null when the book has no chapters to group by — then there are no headings. */
  title: string | null;
  /** How far into the book the chapter starts. */
  percent: number | null;
  items: AnnotationSummary[];
};

/**
 * Everything you've marked in this book, in reading order, grouped by chapter.
 *
 * The grouping is the answer to "where was this?" — a list of nine passages out
 * of a five-hundred-page novel is unreadable without it, because every entry
 * looks like every other one and none of them says where it came from. Chapters
 * are the book's own way of naming a place, so they're what the list uses; the
 * percentage beside each heading is for the many books whose chapters are called
 * nothing more helpful than a number.
 *
 * Plain highlights are included and rendered lighter than notes and chats. They
 * are deliberately absent from the MARGIN — an icon out there would mean
 * "content you can't see", which a highlight doesn't have — but they belong
 * here, because this is the retrieval surface. A highlight you can never find
 * again is the write-only failure mode this list exists to prevent.
 */
export function AnnotationList({
  annotations,
  chapters,
  totalChars,
  openAnnotationId,
  hasRealPages,
  onOpen,
  onClose,
  onAsk,
  starredOnly,
  onStarredOnlyChange,
  onToggleStar,
  dockToggle,
}: {
  annotations: AnnotationSummary[];
  /**
   * The book's chapters in the character space, or empty when there are none to
   * group by — an article, or a book whose contents we couldn't resolve.
   */
  chapters: ChapterBound[];
  totalChars: number;
  openAnnotationId: string | null;
  hasRealPages: boolean;
  onOpen: (id: string) => void;
  onClose: () => void;
  /**
   * Start a new conversation about where the reader is — the same thing the
   * margin control does, offered here because that control is UNDERNEATH this
   * panel whenever it's open.
   *
   * The margin buttons sit at a fixed top-right, which is exactly where a docked
   * panel arrives, so opening the list took the only way of starting a chat off
   * the screen. Reaching one meant closing the list first, which is backwards:
   * reading back through what you've marked is one of the likelier moments to
   * think of something new to ask.
   */
  onAsk: () => void;
  /** Collapse the list to starred marks only. Remembered per book by the caller. */
  starredOnly: boolean;
  onStarredOnlyChange: (on: boolean) => void;
  onToggleStar: (id: string, next: boolean) => void;
  /** The float/dock control, when the panel is presented in a way that can dock. */
  dockToggle?: React.ReactNode;
}) {
  // Where the row's star can hide until you reach for it, and where it can't: a
  // touch screen has no hover state to reveal anything with, and a control that
  // never appears is a control that does not exist.
  const finePointer = useFinePointer();
  // Reading order, not creation order: this is a companion to the text, so it
  // should run the way the text does. created_at breaks ties for two marks on
  // the same passage.
  const all = [...annotations].sort(
    (a, b) =>
      a.anchorCharOffset - b.anchorCharOffset ||
      a.createdAt.localeCompare(b.createdAt)
  );
  const starredCount = all.filter((a) => a.starred).length;
  // Filtered before grouping, which is what makes an empty chapter's heading
  // disappear rather than sit there with nothing under it: the loop below builds
  // a group only when it meets an item that belongs in one.
  //
  // Reading order still, in both modes. Hoisting starred marks to the top was
  // the obvious alternative, and it breaks the one property that makes this list
  // readable — it runs the way the book runs, so it never disagrees with the
  // page you are on.
  //
  // Ignored in a book with nothing marked at all: a filter is a question about
  // which of your marks to show, and there is no version of that question worth
  // asking of none. It stays REMEMBERED though — mark something and the filter
  // you left on is still on.
  const filtering = starredOnly && all.length > 0;
  const ordered = filtering ? all.filter((a) => a.starred) : all;

  const groups: MarkGroup[] = [];
  for (const a of ordered) {
    if (chapters.length === 0) {
      // Nothing to group by. One unlabelled run, which renders as the flat list
      // this was before — better than a heading that says nothing.
      if (groups.length === 0) {
        groups.push({ key: "all", title: null, percent: null, items: [] });
      }
      groups[0].items.push(a);
      continue;
    }
    const index = chapterIndexAt(a.anchorCharOffset, chapters);
    const key = `ch${index}`;
    if (groups.at(-1)?.key !== key) {
      const chapter = index >= 0 ? chapters[index] : null;
      groups.push({
        key,
        // Before the first chapter the TOC knows about — a preface the contents
        // skipped, or a book that starts numbering late.
        title: chapter?.title ?? "Front matter",
        percent:
          chapter && totalChars > 0
            ? Math.round((chapter.charStart / totalChars) * 100)
            : index < 0
              ? 0
              : null,
        items: [],
      });
    }
    groups.at(-1)!.items.push(a);
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2.5">
        <p className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
          {filtering
            ? // Phrased as an adjective rather than "3 starred marks", so it
              // reads correctly at 0 and 1 without a plural branch.
              `${starredCount} starred`
            : all.length === 0
              ? "Nothing marked yet"
              : `${all.length} ${all.length === 1 ? "mark" : "marks"}`}
        </p>
        {/* Ahead of the dock and close controls, and drawn the same way, so the
            header reads as one set. Those two are about the PANEL; this one is
            about the book, which is why it takes the leftmost slot rather than
            sitting between them. */}
        <button
          type="button"
          onClick={onAsk}
          aria-label="Ask about this page"
          title="Ask about this page"
          className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <MessageSquarePlus className="h-4 w-4" />
        </button>
        {/* Also about the book rather than the panel, so it sits with the ask
            button and ahead of the two panel controls. What it hides, it hides
            HERE and nowhere else: every highlight stays on the page and every
            margin icon stays where it was. */}
        {all.length > 0 && (
          <button
            type="button"
            onClick={() => onStarredOnlyChange(!starredOnly)}
            aria-pressed={starredOnly}
            aria-label={starredOnly ? "Show all marks" : "Show starred marks only"}
            title={starredOnly ? "Showing starred only" : "Starred only"}
            className={cn(
              "rounded p-1 transition-colors",
              starredOnly
                ? "bg-muted text-star"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            <Star className={cn("h-4 w-4", starredOnly && "fill-current")} />
          </button>
        )}
        {dockToggle}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      {ordered.length === 0 ? (
        // Two empty states saying different things. "Nothing here" under a
        // filter is a question about the filter, not about the book, and a
        // blank panel answers neither one.
        <p className="px-4 py-6 text-xs leading-relaxed text-muted-foreground">
          {filtering
            ? "Nothing starred in this book yet. Star a mark to keep it — starred passages get an icon in the margin, and they stay with you in whatever you ask about the book."
            : "Select a passage to highlight it, write a note on it, or ask about it. Whatever you mark shows up here, in the order you'll read it."}
        </p>
      ) : (
        <ul className="min-h-0 flex-1 overflow-y-auto">
          {groups.map((group) => (
            <li key={group.key}>
              {group.title && (
                // Sticky, so the chapter you're reading about stays named while
                // you scroll its marks — the same trick a long contacts list
                // uses, and for the same reason.
                <p className="sticky top-0 z-10 flex items-baseline justify-between gap-3 border-b border-border/60 bg-background/95 px-4 py-1.5 text-[11px] font-medium text-muted-foreground backdrop-blur">
                  <span className="truncate">{group.title}</span>
                  {group.percent != null && (
                    <span className="shrink-0 tabular-nums opacity-70">
                      {group.percent}%
                    </span>
                  )}
                </p>
              )}
              <ul>
                {group.items.map((a) => {
                  const kind = annotationKind(a);
                  const theirs = annotationOrigin(a) === "theirs";
                  const who = theirs
                    ? (a.participants.find((p) => p.userId === a.sharedFromUserId) ??
                      null)
                    : null;
                  const Icon = kind === "thread" ? MessageSquare : Highlighter;
                  return (
                    // Two controls now, not one: opening the mark and starring
                    // it. A button cannot nest inside a button, so the li takes
                    // the border, the layout and the background, and the star
                    // sits beside the opener rather than within it.
                    <li
                      key={a.id}
                      className={cn(
                        // The background is here rather than on the opener so
                        // that moving the pointer onto the star doesn't make the
                        // row flicker back to unhovered.
                        "group/mark relative flex border-b border-border/60 transition-colors hover:bg-muted/60",
                        a.id === openAnnotationId && "bg-muted"
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => onOpen(a.id)}
                        className="flex min-w-0 flex-1 gap-2.5 py-3 pl-4 pr-9 text-left"
                      >
                        {who ? (
                          <MemberAvatar
                            name={who.name}
                            url={who.email ? memberPhotoUrl(who.email) : null}
                            size="xs"
                            className="mt-0.5"
                          />
                        ) : (
                          <Icon
                            className={cn(
                              "mt-0.5 h-3.5 w-3.5 shrink-0",
                              kind === "highlight"
                                ? "text-muted-foreground/60"
                                : "text-muted-foreground"
                            )}
                          />
                        )}
                        <div className="min-w-0 flex-1">
                          {a.quotedText ? (
                            <p
                              className={cn(
                                "line-clamp-3 font-serif text-[13px] leading-snug",
                                // A highlight is only its passage, so it stays
                                // quiet. A note or chat has its own content
                                // below, and the quote is context for it.
                                kind === "highlight"
                                  ? "text-muted-foreground"
                                  : "text-foreground"
                              )}
                            >
                              {a.quotedText}
                              {a.plainQuotedText && (
                                <span className="mt-1 block text-[12px] not-italic leading-snug text-muted-foreground/80">
                                  {a.plainQuotedText}
                                </span>
                              )}
                            </p>
                          ) : (
                            // A conversation about a place rather than a passage
                            // has no quote to show, so it shows what you asked.
                            // "In the text" was the old answer and it named
                            // nothing — this list is the retrieval surface, so an
                            // entry that can't be told apart from the next one is
                            // the whole failure.
                            <p
                              className={cn(
                                "text-[13px] leading-snug",
                                a.firstQuestion
                                  ? "line-clamp-2 text-foreground"
                                  : "italic text-muted-foreground"
                              )}
                            >
                              {a.firstQuestion ?? "In the text"}
                            </p>
                          )}
                          {/* The most recent thing written here. A passage can
                              carry several notes now, and the list is a
                              retrieval surface — the latest thought is the one
                              most likely to be what you're looking for. */}
                          {a.latestNote && (
                            <p className="mt-1 line-clamp-2 text-xs leading-snug text-foreground">
                              {a.latestNote}
                            </p>
                          )}
                          {/* A share whose passage couldn't be found in this
                              copy. It is still here, still openable, still
                              linked — it just has nowhere to sit in the text,
                              and saying so is the difference between a mark
                              that is quiet and one that looks broken. */}
                          {a.anchorStatus === "unplaced" && (
                            <p className="mt-1 text-[11px] italic text-muted-foreground">
                              Couldn&rsquo;t find this passage in your copy
                            </p>
                          )}
                          {/* One line for everything about the mark rather than
                              about the passage: whose it is, how much of it
                              there is, and where it sits. */}
                          {(a.messageCount > 0 || who || a.unreadCount > 0) && (
                            <p className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                              {a.unreadCount > 0 && (
                                <span
                                  aria-label={`${a.unreadCount} new`}
                                  className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary"
                                />
                              )}
                              <span className="truncate">
                                {[
                                  who?.name,
                                  a.messageCount > 0
                                    ? `${a.messageCount} ${a.messageCount === 1 ? "message" : "messages"}`
                                    : null,
                                  a.anchorPage != null && hasRealPages
                                    ? `p.${a.anchorPage}`
                                    : null,
                                ]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </span>
                            </p>
                          )}
                        </div>
                      </button>
                      {/* Overlaid on the row's right padding rather than placed
                          in the flex run: a star in the flow would reserve a
                          column of empty space on every unstarred row, which is
                          most of them. */}
                      <button
                        type="button"
                        onClick={() => onToggleStar(a.id, !a.starred)}
                        aria-pressed={a.starred}
                        aria-label={a.starred ? "Unstar this mark" : "Star this mark"}
                        title={a.starred ? "Starred" : "Star this mark"}
                        className={cn(
                          "absolute right-2 top-2.5 rounded p-1 transition-colors",
                          a.starred
                            ? "text-star"
                            : finePointer
                              ? // Faint until you reach for it. focus-visible is
                                // not decoration here: without it the control is
                                // unreachable by keyboard, because it otherwise
                                // never appears at all.
                                "text-muted-foreground opacity-0 focus-visible:opacity-100 group-hover/mark:opacity-60 hover:!opacity-100"
                              : "text-muted-foreground opacity-40"
                        )}
                      >
                        <Star className={cn("h-3.5 w-3.5", a.starred && "fill-current")} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
