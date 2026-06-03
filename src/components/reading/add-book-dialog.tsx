"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Loader2, Plus, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BookCover } from "@/components/reading/book-cover";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  addBook,
  lookupBook,
  recommendBook,
} from "@/app/(reading)/reader/actions";
// The typeahead hits Open Library straight from the browser (public, CORS-enabled
// API) rather than through a server action — no extra hop, no action queueing.
import { searchBooks, type BookSearchResult } from "@/lib/reading/book-search";
import { RatingPicker } from "@/components/reading/rating-picker";
import { READING_STATUSES, readingStatusLabel } from "@/lib/reading/status";
import { cn } from "@/lib/utils";
import type { ReadingBookStatus, ReadingRating } from "@/lib/types";

const FOR_ME = "me";

export type RecommendRecipient = { email: string; name: string | null };

export function AddBookDialog({
  triggerVariant = "outline",
  triggerSize = "sm",
  memberEmail = null,
  recipients = [],
}: {
  triggerVariant?: "outline" | "default";
  triggerSize?: "sm" | "default";
  /** When set (owner view), the book is added for this member instead of self. */
  memberEmail?: string | null;
  /** Family members you can recommend to (self-view only). */
  recipients?: RecommendRecipient[];
}) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"title" | "details">("title");
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [totalPages, setTotalPages] = useState("");
  const [coverImageUrl, setCoverImageUrl] = useState<string | null>(null);
  // ISBN the AI resolved, carried into the manual-confirm step so it's still
  // stored even when the user fills in the rest by hand.
  const [aiIsbn, setAiIsbn] = useState<string | null>(null);
  // Set when the user picks a typeahead suggestion: lets submit skip the AI
  // lookup and add the chosen book straight away. Cleared on any manual edit.
  const [picked, setPicked] = useState<BookSearchResult | null>(null);
  const [status, setStatus] = useState<ReadingBookStatus>("in_progress");
  const [rating, setRating] = useState<ReadingRating | null>(null);
  const [forWhom, setForWhom] = useState<string>(FOR_ME);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const canRecommend = recipients.length > 0;
  const isRecommendation = canRecommend && forWhom !== FOR_ME;

  function reset() {
    setStep("title");
    setTitle("");
    setAuthor("");
    setTotalPages("");
    setCoverImageUrl(null);
    setAiIsbn(null);
    setPicked(null);
    setStatus("in_progress");
    setRating(null);
    setForWhom(FOR_ME);
    setNote("");
    setError(null);
  }

  function handleClose(next: boolean) {
    setOpen(next);
    if (!next) reset();
  }

  // Route the resolved/entered details to either a self-add or a recommendation.
  async function commit(meta: {
    title: string;
    author: string | null;
    totalPages: number | null;
    coverImageUrl: string | null;
    openlibraryKey?: string | null;
    isbn?: string | null;
    publishedYear?: number | null;
  }) {
    if (isRecommendation) {
      await recommendBook({
        recipientEmail: forWhom,
        title: meta.title,
        author: meta.author,
        totalPages: meta.totalPages,
        coverImageUrl: meta.coverImageUrl,
        openlibraryKey: meta.openlibraryKey ?? null,
        isbn: meta.isbn ?? null,
        publishedYear: meta.publishedYear ?? null,
        note: note.trim() || null,
      });
    } else {
      await addBook({
        title: meta.title,
        author: meta.author,
        totalPages: meta.totalPages,
        status,
        coverImageUrl: meta.coverImageUrl,
        openlibraryKey: meta.openlibraryKey ?? null,
        isbn: meta.isbn ?? null,
        publishedYear: meta.publishedYear ?? null,
        rating: status === "archive" ? rating : null,
        memberEmail,
      });
    }
  }

  // The user picked a typeahead suggestion: fill the metadata so submit can add
  // it directly, and surface the canonical title in the field.
  function handlePick(book: BookSearchResult) {
    setPicked(book);
    setTitle(book.title);
    setAuthor(book.author ?? "");
    setTotalPages(book.totalPages ? String(book.totalPages) : "");
    setCoverImageUrl(book.coverImageUrl);
    setError(null);
  }

  // Step 1: title only. If the user chose a suggestion, add it straight away.
  // Otherwise ask the AI to fill the rest — finishing when it's sure, or dropping
  // into the manual details step when it isn't.
  function handleTitleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const typed = title.trim();
    if (!typed) {
      setError("Enter a book title.");
      return;
    }
    startTransition(async () => {
      try {
        if (picked) {
          await commit({
            title: picked.title,
            author: picked.author,
            totalPages: picked.totalPages,
            coverImageUrl: picked.coverImageUrl,
            openlibraryKey: picked.key,
            isbn: picked.isbn,
            publishedYear: picked.year,
          });
          handleClose(false);
          return;
        }
        const found = await lookupBook(typed);
        if (found.confident) {
          await commit({
            title: found.title,
            author: found.author,
            totalPages: found.totalPages,
            coverImageUrl: found.coverImageUrl,
            isbn: found.isbn,
          });
          handleClose(false);
          return;
        }
        setTitle(found.title);
        setAuthor(found.author ?? "");
        setTotalPages(found.totalPages ? String(found.totalPages) : "");
        setCoverImageUrl(found.coverImageUrl);
        setAiIsbn(found.isbn);
        setStep("details");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't add the book.");
      }
    });
  }

  // Step 2 (fallback): the user fills everything in by hand.
  function handleDetailsSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        await commit({
          title,
          author,
          totalPages: totalPages ? Number(totalPages) : null,
          coverImageUrl,
          isbn: aiIsbn,
        });
        handleClose(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't add the book.");
      }
    });
  }

  const submitLabel = isRecommendation ? "Recommend book" : "Add book";

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogTrigger
        render={
          <Button variant={triggerVariant} size={triggerSize}>
            <Plus />
            Add a book
          </Button>
        }
      />
      <DialogContent>
        {step === "title" ? (
          <>
            <DialogHeader>
              <DialogTitle>Add a book</DialogTitle>
              <DialogDescription>
                Just type the title — we&apos;ll look up the author, length, and
                cover for you.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleTitleSubmit} className="grid gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="book-title">Title</Label>
                <BookTitleAutocomplete
                  value={title}
                  onChange={(v) => {
                    setTitle(v);
                    setPicked(null);
                  }}
                  onPick={handlePick}
                />
              </div>
              {canRecommend && (
                <ForField
                  value={forWhom}
                  recipients={recipients}
                  onChange={setForWhom}
                />
              )}
              {isRecommendation ? (
                <NoteField value={note} onChange={setNote} />
              ) : (
                <>
                  <StatusField value={status} onChange={setStatus} />
                  {status === "archive" && (
                    <RatingField value={rating} onChange={setRating} />
                  )}
                </>
              )}
              {error && <p className="text-sm text-destructive">{error}</p>}
              <DialogFooter showCloseButton>
                <Button type="submit" disabled={pending}>
                  {pending ? (
                    <>
                      <Sparkles className="animate-pulse" />
                      Looking up…
                    </>
                  ) : (
                    submitLabel
                  )}
                </Button>
              </DialogFooter>
            </form>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Confirm the details</DialogTitle>
              <DialogDescription>
                We weren&apos;t sure which book that was — fill in the details and
                add it.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleDetailsSubmit} className="grid gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="book-title-2">Title</Label>
                <Input
                  id="book-title-2"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  autoFocus
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="book-author">Author</Label>
                <Input
                  id="book-author"
                  value={author}
                  onChange={(e) => setAuthor(e.target.value)}
                  placeholder="John Steinbeck"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="book-total">Total pages</Label>
                <Input
                  id="book-total"
                  type="number"
                  min={1}
                  value={totalPages}
                  onChange={(e) => setTotalPages(e.target.value)}
                  placeholder="601"
                />
              </div>
              {canRecommend && (
                <ForField
                  value={forWhom}
                  recipients={recipients}
                  onChange={setForWhom}
                />
              )}
              {isRecommendation ? (
                <NoteField value={note} onChange={setNote} />
              ) : (
                <>
                  <StatusField value={status} onChange={setStatus} />
                  {status === "archive" && (
                    <RatingField value={rating} onChange={setRating} />
                  )}
                </>
              )}
              {error && <p className="text-sm text-destructive">{error}</p>}
              <DialogFooter showCloseButton>
                <Button type="submit" disabled={pending}>
                  {pending ? "Adding…" : submitLabel}
                </Button>
              </DialogFooter>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ForField({
  value,
  recipients,
  onChange,
}: {
  value: string;
  recipients: RecommendRecipient[];
  onChange: (value: string) => void;
}) {
  const selected = recipients.find((r) => r.email === value);
  return (
    <div className="grid gap-1.5">
      <Label htmlFor="book-for">For</Label>
      <Select value={value} onValueChange={(v) => onChange(v ?? FOR_ME)}>
        <SelectTrigger id="book-for" className="w-full">
          <SelectValue>
            {value === FOR_ME ? "Me" : selected?.name ?? value}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={FOR_ME}>Me</SelectItem>
          {recipients.map((r) => (
            <SelectItem key={r.email} value={r.email}>
              {r.name ?? r.email}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function NoteField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor="book-note">Note (optional)</Label>
      <Textarea
        id="book-note"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Why you think they'd like it…"
        rows={3}
      />
      <p className="text-xs text-muted-foreground">
        Goes to their queue with your recommendation.
      </p>
    </div>
  );
}

function RatingField({
  value,
  onChange,
}: {
  value: ReadingRating | null;
  onChange: (value: ReadingRating) => void;
}) {
  return (
    <div className="grid gap-1.5">
      <Label>How was it?</Label>
      <RatingPicker value={value} onSelect={onChange} />
    </div>
  );
}

/**
 * Title input with a live Open Library typeahead. Debounces keystrokes, shows
 * matching books (cover, author, year, length), and calls `onPick` when one is
 * chosen so the parent can add it without an AI lookup. Falls back gracefully:
 * an empty result set just shows no dropdown, and the user can still submit the
 * raw text to run the AI lookup.
 */
function BookTitleAutocomplete({
  value,
  onChange,
  onPick,
}: {
  value: string;
  onChange: (value: string) => void;
  onPick: (book: BookSearchResult) => void;
}) {
  const [results, setResults] = useState<BookSearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(-1);
  // Suppress the search that the onChange from a pick would otherwise trigger.
  const skipNext = useRef(false);

  useEffect(() => {
    if (skipNext.current) {
      skipNext.current = false;
      return;
    }
    const q = value.trim();
    if (q.length < 2) {
      setResults([]);
      setOpen(false);
      setLoading(false);
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const found = await searchBooks(q, 6, controller.signal);
        if (cancelled) return;
        setResults(found);
        setOpen(found.length > 0);
        setActive(-1);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timer);
    };
  }, [value]);

  function pick(book: BookSearchResult) {
    skipNext.current = true;
    onPick(book);
    setOpen(false);
    setResults([]);
    setActive(-1);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || results.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % results.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i - 1 + results.length) % results.length);
    } else if (e.key === "Enter" && active >= 0) {
      // Choose the highlighted result instead of submitting the form.
      e.preventDefault();
      pick(results[active]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div className="relative">
      <Input
        id="book-title"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={() => results.length > 0 && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="East of Eden"
        autoFocus
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
      />
      {loading && (
        <Loader2 className="absolute right-2.5 top-2.5 h-4 w-4 animate-spin text-muted-foreground" />
      )}
      {open && results.length > 0 && (
        <ul className="absolute z-50 mt-1 max-h-72 w-full overflow-auto rounded-md border bg-popover p-1 shadow-md">
          {results.map((book, i) => (
            <li key={book.key}>
              <button
                type="button"
                // onMouseDown (not onClick) so it fires before the input's blur.
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(book);
                }}
                onMouseEnter={() => setActive(i)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-sm px-2 py-1.5 text-left",
                  i === active && "bg-accent"
                )}
              >
                <BookCover url={book.coverThumbUrl} title={book.title} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {book.title}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {[book.author, book.year, book.totalPages && `${book.totalPages} pp`]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function StatusField({
  value,
  onChange,
}: {
  value: ReadingBookStatus;
  onChange: (value: ReadingBookStatus) => void;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor="book-status">Status</Label>
      <Select
        value={value}
        onValueChange={(v) => onChange(v as ReadingBookStatus)}
      >
        <SelectTrigger id="book-status" className="w-full">
          <SelectValue>{readingStatusLabel(value)}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {READING_STATUSES.map((s) => (
            <SelectItem key={s.value} value={s.value}>
              {s.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
