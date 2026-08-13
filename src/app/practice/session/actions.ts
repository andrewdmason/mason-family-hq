"use server";

import { createClient } from "@/lib/supabase/server";
import {
  createAudioUploadToken,
  safeAudioExt,
} from "@/lib/practice/storage";

/**
 * Start an open session (plan U8): create the session row and hand back a
 * signed upload URL for the recording. The browser uploads the audio directly
 * to storage, then POSTs the session id to the process route (transcription-
 * only — linking to pieces is a separate, explicit action). The audio is kept
 * permanently at this path (KTD8).
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
  const path = `${user.id}/sessions/${sessionId}.${safeAudioExt(ext)}`;
  const token = await createAudioUploadToken(supabase, path);

  const { error: insErr } = await supabase
    .from("practice_sessions")
    .insert({ id: sessionId, recording_path: path, status: "uploaded" });
  if (insErr) throw new Error(insErr.message);

  return { sessionId, path, token };
}
