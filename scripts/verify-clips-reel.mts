/**
 * Clips pitch reels on the website: the share plan, the caption on screen, and
 * the scorebook that relabeling re-runs.
 *
 * These are ports of the phone's ReelPlan and Scorebook (the iOS tests check
 * the same cases). If they drift, a video shared from the website looks
 * different from one shared from the phone, or relabeling a pitch on the
 * website leaves the at-bat with a result the phone would never give it.
 *
 *   npx tsx scripts/verify-clips-reel.mts
 */

import { pitchShowing, playResultOf, reelCaption, reelSharePlan, scorebookResult, type ReelSegment } from "../src/lib/clips/reel";
import { planDuration } from "../src/lib/clips/plan";
import type { ClipPitch } from "../src/lib/clips/types";

let failures = 0;

function check(name: string, ok: boolean, detail?: string) {
  if (ok) console.log(`  ok  ${name}`);
  else {
    failures++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const near = (a: number, b: number) => Math.abs(a - b) < 0.001;

// The phone's test reel: a ball at 2s into a 60fps window, a ball in play at 5s
// into a 240fps window (ReelTests.testSharePlanAddsReplaysAfterSwings).
const segments: ReelSegment[] = [
  { start: 0, end: 3, fps: 60, pitch: 0 },
  { start: 3, end: 7.5, fps: 240, pitch: 1 },
];
const pitches: ClipPitch[] = [
  { id: "a", t: 2, outcome: "ball", source: "camera" },
  { id: "b", t: 5, outcome: "in_play", source: "camera", battedBall: "line_drive" },
];

console.log("share plan");
const plan = reelSharePlan(segments, pitches, "1B", true);
check("a replay follows the swing only", plan.map((s) => s.replay).join() === "false,false,true");
check("captions number the pitch, like the phone's", plan[1].caption === "Pitch 2 · 1-0 · Ball in play · 1B", plan[1].caption);
check("the replay window is 0.8s before to 0.4s after", near(plan[2].start, 4.2) && near(plan[2].end, 5.4));
check("the replay is ¼ speed and muted", plan[2].rate === 0.25 && plan[2].muted);
check("with replays it runs 3 + 4.5 + 4.8s", near(planDuration(plan), 12.3), String(planDuration(plan)));
check("real speed only is just the reel", near(planDuration(reelSharePlan(segments, pitches, "1B", false)), 7.5));

console.log("on screen");
const times = pitches.map((p) => p.t);
check("in the first window, the first pitch", pitchShowing(0.5, segments, times) === 0);
check("in the second window, the second pitch", pitchShowing(3.1, segments, times) === 1);
check("the very end still shows the last pitch", pitchShowing(7.5, segments, times) === 1);
check("the player's caption drops the pitch number", reelCaption(pitches, 1, "1B") === "1-0 · Ball in play · 1B", reelCaption(pitches, 1, "1B"));

console.log("scorebook");
const outs = (...o: ClipPitch["outcome"][]) => o.map((outcome) => ({ outcome, battedBall: null }));
check("four balls is a walk", scorebookResult(outs("ball", "ball", "called_strike", "ball", "ball"), null) === "BB");
check("a called third strike is looking", scorebookResult(outs("swinging_strike", "foul", "called_strike"), null) === "KL");
check("two-strike fouls don't strike out", scorebookResult(outs("called_strike", "called_strike", "foul", "foul"), null) === null);
check("a swinging third strike is swinging", scorebookResult(outs("foul", "foul", "foul", "swinging_strike"), null) === "K");
check("hit by pitch", scorebookResult(outs("ball", "hit_by_pitch"), null) === "HBP");
check("a ball in play waits for its result", scorebookResult(outs("ball", "in_play"), null) === null);
check(
  "a fly ball out is a flyout",
  scorebookResult([{ outcome: "in_play", battedBall: "fly_ball" }], "out") === "FO",
);
check("a bunt out is a groundout", scorebookResult([{ outcome: "in_play", battedBall: "bunt" }], "out") === "GO");
check("a double reads back as a double", playResultOf("2B") === "double" && playResultOf("PO") === "out" && playResultOf("BB") === null);

if (failures) {
  console.log(`\n${failures} failed`);
  process.exit(1);
}
console.log("\nall passed");
