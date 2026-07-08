import { CheckCircle2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { ESSAY_BONUS_BUCKS, essayExceeded } from "@/lib/reading/essay-scoring";
import { THINKING_BANDS } from "@/components/reading/essay-criteria";
import type { EssayRubricScores, ReadingEssayFeedback } from "@/lib/types";

/** The heading over the tutor's do-this bullets, tuned to the band. */
const NEXT_HEADING: Record<string, string> = {
  below: "What a stronger essay needs",
  meets: "Push it further for the bonus",
  exceeds: "What made this land",
};

/**
 * The tutor's grade, as a self-contained card — a tinted header band carrying the
 * verdict, then the warm note, the readability (grammar) gate with its cleanup list,
 * and the quality-of-thinking band with the tutor's directions. Set apart from the
 * surrounding prose so it reads like a marked-up paper handed back. Shown at the top of
 * the feedback page, and again on the writing page during a revision so the last round
 * of feedback stays in view.
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
  const exceeded = passed && essayExceeded(rubricScores);
  const band = rubricScores?.thinking.band ?? null;
  const bandInfo = band ? THINKING_BANDS[band] : null;
  const verdict = !passed
    ? "Not there yet — revise and turn it in again."
    : bandInfo?.verdict ?? "Meets the standard.";
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
            {verdict}
          </p>
        </div>
      </div>

      {exceeded && (
        <p className="flex items-center gap-2 border-b border-border bg-amber-500/10 px-5 py-2.5 text-sm font-medium text-amber-800 dark:text-amber-300">
          🪙 Standout essay — you earned {ESSAY_BONUS_BUCKS} Mason Bucks!
        </p>
      )}

      <div className="space-y-4 bg-card px-5 py-4">
        {!gradingComplete && (
          <p className="text-sm text-muted-foreground">
            This couldn&apos;t be graded automatically — try turning it in again.
          </p>
        )}
        {aiNotes && (
          <p className="font-serif text-base leading-relaxed text-foreground">
            {aiNotes}
          </p>
        )}
        {rubricScores && (
          <dl className="space-y-4 border-t border-border/60 pt-4">
            <GrammarRow grammar={rubricScores.grammar} />
            <ThinkingRow thinking={rubricScores.thinking} />
          </dl>
        )}
      </div>
    </div>
  );
}

/** The pass/fail readability gate, with its concrete cleanup checklist. */
function GrammarRow({ grammar }: { grammar: EssayRubricScores["grammar"] }) {
  const met = grammar.met;
  return (
    <div className="flex items-baseline gap-3">
      <span
        className={cn(
          "w-10 shrink-0 font-serif text-lg",
          met === true
            ? "text-emerald-700 dark:text-emerald-400"
            : met === false
              ? "text-amber-600"
              : "text-muted-foreground"
        )}
      >
        {met === true ? "✓" : met === false ? "✗" : "—"}
      </span>
      <div>
        <dt className="font-serif text-sm text-foreground">
          Writing is easy to read
        </dt>
        {met === false && (
          <dd className="mt-0.5 text-sm leading-relaxed text-muted-foreground">
            Clean these up so it reads smoothly, then turn it in again.
          </dd>
        )}
        {grammar.fixes && grammar.fixes.length > 0 && (
          <dd className="mt-1.5">
            <ul className="list-disc space-y-1 pl-5 text-sm leading-relaxed text-muted-foreground">
              {grammar.fixes.map((fix, i) => (
                <li key={i}>{fix}</li>
              ))}
            </ul>
          </dd>
        )}
      </div>
    </div>
  );
}

/** The one graded dimension — quality of thinking — as a band + the tutor's directions. */
function ThinkingRow({
  thinking,
}: {
  thinking: EssayRubricScores["thinking"];
}) {
  const band = thinking.band;
  const info = band ? THINKING_BANDS[band] : null;
  return (
    <div className="flex items-baseline gap-3">
      <span
        className={cn(
          "w-10 shrink-0 font-serif text-lg",
          band == null
            ? "text-muted-foreground"
            : band === "below"
              ? "text-amber-600"
              : "text-emerald-700 dark:text-emerald-400"
        )}
        aria-hidden
      >
        {band == null ? "—" : band === "below" ? "○" : band === "meets" ? "◑" : "●"}
      </span>
      <div>
        <dt className="font-serif text-sm text-foreground">
          Quality of thinking
          {info && (
            <span
              className={cn(
                "ml-2 rounded-full px-2 py-0.5 text-xs font-medium",
                band === "below"
                  ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
                  : "bg-emerald-600/15 text-emerald-800 dark:text-emerald-300"
              )}
            >
              {info.label}
            </span>
          )}
        </dt>
        {thinking.note && (
          <dd className="mt-0.5 text-sm leading-relaxed text-muted-foreground">
            {thinking.note}
          </dd>
        )}
        {thinking.next && thinking.next.length > 0 && (
          <dd className="mt-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground/80">
              {NEXT_HEADING[band ?? "below"] ?? "Try this next"}
            </p>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-sm leading-relaxed text-muted-foreground">
              {thinking.next.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          </dd>
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
