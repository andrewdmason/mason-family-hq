"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { postEssayToFamilyJournal } from "@/app/(reading)/reader/quizzes/actions";

/**
 * One-tap "share this passed essay to the family journal" — the opt-in action that used
 * to live in the success modal. Creates the journal entry and navigates straight to it.
 */
export function PostEssayToJournalButton({
  quizId,
  memberEmail,
}: {
  quizId: string;
  memberEmail: string | null;
}) {
  const router = useRouter();
  const [posting, startPosting] = useTransition();
  const [posted, setPosted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handlePost() {
    setError(null);
    startPosting(async () => {
      try {
        const { entryId } = await postEssayToFamilyJournal(quizId, memberEmail);
        setPosted(true);
        router.push(`/journal/${entryId}`);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Couldn't post to the journal."
        );
      }
    });
  }

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={handlePost}
        disabled={posting || posted}
      >
        <Send className="size-4" />
        {posted
          ? "Posted to the family journal"
          : posting
            ? "Posting…"
            : "Post it to the family journal"}
      </Button>
      {error && <p className="w-full text-xs text-destructive">{error}</p>}
    </>
  );
}
