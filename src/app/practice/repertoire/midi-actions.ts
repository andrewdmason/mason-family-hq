"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { parseReferenceMidi } from "@/lib/practice/midi";
import type { ReferenceMidi } from "@/lib/types";

const BUCKET = "piece-midi";

export async function getReferenceMidi(
  pieceId: string
): Promise<ReferenceMidi | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("practice_reference_midis")
    .select("*")
    .eq("piece_id", pieceId)
    .maybeSingle();
  return (data as ReferenceMidi) ?? null;
}

export async function createMidiUploadUrl(
  pieceId: string
): Promise<{ path: string; token: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const path = `${user.id}/${pieceId}.mid`;
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUploadUrl(path, { upsert: true });
  if (error || !data) {
    throw new Error(error?.message ?? "Failed to create signed upload URL");
  }
  return { path: data.path, token: data.token };
}

/**
 * Record the uploaded MIDI on the piece, parsing it for the recognizability
 * badge. A parse failure is captured as `status: "failed"` (not thrown) so a bad
 * file degrades gracefully rather than breaking the page.
 */
export async function attachReferenceMidi(
  pieceId: string,
  midiPath: string
): Promise<{ status: ReferenceMidi["status"]; error_message: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  // Orphan-clean a prior object if the path changed (mirrors attachTaskAudio).
  const { data: prev } = await supabase
    .from("practice_reference_midis")
    .select("midi_path")
    .eq("piece_id", pieceId)
    .maybeSingle();
  if (prev?.midi_path && prev.midi_path !== midiPath) {
    await supabase.storage.from(BUCKET).remove([prev.midi_path]);
  }

  let status: ReferenceMidi["status"] = "ready";
  let error_message: string | null = null;
  let ppq: number | null = null;
  let note_count: number | null = null;
  let measure_count: number | null = null;
  try {
    const { data: file, error: dlErr } = await supabase.storage
      .from(BUCKET)
      .download(midiPath);
    if (dlErr || !file) {
      throw new Error(dlErr?.message ?? "Could not read the uploaded MIDI");
    }
    const parsed = parseReferenceMidi(await file.arrayBuffer());
    ppq = parsed.ppq;
    note_count = parsed.noteCount;
    measure_count = parsed.measureCount;
  } catch (e) {
    status = "failed";
    error_message = e instanceof Error ? e.message : "Failed to parse MIDI";
  }

  const { error } = await supabase.from("practice_reference_midis").upsert({
    piece_id: pieceId,
    midi_path: midiPath,
    status,
    measure_count,
    ppq,
    note_count,
    error_message,
    uploaded_by: user.id,
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(error.message);

  revalidatePath(`/practice/repertoire/${pieceId}`);
  revalidatePath("/practice/repertoire");
  return { status, error_message };
}

export async function deleteReferenceMidi(pieceId: string): Promise<void> {
  const supabase = await createClient();
  const { data: row } = await supabase
    .from("practice_reference_midis")
    .select("midi_path")
    .eq("piece_id", pieceId)
    .maybeSingle();
  if (row?.midi_path) {
    await supabase.storage.from(BUCKET).remove([row.midi_path]);
  }
  const { error } = await supabase
    .from("practice_reference_midis")
    .delete()
    .eq("piece_id", pieceId);
  if (error) throw new Error(error.message);

  revalidatePath(`/practice/repertoire/${pieceId}`);
  revalidatePath("/practice/repertoire");
}
