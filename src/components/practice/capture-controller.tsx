"use client";

// Capture controller riding the practice timer (plan U4, KTD2/KTD3/KTD6/KTD7).
// Mounted beside the timer UI inside TaskTimerProvider; renders nothing. With
// the auto-record toggle on, every gesture-started task-run records one audio
// segment from the shared mic preference; segments finalize on pause, switch,
// complete+auto-advance, reset, toggle-off, and layout unmount, then upload
// and kick off processing in the background. Everything degrades quietly —
// nothing here may ever block or break the timer (R17).

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import {
  subscribeTaskTimerRunEvents,
  useTaskTimer,
  type TimerRunEvent,
} from "@/components/timer/task-timer-context";
import {
  concreteAudioInputs,
  effectiveInputDeviceId,
  getAutoRecordEnabled,
  getStoredInputDeviceId,
  pickMimeType,
  resolveRecordingDeviceId,
  setAutoRecordEnabled,
} from "@/lib/practice/capture";
import { useLevelMeter } from "@/components/practice/use-capture";
import { createSegmentRecording } from "@/app/practice/recordings/segment-actions";
import { finishSegmentUpload } from "@/lib/practice/segment-upload";
import { putSegment, type BufferedSegment } from "@/lib/practice/segment-buffer";

// ---------------------------------------------------------------------------
// Shared capture status — a tiny external store so the transport bar (a
// sibling, not a descendant) can render the recording dot, level meter,
// silent-input warning, and mic-unavailable state without new context nesting.
// ---------------------------------------------------------------------------

export type CaptureStatus = {
  /** Mirror of the per-device auto-record preference. */
  enabled: boolean;
  /** A MediaRecorder is live for the active task-run. */
  recording: boolean;
  /** Live input level 0..1 while recording (throttled by useLevelMeter). */
  level: number;
  /** No input heard after the meter's grace period — probably the wrong mic. */
  silent: boolean;
  /** Toggle on + run authorized, but gUM failed or the track ended. */
  micUnavailable: boolean;
};

const SERVER_STATUS: CaptureStatus = {
  enabled: false,
  recording: false,
  level: 0,
  silent: false,
  micUnavailable: false,
};

let captureStatus: CaptureStatus = SERVER_STATUS;
const statusListeners = new Set<() => void>();

function updateCaptureStatus(patch: Partial<CaptureStatus>) {
  const next = { ...captureStatus, ...patch };
  if (
    next.enabled === captureStatus.enabled &&
    next.recording === captureStatus.recording &&
    next.level === captureStatus.level &&
    next.silent === captureStatus.silent &&
    next.micUnavailable === captureStatus.micUnavailable
  ) {
    return;
  }
  captureStatus = next;
  for (const listener of statusListeners) listener();
}

function subscribeCaptureStatus(listener: () => void): () => void {
  statusListeners.add(listener);
  return () => {
    statusListeners.delete(listener);
  };
}

export function useCaptureStatus(): CaptureStatus {
  return useSyncExternalStore(
    subscribeCaptureStatus,
    () => captureStatus,
    () => SERVER_STATUS
  );
}

/** Flip the per-device auto-record preference (transport-bar toggle). The
 * controller reacts through the store: off mid-run finalizes the segment,
 * on mid-authorized-run starts one. */
export function setAutoRecordPreference(on: boolean) {
  setAutoRecordEnabled(on);
  updateCaptureStatus({ enabled: on });
}

// ---------------------------------------------------------------------------
// Module-scope run authorization (KTD2). Set when a run starts from a gesture
// in this tab; survives practice-layout remounts (navigate away and back
// mid-run auto-starts a fresh segment for the same authorized run) but dies
// with the tab and is never persisted — reloads and second tabs show
// not-recording and never auto-resume. That is the multi-tab guard.
// ---------------------------------------------------------------------------

let authorizedRunTaskId: string | null = null;

// ---------------------------------------------------------------------------
// Constants (KTD6/KTD7)
// ---------------------------------------------------------------------------

/** Segments shorter than this are discarded silently. */
const MIN_SEGMENT_MS = 2000;
/** Auto captures are transcription-grade: mono at 128 kbps (KTD7). */
const AUDIO_BITS_PER_SECOND = 128_000;

type ActiveRecording = {
  recorder: MediaRecorder;
  chunks: Blob[];
  taskId: string;
  pieceId: string | null;
  mime: string;
  ext: "webm" | "m4a";
  startedAt: number;
};

/** The device to record from: the shared mic preference if it still exists,
 * else a concrete non-iPhone input (anti-Continuity, same as the recorders). */
async function resolveCaptureDeviceId(): Promise<string | null> {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const inputs = devices.filter((d) => d.kind === "audioinput");
    const concrete = concreteAudioInputs(inputs);
    const effective = effectiveInputDeviceId(getStoredInputDeviceId(), concrete);
    return resolveRecordingDeviceId(effective, concrete);
  } catch {
    return null;
  }
}

/**
 * Buffer, register, upload, and kick off a finalized segment (KTD6). Fire-and-
 * forget: runs to completion even after the controller unmounts (navigating
 * away mid-segment still uploads). Every failure degrades to a quiet log —
 * the row/buffer combination lets U5's sweep recover any stuck state:
 * - buffer put fails → continue with the in-memory blob (best-effort buffer).
 * - row creation fails → blob stays buffered, no row (nothing to sweep yet).
 * - upload fails after retries → row stays 'recorded', blob stays buffered;
 *   the sweep re-uploads from the buffer.
 * - markSegmentUploaded fails → same recovery (upsert makes re-upload safe).
 * - kickoff fails → row stays 'uploaded'; the sweep re-kicks without needing
 *   the blob, so the buffer is already deleted by then.
 */
async function persistSegment(rec: ActiveRecording, blob: Blob): Promise<void> {
  const clientId = crypto.randomUUID();
  const durationSeconds = (Date.now() - rec.startedAt) / 1000;
  const buffered: BufferedSegment = {
    id: clientId,
    blob,
    ext: rec.ext,
    taskId: rec.taskId,
    pieceId: rec.pieceId,
    durationSeconds,
    recordingId: null,
    createdAt: Date.now(),
  };

  let hasBuffer = false;
  try {
    await putSegment(buffered);
    hasBuffer = true;
  } catch {
    // IndexedDB is best-effort; proceed with the in-memory blob.
  }

  let recordingId: string;
  let path: string;
  let token: string;
  try {
    ({ recordingId, path, token } = await createSegmentRecording(
      rec.taskId,
      rec.pieceId,
      rec.ext
    ));
  } catch (err) {
    console.warn("[capture] segment row creation failed; blob kept in buffer", err);
    return;
  }

  if (hasBuffer) {
    try {
      await putSegment({ ...buffered, recordingId });
    } catch {
      /* ignore */
    }
  }

  await finishSegmentUpload({
    recordingId,
    path,
    token,
    blob,
    ext: rec.ext,
    durationSeconds,
    bufferId: hasBuffer ? clientId : null,
  });
}

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

export function CaptureController() {
  const { activeTaskId, activeTaskMeta } = useTaskTimer();
  const capture = useCaptureStatus();
  const { level, silent, startMeter, stopMeter, resetMeter } = useLevelMeter();

  const streamRef = useRef<MediaStream | null>(null);
  const recRef = useRef<ActiveRecording | null>(null);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const acquiringRef = useRef(false);
  /** The run a recorder should start for once a stream is available. Cleared
   * by run-end so a slow gUM can't start recording a run that already ended. */
  const pendingStartRef = useRef<{ taskId: string; pieceId: string | null } | null>(
    null
  );
  const teardownTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // --- wake lock (held while recording; browsers drop it on hide) ---

  const requestWakeLock = useCallback(async () => {
    try {
      if (typeof navigator === "undefined" || !("wakeLock" in navigator)) return;
      const lock = await navigator.wakeLock.request("screen");
      wakeLockRef.current = lock;
      lock.addEventListener("release", () => {
        if (wakeLockRef.current === lock) wakeLockRef.current = null;
      });
    } catch {
      // Best-effort — recording continues without it.
    }
  }, []);

  const releaseWakeLock = useCallback(() => {
    const lock = wakeLockRef.current;
    wakeLockRef.current = null;
    void lock?.release().catch(() => {});
  }, []);

  // --- stream/recorder machinery ---

  /** Stop the live recorder (its onstop handler persists the blob) without
   * touching the stream, so an immediately-following start can reuse it. */
  const stopCurrentRecorder = useCallback(() => {
    const rec = recRef.current;
    if (!rec) return;
    recRef.current = null;
    updateCaptureStatus({ recording: false });
    try {
      if (rec.recorder.state !== "inactive") rec.recorder.stop();
    } catch {
      /* already stopped */
    }
  }, []);

  const teardownStream = useCallback(() => {
    stopMeter();
    resetMeter();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    releaseWakeLock();
    updateCaptureStatus({ recording: false, level: 0, silent: false });
  }, [stopMeter, resetMeter, releaseWakeLock]);

  const cancelScheduledTeardown = useCallback(() => {
    if (teardownTimerRef.current) {
      clearTimeout(teardownTimerRef.current);
      teardownTimerRef.current = null;
    }
  }, []);

  /** Deferred teardown: pause→start pairs (auto-advance, switch, reset) are
   * synchronous, so the stream must survive across them (KTD3). The timeout
   * fires after the synchronous pair and only tears down if nothing took
   * over the stream. */
  const scheduleTeardown = useCallback(() => {
    cancelScheduledTeardown();
    teardownTimerRef.current = setTimeout(() => {
      teardownTimerRef.current = null;
      if (!recRef.current && !pendingStartRef.current && !acquiringRef.current) {
        teardownStream();
      }
    }, 0);
  }, [cancelScheduledTeardown, teardownStream]);

  /** Mic unplugged / track died mid-run: the recorder auto-stops (its onstop
   * persists whatever partial blob exists, if >= 2s), we surface the
   * mic-unavailable state, and the timer is never touched. */
  const handleTrackEnded = useCallback(() => {
    if (!streamRef.current) return;
    pendingStartRef.current = null;
    stopCurrentRecorder();
    teardownStream();
    updateCaptureStatus({ micUnavailable: true });
  }, [stopCurrentRecorder, teardownStream]);

  /** Start a MediaRecorder for pendingStartRef on the live stream. */
  const beginRecorder = useCallback(() => {
    const pending = pendingStartRef.current;
    const stream = streamRef.current;
    if (!pending || !stream) return;
    pendingStartRef.current = null;

    const { mime, ext } = pickMimeType();
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(
        stream,
        mime
          ? { mimeType: mime, audioBitsPerSecond: AUDIO_BITS_PER_SECOND }
          : { audioBitsPerSecond: AUDIO_BITS_PER_SECOND }
      );
    } catch {
      updateCaptureStatus({ micUnavailable: true });
      scheduleTeardown();
      return;
    }

    const rec: ActiveRecording = {
      recorder,
      chunks: [],
      taskId: pending.taskId,
      pieceId: pending.pieceId,
      mime,
      ext,
      startedAt: Date.now(),
    };
    recorder.ondataavailable = (e) => {
      if (e.data.size) rec.chunks.push(e.data);
    };
    // onstop fires exactly once per recorder (explicit stop or track-end
    // auto-stop), which is what makes every segment finalize exactly once.
    recorder.onstop = () => {
      const durationMs = Date.now() - rec.startedAt;
      const blob = new Blob(rec.chunks, {
        type: rec.mime || rec.recorder.mimeType || "audio/mp4",
      });
      if (durationMs < MIN_SEGMENT_MS || blob.size === 0) return; // discard silently
      void persistSegment(rec, blob);
    };
    try {
      recorder.start();
    } catch {
      updateCaptureStatus({ micUnavailable: true });
      scheduleTeardown();
      return;
    }
    recRef.current = rec;
    updateCaptureStatus({ recording: true, micUnavailable: false });
    if (!wakeLockRef.current) void requestWakeLock();
  }, [requestWakeLock, scheduleTeardown]);

  const acquireStreamAndBegin = useCallback(async () => {
    acquiringRef.current = true;
    try {
      const deviceId = await resolveCaptureDeviceId();
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: deviceId ? { exact: deviceId } : { ideal: "default" },
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 1,
        },
      });
      acquiringRef.current = false;
      // The run may have ended (or the toggle flipped off) while gUM was
      // pending — drop the stream instead of recording nothing.
      if (!pendingStartRef.current || !getAutoRecordEnabled()) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;
      stream.getTracks().forEach((t) => t.addEventListener("ended", handleTrackEnded));
      resetMeter();
      startMeter(stream);
      updateCaptureStatus({ micUnavailable: false });
      beginRecorder();
    } catch {
      // gUM denied/unavailable: quiet mic-unavailable state; the timer is
      // never blocked (R17). The next start gesture retries.
      acquiringRef.current = false;
      pendingStartRef.current = null;
      updateCaptureStatus({ micUnavailable: true, recording: false });
    }
  }, [beginRecorder, handleTrackEnded, resetMeter, startMeter]);

  /** Start a segment for a task-run. If a recorder is live (switch,
   * auto-advance, reset), it finalizes first and the new recorder starts on
   * the SAME stream — no re-acquisition, no gap-crash. */
  const startSegment = useCallback(
    (taskId: string, pieceId: string | null) => {
      if (!getAutoRecordEnabled()) return;
      if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
        return;
      }
      cancelScheduledTeardown();
      pendingStartRef.current = { taskId, pieceId };
      stopCurrentRecorder(); // serialized handoff: end N before starting N+1
      if (streamRef.current) {
        beginRecorder();
        return;
      }
      if (acquiringRef.current) return; // in-flight gUM will pick up pendingStartRef
      void acquireStreamAndBegin();
    },
    [
      acquireStreamAndBegin,
      beginRecorder,
      cancelScheduledTeardown,
      stopCurrentRecorder,
    ]
  );

  /** End the current segment (pause/switch/reset/toggle-off). Stream teardown
   * is deferred so a synchronous follow-up start reuses it. */
  const endSegment = useCallback(() => {
    pendingStartRef.current = null;
    stopCurrentRecorder();
    scheduleTeardown();
  }, [scheduleTeardown, stopCurrentRecorder]);

  // --- timer run events (the KTD3 segment-ender taxonomy) ---

  const handleRunEvent = useCallback(
    (event: TimerRunEvent) => {
      if (event.type === "run-start") {
        // Every run-start is gesture-driven (restore never emits) — this run
        // is authorized for this tab until it pauses.
        authorizedRunTaskId = event.taskId;
        startSegment(event.taskId, event.meta?.pieceId ?? null);
        return;
      }
      // run-end: pause ends the run outright; switch/reset are immediately
      // followed by a synchronous run-start that re-authorizes.
      if (event.reason === "pause") authorizedRunTaskId = null;
      endSegment();
    },
    [endSegment, startSegment]
  );

  useEffect(
    () => subscribeTaskTimerRunEvents(handleRunEvent),
    [handleRunEvent]
  );

  // --- toggle reactions + same-tab auto-resume (KTD2) ---
  // Covers: (a) controller remount while the authorized run is still active
  // (navigated away and back — a fresh segment starts automatically);
  // (b) toggle flipped on mid-authorized-run; (c) toggle flipped off mid-run
  // (segment finalizes). A restored run in a fresh tab/reload never matches
  // authorizedRunTaskId, so it stays not-recording.
  useEffect(() => {
    if (!capture.enabled) {
      if (recRef.current || pendingStartRef.current || acquiringRef.current) {
        endSegment();
      }
      return;
    }
    if (
      activeTaskId &&
      authorizedRunTaskId === activeTaskId &&
      !recRef.current &&
      !pendingStartRef.current &&
      !acquiringRef.current &&
      !captureStatus.micUnavailable
    ) {
      startSegment(activeTaskId, activeTaskMeta?.pieceId ?? null);
    }
  }, [capture.enabled, activeTaskId, activeTaskMeta, endSegment, startSegment]);

  // --- mount/unmount ---

  useEffect(() => {
    updateCaptureStatus({ enabled: getAutoRecordEnabled() });
    return () => {
      // Layout unmount ends the segment normally; persistSegment keeps
      // running detached, so the upload proceeds while the user is elsewhere.
      pendingStartRef.current = null;
      stopCurrentRecorder();
      cancelScheduledTeardown();
      teardownStream();
    };
    // Mount/unmount only — the callbacks are stable (refs + stable hooks).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mirror the level meter into the shared store for the transport bar.
  useEffect(() => {
    updateCaptureStatus({ level, silent });
  }, [level, silent]);

  // Wake locks are released by the browser when the page hides; re-acquire
  // when it becomes visible again if we're still recording.
  useEffect(() => {
    const handler = () => {
      if (document.visibilityState !== "visible") return;
      if (recRef.current && !wakeLockRef.current) void requestWakeLock();
    };
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }, [requestWakeLock]);

  return null;
}
