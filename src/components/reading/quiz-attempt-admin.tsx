"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RotateCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { quizResultsHref } from "@/lib/reading/links";
import {
  deleteQuizAttempt,
  resubmitLatestAttempt,
} from "@/app/(books)/books/quizzes/actions";

/**
 * Owner-only attempt controls, a parent troubleshooting tool: re-grade the most
 * recent attempt in place (handy after a rubric tweak), or delete any individual
 * try so the quiz can be rerun from a clean slate. Each action refreshes the
 * results view (dropping any ?submission= that may now point at a deleted try).
 */
export function AttemptAdminControls({
  quizId,
  memberEmail,
  attempts,
  isEssay,
}: {
  quizId: string;
  memberEmail: string | null;
  attempts: { id: string; attemptNumber: number }[];
  isEssay: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (attempts.length === 0) return null;

  function run(busyKey: string, action: () => Promise<unknown>, fail: string) {
    setError(null);
    setBusy(busyKey);
    startTransition(async () => {
      try {
        await action();
        // Land on the canonical results URL so a deleted ?submission= can't linger.
        router.push(quizResultsHref(quizId, memberEmail));
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : fail);
      } finally {
        setBusy(null);
      }
    });
  }

  return (
    <div className="mt-3 rounded-lg border border-dashed border-border/70 px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Parent tools
        </span>
        {isEssay && (
          <Button
            type="button"
            size="xs"
            variant="outline"
            disabled={pending}
            onClick={() => {
              if (
                !window.confirm(
                  "Re-grade the most recent attempt? It reruns grading on the latest essay in place."
                )
              ) {
                return;
              }
              run(
                "resubmit",
                () => resubmitLatestAttempt(quizId, memberEmail),
                "Couldn't re-grade that attempt."
              );
            }}
          >
            <RotateCw />
            {busy === "resubmit" ? "Re-grading…" : "Re-grade latest"}
          </Button>
        )}
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {attempts.map((a) => (
          <Button
            key={a.id}
            type="button"
            size="xs"
            variant="ghost"
            disabled={pending}
            className="text-muted-foreground hover:text-destructive"
            onClick={() => {
              if (
                !window.confirm(
                  `Delete attempt ${a.attemptNumber}? This permanently removes that try and its grade.`
                )
              ) {
                return;
              }
              run(
                a.id,
                () => deleteQuizAttempt(quizId, a.id, memberEmail),
                "Couldn't delete that attempt."
              );
            }}
          >
            <Trash2 />
            {busy === a.id ? "Deleting…" : `Try ${a.attemptNumber}`}
          </Button>
        ))}
      </div>

      {error && <p className="mt-1.5 text-xs text-destructive">{error}</p>}
    </div>
  );
}
