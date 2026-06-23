"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CircleIcon,
  LinkIcon,
  MoreVerticalIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent } from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { YouTubePlayer } from "@/components/video/youtube-player";
import { useVideo } from "@/components/video/video-context";
import {
  getSections,
  createSection,
  updateSectionStatus,
  updateSectionTargetTempo,
  updateSectionName,
  updateSectionNotes,
  updatePieceTargetTempo,
  deleteSection,
} from "@/app/practice/repertoire/section-actions";
import {
  createVideo,
  deleteTimestamp,
  getVideos,
  getTimestamps,
  updateVideoTimeRange,
  upsertTimestamp,
} from "@/app/practice/repertoire/video-actions";
import type {
  PieceSectionWithChildren,
  PieceSection,
  PieceVideo,
  PieceSectionTimestamp,
  SectionStatus,
} from "@/lib/types";
import {
  SECTION_STATUS_LABELS,
  SECTION_STATUS_DOT_COLORS,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import { extractYouTubeId } from "@/lib/youtube";
import {
  nextSectionLetter,
  nextSubsectionLabel,
} from "@/lib/practice/section-labels";

/* ---------------------------- helpers ---------------------------- */

function formatMMSS(seconds: number | null): string {
  if (seconds == null) return "";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function parseMMSS(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(":");
  if (parts.length === 2) {
    const m = parseInt(parts[0], 10);
    const s = parseInt(parts[1], 10);
    if (isNaN(m) || isNaN(s)) return null;
    return m * 60 + s;
  }
  const n = parseFloat(trimmed);
  return isNaN(n) ? null : n;
}

type FlatRow = {
  section: PieceSection;
  parent: PieceSectionWithChildren;
};

function buildFlatRows(sections: PieceSectionWithChildren[]): FlatRow[] {
  const rows: FlatRow[] = [];
  for (const s of sections) {
    if (s.children.length > 0) {
      for (const child of s.children) {
        rows.push({ section: child, parent: s });
      }
    } else {
      rows.push({ section: s, parent: s });
    }
  }
  return rows;
}

/* Shared grid: status | label | name | timestamp(+play+Mark) | tempo | notes */
const GRID_COLS =
  "grid grid-cols-[20px_40px_minmax(120px,1.4fr)_104px_76px_minmax(160px,2fr)] items-stretch text-xs";

const CELL_BASE =
  "flex items-center min-w-0 px-2 py-1.5 border-b border-l border-border/60";

/* --------------------------- Section row --------------------------- */

function SectionRow({
  section,
  isFirst,
  pieceTargetTempo,
  hasVideo,
  videoId,
  timestamp,
  playingSectionId,
  onStatusCycle,
  onDelete,
  onAddSubsection,
  onTempoChange,
  onNameChange,
  onNotesChange,
  onTimestampUpdated,
}: {
  section: PieceSection;
  isFirst: boolean;
  pieceTargetTempo: number | null;
  hasVideo: boolean;
  videoId: string | null;
  timestamp: PieceSectionTimestamp | undefined;
  playingSectionId: string | null;
  onStatusCycle: () => void;
  onDelete: () => void;
  onAddSubsection: () => void;
  onTempoChange: (tempo: number | null) => void;
  onNameChange: (name: string | null) => void;
  onNotesChange: (notes: string | null) => void;
  onTimestampUpdated: () => void;
}) {
  const video = useVideo();
  const { currentTime } = video;
  const effectiveTempo = section.target_tempo ?? pieceTargetTempo;

  /* Tempo */
  const [editingTempo, setEditingTempo] = useState(false);
  const [tempoValue, setTempoValue] = useState(
    String(section.target_tempo ?? "")
  );

  /* Timestamp */
  const [tsValue, setTsValue] = useState(
    formatMMSS(timestamp?.start_seconds ?? null)
  );
  const [prevTsStart, setPrevTsStart] = useState<number | null | undefined>(
    timestamp?.start_seconds
  );
  if (timestamp?.start_seconds !== prevTsStart) {
    setPrevTsStart(timestamp?.start_seconds);
    setTsValue(formatMMSS(timestamp?.start_seconds ?? null));
  }

  /* Name */
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState(section.name ?? "");
  const [prevServerName, setPrevServerName] = useState(section.name ?? "");
  if ((section.name ?? "") !== prevServerName) {
    setPrevServerName(section.name ?? "");
    if (!editingName) setNameValue(section.name ?? "");
  }

  /* Notes */
  const noteInputRef = useRef<HTMLInputElement>(null);
  const noteTextareaRef = useRef<HTMLTextAreaElement>(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteValue, setNoteValue] = useState(section.notes ?? "");
  const [prevServerNotes, setPrevServerNotes] = useState(section.notes ?? "");
  if ((section.notes ?? "") !== prevServerNotes) {
    setPrevServerNotes(section.notes ?? "");
    if (!noteOpen) setNoteValue(section.notes ?? "");
  }

  /* Menu */
  const [menuOpen, setMenuOpen] = useState(false);

  const autoGrowNote = useCallback(() => {
    const el = noteTextareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  const isNoteOverflowing = useCallback(() => {
    const el = noteInputRef.current;
    if (!el) return false;
    return el.scrollWidth > el.clientWidth;
  }, []);

  const openNotePopover = useCallback(() => {
    setNoteOpen(true);
    requestAnimationFrame(() => {
      const el = noteTextareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
      autoGrowNote();
    });
  }, [autoGrowNote]);

  const commitNotes = () => {
    const next = noteValue.trim() ? noteValue : null;
    if (next !== (section.notes ?? null)) onNotesChange(next);
  };

  const handleNoteOpenChange = (open: boolean) => {
    if (!open) {
      commitNotes();
      setNoteOpen(false);
    }
  };

  const handleInlineNoteChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setNoteValue(e.target.value);
    requestAnimationFrame(() => {
      if (isNoteOverflowing()) openNotePopover();
    });
  };

  const handleInlineNoteClick = () => {
    if (isNoteOverflowing()) openNotePopover();
  };

  const handleInlineNoteBlur = () => {
    if (noteOpen) return;
    commitNotes();
  };

  const handleInlineNoteKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement>
  ) => {
    if (e.key === "Enter" || e.key === "Escape") {
      e.preventDefault();
      e.currentTarget.blur();
    }
  };

  const commitTempo = () => {
    setEditingTempo(false);
    const parsed = tempoValue.trim() ? parseInt(tempoValue, 10) : null;
    const value = parsed && !isNaN(parsed) ? parsed : null;
    onTempoChange(value);
  };

  const commitName = () => {
    setEditingName(false);
    const trimmed = nameValue.trim();
    const next = trimmed === "" ? null : trimmed;
    if (next !== (section.name ?? null)) onNameChange(next);
  };

  const handleMark = async () => {
    if (!videoId) return;
    const rounded = Math.floor(currentTime);
    setTsValue(formatMMSS(rounded));
    await upsertTimestamp(section.id, videoId, rounded, null);
    onTimestampUpdated();
  };

  const handleBlurTimestamp = async () => {
    if (!videoId) return;
    const parsed = parseMMSS(tsValue);
    if (parsed != null) {
      await upsertTimestamp(section.id, videoId, parsed, null);
      onTimestampUpdated();
    } else if (tsValue.trim() === "" && timestamp) {
      await deleteTimestamp(section.id, videoId);
      onTimestampUpdated();
    }
  };

  const isThisSectionPlaying = playingSectionId === section.id;

  const firstBorder = isFirst && "border-t";

  return (
    <div className="group/row flex items-stretch">
      {/* Gutter — context menu */}
      <div className="-ml-8 w-8 shrink-0 flex items-center justify-center">
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger
            className={cn(
              "flex items-center justify-center w-5 h-5 rounded-sm text-muted-foreground/60 hover:text-foreground hover:bg-muted transition-all",
              menuOpen
                ? "opacity-100"
                : "opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100"
            )}
          >
            <MoreVerticalIcon className="size-3.5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="bottom" className="w-48">
            <DropdownMenuItem onClick={onAddSubsection}>
              <PlusIcon />
              Add subsection below
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={onDelete}>
              <Trash2Icon />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Row grid */}
      <div className={cn("flex-1 min-w-0", GRID_COLS)}>
        {/* Status dot */}
        <div
          className={cn(CELL_BASE, firstBorder, "justify-center")}
        >
          <Tooltip>
            <TooltipTrigger
              onClick={onStatusCycle}
              className="flex items-center justify-center"
            >
              <CircleIcon
                className={cn(
                  "size-3 fill-current",
                  SECTION_STATUS_DOT_COLORS[section.status]
                )}
              />
            </TooltipTrigger>
            <TooltipContent side="left">
              <p className="text-xs">
                {SECTION_STATUS_LABELS[section.status]}
              </p>
            </TooltipContent>
          </Tooltip>
        </div>

        {/* Label */}
        <div className={cn(CELL_BASE, firstBorder)}>
          <span className="font-medium">{section.label}</span>
        </div>

        {/* Name */}
        <div className={cn(CELL_BASE, firstBorder)}>
          {editingName ? (
            <Input
              value={nameValue}
              onChange={(e) => setNameValue(e.target.value)}
              onBlur={commitName}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitName();
                if (e.key === "Escape") {
                  setEditingName(false);
                  setNameValue(section.name ?? "");
                }
              }}
              autoFocus
              placeholder="Name"
              className="h-6 text-xs px-1.5"
            />
          ) : (
            <button
              onClick={() => {
                setNameValue(section.name ?? "");
                setEditingName(true);
              }}
              className={cn(
                "w-full min-w-0 text-left truncate rounded-sm hover:bg-muted/40 transition-colors",
                section.name
                  ? "text-foreground"
                  : "text-muted-foreground/50"
              )}
            >
              {section.name || "—"}
            </button>
          )}
        </div>

        {/* Timestamp: Mark button (unset) OR play + editable value (set) */}
        <div className={cn(CELL_BASE, firstBorder, "gap-1 justify-end")}>
          {hasVideo ? (
            timestamp ? (
              <>
                <button
                  onClick={() => {
                    if (isThisSectionPlaying) {
                      video.pause();
                    } else {
                      video.seekTo(timestamp.start_seconds);
                      video.play();
                    }
                  }}
                  className={cn(
                    "shrink-0 flex items-center justify-center rounded transition-colors",
                    isThisSectionPlaying
                      ? "text-primary"
                      : "text-muted-foreground/40 hover:text-foreground"
                  )}
                >
                  {isThisSectionPlaying ? (
                    <PauseIcon className="size-3" />
                  ) : (
                    <PlayIcon className="size-3" />
                  )}
                </button>
                <input
                  value={tsValue}
                  onChange={(e) => setTsValue(e.target.value)}
                  onBlur={handleBlurTimestamp}
                  placeholder="—"
                  size={1}
                  className="bg-transparent font-mono tabular-nums text-xs focus:outline-none placeholder:text-muted-foreground/40 [field-sizing:content] min-w-[1ch]"
                />
              </>
            ) : (
              <button
                onClick={handleMark}
                className="shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                Mark
              </button>
            )
          ) : (
            <span className="text-muted-foreground/30">—</span>
          )}
        </div>

        {/* Tempo */}
        <div className={cn(CELL_BASE, firstBorder, "justify-end")}>
          {editingTempo ? (
            <Input
              type="number"
              value={tempoValue}
              onChange={(e) => setTempoValue(e.target.value)}
              onBlur={commitTempo}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitTempo();
                if (e.key === "Escape") {
                  setEditingTempo(false);
                  setTempoValue(String(section.target_tempo ?? ""));
                }
              }}
              className="h-6 w-full text-xs px-1 text-right"
              autoFocus
              min={20}
              max={300}
              placeholder={effectiveTempo ? String(effectiveTempo) : "—"}
            />
          ) : (
            <button
              onClick={() => {
                setTempoValue(String(section.target_tempo ?? ""));
                setEditingTempo(true);
              }}
              className={cn(
                "font-mono tabular-nums px-1 py-0.5 rounded hover:bg-muted transition-colors",
                section.target_tempo
                  ? "text-foreground"
                  : "text-muted-foreground"
              )}
            >
              {section.target_tempo
                ? `♩ ${section.target_tempo}`
                : effectiveTempo
                  ? `♩ ${effectiveTempo}`
                  : "—"}
            </button>
          )}
        </div>

        {/* Notes */}
        <div
          className={cn(
            CELL_BASE,
            firstBorder,
            "border-r border-r-border/60"
          )}
        >
          <Popover open={noteOpen} onOpenChange={handleNoteOpenChange}>
            <input
              ref={noteInputRef}
              type="text"
              value={noteValue}
              onChange={handleInlineNoteChange}
              onClick={handleInlineNoteClick}
              onBlur={handleInlineNoteBlur}
              onKeyDown={handleInlineNoteKeyDown}
              placeholder="Notes..."
              className="block w-full min-w-0 bg-transparent text-left leading-tight focus:outline-none cursor-text text-ellipsis text-muted-foreground placeholder:text-muted-foreground/50"
            />
            <PopoverContent
              anchor={noteInputRef}
              align="start"
              side="bottom"
              sideOffset={-28}
              className="min-w-[320px] max-w-[520px] p-2 gap-0"
            >
              <textarea
                ref={noteTextareaRef}
                value={noteValue}
                onChange={(e) => {
                  setNoteValue(e.target.value);
                  autoGrowNote();
                }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.preventDefault();
                    handleNoteOpenChange(false);
                  } else if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleNoteOpenChange(false);
                  }
                }}
                placeholder="Notes..."
                rows={1}
                className="w-full bg-transparent focus:outline-none resize-none leading-tight text-xs text-foreground placeholder:text-muted-foreground/50"
              />
            </PopoverContent>
          </Popover>
        </div>
      </div>
    </div>
  );
}

/* ------------------- Video boundary row (Start / End) ------------------- */

function VideoBoundaryRow({
  label,
  isFirst,
  video,
  field,
  onUpdated,
}: {
  label: string;
  isFirst: boolean;
  video: PieceVideo;
  field: "start" | "end";
  onUpdated: () => void;
}) {
  const { currentTime } = useVideo();
  const seconds = field === "start" ? video.start_seconds : video.end_seconds;
  const [value, setValue] = useState(formatMMSS(seconds));
  const [prevSeconds, setPrevSeconds] = useState<number | null>(seconds);
  if (seconds !== prevSeconds) {
    setPrevSeconds(seconds);
    setValue(formatMMSS(seconds));
  }

  const save = async (val: number | null) => {
    if (field === "start") {
      await updateVideoTimeRange(video.id, val, video.end_seconds);
    } else {
      await updateVideoTimeRange(video.id, video.start_seconds, val);
    }
    onUpdated();
  };

  const handleMark = () => {
    const rounded =
      field === "start" ? Math.floor(currentTime) : Math.ceil(currentTime);
    setValue(formatMMSS(rounded));
    save(rounded);
  };

  const handleBlur = () => {
    save(parseMMSS(value));
  };

  const firstBorder = isFirst && "border-t";

  return (
    <div className="flex items-stretch text-muted-foreground/70">
      {/* gutter spacer */}
      <div className="-ml-8 w-8 shrink-0" />
      <div className={cn("flex-1 min-w-0", GRID_COLS)}>
        <div className={cn(CELL_BASE, firstBorder)} />
        <div className={cn(CELL_BASE, firstBorder)}>
          <span className="italic">{label}</span>
        </div>
        <div className={cn(CELL_BASE, firstBorder)} />
        <div
          className={cn(CELL_BASE, firstBorder, "gap-1 justify-end")}
        >
          {seconds != null ? (
            <input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onBlur={handleBlur}
              placeholder={field === "start" ? "0:00" : "end"}
              size={1}
              className="bg-transparent font-mono tabular-nums text-xs focus:outline-none placeholder:text-muted-foreground/40 [field-sizing:content] min-w-[1ch]"
            />
          ) : (
            <button
              onClick={handleMark}
              className="shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded hover:bg-muted hover:text-foreground transition-colors"
            >
              Mark
            </button>
          )}
        </div>
        <div className={cn(CELL_BASE, firstBorder)} />
        <div
          className={cn(CELL_BASE, firstBorder, "border-r border-r-border/60")}
        />
      </div>
    </div>
  );
}

/* ----------------------------- Main component ----------------------------- */

export function SectionEditor({
  pieceId,
  pieceTargetTempo,
  initialSections,
  initialVideos,
  initialTimestamps,
}: {
  pieceId: string;
  pieceTargetTempo: number | null;
  initialSections: PieceSectionWithChildren[];
  initialVideos: PieceVideo[];
  initialTimestamps: PieceSectionTimestamp[];
}) {
  const videoCtx = useVideo();
  const [sections, setSections] = useState(initialSections);
  const [targetTempo, setTargetTempo] = useState(pieceTargetTempo);
  const [editingTempo, setEditingTempo] = useState(false);
  const [tempoValue, setTempoValue] = useState(
    String(pieceTargetTempo ?? "")
  );

  const [videos, setVideos] = useState(initialVideos);
  const [timestamps, setTimestamps] = useState(initialTimestamps);
  const activeVideo = videos[0] ?? null;
  const hasVideo = activeVideo !== null;

  const [videoUrl, setVideoUrl] = useState("");
  const [addingVideo, setAddingVideo] = useState(false);

  const playingSectionId = (() => {
    if (!videoCtx.isPlaying) return null;
    let best: { sectionId: string; start: number } | null = null;
    for (const ts of timestamps) {
      if (ts.start_seconds <= videoCtx.currentTime) {
        if (!best || ts.start_seconds > best.start) {
          best = { sectionId: ts.section_id, start: ts.start_seconds };
        }
      }
    }
    return best?.sectionId ?? null;
  })();

  useEffect(() => {
    if (activeVideo) {
      videoCtx.setVideo(
        activeVideo.youtube_video_id,
        activeVideo.start_seconds,
        activeVideo.end_seconds
      );
    }
    return () => {
      videoCtx.clearVideo();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeVideo?.id]);

  const refreshSections = useCallback(async () => {
    const newSections = await getSections(pieceId);
    setSections(newSections);
  }, [pieceId]);

  const refreshVideo = useCallback(async () => {
    const newVideos = await getVideos(pieceId);
    setVideos(newVideos);
    if (newVideos[0]) {
      const newTimestamps = await getTimestamps(newVideos[0].id);
      setTimestamps(newTimestamps);
      videoCtx.setVideo(
        newVideos[0].youtube_video_id,
        newVideos[0].start_seconds,
        newVideos[0].end_seconds
      );
    } else {
      setTimestamps([]);
      videoCtx.clearVideo();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pieceId]);

  const refreshTimestamps = useCallback(async () => {
    if (!activeVideo) return;
    const newTimestamps = await getTimestamps(activeVideo.id);
    setTimestamps(newTimestamps);
  }, [activeVideo]);

  useEffect(() => {
    const handler = () => refreshSections();
    window.addEventListener("sections-changed", handler);
    return () => window.removeEventListener("sections-changed", handler);
  }, [refreshSections]);

  // The overflow menu (in PieceDetailView) can remove the video; re-sync when it does.
  useEffect(() => {
    const handler = () => refreshVideo();
    window.addEventListener("piece-video-changed", handler);
    return () => window.removeEventListener("piece-video-changed", handler);
  }, [refreshVideo]);

  useEffect(() => {
    const handler = (e: Event) => {
      const { sectionId, status } = (e as CustomEvent).detail;
      setSections((prev) =>
        prev.map((s) => {
          if (s.id === sectionId) return { ...s, status };
          return {
            ...s,
            children: s.children.map((c) =>
              c.id === sectionId ? { ...c, status } : c
            ),
          };
        })
      );
    };
    window.addEventListener("section-status-changed", handler);
    return () =>
      window.removeEventListener("section-status-changed", handler);
  }, []);

  const dispatchSectionsChanged = () => {
    window.dispatchEvent(new CustomEvent("sections-changed"));
  };

  const handleAddSection = async () => {
    const label = nextSectionLetter(sections);
    await createSection(pieceId, label);
    await refreshSections();
    dispatchSectionsChanged();
  };

  const handleAddSubsection = async (parent: PieceSectionWithChildren) => {
    if (parent.children.length === 0) {
      const result1 = await createSection(
        pieceId,
        `${parent.label}1`,
        parent.id
      );
      if (result1.success && result1.id) {
        if (parent.status !== 0) {
          await updateSectionStatus(
            result1.id,
            parent.status as SectionStatus,
            { pieceId, skipSnapshot: true }
          );
        }
        if (parent.target_tempo !== null) {
          await updateSectionTargetTempo(result1.id, parent.target_tempo);
        }
        const parentTs = timestamps.find((t) => t.section_id === parent.id);
        if (parentTs && activeVideo) {
          await upsertTimestamp(
            result1.id,
            activeVideo.id,
            parentTs.start_seconds,
            null
          );
        }
      }
      await createSection(pieceId, `${parent.label}2`, parent.id);
    } else {
      const label = nextSubsectionLabel(parent.label, parent.children.length);
      await createSection(pieceId, label, parent.id);
    }
    await refreshSections();
    if (hasVideo) await refreshTimestamps();
    dispatchSectionsChanged();
  };

  const handleDelete = async (sectionId: string) => {
    setSections((prev) =>
      prev
        .filter((s) => s.id !== sectionId)
        .map((s) => ({
          ...s,
          children: s.children.filter((c) => c.id !== sectionId),
        }))
    );
    await deleteSection(sectionId);

    const newSections = await getSections(pieceId);
    for (const parent of newSections) {
      if (parent.children.length === 1) {
        const remaining = parent.children[0];
        await updateSectionStatus(
          parent.id,
          remaining.status as SectionStatus,
          { pieceId, skipSnapshot: true }
        );
        await updateSectionTargetTempo(parent.id, remaining.target_tempo);
        if (activeVideo) {
          const childTs = timestamps.find(
            (t) => t.section_id === remaining.id
          );
          if (childTs) {
            await upsertTimestamp(
              parent.id,
              activeVideo.id,
              childTs.start_seconds,
              null
            );
          }
        }
        await deleteSection(remaining.id);
      }
    }

    await refreshSections();
    if (hasVideo) await refreshTimestamps();
    dispatchSectionsChanged();
  };

  const handleStatusCycle = (section: PieceSection) => {
    const next = ((section.status + 1) % 9) as SectionStatus;
    setSections((prev) =>
      prev.map((s) => {
        if (s.id === section.id) return { ...s, status: next };
        return {
          ...s,
          children: s.children.map((c) =>
            c.id === section.id ? { ...c, status: next } : c
          ),
        };
      })
    );
    updateSectionStatus(section.id, next, { pieceId });
    window.dispatchEvent(
      new CustomEvent("section-status-changed", {
        detail: { sectionId: section.id, status: next },
      })
    );
  };

  const handleTempoChange = (section: PieceSection, tempo: number | null) => {
    setSections((prev) =>
      prev.map((s) => {
        if (s.id === section.id) return { ...s, target_tempo: tempo };
        return {
          ...s,
          children: s.children.map((c) =>
            c.id === section.id ? { ...c, target_tempo: tempo } : c
          ),
        };
      })
    );
    updateSectionTargetTempo(section.id, tempo);
    dispatchSectionsChanged();
  };

  const handleNameChange = (section: PieceSection, name: string | null) => {
    setSections((prev) =>
      prev.map((s) => {
        if (s.id === section.id) return { ...s, name };
        return {
          ...s,
          children: s.children.map((c) =>
            c.id === section.id ? { ...c, name } : c
          ),
        };
      })
    );
    updateSectionName(section.id, name);
  };

  const handleNotesChange = (section: PieceSection, notes: string | null) => {
    setSections((prev) =>
      prev.map((s) => {
        if (s.id === section.id) return { ...s, notes };
        return {
          ...s,
          children: s.children.map((c) =>
            c.id === section.id ? { ...c, notes } : c
          ),
        };
      })
    );
    updateSectionNotes(section.id, notes);
  };

  const handleSavePieceTempo = () => {
    setEditingTempo(false);
    const parsed = tempoValue.trim() ? parseInt(tempoValue, 10) : null;
    const value = parsed && !isNaN(parsed) ? parsed : null;
    setTargetTempo(value);
    updatePieceTargetTempo(pieceId, value);
    dispatchSectionsChanged();
  };

  const handleAddVideo = async () => {
    const vid = extractYouTubeId(videoUrl);
    if (!vid) return;
    setAddingVideo(true);
    await createVideo(pieceId, vid);
    setVideoUrl("");
    setAddingVideo(false);
    await refreshVideo();
    window.dispatchEvent(new CustomEvent("piece-video-changed"));
  };

  const flatRows = buildFlatRows(sections);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Sections</h3>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Target tempo:</span>
          {editingTempo ? (
            <Input
              type="number"
              value={tempoValue}
              onChange={(e) => setTempoValue(e.target.value)}
              onBlur={handleSavePieceTempo}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSavePieceTempo();
                if (e.key === "Escape") {
                  setEditingTempo(false);
                  setTempoValue(String(targetTempo ?? ""));
                }
              }}
              className="w-20 h-7 text-xs"
              autoFocus
              min={20}
              max={300}
            />
          ) : (
            <button
              onClick={() => {
                setTempoValue(String(targetTempo ?? ""));
                setEditingTempo(true);
              }}
              className="text-xs font-mono tabular-nums px-1.5 py-0.5 rounded hover:bg-muted transition-colors"
            >
              {targetTempo ? `♩ ${targetTempo}` : "Set..."}
            </button>
          )}
        </div>
      </div>

      {/* Video panel — removal lives in the piece's overflow menu */}
      {hasVideo ? (
        <YouTubePlayer />
      ) : (
        <div className="flex items-center gap-2">
          <LinkIcon className="size-3.5 shrink-0 text-muted-foreground" />
          <Input
            value={videoUrl}
            onChange={(e) => setVideoUrl(e.target.value)}
            placeholder="YouTube URL or video ID"
            className="h-8 text-sm"
            onKeyDown={(e) => {
              if (e.key === "Enter") handleAddVideo();
            }}
          />
          <Button
            size="sm"
            variant="outline"
            onClick={handleAddVideo}
            disabled={addingVideo || !extractYouTubeId(videoUrl)}
            className="h-8"
          >
            <PlusIcon className="size-3.5 mr-1" />
            Add Video
          </Button>
        </div>
      )}

      {/* Rows — pl-8 makes room for the gutter's -ml-8 */}
      <div className="pl-8">
        {hasVideo && (
          <VideoBoundaryRow
            label="Start"
            isFirst
            video={activeVideo}
            field="start"
            onUpdated={refreshVideo}
          />
        )}

        {flatRows.map((row, idx) => (
          <SectionRow
            key={row.section.id}
            section={row.section}
            isFirst={!hasVideo && idx === 0}
            pieceTargetTempo={targetTempo}
            hasVideo={hasVideo}
            videoId={activeVideo?.id ?? null}
            timestamp={timestamps.find(
              (t) => t.section_id === row.section.id
            )}
            playingSectionId={playingSectionId}
            onStatusCycle={() => handleStatusCycle(row.section)}
            onDelete={() => handleDelete(row.section.id)}
            onAddSubsection={() => handleAddSubsection(row.parent)}
            onTempoChange={(tempo) => handleTempoChange(row.section, tempo)}
            onNameChange={(name) => handleNameChange(row.section, name)}
            onNotesChange={(notes) => handleNotesChange(row.section, notes)}
            onTimestampUpdated={refreshTimestamps}
          />
        ))}

        {hasVideo && (
          <VideoBoundaryRow
            label="End"
            isFirst={false}
            video={activeVideo}
            field="end"
            onUpdated={refreshVideo}
          />
        )}
      </div>

      <Button variant="outline" size="sm" onClick={handleAddSection}>
        <PlusIcon className="size-3.5 mr-1" />
        Add Section
      </Button>
    </div>
  );
}
