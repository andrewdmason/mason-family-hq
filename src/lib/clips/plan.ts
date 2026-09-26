// The "quick version" of an at-bat: just the moments around each pitch, with a
// slow-motion replay of every swing. The in-app player walks this plan in
// quick mode, and the export worker renders the same plan to a video file, so
// what you watch is what the coach gets.
//
// These are starting numbers, meant to be tuned after watching real at-bats.

import { pitchKind, PITCH_KIND_LABEL, resultLabel, type AtBatResult, type ClipPitch } from "./types";

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

export function pitchCaption(
  p: Pick<ClipPitch, "swing" | "contact">,
  n: number,
  isLast: boolean,
  result: AtBatResult | null,
): string {
  const parts = [`Pitch ${n}`, PITCH_KIND_LABEL[pitchKind(p)]];
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
  let prevEnd = 0;
  sorted.forEach((p, i) => {
    const isLast = i === sorted.length - 1;
    const caption = pitchCaption(p, i + 1, isLast, result);
    const start = Math.max(0, p.t - QUICK.lead, prevEnd);
    const end = Math.min(duration, p.t + (p.contact ? QUICK.contactTail : QUICK.tail));
    if (end - start > 0.05) {
      segments.push({ start, end, rate: 1, muted: false, caption, pitchIndex: i, replay: false });
      prevEnd = end;
    }
    if (p.swing) {
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
