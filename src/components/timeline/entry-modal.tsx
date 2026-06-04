"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ImagePlus, Play, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { TIMELINE_CATEGORIES } from "@/lib/types";
import type {
  TimelineCategory,
  TimelineEntryWithPeople,
  TimelineProminence,
} from "@/lib/types";
import { CATEGORY_LABEL } from "@/lib/timeline/config";
import { createTimelineEntry, updateTimelineEntry } from "@/lib/timeline/actions";
import {
  MAX_UPLOAD_BYTES,
  detectMediaType,
  uploadTimelineMedia,
} from "@/lib/journal/photo-upload";
import { readImageDateTaken } from "@/lib/journal/image-date";
import {
  TimelineDatePicker,
  dateStateFromEntry,
  dateStateToInput,
  emptyDateState,
  type TimelineDateState,
} from "./date-picker";

const PROMINENCES: TimelineProminence[] = ["major", "medium", "minor"];

/** A precise day-precision date from a photo's "YYYY-MM-DD" EXIF date. */
function dateStateFromPhotoDate(date: string): TimelineDateState {
  return { precision: "day", isRange: false, start: date, end: "" };
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
 * optional `defaultSubjectEmail`) to create a new one. `initialFiles` stages
 * photos/videos dropped onto the timeline before the event exists — they're
 * uploaded once the event is saved, and the first photo's EXIF date seeds the
 * "When" field.
 */
export function EntryModal({
  entry,
  familyPeople,
  defaultSubjectEmail,
  initialFiles,
  onClose,
}: {
  entry?: TimelineEntryWithPeople | null;
  familyPeople: { email: string; name: string }[];
  defaultSubjectEmail?: string | null;
  initialFiles?: File[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [title, setTitle] = useState(entry?.title ?? "");
  const [description, setDescription] = useState(entry?.description ?? "");
  const [category, setCategory] = useState<TimelineCategory>(entry?.category ?? "career");
  const [prominence, setProminence] = useState<TimelineProminence>(entry?.prominence ?? "medium");
  const [location, setLocation] = useState(entry?.location ?? "");
  const [dateState, setDateState] = useState(() =>
    entry ? dateStateFromEntry(entry) : emptyDateState()
  );
  // Once a date is set deliberately (existing entry, manual pick, or already
  // adopted from a photo), stop auto-adopting it from newly dropped photos.
  const dateChosenRef = useRef(Boolean(entry?.start_date));
  const [approximate, setApproximate] = useState(entry?.approximate ?? false);

  // Photos/videos staged for upload after the event is saved.
  const [files, setFiles] = useState<File[]>(() => initialFiles ?? []);
  const [previews, setPreviews] = useState<{ url: string; isVideo: boolean }[]>([]);

  useEffect(() => {
    const next = files.map((f) => ({
      url: URL.createObjectURL(f),
      isVideo: detectMediaType(f) === "video",
    }));
    setPreviews(next);
    return () => next.forEach((p) => URL.revokeObjectURL(p.url));
  }, [files]);

  // Seed the date from the first photo's EXIF date unless one is already set.
  const adoptDate = useCallback(async (candidates: File[]) => {
    if (dateChosenRef.current) return;
    const firstPhoto = candidates.find((f) => detectMediaType(f) === "photo");
    if (!firstPhoto) return;
    const taken = await readImageDateTaken(firstPhoto);
    if (taken && !dateChosenRef.current) {
      dateChosenRef.current = true;
      setDateState(dateStateFromPhotoDate(taken));
    }
  }, []);

  // Adopt the date from photos staged at open (a timeline-background drop).
  useEffect(() => {
    if (!entry && initialFiles?.length) void adoptDate(initialFiles);
    // Run once on mount with the files we opened with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function addFiles(incoming: File[]) {
    const valid = incoming.filter((f) => detectMediaType(f) && f.size <= MAX_UPLOAD_BYTES);
    if (valid.length === 0) return;
    setFiles((prev) => [...prev, ...valid]);
    void adoptDate(valid);
  }

  function removeFile(index: number) {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }
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
    const { start: startInput, end: endInput } = dateStateToInput(dateState);
    if (!startInput) {
      setError("Pick a date for this event.");
      return;
    }
    start(async () => {
      const input = {
        title,
        description,
        category,
        prominence,
        location: location || null,
        start: startInput,
        end: endInput,
        approximate,
        subjectEmails: [...subjects],
      };
      try {
        const id = entry
          ? (await updateTimelineEntry(entry.id, input), entry.id)
          : await createTimelineEntry(input);
        if (files.length > 0) {
          await Promise.all(files.map((f) => uploadTimelineMedia(id, f)));
        }
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
        className={cn(
          "max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border bg-background p-5 shadow-xl transition-colors",
          dragOver ? "border-primary ring-2 ring-primary" : "border-border"
        )}
        onClick={(e) => e.stopPropagation()}
        onDragEnter={(ev) => {
          if (ev.dataTransfer?.types?.includes("Files")) {
            ev.preventDefault();
            setDragOver(true);
          }
        }}
        onDragOver={(ev) => {
          if (ev.dataTransfer?.types?.includes("Files")) ev.preventDefault();
        }}
        onDragLeave={(ev) => {
          if (!ev.currentTarget.contains(ev.relatedTarget as Node)) setDragOver(false);
        }}
        onDrop={(ev) => {
          if (!ev.dataTransfer?.types?.includes("Files")) return;
          ev.preventDefault();
          setDragOver(false);
          const dropped = Array.from(ev.dataTransfer.files ?? []);
          if (dropped.length) addFiles(dropped);
        }}
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

          <Field label="When">
            <TimelineDatePicker
              value={dateState}
              onChange={(next) => {
                dateChosenRef.current = true;
                setDateState(next);
              }}
            />
          </Field>

          <Field label="Location">
            <input className={inputCls} value={location} onChange={(e) => setLocation(e.target.value)} placeholder="optional" />
          </Field>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={approximate} onChange={(e) => setApproximate(e.target.checked)} />
            <span>Approximate date</span>
          </label>

          <div>
            <span className="mb-1 block text-xs font-medium text-muted-foreground">Photos</span>
            <div className="flex flex-wrap gap-2">
              {previews.map((p, i) => (
                <div
                  key={p.url}
                  className="group relative h-16 w-16 overflow-hidden rounded-md border border-border bg-muted"
                >
                  {p.isVideo ? (
                    <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                      <Play className="h-5 w-5" />
                    </div>
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.url} alt="" className="h-full w-full object-cover" />
                  )}
                  <button
                    type="button"
                    onClick={() => removeFile(i)}
                    aria-label="Remove photo"
                    className="absolute right-0.5 top-0.5 hidden rounded-full bg-black/60 p-0.5 text-white transition hover:bg-black/80 group-hover:block"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                aria-label="Add photos"
                className="flex h-16 w-16 items-center justify-center rounded-md border border-dashed border-border text-muted-foreground transition hover:border-foreground/40 hover:text-foreground"
              >
                <ImagePlus className="h-5 w-5" />
              </button>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,video/*"
              multiple
              className="hidden"
              onChange={(ev) => {
                const picked = Array.from(ev.target.files ?? []);
                ev.target.value = "";
                if (picked.length) addFiles(picked);
              }}
            />
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              Drop photos anywhere on this form to attach them — the first photo&rsquo;s date fills in “When”.
            </p>
          </div>

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
