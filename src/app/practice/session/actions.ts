"use server";

import { createClient } from "@/lib/supabase/server";

const BUCKET = "task-audio";

/**
 * Start a listening session (plan U5): create the session row and hand back a
 * signed upload URL for the recording. The browser uploads the audio directly to
 * storage, then POSTs the session id to the process route. The recording path is
 * session-scoped (one recording fans out into several tasks).
 */
export async function createSession(
  ext: string
): Promise<{ sessionId: string; path: string; token: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const sessionId = crypto.randomUUID();
  const safeExt = (ext.replace(/[^a-z0-9]/gi, "").slice(0, 5) || "m4a").toLowerCase();
  const path = `${user.id}/sessions/${sessionId}.${safeExt}`;

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUploadUrl(path, { upsert: true });
  if (error || !data) {
    throw new Error(error?.message ?? "Failed to create upload URL");
  }

  const { error: insErr } = await supabase
    .from("practice_sessions")
    .insert({ id: sessionId, recording_path: path, status: "uploaded" });
  if (insErr) throw new Error(insErr.message);

  return { sessionId, path, token: data.token };
}
