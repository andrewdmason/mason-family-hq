"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateEntryContent } from "@/app/(journal)/journal/actions";
import { typeLabel } from "@/lib/journal/candidates";
import type { JournalMessageRole } from "@/lib/types";

type EditableMessage = { id: string; role: JournalMessageRole; content: string };

/**
 * Full-page editor for a standard entry: the title plus every message the
 * author wrote. Interviewer questions show as read-only context so each answer
 * sits beneath the question it responds to, but only the user's own turns are
 * editable. Reached from the entry's overflow menu ("Edit").
 */
export function EntryEditor({
  entryId,
  initialTitle,
  initialQuestionType,
  questionTypeOptions,
  messages,
}: {
  entryId: string;
  initialTitle: string;
  /** The entry's current category (question type `name`), or "" for none. */
  initialQuestionType: string;
  /** Categories to offer, as question type `name`s, in display order. */
  questionTypeOptions: string[];
  messages: EditableMessage[];
}) {
  const router = useRouter();
  const [title, setTitle] = useState(initialTitle);
  const [questionType, setQuestionType] = useState(initialQuestionType);
  // Edited user-message content, keyed by message id. Assistant messages are
  // never editable, so they're not tracked here.
  const [drafts, setDrafts] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      messages.filter((m) => m.role === "user").map((m) => [m.id, m.content])
    )
  );
  const [error, setError] = useState<string | null>(null);
  const [isSaving, startSave] = useTransition();

  const userMessageIds = messages.filter((m) => m.role === "user").map((m) => m.id);
  const hasEmptyMessage = userMessageIds.some((id) => !drafts[id]?.trim());

  function handleSave() {
    if (isSaving || hasEmptyMessage) return;
    setError(null);
    const messageEdits = userMessageIds.map((id) => ({ id, content: drafts[id] }));
    startSave(async () => {
      try {
        await updateEntryContent(entryId, title, messageEdits, questionType || null);
        router.push(`/journal/${entryId}`);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <div className="mt-6">
      <label className="mb-2 block font-serif text-xs text-muted-foreground">
        Title
      </label>
      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Untitled"
        disabled={isSaving}
        className="w-full rounded-lg border border-muted bg-transparent px-5 py-3 font-serif text-2xl leading-snug text-foreground focus:border-foreground/40 focus:outline-none disabled:opacity-50"
      />

      <label className="mb-2 mt-6 block font-serif text-xs text-muted-foreground">
        Category
      </label>
      <select
        value={questionType}
        onChange={(e) => setQuestionType(e.target.value)}
        disabled={isSaving}
        className="w-full rounded-lg border border-muted bg-transparent px-5 py-3 font-serif text-base text-foreground focus:border-foreground/40 focus:outline-none disabled:opacity-50"
      >
        <option value="">No category</option>
        {questionTypeOptions.map((name) => (
          <option key={name} value={name}>
            {typeLabel(name)}
          </option>
        ))}
      </select>

      <div className="mt-10 space-y-6 font-serif text-lg leading-relaxed">
        {messages.map((m) =>
          m.role === "assistant" ? (
            <p
              key={m.id}
              className="border-l-2 border-muted pl-6 italic text-muted-foreground"
            >
              {m.content}
            </p>
          ) : (
            <MessageField
              key={m.id}
              value={drafts[m.id] ?? ""}
              disabled={isSaving}
              onChange={(next) =>
                setDrafts((d) => ({ ...d, [m.id]: next }))
              }
            />
          )
        )}
      </div>

      {error && <p className="mt-6 text-sm text-destructive">{error}</p>}

      <div className="mt-10 flex items-center gap-x-5">
        <button
          type="button"
          onClick={handleSave}
          disabled={isSaving || hasEmptyMessage}
          className="font-serif text-sm text-foreground underline-offset-4 hover:underline disabled:opacity-40 disabled:hover:no-underline"
        >
          {isSaving ? "saving…" : "save"}
        </button>
        <button
          type="button"
          onClick={() => router.push(`/journal/${entryId}`)}
          disabled={isSaving}
          className="font-serif text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline disabled:opacity-40"
        >
          cancel
        </button>
      </div>
    </div>
  );
}

// One auto-growing textarea for an editable user message, mirroring the chat's
// reply box so an answer reads the same here as it does in the transcript.
function MessageField({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled: boolean;
  onChange: (next: string) => void;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      rows={1}
      className="w-full resize-none overflow-hidden rounded-lg border border-muted bg-transparent px-5 py-3 font-serif text-lg leading-relaxed text-foreground focus:border-foreground/40 focus:outline-none disabled:opacity-50"
    />
  );
}
