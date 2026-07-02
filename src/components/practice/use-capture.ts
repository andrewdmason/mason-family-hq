"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  concreteAudioInputs,
  getStoredInputDeviceId,
  setStoredInputDeviceId,
} from "@/lib/practice/capture";

// Enumerates audio inputs for a device picker.
//
// Browsers withhold device labels — and collapse the input list to a single
// generic placeholder — until getUserMedia has been granted at least once on
// the page. Without a probe, enumerateDevices can't see or name external
// interfaces (e.g. a USB audio device), so the picker only offers "System
// default" + an unlabeled "Microphone".
//
// - `refreshInputs` re-enumerates without probing (use after gUM succeeds).
// - `probeAndRefreshInputs` acquires a throwaway stream to unlock permission,
//   stops it immediately, then re-enumerates so the full, labeled list
//   populates the picker.
// - `loadOnMount` enumerates on mount and probes only when every input is
//   unlabeled, so already-granted pages skip the extra gUM.
export function useAudioInputs(options?: { loadOnMount?: boolean }) {
  const loadOnMount = options?.loadOnMount ?? false;
  const [inputs, setInputs] = useState<MediaDeviceInfo[]>([]);

  const refreshInputs = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) {
      return;
    }
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      setInputs(devices.filter((d) => d.kind === "audioinput"));
    } catch {
      /* ignore */
    }
  }, []);

  const probeAndRefreshInputs = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      await refreshInputs();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
    } catch {
      // Permission denied or unavailable — the caller's record path surfaces
      // the error. Still enumerate so any already-permitted devices show up.
    }
    await refreshInputs();
  }, [refreshInputs]);

  useEffect(() => {
    if (!loadOnMount) return;
    let cancelled = false;
    async function load() {
      if (!navigator.mediaDevices?.enumerateDevices) return;
      try {
        let devices = await navigator.mediaDevices.enumerateDevices();
        let audio = devices.filter((d) => d.kind === "audioinput");
        // Labels are withheld until mic permission is granted once; a throwaway
        // probe reveals the real device names (incl. the iPhone) so the picker works.
        if (audio.length && audio.every((d) => !d.label)) {
          try {
            const s = await navigator.mediaDevices.getUserMedia({ audio: true });
            s.getTracks().forEach((t) => t.stop());
            devices = await navigator.mediaDevices.enumerateDevices();
            audio = devices.filter((d) => d.kind === "audioinput");
          } catch {
            /* permission denied — leave list as-is */
          }
        }
        if (!cancelled) setInputs(audio);
      } catch {
        /* ignore */
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [loadOnMount]);

  const concreteInputs = useMemo(() => concreteAudioInputs(inputs), [inputs]);

  return { inputs, concreteInputs, refreshInputs, probeAndRefreshInputs };
}

// The mic-device preference, synced to the shared localStorage key so the
// chosen mic carries over between recorders. `null` means system default.
export function useInputDevicePreference() {
  const [deviceId, setDeviceId] = useState<string | null>(() =>
    getStoredInputDeviceId()
  );
  const chooseDevice = useCallback((id: string | null) => {
    setDeviceId(id);
    setStoredInputDeviceId(id);
  }, []);
  return { deviceId, chooseDevice };
}

// Live input-level meter: taps a mic stream so a dead/muted/wrong device is
// visible while recording, instead of silently producing a useless recording.
// `level` is 0..1 (throttled to ~60ms updates); `silent` flips true when
// nothing has been heard after the first 4 seconds; `heardRef.current` reports
// whether any signal was ever heard on the current meter run.
export function useLevelMeter() {
  const [level, setLevel] = useState(0); // live input level 0..1
  const [silent, setSilent] = useState(false); // no input heard after a few seconds
  const audioCtxRef = useRef<AudioContext | null>(null);
  const levelRafRef = useRef<number | null>(null);
  const heardRef = useRef(false);
  const meterUpdatedRef = useRef(0);

  const startMeter = useCallback((stream: MediaStream) => {
    try {
      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const buf = new Float32Array(analyser.fftSize);
      heardRef.current = false;
      const startedAt = performance.now();
      const tick = () => {
        analyser.getFloatTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
        const rms = Math.sqrt(sum / buf.length);
        if (rms > 0.008) heardRef.current = true;
        const now = performance.now();
        if (now - meterUpdatedRef.current > 60) {
          meterUpdatedRef.current = now;
          setLevel(Math.min(1, rms * 5));
          setSilent(!heardRef.current && now - startedAt > 4000);
        }
        levelRafRef.current = requestAnimationFrame(tick);
      };
      levelRafRef.current = requestAnimationFrame(tick);
    } catch {
      /* meter is best-effort */
    }
  }, []);

  const stopMeter = useCallback(() => {
    if (levelRafRef.current) cancelAnimationFrame(levelRafRef.current);
    levelRafRef.current = null;
    void audioCtxRef.current?.close();
    audioCtxRef.current = null;
  }, []);

  const resetMeter = useCallback(() => {
    setLevel(0);
    setSilent(false);
  }, []);

  // Best-effort teardown if the owner unmounts without stopping (idempotent).
  useEffect(() => stopMeter, [stopMeter]);

  return { level, silent, heardRef, startMeter, stopMeter, resetMeter };
}
