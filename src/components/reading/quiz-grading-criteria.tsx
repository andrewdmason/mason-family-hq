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
  ESSAY_MAX_SCORE,
  ESSAY_PASS_MIN,
} from "@/lib/reading/essay-scoring";

// The three things every essay is graded on, in kid-facing language. Mirrors the
// rubric the grader scores against (lib/reading/quiz-grade.ts) and the labels on
// the feedback card (quiz-essay-feedback.tsx), so what they're told to focus on
// matches what they're actually scored on.
const CRITERIA = [
  {
    label: "Understanding the book",
    detail:
      "Start by showing you really read these pages — get the people, places, and what happens right.",
  },
  {
    label: "Grammar & writing",
    detail:
      "Spelling, punctuation, and clean sentences. Break it into more than one paragraph and capitalize names.",
  },
  {
    label: "Quality of thinking",
    detail:
      "Go past the book: develop one real idea and back it up with something specific from the story.",
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
            A teacher reads your essay and scores three things, each out of 4 — so{" "}
            {ESSAY_MAX_SCORE} points in all.
          </DialogDescription>
        </DialogHeader>

        <ul className="space-y-3">
          {CRITERIA.map(({ label, detail }) => (
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
            <span className="font-medium">To pass,</span> the three scores need to
            add up to {ESSAY_PASS_MIN} or more — a strong part can make up for a
            weaker one.
          </p>
          <p className="text-amber-800 dark:text-amber-300">
            🪙 <span className="font-medium">Score an {ESSAY_BONUS_MIN} or {ESSAY_MAX_SCORE}</span>{" "}
            and you earn {ESSAY_BONUS_BUCKS} Mason Bucks.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
