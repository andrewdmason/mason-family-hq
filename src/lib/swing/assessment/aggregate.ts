// Cross-clip pattern aggregation: per-swing metrics → batch-level medians,
// spread, and pooled confidence. R4 is enforced HERE structurally — patterns
// require ≥3 usable swings, and nothing single-swing ever reaches the prompt
// as a conclusion. Pure module (verify script runs it on fixtures).

import {
  METRIC_KEYS,
  MIN_USABLE_CLIPS,
  LOW_SAMPLE_THRESHOLD,
  type MetricConfidence,
  type MetricKey,
  type SwingMetrics,
} from "@/lib/swing/types";

export interface MetricAggregate {
  key: MetricKey;
  unit: string;
  /** How many of the batch's swings produced this metric. */
  count: number;
  median: number;
  min: number;
  max: number;
  /** max - min — the consistency signal (kids are inconsistent; a tight
   * spread on a bad value is more coachable than a wild spread). */
  spread: number;
  /** Pooled = the MEDIAN per-swing confidence, floored to "low" when fewer
   * than half the batch's swings produced the metric at all. */
  confidence: MetricConfidence;
  values: number[];
}

export interface BatchAggregates {
  swingCount: number;
  /** True when 3–4 swings: enough for patterns, flagged in the output. */
  lowSample: boolean;
  metrics: MetricAggregate[];
}

const CONFIDENCE_RANK: Record<MetricConfidence, number> = {
  low: 0,
  medium: 1,
  high: 2,
};
const RANK_CONFIDENCE: MetricConfidence[] = ["low", "medium", "high"];

export function aggregateClips(
  clipMetrics: SwingMetrics[]
): BatchAggregates | null {
  const swingCount = clipMetrics.length;
  if (swingCount < MIN_USABLE_CLIPS) return null;

  const metrics: MetricAggregate[] = [];
  for (const key of METRIC_KEYS) {
    const present = clipMetrics
      .map((m) => m[key])
      .filter((v): v is NonNullable<typeof v> => v !== undefined);
    if (present.length === 0) continue;

    const values = present.map((v) => v.value).sort((a, b) => a - b);
    const median = values[Math.floor(values.length / 2)];
    const ranks = present
      .map((v) => CONFIDENCE_RANK[v.confidence])
      .sort((a, b) => a - b);
    let confidence = RANK_CONFIDENCE[ranks[Math.floor(ranks.length / 2)]];
    if (present.length < swingCount / 2) confidence = "low";

    metrics.push({
      key,
      unit: present[0].unit,
      count: present.length,
      median,
      min: values[0],
      max: values[values.length - 1],
      spread: values[values.length - 1] - values[0],
      confidence,
      values,
    });
  }

  return {
    swingCount,
    lowSample: swingCount < LOW_SAMPLE_THRESHOLD,
    metrics,
  };
}
