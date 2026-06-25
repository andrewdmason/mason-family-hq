"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createMilestone,
  deleteMilestone,
  markMilestoneAwarded,
  previewMilestoneCount,
  updateMilestone,
} from "@/app/(reading)/reader/quizzes/milestone-actions";
import { uploadMilestoneImage } from "@/lib/reading/milestone-image-upload";
import { ProgressBar } from "@/components/reading/progress-bar";
import type { ReadingAdminMilestone } from "@/lib/types";

type Metric = "bonus_pages" | "total_pages";

const METRIC_LABEL: Record<Metric, string> = {
  bonus_pages: "Bonus pages",
  total_pages: "Total pages read",
};

function MilestoneItem({
  milestone,
  memberEmail,
}: {
  milestone: ReadingAdminMilestone;
  memberEmail: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const pct = Math.min(
    100,
    Math.round((milestone.current / milestone.threshold) * 100)
  );

  function run(fn: () => Promise<void>) {
    setError(null);
    startTransition(async () => {
      try {
        await fn();
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong.");
      }
    });
  }

  return (
    <div className="rounded-lg border border-border px-3 py-2.5">
      <div className="flex items-center gap-3">
        <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-md bg-muted">
          {milestone.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={milestone.imageUrl}
              alt={`Reward: ${milestone.title}`}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-muted-foreground">
              <Trophy className="h-4 w-4" />
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="truncate text-sm font-medium text-foreground">
              {milestone.title}
            </span>
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
              {milestone.current.toLocaleString()} /{" "}
              {milestone.threshold.toLocaleString()}
            </span>
          </div>
          <p className="text-[0.7rem] text-muted-foreground">
            {METRIC_LABEL[milestone.metric]}
            {milestone.startOn ? ` · since ${milestone.startOn}` : " · all time"}
          </p>
          <ProgressBar pct={pct} reached={milestone.achieved} className="mt-1.5" />
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
        {milestone.achieved && (
          <span className="mr-auto inline-flex items-center rounded-full bg-amber-500/15 px-2 py-0.5 text-[0.7rem] font-medium text-amber-700 dark:text-amber-400">
            Achieved 🎉
          </span>
        )}
        {milestone.achieved && (
          <Button
            type="button"
            variant="default"
            size="sm"
            disabled={pending}
            onClick={() =>
              run(() => markMilestoneAwarded(milestone.id, memberEmail))
            }
          >
            Mark as awarded
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={() => run(() => deleteMilestone(milestone.id, memberEmail))}
        >
          Delete
        </Button>
      </div>
      {error && <p className="mt-1 text-right text-xs text-destructive">{error}</p>}
    </div>
  );
}

function CreateForm({
  memberEmail,
  onDone,
}: {
  memberEmail: string;
  onDone: () => void;
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [metric, setMetric] = useState<Metric>("bonus_pages");
  const [threshold, setThreshold] = useState("");
  const [startOn, setStartOn] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Show the kid's current count for the chosen metric + start date, so the
  // threshold can be calibrated against where they already are.
  useEffect(() => {
    let cancelled = false;
    previewMilestoneCount(memberEmail, metric, startOn || null)
      .then((n) => {
        if (!cancelled) setPreview(n);
      })
      .catch(() => {
        if (!cancelled) setPreview(null);
      });
    return () => {
      cancelled = true;
    };
  }, [memberEmail, metric, startOn]);

  async function submit() {
    setError(null);
    const n = Number(threshold);
    if (!title.trim()) return setError("Give the milestone a title.");
    if (!Number.isFinite(n) || n <= 0) return setError("Enter a positive threshold.");
    setSaving(true);
    try {
      const { milestoneId } = await createMilestone({
        memberEmail,
        title,
        metric,
        threshold: n,
        startOn: startOn || null,
      });
      if (file) {
        const path = await uploadMilestoneImage(milestoneId, file, memberEmail);
        await updateMilestone(milestoneId, { imagePath: path }, memberEmail);
      }
      router.refresh();
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create the milestone.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-dashed border-border px-3 py-3">
      <div className="space-y-1">
        <Label htmlFor="ms-title">Title</Label>
        <Input
          id="ms-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Baseball bat"
        />
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="space-y-1">
          <Label htmlFor="ms-metric">Counts</Label>
          <select
            id="ms-metric"
            value={metric}
            onChange={(e) => setMetric(e.target.value as Metric)}
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          >
            <option value="bonus_pages">Bonus pages</option>
            <option value="total_pages">Total pages read</option>
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="ms-threshold">Threshold</Label>
          <Input
            id="ms-threshold"
            type="number"
            min={1}
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
            placeholder="1000"
            className="w-28"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="ms-start">Counting from</Label>
          <Input
            id="ms-start"
            type="date"
            value={startOn}
            onChange={(e) => setStartOn(e.target.value)}
            className="w-40"
          />
        </div>
      </div>

      {preview != null && (
        <p className="text-xs text-muted-foreground">
          So far: <span className="font-medium text-foreground">
            {preview.toLocaleString()}
          </span>{" "}
          {METRIC_LABEL[metric].toLowerCase()}
          {startOn ? ` since ${startOn}` : " all time"}.
        </p>
      )}

      <div className="space-y-1">
        <Label htmlFor="ms-image">Reward image (optional)</Label>
        <input
          id="ms-image"
          ref={fileRef}
          type="file"
          accept="image/*"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="block text-xs text-muted-foreground file:mr-3 file:rounded-md file:border file:border-border file:bg-background file:px-2 file:py-1 file:text-xs"
        />
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      <div className="flex items-center justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onDone} disabled={saving}>
          Cancel
        </Button>
        <Button type="button" size="sm" onClick={submit} disabled={saving}>
          {saving ? "Saving…" : "Create milestone"}
        </Button>
      </div>
    </div>
  );
}

/** Per-kid milestone management for the Parent Admin console. */
export function MilestoneAdmin({
  milestones,
  memberEmail,
}: {
  milestones: ReadingAdminMilestone[];
  memberEmail: string;
}) {
  const [adding, setAdding] = useState(false);

  return (
    <div className="rounded-xl border border-border">
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Reward milestones
        </p>
        {!adding && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setAdding(true)}
          >
            <Plus className="mr-1 h-3.5 w-3.5" />
            Add milestone
          </Button>
        )}
      </div>
      <div className="space-y-2.5 px-4 py-3">
        {milestones.length === 0 && !adding && (
          <p className="text-sm text-muted-foreground">
            No milestones yet. Add one to reward reading above and beyond.
          </p>
        )}
        {milestones.map((m) => (
          <MilestoneItem key={m.id} milestone={m} memberEmail={memberEmail} />
        ))}
        {adding && (
          <CreateForm memberEmail={memberEmail} onDone={() => setAdding(false)} />
        )}
      </div>
    </div>
  );
}
