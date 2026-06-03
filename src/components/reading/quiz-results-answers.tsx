"use client";

import { useState } from "react";
import { Check, Eye, EyeOff, HelpCircle, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ReadingQuizAnswer, ReadingQuizQuestion } from "@/lib/types";

/**
 * Per-question results. Correct answers are hidden when the viewed attempt wasn't
 * perfect, so a kid who has to retake doesn't just memorize the key. The owner
 * gets a button to reveal them for their own reference. The reader still sees
 * their own answers and which questions were right or wrong.
 */
export function QuizResultsAnswers({
  questions,
  answersByQuestionId,
  showByDefault,
  canReveal,
}: {
  questions: ReadingQuizQuestion[];
  answersByQuestionId: Record<string, ReadingQuizAnswer>;
  /** True when the attempt was perfect — nothing to hide. */
  showByDefault: boolean;
  /** True for the owner — they may reveal the answers. */
  canReveal: boolean;
}) {
  const [revealed, setRevealed] = useState(false);
  const reveal = showByDefault || revealed;

  return (
    <div className="mt-6">
      {!showByDefault && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            {reveal
              ? "Answers shown."
              : "Correct answers are hidden so they can retake this."}
          </p>
          {canReveal && (
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={() => setRevealed((r) => !r)}
            >
              {revealed ? (
                <>
                  <EyeOff /> Hide answers
                </>
              ) : (
                <>
                  <Eye /> Reveal answers
                </>
              )}
            </Button>
          )}
        </div>
      )}

      <div className="space-y-4">
        {questions.map((q, i) => (
          <QuestionResult
            key={q.id}
            index={i}
            question={q}
            answer={answersByQuestionId[q.id]}
            reveal={reveal}
          />
        ))}
      </div>
    </div>
  );
}

function Verdict({ isCorrect }: { isCorrect: boolean | null }) {
  if (isCorrect === null) {
    return (
      <Badge variant="secondary" className="gap-1">
        <HelpCircle className="h-3.5 w-3.5" />
        Not graded
      </Badge>
    );
  }
  return isCorrect ? (
    <Badge className="gap-1 bg-emerald-600 text-white">
      <Check className="h-3.5 w-3.5" />
      Correct
    </Badge>
  ) : (
    <Badge variant="destructive" className="gap-1">
      <X className="h-3.5 w-3.5" />
      Not quite
    </Badge>
  );
}

function QuestionResult({
  index,
  question,
  answer,
  reveal,
}: {
  index: number;
  question: ReadingQuizQuestion;
  answer: ReadingQuizAnswer | undefined;
  reveal: boolean;
}) {
  return (
    <div className="rounded-lg border border-border px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-foreground">
          <span className="tabular-nums text-muted-foreground">{index + 1}.</span>{" "}
          {question.prompt}
        </p>
        <Verdict isCorrect={answer?.is_correct ?? null} />
      </div>

      {question.type === "multiple_choice" ? (
        <>
          <ul className="mt-3 space-y-1">
            {(question.options ?? []).map((opt, oi) => {
              const chosen = answer?.selected_index === oi;
              const correct = question.correct_index === oi;
              // When hidden, only the reader's own pick is marked — never the
              // correct option they didn't choose.
              const showAsCorrect = reveal ? correct : chosen && correct;
              const showAsWrong = chosen && !correct;
              return (
                <li
                  key={oi}
                  className={cn(
                    "flex items-center gap-2 rounded-md px-2 py-1 text-sm",
                    showAsCorrect
                      ? "bg-emerald-600/10 font-medium text-foreground"
                      : showAsWrong
                        ? "bg-destructive/10 text-foreground"
                        : "text-muted-foreground"
                  )}
                >
                  {showAsCorrect ? (
                    <Check className="h-3.5 w-3.5 text-emerald-600" />
                  ) : showAsWrong ? (
                    <X className="h-3.5 w-3.5 text-destructive" />
                  ) : (
                    <span className="h-3.5 w-3.5" />
                  )}
                  {opt}
                  {chosen && (
                    <span className="text-xs text-muted-foreground">
                      (your answer)
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
          {reveal && question.explanation && (
            <p className="mt-2 text-xs italic text-muted-foreground">
              {question.explanation}
            </p>
          )}
        </>
      ) : (
        <div className="mt-3 space-y-2">
          <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm text-foreground">
            {answer?.response_text?.trim() || (
              <span className="italic text-muted-foreground">(left blank)</span>
            )}
          </div>
          {/* Feedback can hint at the answer, so it's gated behind reveal too. */}
          {reveal && answer?.ai_notes && (
            <p className="text-sm text-muted-foreground">{answer.ai_notes}</p>
          )}
        </div>
      )}
    </div>
  );
}
