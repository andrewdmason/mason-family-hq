"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  deleteQuiz,
  generateQuizDraft,
} from "@/app/(books)/books/quizzes/actions";
import { quizEditHref } from "@/lib/reading/links";

/**
 * Generate a draft quiz for a page range and drop into the editor. Used both to
 * make the first quiz for a stretch and to "regenerate" the current one (same
 * range) — publishing the new draft archives whatever was live, so this never
 * leaves two open quizzes behind.
 */
export function GenerateDraftButton({
  bookId,
  memberEmail,
  fromPage,
  throughPage,
  label,
  regenerate = false,
}: {
  bookId: string;
  memberEmail: string | null;
  fromPage: number | null;
  throughPage: number;
  label: string;
  /** Styling hint: a regenerate is a quieter secondary action. */
  regenerate?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function go() {
    setError(null);
    startTransition(async () => {
      try {
        const { quizId } = await generateQuizDraft({
          bookId,
          fromPage,
          throughPage,
          memberEmail,
        });
        router.push(quizEditHref(quizId, memberEmail));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't generate.");
      }
    });
  }

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant={regenerate ? "outline" : "default"}
        onClick={go}
        disabled={pending}
      >
        {regenerate ? (
          <RefreshCw className="h-4 w-4" />
        ) : (
          <Sparkles className="h-4 w-4" />
        )}
        {pending ? "Generating…" : label}
      </Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </>
  );
}

/** Permanently delete a quiz (and its attempts). Escape hatch; archiving is the
 * normal path. Confirms first, then refreshes the admin. */
export function DeleteQuizButton({
  quizId,
  memberEmail,
}: {
  quizId: string;
  memberEmail: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function del() {
    if (
      !window.confirm(
        "Delete this quiz for good? This also removes any attempts on it."
      )
    ) {
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        await deleteQuiz(quizId, memberEmail);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't delete.");
      }
    });
  }

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={del}
        disabled={pending}
        className="text-destructive hover:text-destructive"
      >
        <Trash2 className="h-4 w-4" />
        {pending ? "Deleting…" : "Delete"}
      </Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </>
  );
}
