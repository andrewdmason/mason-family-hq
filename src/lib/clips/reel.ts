// Pitch reels: how the Clips Camera app stores an at-bat (from migration 00202
// on). The reel is just the real-speed window around each pitch, back to back —
// swings at every 240fps frame, takes at 60fps — with nothing burned in. The
// player adds slow motion and captions as it plays, and a shared video is
// rendered from the reel on request. A port of the phone's ReelPlan
// (ios/ClipsCamera/ClipsCamera/Edit/ReelPlan.swift); keep the two in step.

import { QUICK, pitchCaption, type PlanSegment } from "./plan";
import { countsBefore, isSwing, outcomeLabel, resultLabel, type AtBatResult, type BattedBall, type ClipPitch } from "./types";

/** One pitch window in the reel (`clip_at_bats.reel.segments`). */
export type ReelSegment = {
  /** Where it sits in the reel, in seconds. */
  start: number;
  end: number;
  /** 240 for a swing or an unlabeled pitch, 60 for a take. */
  fps: number;
  /** The pitch it was cut for: an index into the pitches sorted by time. */
  pitch: number;
};

/** The window showing reel time `t` (the very end still counts as the last). */
export function segmentAt(t: number, segments: ReelSegment[]): ReelSegment | null {
  const s = segments.find((x) => t >= x.start && t < x.end);
  if (s) return s;
  const last = segments[segments.length - 1];
  return last && t >= last.end - 0.001 && t <= last.end + 0.05 ? last : null;
}

/** The pitch on screen: the latest whose moment has come inside the window showing, else the window's own. */
export function pitchShowing(t: number, segments: ReelSegment[], times: number[]): number | null {
  const seg = segmentAt(t, segments);
  if (!seg) return null;
  let shown = seg.pitch;
  for (let i = 0; i < times.length; i++) {
    if (times[i] >= seg.start && times[i] <= seg.end && times[i] <= t) shown = i;
  }
  return shown;
}

/** "1-2 · Foul", the result on the last pitch — the player's caption. */
export function reelCaption(pitches: ClipPitch[], i: number, result: AtBatResult | null): string {
  const parts = [countsBefore(pitches)[i]];
  if (pitches[i].outcome) parts.push(outcomeLabel(pitches[i].outcome));
  const label = i === pitches.length - 1 ? resultLabel(result) : null;
  if (label) parts.push(label);
  return parts.join(" · ");
}

/**
 * A shared video's plan, in reel time: every window at real speed with its
 * caption, each swing followed by its ¼-speed replay when asked for. The same
 * rules as the phone's share, so either one sends the coach the same video.
 */
export function reelSharePlan(
  segments: ReelSegment[],
  pitches: ClipPitch[],
  result: AtBatResult | null,
  replays: boolean,
): PlanSegment[] {
  const sorted = [...pitches].sort((a, b) => a.t - b.t);
  const counts = countsBefore(sorted);
  const caption = (i: number) => pitchCaption(sorted[i], i + 1, counts[i], i === sorted.length - 1, result);
  const plan: PlanSegment[] = [];
  for (const seg of segments) {
    if (seg.pitch >= sorted.length) continue;
    plan.push({ start: seg.start, end: seg.end, rate: 1, muted: false, caption: caption(seg.pitch), pitchIndex: seg.pitch, replay: false });
    if (!replays) continue;
    sorted.forEach((p, i) => {
      if (!isSwing(p) || p.t < seg.start || p.t > seg.end) return;
      const lo = Math.max(seg.start, p.t - QUICK.replayBefore);
      const hi = Math.min(seg.end, p.t + QUICK.replayAfter);
      if (hi - lo <= 0.05) return;
      plan.push({
        start: lo,
        end: hi,
        rate: QUICK.replayRate,
        muted: true,
        caption: `${caption(i)} · Replay`,
        pitchIndex: i,
        replay: true,
      });
    });
  }
  return plan;
}

// --- Scorebook (the phone's taxonomy) ------------------------------------------

/** What a ball in play did, as the phone labels it. */
export type PlayResult = "single" | "double" | "triple" | "homeRun" | "out" | "error" | "fieldersChoice";

export const PLAY_RESULTS: { value: PlayResult; label: string }[] = [
  { value: "single", label: "Single" },
  { value: "double", label: "Double" },
  { value: "triple", label: "Triple" },
  { value: "homeRun", label: "Home run" },
  { value: "out", label: "Out" },
  { value: "error", label: "Error" },
  { value: "fieldersChoice", label: "Fielder's choice" },
];

export const BATTED_BALLS: { value: BattedBall; label: string }[] = [
  { value: "ground_ball", label: "Grounder" },
  { value: "line_drive", label: "Line drive" },
  { value: "fly_ball", label: "Fly ball" },
  { value: "pop_fly", label: "Pop-up" },
  { value: "bunt", label: "Bunt" },
];

/** The deciding ball in play's result, read back from the at-bat's. */
export function playResultOf(result: AtBatResult | null): PlayResult | null {
  switch (result) {
    case "1B": return "single";
    case "2B": return "double";
    case "3B": return "triple";
    case "HR": return "homeRun";
    case "GO": case "FO": case "LO": case "PO": return "out";
    case "ROE": return "error";
    case "FC": return "fieldersChoice";
    default: return null;
  }
}

function inPlayResult(r: PlayResult, batted: BattedBall | null | undefined): AtBatResult {
  switch (r) {
    case "single": return "1B";
    case "double": return "2B";
    case "triple": return "3B";
    case "homeRun": return "HR";
    case "error": return "ROE";
    case "fieldersChoice": return "FC";
    case "out":
      return batted === "fly_ball" ? "FO" : batted === "line_drive" ? "LO" : batted === "pop_fly" ? "PO" : "GO";
  }
}

/**
 * How the at-bat ended, worked out from its pitches (sorted): the first that
 * decides it. `playResult` is what the ball in play did. Unlabeled pitches
 * don't count; two-strike fouls don't add a strike.
 */
export function scorebookResult(
  pitches: Pick<ClipPitch, "outcome" | "battedBall">[],
  playResult: PlayResult | null,
): AtBatResult | null {
  let balls = 0;
  let strikes = 0;
  for (const p of pitches) {
    switch (p.outcome) {
      case "hit_by_pitch":
        return "HBP";
      case "in_play":
        return playResult ? inPlayResult(playResult, p.battedBall) : null;
      case "ball":
        if (++balls >= 4) return "BB";
        break;
      case "called_strike":
      case "swinging_strike":
        if (++strikes >= 3) return p.outcome === "called_strike" ? "KL" : "K";
        break;
      case "foul":
        if (strikes < 2) strikes++;
        break;
    }
  }
  return null;
}
