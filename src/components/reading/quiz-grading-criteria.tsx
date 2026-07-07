"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  ESSAY_BONUS_BUCKS,
  ESSAY_BONUS_MIN,
  ESSAY_EARNED_MAX,
  ESSAY_PASS_MIN,
} from "@/lib/reading/essay-scoring";

// Part 1 is a quick pass/fail check that you read the pages (a gate, not a score).
const PART_ONE = {
  label: "Quick check — did you read it?",
  detail:
    "Answer Part 1 in a sentence or two to show you read these pages. It's a simple yes/no check, not a score — easy to pass if you did the reading.",
};

// Part 2 (your real writing) is scored on these two things, each out of 4. Mirrors
// the grader (lib/reading/quiz-grade.ts) and the feedback card labels.
const SCORED_CRITERIA = [
  {
    label: "Grammar & writing",
    detail:
      "Spelling, punctuation, and clean sentences. Break it into more than one paragraph and capitalize names.",
  },
  {
    label: "Quality of thinking",
    detail:
      "Part 2 is about you: think honestly and clearly about the question, develop a real idea, and back it up.",
  },
] as const;

/**
 * The reader-facing "how you'll be graded" overview, opened from the writing
 * surface. Lays out the three rubric dimensions (each scored out of 4), the pass
 * bar, and the standout bonus — so the reader knows what to focus on before they
 * write. Renders its own trigger so it can drop straight into a sentence.
 */
export function GradingCriteriaDialog({
  triggerClassName,
}: {
  triggerClassName?: string;
}) {
  return (
    <Dialog>
      <DialogTrigger className={triggerClassName}>
        See grading criteria
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>How your essay is graded</DialogTitle>
          <DialogDescription>
            First a quick check that you read the pages, then a teacher scores your
            writing on two things, each out of 4 — {ESSAY_EARNED_MAX} points in all.
          </DialogDescription>
        </DialogHeader>

        <ul className="space-y-3">
          <li className="flex gap-3">
            <span
              className="mt-1.5 size-1.5 shrink-0 rounded-full bg-foreground/40"
              aria-hidden
            />
            <div>
              <p className="font-medium text-foreground">
                {PART_ONE.label}{" "}
                <span className="text-xs text-muted-foreground">✓ / ✗</span>
              </p>
              <p className="text-sm text-muted-foreground">{PART_ONE.detail}</p>
            </div>
          </li>
          {SCORED_CRITERIA.map(({ label, detail }) => (
            <li key={label} className="flex gap-3">
              <span
                className="mt-1.5 size-1.5 shrink-0 rounded-full bg-foreground/40"
                aria-hidden
              />
              <div>
                <p className="font-medium text-foreground">
                  {label}{" "}
                  <span className="text-xs text-muted-foreground">/ 4</span>
                </p>
                <p className="text-sm text-muted-foreground">{detail}</p>
              </div>
            </li>
          ))}
        </ul>

        <div className="space-y-2 rounded-lg border bg-muted/40 px-3 py-2.5 text-sm">
          <p className="text-foreground">
            <span className="font-medium">To pass,</span> clear the quick reading
            check and score {ESSAY_PASS_MIN} of {ESSAY_EARNED_MAX} or more on your
            writing.
          </p>
          <p className="text-amber-800 dark:text-amber-300">
            🪙{" "}
            <span className="font-medium">
              Score {ESSAY_BONUS_MIN} of {ESSAY_EARNED_MAX}
            </span>{" "}
            and you earn {ESSAY_BONUS_BUCKS} Mason Bucks.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
