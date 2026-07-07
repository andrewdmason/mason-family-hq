"use client";

import {
  type ReactNode,
  useMemo,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { submitQuiz } from "@/app/(reading)/reader/quizzes/actions";
import { EssayEditor } from "@/components/reading/essay-editor";
import { EssayGradeCard } from "@/components/reading/quiz-essay-feedback";
import { GradingCriteriaDialog } from "@/components/reading/quiz-grading-criteria";
import {
  ESSAY_BONUS_BUCKS,
  ESSAY_BONUS_MIN,
  ESSAY_EARNED_MAX,
} from "@/lib/reading/essay-scoring";
import { quizResultsHref } from "@/lib/reading/links";
import { quizRangeLabel } from "@/lib/reading/quiz-format";
import { cn } from "@/lib/utils";
import type {
  ReadingEssayFeedback,
  ReadingQuizQuestion,
  ReadingQuizWithQuestions,
} from "@/lib/types";

/** Default floor when a quiz predates the per-reader essay_min_words setting. */
const DEFAULT_MIN_WORDS = 150;

function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

/**
 * The reader takes a published quiz. New quizzes are a single longform essay — one
 * flowing prompt with a word floor and pasting disabled (so the writing is their
 * own). Legacy multiple-choice / short-answer quizzes still render the per-question
 * form. Submitting auto-grades and routes to the results page with full feedback.
 */
export function QuizRunner({
  quiz,
  memberEmail = null,
  retake = false,
  priorEssay = null,
  priorComprehension = null,
  priorFeedback = null,
  allowPaste = false,
  ownerSlot = null,
}: {
  quiz: ReadingQuizWithQuestions;
  memberEmail?: string | null;
  /** True when this is a retake (a fresh try at the essay / the missed questions). */
  retake?: boolean;
  /** The reader's prior Part 2 essay, so a revision opens with it instead of blank. */
  priorEssay?: string | null;
  /** The reader's prior Part 1 answer, so a revision pre-fills it too. */
  priorComprehension?: string | null;
  /** The prior attempt's grade + notes, kept on screen while they revise. */
  priorFeedback?: ReadingEssayFeedback | null;
  /** Allow pasting into the essay (owner/parent testing); kids must type. */
  allowPaste?: boolean;
  /** Owner-only controls (e.g. close without passing), shown in the header. */
  ownerSlot?: ReactNode;
}) {
  // An essay quiz is all-essay questions; anything else is the legacy form. The kid
  // always writes exactly one question — the parent-curated / auto-default chosen
  // one (no kid-facing chooser); fall back to the first candidate for safety.
  const isEssay =
    quiz.questions.length > 0 &&
    quiz.questions.every((q) => q.type === "essay");

  if (isEssay) {
    const chosen =
      quiz.questions.find((q) => q.id === quiz.chosen_question_id) ??
      quiz.questions[0];
    return (
      <EssayRunner
        quiz={quiz}
        essay={chosen}
        memberEmail={memberEmail}
        priorEssay={priorEssay}
        priorComprehension={priorComprehension}
        priorFeedback={priorFeedback}
        allowPaste={allowPaste}
        ownerSlot={ownerSlot}
      />
    );
  }

  return (
    <LegacyRunner
      quiz={quiz}
      memberEmail={memberEmail}
      retake={retake}
      ownerSlot={ownerSlot}
    />
  );
}

function EssayRunner({
  quiz,
  essay,
  memberEmail,
  priorEssay,
  priorComprehension,
  priorFeedback,
  allowPaste,
  ownerSlot,
}: {
  quiz: ReadingQuizWithQuestions;
  essay: ReadingQuizQuestion;
  memberEmail: string | null;
  priorEssay: string | null;
  priorComprehension: string | null;
  priorFeedback: ReadingEssayFeedback | null;
  allowPaste: boolean;
  ownerSlot: ReactNode;
}) {
  const router = useRouter();
  // A revision opens with the prior draft so the reader edits rather than retypes.
  const isRevision = priorEssay != null;
  // When there's a prior grade to show, the writing page becomes two columns so the
  // feedback can ride alongside the draft instead of scrolling away above it.
  const hasSidebar = priorFeedback != null;

  // Autosave the in-progress essay to localStorage so a refresh or accidental
  // navigation doesn't lose 20+ minutes of writing. Keyed per quiz, restored
  // straight into initial state (so there's no flash), and cleared on a successful
  // turn-in. The textarea suppresses the hydration warning since a restored draft
  // legitimately differs from the server-rendered empty value.
  const storageKey = `reading-essay-draft:${quiz.id}:${essay.id}`;
  const [text, setText] = useState(() => {
    if (typeof window === "undefined") return priorEssay ?? "";
    try {
      return window.localStorage.getItem(storageKey) ?? priorEssay ?? "";
    } catch {
      return priorEssay ?? "";
    }
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function updateText(value: string) {
    setText(value);
    try {
      window.localStorage.setItem(storageKey, value);
    } catch {
      // Ignore storage write failures (quota, private mode).
    }
  }

  // Part 1 (comprehension) is a short, separate answer with its own autosave key.
  const comprehensionKey = `reading-essay-part1:${quiz.id}:${essay.id}`;
  const [comprehension, setComprehension] = useState(() => {
    if (typeof window === "undefined") return priorComprehension ?? "";
    try {
      return (
        window.localStorage.getItem(comprehensionKey) ??
        priorComprehension ??
        ""
      );
    } catch {
      return priorComprehension ?? "";
    }
  });

  function updateComprehension(value: string) {
    setComprehension(value);
    try {
      window.localStorage.setItem(comprehensionKey, value);
    } catch {
      // Ignore storage write failures.
    }
  }

  const hasPartOne = !!essay.comprehension_prompt;
  // The word floor applies to Part 2 only — Part 1 stays deliberately short.
  const minWords = essay.min_words ?? DEFAULT_MIN_WORDS;
  const words = useMemo(() => countWords(text), [text]);
  const enough = words >= minWords;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!enough) return;
    // Soft nudge (not a hard block): if Part 1 is blank they'll fail the reading
    // gate, so give them a chance to notice before spending an attempt.
    if (
      hasPartOne &&
      !comprehension.trim() &&
      !window.confirm(
        "You haven't answered Part 1 — that's the quick bit that shows you read the pages. Turn in anyway?"
      )
    ) {
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        const res = await submitQuiz(
          quiz.id,
          [
            {
              questionId: essay.id,
              responseText: text,
              comprehensionText: comprehension,
            },
          ],
          memberEmail
        );
        // Turned in successfully — the saved drafts are no longer needed.
        try {
          window.localStorage.removeItem(storageKey);
          window.localStorage.removeItem(comprehensionKey);
        } catch {
          // Ignore storage failures.
        }
        if (res.passed) {
          // Met the bar — on to the results/celebration view.
          router.push(
            quizResultsHref(quiz.id, memberEmail, res.reachedMilestone)
          );
        } else {
          // Not there yet — keep them right here in the editor with their draft
          // intact, rather than bouncing to a results page they'd have to leave via
          // a "Revise essay" button. Refreshing pulls the just-graded feedback into
          // the sidebar; scroll up so it's the first thing they see.
          router.refresh();
          if (typeof window !== "undefined") {
            window.scrollTo({ top: 0, behavior: "smooth" });
          }
        }
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Couldn't submit your essay."
        );
      }
    });
  }

  return (
    <main
      className={cn(
        "mx-auto flex w-full flex-1 px-6 pb-28 pt-12",
        hasSidebar
          ? "max-w-6xl flex-col gap-10 lg:flex-row lg:items-start lg:gap-12"
          : "max-w-2xl flex-col"
      )}
    >
      {/* Revising: the last round of feedback stays in view while they rework the
          essay. On wide screens it's an anchored, independently scrollable rail
          (sticky below the header); on narrow screens it stacks above the writing. */}
      {hasSidebar && (
        <aside className="order-first w-full shrink-0 lg:order-last lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:w-80 lg:overflow-y-auto lg:overscroll-contain xl:w-96">
          <EssayGradeCard
            feedback={priorFeedback}
            heading="Last round of feedback"
          />
        </aside>
      )}

      <div
        className={cn(
          "flex w-full flex-1 flex-col",
          hasSidebar && "lg:max-w-2xl"
        )}
      >
        <header className="mb-8">
          <p className="font-serif text-sm text-muted-foreground">
            {isRevision ? "Your revision" : "Writing assignment"}
          </p>
          <h1 className="mt-1 font-serif text-3xl tracking-tight text-foreground">
            {quiz.title ||
              `On ${quizRangeLabel(quiz.from_page, quiz.through_page)}`}
          </h1>
          <p className="mt-3 text-sm text-muted-foreground">
            <GradingCriteriaDialog triggerClassName="font-medium text-foreground underline underline-offset-2 hover:text-foreground/80" />
            . Score {ESSAY_BONUS_MIN} of {ESSAY_EARNED_MAX} on your writing to earn{" "}
            {ESSAY_BONUS_BUCKS} Mason Bucks.
          </p>
        </header>

        <form onSubmit={handleSubmit} className="flex flex-1 flex-col">
          {hasPartOne && (
            <div className="mb-10">
              <p className="font-serif text-xs uppercase tracking-wide text-muted-foreground">
                Part 1 · Quick check
              </p>
              <div className="mt-2 border-l-2 border-muted pl-6 font-serif text-lg italic leading-relaxed text-muted-foreground">
                {essay.comprehension_prompt}
              </div>
              <Label htmlFor="comprehension-answer" className="sr-only">
                Part 1 answer
              </Label>
              <Textarea
                id="comprehension-answer"
                placeholder="A sentence or two to show you read it…"
                value={comprehension}
                onChange={(e) => updateComprehension(e.target.value)}
                disabled={pending}
                rows={2}
                className="mt-3"
              />
            </div>
          )}

          {hasPartOne && (
            <p className="font-serif text-xs uppercase tracking-wide text-muted-foreground">
              Part 2 · Your writing
            </p>
          )}
          {/* The prompt reads like the journal's question: italic, set off by a
              quiet left rule, with the writing flowing beneath it. */}
          <div
            className={cn(
              "border-l-2 border-muted pl-6 font-serif text-lg italic leading-relaxed text-muted-foreground",
              hasPartOne && "mt-2"
            )}
          >
            {essay.prompt}
          </div>

          <EssayEditor
            initialText={text}
            onChange={updateText}
            allowPaste={allowPaste}
            disabled={pending}
            className="mt-8"
          />

          {error && <p className="mt-4 text-sm text-destructive">{error}</p>}

          <div className="mt-8 flex flex-wrap items-center gap-3 border-t border-border/60 pt-4">
            <Button type="submit" disabled={pending || !enough}>
              {pending ? "Turning it in…" : "Turn in essay"}
            </Button>
            {ownerSlot}
            <span
              className={cn(
                "ml-auto font-serif text-sm tabular-nums",
                enough
                  ? "text-emerald-700 dark:text-emerald-400"
                  : "text-muted-foreground"
              )}
            >
              {words} {words === 1 ? "word" : "words"} (min {minWords})
            </span>
          </div>
        </form>
      </div>
    </main>
  );
}

function LegacyRunner({
  quiz,
  memberEmail,
  retake,
  ownerSlot,
}: {
  quiz: ReadingQuizWithQuestions;
  memberEmail: string | null;
  retake: boolean;
  ownerSlot: ReactNode;
}) {
  const router = useRouter();
  const [choices, setChoices] = useState<Record<string, number>>({});
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const unanswered = quiz.questions.some((q) =>
      q.type === "multiple_choice"
        ? choices[q.id] === undefined
        : !(texts[q.id] ?? "").trim()
    );
    if (
      unanswered &&
      !window.confirm("Some questions are blank. Submit anyway?")
    ) {
      return;
    }

    setError(null);
    startTransition(async () => {
      try {
        const answers = quiz.questions.map((q) =>
          q.type === "multiple_choice"
            ? { questionId: q.id, selectedIndex: choices[q.id] ?? null }
            : { questionId: q.id, responseText: texts[q.id] ?? "" }
        );
        const res = await submitQuiz(quiz.id, answers, memberEmail);
        router.push(
          quizResultsHref(quiz.id, memberEmail, res.reachedMilestone)
        );
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Couldn't submit your quiz."
        );
      }
    });
  }

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-8">
      <h1 className="font-serif text-2xl tracking-tight text-foreground">
        {quiz.title || "Reading quiz"}
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {retake
          ? "Just the questions to try again — answer each one and resubmit. Your other answers are already counted."
          : `Covers ${quizRangeLabel(quiz.from_page, quiz.through_page)}. Answer each question, then submit to see how you did.`}
      </p>

      <form onSubmit={handleSubmit} className="mt-6 space-y-6">
        {quiz.questions.map((q, i) => (
          <div key={q.id} className="rounded-lg border border-border px-4 py-3">
            <p className="text-sm font-medium text-foreground">
              <span className="tabular-nums text-muted-foreground">{i + 1}.</span>{" "}
              {q.prompt}
            </p>

            {q.type === "multiple_choice" ? (
              <div className="mt-3 space-y-2">
                {(q.options ?? []).map((opt, oi) => (
                  <label
                    key={oi}
                    className={cn(
                      "flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors",
                      choices[q.id] === oi
                        ? "border-primary bg-primary/5 text-foreground"
                        : "border-border text-muted-foreground hover:bg-accent"
                    )}
                  >
                    <input
                      type="radio"
                      name={`q-${q.id}`}
                      checked={choices[q.id] === oi}
                      onChange={() =>
                        setChoices((prev) => ({ ...prev, [q.id]: oi }))
                      }
                    />
                    {opt}
                  </label>
                ))}
              </div>
            ) : (
              <div className="mt-3 grid gap-1.5">
                <Label htmlFor={`answer-${q.id}`} className="sr-only">
                  Your answer
                </Label>
                <Textarea
                  id={`answer-${q.id}`}
                  placeholder="Write your answer…"
                  value={texts[q.id] ?? ""}
                  onChange={(e) =>
                    setTexts((prev) => ({ ...prev, [q.id]: e.target.value }))
                  }
                />
              </div>
            )}
          </div>
        ))}

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={pending || quiz.questions.length === 0}>
            {pending ? "Submitting…" : "Submit quiz"}
          </Button>
          {ownerSlot}
        </div>
      </form>
    </main>
  );
}
