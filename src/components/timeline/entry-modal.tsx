"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { TIMELINE_CATEGORIES } from "@/lib/types";
import type {
  DatePrecision,
  TimelineCategory,
  TimelineEntryWithPeople,
  TimelineProminence,
} from "@/lib/types";
import { CATEGORY_LABEL } from "@/lib/timeline/config";
import { createTimelineEntry, updateTimelineEntry } from "@/lib/timeline/actions";

const PROMINENCES: TimelineProminence[] = ["major", "medium", "minor"];

function dateToInput(date: string, precision: DatePrecision): string {
  if (precision === "year") return date.slice(0, 4);
  if (precision === "month") return date.slice(0, 7);
  return date;
}

const inputCls =
  "w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

/**
 * Create or edit a timeline event. Pass `entry` to edit it; omit it (with an
 * optional `defaultSubjectEmail`) to create a new one.
 */
export function EntryModal({
  entry,
  familyPeople,
  defaultSubjectEmail,
  onClose,
}: {
  entry?: TimelineEntryWithPeople | null;
  familyPeople: { email: string; name: string }[];
  defaultSubjectEmail?: string | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState(entry?.title ?? "");
  const [description, setDescription] = useState(entry?.description ?? "");
  const [category, setCategory] = useState<TimelineCategory>(entry?.category ?? "career");
  const [prominence, setProminence] = useState<TimelineProminence>(entry?.prominence ?? "medium");
  const [location, setLocation] = useState(entry?.location ?? "");
  const [startDate, setStartDate] = useState(
    entry ? dateToInput(entry.start_date, entry.start_precision) : ""
  );
  const [endDate, setEndDate] = useState(
    entry?.end_date && entry?.end_precision ? dateToInput(entry.end_date, entry.end_precision) : ""
  );
  const [approximate, setApproximate] = useState(entry?.approximate ?? false);
  const [subjects, setSubjects] = useState<Set<string>>(() => {
    if (entry) {
      return new Set(entry.subjects.map((s) => s.member_email?.toLowerCase()).filter(Boolean) as string[]);
    }
    return new Set(defaultSubjectEmail ? [defaultSubjectEmail.toLowerCase()] : []);
  });

  function toggleSubject(email: string) {
    setSubjects((prev) => {
      const next = new Set(prev);
      if (next.has(email)) next.delete(email);
      else next.add(email);
      return next;
    });
  }

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const input = {
        title,
        description,
        category,
        prominence,
        location: location || null,
        start: startDate,
        end: endDate || null,
        approximate,
        subjectEmails: [...subjects],
      };
      try {
        if (entry) await updateTimelineEntry(entry.id, input);
        else await createTimelineEntry(input);
        router.refresh();
        onClose();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't save the event.");
      }
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-border bg-background p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-serif text-lg text-foreground">{entry ? "Edit event" : "New event"}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSave} className="space-y-3">
          <Field label="Title">
            <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} required autoFocus />
          </Field>
          <Field label="Description">
            <textarea
              className={cn(inputCls, "min-h-[72px] resize-y")}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="A sentence or two — the caption shown on the timeline."
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Category">
              <select className={inputCls} value={category} onChange={(e) => setCategory(e.target.value as TimelineCategory)}>
                {TIMELINE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABEL[c]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Prominence">
              <select className={inputCls} value={prominence} onChange={(e) => setProminence(e.target.value as TimelineProminence)}>
                {PROMINENCES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Start (year, year-month, or full date)">
              <input className={inputCls} value={startDate} onChange={(e) => setStartDate(e.target.value)} placeholder="1986 or 1999-06" required />
            </Field>
            <Field label="End (optional)">
              <input className={inputCls} value={endDate} onChange={(e) => setEndDate(e.target.value)} placeholder="leave blank for a moment" />
            </Field>
          </div>

          <Field label="Location">
            <input className={inputCls} value={location} onChange={(e) => setLocation(e.target.value)} placeholder="optional" />
          </Field>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={approximate} onChange={(e) => setApproximate(e.target.checked)} />
            <span>Approximate date</span>
          </label>

          {familyPeople.length > 0 && (
            <div>
              <span className="mb-1 block text-xs font-medium text-muted-foreground">Whose event (subjects)</span>
              <div className="flex flex-wrap gap-1.5">
                {familyPeople.map((p) => {
                  const on = subjects.has(p.email);
                  return (
                    <button
                      key={p.email}
                      type="button"
                      onClick={() => toggleSubject(p.email)}
                      className={cn(
                        "rounded-full border px-2.5 py-0.5 text-xs",
                        on ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground"
                      )}
                    >
                      {p.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={pending}
              className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-60"
            >
              {pending ? "Saving…" : entry ? "Save" : "Create"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
