// Server-side shape validation for client-computed extraction payloads.
// The server can never RECOMPUTE metrics (raw video never reaches it — R12),
// but it controls what it stores: only known metric keys with finite values
// and valid enums survive, only known phases with finite timestamps, and
// paths are never accepted from the client at all (the issuing action writes
// the paths it generated). Anything else is dropped silently — a hostile or
// buggy client can degrade its own assessment, not corrupt the schema.

import {
  METRIC_KEYS,
  SWING_PHASES,
  type Bats,
  type MetricConfidence,
  type MetricKey,
  type SwingEvents,
  type SwingMetrics,
} from "@/lib/swing/types";

const CONFIDENCES = new Set(["high", "medium", "low"]);
const UNITS = new Set(["ratio", "deg", "ms", "norm"]);
const METRIC_KEY_SET = new Set<string>(METRIC_KEYS);
const PHASE_SET = new Set<string>(SWING_PHASES);

export function sanitizeMetrics(input: unknown): SwingMetrics {
  const out: SwingMetrics = {};
  if (typeof input !== "object" || input === null) return out;
  for (const [key, raw] of Object.entries(input as Record<string, unknown>)) {
    if (!METRIC_KEY_SET.has(key)) continue;
    if (typeof raw !== "object" || raw === null) continue;
    const v = raw as { value?: unknown; confidence?: unknown; unit?: unknown };
    if (typeof v.value !== "number" || !Number.isFinite(v.value)) continue;
    if (typeof v.confidence !== "string" || !CONFIDENCES.has(v.confidence)) continue;
    if (typeof v.unit !== "string" || !UNITS.has(v.unit)) continue;
    out[key as MetricKey] = {
      value: v.value,
      confidence: v.confidence as MetricConfidence,
      unit: v.unit as "ratio" | "deg" | "ms" | "norm",
    };
  }
  return out;
}

export function sanitizeEvents(input: unknown): SwingEvents {
  const out: SwingEvents = {};
  if (typeof input !== "object" || input === null) return out;
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (!PHASE_SET.has(key)) continue;
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) continue;
    out[key as keyof SwingEvents] = value;
  }
  return out;
}

export function sanitizeBats(input: unknown): Bats | null {
  return input === "L" || input === "R" ? input : null;
}

export function sanitizeFiniteNumber(input: unknown): number | null {
  return typeof input === "number" && Number.isFinite(input) ? input : null;
}

export function sanitizeAnnotations(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((a): a is string => typeof a === "string")
    .map((a) => a.slice(0, 60))
    .slice(0, 12);
}
