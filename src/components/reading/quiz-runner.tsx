"use client";

import { type ReactNode, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { submitQuiz } from "@/app/(reading)/reader/quizzes/actions";
import { quizResultsHref } from "@/lib/reading/links";
import { quizRangeLabel } from "@/lib/reading/quiz-format";
import { cn } from "@/lib/utils";
import type { ReadingQuizWithQuestions } from "@/lib/types";

/**
 * The reader takes a published quiz: pick an option for each multiple-choice
 * question, write a response for each free-text one, then submit. Submitting
 * auto-grades and routes to the results page with full feedback.
 */
export function QuizRunner({
  quiz,
  memberEmail = null,
  retake = false,
  ownerSlot = null,
}: {
  quiz: ReadingQuizWithQuestions;
  memberEmail?: string | null;
  /** True when this is a retake showing only the questions missed last time. */
  retake?: boolean;
  /** Owner-only controls (e.g. close without passing), shown in the header. */
  ownerSlot?: ReactNode;
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
