// Phase-detection + quality-gate verification on synthetic fixtures.
// No DB, no network, no browser. Run: npx tsx scripts/verify-swing-phases.mts
//
// Fixtures verify algorithm behavior (ordering, mirroring, interpolation,
// gates) against known-by-construction event times. Real-clip threshold
// calibration happens in the /swing/lab page (U1) — this script is the
// regression net under it.

import { readFileSync } from "node:fs";
import {
  detectPhases,
  findSwingBursts,
  mostProminentBurst,
  plausible,
} from "../src/lib/swing/pipeline/phases";
import { conditionSeries, interpolateGaps } from "../src/lib/swing/pipeline/smoothing";
import { denseGate, preGate } from "../src/lib/swing/pipeline/quality";
import {
  FIXTURE_EVENTS,
  generateDoubleSwing,
  generateSwing,
  generateWalking,
  withWristDropout,
} from "./fixtures/swing-synthetic";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}
const near = (a: number | undefined, b: number, tolMs: number) =>
  a !== undefined && Math.abs(a - b) <= tolMs;

const EVENT_TOL_MS = 80;

console.log("Clean righty swing (120fps):");
{
  const frames = conditionSeries(generateSwing(), 120);
  const detection = detectPhases(frames);
  check("detected", detection !== null);
  if (detection) {
    const e = detection.events;
    check("bats R", detection.detectedBats === "R");
    check(
      `contact ≈ ${FIXTURE_EVENTS.contact}ms`,
      near(e.contact, FIXTURE_EVENTS.contact, EVENT_TOL_MS),
      `${e.contact}`
    );
    check(
      `plant ≈ ${FIXTURE_EVENTS.plant}ms`,
      near(e.plant, FIXTURE_EVENTS.plant, 150),
      `${e.plant}`
    );
    check(
      "launch before contact within plausible band",
      e.launch !== undefined && e.contact !== undefined && e.contact - e.launch >= 40 && e.contact - e.launch <= 450,
      `${e.contact! - e.launch!}ms`
    );
    check(
      "ordering stance≤plant≤launch≤contact≤finish",
      plausible(e)
    );
    check("load detected (regression guard — was silently absent once)", e.load !== undefined, `${e.load}`);
    check("stance well before load (quiet-run start, not plant-adjacent)",
      e.load !== undefined && e.stance !== undefined && e.load - e.stance > 300,
      `stance ${e.stance} load ${e.load}`);
    const gate = denseGate(frames, e.launch, e.contact);
    check("dense gate passes", gate.ok, gate.message ?? "");
  }
}

console.log("Lefty mirror:");
{
  const frames = conditionSeries(generateSwing({ lefty: true }), 120);
  const detection = detectPhases(frames);
  check("detected", detection !== null);
  if (detection) {
    check("bats L", detection.detectedBats === "L");
    check(
      "contact matches righty fixture",
      near(detection.events.contact, FIXTURE_EVENTS.contact, EVENT_TOL_MS),
      `${detection.events.contact}`
    );
  }
}

console.log("Wrist dropout mid-swing (interpolation bridges):");
{
  const raw = withWristDropout(generateSwing(), 1500, 1580);
  const bridged = interpolateGaps(raw);
  const someInterpolated = bridged.some((f) => f.interpolated);
  check("frames flagged interpolated", someInterpolated);
  const detection = detectPhases(conditionSeries(raw, 120));
  check("still detects events", detection !== null);
  if (detection) {
    check(
      "contact still in tolerance",
      near(detection.events.contact, FIXTURE_EVENTS.contact, 120),
      `${detection.events.contact}`
    );
  }
}

console.log("Dense gate: low pose confidence (>30% of frames at 0.3):");
{
  const clean = conditionSeries(generateSwing(), 120);
  const detection = detectPhases(clean);
  check("clean detection available for gate window", detection !== null);
  const degraded = generateSwing().map((f, i) =>
    i % 3 !== 0 ? { ...f, poseConfidence: 0.3 } : f
  );
  const gate = denseGate(degraded, detection?.events.launch, detection?.events.contact);
  check(
    "rejects low_pose_confidence",
    !gate.ok && gate.code === "low_pose_confidence",
    gate.code
  );
}

console.log("Dense gate: wrists untrackable through launch→contact:");
{
  const conditioned = conditionSeries(generateSwing(), 120);
  const detection = detectPhases(conditioned);
  check("clean detection available for gate window", detection !== null);
  if (detection) {
    const e = detection.events;
    // Raw frames, NO interpolation bridging — the gate must see the dropout
    // (visibility 0.2 < the 0.45 wrist floor through the whole window).
    const raw = withWristDropout(generateSwing(), e.launch!, e.contact!);
    const gate = denseGate(raw, e.launch, e.contact);
    check(
      "rejects low_wrist_confidence",
      !gate.ok && gate.code === "low_wrist_confidence",
      gate.code
    );
  }
}

console.log("No-swing clip (kid walks through frame):");
{
  const frames = conditionSeries(generateWalking(), 30);
  const bursts = findSwingBursts(frames);
  check("no bursts found", bursts.length === 0, `${bursts.length}`);
  const gate = preGate(frames, bursts);
  check("pre-gate rejects no_swing_detected", !gate.ok && gate.code === "no_swing_detected");
}

console.log("Two swings in one clip:");
{
  const frames = conditionSeries(generateDoubleSwing(), 30);
  const bursts = findSwingBursts(frames);
  check("two bursts found", bursts.length === 2, `${bursts.length}`);
  if (bursts.length === 2) {
    const top = mostProminentBurst(bursts);
    check("second (harder) swing wins", top !== null && top.peakMs > 3000, `${top?.peakMs}`);
    const gate = preGate(frames, bursts);
    check("gate passes with a multi-swing warning", gate.ok && gate.warnings.length > 0);
  }
}

console.log("Off-angle (front-on) clip:");
{
  const frames = conditionSeries(generateSwing({ shoulderSeparation: 0.13 }), 120);
  const gate = preGate(frames, findSwingBursts(frames));
  check("pre-gate rejects off_angle", !gate.ok && gate.code === "off_angle", gate.code);
}

console.log("Subject too small:");
{
  const frames = conditionSeries(generateSwing({ height: 0.08 }), 120);
  const gate = preGate(frames, findSwingBursts(frames));
  check(
    "pre-gate rejects subject_too_small",
    !gate.ok && gate.code === "subject_too_small",
    gate.code
  );
}

console.log("Implausible (stretched) swing:");
{
  const frames = conditionSeries(generateSwing({ slowSwing: true }), 120);
  const detection = detectPhases(frames);
  check("rejected rather than emitting garbage events", detection === null);
}

console.log("Plausibility unit checks:");
{
  check(
    "good ordering passes",
    plausible({ stance: 0, load: 900, plant: 1400, launch: 1500, contact: 1650, finish: 2000 })
  );
  check(
    "contact before launch fails",
    !plausible({ stance: 0, plant: 1400, launch: 1700, contact: 1650, finish: 2000 })
  );
  check(
    "800ms launch→contact fails",
    !plausible({ stance: 0, plant: 1400, launch: 1500, contact: 2300, finish: 2500 })
  );
  check(
    "missing contact fails",
    !plausible({ stance: 0, plant: 1400, launch: 1500, finish: 2000 })
  );
  check(
    "load after plant fails",
    !plausible({ stance: 0, load: 1450, plant: 1400, launch: 1500, contact: 1650, finish: 2000 })
  );
}

console.log("Baked slow-motion export (8x-stretched 30fps AirDrop):");
{
  // Stretch clip time uniformly by 8 — what AirDrop does when it bakes a
  // 240fps slo-mo into a 30fps file. All real motion information survives.
  const stretch = 8;
  const stretched = generateSwing({ fps: 120 }).map((f) => ({
    ...f,
    timestampMs: f.timestampMs * stretch,
  }));
  const conditioned = conditionSeries(stretched, 120 / stretch);
  check(
    "real-time detection finds NO burst (the original bug)",
    findSwingBursts(conditioned, 1).length === 0
  );
  const bursts = findSwingBursts(conditioned, stretch);
  check("timeScale-aware detection finds the burst", bursts.length >= 1, `${bursts.length}`);
  const detection = detectPhases(conditioned, stretch);
  check("phases detected at 8x", detection !== null);
  if (detection) {
    check("timeScale recorded on detection", detection.timeScale === stretch);
    check(
      "contact at stretched clip time",
      near(detection.events.contact, FIXTURE_EVENTS.contact * stretch, EVENT_TOL_MS * stretch),
      `${detection.events.contact}`
    );
    check(
      "plausibility band scales (real launch→contact in band)",
      plausible(detection.events, stretch) && !plausible(detection.events, 1)
    );
  }
}

console.log("Real-clip regression (IMG_1510: 27s AirDrop export, 8x baked slo-mo):");
{
  // Real dense keypoints captured from the lab page running the actual clip
  // (scripts/fixtures/swing-clips/IMG_1510.MOV). This is the clip that
  // exposed the baked-slo-mo and rotation bugs — detection on it must not
  // regress. Note this clip also contains pre-swing motion and post-swing
  // junk faster than the swing itself (the candidate-hypothesis case).
  const fixture = JSON.parse(
    readFileSync(new URL("./fixtures/img-1510-keypoints.json", import.meta.url), "utf8")
  );
  const det = detectPhases(fixture.keypoints, 8);
  check("real swing detected at 8x", det !== null);
  if (det) {
    check("handedness R (was inverted before the rotation fix)", det.detectedBats === "R");
    check(
      "contact near the verified read (~10033ms clip time)",
      near(det.events.contact, 10033, 250),
      `${det.events.contact}`
    );
    check("plausible end to end", plausible(det.events, 8));
    check(
      "real-time interpretation correctly finds nothing",
      detectPhases(fixture.keypoints, 1) === null
    );
  }
}

console.log(failures === 0 ? "\nAll phase checks passed." : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
