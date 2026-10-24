/**
 * The Reader iOS app shows the website's reading screen in a web view, and
 * says so in its user agent ("MasonReaderApp"). Inside it, a few things go to
 * the app instead: the read-aloud audio plays through the app's own player (so
 * it keeps going with the phone locked), and the app hears which books are on
 * the device. See ios/Reader.
 */

type ReaderAppWindow = Window & {
  webkit?: { messageHandlers?: Record<string, { postMessage(body: unknown): void }> };
};

export function inReaderApp(): boolean {
  return typeof navigator !== "undefined" && navigator.userAgent.includes("MasonReaderApp");
}

/** A message to the app's "readerApp" handler; nothing outside the app. */
export function postToReaderApp(message: unknown): void {
  if (!inReaderApp()) return;
  (window as ReaderAppWindow).webkit?.messageHandlers?.readerApp?.postMessage(message);
}
