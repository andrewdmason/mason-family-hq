// The "quick version" of an at-bat: just the moments around each pitch, with a
// slow-motion replay of every swing. The in-app player walks this plan in
// quick mode, and the export worker renders the same plan to a video file, so
// what you watch is what the coach gets.
//
// These are starting numbers, meant to be tuned after watching real at-bats.

import {
  countsBefore,
  isContact,
  isSwing,
  outcomeLabel,
  resultLabel,
  type AtBatResult,
  type ClipPitch,
} from "./types";

export const QUICK = {
  /** Seconds shown before the ball reaches the plate — the load and stride. */
  lead: 2,
  /** Seconds after the pitch on a take or a miss. */
  tail: 1,
  /** Seconds after contact — the follow-through and leaving the box. */
  contactTail: 3,
  /** The swing replay window around the pitch moment (stride → follow-through). */
  replayBefore: 0.8,
  replayAfter: 0.4,
  /** Replay speed. */
  replayRate: 0.25,
} as const;

/** Where next/previous-pitch jumps land: a lead-in before the marker. */
export function jumpTarget(t: number): number {
  return Math.max(0, t - QUICK.lead);
}

export type PlanSegment = {
  /** Source time range in the original video, in seconds. */
  start: number;
  end: number;
  /** 1 for real speed, QUICK.replayRate for a swing replay. */
  rate: number;
  /** Replays are muted — slowed-down crowd noise sounds awful. */
  muted: boolean;
  /** Burned into the export; shown as an overlay in the player. */
  caption: string;
  /** Index into the at-bat's sorted pitch list. */
  pitchIndex: number;
  replay: boolean;
};

/** "Pitch 4 · 1-2 · Foul" — the count is before the pitch, like a scorebook. */
export function pitchCaption(
  p: Pick<ClipPitch, "outcome">,
  n: number,
  count: string,
  isLast: boolean,
  result: AtBatResult | null,
): string {
  const parts = [`Pitch ${n}`, count];
  if (p.outcome) parts.push(outcomeLabel(p.outcome));
  const label = isLast ? resultLabel(result) : null;
  if (label) parts.push(label);
  return parts.join(" · ");
}

/**
 * Build the quick-version plan for one at-bat. Pitch windows that would overlap
 * (two pitches seconds apart) are clipped so no moment plays twice at real
 * speed; replays always follow their pitch's real-speed window.
 */
export function buildQuickPlan(
  pitches: ClipPitch[],
  duration: number,
  result: AtBatResult | null,
): PlanSegment[] {
  const sorted = [...pitches].sort((a, b) => a.t - b.t);
  const segments: PlanSegment[] = [];
  const counts = countsBefore(sorted);
  let prevEnd = 0;
  sorted.forEach((p, i) => {
    const isLast = i === sorted.length - 1;
    const caption = pitchCaption(p, i + 1, counts[i], isLast, result);
    const start = Math.max(0, p.t - QUICK.lead, prevEnd);
    const end = Math.min(duration, p.t + (isContact(p) ? QUICK.contactTail : QUICK.tail));
    if (end - start > 0.05) {
      segments.push({ start, end, rate: 1, muted: false, caption, pitchIndex: i, replay: false });
      prevEnd = end;
    }
    if (isSwing(p)) {
      const rs = Math.max(0, p.t - QUICK.replayBefore);
      const re = Math.min(duration, p.t + QUICK.replayAfter);
      if (re - rs > 0.05) {
        segments.push({
          start: rs,
          end: re,
          rate: QUICK.replayRate,
          muted: true,
          caption: `${caption} · Replay`,
          pitchIndex: i,
          replay: true,
        });
      }
    }
  });
  return segments;
}

/** Total playing time of a plan, in seconds (replays count at their slowed length). */
export function planDuration(plan: PlanSegment[]): number {
  return plan.reduce((sum, s) => sum + (s.end - s.start) / s.rate, 0);
}

/** Where each segment starts on the quick timeline (seconds of quick-version playing time). */
export function planOffsets(plan: PlanSegment[]): number[] {
  const out: number[] = [];
  let acc = 0;
  for (const s of plan) {
    out.push(acc);
    acc += (s.end - s.start) / s.rate;
  }
  return out;
}

/**
 * The position on the quick timeline for a spot in the source video. `segIdx`
 * disambiguates a replay (whose source range sits inside its pitch's window);
 * otherwise the real-speed window containing `t` is used, or the start of the
 * next one when `t` falls between pitches.
 */
export function quickTimeAt(plan: PlanSegment[], offsets: number[], segIdx: number | null, t: number): number {
  if (!plan.length) return 0;
  const clamp = (i: number) => offsets[i] + Math.min(Math.max(0, t - plan[i].start), plan[i].end - plan[i].start) / plan[i].rate;
  if (segIdx != null && plan[segIdx]) return clamp(segIdx);
  const inside = plan.findIndex((s) => !s.replay && t >= s.start && t < s.end);
  if (inside >= 0) return clamp(inside);
  const next = plan.findIndex((s) => !s.replay && s.start >= t);
  return next >= 0 ? offsets[next] : planDuration(plan);
}
