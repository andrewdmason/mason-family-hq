"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import {
  PlayIcon,
  PauseIcon,
  MicIcon,
  MoreVerticalIcon,
  Trash2Icon,
  DownloadIcon,
  Scissors,
  ArrowUpIcon,
  ArrowDownIcon,
  ChevronDownIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Recording } from "@/app/practice/recordings/actions";
import { createSignedPlaybackUrl } from "@/app/practice/timer/audio-actions";
import {
  deleteRecording,
  updateRecordingTitle,
  type SavedRecording,
} from "@/app/practice/recordings/recording-actions";
import { useTaskTimer } from "@/components/timer/task-timer-context";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  TaskAudioDialog,
  formatNotesDefault,
} from "@/components/practice-table/task-audio-dialog";
import { RecordingsPlayerBar } from "@/components/recordings/recordings-player-bar";

type SortKey = "piece" | "time" | "composer" | "group" | "notes" | "date";
type SortDir = "asc" | "desc";

const GENERAL_KEY = "__general__";

/** Piece association picked before recording a performance from the tab. */
type RecordTarget = {
  pieceId: string | null;
  pieceName: string | null;
  pieceComposer: string | null;
  workName: string | null;
};

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const s = Math.floor(seconds);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr + "T12:00:00");
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().slice(0, 10);
  if (dateStr === todayStr) return "Today";
  if (dateStr === yesterdayStr) return "Yesterday";
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function comparatorFor(key: SortKey): (a: Recording, b: Recording) => number {
  const str = (v: string | null | undefined) => (v ?? "").toLocaleLowerCase();
  switch (key) {
    case "piece":
      return (a, b) =>
        str(a.pieceName ?? "General").localeCompare(str(b.pieceName ?? "General"));
    case "time":
      return (a, b) => a.durationSeconds - b.durationSeconds;
    case "composer":
      return (a, b) => str(a.pieceComposer).localeCompare(str(b.pieceComposer));
    case "group":
      return (a, b) =>
        str(a.workName).localeCompare(str(b.workName));
    case "notes":
      return (a, b) => str(a.audioTitle).localeCompare(str(b.audioTitle));
    case "date":
      return (a, b) => a.createdAt.localeCompare(b.createdAt);
  }
}

function buildDownloadFilename(rec: Recording): string {
  const parts = rec.audioTitle
    ? [rec.audioTitle, rec.date]
    : [rec.pieceName ?? "General", rec.sectionLabel, rec.date];
  const raw = (parts.filter(Boolean) as string[]).join(" - ");
  return raw.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim();
}

export function RecordingsList({
  initial,
  showRecordButton = false,
}: {
  initial: Recording[];
  /**
   * Renders the "Record performance" entry point (Recordings tab). The piece
   * page passes nothing and stays a pure list.
   */
  showRecordButton?: boolean;
}) {
  const [recordings, setRecordings] = useState<Recording[]>(initial);
  const [filterKey, setFilterKey] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [trimDialogId, setTrimDialogId] = useState<string | null>(null);
  const [recordTarget, setRecordTarget] = useState<RecordTarget | null>(null);
  // Active pieces (and their work names) power the pre-record piece picker
  // and let a freshly saved performance render fully before any refresh.
  const { activePieces, worksById } = useTaskTimer();

  type PieceOption = { key: string; label: string; workName: string | null };
  type MenuEntry =
    | { kind: "piece"; option: PieceOption }
    | { kind: "work"; name: string; options: PieceOption[] };

  const pieceOptions = useMemo<PieceOption[]>(() => {
    const seen = new Map<string, PieceOption>();
    for (const rec of recordings) {
      const key = rec.pieceName ?? GENERAL_KEY;
      if (seen.has(key)) continue;
      seen.set(key, {
        key,
        label: rec.pieceName ?? "General",
        workName: rec.pieceName ? rec.workName : null,
      });
    }
    return Array.from(seen.values());
  }, [recordings]);

  const menuEntries = useMemo<MenuEntry[]>(() => {
    const byWork = new Map<string, PieceOption[]>();
    for (const opt of pieceOptions) {
      if (!opt.workName) continue;
      const list = byWork.get(opt.workName) ?? [];
      list.push(opt);
      byWork.set(opt.workName, list);
    }
    const entries: MenuEntry[] = [];
    const seenWorks = new Set<string>();
    for (const opt of pieceOptions) {
      const work = opt.workName;
      const workOptions = work
        ? byWork.get(work)
        : undefined;
      if (work && workOptions && workOptions.length > 1) {
        if (seenWorks.has(work)) continue;
        seenWorks.add(work);
        entries.push({
          kind: "work",
          name: work,
          options: workOptions,
        });
      } else {
        entries.push({ kind: "piece", option: opt });
      }
    }
    return entries;
  }, [pieceOptions]);

  const visible = useMemo(() => {
    const filtered = filterKey
      ? recordings.filter(
          (r) => (r.pieceName ?? GENERAL_KEY) === filterKey
        )
      : recordings;
    const cmp = comparatorFor(sortKey);
    const sorted = [...filtered].sort(cmp);
    if (sortDir === "desc") sorted.reverse();
    return sorted;
  }, [recordings, filterKey, sortKey, sortDir]);

  const currentRecording = useMemo(
    () => recordings.find((r) => r.id === currentId) ?? null,
    [recordings, currentId]
  );

  const trimDialogRec = useMemo(
    () => recordings.find((r) => r.id === trimDialogId) ?? null,
    [recordings, trimDialogId]
  );

  const handlePlayRow = useCallback(
    (rec: Recording) => {
      if (currentId === rec.id) {
        setIsPlaying((p) => !p);
        return;
      }
      setCurrentId(rec.id);
      setIsPlaying(true);
    },
    [currentId]
  );

  const handleTitleSaved = useCallback(
    (id: string, nextTitle: string | null) => {
      setRecordings((prev) =>
        prev.map((r) => (r.id === id ? { ...r, audioTitle: nextTitle } : r))
      );
    },
    []
  );

  const handleDeleted = useCallback(
    (id: string) => {
      setRecordings((prev) => prev.filter((r) => r.id !== id));
      if (currentId === id) {
        setCurrentId(null);
        setIsPlaying(false);
      }
    },
    [currentId]
  );

  const handleTrimUpdated = useCallback(
    (id: string, start: number | null, end: number | null) => {
      setRecordings((prev) =>
        prev.map((r) =>
          r.id === id
            ? { ...r, trimStartSeconds: start, trimEndSeconds: end }
            : r
        )
      );
    },
    []
  );

  /**
   * A save from the dialog: either a brand-new performance (replacedId null)
   * or a re-record that replaced an existing row. Piece metadata comes from
   * the caller (picker or the replaced row) — the server row only carries ids.
   */
  const handleSaved = useCallback(
    (
      saved: SavedRecording,
      replacedId: string | null,
      meta: Pick<
        Recording,
        "pieceName" | "pieceComposer" | "workName" | "sectionLabel" | "taskText"
      >
    ) => {
      const next: Recording = {
        id: saved.id,
        taskId: saved.task_id,
        pieceId: saved.piece_id,
        audioPath: saved.audio_path ?? "",
        durationSeconds: saved.duration_seconds ?? 0,
        trimStartSeconds: saved.trim_start,
        trimEndSeconds: saved.trim_end,
        audioTitle: saved.title,
        date: saved.date,
        createdAt: saved.created_at,
        ...meta,
      };
      setRecordings((prev) => [
        next,
        ...prev.filter((r) => r.id !== replacedId),
      ]);
      if (replacedId && currentId === replacedId) {
        setCurrentId(null);
        setIsPlaying(false);
      }
    },
    [currentId]
  );

  const toggleSort = useCallback(
    (key: SortKey) => {
      if (sortKey !== key) {
        setSortKey(key);
        setSortDir(key === "date" || key === "time" ? "desc" : "asc");
        return;
      }
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    },
    [sortKey]
  );

  const showFilters = pieceOptions.length > 1;

  return (
    <div className="space-y-4 pb-24">
      {(showFilters || showRecordButton) && (
        <div className="flex items-center gap-1.5">
          {showFilters && (
            <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none">
              <DropdownMenu>
                <DropdownMenuTrigger
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium whitespace-nowrap transition-colors",
                    filterKey
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground"
                  )}
                >
                  {pieceOptions.find((opt) => opt.key === filterKey)?.label ??
                    "Pieces"}
                  <ChevronDownIcon className="size-3" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="max-h-80">
                  {menuEntries.map((entry) =>
                    entry.kind === "piece" ? (
                      <DropdownMenuItem
                        key={entry.option.key}
                        onClick={() =>
                          setFilterKey((prev) =>
                            prev === entry.option.key ? null : entry.option.key
                          )
                        }
                        className={cn(filterKey === entry.option.key && "bg-accent")}
                      >
                        {entry.option.label}
                      </DropdownMenuItem>
                    ) : (
                      <DropdownMenuSub key={`work:${entry.name}`}>
                        <DropdownMenuSubTrigger
                          className={cn(
                            entry.options.some((opt) => opt.key === filterKey) &&
                              "bg-accent"
                          )}
                        >
                          {entry.name}
                        </DropdownMenuSubTrigger>
                        <DropdownMenuSubContent>
                          {entry.options.map((opt) => (
                            <DropdownMenuItem
                              key={opt.key}
                              onClick={() =>
                                setFilterKey((prev) =>
                                  prev === opt.key ? null : opt.key
                                )
                              }
                              className={cn(filterKey === opt.key && "bg-accent")}
                            >
                              {opt.label}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuSubContent>
                      </DropdownMenuSub>
                    )
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
          {showRecordButton && (
            <div className="ml-auto">
              <DropdownMenu>
                <DropdownMenuTrigger
                  className={cn(
                    "inline-flex h-8 items-center gap-1.5 rounded-md border bg-background px-3 text-xs font-medium",
                    "hover:bg-muted/60 transition-colors"
                  )}
                >
                  <MicIcon className="size-3.5" />
                  Record performance
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="max-h-80 w-56">
                  <div className="px-2 py-1.5 text-xs text-muted-foreground">
                    What are you performing?
                  </div>
                  {activePieces.map((piece) => (
                    <DropdownMenuItem
                      key={piece.id}
                      onClick={() =>
                        setRecordTarget({
                          pieceId: piece.id,
                          pieceName: piece.name,
                          pieceComposer: piece.composer,
                          workName: piece.work_id
                            ? worksById[piece.work_id] ?? null
                            : null,
                        })
                      }
                    >
                      {piece.name}
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuItem
                    onClick={() =>
                      setRecordTarget({
                        pieceId: null,
                        pieceName: null,
                        pieceComposer: null,
                        workName: null,
                      })
                    }
                  >
                    <span className="text-muted-foreground">
                      General (no piece)
                    </span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </div>
      )}

      {recordings.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          {showRecordButton
            ? "No performances yet. Use “Record performance” to capture one."
            : "No performance recordings for this piece yet."}
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          No recordings for this piece.
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden md:block overflow-hidden rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="w-10" />
                  <SortHeader
                    label="Piece"
                    active={sortKey === "piece"}
                    dir={sortDir}
                    onClick={() => toggleSort("piece")}
                  />
                  <SortHeader
                    label="Time"
                    active={sortKey === "time"}
                    dir={sortDir}
                    onClick={() => toggleSort("time")}
                    className="w-20"
                  />
                  <SortHeader
                    label="Composer"
                    active={sortKey === "composer"}
                    dir={sortDir}
                    onClick={() => toggleSort("composer")}
                  />
                  <SortHeader
                    label="Group"
                    active={sortKey === "group"}
                    dir={sortDir}
                    onClick={() => toggleSort("group")}
                  />
                  <SortHeader
                    label="Notes"
                    active={sortKey === "notes"}
                    dir={sortDir}
                    onClick={() => toggleSort("notes")}
                  />
                  <SortHeader
                    label="Date"
                    active={sortKey === "date"}
                    dir={sortDir}
                    onClick={() => toggleSort("date")}
                    className="w-32"
                  />
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {visible.map((rec) => {
                  const isCurrent = rec.id === currentId;
                  const showPause = isCurrent && isPlaying;
                  return (
                    <tr
                      key={rec.id}
                      className={cn(
                        "border-t transition-colors",
                        isCurrent
                          ? "bg-primary/5"
                          : "hover:bg-muted/30"
                      )}
                    >
                      <td className="px-2 py-2">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => handlePlayRow(rec)}
                          aria-label={showPause ? "Pause" : "Play"}
                          title={showPause ? "Pause" : "Play"}
                        >
                          {showPause ? <PauseIcon /> : <PlayIcon />}
                        </Button>
                      </td>
                      <td className="px-3 py-2 truncate max-w-[14rem]">
                        {rec.pieceName ?? (
                          <span className="text-muted-foreground">General</span>
                        )}
                      </td>
                      <td className="px-3 py-2 tabular-nums text-muted-foreground">
                        {formatDuration(rec.durationSeconds)}
                      </td>
                      <td className="px-3 py-2 truncate max-w-[12rem] text-muted-foreground">
                        {rec.pieceComposer ?? ""}
                      </td>
                      <td className="px-3 py-2 truncate max-w-[12rem] text-muted-foreground">
                        {rec.workName ?? ""}
                      </td>
                      <td className="px-3 py-2 max-w-[16rem]">
                        <NotesCell
                          rec={rec}
                          onSaved={(t) => handleTitleSaved(rec.id, t)}
                        />
                      </td>
                      <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">
                        {formatDate(rec.date)}
                      </td>
                      <td className="px-2 py-2 text-right">
                        <RowMenu
                          rec={rec}
                          onDeleted={() => handleDeleted(rec.id)}
                          onEditTrim={() => setTrimDialogId(rec.id)}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile card list */}
          <ul className="md:hidden space-y-2">
            {visible.map((rec) => {
              const isCurrent = rec.id === currentId;
              const showPause = isCurrent && isPlaying;
              return (
                <li
                  key={rec.id}
                  className={cn(
                    "rounded-lg border p-3 transition-colors",
                    isCurrent ? "border-primary/60 bg-primary/5" : "bg-card"
                  )}
                >
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="icon-sm"
                      onClick={() => handlePlayRow(rec)}
                      aria-label={showPause ? "Pause" : "Play"}
                      title={showPause ? "Pause" : "Play"}
                    >
                      {showPause ? <PauseIcon /> : <PlayIcon />}
                    </Button>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">
                        {rec.pieceName ?? "General"}
                      </div>
                      <NotesCell
                        rec={rec}
                        onSaved={(t) => handleTitleSaved(rec.id, t)}
                      />
                    </div>
                    <RowMenu
                      rec={rec}
                      onDeleted={() => handleDeleted(rec.id)}
                      onEditTrim={() => setTrimDialogId(rec.id)}
                    />
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                    {rec.pieceComposer && (
                      <span className="truncate">{rec.pieceComposer}</span>
                    )}
                    {rec.workName && (
                      <>
                        <span aria-hidden>·</span>
                        <span className="truncate">{rec.workName}</span>
                      </>
                    )}
                    <span aria-hidden>·</span>
                    <span className="whitespace-nowrap">
                      {formatDate(rec.date)}
                    </span>
                    <span aria-hidden>·</span>
                    <span className="tabular-nums whitespace-nowrap">
                      {formatDuration(rec.durationSeconds)}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}

      <RecordingsPlayerBar
        recording={currentRecording}
        isPlaying={isPlaying}
        onPlayingChange={setIsPlaying}
        onClose={() => {
          setCurrentId(null);
          setIsPlaying(false);
        }}
      />

      {/* Fresh performance from the tab: no task, piece from the picker. */}
      {recordTarget && (
        <TaskAudioDialog
          kind="performance"
          taskId={null}
          pieceId={recordTarget.pieceId}
          recordingId={null}
          open
          onOpenChange={(open) => {
            if (!open) setRecordTarget(null);
          }}
          initialMode="record"
          existingAudioPath={null}
          existingDurationSeconds={null}
          existingTrimStartSeconds={null}
          existingTrimEndSeconds={null}
          existingAudioTitle={null}
          pieceName={recordTarget.pieceName}
          sectionLabel={null}
          taskText="Performance"
          onSaved={(saved, replacedId) =>
            handleSaved(saved, replacedId, {
              pieceName: recordTarget.pieceName,
              pieceComposer: recordTarget.pieceComposer,
              workName: recordTarget.workName,
              sectionLabel: null,
              taskText: null,
            })
          }
        />
      )}

      {trimDialogRec && (
        <TaskAudioDialog
          kind="performance"
          taskId={trimDialogRec.taskId}
          pieceId={trimDialogRec.pieceId}
          recordingId={trimDialogRec.id}
          open={trimDialogId !== null}
          onOpenChange={(open) => {
            if (!open) setTrimDialogId(null);
          }}
          initialMode="playback"
          existingAudioPath={trimDialogRec.audioPath}
          existingDurationSeconds={trimDialogRec.durationSeconds}
          existingTrimStartSeconds={trimDialogRec.trimStartSeconds}
          existingTrimEndSeconds={trimDialogRec.trimEndSeconds}
          existingAudioTitle={trimDialogRec.audioTitle}
          pieceName={trimDialogRec.pieceName}
          sectionLabel={trimDialogRec.sectionLabel}
          taskText={trimDialogRec.taskText}
          onSaved={(saved, replacedId) =>
            handleSaved(saved, replacedId, {
              pieceName: trimDialogRec.pieceName,
              pieceComposer: trimDialogRec.pieceComposer,
              workName: trimDialogRec.workName,
              sectionLabel: trimDialogRec.sectionLabel,
              taskText: trimDialogRec.taskText,
            })
          }
          onTrimUpdated={(start, end) =>
            handleTrimUpdated(trimDialogRec.id, start, end)
          }
          onTitleUpdated={(title) =>
            handleTitleSaved(trimDialogRec.id, title)
          }
          onDeleted={() => handleDeleted(trimDialogRec.id)}
        />
      )}
    </div>
  );
}

function SortHeader({
  label,
  active,
  dir,
  onClick,
  className,
}: {
  label: string;
  active: boolean;
  dir: SortDir;
  onClick: () => void;
  className?: string;
}) {
  return (
    <th className={cn("px-3 py-2 text-left font-medium", className)}>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "inline-flex items-center gap-1 text-xs uppercase tracking-wide",
          active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
        )}
      >
        <span>{label}</span>
        {active &&
          (dir === "asc" ? (
            <ArrowUpIcon className="size-3" />
          ) : (
            <ArrowDownIcon className="size-3" />
          ))}
      </button>
    </th>
  );
}

function recordingDefaultTitle(rec: Recording): string {
  return formatNotesDefault(rec.sectionLabel, rec.taskText);
}

function NotesCell({
  rec,
  onSaved,
}: {
  rec: Recording;
  onSaved: (nextTitle: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const defaultTitle = recordingDefaultTitle(rec);

  const startEditing = (e: React.MouseEvent) => {
    e.stopPropagation();
    setValue(rec.audioTitle ?? "");
    setEditing(true);
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      el.select();
    });
  };

  const commit = async () => {
    const trimmed = value.trim();
    const next = trimmed ? trimmed : null;
    setEditing(false);
    if (next === (rec.audioTitle ?? null)) return;
    setSaving(true);
    try {
      await updateRecordingTitle(rec.id, next);
      onSaved(next);
    } catch {
      // Leave local state alone; user can retry.
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onClick={(e) => e.stopPropagation()}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.blur();
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            setEditing(false);
          }
        }}
        placeholder={defaultTitle || "Add a note"}
        aria-label="Recording note"
        className="-mx-1 w-full rounded-sm bg-transparent px-1 text-sm outline-none ring-1 ring-ring/40 focus:ring-ring"
      />
    );
  }

  const display = rec.audioTitle;
  return (
    <button
      type="button"
      onClick={startEditing}
      disabled={saving}
      title="Edit note"
      className={cn(
        "-mx-1 block w-full truncate rounded-sm px-1 text-left hover:bg-muted/60 disabled:opacity-60",
        display ? "text-foreground" : "text-muted-foreground italic"
      )}
    >
      {display || "Add a note"}
    </button>
  );
}

function RowMenu({
  rec,
  onDeleted,
  onEditTrim,
}: {
  rec: Recording;
  onDeleted: () => void;
  onEditTrim: () => void;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const onDownload = async () => {
    setOpen(false);
    try {
      const signedUrl = await createSignedPlaybackUrl(rec.audioPath);
      const res = await fetch(signedUrl);
      if (!res.ok) throw new Error(`Download failed (${res.status})`);
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const basename = rec.audioPath.split("/").pop() ?? "recording";
      const ext = basename.includes(".") ? basename.split(".").pop()! : "webm";
      const name = buildDownloadFilename(rec)
        ? `${buildDownloadFilename(rec)}.${ext}`
        : basename;
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
    } catch {
      // Silent — surfacing this in the row UI would be noisy.
    }
  };

  const onDelete = async () => {
    setOpen(false);
    try {
      const result = await deleteRecording(rec.id);
      if (result.ok) onDeleted();
    } catch {
      // No-op; UI stays as-is.
    }
  };

  return (
    <>
      <Button
        ref={triggerRef}
        variant="ghost"
        size="icon-sm"
        onClick={() => setOpen((o) => !o)}
        aria-label="Recording options"
      >
        <MoreVerticalIcon />
      </Button>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuContent
          anchor={triggerRef}
          align="end"
          side="bottom"
          className="w-40"
        >
          <DropdownMenuItem
            onClick={() => {
              setOpen(false);
              onEditTrim();
            }}
          >
            <Scissors />
            Edit trim
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onDownload}>
            <DownloadIcon />
            Download
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onClick={onDelete}>
            <Trash2Icon />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
