"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { closeQuizWithoutPassing } from "@/app/(books)/books/quizzes/actions";

/**
 * Owner-only override: mark a published quiz complete without the kid passing it.
 * Confirms first (it advances the reader and spawns their next quiz), then refreshes
 * so the "Closed by a parent" state shows in place.
 */
export function CloseQuizButton({
  quizId,
  memberEmail = null,
  size = "sm",
  variant = "outline",
  label = "Close without passing",
  redirectTo,
}: {
  quizId: string;
  memberEmail?: string | null;
  size?: "xs" | "sm";
  variant?: "outline" | "ghost";
  label?: string;
  /** Where to go after closing; falls back to refreshing in place. */
  redirectTo?: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleClose() {
    if (
      !window.confirm(
        "Close this quiz without passing? It'll be marked complete and the reader moves on to their next stretch."
      )
    ) {
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        const result = await closeQuizWithoutPassing(quizId, memberEmail);
        if (!result.ok) {
          setError(result.message);
          return;
        }
        if (redirectTo) router.push(redirectTo);
        else router.refresh();
      } catch {
        // Server Actions mask thrown error messages in production, so an
        // unexpected failure here has nothing more specific to show.
        setError("Couldn't close this quiz — try again.");
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        type="button"
        size={size}
        variant={variant}
        onClick={handleClose}
        disabled={pending}
      >
        {pending ? "Closing…" : label}
      </Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
