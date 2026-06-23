"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import dynamic from "next/dynamic";
import {
  AlertCircleIcon,
  ArchiveIcon,
  Loader2Icon,
  MoreVerticalIcon,
  MusicIcon,
  PencilIcon,
  PlusIcon,
  RotateCcwIcon,
  Trash2Icon,
  UploadIcon,
  VideoOffIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { StatusBadge } from "./status-badge";
import { ArchiveDialog } from "./archive-dialog";
import { PerformanceFormDialog } from "./performance-form-dialog";
import { WorkPicker } from "./work-picker";
import { SectionEditor } from "./section-editor";
import { AssignmentList } from "./assignment-list";
import { PerformancesPanel } from "./performances-panel";
import { RecordingsList } from "@/components/recordings/recordings-list";
import {
  updatePieceDetails,
  updatePieceStatus,
} from "@/app/practice/repertoire/actions";
import {
  createMidiUploadUrl,
  attachReferenceMidi,
  deleteReferenceMidi,
} from "@/app/practice/repertoire/midi-actions";
import { getVideos, deleteVideo } from "@/app/practice/repertoire/video-actions";
import type { ParsedReferenceRoll } from "@/lib/practice/midi";
import type { Recording } from "@/app/practice/recordings/actions";
import type {
  Assignment,
  Performance,
  Piece,
  PieceSectionWithChildren,
  PieceSectionTimestamp,
  PieceVideo,
  PieceWeeklyCumulativeData,
  ReferenceMidi,
  SectionStatusSnapshot,
  Work,
} from "@/lib/types";

// Heavy panels: only load when their tab is shown.
const MeasureViewPanel = dynamic(() =>
  import("./measure-view-panel").then((m) => m.MeasureViewPanel)
);
const PieceCumulativeChart = dynamic(() =>
  import("./piece-cumulative-chart").then((m) => m.PieceCumulativeChart)
);
const ProgressGrid = dynamic(() =>
  import("./progress-grid").then((m) => m.ProgressGrid)
);

type Tab = "main" | "recordings" | "midi" | "reports";

const TABS: { key: Tab; label: string }[] = [
  { key: "main", label: "Overview" },
  { key: "recordings", label: "Recordings" },
  { key: "midi", label: "MIDI" },
  { key: "reports", label: "Reports" },
];

export function PieceDetailView({
  piece,
  work,
  works,
  initialSections,
  initialVideos,
  initialTimestamps,
  assignments,
  performances,
  recordings,
  referenceMidi,
  roll,
  chartData,
  progressSnapshots,
}: {
  piece: Piece;
  work: Work | null;
  works: Work[];
  initialSections: PieceSectionWithChildren[];
  initialVideos: PieceVideo[];
  initialTimestamps: PieceSectionTimestamp[];
  assignments: Assignment[];
  performances: Performance[];
  recordings: Recording[];
  referenceMidi: ReferenceMidi | null;
  roll: ParsedReferenceRoll | null;
  chartData: PieceWeeklyCumulativeData[];
  progressSnapshots: SectionStatusSnapshot[];
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("main");

  /* ----------------------------- editing ------------------------------ */
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(piece.name);
  const [composer, setComposer] = useState(piece.composer ?? "");
  const [notes, setNotes] = useState(piece.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [addPerformanceOpen, setAddPerformanceOpen] = useState(false);
  const [reactivating, setReactivating] = useState(false);
  const [pickingWork, setPickingWork] = useState(false);

  async function handleSave() {
    setSaving(true);
    const result = await updatePieceDetails(piece.id, {
      name,
      composer: composer || null,
      notes: notes || null,
    });
    setSaving(false);
    if (!("error" in result)) {
      setEditing(false);
      router.refresh();
    }
  }

  function handleCancel() {
    setName(piece.name);
    setComposer(piece.composer ?? "");
    setNotes(piece.notes ?? "");
    setEditing(false);
  }

  async function handleReactivate() {
    setReactivating(true);
    await updatePieceStatus(piece.id, "active");
    setReactivating(false);
    router.refresh();
  }

  /* ------------------------------ video ------------------------------- */
  const [hasVideo, setHasVideo] = useState(initialVideos.length > 0);
  const [videoId, setVideoId] = useState<string | null>(
    initialVideos[0]?.id ?? null
  );

  useEffect(() => {
    const handler = async () => {
      const vids = await getVideos(piece.id);
      setHasVideo(vids.length > 0);
      setVideoId(vids[0]?.id ?? null);
    };
    window.addEventListener("piece-video-changed", handler);
    return () => window.removeEventListener("piece-video-changed", handler);
  }, [piece.id]);

  async function handleRemoveVideo() {
    if (!videoId) return;
    await deleteVideo(videoId);
    window.dispatchEvent(new CustomEvent("piece-video-changed"));
  }

  /* ------------------------------- midi ------------------------------- */
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [midiBusy, setMidiBusy] = useState(false);
  const [midiError, setMidiError] = useState<string | null>(null);

  async function handleMidiFile(file: File) {
    setMidiBusy(true);
    setMidiError(null);
    try {
      const { path, token } = await createMidiUploadUrl(piece.id);
      const supabase = createClient();
      const { error: upErr } = await supabase.storage
        .from("piece-midi")
        .uploadToSignedUrl(path, token, file, {
          upsert: true,
          contentType: "audio/midi",
        });
      if (upErr) throw new Error(upErr.message);
      const { status, error_message } = await attachReferenceMidi(piece.id, path);
      if (status === "failed") {
        setMidiError(error_message ?? "That file couldn't be read as a MIDI.");
      }
      router.refresh();
    } catch (e) {
      setMidiError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setMidiBusy(false);
    }
  }

  async function handleMidiRemove() {
    setMidiBusy(true);
    setMidiError(null);
    try {
      await deleteReferenceMidi(piece.id);
      router.refresh();
    } catch (e) {
      setMidiError(e instanceof Error ? e.message : "Couldn't remove the MIDI");
    } finally {
      setMidiBusy(false);
    }
  }

  /* ------------------------------ render ------------------------------ */

  if (editing) {
    return (
      <div className="space-y-3">
        <StatusBadge status={piece.status} />
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Piece name"
          className="text-lg font-semibold"
          autoFocus
        />
        <Input
          value={composer}
          onChange={(e) => setComposer(e.target.value)}
          placeholder="Composer (optional)"
        />
        <div>
          <label className="text-sm font-medium mb-1.5 block">Notes</label>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Add notes about this piece..."
            className="min-h-24"
          />
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={handleSave} disabled={saving || !name.trim()}>
            {saving ? "Saving..." : "Save"}
          </Button>
          <Button size="sm" variant="ghost" onClick={handleCancel} disabled={saving}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Hidden file input shared by the overflow menu and the MIDI tab CTA. */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".mid,.midi,audio/midi"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleMidiFile(f);
          e.target.value = "";
        }}
      />

      {/* Header */}
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <StatusBadge status={piece.status} />
      </div>
      <div className="mt-2 flex items-start gap-2">
        <h2 className="text-2xl font-semibold tracking-tight">{name}</h2>
        <DropdownMenu>
          <DropdownMenuTrigger
            className="mt-1.5 rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label="Piece actions"
          >
            <MoreVerticalIcon className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="bottom" className="w-52">
            <DropdownMenuItem onClick={() => setEditing(true)}>
              <PencilIcon />
              Edit details
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setAddPerformanceOpen(true)}>
              <PlusIcon />
              Add performance
            </DropdownMenuItem>

            <DropdownMenuSeparator />

            <DropdownMenuItem
              onClick={() => setPickingWork(true)}
              disabled={!composer}
            >
              <PlusIcon />
              {work ? "Change work" : "Add to a work"}
            </DropdownMenuItem>
            {hasVideo && (
              <DropdownMenuItem onClick={handleRemoveVideo}>
                <VideoOffIcon />
                Remove video
              </DropdownMenuItem>
            )}

            <DropdownMenuSeparator />

            <DropdownMenuItem
              onClick={() => fileInputRef.current?.click()}
              disabled={midiBusy}
            >
              <UploadIcon />
              {referenceMidi ? "Replace MIDI" : "Upload MIDI"}
            </DropdownMenuItem>
            {referenceMidi && (
              <DropdownMenuItem onClick={handleMidiRemove} disabled={midiBusy}>
                <Trash2Icon />
                Remove MIDI
              </DropdownMenuItem>
            )}

            <DropdownMenuSeparator />

            {piece.status === "archived" ? (
              <DropdownMenuItem onClick={handleReactivate} disabled={reactivating}>
                <RotateCcwIcon />
                {reactivating ? "Reactivating..." : "Reactivate"}
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onClick={() => setArchiveOpen(true)}>
                <ArchiveIcon />
                Archive
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
        {composer && <span>{composer}</span>}
        {work && (
          <>
            <span>&middot;</span>
            <Link
              href={`/practice/repertoire/works/${work.id}`}
              className="hover:text-foreground"
            >
              {work.name}
            </Link>
          </>
        )}
      </div>

      {pickingWork && (
        <div className="mt-2 text-sm">
          <WorkPicker
            piece={piece}
            work={work}
            works={works}
            composer={composer}
            defaultOpen
            onClose={() => setPickingWork(false)}
          />
        </div>
      )}

      {notes && (
        <p className="mt-3 whitespace-pre-wrap text-sm text-muted-foreground">
          {notes}
        </p>
      )}

      {midiError && <p className="mt-2 text-xs text-destructive">{midiError}</p>}

      {/* Tab bar */}
      <div className="mt-5 flex gap-5 border-b">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "relative -mb-px border-b-2 px-0.5 pb-2 text-sm transition-colors",
              tab === t.key
                ? "border-primary font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="mt-5">
        {tab === "main" && (
          <div className="space-y-6">
            <AssignmentList pieceId={piece.id} initialAssignments={assignments} />
            <SectionEditor
              pieceId={piece.id}
              pieceTargetTempo={piece.target_tempo}
              initialSections={initialSections}
              initialVideos={initialVideos}
              initialTimestamps={initialTimestamps}
            />
          </div>
        )}

        {tab === "recordings" && (
          <div className="space-y-8">
            {performances.length > 0 && (
              <section className="space-y-3">
                <h3 className="text-sm font-medium">Performances</h3>
                <PerformancesPanel
                  performances={performances}
                  owner={{ pieceId: piece.id }}
                />
              </section>
            )}
            <section className="space-y-3">
              <h3 className="text-sm font-medium">Recordings</h3>
              <RecordingsList initial={recordings} />
            </section>
          </div>
        )}

        {tab === "midi" && <MidiTab piece={piece} roll={roll} referenceMidi={referenceMidi} sections={initialSections} busy={midiBusy} onUpload={() => fileInputRef.current?.click()} />}

        {tab === "reports" && (
          <div className="space-y-6">
            <PieceCumulativeChart data={chartData} />
            <ProgressGrid sections={initialSections} snapshots={progressSnapshots} />
          </div>
        )}
      </div>

      <ArchiveDialog
        piece={piece}
        open={archiveOpen}
        onOpenChange={setArchiveOpen}
      />
      <PerformanceFormDialog
        owner={{ pieceId: piece.id }}
        open={addPerformanceOpen}
        onOpenChange={setAddPerformanceOpen}
      />
    </div>
  );
}

/* ------------------------------- MIDI tab ------------------------------- */

function MidiTab({
  piece,
  roll,
  referenceMidi,
  sections,
  busy,
  onUpload,
}: {
  piece: Piece;
  roll: ParsedReferenceRoll | null;
  referenceMidi: ReferenceMidi | null;
  sections: PieceSectionWithChildren[];
  busy: boolean;
  onUpload: () => void;
}) {
  if (roll && roll.notes.length > 0) {
    // Break out of the page's centered max-width so the timeline spans the full
    // page width; the inner padding keeps it off the viewport edges.
    return (
      <div style={{ width: "100vw", marginLeft: "calc(50% - 50vw)" }}>
        <div className="px-4 sm:px-6">
          <MeasureViewPanel
            pieceId={piece.id}
            pieceTempo={piece.target_tempo}
            roll={roll}
            initialSections={sections}
          />
        </div>
      </div>
    );
  }

  // Failed parse: tell them, offer to replace via the overflow.
  if (referenceMidi?.status === "failed") {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center">
        <AlertCircleIcon className="mx-auto mb-2 size-6 text-destructive" />
        <p className="text-sm text-muted-foreground">
          That file couldn&apos;t be read as a MIDI. Replace it from the menu
          (&middot;&middot;&middot;) above.
        </p>
      </div>
    );
  }

  // Empty state: CTA to upload.
  return (
    <div className="rounded-lg border border-dashed p-8 text-center">
      <MusicIcon className="mx-auto mb-2 size-6 text-muted-foreground" />
      <p className="mb-4 text-sm text-muted-foreground">
        Upload a MIDI of this piece to see its measures and let the practice
        listener recognize it. A plain score MIDI is fine — timing and dynamics
        don&apos;t matter.
      </p>
      <Button size="sm" onClick={onUpload} disabled={busy}>
        {busy ? (
          <Loader2Icon className="size-3.5 animate-spin" />
        ) : (
          <UploadIcon className="size-3.5" />
        )}
        Upload MIDI
      </Button>
    </div>
  );
}
