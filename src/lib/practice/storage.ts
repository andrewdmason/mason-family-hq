import type { SupabaseClient } from "@supabase/supabase-js";

// Storage plumbing shared across the practice capture pipeline — bucket
// names, signed read URLs for worker jobs, and upload-target minting — so the
// segment and session paths can't drift apart.

/** Kept audio for recordings and open sessions (KTD8 — never deleted by the pipeline). */
const RECORDING_BUCKET = "task-audio";
/** Reference MIDIs for known-piece alignment. */
export const MIDI_BUCKET = "piece-midi";
export const SIGNED_URL_TTL_SECONDS = 1800;

/** Sanitized extension for an audio object path ({uid}/…/{id}.{ext}). */
export function safeAudioExt(ext: string): string {
  return (ext.replace(/[^a-z0-9]/gi, "").slice(0, 5) || "m4a").toLowerCase();
}

/** Signed read URL for a worker job's recording; throws when signing fails. */
export async function signRecordingUrl(
  supabase: SupabaseClient,
  path: string
): Promise<string> {
  const { data, error } = await supabase.storage
    .from(RECORDING_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (error || !data) {
    throw new Error(error?.message ?? "Could not sign recording URL");
  }
  return data.signedUrl;
}

/** Signed upload token for a new audio object at `path` (upsert, so retried
 * and re-swept uploads to the same path stay safe). */
export async function createAudioUploadToken(
  supabase: SupabaseClient,
  path: string
): Promise<string> {
  const { data, error } = await supabase.storage
    .from(RECORDING_BUCKET)
    .createSignedUploadUrl(path, { upsert: true });
  if (error || !data) {
    throw new Error(error?.message ?? "Failed to create upload URL");
  }
  return data.token;
}
