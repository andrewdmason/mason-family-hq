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
import {
  submitComprehension,
  submitQuiz,
} from "@/app/(reading)/reader/quizzes/actions";
import { EssayEditor } from "@/components/reading/essay-editor";
import { EssayGradeCard } from "@/components/reading/quiz-essay-feedback";
import { EssayGradingOverlay } from "@/components/reading/quiz-grading-overlay";
import {
  EssayCriteriaContent,
  EssayCriteriaPanel,
} from "@/components/reading/essay-criteria";
import { ESSAY_BONUS_BUCKS } from "@/lib/reading/essay-scoring";
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
 * The reader takes a published quiz. New quizzes are a two-step essay: first a quick
 * pass/fail comprehension check (Part 1), then — once that's cleared — the writing
 * screen, all focus on the essay. Legacy multiple-choice / short-answer quizzes still
 * render the per-question form. Submitting auto-grades and routes to results.
 */
export function QuizRunner({
  quiz,
  memberEmail = null,
  retake = false,
  stage = "essay",
  comprehensionPrompt = null,
  priorEssay = null,
  priorFeedback = null,
  isBonusShot = false,
  allowPaste = false,
  ownerSlot = null,
}: {
  quiz: ReadingQuizWithQuestions;
  memberEmail?: string | null;
  /** True when this is a retake (a fresh try at the missed legacy questions). */
  retake?: boolean;
  /** Essay: which step to show — the Part 1 gate or the writing. */
  stage?: "comprehension" | "essay";
  /** Essay: the Part 1 prompt, for the comprehension step. */
  comprehensionPrompt?: string | null;
  /** The reader's prior Part 2 essay, so a revision opens with it instead of blank. */
  priorEssay?: string | null;
  /** The prior attempt's grade + notes, kept on screen while they revise. */
  priorFeedback?: ReadingEssayFeedback | null;
  /** Essay: this write is the single "try once more for the bonus" shot after a pass. */
  isBonusShot?: boolean;
  /** Allow pasting into the essay (owner/parent testing); kids must type. */
  allowPaste?: boolean;
  /** Owner-only controls (e.g. close without passing), shown in the header. */
  ownerSlot?: ReactNode;
}) {
  // An essay quiz is all-essay questions; anything else is the legacy form. The kid
  // always writes exactly one question — the parent-curated / auto-default chosen one.
  const isEssay =
    quiz.questions.length > 0 &&
    quiz.questions.every((q) => q.type === "essay");

  if (isEssay) {
    const chosen =
      quiz.questions.find((q) => q.id === quiz.chosen_question_id) ??
      quiz.questions[0];
    if (stage === "comprehension") {
      return (
        <ComprehensionStep
          quiz={quiz}
          prompt={comprehensionPrompt ?? chosen.comprehension_prompt ?? ""}
          memberEmail={memberEmail}
          ownerSlot={ownerSlot}
        />
      );
    }
    return (
      <EssayRunner
        quiz={quiz}
        essay={chosen}
        memberEmail={memberEmail}
        priorEssay={priorEssay}
        priorFeedback={priorFeedback}
        isBonusShot={isBonusShot}
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

/**
 * Step 1: the quick comprehension gate. A sentence or two proving they read the pages,
 * graded pass/fail. A miss returns a gentle hint and lets them try again (it costs
 * nothing); a pass clears the gate for good and opens the essay screen.
 */
function ComprehensionStep({
  quiz,
  prompt,
  memberEmail,
  ownerSlot,
}: {
  quiz: ReadingQuizWithQuestions;
  prompt: string;
  memberEmail: string | null;
  ownerSlot: ReactNode;
}) {
  const router = useRouter();
  const storageKey = `reading-essay-part1:${quiz.id}`;
  const [answer, setAnswer] = useState(() => {
    if (typeof window === "undefined") return "";
    try {
      return window.localStorage.getItem(storageKey) ?? "";
    } catch {
      return "";
    }
  });
  const [miss, setMiss] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function update(value: string) {
    setAnswer(value);
    try {
      window.localStorage.setItem(storageKey, value);
    } catch {
      // Ignore storage write failures.
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!answer.trim() || pending) return;
    setError(null);
    setMiss(null);
    startTransition(async () => {
      try {
        const res = await submitComprehension(quiz.id, answer, memberEmail);
        if (res.met) {
          try {
            window.localStorage.removeItem(storageKey);
          } catch {
            // Ignore storage failures.
          }
          // Cleared — refresh so the server renders the essay step next.
          router.refresh();
        } else {
          setMiss(res.note);
        }
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Couldn't check your answer."
        );
      }
    });
  }

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-6 pb-28 pt-12">
      <header className="mb-8">
        <p className="font-serif text-sm text-muted-foreground">
          Part 1 · Quick check
        </p>
        <h1 className="mt-1 font-serif text-3xl tracking-tight text-foreground">
          {quiz.title ||
            `On ${quizRangeLabel(quiz.from_page, quiz.through_page)}`}
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          First, a quick check that you read the pages. Answer in a sentence or two —
          get it and the essay opens up.
        </p>
      </header>

      <form onSubmit={handleSubmit} className="flex flex-1 flex-col">
        <div className="border-l-2 border-muted pl-6 font-serif text-lg italic leading-relaxed text-muted-foreground">
          {prompt}
        </div>
        <Label htmlFor="comprehension-answer" className="sr-only">
          Your answer
        </Label>
        <Textarea
          id="comprehension-answer"
          placeholder="A sentence or two on what happened…"
          value={answer}
          onChange={(e) => update(e.target.value)}
          disabled={pending}
          rows={3}
          className="mt-6"
          autoFocus
        />

        {miss && (
          <p className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-sm text-amber-800 dark:text-amber-300">
            {miss}
          </p>
        )}
        {error && <p className="mt-4 text-sm text-destructive">{error}</p>}

        <div className="mt-8 flex flex-wrap items-center gap-3 border-t border-border/60 pt-4">
          <Button type="submit" disabled={pending || !answer.trim()}>
            {pending ? "Checking…" : "Check my answer"}
          </Button>
          {ownerSlot}
        </div>
      </form>
    </main>
  );
}

function EssayRunner({
  quiz,
  essay,
  memberEmail,
  priorEssay,
  priorFeedback,
  isBonusShot,
  allowPaste,
  ownerSlot,
}: {
  quiz: ReadingQuizWithQuestions;
  essay: ReadingQuizQuestion;
  memberEmail: string | null;
  priorEssay: string | null;
  priorFeedback: ReadingEssayFeedback | null;
  isBonusShot: boolean;
  allowPaste: boolean;
  ownerSlot: ReactNode;
}) {
  const router = useRouter();
  // A revision opens with the prior draft so the reader edits rather than retypes.
  const isRevision = priorEssay != null;

  // Autosave the in-progress essay to localStorage so a refresh or accidental
  // navigation doesn't lose 20+ minutes of writing. Keyed per quiz, restored straight
  // into initial state (so there's no flash), and cleared on a successful turn-in.
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

  // The word floor applies to the essay.
  const minWords = essay.min_words ?? DEFAULT_MIN_WORDS;
  const words = useMemo(() => countWords(text), [text]);
  const enough = words >= minWords;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!enough) return;
    setError(null);
    startTransition(async () => {
      try {
        const res = await submitQuiz(
          quiz.id,
          [{ questionId: essay.id, responseText: text }],
          memberEmail
        );
        // Turned in successfully — the saved draft is no longer needed.
        try {
          window.localStorage.removeItem(storageKey);
        } catch {
          // Ignore storage failures.
        }
        if (res.passed) {
          // Passed (meets or exceeds) — on to the results/celebration view, which also
          // offers the one bonus shot when they only just met the bar.
          router.push(
            quizResultsHref(quiz.id, memberEmail, res.reachedMilestone)
          );
        } else {
          // Not there yet — keep them in the editor with their draft intact and pull
          // the just-graded feedback into the sidebar; scroll up so they see it. (If
          // this was the bonus shot, the refresh routes them on to results instead.)
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

  const eyebrow = isBonusShot
    ? "One more try for the bonus"
    : isRevision
      ? "Your revision"
      : "Writing assignment";

  return (
    <>
      {/* Blocking "Grading…" overlay while the AI reads and scores the essay. */}
      {pending && <EssayGradingOverlay />}
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-10 px-6 pb-28 pt-12 lg:flex-row lg:items-start lg:gap-12">
      {/* Right rail: once they've turned in an essay, the last round of feedback takes
          the rail; before that (no feedback yet) it shows the static "what makes a good
          essay" criteria. Anchored + scrollable on wide screens; hidden below lg, where
          a compact version stacks above the editor. */}
      <aside className="hidden shrink-0 lg:sticky lg:top-20 lg:order-last lg:block lg:max-h-[calc(100vh-6rem)] lg:w-80 lg:overflow-y-auto lg:overscroll-contain xl:w-96">
        {priorFeedback ? (
          <EssayGradeCard
            feedback={priorFeedback}
            heading="Last round of feedback"
          />
        ) : (
          <EssayCriteriaPanel />
        )}
      </aside>

      <div className="flex w-full flex-1 flex-col lg:max-w-2xl">
        <header className="mb-8">
          <p className="font-serif text-sm text-muted-foreground">{eyebrow}</p>
          <h1 className="mt-1 font-serif text-3xl tracking-tight text-foreground">
            {quiz.title ||
              `On ${quizRangeLabel(quiz.from_page, quiz.through_page)}`}
          </h1>
          {isBonusShot && (
            <p className="mt-3 text-sm text-muted-foreground">
              You&apos;ve already passed — this is your one shot to reach
              &ldquo;exceeds&rdquo; and earn {ESSAY_BONUS_BUCKS} Mason Bucks. Push
              your thinking further, or head back if you&apos;re happy with it.
            </p>
          )}
        </header>

        {/* Narrow screens: the wide-screen sidebar is hidden, so show the last round of
            feedback (once revising) or — before the first submission — a collapsible
            copy of the criteria, above the editor. */}
        <div className="lg:hidden">
          {priorFeedback ? (
            <EssayGradeCard feedback={priorFeedback} className="mb-6" />
          ) : (
            <details className="mb-8 rounded-xl border border-border bg-card">
              <summary className="cursor-pointer px-4 py-3 font-serif text-sm text-foreground">
                What makes a good essay
              </summary>
              <div className="border-t border-border/60 px-4 py-4">
                <EssayCriteriaContent />
              </div>
            </details>
          )}
        </div>

        <form onSubmit={handleSubmit} className="flex flex-1 flex-col">
          {/* The prompt reads like the journal's question: italic, set off by a quiet
              left rule, with the writing flowing beneath it. */}
          <div className="border-l-2 border-muted pl-6 font-serif text-lg italic leading-relaxed text-muted-foreground">
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
              {pending ? "Submitting…" : isRevision ? "Resubmit" : "Submit"}
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
    </>
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
