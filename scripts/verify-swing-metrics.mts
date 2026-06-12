// Metrics-engine verification on synthetic fixtures. No DB, no network.
// Run: npx tsx scripts/verify-swing-metrics.mts

import { detectPhases } from "../src/lib/swing/pipeline/phases";
import { computeMetrics } from "../src/lib/swing/pipeline/metrics";
import { conditionSeries } from "../src/lib/swing/pipeline/smoothing";
import { LM } from "../src/lib/swing/pipeline/pose";
import { generateSwing } from "./fixtures/swing-synthetic";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

function metricsFor(frames: ReturnType<typeof generateSwing>) {
  const conditioned = conditionSeries(frames, 120);
  const detection = detectPhases(conditioned);
  if (!detection) throw new Error("fixture did not detect");
  return { metrics: computeMetrics(conditioned, detection), detection };
}

console.log("Clean righty swing:");
const clean = metricsFor(generateSwing());
{
  const m = clean.metrics;
  check("head_drift small (quiet head)", (m.head_drift?.value ?? 1) < 0.08, `${m.head_drift?.value.toFixed(3)}`);
  check(
    "stride_length_ratio in youth band (0.15–0.45)",
    (m.stride_length_ratio?.value ?? 0) > 0.15 && (m.stride_length_ratio?.value ?? 0) < 0.45,
    `${m.stride_length_ratio?.value.toFixed(3)}`
  );
  check("spine angles present and sane (<45°)",
    (m.spine_angle_stance?.value ?? 99) < 45 && (m.spine_angle_contact?.value ?? 99) < 45);
  check("posture_loss small on clean fixture", (m.posture_loss?.value ?? 99) < 10, `${m.posture_loss?.value.toFixed(1)}`);
  check(
    "swing_duration ≈ detected launch→contact",
    m.swing_duration !== undefined &&
      Math.abs(
        m.swing_duration.value -
          (clean.detection.events.contact! - clean.detection.events.launch!)
      ) < 1,
    `${m.swing_duration?.value}`
  );
  check("weight_transfer non-negative (moves toward pitcher)", (m.weight_transfer?.value ?? -1) >= 0);
  check("front_knee_angle present", m.front_knee_angle_contact !== undefined);
  check("no NaN anywhere", Object.values(m).every((v) => Number.isFinite(v.value)));
  check(
    "trunk metrics graded high confidence",
    m.posture_loss?.confidence === "high" && m.weight_transfer?.confidence === "high"
  );
}

console.log("Head-drift variant:");
{
  const { metrics } = metricsFor(generateSwing({ headDrift: 0.06 }));
  check(
    "head_drift clearly elevated vs clean",
    (metrics.head_drift?.value ?? 0) > (clean.metrics.head_drift?.value ?? 0) + 0.05,
    `${metrics.head_drift?.value.toFixed(3)} vs ${clean.metrics.head_drift?.value.toFixed(3)}`
  );
}

console.log("Lefty mirror parity:");
{
  const { metrics } = metricsFor(generateSwing({ lefty: true }));
  const tol = 0.02;
  check(
    "stride ratio matches righty",
    Math.abs((metrics.stride_length_ratio?.value ?? 0) - (clean.metrics.stride_length_ratio?.value ?? 0)) < tol,
    `${metrics.stride_length_ratio?.value.toFixed(3)}`
  );
  check(
    "head drift matches righty",
    Math.abs((metrics.head_drift?.value ?? 0) - (clean.metrics.head_drift?.value ?? 0)) < tol
  );
  check(
    "weight transfer sign preserved under mirroring",
    (metrics.weight_transfer?.value ?? -1) >= 0
  );
}

console.log("Missing plant event → dependent metrics absent, not garbage:");
{
  const conditioned = conditionSeries(generateSwing(), 120);
  const detection = detectPhases(conditioned)!;
  const stripped = {
    ...detection,
    events: { ...detection.events, plant: undefined, load: undefined },
  };
  const metrics = computeMetrics(conditioned, stripped);
  check("stride_length_ratio absent", metrics.stride_length_ratio === undefined);
  check("load_duration absent", metrics.load_duration === undefined);
  check("head_drift still present", metrics.head_drift !== undefined);
  check("no NaN anywhere", Object.values(metrics).every((v) => Number.isFinite(v.value)));
}

console.log("Low-visibility knee → confidence degraded, trunk unaffected:");
{
  const frames = generateSwing().map((f) => ({
    ...f,
    landmarks: f.landmarks.map((l, i) =>
      i === LM.leftKnee || i === LM.leftAnkle ? { ...l, visibility: 0.45 } : l
    ),
  }));
  const conditioned = conditionSeries(frames, 120);
  const detection = detectPhases(conditioned);
  check("still detects (knee isn't event-critical)", detection !== null);
  if (detection) {
    const metrics = computeMetrics(conditioned, detection);
    check(
      "knee metric low/medium confidence",
      metrics.front_knee_angle_contact === undefined ||
        metrics.front_knee_angle_contact.confidence !== "high",
      metrics.front_knee_angle_contact?.confidence
    );
    check("trunk metric still high confidence", metrics.posture_loss?.confidence === "high");
  }
}

console.log(failures === 0 ? "\nAll metric checks passed." : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
