"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { createManualSession } from "@/app/(workouts)/workouts/actions";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

/**
 * Log an ad-hoc workout by pasting or typing its description. It runs through the
 * same AI parse as calendar workouts, so you land on a structured session ready
 * to edit — no manual set-by-set entry required.
 */
export function NewSessionForm({ today }: { today: string }) {
  const [date, setDate] = useState(today);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [pending, startTransition] = useTransition();

  const canSubmit = description.trim().length > 0 && !pending;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!canSubmit) return;
        startTransition(() =>
          createManualSession({ date, title: title.trim() || undefined, description })
        );
      }}
      className="flex flex-col gap-4"
    >
      <div className="flex flex-wrap gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="wod-date">Date</Label>
          <Input
            id="wod-date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-44"
          />
        </div>
        <div className="flex min-w-[12rem] flex-1 flex-col gap-1.5">
          <Label htmlFor="wod-title">Title (optional)</Label>
          <Input
            id="wod-title"
            value={title}
            placeholder="e.g. Back squat + Fran"
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="wod-desc">Workout</Label>
        <Textarea
          id="wod-desc"
          value={description}
          placeholder="Paste or type the workout, e.g. '5x5 back squat @ 225, then 21-15-9 thrusters (95) and pull-ups for time.'"
          onChange={(e) => setDescription(e.target.value)}
          className="min-h-[140px]"
        />
        <p className="text-xs text-muted-foreground">
          We&apos;ll structure it for you — you can fix anything afterward.
        </p>
      </div>

      <button
        type="submit"
        disabled={!canSubmit}
        className="inline-flex w-fit items-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
      >
        {pending ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            Structuring…
          </>
        ) : (
          "Create workout"
        )}
      </button>
    </form>
  );
}
