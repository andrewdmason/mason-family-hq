// Synthetic swing keypoint fixtures for the phase/metric verification scripts.
// Generates a parametric 33-landmark series shaped like a youth swing:
// stance → load (hands rearward) → stride (lead-ankle lift/plant) → launch →
// contact (peak hand speed) → follow-through decay. Event times are known by
// construction, so detection is asserted against ground truth.
//
// These fixtures verify the ALGORITHMS (ordering, mirroring, interpolation,
// gates). Real-clip calibration of thresholds happens in the U1 lab — fixture
// green is necessary, not sufficient.

import type { KeypointFrame, Landmark } from "../../src/lib/swing/pipeline/pose";
import { LM } from "../../src/lib/swing/pipeline/pose";

export interface SwingFixtureOptions {
  /** Sampling rate of the generated series. */
  fps?: number;
  /** Mirror to a left-handed batter. */
  lefty?: boolean;
  /** Head drift stance→contact, in absolute normalized units. */
  headDrift?: number;
  /** Shoulder x-separation (side-on ≈ 0.02; front-on ≈ 0.12). */
  shoulderSeparation?: number;
  /** Hitter height in normalized units (nose→ankles). */
  height?: number;
  /** Stretch launch→contact beyond plausibility (implausible fixture). */
  slowSwing?: boolean;
  /** Scale total hand travel through the swing (harder swing = bigger burst). */
  handTravelScale?: number;
}

/** Ground-truth event times used by the generator (ms). */
export const FIXTURE_EVENTS = {
  stance: 0,
  load: 900,
  lift: 1150,
  plant: 1400,
  launch: 1500,
  contact: 1650,
  finishBy: 2150,
} as const;

const DURATION_MS = 2600;

export function generateSwing(options: SwingFixtureOptions = {}): KeypointFrame[] {
  const {
    fps = 120,
    lefty = false,
    headDrift = 0.015,
    shoulderSeparation = 0.02,
    height = 0.5,
    slowSwing = false,
    handTravelScale = 1,
  } = options;

  const contact = slowSwing ? FIXTURE_EVENTS.launch + 800 : FIXTURE_EVENTS.contact;
  const frames: KeypointFrame[] = [];
  const stepMs = 1000 / fps;

  for (let t = 0; t <= DURATION_MS; t += stepMs) {
    frames.push(
      frameAt(t, { height, headDrift, shoulderSeparation, contact, handTravelScale })
    );
  }
  if (lefty) return frames.map(mirrorFrame);
  return frames;
}

interface FrameParams {
  height: number;
  headDrift: number;
  shoulderSeparation: number;
  contact: number;
  handTravelScale: number;
}

function frameAt(t: number, p: FrameParams): KeypointFrame {
  const H = p.height;
  const ankleY = 0.85;
  const noseY = ankleY - H;
  const scale = H / 0.5; // body proportions scale with height

  // Swing progress: hands x ramps quadratically launch→contact (velocity
  // peaks at contact), then decays over 400ms.
  const launch = FIXTURE_EVENTS.launch;
  const swingSpan = p.contact - launch;
  const travel = 0.5 * H * p.handTravelScale; // total hand travel through the swing
  let swingX = 0;
  if (t >= launch && t <= p.contact) {
    const tau = (t - launch) / swingSpan;
    swingX = travel * tau * tau;
  } else if (t > p.contact) {
    const decay = Math.min((t - p.contact) / 400, 1);
    swingX = travel + travel * (2 / swingSpan) * 400 * 0.0005 * (1 - (1 - decay) ** 2);
  }

  // Load: hands drift rearward (-x) between load and plant.
  let loadX = 0;
  if (t >= FIXTURE_EVENTS.load) {
    const tau = Math.min((t - FIXTURE_EVENTS.load) / 300, 1);
    loadX = -0.08 * H * tau;
  }

  // Head drift accrues stance→contact.
  const driftTau = Math.min(t / p.contact, 1);
  const headX = 0.5 + p.headDrift * driftTau;

  // Lead ankle (left for the canonical righty): lift then plant.
  let leadAnkleLift = 0;
  let leadAnkleStride = 0;
  if (t >= FIXTURE_EVENTS.lift && t < FIXTURE_EVENTS.plant) {
    const tau = (t - FIXTURE_EVENTS.lift) / (FIXTURE_EVENTS.plant - FIXTURE_EVENTS.lift);
    leadAnkleLift = 0.1 * H * Math.sin(Math.PI * tau);
    leadAnkleStride = 0.12 * H * tau;
  } else if (t >= FIXTURE_EVENTS.plant) {
    leadAnkleStride = 0.12 * H;
  }

  const handsX = 0.5 - 0.06 * scale + loadX + swingX;
  const handsY = noseY + 0.22 * H;

  const landmarks: Landmark[] = Array.from({ length: 33 }, () =>
    lm(0.5, noseY + 0.4 * H)
  );

  landmarks[LM.nose] = lm(headX, noseY);
  landmarks[LM.leftEar] = lm(headX - 0.01, noseY + 0.01);
  landmarks[LM.rightEar] = lm(headX + 0.01, noseY + 0.01);

  // Torso rides partially forward with the hips (head stays quiet).
  const torsoShift = 0.04 * H * driftTau;
  const shoulderY = noseY + 0.2 * H;
  landmarks[LM.leftShoulder] = lm(0.5 + torsoShift + p.shoulderSeparation / 2, shoulderY);
  landmarks[LM.rightShoulder] = lm(0.5 + torsoShift - p.shoulderSeparation / 2, shoulderY);

  landmarks[LM.leftWrist] = lm(handsX + 0.01, handsY);
  landmarks[LM.rightWrist] = lm(handsX - 0.01, handsY + 0.01);
  landmarks[LM.leftElbow] = lm((0.5 + handsX) / 2 + 0.02, shoulderY + 0.12 * H);
  landmarks[LM.rightElbow] = lm((0.5 + handsX) / 2 - 0.02, shoulderY + 0.13 * H);

  const hipY = noseY + 0.52 * H;
  // Weight shifts toward the pitcher (+x) through the swing — realistic and
  // keeps the weight_transfer metric meaningfully positive on clean fixtures.
  const hipShift = 0.08 * H * driftTau;
  landmarks[LM.leftHip] = lm(0.51 + hipShift, hipY);
  landmarks[LM.rightHip] = lm(0.49 + hipShift, hipY);

  const kneeY = noseY + 0.76 * H;
  // Lead (left) leg strides; front knee straightens into contact.
  const leadAnkleX = 0.56 + leadAnkleStride;
  landmarks[LM.leftKnee] = lm((0.51 + leadAnkleX) / 2, kneeY);
  landmarks[LM.rightKnee] = lm(0.465, kneeY);
  landmarks[LM.leftAnkle] = lm(leadAnkleX, ankleY - leadAnkleLift);
  landmarks[LM.rightAnkle] = lm(0.44, ankleY);
  landmarks[LM.leftHeel] = lm(leadAnkleX - 0.01, ankleY - leadAnkleLift + 0.005);
  landmarks[LM.rightHeel] = lm(0.43, ankleY + 0.005);

  return {
    timestampMs: t,
    landmarks,
    poseConfidence: 0.9,
  };
}

function lm(x: number, y: number, visibility = 0.9): Landmark {
  return { x, y, z: 0, visibility };
}

function mirrorFrame(frame: KeypointFrame): KeypointFrame {
  // Mirror x AND swap left/right landmark indices, like a true lefty filmed
  // from the same side.
  const swapped = [...frame.landmarks];
  const pairs: [number, number][] = [
    [LM.leftEar, LM.rightEar],
    [LM.leftShoulder, LM.rightShoulder],
    [LM.leftElbow, LM.rightElbow],
    [LM.leftWrist, LM.rightWrist],
    [LM.leftHip, LM.rightHip],
    [LM.leftKnee, LM.rightKnee],
    [LM.leftAnkle, LM.rightAnkle],
    [LM.leftHeel, LM.rightHeel],
  ];
  for (const [a, b] of pairs) {
    const tmp = swapped[a];
    swapped[a] = swapped[b];
    swapped[b] = tmp;
  }
  return {
    ...frame,
    landmarks: swapped.map((l) => ({ ...l, x: 1 - l.x })),
  };
}

/** A kid walking through frame — motion, but no swing burst. */
export function generateWalking(fps = 30): KeypointFrame[] {
  const frames: KeypointFrame[] = [];
  const stepMs = 1000 / fps;
  for (let t = 0; t <= DURATION_MS; t += stepMs) {
    const base = frameAt(0, {
      height: 0.5,
      headDrift: 0,
      shoulderSeparation: 0.02,
      contact: FIXTURE_EVENTS.contact,
      handTravelScale: 1,
    });
    const drift = (t / DURATION_MS) * 0.25; // slow lateral walk
    frames.push({
      ...base,
      timestampMs: t,
      landmarks: base.landmarks.map((l) => ({ ...l, x: l.x + drift })),
    });
  }
  return frames;
}

/** Two swings in one clip, the second one harder, ~2s of reset between. */
export function generateDoubleSwing(fps = 30): KeypointFrame[] {
  const gapMs = 2000;
  const first = generateSwing({ fps });
  const second = generateSwing({ fps, handTravelScale: 1.5 }).map((f) => ({
    ...f,
    timestampMs: f.timestampMs + DURATION_MS + gapMs,
  }));
  // Bridge the gap by easing every landmark back to the second swing's start
  // — otherwise the positional jump at the boundary reads as a phantom burst.
  const from = first[first.length - 1];
  const to = second[0];
  const bridge: KeypointFrame[] = [];
  const stepMs = 1000 / fps;
  for (let t = stepMs; t < gapMs; t += stepMs) {
    const tau = t / gapMs;
    bridge.push({
      timestampMs: from.timestampMs + t,
      poseConfidence: 0.9,
      landmarks: from.landmarks.map((l, i) => ({
        x: l.x + (to.landmarks[i].x - l.x) * tau,
        y: l.y + (to.landmarks[i].y - l.y) * tau,
        z: 0,
        visibility: 0.9,
      })),
    });
  }
  return [...first, ...bridge, ...second];
}

/** Drop wrist visibility in a window (tests gap interpolation). */
export function withWristDropout(
  frames: KeypointFrame[],
  fromMs: number,
  toMs: number
): KeypointFrame[] {
  return frames.map((f) => {
    if (f.timestampMs < fromMs || f.timestampMs > toMs) return f;
    return {
      ...f,
      landmarks: f.landmarks.map((l, i) =>
        i === LM.leftWrist || i === LM.rightWrist
          ? { ...l, visibility: 0.2 }
          : l
      ),
    };
  });
}
