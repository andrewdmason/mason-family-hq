"use client";

import { useState, useTransition } from "react";
import { Activity, Info, Loader2, Check, AlertTriangle } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { resendToWhoop } from "@/app/(workouts)/workouts/actions";
import type { PushResult, DryRunResult } from "@/lib/whoop/push";
import type { InputSet } from "@/lib/whoop/build-lift-body";

type Status = "synced" | "dirty" | "failed" | "syncing" | null;

const trim = (n: number): string =>
  Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10);

/** One set as "5 × 135 lb (61 kg)" — kg is what's actually sent to WHOOP. */
function formatPreviewSet(s: InputSet): string {
  if (!s.weight || s.weightKg === 0) return `${s.reps} reps`;
  if (s.unit === "kg") return `${s.reps} × ${trim(s.weightKg)} kg`;
  return `${s.reps} × ${trim(s.weight)} lb (${trim(s.weightKg)} kg)`;
}

/**
 * The completed-session WHOOP follow-up: a prominent card that sends the logged
 * resistance work to WHOOP's Strength Trainer, with an info popover showing
 * exactly what will be sent (for troubleshooting) and a live status readout of
 * the result. Only rendered for a completed session on a WHOOP-connected owner.
 */
export function WhoopSyncPanel({
  sessionId,
  status,
  syncedAt,
  error,
  preview,
}: {
  sessionId: string;
  status: Status;
  syncedAt: string | null;
  error: string | null;
  preview: DryRunResult | null;
}) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<PushResult | null>(null);

  const send = () =>
    startTransition(async () => {
      const r = await resendToWhoop(sessionId);
      setResult(r);
    });

  const sending = pending || status === "syncing";
  const sendLabel =
    status === "synced"
      ? "Send again"
      : status === "dirty"
        ? "Re-send to WHOOP"
        : status === "failed"
          ? "Retry"
          : "Send to WHOOP";

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-1.5">
          <Activity className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate text-sm font-medium text-foreground">
            WHOOP Strength Trainer
          </span>
          <PreviewPopover preview={preview} />
        </div>
        <button
          type="button"
          disabled={sending}
          onClick={send}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-input bg-background px-2.5 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-60"
        >
          {sending && <Loader2 className="size-4 animate-spin" />}
          {sending ? "Sending…" : sendLabel}
        </button>
      </div>

      <StatusReadout
        sending={sending}
        result={result}
        status={status}
        syncedAt={syncedAt}
        error={error}
      />
    </div>
  );
}

function StatusReadout({
  sending,
  result,
  status,
  syncedAt,
  error,
}: {
  sending: boolean;
  result: PushResult | null;
  status: Status;
  syncedAt: string | null;
  error: string | null;
}) {
  if (sending) {
    return (
      <p className="mt-2 text-xs text-muted-foreground">Sending to WHOOP…</p>
    );
  }

  // Immediate readout from the send we just did takes precedence.
  if (result) {
    if (result.status === "synced") {
      const n = result.exerciseCount ?? 0;
      return (
        <div className="mt-2 text-xs">
          <p className="inline-flex items-center gap-1.5 text-emerald-700">
            <Check className="size-3.5" />
            {n > 0
              ? `Logged ${n} exercise${n === 1 ? "" : "s"} · ${result.setCount ?? 0} sets to WHOOP`
              : "Synced — nothing to send (no mapped resistance movements)"}
          </p>
          {result.workoutId && (
            <p className="mt-0.5 text-muted-foreground/70">
              WHOOP workout id: {result.workoutId}
            </p>
          )}
          {result.skipped && result.skipped.length > 0 && (
            <p className="mt-0.5 text-muted-foreground">
              Not sent: {result.skipped.join("; ")}
            </p>
          )}
        </div>
      );
    }
    if (result.status === "failed") {
      return (
        <p className="mt-2 inline-flex items-start gap-1.5 text-xs text-red-600">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <span>Send failed: {result.error ?? "unknown error"}</span>
        </p>
      );
    }
    if (result.status === "skipped") {
      return (
        <p className="mt-2 text-xs text-muted-foreground">
          {result.error ?? "Nothing to send."}
        </p>
      );
    }
    return (
      <p className="mt-2 text-xs text-muted-foreground">Already up to date.</p>
    );
  }

  // Otherwise reflect the persisted state from the last page render.
  if (status === "synced") {
    return (
      <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <span className="text-emerald-600">✓</span> Sent to WHOOP
        {syncedAt && <span className="text-muted-foreground/70">· {syncedAt.slice(0, 10)}</span>}
      </p>
    );
  }
  if (status === "dirty") {
    return (
      <p className="mt-2 text-xs text-amber-700">
        Edited since last sync — re-send to update WHOOP.
      </p>
    );
  }
  if (status === "failed") {
    return (
      <p className="mt-2 inline-flex items-start gap-1.5 text-xs text-red-600">
        <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
        <span>Last sync failed{error ? `: ${error}` : ""}</span>
      </p>
    );
  }
  return (
    <p className="mt-2 text-xs text-muted-foreground">
      Not sent to WHOOP yet.
    </p>
  );
}

/** ⓘ — shows exactly what the push will send, for troubleshooting. */
function PreviewPopover({ preview }: { preview: DryRunResult | null }) {
  const exercises = preview?.exercises ?? [];
  const skipped = preview?.skipped ?? [];
  const unknown = preview?.unknownExercises ?? [];

  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label="What will be sent to WHOOP"
            className="inline-flex size-5 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        }
      >
        <Info className="size-4" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80">
        <div className="text-sm font-medium text-foreground">
          What will be sent to WHOOP
        </div>
        <p className="text-xs text-muted-foreground">
          {preview
            ? `${preview.exerciseCount} exercise${preview.exerciseCount === 1 ? "" : "s"} · ${preview.setCount} set${preview.setCount === 1 ? "" : "s"}. Weights go over as kg.`
            : "Nothing to preview."}
        </p>

        {exercises.length > 0 ? (
          <div className="max-h-56 space-y-2 overflow-y-auto rounded-md bg-muted/40 p-2">
            {exercises.map((ex, i) => (
              <div key={`${ex.exerciseId}-${i}`} className="text-xs">
                <div className="font-medium text-foreground">{ex.label}</div>
                <div className="text-muted-foreground/80">
                  {ex.sets.map((s) => formatPreviewSet(s)).join(", ")}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            No resistance movements will be sent.
          </p>
        )}

        {skipped.length > 0 && (
          <div className="text-xs">
            <div className="font-medium text-muted-foreground">Not sent</div>
            <ul className="mt-0.5 list-disc pl-4 text-muted-foreground/80">
              {skipped.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          </div>
        )}

        {unknown.length > 0 && (
          <div className="text-xs">
            <div className="font-medium text-amber-700">Unknown to WHOOP</div>
            <ul className="mt-0.5 list-disc pl-4 text-muted-foreground/80">
              {unknown.map((u, i) => (
                <li key={i}>
                  {u.label}{" "}
                  <span className="text-muted-foreground/60">({u.exerciseId})</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {preview?.body && (
          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
              Raw payload
            </summary>
            <pre className="mt-1 max-h-48 overflow-auto rounded-md bg-muted/40 p-2 text-[10px] leading-relaxed text-muted-foreground">
              {JSON.stringify(preview.body, null, 2)}
            </pre>
          </details>
        )}
      </PopoverContent>
    </Popover>
  );
}
