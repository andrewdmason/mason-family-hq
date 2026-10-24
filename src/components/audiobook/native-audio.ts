/**
 * The read-aloud's audio element, inside the Reader iOS app: the same surface
 * the audiobook provider uses on an HTMLAudioElement, played by the app's own
 * player instead (ios/Reader/App/AudioPlayer.swift). That player keeps going
 * with the phone locked or in another app, shows on the Lock Screen and
 * answers AirPods, and keeps chapters on the device for offline listening.
 *
 * Commands go to the app's "readerAudio" handler; the app reports back by
 * calling window.__readerAudio with the player's state, which this turns into
 * the element events the provider listens for.
 */

type Command =
  | { cmd: "src"; url: string | null }
  | { cmd: "play" }
  | { cmd: "pause" }
  | { cmd: "seek"; time: number }
  | { cmd: "rate"; rate: number };

type Report = {
  event: "timeupdate" | "play" | "pause" | "ended" | "durationchange" | "error";
  currentTime: number;
  duration: number;
  paused: boolean;
  bufferedEnd: number;
  /** The chapter the app is on; it moves to the next one on its own while the
   * page can't (the screen locked), and the page catches up from this. */
  url: string | null;
};

type NativeWindow = Window & {
  __readerAudio?: (report: Report) => void;
  webkit?: { messageHandlers?: Record<string, { postMessage(body: unknown): void }> };
};

export function nativeAudioAvailable(): boolean {
  return (
    typeof window !== "undefined" &&
    !!(window as NativeWindow).webkit?.messageHandlers?.readerAudio
  );
}

export class NativeAudio extends EventTarget {
  preload = "auto";
  private _src = "";
  private _currentTime = 0;
  private _duration = NaN;
  private _paused = true;
  private _rate = 1;
  private _bufferedEnd = 0;

  constructor() {
    super();
    (window as NativeWindow).__readerAudio = (report) => this.receive(report);
  }

  private send(command: Command) {
    (window as NativeWindow).webkit?.messageHandlers?.readerAudio?.postMessage(command);
  }

  /** Set when an "ended" arrives from a player that has already moved on. */
  adoptedIndex: number | null = null;

  private receive(report: Report) {
    if (report.event === "ended" && report.url && report.url !== this.absoluteSrc()) {
      const match = report.url.match(/\/reader\/api\/audio\/[^/]+\/(\d+)$/);
      this.adoptedIndex = match ? Number(match[1]) : null;
    }
    this._currentTime = report.currentTime;
    if (Number.isFinite(report.duration) && report.duration > 0) this._duration = report.duration;
    this._paused = report.paused;
    this._bufferedEnd = report.bufferedEnd;
    this.dispatchEvent(new Event(report.event));
  }

  private absoluteSrc(): string | null {
    return this._src ? new URL(this._src, location.href).href : null;
  }

  get src() {
    return this._src;
  }
  set src(value: string) {
    this._src = value;
    this.adoptedIndex = null;
    this._duration = NaN;
    this._currentTime = 0;
    // The unlock tap's silent clip: the app needs no unlocking.
    if (value.startsWith("data:")) return;
    this.send({ cmd: "src", url: value ? new URL(value, location.href).href : null });
  }

  get currentTime() {
    return this._currentTime;
  }
  set currentTime(value: number) {
    this._currentTime = value;
    this.send({ cmd: "seek", time: value });
  }

  get playbackRate() {
    return this._rate;
  }
  set playbackRate(value: number) {
    this._rate = value;
    this.send({ cmd: "rate", rate: value });
  }

  get duration() {
    return this._duration;
  }
  get paused() {
    return this._paused;
  }
  get buffered() {
    const end = this._bufferedEnd;
    return {
      length: end > 0 ? 1 : 0,
      start: () => 0,
      end: () => end,
    };
  }

  play(): Promise<void> {
    if (this._src.startsWith("data:")) return Promise.resolve();
    this._paused = false;
    this.send({ cmd: "play" });
    return Promise.resolve();
  }

  pause() {
    this._paused = true;
    this.send({ cmd: "pause" });
  }

  load() {}

  setAttribute() {}

  removeAttribute(name: string) {
    if (name === "src") this.src = "";
  }
}

/**
 * The chapter the app's player is already playing when the page hears that the
 * previous one ended (it carried on with the screen locked), so the page
 * follows it there rather than going back. Nil on a plain audio element.
 */
export function adoptedChapter(element: HTMLAudioElement): number | null {
  return element instanceof NativeAudio ? element.adoptedIndex : null;
}
