"use client";

import { useState, useTransition } from "react";
import { BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { updateBook } from "@/app/(reading)/reader/actions";

/** Quick action to promote a queued/paused book to actively reading. */
export function StartReadingButton({
  bookId,
  memberEmail = null,
}: {
  bookId: string;
  memberEmail?: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState(false);

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={pending}
      title={error ? "Couldn't start — try again" : undefined}
      onClick={() =>
        startTransition(async () => {
          setError(false);
          try {
            await updateBook(bookId, { status: "in_progress", memberEmail });
          } catch {
            setError(true);
          }
        })
      }
    >
      <BookOpen />
      {pending ? "Starting…" : "Start reading"}
    </Button>
  );
}
