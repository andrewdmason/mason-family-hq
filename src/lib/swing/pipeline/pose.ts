// PoseLandmarker wrapper: model/wasm loading with GPU→CPU retry, plus the
// landmark vocabulary the rest of the pipeline speaks. Worker-safe (no DOM).

import {
  FilesetResolver,
  PoseLandmarker,
  type NormalizedLandmark,
} from "@mediapipe/tasks-vision";

// Served from public/ with absolute paths — Turbopack's `new URL(*.wasm)`
// asset references are unreliable, so we sidestep the bundler entirely.
export const WASM_BASE_URL = "/swing/mediapipe/wasm";
export const MODEL_URLS = {
  heavy: "/swing/models/pose_landmarker_heavy.task",
  full: "/swing/models/pose_landmarker_full.task",
} as const;
export type PoseModel = keyof typeof MODEL_URLS;
export type PoseDelegate = "GPU" | "CPU";

export interface Landmark {
  x: number;
  y: number;
  z: number;
  visibility: number;
}

export interface KeypointFrame {
  timestampMs: number;
  /** 33 normalized image-space landmarks (x/y in 0–1, y grows downward). */
  landmarks: Landmark[];
  /** Mean visibility across core landmarks — cheap per-frame quality signal. */
  poseConfidence: number;
  /** Set by smoothing when low-visibility gaps were bridged at this frame. */
  interpolated?: boolean;
}

/** MediaPipe Pose landmark indices (33-point topology). */
export const LM = {
  nose: 0,
  leftEar: 7,
  rightEar: 8,
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24,
  leftKnee: 25,
  rightKnee: 26,
  leftAnkle: 27,
  rightAnkle: 28,
  leftHeel: 29,
  rightHeel: 30,
} as const;

/** Landmarks whose visibility defines per-frame pose confidence. */
export const CORE_LANDMARKS: number[] = [
  LM.nose,
  LM.leftShoulder,
  LM.rightShoulder,
  LM.leftHip,
  LM.rightHip,
  LM.leftKnee,
  LM.rightKnee,
  LM.leftAnkle,
  LM.rightAnkle,
];

export interface CreatedLandmarker {
  landmarker: PoseLandmarker;
  /** The delegate that actually initialized (GPU init failures fall back). */
  delegate: PoseDelegate;
}

export async function createLandmarker(
  model: PoseModel = "heavy",
  preferredDelegate: PoseDelegate = "GPU"
): Promise<CreatedLandmarker> {
  const vision = await FilesetResolver.forVisionTasks(WASM_BASE_URL);
  const delegates: PoseDelegate[] =
    preferredDelegate === "GPU" ? ["GPU", "CPU"] : ["CPU"];
  let lastError: unknown;
  for (const delegate of delegates) {
    try {
      const landmarker = await PoseLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: MODEL_URLS[model], delegate },
        runningMode: "VIDEO",
        numPoses: 1,
        minPoseDetectionConfidence: 0.5,
        minPosePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
      return { landmarker, delegate };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Pose landmarker failed to initialize");
}

/**
 * Run pose on one frame. VIDEO mode requires monotonically increasing
 * timestamps — the two-pass pipeline guarantees this per pass but not across
 * passes, so callers pass a monotonic `detectionTimestampMs` separate from the
 * frame's presentation time.
 */
export function detectFrame(
  landmarker: PoseLandmarker,
  image: ImageBitmap | VideoFrame | HTMLCanvasElement | OffscreenCanvas,
  presentationTimestampMs: number,
  detectionTimestampMs: number
): KeypointFrame | null {
  const result = landmarker.detectForVideo(image, detectionTimestampMs);
  const pose: NormalizedLandmark[] | undefined = result.landmarks?.[0];
  if (!pose || pose.length === 0) return null;
  const landmarks: Landmark[] = pose.map((p) => ({
    x: p.x,
    y: p.y,
    z: p.z,
    visibility: p.visibility ?? 0,
  }));
  const poseConfidence =
    CORE_LANDMARKS.reduce((sum, i) => sum + (landmarks[i]?.visibility ?? 0), 0) /
    CORE_LANDMARKS.length;
  return { timestampMs: presentationTimestampMs, landmarks, poseConfidence };
}
