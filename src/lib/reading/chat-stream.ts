/**
 * The wire between a reader chat route and the panel rendering it.
 *
 * The reply is raw prose — bytes in, bubble out — and it stays that way, because
 * a framed protocol for something this small would cost more than it buys. Two
 * things ride alongside it, both as escape hatches rather than as a format:
 *
 *  - THE ERROR TAIL, appended when a turn dies mid-flight. A failed turn is
 *    never persisted, so this is the only way the panel learns the difference
 *    between "the answer stopped" and "the answer ended".
 *  - STATUS FRAMES, saying what the model is doing while it has nothing to say.
 *
 * Lives here rather than in the panel because a network chunk can land in the
 * middle of a frame, and the arithmetic that handles that is worth checking
 * against adversarial splits — see scripts/verify-chat-stream.mts.
 */

/** The route marks a failed turn this way rather than persisting a message. */
export const ERROR_MARKER = /\n\n\[error: ([\s\S]*)\]$/;

/**
 * Opens a status frame: this character, the status text, then a newline. An
 * empty one clears the status.
 *
 * A control character rather than a bracketed marker like the error tail, for
 * two reasons: this one has to survive appearing mid-sentence, where a
 * bracketed marker would eventually collide with something a model wrote — and
 * no model writes U+001F.
 */
export const CHAT_STREAM_STATUS = "\u001f";

/** Build a frame. `null` clears whatever the panel is currently showing. */
export function statusFrame(status: string | null): string {
  // A newline inside the status would end the frame early and spill the rest
  // into the bubble. Nothing sends one today; this is so nothing can.
  return `${CHAT_STREAM_STATUS}${(status ?? "").replace(/\s+/g, " ").trim()}\n`;
}

/**
 * Drain a reply into the thread as it arrives, and return the error a broken
 * stream ends with — or null if it finished.
 *
 * Shared by the reader's questions and by the chapter summary, which are
 * answered by different routes but must behave identically once the bytes start
 * moving: same incremental render, same reading of the failure marker. Two
 * copies of this loop would eventually disagree about the second one.
 *
 * Frames are lifted out here, not by the caller. Everything from a separator to
 * the next newline is held back until that newline arrives, so a frame split
 * across two chunks is never shown as half a word.
 */
export async function streamReply(
  body: ReadableStream<Uint8Array>,
  onText: (soFar: string) => void,
  onStatus?: (status: string | null) => void
): Promise<string | null> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  /** Bytes not yet known to be prose — an unterminated frame, or nothing. */
  let held = "";
  let acc = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    held += decoder.decode(value, { stream: true });
    for (;;) {
      const at = held.indexOf(CHAT_STREAM_STATUS);
      if (at < 0) {
        acc += held;
        held = "";
        break;
      }
      acc += held.slice(0, at);
      const end = held.indexOf("\n", at);
      if (end < 0) {
        // The frame is still arriving. Keep it out of the bubble.
        held = held.slice(at);
        break;
      }
      onStatus?.(held.slice(at + 1, end) || null);
      held = held.slice(end + 1);
    }
    onText(acc);
  }
  // A stream that failed mid-flight carries the marker instead of ending
  // cleanly; the caller surfaces it as an error rather than as something Claude
  // said.
  return acc.match(ERROR_MARKER)?.[1] ?? null;
}
