import { CheckCircle2 } from "lucide-react";
import type { EntryView, SessionDetail, SetView } from "@/lib/workouts/queries";
import {
  BLOCK_TYPE_LABEL,
  formatScore,
  formatSetMetric,
} from "@/lib/workouts/format";

// Session effort/energy flags, mirrored from session-flags.tsx for the read-only
// recap. Both are nullable: null means a normal day and shows no chip.
const EFFORT_LABEL: Record<string, { emoji: string; label: string }> = {
  easier: { emoji: "😌", label: "Easier than normal" },
  harder: { emoji: "🥵", label: "Harder than normal" },
};
const ENERGY_LABEL: Record<string, { emoji: string; label: string }> = {
  low: { emoji: "🪫", label: "Low energy" },
  high: { emoji: "⚡", label: "High energy" },
};

const trimNum = (n: number): string =>
  Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10);

/** A set as a compact label; reps-only reads "8 reps" rather than "× 8". */
function setLabel(s: SetView): string {
  if (s.metricType === "reps") {
    return s.actual.reps != null ? `${s.actual.reps} reps` : "—";
  }
  return formatSetMetric(s.metricType, s.actual);
}

/** Collapse an entry's logged sets into one line + its best (strict) e1RM. */
function summarizeEntry(e: EntryView): { detail: string; e1rm: number | null } {
  const sets = e.sets;
  if (sets.length === 0) return { detail: "", e1rm: null };

  let e1rm: number | null = null;
  for (const s of sets) {
    if (s.e1rm != null && !s.e1rmIsLoose) e1rm = Math.max(e1rm ?? 0, s.e1rm);
  }

  // A metcon movement's result lives on the block score; show its scheme only.
  const isMetcon = (sets[0].context ?? "strength") === "metcon";
  if (isMetcon) {
    return {
      detail: sets
        .map(setLabel)
        .filter((l) => l !== "—")
        .join(", "),
      e1rm: null,
    };
  }

  const first = sets[0];
  const uniform = sets.every(
    (s) =>
      s.metricType === first.metricType &&
      s.actual.reps === first.actual.reps &&
      s.actual.load === first.actual.load,
  );
  const label = setLabel(first);
  if (uniform) {
    if (label === "—") return { detail: "", e1rm };
    return {
      detail: sets.length > 1 ? `${sets.length} × ${label}` : label,
      e1rm,
    };
  }
  return {
    detail: sets
      .map(setLabel)
      .filter((l) => l !== "—")
      .join(", "),
    e1rm,
  };
}

/**
 * The read-only recap of a completed session, as ONE green card with stacked
 * sections divided by hairlines:
 *   1. a "done" hero with the few numbers that matter (headline stats),
 *   2. a per-block breakdown of what was logged,
 *   3. notes,
 *   4. the WHOOP follow-up (passed in as `whoop`, since it's client + needs a
 *      server-computed preview), living inside the same card.
 * Server component — pure formatting over the already-fetched session.
 */
export function WorkoutSummary({
  session,
  whoop,
}: {
  session: SessionDetail;
  whoop?: React.ReactNode;
}) {
  const entries = session.blocks.flatMap((b) => b.entries);
  const setCount = entries.reduce((n, e) => n + e.sets.length, 0);

  let volume = 0;
  let top: { name: string; value: number } | null = null;
  for (const e of entries) {
    const name = e.canonicalName ?? e.rawName;
    for (const s of e.sets) {
      if (s.metricType === "load_reps" && s.actual.load && s.actual.reps) {
        volume += s.actual.load * s.actual.reps;
      }
      if (
        s.e1rm != null &&
        !s.e1rmIsLoose &&
        (top === null || s.e1rm > top.value)
      ) {
        top = { name, value: s.e1rm };
      }
    }
  }

  // Headline stats: only the ones that carry signal for this session.
  const stats: { value: string; label: string }[] = [
    { value: String(setCount), label: setCount === 1 ? "set" : "sets" },
  ];
  if (volume > 0) {
    stats.push({
      value: Math.round(volume).toLocaleString(),
      label: "lb volume",
    });
  }
  if (top) {
    stats.push({ value: trimNum(top.value), label: `${top.name} e1RM` });
  }

  const effort = session.effort ? EFFORT_LABEL[session.effort] : null;
  const energy = session.energy ? ENERGY_LABEL[session.energy] : null;
  const note = session.notes?.trim();

  const sectionBorder = "border-t border-emerald-600/15";

  return (
    <div className="overflow-hidden rounded-xl border border-emerald-600/30 bg-emerald-500/[0.05]">
      {/* 1. Done hero — celebration + the numbers that matter. */}
      <div className="p-4">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="size-4 text-emerald-600" />
          <span className="text-sm font-medium text-emerald-700">
            Completed — nice work
          </span>
          {(effort || energy) && (
            <span className="ml-auto flex flex-wrap items-center justify-end gap-x-3 gap-y-1 text-xs text-muted-foreground">
              {effort && (
                <span className="inline-flex items-center gap-1">
                  <span className="text-base leading-none">{effort.emoji}</span>
                  {effort.label}
                </span>
              )}
              {energy && (
                <span className="inline-flex items-center gap-1">
                  <span className="text-base leading-none">{energy.emoji}</span>
                  {energy.label}
                </span>
              )}
            </span>
          )}
        </div>
        <div className="mt-3 flex flex-wrap gap-x-8 gap-y-3">
          {stats.map((s, i) => (
            <div key={i}>
              <div className="font-serif text-xl tabular-nums text-foreground">
                {s.value}
              </div>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                {s.label}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 2. Per-block breakdown, each a hairline-divided section. */}
      {session.blocks.map((block) => {
        const scoreLabel = formatScore(block.scoreType, block.score);
        const lines = block.entries.map((e) => ({
          name: e.canonicalName ?? e.rawName,
          ...summarizeEntry(e),
        }));
        if (lines.length === 0 && !scoreLabel) return null;
        return (
          <div key={block.id} className={`${sectionBorder} p-4`}>
            <div className="mb-2.5 flex items-baseline justify-between gap-2">
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {block.title ?? BLOCK_TYPE_LABEL[block.blockType]}
              </span>
              {scoreLabel && (
                <span className="text-sm font-medium tabular-nums text-foreground">
                  {scoreLabel}
                </span>
              )}
            </div>
            <ul className="flex flex-col gap-2">
              {lines.map((line, i) => (
                <li
                  key={i}
                  className="flex items-baseline justify-between gap-3 text-sm"
                >
                  <span className="text-foreground">{line.name}</span>
                  <span className="flex items-baseline gap-2">
                    <span className="tabular-nums text-muted-foreground">
                      {line.detail || "—"}
                    </span>
                    {line.e1rm != null && (
                      <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[11px] tabular-nums text-primary">
                        e1RM {trimNum(line.e1rm)}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        );
      })}

      {/* 3. Notes. */}
      {note && (
        <div className={`${sectionBorder} p-4`}>
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Notes
          </p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">
            {note}
          </p>
        </div>
      )}

      {/* 4. WHOOP follow-up, inside the same card. */}
      {whoop && <div className={`${sectionBorder} p-4`}>{whoop}</div>}
    </div>
  );
}
