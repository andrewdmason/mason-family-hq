"use client";

import {
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  chooseEssayQuestion,
  submitQuiz,
} from "@/app/(reading)/reader/quizzes/actions";
import { EssayGradeCard } from "@/components/reading/quiz-essay-feedback";
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
  priorFeedback = null,
  allowPaste = false,
  ownerSlot = null,
}: {
  quiz: ReadingQuizWithQuestions;
  memberEmail?: string | null;
  /** True when this is a retake (a fresh try at the essay / the missed questions). */
  retake?: boolean;
  /** The reader's prior essay, so a revision opens with it instead of a blank box. */
  priorEssay?: string | null;
  /** The prior attempt's grade + notes, kept on screen while they revise. */
  priorFeedback?: ReadingEssayFeedback | null;
  /** Allow pasting into the essay (owner/parent testing); kids must type. */
  allowPaste?: boolean;
  /** Owner-only controls (e.g. close without passing), shown in the header. */
  ownerSlot?: ReactNode;
}) {
  // An essay quiz is all-essay questions; anything else is the legacy form. A
  // fresh essay quiz hands back several candidate prompts to choose between; once
  // the reader has committed (or there's only one), it's a single writing surface.
  const isEssay =
    quiz.questions.length > 0 &&
    quiz.questions.every((q) => q.type === "essay");

  if (isEssay) {
    if (quiz.questions.length > 1 && !quiz.chosen_question_id) {
      return (
        <EssayChooser
          quiz={quiz}
          options={quiz.questions}
          memberEmail={memberEmail}
        />
      );
    }
    const chosen =
      quiz.questions.find((q) => q.id === quiz.chosen_question_id) ??
      quiz.questions[0];
    return (
      <EssayRunner
        quiz={quiz}
        essay={chosen}
        memberEmail={memberEmail}
        priorEssay={priorEssay}
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

/**
 * The reader picks one of several candidate essay prompts. The choice is
 * deliberate and final — a confirm step makes that clear, and once committed the
 * server records it (chosen_question_id) so a refresh or retake can't reopen it.
 * On commit we refresh; getQuizForTaking then returns just the chosen prompt and
 * the writing surface takes over.
 */
function EssayChooser({
  quiz,
  options,
  memberEmail,
}: {
  quiz: ReadingQuizWithQuestions;
  options: ReadingQuizQuestion[];
  memberEmail: string | null;
}) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function commit() {
    if (!selectedId) return;
    setError(null);
    startTransition(async () => {
      try {
        await chooseEssayQuestion(quiz.id, selectedId, memberEmail);
        // The take page re-fetches as the chosen single-prompt writing surface.
        router.refresh();
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Couldn't lock in your choice."
        );
      }
    });
  }

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-6 pb-28 pt-12">
      <header className="mb-8">
        <p className="font-serif text-sm text-muted-foreground">
          Writing assignment
        </p>
        <h1 className="mt-1 font-serif text-3xl tracking-tight text-foreground">
          {quiz.title || `On ${quizRangeLabel(quiz.from_page, quiz.through_page)}`}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Choose the prompt you want to write about. Read all three first — once
          you pick one, you can&apos;t switch.
        </p>
      </header>

      <div className="flex flex-1 flex-col gap-4">
        {options.map((option, i) => {
          const selected = selectedId === option.id;
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => setSelectedId(option.id)}
              aria-pressed={selected}
              className={cn(
                "rounded-lg border px-5 py-4 text-left transition-colors",
                selected
                  ? "border-primary bg-primary/5"
                  : "border-border hover:bg-accent"
              )}
            >
              <p className="font-serif text-xs uppercase tracking-wide text-muted-foreground">
                Prompt {i + 1}
              </p>
              <p className="mt-2 font-serif text-lg italic leading-relaxed text-foreground">
                {option.prompt}
              </p>
            </button>
          );
        })}
      </div>

      {error && <p className="mt-4 text-sm text-destructive">{error}</p>}

      <div className="mt-8 flex flex-wrap items-center gap-3 border-t border-border/60 pt-4">
        <Button type="button" onClick={commit} disabled={pending || !selectedId}>
          {pending ? "Locking it in…" : "Write about this one"}
        </Button>
        <span className="text-sm text-muted-foreground">
          {selectedId
            ? "You won't be able to switch after this."
            : "Pick a prompt to get started."}
        </span>
      </div>
    </main>
  );
}

function EssayRunner({
  quiz,
  essay,
  memberEmail,
  priorEssay,
  priorFeedback,
  allowPaste,
  ownerSlot,
}: {
  quiz: ReadingQuizWithQuestions;
  essay: ReadingQuizQuestion;
  memberEmail: string | null;
  priorEssay: string | null;
  priorFeedback: ReadingEssayFeedback | null;
  allowPaste: boolean;
  ownerSlot: ReactNode;
}) {
  const router = useRouter();
  // A revision opens with the prior draft so the reader edits rather than retypes.
  const isRevision = priorEssay != null;

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

  // Auto-grow the writing surface so it reads like a page that gets longer as you
  // write, not a fixed scrolling box (mirrors the journal's composer).
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);

  function updateText(value: string) {
    setText(value);
    try {
      window.localStorage.setItem(storageKey, value);
    } catch {
      // Ignore storage write failures (quota, private mode).
    }
  }

  const minWords = essay.min_words ?? DEFAULT_MIN_WORDS;
  const words = useMemo(() => countWords(text), [text]);
  const enough = words >= minWords;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!enough) return;
    setError(null);
    startTransition(async () => {
      try {
        await submitQuiz(
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
        router.push(quizResultsHref(quiz.id, memberEmail));
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Couldn't submit your essay."
        );
      }
    });
  }

  // Block pasting and dropping text in so the essay is the reader's own writing.
  // The owner/parent is allowed to paste so they can test with sample essays.
  const blockPaste = allowPaste
    ? undefined
    : (e: React.ClipboardEvent | React.DragEvent) => e.preventDefault();

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-6 pb-28 pt-12">
      <header className="mb-8">
        <p className="font-serif text-sm text-muted-foreground">
          {isRevision ? "Your revision" : "Writing assignment"}
        </p>
        <h1 className="mt-1 font-serif text-3xl tracking-tight text-foreground">
          {quiz.title || `On ${quizRangeLabel(quiz.from_page, quiz.through_page)}`}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {isRevision
            ? "Your last essay is here to build on — use the notes from last time, then turn it in again."
            : "Write one essay — start with the book, then take it further."}
        </p>
      </header>

      <form onSubmit={handleSubmit} className="flex flex-1 flex-col">
        {/* Revising: keep the last round of feedback in view while they rework it. */}
        {priorFeedback && (
          <EssayGradeCard
            feedback={priorFeedback}
            heading="Last round of feedback"
            className="mb-10"
          />
        )}

        {/* The prompt reads like the journal's question: italic, set off by a
            quiet left rule, with the writing flowing beneath it. */}
        <div className="border-l-2 border-muted pl-6 font-serif text-lg italic leading-relaxed text-muted-foreground">
          {essay.prompt}
        </div>

        <textarea
          ref={textareaRef}
          aria-label="Your essay"
          placeholder="Start writing…"
          value={text}
          onChange={(e) => updateText(e.target.value)}
          onPaste={blockPaste}
          onDrop={blockPaste}
          rows={1}
          className="mt-8 min-h-[40vh] w-full resize-none overflow-hidden border-0 bg-transparent font-serif text-lg leading-relaxed text-foreground placeholder:text-muted-foreground/50 focus:outline-none disabled:opacity-60"
          suppressHydrationWarning
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
        await submitQuiz(quiz.id, answers, memberEmail);
        router.push(quizResultsHref(quiz.id, memberEmail));
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
