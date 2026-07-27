/**
 * On-device timing for the reader.
 *
 * The reader's slow paths are all main-thread layout work on a 1.1M-character
 * book, and the only machine that matters is the one it feels slow on — an iPad,
 * running the production build, with no cable attached. Two rounds of reading the
 * code and reasoning about which pass was expensive produced fixes that turned
 * out to address the wrong trigger, so the rule now is that a performance change
 * ships with a before and after number from the actual device.
 *
 * Off unless someone asks for it: `localStorage.setItem("reader:perf", "1")` and
 * reload. When it's off, `time()` calls straight through and nothing is
 * allocated, so the instrumentation can live permanently in the hot paths.
 *
 * Deliberately not a "use client" module, even though only the browser ever
 * turns it on: some of what it wraps lives in libraries that server actions also
 * import, and a client boundary there would hand the server a reference proxy
 * instead of a function. On the server there's no window, so it's inert.
 */

const FLAG = "reader:perf";
const MAX_ENTRIES = 60;

export type PerfEntry = {
  label: string;
  /** Duration in ms. Zero for a point-in-time note. */
  ms: number;
  /** Free-text context — cache hit vs network, element counts, geometry. */
  detail?: string;
  /** ms since page load, so entries can be correlated with a profile. */
  at: number;
};

let enabled: boolean | null = null;
let version = 0;
const entries: PerfEntry[] = [];
const listeners = new Set<() => void>();

export function perfOn(): boolean {
  if (enabled === null) {
    try {
      enabled = typeof window !== "undefined" && window.localStorage.getItem(FLAG) === "1";
    } catch {
      // Private mode, or storage disabled. Never let telemetry break the reader.
      enabled = false;
    }
  }
  return enabled;
}

function record(label: string, ms: number, detail?: string) {
  entries.push({ label, ms, detail, at: Math.round(performance.now()) });
  if (entries.length > MAX_ENTRIES) entries.shift();
  version += 1;
  // Also to the console, because that's what survives being read back off a
  // tethered iPad, and it's where a long session's full history lives.
  console.log(`[reader:perf] ${label} ${ms.toFixed(1)}ms${detail ? ` (${detail})` : ""}`);
  scheduleNotify();
}

/**
 * Tell the overlay, but never during a render.
 *
 * Some of what's timed here — mapping the block stream — runs inside a `useMemo`
 * during the reader's own render, and notifying synchronously from there is a
 * setState in the middle of rendering a different component. React says so out
 * loud. Deferring also coalesces a burst of entries into one repaint.
 */
let notifyQueued = false;
function scheduleNotify() {
  if (notifyQueued || listeners.size === 0) return;
  notifyQueued = true;
  setTimeout(() => {
    notifyQueued = false;
    for (const fn of listeners) fn();
  }, 0);
}

/**
 * Time a synchronous block. Returns whatever the block returns, so it can wrap
 * an existing expression without restructuring the caller.
 */
export function time<T>(label: string, fn: () => T, detail?: () => string): T {
  if (!perfOn()) return fn();
  const t0 = performance.now();
  try {
    return fn();
  } finally {
    record(label, performance.now() - t0, detail?.());
  }
}

/** For work that can't be wrapped in a callback. Returns the stop function. */
export function startTimer(label: string): (detail?: string) => void {
  if (!perfOn()) return () => {};
  const t0 = performance.now();
  return (detail?: string) => record(label, performance.now() - t0, detail);
}

/** A point in time rather than a span — "the chat panel opened". */
export function note(label: string, detail?: string) {
  if (!perfOn()) return;
  record(label, 0, detail);
}

export function perfEntries(): readonly PerfEntry[] {
  return entries;
}

/**
 * A counter that changes whenever an entry is recorded — the snapshot the
 * overlay subscribes to. It stays at 0 until the first measurement, which is
 * also how the overlay knows to render nothing at all when timing is off, with
 * no client-only check to disagree with the server about.
 */
export function perfVersion(): number {
  return version;
}

export function subscribePerf(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
