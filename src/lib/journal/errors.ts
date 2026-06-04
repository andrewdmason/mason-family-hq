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
