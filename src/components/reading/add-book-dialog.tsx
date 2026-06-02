"use client";

import { useState, useTransition } from "react";
import { Plus, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
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
} from "@/app/(reading)/reading/actions";
import { RatingPicker } from "@/components/reading/rating-picker";
import { READING_STATUSES, readingStatusLabel } from "@/lib/reading/status";
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
  }) {
    if (isRecommendation) {
      await recommendBook({
        recipientEmail: forWhom,
        title: meta.title,
        author: meta.author,
        totalPages: meta.totalPages,
        coverImageUrl: meta.coverImageUrl,
        note: note.trim() || null,
      });
    } else {
      await addBook({
        title: meta.title,
        author: meta.author,
        totalPages: meta.totalPages,
        status,
        coverImageUrl: meta.coverImageUrl,
        rating: status === "archive" ? rating : null,
        memberEmail,
      });
    }
  }

  // Step 1: title only. Ask the AI to fill the rest; finish straight away when
  // the AI is sure, otherwise drop into the manual details step.
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
        const found = await lookupBook(typed);
        if (found.confident) {
          await commit({
            title: found.title,
            author: found.author,
            totalPages: found.totalPages,
            coverImageUrl: found.coverImageUrl,
          });
          handleClose(false);
          return;
        }
        setTitle(found.title);
        setAuthor(found.author ?? "");
        setTotalPages(found.totalPages ? String(found.totalPages) : "");
        setCoverImageUrl(found.coverImageUrl);
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
                <Input
                  id="book-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="East of Eden"
                  autoFocus
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
