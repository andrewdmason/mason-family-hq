"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { clearComprehensionGate } from "@/app/(books)/books/quizzes/actions";

/**
 * Adult-only override: open the essay for a reader stuck on the Part 1 check — a
 * mis-grade, or a prompt that turned on a detail they legitimately missed. Confirms
 * first (it also locks the question from further steering), then refreshes in place.
 */
export function ClearGateButton({
  quizId,
  memberEmail = null,
  size = "sm",
  variant = "outline",
}: {
  quizId: string;
  memberEmail?: string | null;
  size?: "xs" | "sm";
  variant?: "outline" | "ghost";
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleClear() {
    if (
      !window.confirm(
        "Let them past Part 1? The essay opens for them without answering the check, and the question can no longer be changed."
      )
    ) {
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        const result = await clearComprehensionGate(quizId, memberEmail);
        if (!result.ok) {
          setError(result.message);
          return;
        }
        router.refresh();
      } catch {
        // Server Actions mask thrown error messages in production.
        setError("Couldn't open the essay — try again.");
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        type="button"
        size={size}
        variant={variant}
        onClick={handleClear}
        disabled={pending}
      >
        {pending ? "Opening…" : "Let them past Part 1"}
      </Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
