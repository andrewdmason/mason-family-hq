"use client";

import { useEffect, useRef, useState } from "react";
import { CircleIcon, MetronomeIcon } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { updateFollowUpTask } from "@/app/practice/timer/task-actions";
import {
  emitOptimisticTask,
  emitOptimisticTaskDelete,
  emitOptimisticTaskRename,
  emitOptimisticTaskUpdate,
  rollbackOptimisticTask,
} from "@/lib/optimistic-task";
import {
  getCachedSectionPickerData,
  loadSectionPickerData,
  type SectionPickerData,
} from "@/lib/section-picker-cache";
import {
  SECTION_STATUS_DOT_COLORS,
  type PieceSection,
  type PieceKind,
  type SectionStatus,
} from "@/lib/types";
import { practiceTempo } from "@/lib/section-utils";
import { cn } from "@/lib/utils";

const GOAL_PRESETS = [5, 10, 15, 20, 30, 45, 60];

export type FollowUpDefaults = {
  pieceId: string | null;
  pieceName: string | null;
  pieceComposer: string | null;
  pieceKind: PieceKind | null;
  sectionId: string | null;
  sectionLabel: string | null;
  sectionStatus: SectionStatus | null;
  metronomeSpeed: number | null;
  timerSeconds: number;
  text: string;
};


/**
 * Edits a follow-up item that already exists. Archiving with the repeat action
 * creates tomorrow's copy outright and only offers this sheet through the
 * confirmation toast, so the sheet's job is to amend that copy — never to
 * create a second one.
 */
export function FollowUpDialog({
  open,
  onOpenChange,
  taskId,
  defaults,
  initialDate,
  tomorrowDate,
  dayAfterDate,
  tomorrowSessions,
  dayAfterSessions,
  defaultSessionNumber,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  taskId: string;
  defaults: FollowUpDefaults;
  initialDate: string;
  tomorrowDate: string;
  dayAfterDate: string;
  tomorrowSessions: number[];
  dayAfterSessions: number[];
  defaultSessionNumber: number;
}) {
  const [text, setText] = useState(defaults.text);
  const [metronomeSpeed, setMetronomeSpeed] = useState<number | null>(
    defaults.metronomeSpeed
  );
  const [metronomeInput, setMetronomeInput] = useState(
    defaults.metronomeSpeed?.toString() ?? ""
  );
  const [timerSeconds, setTimerSeconds] = useState(defaults.timerSeconds);
  const [targetDate, setTargetDate] = useState<string>(initialDate);
  const [sessionNumber, setSessionNumber] = useState<number>(
    defaultSessionNumber
  );
  const [section, setSection] = useState<{
    sectionId: string | null;
    sectionLabel: string | null;
    sectionStatus: SectionStatus | null;
  }>({
    sectionId: defaults.sectionId,
    sectionLabel: defaults.sectionLabel,
    sectionStatus: defaults.sectionStatus,
  });
  const [sectionPickerOpen, setSectionPickerOpen] = useState(false);
  const [sectionData, setSectionPickerData] = useState<SectionPickerData | null>(
    defaults.pieceId ? getCachedSectionPickerData(defaults.pieceId) : null
  );
  const noteRef = useRef<HTMLTextAreaElement>(null);
  // Parent re-renders every second while a timer is running, which would
  // remount `defaults` on every render and re-run the open effect — stealing
  // focus back to the note. Read defaults via a ref so the reset/focus only
  // runs on the open transition itself.
  const defaultsRef = useRef(defaults);
  defaultsRef.current = defaults;

  useEffect(() => {
    if (!open) return;
    const d = defaultsRef.current;
    setText(d.text);
    setMetronomeSpeed(d.metronomeSpeed);
    setMetronomeInput(d.metronomeSpeed?.toString() ?? "");
    setTimerSeconds(d.timerSeconds);
    setSection({
      sectionId: d.sectionId,
      sectionLabel: d.sectionLabel,
      sectionStatus: d.sectionStatus,
    });
    setSectionPickerData(d.pieceId ? getCachedSectionPickerData(d.pieceId) : null);
    setTargetDate(initialDate);
    setSessionNumber(defaultSessionNumber);
    // base-ui's focus trap initializes after the open transition; defer focus
    // until after that so our textarea wins over the dialog's default target.
    // Select the carried-over note so the user can replace it by typing or
    // keep it by leaving alone.
    const t = setTimeout(() => {
      const el = noteRef.current;
      if (!el) return;
      el.focus();
      if (el.value.length > 0) el.select();
    }, 60);
    return () => clearTimeout(t);
  }, [open, initialDate, defaultSessionNumber]);

  // Lazy-load sections for the picker
  useEffect(() => {
    if (!open || !defaults.pieceId || sectionData) return;
    void loadSectionPickerData(defaults.pieceId).then(setSectionPickerData);
  }, [open, defaults.pieceId, sectionData]);

  const goalMinutes = Math.round(timerSeconds / 60);

  const handleSelectSection = (s: PieceSection) => {
    const effectiveTempo =
      s.target_tempo ?? sectionData?.pieceTargetTempo ?? null;
    const computed = practiceTempo(s.status, effectiveTempo);
    setSection({
      sectionId: s.id,
      sectionLabel: s.label,
      sectionStatus: s.status,
    });
    if (computed !== null) {
      setMetronomeSpeed(computed);
      setMetronomeInput(computed.toString());
    }
    setSectionPickerOpen(false);
  };

  const handleClearSection = () => {
    setSection({ sectionId: null, sectionLabel: null, sectionStatus: null });
    setSectionPickerOpen(false);
  };

  const handleMetronomeBlur = () => {
    const val = metronomeInput.trim();
    if (!val) {
      setMetronomeSpeed(null);
      return;
    }
    const num = parseInt(val, 10);
    setMetronomeSpeed(Number.isNaN(num) ? null : num);
  };

  const targetSessions =
    targetDate === dayAfterDate ? dayAfterSessions : tomorrowSessions;
  const maxExistingSession = targetSessions.length > 0
    ? Math.max(...targetSessions)
    : 0;
  const sessionPickerCount = Math.max(
    maxExistingSession + 1,
    sessionNumber,
    1
  );
  const sessionPickerNumbers = Array.from(
    { length: sessionPickerCount },
    (_, i) => i + 1
  );

  const handleSave = () => {
    onOpenChange(false);

    const edits = {
      date: targetDate,
      sessionNumber,
      sectionId: section.sectionId,
      metronomeSpeed,
      timerSeconds,
      text,
    };

    // Same day: patch the row in place. Different day: the feed keys rows by
    // day, so lift the row out and drop a copy on the new one rather than
    // leaving it stranded until revalidation.
    if (targetDate === initialDate) {
      emitOptimisticTaskUpdate(taskId, {
        session_number: sessionNumber,
        section_id: section.sectionId,
        section_label: section.sectionLabel,
        section_status: section.sectionStatus,
        metronome_speed: metronomeSpeed,
        timer_seconds: timerSeconds,
        timer_remaining_seconds: timerSeconds,
        text,
      });
      void updateFollowUpTask(taskId, edits);
      return;
    }

    emitOptimisticTaskDelete(taskId);
    const tempId = emitOptimisticTask({
      pieceId: defaults.pieceId,
      sectionId: section.sectionId,
      date: targetDate,
      text,
      metronomeSpeed,
      timerSeconds,
      pieceName: defaults.pieceName,
      pieceComposer: defaults.pieceComposer,
      pieceKind: defaults.pieceKind,
      sectionLabel: section.sectionLabel,
      sectionStatus: section.sectionStatus,
      sessionNumber,
    });
    void updateFollowUpTask(taskId, edits)
      .then(() => emitOptimisticTaskRename(tempId, taskId))
      .catch((err) => {
        rollbackOptimisticTask(tempId);
        throw err;
      });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit follow-up</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {defaults.pieceName && (
            <div className="text-sm font-medium text-foreground">
              {defaults.pieceName}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            {defaults.pieceId && (
              <Popover
                open={sectionPickerOpen}
                onOpenChange={setSectionPickerOpen}
              >
                <PopoverTrigger className="flex items-center gap-1.5 rounded border border-input bg-transparent px-2 py-1 text-xs hover:bg-muted/40 focus:outline-none focus:ring-1 focus:ring-ring">
                  {section.sectionStatus !== null && (
                    <CircleIcon
                      className={cn(
                        "size-2.5 shrink-0 fill-current",
                        SECTION_STATUS_DOT_COLORS[section.sectionStatus]
                      )}
                    />
                  )}
                  <span className="text-muted-foreground">
                    {section.sectionLabel ?? "No section"}
                  </span>
                </PopoverTrigger>
                <PopoverContent
                  align="start"
                  side="bottom"
                  sideOffset={2}
                  className="w-auto min-w-[200px] max-w-[280px] p-1 gap-0"
                >
                  <SectionPickerList
                    data={sectionData}
                    selectedSectionId={section.sectionId}
                    onSelect={handleSelectSection}
                    onClear={section.sectionId ? handleClearSection : null}
                  />
                </PopoverContent>
              </Popover>
            )}

            <div className="flex items-center gap-1 rounded border border-input px-2 py-1 focus-within:ring-1 focus-within:ring-ring">
              <MetronomeIcon className="size-3 text-muted-foreground" />
              <input
                type="text"
                inputMode="numeric"
                value={metronomeInput}
                onChange={(e) => setMetronomeInput(e.target.value)}
                onBlur={handleMetronomeBlur}
                placeholder="—"
                aria-label="Metronome BPM"
                className="w-12 bg-transparent text-xs tabular-nums focus:outline-none"
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">When</span>
            <div className="flex flex-wrap gap-1">
              <button
                type="button"
                onClick={() => setTargetDate(tomorrowDate)}
                className={cn(
                  "rounded px-2 py-1 text-xs transition-colors",
                  targetDate === tomorrowDate
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted-foreground/20 hover:text-foreground"
                )}
              >
                Tomorrow
              </button>
              <button
                type="button"
                onClick={() => setTargetDate(dayAfterDate)}
                className={cn(
                  "rounded px-2 py-1 text-xs transition-colors",
                  targetDate === dayAfterDate
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted-foreground/20 hover:text-foreground"
                )}
              >
                Day after
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">Session</span>
            <div className="flex flex-wrap gap-1">
              {sessionPickerNumbers.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setSessionNumber(n)}
                  className={cn(
                    "rounded px-2 py-1 text-xs tabular-nums transition-colors",
                    sessionNumber === n
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:bg-muted-foreground/20 hover:text-foreground"
                  )}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">Time goal</span>
            <div className="flex flex-wrap gap-1">
              <button
                type="button"
                onClick={() => setTimerSeconds(0)}
                className={cn(
                  "rounded px-2 py-1 text-xs tabular-nums transition-colors",
                  goalMinutes === 0
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted-foreground/20 hover:text-foreground"
                )}
              >
                None
              </button>
              {GOAL_PRESETS.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setTimerSeconds(m * 60)}
                  className={cn(
                    "rounded px-2 py-1 text-xs tabular-nums transition-colors",
                    m === goalMinutes
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:bg-muted-foreground/20 hover:text-foreground"
                  )}
                >
                  {m}m
                </button>
              ))}
              {goalMinutes > 0 && !GOAL_PRESETS.includes(goalMinutes) && (
                <span className="rounded bg-primary px-2 py-1 text-xs tabular-nums text-primary-foreground">
                  {goalMinutes}m
                </span>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">Note</span>
            <textarea
              ref={noteRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  handleSave();
                }
              }}
              placeholder="What to focus on next time…"
              rows={3}
              className="w-full rounded border border-input bg-transparent px-2 py-1.5 text-sm placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring resize-none"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SectionPickerList({
  data,
  selectedSectionId,
  onSelect,
  onClear,
}: {
  data: SectionPickerData | null;
  selectedSectionId: string | null;
  onSelect: (section: PieceSection) => void;
  onClear: (() => void) | null;
}) {
  if (!data) {
    return (
      <div className="px-2 py-1.5 text-xs text-muted-foreground">Loading…</div>
    );
  }
  if (data.sections.length === 0) {
    return (
      <div className="px-2 py-1.5 text-xs text-muted-foreground">
        No sections
      </div>
    );
  }
  return (
    <ul className="flex flex-col">
      {onClear && (
        <li>
          <button
            type="button"
            onClick={onClear}
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1 text-xs text-left text-muted-foreground hover:bg-muted"
          >
            No section
          </button>
        </li>
      )}
      {data.sections.map((section) => {
        const effectiveTempo =
          section.target_tempo ?? data.pieceTargetTempo ?? null;
        const tempo = practiceTempo(section.status, effectiveTempo);
        const isSelected = section.id === selectedSectionId;
        return (
          <li key={section.id}>
            <button
              type="button"
              onClick={() => onSelect(section)}
              className={cn(
                "flex w-full items-center gap-2 rounded-sm px-2 py-1 text-xs text-left hover:bg-muted",
                isSelected && "bg-muted/60"
              )}
            >
              <CircleIcon
                className={cn(
                  "size-2.5 shrink-0 fill-current",
                  SECTION_STATUS_DOT_COLORS[section.status]
                )}
              />
              <span className="flex-1 truncate font-medium text-foreground">
                {section.label}
              </span>
              <span className="shrink-0 font-mono text-[10px] text-muted-foreground tabular-nums">
                {tempo ? `♩=${tempo}` : "—"}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
