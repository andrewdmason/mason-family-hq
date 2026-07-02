"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  PlayIcon,
  PauseIcon,
  Loader2Icon,
  XIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from "lucide-react";
import { SplendidGrandPiano } from "smplr";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { cn } from "@/lib/utils";
import {
  getSections,
  createSection,
  updateSectionStartMeasure,
  updateSectionName,
} from "@/app/practice/repertoire/section-actions";
import {
  nextSectionLetter,
  nextSubsectionLabel,
} from "@/lib/practice/section-labels";
import type {
  ParsedReferenceRoll,
  ReferenceRollNote,
  MeasureBoundary,
  PedalKind,
} from "@/lib/practice/midi";
import type { PieceSection, PieceSectionWithChildren } from "@/lib/types";

const DEFAULT_PX_PER_MEASURE = 48; // timeline density (zoomable)
const MIN_PX_PER_MEASURE = 14;
const MAX_PX_PER_MEASURE = 160;
const ZOOM_FACTOR = 1.4; // per zoom-in/out step
const DRAG_THRESHOLD_PX = 4; // movement before a pointer-down counts as a drag
const KEY_W = 36; // keyboard strip width (fixed left column)
const PARENT_BAND_H = 24;
const SUB_BAND_H = 20;
const RULER_H = 22;
const PEDAL_LANE_H = 10; // sustain-pedal strip under the roll
const MIN_LABEL_PX = 52; // keep measure-number labels at least this far apart
const LABEL_STEPS = [1, 2, 4, 8, 16, 32, 64, 128]; // "nice" measure intervals
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2]; // playback-rate multipliers

// Note colours per source track, so hands/voices read apart. Assigned by
// descending mean pitch, so a two-staff file gets right hand = slot 0.
const TRACK_PALETTE = [
  { note: "fill-indigo-500", swatch: "bg-indigo-500" },
  { note: "fill-teal-500", swatch: "bg-teal-500" },
  { note: "fill-rose-500", swatch: "bg-rose-500" },
  { note: "fill-amber-600", swatch: "bg-amber-600" },
  { note: "fill-cyan-500", swatch: "bg-cyan-500" },
] as const;

// Pedal lanes under the roll, one row per pedal the file actually uses.
const PEDAL_LANES: { kind: PedalKind; label: string; title: string; fill: string }[] = [
  { kind: "sustain", label: "Ped.", title: "Sustain pedal", fill: "fill-amber-500/60" },
  { kind: "sostenuto", label: "Sost.", title: "Sostenuto pedal", fill: "fill-sky-500/60" },
  { kind: "soft", label: "U.C.", title: "Soft (una corda) pedal", fill: "fill-purple-500/60" },
];

type Band = {
  section: PieceSection;
  startMeasure: number;
  endMeasure: number; // exclusive (next marker, or end of span)
};

function pitchClassIsBlack(midi: number): boolean {
  return [1, 3, 6, 8, 10].includes(((midi % 12) + 12) % 12);
}

/** Smallest "nice" measure interval whose on-screen width clears MIN_LABEL_PX,
 *  so labels thin out when zoomed out and densify when zoomed in. */
function labelIntervalFor(pxPerMeasure: number): number {
  const need = MIN_LABEL_PX / pxPerMeasure;
  return LABEL_STEPS.find((s) => s >= need) ?? LABEL_STEPS[LABEL_STEPS.length - 1];
}

/** Binary-search the measure boundary that contains `tick`. */
function measureIndexForTick(measures: MeasureBoundary[], tick: number): number {
  let lo = 0;
  let hi = measures.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (measures[mid].startTick <= tick) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export function MeasureViewPanel({
  pieceId,
  pieceTempo,
  roll,
  initialSections,
}: {
  pieceId: string;
  pieceTempo: number | null;
  roll: ParsedReferenceRoll;
  initialSections: PieceSectionWithChildren[];
}) {
  const { ppq, notes, pedals, tempos, measures } = roll;
  const totalMeasures = measures.length;

  // Playback rate at a given tick. The MIDI's own tempo map is the source of
  // truth for how the reference should sound — it honours tempo changes, and it
  // matches the note timing the file was authored with. The piece's target tempo
  // is a *practice goal* on a possibly-different scale, so it's only a fallback
  // for files that carry no tempo at all (else default to 120bpm).
  const bpmAtTick = useCallback(
    (tick: number): number => {
      if (!tempos.length) return pieceTempo ?? 120;
      let us = tempos[0].usPerQuarter;
      for (const t of tempos) {
        if (t.tick <= tick) us = t.usPerQuarter;
        else break;
      }
      return 60_000_000 / us;
    },
    [pieceTempo, tempos]
  );

  const [pxPerMeasure, setPxPerMeasure] = useState(DEFAULT_PX_PER_MEASURE);
  const contentWidth = totalMeasures * pxPerMeasure;

  const [sections, setSections] = useState(initialSections);
  // Optimistic per-section measure override while dragging a marker.
  const [dragOverride, setDragOverride] = useState<Record<string, number>>({});

  /* ----------------------------- geometry ----------------------------- */

  const pitch = useMemo(() => {
    if (!notes.length) return { lo: 48, hi: 84 };
    const ps = notes.map((n) => n.midi);
    return { lo: Math.min(...ps) - 1, hi: Math.max(...ps) + 1 };
  }, [notes]);
  const semis = pitch.hi - pitch.lo + 1;
  const ROW_H = Math.max(3, Math.min(8, Math.round(300 / semis)));
  const ROLL_H = semis * ROW_H;

  const yForMidi = (midi: number) => (pitch.hi - midi) * ROW_H;
  const xForMeasure = useCallback(
    (m: number) => (m - 1) * pxPerMeasure,
    [pxPerMeasure]
  );
  const xForTick = useCallback(
    (tick: number) => {
      const i = measureIndexForTick(measures, tick);
      const b = measures[i];
      const span = b.endTick - b.startTick || 1;
      return (
        (b.measure - 1) * pxPerMeasure +
        ((tick - b.startTick) / span) * pxPerMeasure
      );
    },
    [measures, pxPerMeasure]
  );

  const sortedNotes = useMemo(
    () => [...notes].sort((a, b) => a.startTick - b.startTick),
    [notes]
  );

  // Sustain: a note released while the sustain pedal (CC64) is down keeps ringing
  // until the pedal lifts, so playback holds it to the end of the covering span.
  // (Sostenuto/soft don't extend note length, so they're excluded here.)
  const sustainSpans = useMemo(
    () =>
      pedals
        .filter((pd) => pd.kind === "sustain")
        .sort((a, b) => a.startTick - b.startTick),
    [pedals]
  );
  const sustainedEndTick = useCallback(
    (n: ReferenceRollNote) => {
      const span = sustainSpans.find(
        (pd) => pd.startTick <= n.endTick && n.endTick < pd.endTick
      );
      return span ? span.endTick : n.endTick;
    },
    [sustainSpans]
  );

  // Colour notes by source track so hands/voices read apart. Distinct tracks are
  // ordered by descending mean pitch; a two-staff file becomes right/left hand.
  const tracks = useMemo(() => {
    const stats = new Map<number, { count: number; sum: number }>();
    for (const n of notes) {
      const s = stats.get(n.track) ?? { count: 0, sum: 0 };
      s.count += 1;
      s.sum += n.midi;
      stats.set(n.track, s);
    }
    const meanOf = (id: number) => stats.get(id)!.sum / stats.get(id)!.count;
    const ids = [...stats.keys()].sort((a, b) => meanOf(b) - meanOf(a));
    const color = new Map<number, (typeof TRACK_PALETTE)[number]>();
    ids.forEach((id, i) => color.set(id, TRACK_PALETTE[i % TRACK_PALETTE.length]));
    const legend = ids.map((id, i) => ({
      id,
      label: ids.length === 2 ? (i === 0 ? "Right hand" : "Left hand") : `Voice ${i + 1}`,
      swatch: color.get(id)!.swatch,
    }));
    return { color, legend, multi: ids.length > 1 };
  }, [notes]);

  // Only render lanes for pedals the file actually uses.
  const pedalLanes = useMemo(
    () => PEDAL_LANES.filter((l) => pedals.some((p) => p.kind === l.kind)),
    [pedals]
  );

  /* ------------------------------ bands ------------------------------- */

  const effectiveStart = useCallback(
    (s: PieceSection): number | null =>
      s.id in dragOverride ? dragOverride[s.id] : s.start_measure,
    [dragOverride]
  );

  const { parentBands, subBands } = useMemo(() => {
    const parents = sections.filter((p) => p.parent_id === null);
    const placedParents = parents
      .map((p) => ({ p, m: effectiveStart(p) }))
      .filter((x): x is { p: PieceSectionWithChildren; m: number } => x.m != null)
      .sort((a, b) => a.m - b.m);

    const parentBands: Band[] = placedParents.map((x, i) => ({
      section: x.p,
      startMeasure: x.m,
      endMeasure:
        i + 1 < placedParents.length ? placedParents[i + 1].m : totalMeasures + 1,
    }));

    const subBands: Band[] = [];
    for (const pb of parentBands) {
      const parent = pb.section as PieceSectionWithChildren;
      const placedSubs = parent.children
        .map((c) => ({ c, m: effectiveStart(c) }))
        .filter((x): x is { c: PieceSection; m: number } => x.m != null)
        .sort((a, b) => a.m - b.m);
      placedSubs.forEach((x, i) => {
        subBands.push({
          section: x.c,
          startMeasure: x.m,
          endMeasure:
            i + 1 < placedSubs.length ? placedSubs[i + 1].m : pb.endMeasure,
        });
      });
    }
    return { parentBands, subBands };
  }, [sections, effectiveStart, totalMeasures]);

  const unplaced = useMemo(() => {
    const out: { section: PieceSection; isChild: boolean }[] = [];
    for (const p of sections) {
      if (effectiveStart(p) == null) out.push({ section: p, isChild: false });
      for (const c of p.children) {
        if (effectiveStart(c) == null) out.push({ section: c, isChild: true });
      }
    }
    return out;
  }, [sections, effectiveStart]);

  /* --------------------------- data plumbing -------------------------- */

  const refreshSections = useCallback(async () => {
    setSections(await getSections(pieceId));
  }, [pieceId]);

  useEffect(() => {
    const handler = () => void refreshSections();
    window.addEventListener("sections-changed", handler);
    return () => window.removeEventListener("sections-changed", handler);
  }, [refreshSections]);

  const dispatchChanged = () =>
    window.dispatchEvent(new CustomEvent("sections-changed"));

  const persistStartMeasure = async (sectionId: string, measure: number | null) => {
    // Optimistic local update so the band stays put through the refetch.
    setSections((prev) =>
      prev.map((p) => ({
        ...(p.id === sectionId ? { ...p, start_measure: measure } : p),
        children: p.children.map((c) =>
          c.id === sectionId ? { ...c, start_measure: measure } : c
        ),
      }))
    );
    await updateSectionStartMeasure(sectionId, measure);
    dispatchChanged();
  };

  const createMarker = async (rawMeasure: number, parentId: string | null) => {
    const measure = Math.max(1, Math.min(totalMeasures, rawMeasure));
    let label: string;
    if (parentId) {
      const parent = sections.find((p) => p.id === parentId);
      if (!parent) return;
      label = nextSubsectionLabel(parent.label, parent.children.length);
    } else {
      label = nextSectionLetter(sections);
    }
    const res = await createSection(pieceId, label, parentId);
    if (res.success && res.id) {
      await updateSectionStartMeasure(res.id, measure);
    }
    await refreshSections();
    dispatchChanged();
  };

  /* ----------------------------- dragging ----------------------------- */

  const rollAreaRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    sectionId: string;
    kind: "handle" | "pill";
    startX: number;
    moved: boolean;
  } | null>(null);

  const measureFromClientX = useCallback(
    (clientX: number): number => {
      const el = rollAreaRef.current;
      if (!el) return 1;
      const rect = el.getBoundingClientRect();
      const m = Math.round((clientX - rect.left) / pxPerMeasure) + 1;
      return Math.max(1, Math.min(totalMeasures, m));
    },
    [totalMeasures, pxPerMeasure]
  );

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      if (!drag.moved && Math.abs(e.clientX - drag.startX) < DRAG_THRESHOLD_PX) {
        return; // still a tap, not a drag
      }
      drag.moved = true;
      setDragOverride({ [drag.sectionId]: measureFromClientX(e.clientX) });
    };
    const onUp = (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      dragRef.current = null;
      setDragOverride({});
      if (drag.moved) {
        // Dragged: drop at the barline under the pointer.
        void persistStartMeasure(drag.sectionId, measureFromClientX(e.clientX));
      } else if (drag.kind === "pill") {
        // Tapped a pill: drop it at the current scrubber measure.
        const m = Math.max(1, Math.min(totalMeasures, Math.round(posRef.current)));
        void persistStartMeasure(drag.sectionId, m);
      }
      // A tap on a band handle leaves the marker where it is.
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measureFromClientX, totalMeasures]);

  const beginDrag = (
    sectionId: string,
    e: React.PointerEvent,
    kind: "handle" | "pill" = "handle"
  ) => {
    if (e.button !== 0) return; // ignore right-click (opens the context menu)
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = { sectionId, kind, startX: e.clientX, moved: false };
  };

  /* ----------------------------- playback ----------------------------- */

  const [playing, setPlaying] = useState(false);
  const [posMeasure, setPosMeasure] = useState(1);
  const [loadingInstrument, setLoadingInstrument] = useState(false);
  const [speed, setSpeed] = useState(1);
  const speedStorageKey = `measure-view-speed:${pieceId}`;

  const scrollRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<AudioContext | null>(null);
  const pianoRef = useRef<SplendidGrandPiano | null>(null);
  const rafRef = useRef<number | null>(null);
  const posRef = useRef(1);
  const tempoScaleRef = useRef(1); // driven by the speed dropdown

  const changeSpeed = (s: number) => {
    setSpeed(s);
    tempoScaleRef.current = s;
    try {
      window.localStorage.setItem(speedStorageKey, String(s));
    } catch {
      /* localStorage unavailable — ignore */
    }
  };

  // Restore the remembered speed for this piece (after mount, to avoid an SSR
  // hydration mismatch).
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(speedStorageKey);
      const n = stored == null ? NaN : Number(stored);
      if (SPEEDS.includes(n)) {
        setSpeed(n);
        tempoScaleRef.current = n;
      }
    } catch {
      /* localStorage unavailable — keep default */
    }
  }, [speedStorageKey]);

  const posToTick = useCallback(
    (pos: number): number => {
      const i = Math.max(0, Math.min(measures.length - 1, Math.floor(pos) - 1));
      const b = measures[i];
      const frac = pos - Math.floor(pos);
      return b.startTick + frac * (b.endTick - b.startTick);
    },
    [measures]
  );

  function stopAudio() {
    try {
      pianoRef.current?.stop();
    } catch {
      /* not started */
    }
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
  }

  async function ensurePiano() {
    if (!audioRef.current) audioRef.current = new AudioContext();
    const ctx = audioRef.current;
    await ctx.resume();
    if (!pianoRef.current) {
      setLoadingInstrument(true);
      pianoRef.current = new SplendidGrandPiano(ctx);
      await pianoRef.current.load;
      setLoadingInstrument(false);
    }
    return { ctx, piano: pianoRef.current };
  }

  async function play(from: number) {
    const { ctx, piano } = await ensurePiano();
    stopAudio();
    posRef.current = from;
    setPlaying(true);

    let cursor = 0;
    const fromTick = posToTick(from);
    while (cursor < sortedNotes.length && sortedNotes[cursor].startTick < fromTick) {
      cursor++;
    }
    let last = ctx.currentTime;
    const tick = () => {
      const now = ctx.currentTime;
      const dt = now - last;
      last = now;

      let pos = posRef.current;
      const mi = Math.max(0, Math.min(measures.length - 1, Math.floor(pos) - 1));
      const mTicks = measures[mi].endTick - measures[mi].startTick || ppq * 4;
      const bpmNow = bpmAtTick(posToTick(pos));
      // measures/sec = (beats/sec) / (beats per measure); beats are quarter notes
      const dPos = (dt * (bpmNow / 60) * ppq * tempoScaleRef.current) / mTicks;
      pos += dPos;
      posRef.current = pos;

      const curTick = posToTick(pos);
      while (cursor < sortedNotes.length && sortedNotes[cursor].startTick <= curTick) {
        const n: ReferenceRollNote = sortedNotes[cursor++];
        const durSec = Math.max(
          0.08,
          Math.min(
            ((sustainedEndTick(n) - n.startTick) / ppq) * (60 / bpmAtTick(n.startTick)),
            8
          )
        );
        piano.start({
          note: n.midi,
          time: ctx.currentTime,
          duration: durSec,
          velocity: n.velocity || 80,
        });
      }

      if (pos >= totalMeasures + 1) {
        posRef.current = 1;
        setPosMeasure(1);
        setPlaying(false);
        stopAudio();
        return;
      }

      // Auto-scroll: keep the playhead centred in the viewport.
      const sc = scrollRef.current;
      if (sc) {
        const px = pxPerMeasureRef.current;
        const cx = (pos - 1) * px;
        const max = Math.max(0, totalMeasures * px - sc.clientWidth);
        sc.scrollLeft = Math.max(0, Math.min(max, cx - sc.clientWidth / 2));
      }

      setPosMeasure(pos);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }

  function toggle() {
    if (playing) {
      stopAudio();
      setPlaying(false);
    } else {
      void play(posMeasure >= totalMeasures + 1 ? 1 : posMeasure);
    }
  }

  function seekToClientX(clientX: number) {
    const el = rollAreaRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const frac = (clientX - rect.left) / pxPerMeasure; // measures from start
    // Snap the scrubber to the nearest measure boundary.
    const pos = Math.max(1, Math.min(totalMeasures, Math.round(1 + frac)));
    posRef.current = pos;
    setPosMeasure(pos);
    if (playing) void play(pos);
  }

  useEffect(
    () => () => {
      stopAudio();
      void audioRef.current?.close();
    },
    []
  );

  // Spacebar toggles playback (ignored while typing in a field).
  const toggleRef = useRef(toggle);
  useEffect(() => {
    toggleRef.current = toggle;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space" && e.key !== " ") return;
      // Only bow out when typing in a text field; otherwise space is play/pause
      // no matter which control (speed/zoom/play button) currently has focus.
      // preventDefault stops the focused button from also firing on space.
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.isContentEditable)
      ) {
        return;
      }
      e.preventDefault();
      toggleRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /* ------------------------------- zoom ------------------------------- */

  // Latest zoom for the playback rAF loop (closes over a stale value otherwise).
  const pxPerMeasureRef = useRef(pxPerMeasure);
  useEffect(() => {
    pxPerMeasureRef.current = pxPerMeasure;
  });

  // Zoom around the viewport centre: remember the centre measure, then restore
  // its scroll position after the new width lands.
  const centerMeasureRef = useRef<number | null>(null);
  const zoomBy = (factor: number) => {
    const sc = scrollRef.current;
    if (sc) {
      centerMeasureRef.current =
        (sc.scrollLeft + sc.clientWidth / 2) / pxPerMeasure;
    }
    setPxPerMeasure((prev) =>
      Math.max(
        MIN_PX_PER_MEASURE,
        Math.min(MAX_PX_PER_MEASURE, Math.round(prev * factor))
      )
    );
  };
  useEffect(() => {
    const sc = scrollRef.current;
    const cm = centerMeasureRef.current;
    if (sc && cm != null) {
      const max = Math.max(0, totalMeasures * pxPerMeasure - sc.clientWidth);
      sc.scrollLeft = Math.max(
        0,
        Math.min(max, cm * pxPerMeasure - sc.clientWidth / 2)
      );
      centerMeasureRef.current = null;
    }
  }, [pxPerMeasure, totalMeasures]);

  const cursorX = (posMeasure - 1) * pxPerMeasure;

  /* ------------------------------ render ------------------------------ */

  const bandsHeight = PARENT_BAND_H + SUB_BAND_H + RULER_H;

  // How often to label/emphasise a measure, adapted to the current zoom.
  const labelEvery = labelIntervalFor(pxPerMeasure);

  // Per-measure gridlines as a CSS gradient (0 DOM nodes); heavier on labelled
  // measures so the emphasis tracks the labels as you zoom.
  const gridBackground = {
    backgroundImage: `repeating-linear-gradient(to right, var(--border) 0, var(--border) 1px, transparent 1px, transparent ${pxPerMeasure}px), repeating-linear-gradient(to right, var(--border) 0, var(--border) 1px, transparent 1px, transparent ${pxPerMeasure * labelEvery}px)`,
    backgroundSize: `${pxPerMeasure}px 100%, ${pxPerMeasure * labelEvery}px 100%`,
  } as React.CSSProperties;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <Button
            size="sm"
            variant="secondary"
            onClick={toggle}
            disabled={loadingInstrument}
          >
            {loadingInstrument ? (
              <Loader2Icon className="animate-spin" />
            ) : playing ? (
              <PauseIcon />
            ) : (
              <PlayIcon />
            )}
            {loadingInstrument ? "Loading piano…" : playing ? "Pause" : "Play"}
          </Button>
          <span className="text-xs tabular-nums text-muted-foreground">
            m. {Math.min(totalMeasures, Math.floor(posMeasure))} / {totalMeasures}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1">
            <span className="mr-1 text-xs text-muted-foreground">Zoom</span>
            <button
              onClick={() => zoomBy(1 / ZOOM_FACTOR)}
              disabled={pxPerMeasure <= MIN_PX_PER_MEASURE}
              className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent disabled:opacity-40"
              title="Zoom out"
            >
              <ZoomOutIcon className="size-3.5" />
            </button>
            <button
              onClick={() => zoomBy(ZOOM_FACTOR)}
              disabled={pxPerMeasure >= MAX_PX_PER_MEASURE}
              className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent disabled:opacity-40"
              title="Zoom in"
            >
              <ZoomInIcon className="size-3.5" />
            </button>
          </div>
          <div className="flex items-center gap-1">
            <span className="mr-1 text-xs text-muted-foreground">Speed</span>
            <Select
              value={String(speed)}
              onValueChange={(v) => changeSpeed(Number(v))}
            >
              <SelectTrigger className="h-7 w-[70px] text-xs tabular-nums">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SPEEDS.map((s) => (
                  <SelectItem
                    key={s}
                    value={String(s)}
                    className="text-xs tabular-nums"
                  >
                    {s}×
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {unplaced.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <span>Unplaced:</span>
          {unplaced.map(({ section, isChild }) => (
            <button
              key={section.id}
              onPointerDown={(e) => beginDrag(section.id, e, "pill")}
              className={cn(
                "cursor-grab touch-none rounded border px-1.5 py-0.5 font-medium hover:bg-accent active:cursor-grabbing",
                isChild ? "text-muted-foreground" : "text-foreground"
              )}
              title={section.name ?? section.label}
            >
              {section.label}
              {section.name ? ` · ${section.name}` : ""}
            </button>
          ))}
        </div>
      )}

      {tracks.multi && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {tracks.legend.map((l) => (
            <span key={l.id} className="flex items-center gap-1">
              <span className={cn("inline-block size-2.5 rounded-sm", l.swatch)} />
              {l.label}
            </span>
          ))}
        </div>
      )}

      <div className="flex rounded-lg border bg-card">
        {/* Fixed keyboard column (does not scroll horizontally) */}
        <div className="shrink-0" style={{ width: KEY_W }}>
          <div style={{ height: bandsHeight }} className="border-b" />
          <svg
            width={KEY_W}
            height={ROLL_H}
            className="block"
            style={{ background: "var(--card)" }}
          >
            {Array.from({ length: semis }, (_, i) => {
              const midi = pitch.lo + i;
              const black = pitchClassIsBlack(midi);
              return (
                <g key={midi}>
                  <rect
                    x={0}
                    y={yForMidi(midi)}
                    width={KEY_W}
                    height={ROW_H}
                    className={black ? "fill-muted" : "fill-card"}
                    stroke="var(--border)"
                    strokeWidth={0.25}
                  />
                  {midi % 12 === 0 && ROW_H >= 5 && (
                    <text
                      x={2}
                      y={yForMidi(midi) + ROW_H - 1}
                      className="fill-muted-foreground"
                      style={{ fontSize: Math.min(8, ROW_H) }}
                    >
                      C{Math.floor(midi / 12) - 1}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
          {pedalLanes.map((lane) => (
            <div
              key={lane.kind}
              className="flex items-center justify-end border-t px-1 text-[8px] uppercase tracking-wide text-muted-foreground"
              style={{ height: PEDAL_LANE_H }}
              title={lane.title}
            >
              {lane.label}
            </div>
          ))}
        </div>

        {/* Scrollable measure-aligned area */}
        <div ref={scrollRef} className="min-w-0 flex-1 overflow-x-auto">
          <div style={{ width: contentWidth }}>
            {/* Parent band tier */}
            <BandTier
              height={PARENT_BAND_H}
              bands={parentBands}
              xForMeasure={xForMeasure}
              pxPerMeasure={pxPerMeasure}
              onBackgroundClick={(m) => createMarker(m, null)}
              onBeginDrag={beginDrag}
              onClear={(id) => persistStartMeasure(id, null)}
              onRename={(id, name) => updateSectionName(id, name).then(dispatchChanged)}
              accent
            />
            {/* Subsection band tier */}
            <BandTier
              height={SUB_BAND_H}
              bands={subBands}
              xForMeasure={xForMeasure}
              pxPerMeasure={pxPerMeasure}
              onBackgroundClick={(m) => {
                const pb = parentBands.find(
                  (b) => m >= b.startMeasure && m < b.endMeasure
                );
                if (pb) void createMarker(m, pb.section.id);
              }}
              onBeginDrag={beginDrag}
              onClear={(id) => persistStartMeasure(id, null)}
              onRename={(id, name) => updateSectionName(id, name).then(dispatchChanged)}
            />

            {/* Measure ruler */}
            <div
              className="relative border-b"
              style={{ height: RULER_H, ...gridBackground }}
            >
              {measures.map((b) =>
                (b.measure - 1) % labelEvery === 0 ? (
                  <span
                    key={b.measure}
                    className="absolute top-0 pl-0.5 text-[9px] tabular-nums text-muted-foreground"
                    style={{ left: xForMeasure(b.measure) }}
                  >
                    {b.measure}
                  </span>
                ) : null
              )}
            </div>

            {/* Piano roll */}
            <div
              ref={rollAreaRef}
              className="relative cursor-pointer"
              style={{ height: ROLL_H, ...gridBackground }}
              onClick={(e) => seekToClientX(e.clientX)}
            >
              <svg width={contentWidth} height={ROLL_H} className="block">
                {notes.map((n, i) => {
                  const x = xForTick(n.startTick);
                  const w = Math.max(1, xForTick(n.endTick) - x);
                  return (
                    <rect
                      key={i}
                      x={x}
                      y={yForMidi(n.midi)}
                      width={w}
                      height={Math.max(2, ROW_H - 1)}
                      rx={1}
                      fillOpacity={0.3 + 0.7 * Math.min(1, (n.velocity || 80) / 110)}
                      className={tracks.color.get(n.track)?.note ?? "fill-indigo-500"}
                    >
                      <title>{`velocity ${n.velocity}`}</title>
                    </rect>
                  );
                })}
              </svg>
              <div
                className="pointer-events-none absolute inset-y-0 w-px bg-red-500"
                style={{ left: cursorX }}
              />
            </div>

            {/* Pedal lanes (CC64/66/67 spans), aligned to the same measure grid */}
            {pedalLanes.map((lane) => (
              <div
                key={lane.kind}
                className="relative border-t"
                style={{ height: PEDAL_LANE_H, ...gridBackground }}
              >
                <svg width={contentWidth} height={PEDAL_LANE_H} className="block">
                  {pedals
                    .filter((pd) => pd.kind === lane.kind)
                    .map((pd, i) => {
                      const x = xForTick(pd.startTick);
                      const w = Math.max(1, xForTick(pd.endTick) - x);
                      return (
                        <rect
                          key={i}
                          x={x}
                          y={2}
                          width={w}
                          height={PEDAL_LANE_H - 4}
                          rx={2}
                          className={lane.fill}
                        />
                      );
                    })}
                </svg>
                <div
                  className="pointer-events-none absolute inset-y-0 w-px bg-red-500"
                  style={{ left: cursorX }}
                />
              </div>
            ))}
          </div>
        </div>
      </div>

    </div>
  );
}

/* ------------------------------ band tier ------------------------------ */

function BandTier({
  height,
  bands,
  xForMeasure,
  pxPerMeasure,
  onBackgroundClick,
  onBeginDrag,
  onClear,
  onRename,
  accent,
}: {
  height: number;
  bands: Band[];
  xForMeasure: (m: number) => number;
  pxPerMeasure: number;
  onBackgroundClick: (measure: number) => void;
  onBeginDrag: (sectionId: string, e: React.PointerEvent) => void;
  onClear: (sectionId: string) => void;
  onRename: (sectionId: string, name: string | null) => void;
  accent?: boolean;
}) {
  return (
    <div
      className="relative border-b"
      style={{ height }}
      onClick={(e) => {
        if (e.target !== e.currentTarget) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const m = Math.round((e.clientX - rect.left) / pxPerMeasure) + 1;
        onBackgroundClick(Math.max(1, m));
      }}
    >
      {bands.map((band) => {
        const left = xForMeasure(band.startMeasure);
        const width = Math.max(
          12,
          xForMeasure(band.endMeasure) - left
        );
        return (
          <BandView
            key={band.section.id}
            band={band}
            left={left}
            width={width}
            height={height}
            accent={accent}
            onBeginDrag={onBeginDrag}
            onClear={onClear}
            onRename={onRename}
          />
        );
      })}
    </div>
  );
}

function BandView({
  band,
  left,
  width,
  height,
  accent,
  onBeginDrag,
  onClear,
  onRename,
}: {
  band: Band;
  left: number;
  width: number;
  height: number;
  accent?: boolean;
  onBeginDrag: (sectionId: string, e: React.PointerEvent) => void;
  onClear: (sectionId: string) => void;
  onRename: (sectionId: string, name: string | null) => void;
}) {
  const { section } = band;
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(section.name ?? "");

  const commit = () => {
    setEditing(false);
    const next = value.trim() ? value.trim() : null;
    if (next !== (section.name ?? null)) onRename(section.id, next);
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger
        className={cn(
          "absolute top-0 flex items-center gap-1 overflow-hidden whitespace-nowrap rounded-sm px-1 text-[11px]",
          accent
            ? "bg-indigo-500/15 text-indigo-900 dark:text-indigo-200"
            : "bg-zinc-400/15 text-muted-foreground"
        )}
        style={{ left, width, height: height - 2, marginTop: 1 }}
      >
        {/* Drag handle on the left edge */}
        <span
          onPointerDown={(e) => onBeginDrag(section.id, e)}
          className="-ml-1 h-full w-2 shrink-0 cursor-ew-resize touch-none rounded-l-sm bg-foreground/20 hover:bg-foreground/50"
          title="Drag to move marker"
        />
        <span className="shrink-0 font-semibold">{section.label}</span>
        {editing ? (
          <Input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") {
                setEditing(false);
                setValue(section.name ?? "");
              }
            }}
            autoFocus
            placeholder="Name"
            className="h-5 px-1 text-[11px]"
          />
        ) : (
          <button
            onClick={() => {
              setValue(section.name ?? "");
              setEditing(true);
            }}
            className="min-w-0 truncate text-left hover:underline"
          >
            {section.name || "—"}
          </button>
        )}
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem variant="destructive" onClick={() => onClear(section.id)}>
          <XIcon className="size-4" />
          Remove marker
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
