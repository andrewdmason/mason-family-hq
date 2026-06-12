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

import { openClip } from "./decode";
import { extractClip } from "./extract";
import { createLandmarker, type PoseDelegate, type PoseModel } from "./pose";

export interface ExtractRequest {
  type: "extract";
  jobId: string;
  file: File | Blob;
  model?: PoseModel;
  delegate?: PoseDelegate;
}

interface StillPayload {
  phase: string;
  contentType: string;
  annotations: string[];
  bytes: ArrayBuffer;
}

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
