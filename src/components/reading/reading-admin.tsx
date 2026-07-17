"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  ChevronRight,
  ListTree,
  Loader2,
  MapPin,
  MoreHorizontal,
  Pencil,
  ShoppingBag,
  Trash2,
  Upload,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CloseQuizButton } from "@/components/reading/close-quiz-button";
import { ChangeLocationDialog } from "@/components/reading/change-location-dialog";
import { EditBookDialog } from "@/components/reading/edit-book-dialog";
import {
  DeleteQuizButton,
  GenerateDraftButton,
} from "@/components/reading/parent-admin-controls";
import {
  changeStretchTarget,
  getBookOutline,
  listChapterGoalOptions,
  removeBook,
  type BookOutline,
  type ChapterGoalOption,
} from "@/app/(reading)/reader/actions";
import { updateReadingGoal } from "@/app/(journal)/settings/family/actions";
import { quizEditHref, quizResultsHref } from "@/lib/reading/links";
import { quizRangeLabel } from "@/lib/reading/quiz-format";
import { chapterTargetLabel, WORDS_PER_PAGE } from "@/lib/reading/chapter-target";
import { amazonHref, koboHref } from "@/lib/reading/store-links";
import { useBookFileActions } from "@/lib/reading/use-book-file-actions";
import { cn } from "@/lib/utils";
import type {
  ReadingAdminBook,
  ReadingAdminMember,
  ReadingAdminQuiz,
  ReadingBookWithProgress,
} from "@/lib/types";

/** Uppercase the first letter (goal phrasing like "Finish Chapter 8"). */
function capitalize(s: string): string {
  return s.length ? s[0].toUpperCase() + s.slice(1) : s;
}

function firstName(name: string | null, email: string): string {
  return name?.trim().split(/\s+/)[0] || email;
}

function formatDue(due: string | null): string | null {
  if (!due) return null;
  return new Date(`${due}T12:00:00`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/** The page range to generate a fresh quiz over: the unread stretch up to the
 * week's target. Null when there's nothing sensible to cover yet. */
function generateRange(
  book: ReadingAdminBook
): { from: number | null; through: number } | null {
  const through =
    book.targetPage ?? (book.currentPage > 0 ? book.currentPage : null);
  if (through == null || through < 1) return null;
  const from = book.currentPage > 0 ? Math.min(book.currentPage, through) : null;
  return { from, through };
}

/** The chapter a page falls in (the first whose end reaches it). */
function chapterForPage(
  chapters: { title: string; endPage: number }[],
  page: number
): string | null {
  return (chapters.find((c) => c.endPage >= page) ?? chapters[chapters.length - 1])?.title ?? null;
}

/**
 * A quiz's covered range as a label: a chapter (range) for chapter books, else
 * the page range. Chapter titles carry their own casing, so `isChapter` tells
 * the caller to skip the CSS `capitalize` that page labels rely on.
 */
function quizCoverageLabel(
  book: ReadingAdminBook,
  fromPage: number | null,
  throughPage: number
): { text: string; isChapter: boolean } {
  const chapters = book.chapters;
  if (chapters && chapters.length > 0) {
    const through = chapterForPage(chapters, throughPage);
    if (through) {
      if (fromPage == null || fromPage <= 1) {
        return { text: `Through ${through}`, isChapter: true };
      }
      const from = chapterForPage(chapters, fromPage);
      return {
        text: from && from !== through ? `${from} – ${through}` : through,
        isChapter: true,
      };
    }
  }
  return { text: quizRangeLabel(fromPage, throughPage), isChapter: false };
}

/**
 * The Parent Admin console, one tab per kid. Each kid's reading (books, live
 * quiz, drafts, history) lives on its own tab so a parent isn't scrolling a long
 * stacked list. The active tab rides in the URL (?kid=email) so a refresh — e.g.
 * after saving a goal — stays on the same kid.
 */
export function ReadingAdmin({
  members,
  initialEmail = null,
}: {
  members: ReadingAdminMember[];
  initialEmail?: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const initial =
    members.find((m) => m.email === initialEmail)?.email ?? members[0]?.email ?? "";
  const [activeEmail, setActiveEmail] = useState(initial);
  const active = members.find((m) => m.email === activeEmail) ?? members[0];

  function selectTab(email: string) {
    setActiveEmail(email);
    router.replace(`${pathname}?kid=${encodeURIComponent(email)}`, { scroll: false });
  }

  if (!active) return null;

  return (
    <div className="mt-6">
      <div className="flex flex-wrap gap-1.5 border-b border-border pb-3">
        {members.map((m) => (
          <button
            key={m.email}
            type="button"
            onClick={() => selectTab(m.email)}
            className={cn(
              "rounded-full px-3 py-1 text-sm font-medium transition-colors",
              active.email === m.email
                ? "bg-foreground text-background"
                : "bg-muted/70 text-muted-foreground hover:text-foreground"
            )}
          >
            {firstName(m.name, m.email)}
          </button>
        ))}
      </div>

      <WeeklyGoalCard
        key={active.email}
        memberEmail={active.email}
        weeklyPageGoal={active.weeklyPageGoal}
      />

      <div className="mt-5 space-y-5">
        {active.books.map((book) => (
          <BookBlock key={book.bookId} book={book} memberEmail={active.email} />
        ))}
      </div>
    </div>
  );
}

/**
 * A kid's weekly reading goal, shown at the top of their tab: the pages-per-week
 * floor plus its word-equivalent (a page is {WORDS_PER_PAGE} words — see
 * chapter-target.ts), with an inline editor. This is the standing weekly minimum
 * (reading_settings.weekly_page_goal), distinct from a single book's stretch
 * target that AdminGoalDialog edits. `key`ed on email so switching tabs resets
 * the dialog's local form state to the newly-selected kid.
 */
function WeeklyGoalCard({
  memberEmail,
  weeklyPageGoal,
}: {
  memberEmail: string;
  weeklyPageGoal: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pages, setPages] = useState(String(weeklyPageGoal));
  const [note, setNote] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const words = weeklyPageGoal * WORDS_PER_PAGE;
  const draftPages = pages.trim() === "" ? NaN : Number(pages);
  const draftWords = Number.isFinite(draftPages)
    ? Math.max(0, Math.floor(draftPages)) * WORDS_PER_PAGE
    : null;

  function openDialog() {
    setNote(null);
    setPages(String(weeklyPageGoal));
    setOpen(true);
  }

  function save() {
    setNote(null);
    const n = pages.trim() === "" ? NaN : Number(pages);
    if (!Number.isFinite(n) || n < 0) {
      setNote("Enter a goal of 0 or more pages.");
      return;
    }
    startTransition(async () => {
      try {
        await updateReadingGoal(memberEmail, Math.floor(n));
        setOpen(false);
        router.refresh();
      } catch (err) {
        setNote(err instanceof Error ? err.message : "Couldn't save the goal.");
      }
    });
  }

  return (
    <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-muted/20 px-4 py-3">
      <div className="min-w-0">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Weekly reading goal
        </p>
        <p className="mt-0.5 text-sm text-foreground">
          {weeklyPageGoal > 0 ? (
            <>
              <span className="font-medium">
                {numberFmt.format(weeklyPageGoal)}{" "}
                {weeklyPageGoal === 1 ? "page" : "pages"}
              </span>{" "}
              / week
              <span className="text-muted-foreground">
                {" · "}≈ {numberFmt.format(words)} words
              </span>
            </>
          ) : (
            <span className="text-muted-foreground">No weekly goal set</span>
          )}
        </p>
      </div>

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={openDialog}
        className="shrink-0"
      >
        Change goal
      </Button>

      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Weekly reading goal</DialogTitle>
            <DialogDescription>
              How many pages a week this reader aims for. A page counts as{" "}
              {WORDS_PER_PAGE} words.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label htmlFor="weekly-goal-pages">Pages per week</Label>
            <Input
              id="weekly-goal-pages"
              type="number"
              min={0}
              value={pages}
              onChange={(e) => setPages(e.target.value)}
            />
            {draftWords != null && (
              <p className="text-xs text-muted-foreground">
                ≈ {numberFmt.format(draftWords)} words per week
              </p>
            )}
          </div>

          {note && <p className="text-xs text-destructive">{note}</p>}
          <DialogFooter>
            <Button type="button" onClick={save} disabled={pending}>
              {pending ? "Saving…" : "Save goal"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function BookBlock({
  book,
  memberEmail,
}: {
  book: ReadingAdminBook;
  memberEmail: string;
}) {
  const router = useRouter();
  const due = formatDue(book.targetDue);
  const total = book.totalPages ? ` of ${book.totalPages}` : "";
  const genRange = generateRange(book);
  const targetChapter = book.book.target_chapter;

  const [editOpen, setEditOpen] = useState(false);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [locationOpen, setLocationOpen] = useState(false);
  const [deleting, startDelete] = useTransition();

  // Reuse the reading list's upload/replace machinery. It only reads `id` and
  // `content`, so a minimal progress shape is enough.
  const fileBook: ReadingBookWithProgress = {
    ...book.book,
    pagesReadThisWeek: 0,
    content: book.content,
    hasResumePoint: false,
    relatedEntries: [],
  };
  const { inputRef, openFilePicker, handleFile, busy, hasFile } =
    useBookFileActions(fileBook, memberEmail);

  function handleDelete() {
    if (!window.confirm(`Delete "${book.title}" from this reader's books?`)) return;
    startDelete(async () => {
      try {
        await removeBook(book.bookId, memberEmail);
        router.refresh();
      } catch {
        // Surfaced elsewhere; nothing actionable here in the admin console.
      }
    });
  }

  return (
    <div className="rounded-xl border border-border">
      {/* Assignment state (read-only) + admin controls. */}
      <div className="border-b border-border px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <p className="font-serif text-base text-foreground">{book.title}</p>
              {book.status !== "in_progress" && (
                <Badge variant="outline" className="capitalize">
                  {book.status}
                </Badge>
              )}
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {/* Chapter books have no real page numbers — show the chapter goal;
                  page books keep their page progress + goal. */}
              {targetChapter ? (
                <span className="text-foreground">
                  Goal: {capitalize(chapterTargetLabel(targetChapter))}
                </span>
              ) : (
                <>
                  Page {book.currentPage}
                  {total}
                  {" · "}
                  {book.targetPage != null
                    ? `goal p.${book.targetPage}`
                    : "no target set"}
                </>
              )}
              {due ? ` · due ${due}` : ""}
              {book.targetPage != null && (
                <>
                  {" · "}
                  <AdminGoalDialog book={book} memberEmail={memberEmail} />
                </>
              )}
            </p>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger
              className="-mr-1 shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
              aria-label={`Actions for ${book.title}`}
              disabled={busy || deleting}
            >
              {busy || deleting ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <MoreHorizontal className="h-5 w-5" />
              )}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" side="bottom" className="w-48">
              <DropdownMenuItem disabled={busy} onClick={openFilePicker}>
                <Upload />
                {hasFile ? "Replace book file" : "Upload book file"}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setEditOpen(true)}>
                <Pencil />
                Edit details
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setLocationOpen(true)}>
                <MapPin />
                Change current location
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setOutlineOpen(true)}>
                <ListTree />
                View outline
              </DropdownMenuItem>
              <DropdownMenuItem
                render={
                  <a
                    href={amazonHref(book.book)}
                    target="_blank"
                    rel="noopener noreferrer"
                  />
                }
              >
                <ShoppingBag />
                Find on Amazon
              </DropdownMenuItem>
              <DropdownMenuItem
                render={
                  <a
                    href={koboHref(book.book)}
                    target="_blank"
                    rel="noopener noreferrer"
                  />
                }
              >
                <ShoppingBag />
                Find on Kobo
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={handleDelete}>
                <Trash2 />
                Delete book
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="space-y-4 px-4 py-4">
        {book.draftQuiz && (
          <DraftCard quiz={book.draftQuiz} book={book} memberEmail={memberEmail} />
        )}

        {book.activeQuiz ? (
          <ActiveQuizCard
            quiz={book.activeQuiz}
            book={book}
            memberEmail={memberEmail}
          />
        ) : (
          !book.draftQuiz && (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">
                No quiz for this stretch yet.
              </p>
              {genRange ? (
                <GenerateDraftButton
                  bookId={book.bookId}
                  memberEmail={memberEmail}
                  fromPage={genRange.from}
                  throughPage={genRange.through}
                  label={
                    targetChapter
                      ? `Generate quiz through ${targetChapter.title}`
                      : `Generate quiz for ${quizRangeLabel(genRange.from, genRange.through)}`
                  }
                />
              ) : (
                <p className="text-xs text-muted-foreground">
                  Set a target page to generate one.
                </p>
              )}
            </div>
          )
        )}

        {book.history.length > 0 && (
          <details className="group">
            <summary className="cursor-pointer list-none text-xs font-medium uppercase tracking-wide text-muted-foreground transition-colors hover:text-foreground">
              Older quizzes ({book.history.length})
            </summary>
            <div className="mt-2 space-y-1.5">
              {book.history.map((q) => {
                const cover = quizCoverageLabel(book, q.fromPage, q.throughPage);
                return (
                <Link
                  key={q.id}
                  href={quizResultsHref(q.id, memberEmail)}
                  className="flex items-center justify-between gap-3 rounded-md border border-border/60 px-3 py-2 text-sm transition-colors hover:bg-accent"
                >
                  <span className={cn("text-muted-foreground", !cover.isChapter && "capitalize")}>
                    {cover.text}
                  </span>
                  <span className="flex items-center gap-2 text-xs text-muted-foreground">
                    {historyLabel(q)}
                    <ChevronRight className="h-3.5 w-3.5" />
                  </span>
                </Link>
                );
              })}
            </div>
          </details>
        )}
      </div>

      {/* Outline + edit dialogs and the hidden file input the upload control
          triggers. (The goal editor renders its own inline trigger above.) */}
      <OutlineDialog
        book={book}
        memberEmail={memberEmail}
        open={outlineOpen}
        onOpenChange={setOutlineOpen}
      />
      <ChangeLocationDialog
        book={book.book}
        memberEmail={memberEmail}
        open={locationOpen}
        onOpenChange={setLocationOpen}
      />
      <EditBookDialog
        book={book.book}
        memberEmail={memberEmail}
        open={editOpen}
        onOpenChange={(next) => {
          setEditOpen(next);
          if (!next) router.refresh(); // reflect edits/removal in the admin view
        }}
      />
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
    </div>
  );
}

/**
 * Parent-only goal editor: set this stretch's target (a chapter for chapter
 * books, an exact page otherwise) AND its due date, in one place. A parent
 * override isn't bound to the kid's weekly-minimum floor. Self-contained — it
 * renders its own inline "Change" trigger and loads chapters when opened.
 */
function AdminGoalDialog({
  book,
  memberEmail,
}: {
  book: ReadingAdminBook;
  memberEmail: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [chapters, setChapters] = useState<ChapterGoalOption[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [chapterIndex, setChapterIndex] = useState<number | null>(null);
  const [page, setPage] = useState("");
  const [due, setDue] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Reset the form and load the chapter list when the dialog opens (in the click
  // handler, not an effect, so there's no cascading-render lint churn).
  function openDialog() {
    setNote(null);
    setPage(book.targetPage != null ? String(book.targetPage) : "");
    setDue(book.book.target_due ?? "");
    setChapters(null);
    setChapterIndex(null);
    setOpen(true);
    setLoading(true);
    listChapterGoalOptions(book.bookId, memberEmail)
      .then((opts) => {
        setChapters(opts);
        // Preselect the chapter matching the current goal, else the first.
        const current = opts.find(
          (o) => o.title === book.book.target_chapter?.title
        );
        if (opts.length > 0) setChapterIndex((current ?? opts[0]).index);
      })
      .catch(() => setChapters([]))
      .finally(() => setLoading(false));
  }

  const hasChapters = !!chapters && chapters.length > 0;

  function save() {
    setNote(null);
    if (!due) {
      setNote("Pick a due date.");
      return;
    }
    let choice: { targetPage?: number; chapterIndex?: number; dueDate: string };
    if (hasChapters) {
      if (chapterIndex == null) {
        setNote("Pick a chapter.");
        return;
      }
      choice = { chapterIndex, dueDate: due };
    } else {
      const n = page.trim() === "" ? NaN : Number(page);
      if (!Number.isFinite(n)) {
        setNote("Enter a page number.");
        return;
      }
      choice = { targetPage: Math.floor(n), dueDate: due };
    }
    startTransition(async () => {
      try {
        await changeStretchTarget(book.bookId, choice, memberEmail);
        setOpen(false);
        router.refresh();
      } catch (err) {
        setNote(err instanceof Error ? err.message : "Couldn't change the goal.");
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={openDialog}
        className="font-medium underline decoration-dotted underline-offset-2 transition-colors hover:text-foreground"
      >
        Change
      </button>
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Change {book.title}&apos;s goal</DialogTitle>
          <DialogDescription>
            Set the target for this stretch and when it&apos;s due.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <p className="text-xs text-muted-foreground">Loading chapters…</p>
        ) : (
          <div className="space-y-3">
            {hasChapters ? (
              <div className="space-y-1.5">
                <Label htmlFor="admin-goal-chapter">Read through</Label>
                <select
                  id="admin-goal-chapter"
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  value={chapterIndex ?? ""}
                  onChange={(e) => setChapterIndex(Number(e.target.value))}
                >
                  {chapters!.map((c) => (
                    <option key={c.index} value={c.index}>
                      {c.title}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label htmlFor="admin-goal-page">Goal page</Label>
                <Input
                  id="admin-goal-page"
                  type="number"
                  min={book.currentPage + 1}
                  max={book.totalPages ?? undefined}
                  value={page}
                  onChange={(e) => setPage(e.target.value)}
                />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="admin-goal-due">Due date</Label>
              <Input
                id="admin-goal-due"
                type="date"
                value={due}
                onChange={(e) => setDue(e.target.value)}
              />
            </div>
          </div>
        )}

        {note && <p className="text-xs text-destructive">{note}</p>}
        <DialogFooter>
          <Button type="button" onClick={save} disabled={pending || loading}>
            {pending ? "Saving…" : "Save goal"}
          </Button>
        </DialogFooter>
      </DialogContent>
      </Dialog>
    </>
  );
}

const numberFmt = new Intl.NumberFormat("en-US");

/**
 * A read-only chapter outline for a book: per-chapter and running word/page
 * counts, with the reader's current chapter and the stretch up to this week's
 * goal highlighted. Only meaningful for chapter books (synthetic-page EPUBs with
 * a real chapter list); everything else shows an "not available" note. Fetched
 * lazily when the modal opens so the admin query stays light.
 */
function OutlineDialog({
  book,
  memberEmail,
  open,
  onOpenChange,
}: {
  book: ReadingAdminBook;
  memberEmail: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [outline, setOutline] = useState<BookOutline | null>(null);
  const [loaded, setLoaded] = useState(false);

  // Load the outline lazily when the dialog opens. State is only set from the
  // async callbacks (never synchronously in the effect body) to avoid cascading
  // renders. One dialog instance per book, so there's no need to reset between
  // opens — the same book's data is simply re-fetched.
  useEffect(() => {
    if (!open) return;
    let active = true;
    getBookOutline(book.bookId, memberEmail)
      .then((data) => {
        if (active) {
          setOutline(data);
          setLoaded(true);
        }
      })
      .catch(() => {
        if (active) setLoaded(true);
      });
    return () => {
      active = false;
    };
  }, [open, book.bookId, memberEmail]);

  // The week's reading, from where they are to the goal (an estimate for the
  // header). Word count follows the 280-word page definition.
  const goalPages =
    outline?.targetPage != null
      ? Math.max(0, outline.targetPage - outline.currentPage)
      : null;
  const goalWords = goalPages != null ? goalPages * WORDS_PER_PAGE : null;
  const goalLabel = outline?.targetChapter
    ? capitalize(chapterTargetLabel(outline.targetChapter))
    : outline?.targetPage != null
      ? `Read to page ${outline.targetPage}`
      : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{book.title} — outline</DialogTitle>
          <DialogDescription>
            Every chapter with its word count and estimated pages (≈
            {WORDS_PER_PAGE} words per page).
          </DialogDescription>
        </DialogHeader>

        {!loaded ? (
          <p className="text-sm text-muted-foreground">Loading outline…</p>
        ) : !outline ? (
          <p className="text-sm text-muted-foreground">
            A chapter outline isn&apos;t available for this book — it&apos;s shown
            for EPUBs with a real chapter list.
          </p>
        ) : (
          <div className="min-w-0 space-y-3">
            {/* Where they are + what they're aiming for this stretch. */}
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
              <span>
                Now at{" "}
                <span className="font-medium text-foreground">
                  page {outline.currentPage}
                </span>{" "}
                of {outline.totalPages}
              </span>
              {goalLabel && (
                <span>
                  This week:{" "}
                  <span className="font-medium text-amber-700 dark:text-amber-400">
                    {goalLabel}
                  </span>
                  {goalPages != null && goalWords != null && goalPages > 0 && (
                    <>
                      {" "}
                      (~{numberFmt.format(goalPages)}{" "}
                      {goalPages === 1 ? "page" : "pages"}, ~
                      {numberFmt.format(goalWords)} words)
                    </>
                  )}
                </span>
              )}
            </div>

            <div className="max-h-[55vh] overflow-auto rounded-lg border border-border">
              <table className="w-full table-fixed text-sm">
                <colgroup>
                  <col />
                  <col className="w-20" />
                  <col className="w-24" />
                  <col className="w-16" />
                  <col className="w-20" />
                </colgroup>
                <thead className="sticky top-0 z-10 bg-muted/80 text-xs uppercase tracking-wide text-muted-foreground backdrop-blur">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Chapter</th>
                    <th className="px-3 py-2 text-right font-medium">Words</th>
                    <th className="px-3 py-2 text-right font-medium">
                      Total words
                    </th>
                    <th className="px-3 py-2 text-right font-medium">Pages</th>
                    <th className="px-3 py-2 text-right font-medium">
                      Total pages
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {outline.chapters.map((c) => (
                    <tr
                      key={c.index}
                      className={cn(
                        "border-t border-border/60",
                        c.read && "text-muted-foreground",
                        c.current && "bg-foreground/5 font-medium text-foreground",
                        c.goal && "bg-amber-500/10"
                      )}
                    >
                      <td className="px-3 py-2 align-top">
                        <span className="break-words">
                          {chapterDisplayName(c.title)}
                        </span>
                        {c.current && (
                          <Badge
                            variant="outline"
                            className="ml-2 align-middle"
                          >
                            Here now
                          </Badge>
                        )}
                        {c.goal && (
                          <Badge
                            variant="outline"
                            className="ml-2 align-middle border-amber-500/50 text-amber-700 dark:text-amber-400"
                          >
                            Goal
                          </Badge>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right align-top tabular-nums">
                        {numberFmt.format(c.words)}
                      </td>
                      <td className="px-3 py-2 text-right align-top tabular-nums">
                        {numberFmt.format(c.cumulativeWords)}
                      </td>
                      <td className="px-3 py-2 text-right align-top tabular-nums">
                        {numberFmt.format(c.pages)}
                      </td>
                      <td className="px-3 py-2 text-right align-top tabular-nums">
                        {numberFmt.format(c.endPage)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** "Chapter 8" from a bare "8"; leaves named sections ("Prologue") untouched. */
function chapterDisplayName(title: string): string {
  const t = title.trim();
  return /^\d{1,3}$/.test(t) ? `Chapter ${t}` : t;
}

function ActiveQuizCard({
  quiz,
  book,
  memberEmail,
}: {
  quiz: ReadingAdminQuiz;
  book: ReadingAdminBook;
  memberEmail: string;
}) {
  const attempted = quiz.attempts.length > 0;
  const cover = quizCoverageLabel(book, quiz.fromPage, quiz.throughPage);
  return (
    <div className="rounded-lg border border-border bg-muted/20 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className={cn("text-sm text-foreground", !cover.isChapter && "capitalize")}>
          {cover.text}
        </p>
        {attempted ? (
          <Badge variant="outline" className="border-amber-500/50 text-amber-700 dark:text-amber-400">
            In progress · needs revision
          </Badge>
        ) : (
          <Badge variant="outline">Awaiting submission</Badge>
        )}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {attempted
          ? `${quiz.attempts.length} ${quiz.attempts.length === 1 ? "attempt" : "attempts"} so far`
          : "Not started yet"}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Link
          href={quizResultsHref(quiz.id, memberEmail)}
          className={cn(buttonVariants({ variant: "default", size: "sm" }))}
        >
          View quiz
        </Link>
        {/* Curate/steer the question while the kid hasn't started (unlocked). */}
        {!attempted && (
          <Link
            href={quizEditHref(quiz.id, memberEmail)}
            className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
          >
            Steer question
          </Link>
        )}
        <GenerateDraftButton
          bookId={book.bookId}
          memberEmail={memberEmail}
          fromPage={quiz.fromPage}
          throughPage={quiz.throughPage}
          label="Regenerate"
          regenerate
        />
        <CloseQuizButton
          quizId={quiz.id}
          memberEmail={memberEmail}
          variant="ghost"
        />
        <DeleteQuizButton quizId={quiz.id} memberEmail={memberEmail} />
      </div>
    </div>
  );
}

function DraftCard({
  quiz,
  book,
  memberEmail,
}: {
  quiz: ReadingAdminQuiz;
  book: ReadingAdminBook;
  memberEmail: string;
}) {
  const cover = quizCoverageLabel(book, quiz.fromPage, quiz.throughPage);
  return (
    <div className="rounded-lg border border-dashed border-border px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className={cn("text-sm text-foreground", !cover.isChapter && "capitalize")}>
          {cover.text}
        </p>
        <Badge variant="secondary">Draft — not published</Badge>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Review and publish it to make it the live quiz (this replaces any current
        one).
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Link
          href={quizEditHref(quiz.id, memberEmail)}
          className={cn(buttonVariants({ variant: "default", size: "sm" }))}
        >
          Review draft
        </Link>
        <DeleteQuizButton quizId={quiz.id} memberEmail={memberEmail} />
      </div>
    </div>
  );
}

function historyLabel(quiz: ReadingAdminQuiz): string {
  if (quiz.closedByParent) return "Closed by parent";
  if (quiz.passed) return "Passed";
  if (quiz.status === "archived") return "Replaced";
  if (quiz.status === "draft") return "Draft";
  return "—";
}
