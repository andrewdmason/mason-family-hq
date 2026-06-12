"use client";

import { useEffect, useMemo } from "react";
import Image from "next/image";
import { AlertTriangle, Download, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  HIGH_SPEED_FPS_THRESHOLD,
  type ClipProbe,
} from "@/lib/swing/pipeline/frame-source";
import type { ExtractionBenchmark } from "@/lib/swing/pipeline/extract";
import type { MetricValue } from "@/lib/swing/types";
import {
  computeWristTrackability,
  WRIST_VISIBILITY_THRESHOLD,
  type OkResult,
  type RejectedResult,
} from "./lab-types";
import { KeypointScrubber } from "./keypoint-scrubber";

export function ProbePanel({ probe }: { probe: ClipProbe }) {
  const fps = probe.trackFps;
  const slowMo = fps !== null && fps >= HIGH_SPEED_FPS_THRESHOLD;
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Clip probe</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
          <Field label="Decode path" value={probe.path} />
          <Field label="Codec" value={probe.codec ?? "unknown"} />
          <Field
            label="Track fps"
            value={fps !== null ? fps.toFixed(1) : "unknown"}
          />
          <Field
            label="Duration"
            value={`${probe.durationSeconds.toFixed(2)} s`}
          />
          <Field label="Dimensions" value={`${probe.width}×${probe.height}`} />
        </dl>
        {!slowMo && (
          <p className="flex items-start gap-1.5 text-sm text-amber-600 dark:text-amber-500">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            {fps === null
              ? "Couldn't read the track frame rate — slo-mo timing can't be confirmed."
              : `Track is ~${fps.toFixed(0)} fps — this clip isn't true slo-mo (≥${HIGH_SPEED_FPS_THRESHOLD} fps). A share path probably baked the slo-mo edit into a normal-rate file; timing confidence is reduced.`}
          </p>
        )}
        {probe.path === "unsupported" && probe.reason && (
          <p className="text-sm text-destructive">{probe.reason}</p>
        )}
      </CardContent>
    </Card>
  );
}

export function BenchmarkPanel({
  benchmark,
  delegate,
  wallTimeMs,
}: {
  benchmark: ExtractionBenchmark;
  delegate: string;
  wallTimeMs: number | null;
}) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Benchmark</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
          <Field label="Delegate used" value={delegate} />
          <Field
            label="Pose ms/frame"
            value={benchmark.poseMsPerFrame.toFixed(1)}
          />
          <Field
            label="Frames processed"
            value={String(benchmark.framesProcessed)}
          />
          <Field
            label="Total wall time"
            value={
              wallTimeMs !== null ? `${(wallTimeMs / 1000).toFixed(1)} s` : "—"
            }
          />
        </dl>
      </CardContent>
    </Card>
  );
}

export function RejectedPanel({ result }: { result: RejectedResult }) {
  return (
    <Card size="sm" className="border-destructive/40">
      <CardContent className="space-y-1">
        <p className="flex items-center gap-2 font-medium text-destructive">
          <XCircle className="size-4 shrink-0" />
          Clip rejected: {result.rejectionCode}
        </p>
        <p className="text-sm text-muted-foreground">
          {result.rejectionMessage}
        </p>
      </CardContent>
    </Card>
  );
}

export function WarningsList({ warnings }: { warnings: string[] }) {
  if (warnings.length === 0) return null;
  return (
    <Card size="sm" className="border-amber-500/40">
      <CardHeader>
        <CardTitle>Warnings</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-1 text-sm text-amber-700 dark:text-amber-500">
          {warnings.map((w, i) => (
            <li key={i} className="flex items-start gap-1.5">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              {w}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

/** All the ok-result readouts: gate panel, events, metrics, stills, export. */
export function OkResultPanels({
  result,
  probe,
  clipName,
}: {
  result: OkResult;
  probe: ClipProbe | null;
  clipName: string;
}) {
  const wrist = useMemo(
    () => computeWristTrackability(result.keypoints, result.events),
    [result.keypoints, result.events]
  );

  const eventRows = useMemo(
    () =>
      Object.entries(result.events)
        .filter((e): e is [string, number] => e[1] !== undefined)
        .sort((a, b) => a[1] - b[1]),
    [result.events]
  );

  const metricRows = useMemo(
    () =>
      Object.entries(result.metrics).filter(
        (e): e is [string, MetricValue] => e[1] !== undefined
      ),
    [result.metrics]
  );

  // Object URLs for the transferred still bytes; revoked on unmount/change.
  const stillUrls = useMemo(
    () =>
      result.stills.map((s) => ({
        phase: s.phase,
        annotations: s.annotations,
        url: URL.createObjectURL(new Blob([s.bytes], { type: s.contentType })),
      })),
    [result.stills]
  );
  useEffect(
    () => () => stillUrls.forEach((u) => URL.revokeObjectURL(u.url)),
    [stillUrls]
  );

  function downloadKeypoints() {
    // These JSONs become the fixtures for the U5/U6 verify scripts.
    const payload = {
      probe,
      events: result.events,
      metrics: result.metrics,
      detectedBats: result.detectedBats,
      heightNorm: result.heightNorm,
      keypoints: result.keypoints,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${clipName.replace(/\.[^.]+$/, "") || "clip"}.keypoints.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <WristTrackabilityPanel wrist={wrist} />
      <WarningsList warnings={result.warnings} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Card size="sm">
          <CardHeader>
            <CardTitle>Phase events</CardTitle>
          </CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <tbody>
                {eventRows.map(([phase, ms]) => (
                  <tr key={phase} className="border-b border-border/50 last:border-0">
                    <td className="py-1 pr-4 font-medium">{phase}</td>
                    <td className="py-1 text-right tabular-nums text-muted-foreground">
                      {ms.toFixed(0)} ms
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-xs text-muted-foreground tabular-nums">
              Detected bats: {result.detectedBats} · hitter height (norm):{" "}
              {result.heightNorm.toFixed(3)}
            </p>
          </CardContent>
        </Card>

        <Card size="sm">
          <CardHeader>
            <CardTitle>Metrics</CardTitle>
          </CardHeader>
          <CardContent>
            {metricRows.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No metrics computed.
              </p>
            ) : (
              <table className="w-full text-sm">
                <tbody>
                  {metricRows.map(([key, m]) => (
                    <tr key={key} className="border-b border-border/50 last:border-0">
                      <td className="py-1 pr-2 font-medium">{key}</td>
                      <td className="py-1 text-right tabular-nums">
                        {m.value.toFixed(2)}{" "}
                        <span className="text-muted-foreground">{m.unit}</span>
                      </td>
                      <td className="py-1 pl-2 text-right">
                        <Badge
                          variant={
                            m.confidence === "high" ? "secondary" : "outline"
                          }
                        >
                          {m.confidence}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      </div>

      {stillUrls.length > 0 && (
        <Card size="sm">
          <CardHeader>
            <CardTitle>Evidence stills</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {stillUrls.map((s) => (
                <figure key={s.phase} className="space-y-1">
                  {/* Blob URL, lifecycle owned here — next/image can't optimize it. */}
                  <Image
                    src={s.url}
                    alt={`${s.phase} still`}
                    width={320}
                    height={180}
                    unoptimized
                    className="h-auto w-full rounded-lg border"
                  />
                  <figcaption className="text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">
                      {s.phase}
                    </span>
                    {s.annotations.length > 0 && (
                      <> · {s.annotations.join(", ")}</>
                    )}
                  </figcaption>
                </figure>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card size="sm">
        <CardHeader>
          <CardTitle>Skeleton scrubber</CardTitle>
        </CardHeader>
        <CardContent>
          <KeypointScrubber
            keypoints={result.keypoints}
            events={result.events}
            aspectRatio={probe && probe.height > 0 ? probe.width / probe.height : 16 / 9}
          />
        </CardContent>
      </Card>

      <div>
        <Button variant="outline" onClick={downloadKeypoints}>
          <Download data-icon="inline-start" />
          Download keypoints JSON
        </Button>
      </div>
    </>
  );
}

function WristTrackabilityPanel({
  wrist,
}: {
  wrist: ReturnType<typeof computeWristTrackability>;
}) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Wrist trackability through launch→contact</CardTitle>
      </CardHeader>
      <CardContent>
        {wrist === null ? (
          <p className="text-sm text-muted-foreground">
            Launch/contact events missing — the window can&apos;t be evaluated.
          </p>
        ) : (
          <div className="space-y-1">
            <p className="text-2xl font-semibold tabular-nums">
              {(wrist.trackableFraction * 100).toFixed(0)}%
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                of {wrist.frameCount} frames with best-wrist visibility ≥{" "}
                {WRIST_VISIBILITY_THRESHOLD}
              </span>
            </p>
            <p className="text-sm text-muted-foreground tabular-nums">
              min {wrist.minVisibility.toFixed(2)} · mean{" "}
              {wrist.meanVisibility.toFixed(2)} — this is the U1 spike gate for
              extremity-keyed phase detection (U5).
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="truncate font-medium tabular-nums">{value}</dd>
    </div>
  );
}
