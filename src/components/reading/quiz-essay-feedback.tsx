import { CheckCircle2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  ESSAY_BONUS_BUCKS,
  ESSAY_BONUS_MIN,
  ESSAY_MAX_SCORE,
  essayTotalScore,
} from "@/lib/reading/essay-scoring";
import type { EssayRubricScores, ReadingEssayFeedback } from "@/lib/types";

const ESSAY_DIMENSIONS = [
  { key: "comprehension", label: "Understanding the book" },
  { key: "mechanics", label: "Grammar & writing" },
  { key: "thinking", label: "Quality of thinking" },
] as const;

/**
 * The tutor's grade, as a self-contained card — a tinted header band carrying the
 * verdict (the "grade"), then the warm note and the three rubric scores. Set apart
 * from the surrounding prose so it reads like a marked-up paper handed back. Shown
 * at the top of the feedback page, and again on the writing page during a revision
 * so the last round of feedback stays in view.
 */
export function EssayGradeCard({
  feedback,
  heading = "The tutor's notes",
  className,
}: {
  feedback: ReadingEssayFeedback;
  heading?: string;
  className?: string;
}) {
  const { rubricScores, aiNotes, passed, gradingComplete } = feedback;
  const total = essayTotalScore(rubricScores);
  const earnedBonus = passed && total != null && total >= ESSAY_BONUS_MIN;
  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border border-border shadow-sm",
        className
      )}
    >
      <div
        className={cn(
          "flex items-center gap-3 px-5 py-3.5",
          passed ? "bg-emerald-600/10" : "bg-amber-500/10"
        )}
      >
        {passed ? (
          <CheckCircle2
            className="size-5 shrink-0 text-emerald-700 dark:text-emerald-400"
            aria-hidden
          />
        ) : (
          <RefreshCw className="size-5 shrink-0 text-amber-600" aria-hidden />
        )}
        <div>
          <p className="font-serif text-[0.7rem] uppercase tracking-[0.15em] text-muted-foreground">
            {heading}
          </p>
          <p
            className={cn(
              "font-serif text-lg leading-tight",
              passed
                ? "text-emerald-800 dark:text-emerald-300"
                : "text-foreground"
            )}
          >
            {passed
              ? "Meets the standard."
              : "Not there yet — revise and resubmit."}
          </p>
        </div>
        {total != null && (
          <span
            className={cn(
              "ml-auto shrink-0 font-serif text-lg tabular-nums",
              passed
                ? "text-emerald-800 dark:text-emerald-300"
                : "text-foreground"
            )}
          >
            {total}
            <span className="text-xs text-muted-foreground/60">
              /{ESSAY_MAX_SCORE}
            </span>
          </span>
        )}
      </div>

      {earnedBonus && (
        <p className="flex items-center gap-2 border-b border-border bg-amber-500/10 px-5 py-2.5 text-sm font-medium text-amber-800 dark:text-amber-300">
          🪙 Standout essay — you earned {ESSAY_BONUS_BUCKS} Mason Bucks!
        </p>
      )}

      <div className="space-y-4 bg-card px-5 py-4">
        {!gradingComplete && (
          <p className="text-sm text-muted-foreground">
            Some of this couldn&apos;t be graded automatically.
          </p>
        )}
        {aiNotes && (
          <p className="font-serif text-base leading-relaxed text-foreground">
            {aiNotes}
          </p>
        )}
        {rubricScores && (
          <dl className="space-y-3 border-t border-border/60 pt-4">
            {ESSAY_DIMENSIONS.map(({ key, label }) => {
              const dim = rubricScores[key];
              const score = dim?.score ?? null;
              const meets = score != null && score >= 3;
              return (
                <div key={key} className="flex items-baseline gap-3">
                  <span
                    className={cn(
                      "w-10 shrink-0 font-serif text-lg tabular-nums",
                      score == null
                        ? "text-muted-foreground"
                        : meets
                          ? "text-emerald-700 dark:text-emerald-400"
                          : "text-amber-600"
                    )}
                  >
                    {score ?? "—"}
                    <span className="text-xs text-muted-foreground/60">/4</span>
                  </span>
                  <div>
                    <dt className="font-serif text-sm text-foreground">{label}</dt>
                    {dim?.note && (
                      <dd className="mt-0.5 text-sm leading-relaxed text-muted-foreground">
                        {dim.note}
                      </dd>
                    )}
                    {/* Mechanics gets a concrete fix-it checklist the child can
                        follow line by line; the other dimensions stay coaching. */}
                    {dim?.fixes && dim.fixes.length > 0 && (
                      <dd className="mt-1.5">
                        <ul className="list-disc space-y-1 pl-5 text-sm leading-relaxed text-muted-foreground">
                          {dim.fixes.map((fix, i) => (
                            <li key={i}>{fix}</li>
                          ))}
                        </ul>
                      </dd>
                    )}
                  </div>
                </div>
              );
            })}
          </dl>
        )}
      </div>
    </div>
  );
}

/**
 * The essay feedback view — a continuation of the writing surface's doc aesthetic.
 * The grade card sits up top, set apart like a returned paper; below it the prompt
 * reads as the journal-style italic question and the essay flows as serif prose.
 */
export function EssayFeedback({
  prompt,
  essay,
  rubricScores,
  aiNotes,
  attempted,
  closedByParent,
  viewedPassed,
  gradingComplete,
  showCard = true,
}: {
  prompt: string;
  /** The reader's written essay (null when not attempted / closed by a parent). */
  essay: string | null;
  rubricScores: EssayRubricScores | null;
  aiNotes: string | null;
  /** False before the reader has taken it. */
  attempted: boolean;
  /** True when a parent marked it complete without a written essay. */
  closedByParent: boolean;
  /** True when the viewed attempt met the standard. */
  viewedPassed: boolean;
  /** False when the AI grade didn't land. */
  gradingComplete: boolean;
  /** Render the grade card inline above the essay. Off when the page lifts the card
   *  into an anchored sidebar so it rides alongside the essay instead. */
  showCard?: boolean;
}) {
  return (
    <div className="flex-1">
      {showCard && attempted && !closedByParent && (
        <EssayGradeCard
          feedback={{
            rubricScores,
            aiNotes,
            passed: viewedPassed,
            gradingComplete,
          }}
          className="mb-10"
        />
      )}

      {/* The prompt, shown the same way the writing page shows it. */}
      <div className="border-l-2 border-muted pl-6 font-serif text-lg italic leading-relaxed text-muted-foreground">
        {prompt}
      </div>

      {!attempted ? (
        <p className="mt-8 font-serif text-lg italic leading-relaxed text-muted-foreground/70">
          Not started yet.
        </p>
      ) : closedByParent ? (
        <p className="mt-8 font-serif text-lg italic leading-relaxed text-muted-foreground/70">
          A parent marked this complete without a written essay.
        </p>
      ) : (
        <div className="mt-8 whitespace-pre-wrap font-serif text-lg leading-relaxed text-foreground">
          {essay?.trim() || (
            <span className="italic text-muted-foreground/70">(left blank)</span>
          )}
        </div>
      )}
    </div>
  );
}
