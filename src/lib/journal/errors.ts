import Anthropic from "@anthropic-ai/sdk";

/**
 * Turn a failed Anthropic call into a response the picker can show the user.
 * When retries are exhausted on a transient error (529 overloaded, 429 rate
 * limit, 5xx), the SDK throws an APIError whose `.message` is the raw status +
 * JSON body — surfacing that verbatim is what put `529 {"type":"error",...}` on
 * screen. Map the known-transient ones to a plain-English, retryable message
 * (and a matching status), and fall back to the generic message otherwise.
 */
export function toJournalApiError(err: unknown): { message: string; status: number } {
  if (err instanceof Anthropic.APIError && typeof err.status === "number") {
    if (err.status === 529) {
      return {
        message: "The journal’s writing assistant is overloaded right now. Give it a moment and try again.",
        status: 503,
      };
    }
    if (err.status === 429) {
      return {
        message: "Too many requests in a row — wait a moment and try again.",
        status: 503,
      };
    }
    if (err.status >= 500) {
      return {
        message: "The writing assistant hit a temporary error. Try again in a moment.",
        status: 503,
      };
    }
  }
  return { message: toErrorMessage(err), status: 500 };
}

/**
 * A human-readable message from anything thrown. Supabase/Postgrest rejects with
 * a plain object ({ message, details, hint, code }), not an Error — so the naive
 * `String(err)` yields "[object Object]". This pulls out a useful message, then
 * falls back to JSON so a failure is always legible in the UI and logs.
 */
export function toErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  if (err && typeof err === "object" && "message" in err) {
    const m = (err as { message?: unknown }).message;
    if (typeof m === "string" && m.trim()) return m;
  }
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}
