"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { MusicIcon, CheckCircle2Icon, AlertCircleIcon, Trash2Icon, Loader2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import {
  createMidiUploadUrl,
  attachReferenceMidi,
  deleteReferenceMidi,
} from "@/app/practice/repertoire/midi-actions";
import type { ReferenceMidi } from "@/lib/types";

/**
 * Upload / replace / remove the reference MIDI for a piece, and show whether the
 * piece is "recognizable" by the listen-and-auto-log pipeline (plan unit U3).
 */
export function ReferenceMidiPanel({
  pieceId,
  initial,
}: {
  pieceId: string;
  initial: ReferenceMidi | null;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const midi = initial;

  async function handleFile(file: File) {
    setBusy(true);
    setError(null);
    try {
      const { path, token } = await createMidiUploadUrl(pieceId);
      const supabase = createClient();
      const { error: upErr } = await supabase.storage
        .from("piece-midi")
        .uploadToSignedUrl(path, token, file, {
          upsert: true,
          contentType: "audio/midi",
        });
      if (upErr) throw new Error(upErr.message);

      const { status, error_message } = await attachReferenceMidi(pieceId, path);
      if (status === "failed") {
        setError(error_message ?? "That file couldn't be read as a MIDI.");
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove() {
    setBusy(true);
    setError(null);
    try {
      await deleteReferenceMidi(pieceId);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't remove the MIDI");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <MusicIcon className="size-4 text-muted-foreground" />
        <h3 className="text-sm font-medium">Reference MIDI</h3>
        {midi?.status === "ready" && (
          <span className="inline-flex items-center gap-1 text-xs text-green-600 dark:text-green-500">
            <CheckCircle2Icon className="size-3.5" /> Recognizable
          </span>
        )}
        {midi?.status === "failed" && (
          <span className="inline-flex items-center gap-1 text-xs text-destructive">
            <AlertCircleIcon className="size-3.5" /> Couldn&apos;t read this file
          </span>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        {midi?.status === "ready" ? (
          <>
            On file
            {midi.measure_count ? ` · ~${midi.measure_count} measures` : ""}
            {midi.note_count ? ` · ${midi.note_count} notes` : ""}. The practice
            listener can recognize this piece.
          </>
        ) : (
          <>
            Upload a MIDI of this piece so the practice listener can recognize it.
            A plain score MIDI is fine — timing and dynamics don&apos;t matter.
          </>
        )}
      </p>

      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          type="file"
          accept=".mid,.midi,audio/midi"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
            e.target.value = "";
          }}
        />
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
        >
          {busy && <Loader2Icon className="size-3.5 animate-spin" />}
          {midi ? "Replace MIDI" : "Upload MIDI"}
        </Button>
        {midi && (
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={handleRemove}
            className="text-muted-foreground"
          >
            <Trash2Icon className="size-3.5" /> Remove
          </Button>
        )}
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
