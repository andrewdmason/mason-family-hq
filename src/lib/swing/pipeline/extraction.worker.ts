// Extraction worker: WebCodecs decode path, fully in-worker. Contract is
// ARTIFACTS-OUT — the worker never uploads or touches Supabase/session
// identity (that coupling would break the v2 live-mode reuse and ties
// persistence retry to re-extraction). The host page owns everything after
// the result message.
//
// Messages in:  { type: "extract", jobId, file, model?, delegate? }
// Messages out: { type: "probe",    jobId, probe }
//               { type: "progress", jobId, stage, done, total }
//               { type: "result",   jobId, ... ExtractionResult with stills
//                  as transferable ArrayBuffers + keypoints JSON }
//               { type: "error",    jobId, message }   (unexpected failures)

import type { Bats, SwingEvents, SwingMetrics, SwingPhase } from "@/lib/swing/types";
import { openClip } from "./decode";
import { extractClip, type ExtractionBenchmark, type ExtractionProgress } from "./extract";
import type { ClipProbe } from "./frame-source";
import {
  createLandmarker,
  type KeypointFrame,
  type PoseDelegate,
  type PoseModel,
} from "./pose";
import type { RejectionCode } from "./quality";

export interface ExtractRequest {
  type: "extract";
  jobId: string;
  file: File | Blob;
  model?: PoseModel;
  delegate?: PoseDelegate;
}

interface StillPayload {
  phase: SwingPhase;
  contentType: string;
  annotations: string[];
  bytes: ArrayBuffer;
}

/** Everything this worker actually posts — the host switches on these. */
export type WorkerOutMessage =
  | { type: "probe"; jobId: string; probe: ClipProbe }
  | ({ type: "progress"; jobId: string } & ExtractionProgress)
  | { type: "result"; jobId: string; ok: false; needsFallback: true }
  | {
      type: "result";
      jobId: string;
      ok: false;
      needsFallback?: undefined;
      rejectionCode: RejectionCode;
      rejectionMessage: string;
      warnings: string[];
      benchmark: ExtractionBenchmark;
      delegate: PoseDelegate;
    }
  | {
      type: "result";
      jobId: string;
      ok: true;
      needsFallback?: undefined;
      events: SwingEvents;
      metrics: SwingMetrics;
      detectedBats: Bats;
      heightNorm: number;
      slowMotionFactor: number;
      keypoints: KeypointFrame[];
      warnings: string[];
      benchmark: ExtractionBenchmark;
      delegate: PoseDelegate;
      stills: StillPayload[];
    }
  | { type: "error"; jobId: string; message: string };

self.onmessage = async (event: MessageEvent<ExtractRequest>) => {
  const msg = event.data;
  if (msg?.type !== "extract") return;
  const { jobId } = msg;
  try {
    const { probe, source } = await openClip(msg.file);
    postMessage({ type: "probe", jobId, probe });
    if (!source) {
      // Unsupported or needs the main-thread <video> fallback — the host
      // decides based on probe.path; nothing more for the worker to do.
      postMessage({ type: "result", jobId, ok: false, needsFallback: true });
      return;
    }

    const { landmarker, delegate } = await createLandmarker(
      msg.model ?? "heavy",
      msg.delegate ?? "GPU"
    );
    try {
      const result = await extractClip(source, landmarker, probe, (p) =>
        postMessage({ type: "progress", jobId, ...p })
      );

      if (!result.ok) {
        postMessage({ type: "result", jobId, ...result, delegate });
        return;
      }

      const stills: StillPayload[] = [];
      const transfers: ArrayBuffer[] = [];
      for (const s of result.stills) {
        const bytes = await s.blob.arrayBuffer();
        stills.push({
          phase: s.phase,
          contentType: s.contentType,
          annotations: s.annotations,
          bytes,
        });
        transfers.push(bytes);
      }
      postMessage(
        {
          type: "result",
          jobId,
          ok: true,
          events: result.events,
          metrics: result.metrics,
          detectedBats: result.detectedBats,
          heightNorm: result.heightNorm,
          slowMotionFactor: result.slowMotionFactor,
          keypoints: result.keypoints,
          warnings: result.warnings,
          benchmark: result.benchmark,
          delegate,
          stills,
        },
        { transfer: transfers }
      );
    } finally {
      landmarker.close();
      source.close();
    }
  } catch (error) {
    postMessage({
      type: "error",
      jobId,
      message: error instanceof Error ? error.message : "Extraction failed",
    });
  }
};
