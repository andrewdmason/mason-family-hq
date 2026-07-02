"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  MicIcon,
  Trash2Icon,
  Loader2Icon,
  AlertCircleIcon,
  PlayIcon,
  PauseIcon,
  SquareIcon,
  SkipBackIcon,
  MoreVerticalIcon,
  ChevronDownIcon,
  CheckIcon,
  ArrowRightFromLineIcon,
  ArrowLeftFromLineIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type WaveSurferType from "wavesurfer.js";
import type RecordPluginType from "wavesurfer.js/dist/plugins/record.js";

import { createClient } from "@/lib/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import {
  attachTaskAudio,
  createAudioUploadUrl,
  createSignedPlaybackUrl,
  deleteTaskAudio,
  updateTaskAudioTitle,
  updateTaskAudioTrim,
} from "@/app/practice/timer/audio-actions";
import {
  effectiveInputDeviceId,
  formatDeviceLabel,
  pickMimeType,
} from "@/lib/practice/capture";
import {
  useAudioInputs,
  useInputDevicePreference,
} from "@/components/practice/use-capture";

const BUCKET = "task-audio";
const MAX_RECORDING_SECONDS = 3600;
const OPUS_BITRATE = 256_000;

type Mode = "record" | "playback";

type State =
  | { kind: "idle" }
  | { kind: "requesting-mic" }
  | { kind: "recording"; elapsed: number }
  | { kind: "preview"; blob: Blob; blobUrl: string; duration: number; mime: string }
  | { kind: "saving" }
  | { kind: "save-error"; message: string; blob: Blob; blobUrl: string; duration: number; mime: string }
  | { kind: "loading-playback" }
  | { kind: "playback"; url: string; duration: number }
  | { kind: "playback-error"; message: string }
  | { kind: "permission-denied" }
  | { kind: "permission-error"; message: string }
  | { kind: "deleting" };

type Props = {
  taskId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialMode: Mode;
  existingAudioPath: string | null;
  existingDurationSeconds: number | null;
  existingTrimStartSeconds: number | null;
  existingTrimEndSeconds: number | null;
  existingAudioTitle: string | null;
  pieceName: string | null;
  sectionLabel: string | null;
  taskText: string | null;
  onAttached?: (
    path: string,
    durationSeconds: number,
    trimStartSeconds: number | null,
    trimEndSeconds: number | null,
    audioTitle: string | null
  ) => void;
  onTrimUpdated?: (
    trimStartSeconds: number | null,
    trimEndSeconds: number | null
  ) => void;
  onTitleUpdated?: (audioTitle: string | null) => void;
  onDeleted?: () => void;
};

export function formatNotesDefault(
  sectionLabel: string | null,
  taskText: string | null
): string {
  const text = taskText?.trim() || "Task Details";
  return sectionLabel ? `${sectionLabel}: ${text}` : text;
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const s = Math.floor(seconds);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

export function TaskAudioDialog({
  taskId,
  open,
  onOpenChange,
  initialMode,
  existingAudioPath,
  existingDurationSeconds,
  existingTrimStartSeconds,
  existingTrimEndSeconds,
  existingAudioTitle,
  pieceName,
  sectionLabel,
  taskText,
  onAttached,
  onTrimUpdated,
  onTitleUpdated,
  onDeleted,
}: Props) {
  const defaultTitle = formatNotesDefault(sectionLabel, taskText);
  const recordContext = [pieceName, sectionLabel].filter(Boolean).join(" — ");
  const recordTitle = recordContext ? `Record: ${recordContext}` : "Record";
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const wavesurferRef = useRef<WaveSurferType | null>(null);
  const recordPluginRef = useRef<RecordPluginType | null>(null);
  const recordedMimeRef = useRef<string>("");
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  const [state, setState] = useState<State>({ kind: "idle" });
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [trimStart, setTrimStart] = useState<number | null>(null);
  const [trimEnd, setTrimEnd] = useState<number | null>(null);
  const [trimBaseline, setTrimBaseline] = useState<{
    start: number | null;
    end: number | null;
  }>({ start: null, end: null });
  const [savingTrim, setSavingTrim] = useState(false);
  const [title, setTitle] = useState<string>("");
  const [titleBaseline, setTitleBaseline] = useState<string>("");
  const titleInputRef = useRef<HTMLInputElement>(null);
  const titleAutoSelectRef = useRef(false);
  const {
    inputs: availableInputs,
    concreteInputs,
    refreshInputs: refreshAvailableInputs,
    probeAndRefreshInputs,
  } = useAudioInputs();
  const { deviceId: selectedDeviceId, chooseDevice: handleSelectDevice } =
    useInputDevicePreference();
  const [monitorStream, setMonitorStream] = useState<MediaStream | null>(null);
  const monitorStreamRef = useRef<MediaStream | null>(null);

  const setMonitorStreamTracked = useCallback((s: MediaStream | null) => {
    monitorStreamRef.current = s;
    setMonitorStream(s);
  }, []);

  const stopMonitorStream = useCallback(() => {
    const s = monitorStreamRef.current;
    if (s) {
      try {
        s.getTracks().forEach((t) => t.stop());
      } catch {}
    }
    monitorStreamRef.current = null;
    setMonitorStream(null);
  }, []);

  // If the saved selection no longer exists, treat it as system default.
  const effectiveDeviceId = useMemo(
    () => effectiveInputDeviceId(selectedDeviceId, availableInputs),
    [selectedDeviceId, availableInputs]
  );

  const displayLabel = useMemo(() => {
    if (!effectiveDeviceId) {
      const def = availableInputs.find((d) => d.deviceId === "default");
      if (def?.label) return formatDeviceLabel(def.label);
      const first = concreteInputs[0];
      if (first?.label) return formatDeviceLabel(first.label);
      return "System default";
    }
    const dev = availableInputs.find((d) => d.deviceId === effectiveDeviceId);
    if (dev?.label) return formatDeviceLabel(dev.label);
    return "Microphone";
  }, [effectiveDeviceId, availableInputs, concreteInputs]);

  const teardownWavesurfer = useCallback(() => {
    try {
      wavesurferRef.current?.destroy();
    } catch {}
    wavesurferRef.current = null;
    recordPluginRef.current = null;
    setPlaying(false);
    setCurrentTime(0);
    stopMonitorStream();
  }, [stopMonitorStream]);

  const stopMicTracks = useCallback(() => {
    const plugin = recordPluginRef.current;
    if (plugin) {
      try {
        if (plugin.isRecording() || plugin.isPaused()) plugin.stopRecording();
      } catch {}
      try {
        plugin.stopMic();
      } catch {}
    }
  }, []);

  const startRecording = useCallback(async () => {
    if (!container) return;
    teardownWavesurfer();
    setState({ kind: "requesting-mic" });

    const { default: WaveSurfer } = await import("wavesurfer.js");
    const { default: RecordPlugin } = await import(
      "wavesurfer.js/dist/plugins/record.js"
    );

    const { mime, ext } = pickMimeType();
    recordedMimeRef.current = mime;

    const ws = WaveSurfer.create({
      container,
      waveColor: "#a1a1aa",
      progressColor: "#ef4444",
      cursorColor: "#ef4444",
      barWidth: 2,
      barGap: 2,
      barRadius: 2,
      height: 96,
      interact: true,
    });
    const plugin = ws.registerPlugin(
      RecordPlugin.create({
        mimeType: mime || undefined,
        audioBitsPerSecond: OPUS_BITRATE,
        renderRecordedAudio: true,
        continuousWaveform: true,
        continuousWaveformDuration: MAX_RECORDING_SECONDS,
      })
    );
    wavesurferRef.current = ws;
    recordPluginRef.current = plugin;

    plugin.on("record-progress", (duration: number) => {
      const elapsed = duration / 1000;
      setState((prev) =>
        prev.kind === "recording" ? { ...prev, elapsed } : prev
      );
      if (elapsed >= MAX_RECORDING_SECONDS) {
        try {
          plugin.stopRecording();
        } catch {}
      }
    });

    plugin.on("record-end", (blob: Blob) => {
      // Use the plugin's measured duration (ms). ws.getDuration() still
      // reports the continuous-waveform window here; the real decoded
      // length only becomes available after renderRecordedAudio's load.
      const duration = plugin.getDuration() / 1000;
      const blobUrl = URL.createObjectURL(blob);
      setTitle(defaultTitle);
      titleAutoSelectRef.current = true;
      setState({ kind: "preview", blob, blobUrl, duration, mime: blob.type || mime });
    });

    // When the recorded blob finishes loading into wavesurfer, refine the
    // duration from the decoded audio — more accurate than the plugin's
    // performance-clock estimate.
    ws.on("ready", (decoded: number) => {
      setState((prev) =>
        prev.kind === "preview" || prev.kind === "save-error"
          ? { ...prev, duration: decoded }
          : prev
      );
    });

    ws.on("play", () => setPlaying(true));
    ws.on("pause", () => setPlaying(false));
    ws.on("finish", () => setPlaying(false));
    ws.on("timeupdate", (t: number) => setCurrentTime(t));

    try {
      const constraints: MediaTrackConstraints = {
        deviceId: effectiveDeviceId
          ? { exact: effectiveDeviceId }
          : { ideal: "default" },
        channelCount: 2,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      };

      // Capture the plugin's MediaStream so we can tap it for a live VU meter.
      const md = navigator.mediaDevices as MediaDevices;
      const originalGum = md.getUserMedia.bind(md);
      let captured: MediaStream | null = null;
      (md as unknown as { getUserMedia: typeof md.getUserMedia }).getUserMedia =
        async (c: MediaStreamConstraints) => {
          const s = await originalGum(c);
          captured = s;
          return s;
        };
      try {
        await plugin.startRecording(constraints);
      } finally {
        (
          md as unknown as { getUserMedia: typeof md.getUserMedia }
        ).getUserMedia = originalGum;
      }
      setMonitorStreamTracked(captured);
      setState({ kind: "recording", elapsed: 0 });
      void refreshAvailableInputs();
    } catch (err) {
      teardownWavesurfer();
      const e = err as { name?: string; message?: string };
      if (e.name === "NotAllowedError" || e.name === "PermissionDeniedError") {
        setState({ kind: "permission-denied" });
      } else {
        setState({
          kind: "permission-error",
          message: e.message ?? "Microphone unavailable",
        });
      }
    }
    // ext available via pickMimeType for upload step
    void ext;
  }, [
    container,
    teardownWavesurfer,
    effectiveDeviceId,
    refreshAvailableInputs,
    setMonitorStreamTracked,
    defaultTitle,
  ]);

  const loadPlayback = useCallback(async (path: string) => {
    if (!container) return;
    teardownWavesurfer();
    setState({ kind: "loading-playback" });
    try {
      const signedUrl = await createSignedPlaybackUrl(path);
      const urlWithBuster = `${signedUrl}${signedUrl.includes("?") ? "&" : "?"}v=${Date.now()}`;

      const { default: WaveSurfer } = await import("wavesurfer.js");
      const ws = WaveSurfer.create({
        container,
        waveColor: "#a1a1aa",
        progressColor: "#ef4444",
        cursorColor: "#ef4444",
        barWidth: 2,
        barGap: 2,
        barRadius: 2,
        height: 96,
        url: urlWithBuster,
        interact: true,
      });
      wavesurferRef.current = ws;

      ws.on("play", () => setPlaying(true));
      ws.on("pause", () => setPlaying(false));
      ws.on("finish", () => setPlaying(false));
      ws.on("timeupdate", (t: number) => setCurrentTime(t));
      ws.on("ready", (d: number) => {
        setState({ kind: "playback", url: urlWithBuster, duration: d });
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Could not load recording";
      setState({ kind: "playback-error", message });
    }
  }, [container, teardownWavesurfer]);

  // Start/stop when the modal opens or the container mounts.
  useEffect(() => {
    if (!open) {
      stopMicTracks();
      teardownWavesurfer();
      if (state.kind === "preview" || state.kind === "save-error") {
        URL.revokeObjectURL(state.blobUrl);
      }
      setState({ kind: "idle" });
      setTrimStart(null);
      setTrimEnd(null);
      setTrimBaseline({ start: null, end: null });
      setTitle("");
      setTitleBaseline("");
      titleAutoSelectRef.current = false;
      return;
    }
    if (!container) return;
    if (state.kind !== "idle") return;
    if (initialMode === "playback" && existingAudioPath) {
      setTrimStart(existingTrimStartSeconds);
      setTrimEnd(existingTrimEndSeconds);
      setTrimBaseline({
        start: existingTrimStartSeconds,
        end: existingTrimEndSeconds,
      });
      const seeded = existingAudioTitle ?? defaultTitle;
      setTitle(seeded);
      setTitleBaseline(existingAudioTitle ?? "");
      void loadPlayback(existingAudioPath);
    } else if (initialMode === "record") {
      void probeAndRefreshInputs();
    }
    // Record mode: stay idle until the user clicks the Record button.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, container]);

  // Keep the available input list fresh while the dialog is open.
  useEffect(() => {
    if (!open) return;
    if (typeof navigator === "undefined" || !navigator.mediaDevices) return;
    const handler = () => void refreshAvailableInputs();
    navigator.mediaDevices.addEventListener?.("devicechange", handler);
    return () => {
      navigator.mediaDevices.removeEventListener?.("devicechange", handler);
    };
  }, [open, refreshAvailableInputs]);

  // Pre-record VU monitoring. Only runs when the user has picked a concrete
  // device — "System default" is skipped because asking for the pseudo
  // "default" id can route Chrome to an unintended input (e.g. Continuity
  // Camera mic). Waits until the device list has been enumerated so a saved
  // selection from localStorage is recognized before we decide to fall back.
  useEffect(() => {
    if (!open) return;
    if (initialMode !== "record") return;
    if (state.kind !== "idle") return;
    if (!effectiveDeviceId) return;
    if (typeof navigator === "undefined" || !navigator.mediaDevices) return;

    let cancelled = false;
    let acquired: MediaStream | null = null;

    void (async () => {
      try {
        const s = await navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId: { exact: effectiveDeviceId },
            channelCount: 2,
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          },
        });
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        acquired = s;
        setMonitorStreamTracked(s);
      } catch {
        // Silent — the Record button will surface any permission error.
      }
    })();

    return () => {
      cancelled = true;
      if (acquired) {
        acquired.getTracks().forEach((t) => t.stop());
      }
      if (monitorStreamRef.current === acquired) {
        setMonitorStreamTracked(null);
      }
    };
  }, [
    open,
    initialMode,
    state.kind,
    effectiveDeviceId,
    setMonitorStreamTracked,
  ]);

  // After transitioning into preview from a fresh recording, focus the title
  // input and select its text so the user can immediately type a new name.
  useEffect(() => {
    if (state.kind !== "preview") return;
    if (!titleAutoSelectRef.current) return;
    titleAutoSelectRef.current = false;
    const el = titleInputRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      el.focus();
      el.select();
    });
  }, [state.kind]);

  const titleDirty = state.kind === "playback" && title.trim() !== titleBaseline;

  const saveTitle = useCallback(async () => {
    if (state.kind !== "playback") return;
    const trimmed = title.trim();
    const next = trimmed ? trimmed : null;
    try {
      await updateTaskAudioTitle(taskId, next);
      setTitleBaseline(trimmed);
      onTitleUpdated?.(next);
    } catch {
      // Leave local state; user can retry by editing again.
    }
  }, [onTitleUpdated, state.kind, taskId, title]);

  const stopRecording = useCallback(() => {
    const plugin = recordPluginRef.current;
    if (!plugin) return;
    try {
      plugin.stopRecording();
    } catch {}
  }, []);

  const togglePlay = useCallback(() => {
    const ws = wavesurferRef.current;
    if (!ws) return;
    if (ws.isPlaying()) {
      ws.pause();
      return;
    }
    const total = ws.getDuration();
    const effStart = trimStart ?? 0;
    const effEnd = trimEnd ?? total;
    const hasTrim = trimStart != null || trimEnd != null;
    const now = ws.getCurrentTime();
    if (now < effStart - 0.001 || now >= effEnd - 0.001) {
      try {
        ws.setTime(effStart);
      } catch {}
    }
    if (hasTrim) {
      void ws.play(effStart, effEnd);
    } else {
      void ws.play();
    }
  }, [trimStart, trimEnd]);

  const stopTransport = useCallback(() => {
    wavesurferRef.current?.pause();
  }, []);

  const skipToStart = useCallback(() => {
    wavesurferRef.current?.setTime(trimStart ?? 0);
  }, [trimStart]);

  // Space-bar toggles play/pause when there's an audio to play.
  useEffect(() => {
    if (!open) return;
    const canToggle =
      state.kind === "playback" ||
      state.kind === "preview" ||
      state.kind === "save-error";
    if (!canToggle) return;
    const handler = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (
          tag === "INPUT" ||
          tag === "TEXTAREA" ||
          tag === "SELECT" ||
          target.isContentEditable
        ) {
          return;
        }
      }
      e.preventDefault();
      togglePlay();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, state.kind, togglePlay]);

  const discardPreview = useCallback(() => {
    setState((prev) => {
      if (prev.kind === "preview" || prev.kind === "save-error") {
        URL.revokeObjectURL(prev.blobUrl);
      }
      return prev;
    });
    stopMicTracks();
    teardownWavesurfer();
    void startRecording();
  }, [startRecording, stopMicTracks, teardownWavesurfer]);

  const savePreview = useCallback(async () => {
    if (state.kind !== "preview" && state.kind !== "save-error") return;
    const { blob, duration, mime } = state;
    const trimStartToSave = trimStart;
    const trimEndToSave = trimEnd;
    const trimmedTitle = title.trim();
    const titleToSave = trimmedTitle ? trimmedTitle : null;
    setState({ kind: "saving" });
    try {
      const ext: "webm" | "m4a" = mime.startsWith("audio/mp4") ? "m4a" : "webm";
      const { path, token } = await createAudioUploadUrl(taskId, ext);
      const supabase = createClient();
      const { error } = await supabase.storage
        .from(BUCKET)
        .uploadToSignedUrl(path, token, blob, {
          upsert: true,
          contentType: mime || undefined,
        });
      if (error) throw error;
      await attachTaskAudio(
        taskId,
        path,
        duration,
        trimStartToSave,
        trimEndToSave,
        titleToSave
      );
      onAttached?.(
        path,
        Math.max(0, Math.round(duration)),
        trimStartToSave,
        trimEndToSave,
        titleToSave
      );
      onOpenChange(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Upload failed";
      setState({ ...state, kind: "save-error", message });
    }
  }, [onAttached, onOpenChange, state, taskId, trimStart, trimEnd, title]);

  const reRecordFromPlayback = useCallback(() => {
    teardownWavesurfer();
    void startRecording();
  }, [startRecording, teardownWavesurfer]);

  const applyTrim = useCallback(
    (mode: "head" | "tail") => {
      const ws = wavesurferRef.current;
      if (!ws) return;
      const playhead = ws.getCurrentTime();
      const totalDuration = ws.getDuration();
      if (!Number.isFinite(totalDuration) || totalDuration <= 0) return;

      const currentStart = trimStart ?? 0;
      const currentEnd = trimEnd ?? totalDuration;

      if (mode === "head") {
        const next = Math.max(0, Math.min(playhead, currentEnd - 0.05));
        if (next >= currentEnd) return;
        setTrimStart(next <= 0.001 ? null : next);
      } else {
        const next = Math.min(
          totalDuration,
          Math.max(playhead, currentStart + 0.05)
        );
        if (next <= currentStart) return;
        setTrimEnd(next >= totalDuration - 0.001 ? null : next);
      }
      try {
        ws.pause();
      } catch {}
    },
    [trimStart, trimEnd]
  );

  const resetTrim = useCallback(() => {
    setTrimStart(null);
    setTrimEnd(null);
  }, []);

  const trimDirty =
    (trimStart ?? null) !== (trimBaseline.start ?? null) ||
    (trimEnd ?? null) !== (trimBaseline.end ?? null);

  const saveTrim = useCallback(async () => {
    if (state.kind !== "playback") return;
    setSavingTrim(true);
    try {
      await updateTaskAudioTrim(taskId, trimStart, trimEnd);
      setTrimBaseline({ start: trimStart, end: trimEnd });
      onTrimUpdated?.(trimStart, trimEnd);
    } catch {
      // Leave local state; user can retry.
    } finally {
      setSavingTrim(false);
    }
  }, [onTrimUpdated, state.kind, taskId, trimStart, trimEnd]);

  const deleteRecording = useCallback(async () => {
    if (!existingAudioPath) return;
    setState({ kind: "deleting" });
    try {
      await deleteTaskAudio(taskId);
      onDeleted?.();
      onOpenChange(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Delete failed";
      setState({ kind: "playback-error", message });
    }
  }, [existingAudioPath, onDeleted, onOpenChange, taskId]);

  const totalDuration = (() => {
    if (state.kind === "preview" || state.kind === "save-error") return state.duration;
    if (state.kind === "playback") return state.duration;
    if (state.kind === "recording") return state.elapsed;
    if (existingDurationSeconds && initialMode === "playback")
      return existingDurationSeconds;
    return 0;
  })();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          {state.kind === "preview" ||
          state.kind === "save-error" ||
          state.kind === "playback" ? (
            <>
              <DialogTitle className="sr-only">
                {title || defaultTitle}
              </DialogTitle>
              <input
                ref={titleInputRef}
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={() => {
                  if (titleDirty) void saveTitle();
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    e.currentTarget.blur();
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    e.stopPropagation();
                    if (state.kind === "playback") {
                      setTitle(titleBaseline || defaultTitle);
                    }
                    e.currentTarget.blur();
                  }
                }}
                placeholder={defaultTitle}
                aria-label="Notes"
                className="-my-0.5 -ml-1 w-[calc(100%-4rem)] rounded-sm bg-transparent px-1 py-0.5 text-base font-medium leading-none tracking-tight outline-none focus:bg-muted/60"
              />
            </>
          ) : (
            <DialogTitle>{recordTitle}</DialogTitle>
          )}
        </DialogHeader>

        {state.kind === "playback" && (
          <>
            <Button
              ref={menuButtonRef}
              type="button"
              variant="ghost"
              size="icon-sm"
              className="absolute top-2 right-10"
              onClick={() => setMenuOpen((o) => !o)}
              aria-label="Recording options"
            >
              <MoreVerticalIcon />
            </Button>
            <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
              <DropdownMenuContent
                anchor={menuButtonRef}
                align="end"
                side="bottom"
                className="w-40"
              >
                <DropdownMenuItem onClick={reRecordFromPlayback}>
                  <MicIcon />
                  Re-record
                </DropdownMenuItem>
                <DropdownMenuItem
                  variant="destructive"
                  onClick={deleteRecording}
                >
                  <Trash2Icon />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}

        <div className="flex flex-col gap-3">
          <div className="relative overflow-hidden rounded-md bg-muted/40">
            <div
              ref={setContainer}
              className="min-h-[96px]"
              style={trimViewStyle(totalDuration, trimStart, trimEnd)}
            />
          </div>

          <div className="flex items-center justify-between text-xs tabular-nums text-muted-foreground">
            <span>
              {state.kind === "recording"
                ? formatTime(state.elapsed)
                : formatTime(currentTime)}{" "}
              / {formatTime(totalDuration)}
            </span>
            {state.kind === "recording" && (
              <span className="flex items-center gap-1 text-red-500">
                <span className="inline-block size-2 rounded-full bg-red-500 animate-pulse" />
                Recording
                {state.elapsed >= MAX_RECORDING_SECONDS - 10 && (
                  <span className="ml-1">
                    (max {formatTime(MAX_RECORDING_SECONDS)})
                  </span>
                )}
              </span>
            )}
          </div>

          {state.kind === "requesting-mic" && (
            <StatusRow
              icon={<Loader2Icon className="size-4 animate-spin" />}
              text="Requesting microphone…"
            />
          )}
          {state.kind === "loading-playback" && (
            <StatusRow
              icon={<Loader2Icon className="size-4 animate-spin" />}
              text="Loading recording…"
            />
          )}
          {state.kind === "saving" && (
            <StatusRow
              icon={<Loader2Icon className="size-4 animate-spin" />}
              text="Uploading…"
            />
          )}
          {state.kind === "deleting" && (
            <StatusRow
              icon={<Loader2Icon className="size-4 animate-spin" />}
              text="Deleting…"
            />
          )}
          {state.kind === "permission-denied" && (
            <StatusRow
              icon={<AlertCircleIcon className="size-4 text-red-500" />}
              text="Microphone access was blocked. Enable it in your browser's site settings, then try again."
            />
          )}
          {state.kind === "permission-error" && (
            <StatusRow
              icon={<AlertCircleIcon className="size-4 text-red-500" />}
              text={`Couldn't access microphone: ${state.message}`}
            />
          )}
          {state.kind === "save-error" && (
            <StatusRow
              icon={<AlertCircleIcon className="size-4 text-red-500" />}
              text={`Upload failed: ${state.message}`}
            />
          )}
          {state.kind === "playback-error" && (
            <StatusRow
              icon={<AlertCircleIcon className="size-4 text-red-500" />}
              text={state.message}
            />
          )}
        </div>

        <DialogFooter>
          {(state.kind === "idle" ||
            state.kind === "requesting-mic" ||
            state.kind === "recording" ||
            state.kind === "permission-denied" ||
            state.kind === "permission-error") &&
            initialMode === "record" && (
              <InputMonitor
                label={displayLabel}
                concreteInputs={concreteInputs}
                selectedDeviceId={selectedDeviceId}
                onSelect={handleSelectDevice}
                stream={
                  state.kind === "idle" || state.kind === "recording"
                    ? monitorStream
                    : null
                }
                disabled={
                  state.kind === "recording" || state.kind === "requesting-mic"
                }
              />
            )}

          {state.kind === "recording" && (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={stopRecording}>Stop</Button>
            </>
          )}

          {state.kind === "preview" && (
            <>
              <TransportControls
                playing={playing}
                onSkipToStart={skipToStart}
                onTogglePlay={togglePlay}
                onStop={stopTransport}
              >
                <TrimControls
                  disabled={false}
                  onTrimHead={() => applyTrim("head")}
                  onTrimTail={() => applyTrim("tail")}
                />
              </TransportControls>
              <Button variant="outline" onClick={discardPreview}>
                <MicIcon />
                Re-record
              </Button>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={savePreview}>Save</Button>
            </>
          )}

          {state.kind === "save-error" && (
            <>
              <TransportControls
                playing={playing}
                onSkipToStart={skipToStart}
                onTogglePlay={togglePlay}
                onStop={stopTransport}
              >
                <TrimControls
                  disabled={false}
                  onTrimHead={() => applyTrim("head")}
                  onTrimTail={() => applyTrim("tail")}
                />
              </TransportControls>
              <Button variant="outline" onClick={discardPreview}>
                <MicIcon />
                Re-record
              </Button>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={savePreview}>Retry save</Button>
            </>
          )}

          {state.kind === "playback" && (
            <>
              <TransportControls
                playing={playing}
                onSkipToStart={skipToStart}
                onTogglePlay={togglePlay}
                onStop={stopTransport}
              >
                <TrimControls
                  disabled={savingTrim}
                  onTrimHead={() => applyTrim("head")}
                  onTrimTail={() => applyTrim("tail")}
                />
              </TransportControls>
              <div className="flex-1" />
              {trimDirty && !savingTrim && (
                <Button variant="ghost" onClick={resetTrim}>
                  Reset trim
                </Button>
              )}
              {trimDirty && (
                <Button onClick={() => void saveTrim()} disabled={savingTrim}>
                  {savingTrim ? (
                    <>
                      <Loader2Icon className="animate-spin" />
                      Saving
                    </>
                  ) : (
                    "Save trim"
                  )}
                </Button>
              )}
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Close
              </Button>
            </>
          )}

          {(state.kind === "permission-denied" ||
            state.kind === "permission-error") && (
            <>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Close
              </Button>
              <Button onClick={() => void startRecording()}>Try again</Button>
            </>
          )}

          {state.kind === "idle" && initialMode === "record" && (
            <>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={() => void startRecording()}>
                <MicIcon />
                Record
              </Button>
            </>
          )}

          {((state.kind === "idle" && initialMode !== "record") ||
            state.kind === "requesting-mic" ||
            state.kind === "saving" ||
            state.kind === "deleting" ||
            state.kind === "loading-playback" ||
            state.kind === "playback-error") && (
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StatusRow({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      {icon}
      <span>{text}</span>
    </div>
  );
}

function InputMonitor({
  label,
  concreteInputs,
  selectedDeviceId,
  onSelect,
  stream,
  disabled,
}: {
  label: string;
  concreteInputs: MediaDeviceInfo[];
  selectedDeviceId: string | null;
  onSelect: (id: string | null) => void;
  stream: MediaStream | null;
  disabled?: boolean;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <div className="mr-auto flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        className={cn(
          "inline-flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-xs text-muted-foreground",
          "hover:bg-muted/60 disabled:opacity-60 disabled:pointer-events-none"
        )}
        aria-label="Select audio input"
      >
        <MicIcon className="size-3.5 shrink-0" />
        <span className="truncate max-w-[180px]" title={label}>
          {label}
        </span>
        <ChevronDownIcon className="size-3.5 shrink-0 opacity-60" />
      </button>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuContent
          anchor={triggerRef}
          align="start"
          side="top"
          className="w-64"
        >
          <DropdownMenuItem onClick={() => onSelect(null)}>
            <span className="flex w-4 shrink-0 items-center justify-center">
              {selectedDeviceId === null ? (
                <CheckIcon className="size-3.5" />
              ) : null}
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="truncate">System default</span>
              <span className="truncate text-[11px] text-muted-foreground">
                Browser default — may differ from your OS input. Pick a device
                below to be sure.
              </span>
            </span>
          </DropdownMenuItem>
          {concreteInputs.map((d) => {
            const name = formatDeviceLabel(d.label) || "Microphone";
            return (
              <DropdownMenuItem
                key={d.deviceId}
                onClick={() => onSelect(d.deviceId)}
              >
                <span className="flex w-4 shrink-0 items-center justify-center">
                  {selectedDeviceId === d.deviceId ? (
                    <CheckIcon className="size-3.5" />
                  ) : null}
                </span>
                <span className="truncate">{name}</span>
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
      <VuMeter stream={stream} />
    </div>
  );
}

function VuMeter({ stream }: { stream: MediaStream | null }) {
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const lEl = leftRef.current;
    const rEl = rightRef.current;
    if (!stream || !lEl || !rEl) {
      if (lEl) lEl.style.width = "0%";
      if (rEl) rEl.style.width = "0%";
      return;
    }
    const AudioCtx: typeof AudioContext =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    if (ctx.state === "suspended") void ctx.resume();
    const source = ctx.createMediaStreamSource(stream);
    const track = stream.getAudioTracks()[0];
    const channels = track?.getSettings().channelCount ?? 2;
    const splitter = ctx.createChannelSplitter(Math.max(2, channels));
    source.connect(splitter);
    const analyserL = ctx.createAnalyser();
    const analyserR = ctx.createAnalyser();
    analyserL.fftSize = 1024;
    analyserR.fftSize = 1024;
    splitter.connect(analyserL, 0);
    splitter.connect(analyserR, channels >= 2 ? 1 : 0);

    const dataL = new Float32Array(analyserL.fftSize);
    const dataR = new Float32Array(analyserR.fftSize);
    let peakL = 0;
    let peakR = 0;
    const decay = 0.85;
    let raf = 0;

    const tick = () => {
      analyserL.getFloatTimeDomainData(dataL);
      analyserR.getFloatTimeDomainData(dataR);
      let curL = 0;
      let curR = 0;
      for (let i = 0; i < dataL.length; i++) {
        const v = Math.abs(dataL[i]);
        if (v > curL) curL = v;
      }
      for (let i = 0; i < dataR.length; i++) {
        const v = Math.abs(dataR[i]);
        if (v > curR) curR = v;
      }
      peakL = Math.max(curL, peakL * decay);
      peakR = Math.max(curR, peakR * decay);
      lEl.style.width = `${Math.min(100, peakL * 100)}%`;
      rEl.style.width = `${Math.min(100, peakR * 100)}%`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      try {
        source.disconnect();
      } catch {}
      try {
        splitter.disconnect();
      } catch {}
      try {
        analyserL.disconnect();
      } catch {}
      try {
        analyserR.disconnect();
      } catch {}
      void ctx.close();
      if (lEl) lEl.style.width = "0%";
      if (rEl) rEl.style.width = "0%";
    };
  }, [stream]);

  return (
    <div className="flex w-24 shrink-0 flex-col gap-0.5">
      <div className="relative h-1.5 overflow-hidden rounded-sm bg-muted">
        <div
          ref={leftRef}
          className="absolute inset-y-0 left-0 w-0 bg-emerald-500"
        />
      </div>
      <div className="relative h-1.5 overflow-hidden rounded-sm bg-muted">
        <div
          ref={rightRef}
          className="absolute inset-y-0 left-0 w-0 bg-emerald-500"
        />
      </div>
    </div>
  );
}

function TransportControls({
  playing,
  onSkipToStart,
  onTogglePlay,
  onStop,
  children,
}: {
  playing: boolean;
  onSkipToStart: () => void;
  onTogglePlay: () => void;
  onStop: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="mr-auto flex items-center gap-1">
      <Button
        variant="outline"
        size="icon-sm"
        onClick={onSkipToStart}
        aria-label="Jump to start"
        title="Jump to start"
      >
        <SkipBackIcon />
      </Button>
      <Button
        variant="outline"
        size="icon-sm"
        onClick={onTogglePlay}
        aria-label={playing ? "Pause" : "Play"}
        title={playing ? "Pause" : "Play"}
      >
        {playing ? <PauseIcon /> : <PlayIcon />}
      </Button>
      <Button
        variant="outline"
        size="icon-sm"
        onClick={onStop}
        aria-label="Stop"
        title="Stop"
      >
        <SquareIcon fill="currentColor" />
      </Button>
      {children}
    </div>
  );
}

// Scale + translate the wavesurfer container so that only the kept region
// [trimStart, trimEnd] is visible. Width goes to scale*100% and we shift
// the inner left by (trimStart/duration)%. Because wavesurfer lays out the
// full audio across the inner element, click-to-seek positions still map
// back to correct times.
export function trimViewStyle(
  duration: number,
  trimStart: number | null,
  trimEnd: number | null
): React.CSSProperties | undefined {
  if (!Number.isFinite(duration) || duration <= 0) return undefined;
  if (trimStart == null && trimEnd == null) return undefined;
  const effStart = Math.max(0, trimStart ?? 0);
  const effEnd = Math.min(duration, trimEnd ?? duration);
  const kept = effEnd - effStart;
  if (!(kept > 0)) return undefined;
  const scale = duration / kept;
  const offsetPct = (effStart / duration) * 100;
  return {
    width: `${scale * 100}%`,
    transform: `translateX(-${offsetPct}%)`,
  };
}

function TrimControls({
  disabled,
  onTrimHead,
  onTrimTail,
}: {
  disabled: boolean;
  onTrimHead: () => void;
  onTrimTail: () => void;
}) {
  return (
    <>
      <div className="mx-1 h-4 w-px bg-border" aria-hidden />
      <Button
        variant="outline"
        size="icon-sm"
        onClick={onTrimHead}
        disabled={disabled}
        aria-label="Trim before playhead"
        title="Trim before playhead"
      >
        <ArrowRightFromLineIcon />
      </Button>
      <Button
        variant="outline"
        size="icon-sm"
        onClick={onTrimTail}
        disabled={disabled}
        aria-label="Trim after playhead"
        title="Trim after playhead"
      >
        <ArrowLeftFromLineIcon />
      </Button>
    </>
  );
}
