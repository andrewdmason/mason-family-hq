/**
 * How this device plays a book aloud.
 *
 * Per-device and never synced, exactly like the reader's layout settings: the
 * speed you want in the car is not the speed you want at the sink, and the two
 * devices have no business agreeing. Listening POSITION is the opposite — it's
 * the same character offset as your reading position, stored on the server, so
 * it follows you everywhere.
 */

export type ListenSettings = {
  /** Playback rate. 1 is the narrator's own pace. */
  rate: number;
};

/**
 * The rates worth offering. Below 0.8 the voice sounds drugged and above 2 it
 * stops being listening and starts being skimming; the steps in between are
 * close enough that you can find your pace without a slider.
 */
export const RATES = [0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2] as const;

export const DEFAULT_LISTEN_SETTINGS: ListenSettings = { rate: 1 };

const STORAGE_KEY = "reader:listen";

export function loadListenSettings(): ListenSettings {
  if (typeof window === "undefined") return DEFAULT_LISTEN_SETTINGS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_LISTEN_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<ListenSettings>;
    const rate = RATES.includes(parsed.rate as (typeof RATES)[number])
      ? (parsed.rate as number)
      : DEFAULT_LISTEN_SETTINGS.rate;
    return { rate };
  } catch {
    return DEFAULT_LISTEN_SETTINGS;
  }
}

export function saveListenSettings(settings: ListenSettings): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Private browsing or quota. The setting doesn't persist; playback is fine.
  }
}

/** Sleep timer options, in minutes. `chapter` stops at the end of the chapter. */
export type SleepMode = null | "chapter" | 15 | 30 | 45 | 60;

export const SLEEP_OPTIONS: { value: SleepMode; label: string }[] = [
  { value: null, label: "Off" },
  { value: 15, label: "15 minutes" },
  { value: 30, label: "30 minutes" },
  { value: 45, label: "45 minutes" },
  { value: 60, label: "1 hour" },
  { value: "chapter", label: "End of chapter" },
];

/** How far back-30 actually goes. The one button everyone uses. */
export const SKIP_BACK_MS = 30_000;
