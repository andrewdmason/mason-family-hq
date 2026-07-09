"use client";

import { useCallback, useState, useTransition } from "react";
import { assessBook } from "@/app/(reading)/reader/discover/actions";
import type { BookAssessment } from "@/lib/reading/recommend";
import { cn } from "@/lib/utils";

/** Verdict → the label, dot, and tint used to render the assessment panel. */
const VERDICTS: Record<
  BookAssessment["verdict"],
  { label: string; text: string; dot: string; container: string }
> = {
  love: {
    label: "You'll probably love this",
    text: "text-emerald-700 dark:text-emerald-400",
    dot: "bg-emerald-500",
    container: "border-emerald-600/30 bg-emerald-600/5",
  },
  like: {
    label: "Looks like a good fit for you",
    text: "text-emerald-700 dark:text-emerald-400",
    dot: "bg-emerald-500",
    container: "border-emerald-600/30 bg-emerald-600/5",
  },
  mixed: {
    label: "Could go either way",
    text: "text-amber-700 dark:text-amber-400",
    dot: "bg-amber-500",
    container: "border-amber-500/40 bg-amber-500/5",
  },
  pass: {
    label: "Probably not your thing",
    text: "text-rose-700 dark:text-rose-400",
    dot: "bg-rose-500",
    container: "border-rose-600/30 bg-rose-600/5",
  },
};

/**
 * Runs the "will I like this?" assessment for a title against the (scoped)
 * member's taste. Owns the request state so both the add-book dialog and a queued
 * book card can drive it — pass a `memberEmail` to assess for another member.
 */
export function useAssessBook(memberEmail: string | null = null) {
  const [assessment, setAssessment] = useState<BookAssessment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const assess = useCallback(
    (title: string, author: string | null) => {
      const typed = title.trim();
      if (!typed) {
        setError("Enter a book title first.");
        return;
      }
      setError(null);
      start(async () => {
        try {
          const result = await assessBook({
            title: typed,
            author: author?.trim() || null,
            memberEmail,
          });
          if (result) {
            setAssessment(result);
            setError(null);
          } else {
            setError("Couldn't get a read on that one — try again.");
          }
        } catch (err) {
          setError(
            err instanceof Error ? err.message : "Couldn't assess the book."
          );
        }
      });
    },
    [memberEmail]
  );

  const reset = useCallback(() => {
    setAssessment(null);
    setError(null);
  }, []);

  return { assessment, error, pending, assess, reset };
}

/** The AI's verdict + reasoning, tinted by how good a fit it thinks the book is. */
export function AssessmentPanel({
  assessment,
  className,
}: {
  assessment: BookAssessment;
  className?: string;
}) {
  const v = VERDICTS[assessment.verdict];
  return (
    <div className={cn("rounded-md border px-3 py-2", v.container, className)}>
      <p className={cn("flex items-center gap-1.5 text-xs font-medium", v.text)}>
        <span className={cn("h-2 w-2 shrink-0 rounded-full", v.dot)} />
        {v.label}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">{assessment.reason}</p>
    </div>
  );
}
