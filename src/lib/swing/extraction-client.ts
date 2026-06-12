"use client";

// Host-side extraction runner. Owns everything the worker deliberately
// doesn't: choosing worker-vs-fallback, the content fingerprint, gzipping
// keypoints, and normalizing results for the session shell. Artifacts stay
// in memory for the life of the tab (no IndexedDB in v1): upload retry within
// the tab never re-extracts; a refresh means re-adding the file, which is
// safe because the hash upsert resets the pending row.

import type { Bats, SwingEvents, SwingMetrics, SwingPhase } from "@/lib/swing/types";
import type { ClipProbe } from "@/lib/swing/pipeline/frame-source";
import type { ExtractionProgress } from "@/lib/swing/pipeline/extract";
import type { PoseDelegate, PoseModel } from "@/lib/swing/pipeline/pose";

export interface ClientStill {
  phase: SwingPhase;
  contentType: string;
  annotations: string[];
  blob: Blob;
}

export type ClientExtraction =
  | {
      ok: true;
      probe: ClipProbe;
      events: SwingEvents;
      metrics: SwingMetrics;
      detectedBats: Bats;
      heightNorm: number;
      keypointsGzip: Blob;
      stills: ClientStill[];
      warnings: string[];
    }
  | {
      ok: false;
      probe: ClipProbe | null;
      rejectionCode: string;
      rejectionMessage: string;
      warnings: string[];
    };

export interface ExtractHandlers {
  onProbe?: (probe: ClipProbe) => void;
  onProgress?: (p: ExtractionProgress) => void;
}

/**
 * Constant-memory content fingerprint: SHA-256 over file size + first and
 * last 1 MiB via Blob.slice. NEVER a whole-file digest — crypto.subtle would
 * buffer a 100–400 MB HEVC clip and kill iOS Safari tabs. Sufficient for
 * same-file re-add detection in this trust model; semantics documented on
 * the UNIQUE (session_id, content_hash) constraint in the migration.
 */
export async function fingerprintFile(file: Blob): Promise<string> {
  const MiB = 1024 * 1024;
  const head = await file.slice(0, MiB).arrayBuffer();
  const tail =
    file.size > MiB
      ? await file.slice(Math.max(0, file.size - MiB)).arrayBuffer()
      : new ArrayBuffer(0);
  const sizeBytes = new TextEncoder().encode(String(file.size));
  const joined = new Uint8Array(sizeBytes.length + head.byteLength + tail.byteLength);
  joined.set(sizeBytes, 0);
  joined.set(new Uint8Array(head), sizeBytes.length);
  joined.set(new Uint8Array(tail), sizeBytes.length + head.byteLength);
  const digest = await crypto.subtle.digest("SHA-256", joined);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function gzipJson(value: unknown): Promise<Blob> {
  const stream = new Blob([JSON.stringify(value)])
    .stream()
    .pipeThrough(new CompressionStream("gzip"));
  return new Response(stream).blob();
}

/**
 * Extract one clip in the browser: worker-hosted WebCodecs path when
 * decodable, main-thread seek-step fallback otherwise. Returns normalized
 * artifacts; never throws for per-clip quality problems (those are results).
 */
export async function extractInBrowser(
  file: File,
  handlers: ExtractHandlers = {},
  options: { model?: PoseModel; delegate?: PoseDelegate } = {}
): Promise<ClientExtraction> {
  const viaWorker = await extractViaWorker(file, handlers, options);
  if (viaWorker !== "needs-fallback") return viaWorker;
  return extractOnMainThread(file, handlers, options);
}

function extractViaWorker(
  file: File,
  handlers: ExtractHandlers,
  options: { model?: PoseModel; delegate?: PoseDelegate }
): Promise<ClientExtraction | "needs-fallback"> {
  return new Promise((resolve) => {
    const worker = new Worker(
      new URL("./pipeline/extraction.worker.ts", import.meta.url)
    );
    const jobId = crypto.randomUUID();
    let probe: ClipProbe | null = null;

    const finish = (value: ClientExtraction | "needs-fallback") => {
      worker.terminate();
      resolve(value);
    };

    worker.onerror = () => finish("needs-fallback");
    worker.onmessage = async (event) => {
      const msg = event.data;
      if (msg.jobId !== jobId) return;
      switch (msg.type) {
        case "probe":
          probe = msg.probe;
          handlers.onProbe?.(msg.probe);
          return;
        case "progress":
          handlers.onProgress?.(msg);
          return;
        case "error":
          finish("needs-fallback");
          return;
        case "result": {
          if (msg.needsFallback) {
            finish(probe?.path === "unsupported" ? unsupportedResult(probe) : "needs-fallback");
            return;
          }
          if (!msg.ok) {
            finish({
              ok: false,
              probe,
              rejectionCode: msg.rejectionCode,
              rejectionMessage: msg.rejectionMessage,
              warnings: msg.warnings ?? [],
            });
            return;
          }
          finish({
            ok: true,
            probe: probe!,
            events: msg.events,
            metrics: msg.metrics,
            detectedBats: msg.detectedBats,
            heightNorm: msg.heightNorm,
            keypointsGzip: await gzipJson({
              version: 1,
              events: msg.events,
              keypoints: msg.keypoints,
            }),
            stills: msg.stills.map(
              (s: { phase: SwingPhase; contentType: string; annotations: string[]; bytes: ArrayBuffer }) => ({
                phase: s.phase,
                contentType: s.contentType,
                annotations: s.annotations,
                blob: new Blob([s.bytes], { type: s.contentType }),
              })
            ),
            warnings: msg.warnings ?? [],
          });
        }
      }
    };

    worker.postMessage({
      type: "extract",
      jobId,
      file,
      model: options.model,
      delegate: options.delegate,
    });
  });
}

/**
 * Main-thread fallback: <video> seek-stepping (DOM-bound) + the same pure
 * pipeline. Slower and it blocks the UI thread during pose — acceptable for
 * the rare environments without a WebCodecs path for this codec.
 */
async function extractOnMainThread(
  file: File,
  handlers: ExtractHandlers,
  options: { model?: PoseModel; delegate?: PoseDelegate }
): Promise<ClientExtraction> {
  const [{ openClip, VideoElementFrameSource }, { createLandmarker }, { extractClip }] =
    await Promise.all([
      import("./pipeline/decode"),
      import("./pipeline/pose"),
      import("./pipeline/extract"),
    ]);

  const { probe } = await openClip(file);
  handlers.onProbe?.(probe);
  if (probe.path === "unsupported") return unsupportedResult(probe);

  let source: InstanceType<typeof VideoElementFrameSource>;
  try {
    source = new VideoElementFrameSource(file);
  } catch {
    return unsupportedResult(probe);
  }

  try {
    const { landmarker } = await createLandmarker(
      options.model ?? "heavy",
      options.delegate ?? "GPU"
    );
    try {
      const result = await extractClip(source, landmarker, probe, (p) =>
        handlers.onProgress?.(p)
      );
      if (!result.ok) {
        return {
          ok: false,
          probe,
          rejectionCode: result.rejectionCode,
          rejectionMessage: result.rejectionMessage,
          warnings: result.warnings,
        };
      }
      return {
        ok: true,
        probe,
        events: result.events,
        metrics: result.metrics,
        detectedBats: result.detectedBats,
        heightNorm: result.heightNorm,
        keypointsGzip: await gzipJson({
          version: 1,
          events: result.events,
          keypoints: result.keypoints,
        }),
        stills: result.stills.map((s) => ({
          phase: s.phase,
          contentType: s.contentType,
          annotations: s.annotations,
          blob: s.blob,
        })),
        warnings: result.warnings,
      };
    } finally {
      landmarker.close();
    }
  } catch (error) {
    return {
      ok: false,
      probe,
      rejectionCode: "extraction_error",
      rejectionMessage:
        error instanceof Error ? error.message : "Extraction failed in this browser.",
      warnings: [],
    };
  } finally {
    source.close();
  }
}

function unsupportedResult(probe: ClipProbe): ClientExtraction {
  return {
    ok: false,
    probe,
    rejectionCode: "unsupported_browser",
    rejectionMessage:
      probe.reason ??
      "This browser can't decode this video. Use Chrome or Safari on a Mac or iPhone.",
    warnings: [],
  };
}
