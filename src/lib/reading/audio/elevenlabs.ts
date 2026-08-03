import "server-only";
import { AUDIO_FORMAT, NARRATION_MODEL } from "./constants";

/**
 * The narration API, wrapped thinly.
 *
 * Two things it does that a bare fetch wouldn't:
 *
 * It asks for TIMESTAMPS. The plain endpoint returns audio; this one returns
 * audio plus the time every character is spoken at. That is the whole basis of
 * follow-along — without it the text and the voice are two independent things
 * and the highlight would have to be guessed from an average reading speed.
 *
 * It passes the SURROUNDING TEXT. A chapter is longer than one request, so the
 * voice would otherwise restart its pitch and pacing at every join, which is
 * audible as a small hitch mid-paragraph. Showing each request what comes before
 * and after it is what makes the seams disappear.
 */

const API_ROOT = "https://api.elevenlabs.io/v1";

/** Transient failures worth another go — rate limits and upstream wobbles. */
const RETRY_STATUS = new Set([408, 429, 500, 502, 503, 504, 529]);
const MAX_ATTEMPTS = 4;

export type Alignment = {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
};

export type NarrationResult = {
  audio: Uint8Array;
  /**
   * Per-character times against the text as SENT. Null when the API declined to
   * return an alignment, which the caller has to survive: a chapter with no
   * timings still plays, it just can't follow along.
   */
  alignment: Alignment | null;
};

function apiKey(): string {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error("ELEVENLABS_API_KEY is not set");
  return key;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Narrate one piece of a chapter.
 *
 * `previousText`/`nextText` are context only — they are not spoken and are not
 * billed. The returned alignment covers `text` alone.
 */
export async function narrate({
  text,
  voiceId,
  previousText,
  nextText,
  signal,
}: {
  text: string;
  voiceId: string;
  previousText?: string;
  nextText?: string;
  signal?: AbortSignal;
}): Promise<NarrationResult> {
  const url = `${API_ROOT}/text-to-speech/${encodeURIComponent(voiceId)}/with-timestamps?output_format=${AUDIO_FORMAT}`;

  let lastError = "";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        signal,
        headers: {
          "xi-api-key": apiKey(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text,
          model_id: NARRATION_MODEL,
          previous_text: previousText || undefined,
          next_text: nextText || undefined,
          // The text has already been through the narration cleanup, which
          // spells out the abbreviations and numbers that matter in context
          // ("Ch. 4", "1914-18"). Leaving the API's own normalization on is
          // still the right default — it catches what the cleanup didn't.
          apply_text_normalization: "auto",
        }),
      });
    } catch (err) {
      // Network-level failure. An abort is the caller giving up, not a fault.
      if (signal?.aborted) throw err;
      lastError = err instanceof Error ? err.message : "network error";
      if (attempt === MAX_ATTEMPTS) break;
      await sleep(500 * 2 ** (attempt - 1));
      continue;
    }

    if (response.ok) {
      const body = (await response.json()) as {
        audio_base64?: string;
        alignment?: Alignment | null;
      };
      if (!body.audio_base64) throw new Error("The narrator returned no audio.");
      return {
        audio: Uint8Array.from(Buffer.from(body.audio_base64, "base64")),
        alignment: body.alignment ?? null,
      };
    }

    lastError = `${response.status} ${(await response.text()).slice(0, 300)}`;
    if (!RETRY_STATUS.has(response.status) || attempt === MAX_ATTEMPTS) break;

    // Honour a served Retry-After; otherwise back off exponentially.
    const retryAfter = Number(response.headers.get("retry-after"));
    await sleep(
      Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : 500 * 2 ** (attempt - 1)
    );
  }

  throw new Error(`Narration failed: ${lastError}`);
}
