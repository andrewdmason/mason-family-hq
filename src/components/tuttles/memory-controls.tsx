"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  addParentNote,
  deleteParentNote,
  restoreMemoryVersion,
  rewriteMemoryNow,
} from "@/app/(tuttles)/tuttles/actions";

/** Runs the nightly rewrite now, over the last two weeks of chats. */
export function RewriteNowButton({ studentId }: { studentId: string }) {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      <Button
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setMessage(null);
            const r = await rewriteMemoryNow(studentId);
            setMessage(r.ok ? (r.message ?? "Done.") : (r.error ?? "Failed."));
          })
        }
      >
        {pending ? "Rewriting…" : "Rewrite now"}
      </Button>
      {message && <p className="max-w-64 text-right text-xs text-muted-foreground">{message}</p>}
    </div>
  );
}

export function ParentNotes({
  studentId,
  notes,
}: {
  studentId: string;
  notes: { id: string; body: string; created_at: string }[];
}) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <div className="space-y-2">
      {notes.length > 0 && (
        <ul className="divide-y divide-foreground/8 overflow-hidden rounded-xl border border-foreground/10 bg-card">
          {notes.map((n) => (
            <li key={n.id} className="flex items-start gap-3 px-4 py-3">
              <p className="flex-1 text-[0.95rem] text-foreground">{n.body}</p>
              <Button
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() => start(async () => void (await deleteParentNote(studentId, n.id)))}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-end gap-2">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="e.g. His teacher says he rushes word problems."
          rows={2}
          className="flex-1"
        />
        <Button
          size="sm"
          disabled={pending || !draft.trim()}
          onClick={() =>
            start(async () => {
              setError(null);
              const r = await addParentNote(studentId, draft);
              if (r.ok) setDraft("");
              else setError(r.error ?? "Couldn't save.");
            })
          }
        >
          Add note
        </Button>
      </div>
      {error && <p className="text-xs text-[#d7261e]">{error}</p>}
    </div>
  );
}

export function MemoryHistory({
  studentId,
  versions,
}: {
  studentId: string;
  versions: { version: number; changes: string | null; source: string; created_at: string }[];
}) {
  const [pending, start] = useTransition();
  if (versions.length === 0) return <p className="px-1 text-sm text-muted-foreground">No versions yet.</p>;
  return (
    <ul className="divide-y divide-foreground/8 overflow-hidden rounded-xl border border-foreground/10 bg-card">
      {versions.map((v, i) => (
        <li key={v.version} className="flex items-start gap-3 px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs text-muted-foreground">
              {new Date(v.created_at).toLocaleString("en-US", {
                timeZone: "America/Los_Angeles",
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}
              {i === 0 && " · current"}
            </p>
            <p className="text-sm text-foreground">{v.changes ?? "—"}</p>
          </div>
          {i > 0 && (
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => start(async () => void (await restoreMemoryVersion(studentId, v.version)))}
            >
              Restore
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}
