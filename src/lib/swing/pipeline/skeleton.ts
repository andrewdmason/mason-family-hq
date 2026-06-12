// Skeleton bone list shared by the evidence-still renderer (annotate.ts) and
// the lab keypoint scrubber. Data-only module (no imports) so it's safe to
// pull into both the worker pipeline and client components.
//
// Indices are the MediaPipe Pose 33-point topology (see LM in pose.ts):
// 11/12 shoulders, 13/14 elbows, 15/16 wrists, 23/24 hips, 25/26 knees,
// 27/28 ankles.

/** Skeleton bones (subset of MediaPipe pose connections that reads clearly). */
export const BONES: [number, number][] = [
  [11, 12], // leftShoulder – rightShoulder
  [11, 13], // leftShoulder – leftElbow
  [13, 15], // leftElbow – leftWrist
  [12, 14], // rightShoulder – rightElbow
  [14, 16], // rightElbow – rightWrist
  [11, 23], // leftShoulder – leftHip
  [12, 24], // rightShoulder – rightHip
  [23, 24], // leftHip – rightHip
  [23, 25], // leftHip – leftKnee
  [25, 27], // leftKnee – leftAnkle
  [24, 26], // rightHip – rightKnee
  [26, 28], // rightKnee – rightAnkle
];
