"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Check, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  deleteQuiz,
  publishQuiz,
  regenerateQuizDraft,
  updateQuizQuestion,
} from "@/app/(reading)/reader/quizzes/actions";
import { quizzesHref } from "@/lib/reading/links";
import { quizRangeLabel } from "@/lib/reading/quiz-format";
import { cn } from "@/lib/utils";
import type { ReadingQuizQuestion, ReadingQuizWithQuestions } from "@/lib/types";

export function QuizDraftEditor({
  quiz,
  memberEmail = null,
}: {
  quiz: ReadingQuizWithQuestions;
  memberEmail?: string | null;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const mcCount = quiz.questions.filter((q) => q.type === "multiple_choice").length;
  const ftCount = quiz.questions.filter((q) => q.type === "free_text").length;

  function handleRegenerate() {
    if (
      !window.confirm(
        "Regenerate this quiz? The current questions and any edits will be replaced."
      )
    ) {
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        await regenerateQuizDraft(quiz.id, memberEmail);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't regenerate.");
      }
    });
  }

  function handlePublish() {
    setError(null);
    startTransition(async () => {
      try {
        await publishQuiz(quiz.id, memberEmail);
        router.push(quizzesHref(memberEmail));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't publish.");
      }
    });
  }

  function handleDelete() {
    if (!window.confirm("Delete this quiz?")) return;
    setError(null);
    startTransition(async () => {
      try {
        await deleteQuiz(quiz.id, memberEmail);
        router.push(quizzesHref(memberEmail));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't delete.");
      }
    });
  }

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-serif text-2xl tracking-tight text-foreground">
              {quiz.title || "Quiz"}
            </h1>
            <Badge variant="secondary">Draft</Badge>
          </div>
          <p className="mt-1 text-sm capitalize text-muted-foreground">
            {quizRangeLabel(quiz.from_page, quiz.through_page)} · {mcCount}{" "}
            multiple-choice · {ftCount} writing
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleRegenerate}
            disabled={pending}
          >
            <RefreshCw className="h-4 w-4" />
            Regenerate
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={handlePublish}
            disabled={pending || quiz.questions.length === 0}
          >
            <Check className="h-4 w-4" />
            Publish
          </Button>
        </div>
      </div>

      {quiz.generation_error && (
        <p className="mt-4 flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-4 py-2 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {quiz.generation_error} Use Regenerate to try again.
        </p>
      )}

      {error && <p className="mt-4 text-sm text-destructive">{error}</p>}

      <div className="mt-6 space-y-4">
        {quiz.questions.map((question, i) => (
          <QuestionCard
            key={question.id}
            index={i}
            question={question}
            memberEmail={memberEmail}
            onSaved={() => router.refresh()}
          />
        ))}
        {quiz.questions.length === 0 && (
          <p className="rounded-lg border border-dashed border-border px-6 py-10 text-center text-sm text-muted-foreground">
            No questions yet. Try Regenerate.
          </p>
        )}
      </div>

      <div className="mt-8 border-t border-border pt-4">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleDelete}
          disabled={pending}
          className="text-destructive hover:text-destructive"
        >
          Delete quiz
        </Button>
      </div>
    </main>
  );
}

function QuestionCard({
  index,
  question,
  memberEmail,
  onSaved,
}: {
  index: number;
  question: ReadingQuizQuestion;
  memberEmail: string | null;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);

  return (
    <div className="rounded-lg border border-border px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium tabular-nums text-muted-foreground">
            Q{index + 1}
          </span>
          <Badge variant="outline">
            {question.type === "multiple_choice" ? "Multiple choice" : "Writing"}
          </Badge>
        </div>
        {!editing && (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => setEditing(true)}
          >
            Edit
          </Button>
        )}
      </div>

      {editing ? (
        <QuestionEditForm
          question={question}
          memberEmail={memberEmail}
          onDone={(saved) => {
            setEditing(false);
            if (saved) onSaved();
          }}
        />
      ) : (
        <QuestionPreview question={question} />
      )}
    </div>
  );
}

function QuestionPreview({ question }: { question: ReadingQuizQuestion }) {
  return (
    <div className="mt-2">
      <p className="text-sm text-foreground">{question.prompt}</p>
      {question.type === "multiple_choice" ? (
        <>
          <ul className="mt-2 space-y-1">
            {(question.options ?? []).map((opt, i) => (
              <li
                key={i}
                className={cn(
                  "flex items-center gap-2 text-sm",
                  i === question.correct_index
                    ? "font-medium text-foreground"
                    : "text-muted-foreground"
                )}
              >
                {i === question.correct_index ? (
                  <Check className="h-3.5 w-3.5 text-primary" />
                ) : (
                  <span className="h-3.5 w-3.5" />
                )}
                {opt}
              </li>
            ))}
          </ul>
          {question.explanation && (
            <p className="mt-2 text-xs italic text-muted-foreground">
              Why: {question.explanation}
            </p>
          )}
        </>
      ) : (
        <div className="mt-2 space-y-1 text-xs text-muted-foreground">
          {question.grading_rubric && (
            <p>
              <span className="font-medium text-foreground">Rubric:</span>{" "}
              {question.grading_rubric}
            </p>
          )}
          {question.sample_answer && (
            <p>
              <span className="font-medium text-foreground">Sample:</span>{" "}
              {question.sample_answer}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function QuestionEditForm({
  question,
  memberEmail,
  onDone,
}: {
  question: ReadingQuizQuestion;
  memberEmail: string | null;
  onDone: (saved: boolean) => void;
}) {
  const [prompt, setPrompt] = useState(question.prompt);
  const [options, setOptions] = useState<string[]>(question.options ?? []);
  const [correctIndex, setCorrectIndex] = useState(question.correct_index ?? 0);
  const [explanation, setExplanation] = useState(question.explanation ?? "");
  const [rubric, setRubric] = useState(question.grading_rubric ?? "");
  const [sample, setSample] = useState(question.sample_answer ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    setError(null);
    startTransition(async () => {
      try {
        if (question.type === "multiple_choice") {
          await updateQuizQuestion(
            question.id,
            { prompt, options, correctIndex, explanation },
            memberEmail
          );
        } else {
          await updateQuizQuestion(
            question.id,
            { prompt, gradingRubric: rubric, sampleAnswer: sample },
            memberEmail
          );
        }
        onDone(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't save.");
      }
    });
  }

  return (
    <div className="mt-3 grid gap-3">
      <div className="grid gap-1.5">
        <Label htmlFor={`prompt-${question.id}`}>Question</Label>
        <Textarea
          id={`prompt-${question.id}`}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />
      </div>

      {question.type === "multiple_choice" ? (
        <>
          <div className="grid gap-1.5">
            <Label>Options (select the correct one)</Label>
            {options.map((opt, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  type="radio"
                  name={`correct-${question.id}`}
                  checked={correctIndex === i}
                  onChange={() => setCorrectIndex(i)}
                  aria-label={`Mark option ${i + 1} correct`}
                />
                <Input
                  value={opt}
                  onChange={(e) =>
                    setOptions((prev) =>
                      prev.map((o, j) => (j === i ? e.target.value : o))
                    )
                  }
                />
              </div>
            ))}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`explanation-${question.id}`}>
              Why it&apos;s correct
            </Label>
            <Textarea
              id={`explanation-${question.id}`}
              value={explanation}
              onChange={(e) => setExplanation(e.target.value)}
            />
          </div>
        </>
      ) : (
        <>
          <div className="grid gap-1.5">
            <Label htmlFor={`rubric-${question.id}`}>
              Grading rubric (what a correct answer needs)
            </Label>
            <Textarea
              id={`rubric-${question.id}`}
              value={rubric}
              onChange={(e) => setRubric(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`sample-${question.id}`}>Sample answer</Label>
            <Textarea
              id={`sample-${question.id}`}
              value={sample}
              onChange={(e) => setSample(e.target.value)}
            />
          </div>
        </>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex items-center gap-2">
        <Button type="button" size="sm" onClick={save} disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => onDone(false)}
          disabled={pending}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
