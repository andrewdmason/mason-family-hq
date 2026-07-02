// Shared capture helpers for the practice recorders (the Listen session
// recorder, the task-audio dialog, and the upcoming timer capture controller).
// Pure functions plus the localStorage-backed capture preferences both
// existing recorders already share.

// Shared between recorders so the chosen mic carries over. Picking an explicit
// input avoids macOS Continuity hijacking the mic to a nearby iPhone.
export const INPUT_DEVICE_STORAGE_KEY = "task-audio-input-device-id";

// Per-device auto-record toggle for timed task-runs (default off). Lives
// beside the mic preference so capture settings stay together.
export const AUTO_RECORD_STORAGE_KEY = "practice-auto-record";

// Prefer MP4/AAC so the download opens natively in QuickTime/iTunes/Finder.
// Safari supports mp4 out of the box; Chrome 110+ and Edge support it in
// MediaRecorder. Firefox falls back to webm/opus.
export function pickMimeType(): { mime: string; ext: "webm" | "m4a" } {
  if (typeof MediaRecorder === "undefined") {
    return { mime: "audio/mp4;codecs=mp4a.40.2", ext: "m4a" };
  }
  const candidates: Array<{ mime: string; ext: "webm" | "m4a" }> = [
    { mime: "audio/mp4;codecs=mp4a.40.2", ext: "m4a" },
    { mime: "audio/mp4", ext: "m4a" },
    { mime: "audio/webm;codecs=opus", ext: "webm" },
    { mime: "audio/webm", ext: "webm" },
  ];
  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported(c.mime)) return c;
  }
  return { mime: "", ext: "webm" };
}

// The task-audio bucket only allows audio/mp4|webm|mpeg|ogg. Files can report
// other types (e.g. audio/x-m4a), so map to a supported label — the worker
// decodes by content (ffmpeg), so the label only needs to pass the bucket.
export function supportedContentType(type: string | undefined, ext: string): string {
  const allowed = ["audio/webm", "audio/mp4", "audio/mpeg", "audio/ogg"];
  if (type && allowed.some((a) => type.startsWith(a))) return type;
  const e = ext.toLowerCase();
  if (e === "webm") return "audio/webm";
  if (e === "mp3") return "audio/mpeg";
  if (e === "ogg" || e === "oga") return "audio/ogg";
  return "audio/mp4"; // m4a / aac / wav / etc. — decoded by content regardless
}

// "Default - Built-in Mic" / "Default: Built-in Mic" → "Built-in Mic";
// strips a trailing parenthetical (e.g. "(14ed:1019)").
export function formatDeviceLabel(raw: string): string {
  if (!raw) return "Microphone";
  let out = raw.replace(/^Default\s*[-:—]\s*/i, "");
  out = out.replace(/\s*\(([^()]*)\)\s*$/, "").trim();
  return out || raw;
}

// Concrete inputs for a device picker — exclude the pseudo
// "default"/"communications" entries.
export function concreteAudioInputs(inputs: MediaDeviceInfo[]): MediaDeviceInfo[] {
  return inputs.filter(
    (d) => d.deviceId !== "default" && d.deviceId !== "communications"
  );
}

// If the saved selection no longer exists in `inputs`, treat it as system default.
export function effectiveInputDeviceId(
  deviceId: string | null,
  inputs: MediaDeviceInfo[]
): string | null {
  if (!deviceId) return null;
  return inputs.some((d) => d.deviceId === deviceId) ? deviceId : null;
}

// The device we'll actually record from. An explicit pick wins; otherwise pick
// a concrete NON-iPhone input (built-in preferred) so we never fall through to
// "default", which is what macOS Continuity hijacks to a nearby iPhone.
export function resolveRecordingDeviceId(
  effectiveDeviceId: string | null,
  concreteInputs: MediaDeviceInfo[]
): string | null {
  if (effectiveDeviceId) return effectiveDeviceId;
  const notPhone = concreteInputs.filter(
    (d) => !/iphone|ipad|continuity/i.test(d.label)
  );
  const builtin = notPhone.find((d) => /built.?in|macbook/i.test(d.label));
  return (builtin ?? notPhone[0])?.deviceId ?? null;
}

// --- localStorage preferences (SSR-guarded, best-effort) ---

export function getStoredInputDeviceId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(INPUT_DEVICE_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setStoredInputDeviceId(id: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (id) localStorage.setItem(INPUT_DEVICE_STORAGE_KEY, id);
    else localStorage.removeItem(INPUT_DEVICE_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function getAutoRecordEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(AUTO_RECORD_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function setAutoRecordEnabled(on: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (on) localStorage.setItem(AUTO_RECORD_STORAGE_KEY, "1");
    else localStorage.removeItem(AUTO_RECORD_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
