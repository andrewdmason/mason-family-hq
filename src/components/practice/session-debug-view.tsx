"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { PlayIcon, PauseIcon, Loader2Icon } from "lucide-react";
import { SplendidGrandPiano } from "smplr";
import { Button } from "@/components/ui/button";
import type { PracticeSegment, PracticeWindow } from "@/lib/types";

type Note = { midi: number; startSec: number; endSec: number };

const VW = 1000; // SVG x-units; time is mapped into [0, VW]

function fmt(s: number) {
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

export function SessionDebugView({
  notes,
  durationSec,
  segments,
  windows,
  pieceNames,
}: {
  notes: Note[];
  durationSec: number;
  segments: PracticeSegment[];
  windows: PracticeWindow[];
  pieceNames: Record<string, string>;
}) {
  const dur = Math.max(durationSec, 1);
  const [playing, setPlaying] = useState(false);
  const [playhead, setPlayhead] = useState(0);
  const [loadingInstrument, setLoadingInstrument] = useState(false);

  const audioRef = useRef<AudioContext | null>(null);
  const pianoRef = useRef<SplendidGrandPiano | null>(null);
  const startedAtRef = useRef(0); // audioContext time when playback (re)started
  const offsetRef = useRef(0); // seconds into the session at that start
  const rafRef = useRef<number | null>(null);

  const pitchRange = useMemo(() => {
    if (!notes.length) return { lo: 48, hi: 84 };
    const ps = notes.map((n) => n.midi);
    return { lo: Math.min(...ps) - 2, hi: Math.max(...ps) + 2 };
  }, [notes]);

  const x = (t: number) => (t / dur) * VW;
  const ROLL_H = 260;
  const y = (midi: number) =>
    ROLL_H - ((midi - pitchRange.lo) / (pitchRange.hi - pitchRange.lo)) * ROLL_H;

  function stopAudio() {
    try { pianoRef.current?.stop(); } catch { /* not started */ }
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
    startedAtRef.current = ctx.currentTime;
    offsetRef.current = from;
    for (const n of notes) {
      if (n.endSec < from) continue;
      const time = ctx.currentTime + Math.max(0, n.startSec - from);
      const duration = Math.min(n.endSec - Math.max(n.startSec, from), 8);
      piano.start({ note: n.midi, time, duration: Math.max(0.1, duration), velocity: 80 });
    }
    setPlaying(true);
    const tick = () => {
      const t = offsetRef.current + (ctx.currentTime - startedAtRef.current);
      if (t >= dur) {
        setPlayhead(0);
        setPlaying(false);
        stopAudio();
        return;
      }
      setPlayhead(t);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }

  function toggle() {
    if (playing) {
      stopAudio();
      setPlaying(false);
    } else {
      void play(playhead >= dur ? 0 : playhead);
    }
  }

  function seek(clientX: number, el: HTMLElement) {
    const rect = el.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const t = frac * dur;
    setPlayhead(t);
    if (playing) void play(t);
  }

  useEffect(
    () => () => {
      stopAudio();
      void audioRef.current?.close();
    },
    []
  );

  const playheadPct = (playhead / dur) * 100;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <Button size="sm" variant="secondary" onClick={toggle} disabled={loadingInstrument}>
          {loadingInstrument ? (
            <Loader2Icon className="animate-spin" />
          ) : playing ? (
            <PauseIcon />
          ) : (
            <PlayIcon />
          )}
          {loadingInstrument ? "Loading piano…" : playing ? "Pause" : "Play"}
        </Button>
        <span className="text-sm tabular-nums text-muted-foreground">
          {fmt(playhead)} / {fmt(dur)}
        </span>
        {!notes.length && (
          <span className="text-xs text-muted-foreground">
            (no transcription stored for this session)
          </span>
        )}
      </div>

      <div
        className="relative cursor-pointer select-none rounded-lg border bg-card"
        onClick={(e) => seek(e.clientX, e.currentTarget)}
      >
        {/* Segment bands */}
        <div className="relative h-7 border-b">
          {segments.map((s, i) => {
            const isPiece = s.kind === "piece";
            const label = isPiece
              ? `${pieceNames[s.pieceId ?? ""] ?? "piece"} · ${s.region ?? ""}${s.handsSeparate ? " · hands sep." : ""}`
              : s.kind === "scale" ? "scale" : "free play";
            return (
              <div
                key={i}
                className={`absolute top-0 flex h-full items-center overflow-hidden whitespace-nowrap px-1 text-[10px] ${
                  isPiece ? "bg-emerald-500/25 text-emerald-900 dark:text-emerald-200" : "bg-zinc-400/20 text-muted-foreground"
                }`}
                style={{ left: `${(s.startSec / dur) * 100}%`, width: `${((s.endSec - s.startSec) / dur) * 100}%` }}
                title={label}
              >
                {label}
              </div>
            );
          })}
        </div>

        {/* Confidence trace */}
        <svg viewBox={`0 0 ${VW} 40`} preserveAspectRatio="none" className="block h-10 w-full border-b">
          <line x1="0" y1={40 * (1 - 0.5)} x2={VW} y2={40 * (1 - 0.5)} stroke="currentColor" strokeWidth="0.5" className="text-border" />
          {windows.map((w, i) => {
            const cx = x((w.startSec + w.endSec) / 2);
            const cy = 40 * (1 - Math.max(0, Math.min(1, w.confidence)));
            return <circle key={i} cx={cx} cy={cy} r="2.5" className={w.matched ? "fill-emerald-500" : "fill-zinc-400"} />;
          })}
          <polyline
            points={windows.map((w) => `${x((w.startSec + w.endSec) / 2)},${40 * (1 - Math.max(0, Math.min(1, w.confidence)))}`).join(" ")}
            fill="none" strokeWidth="1" className="stroke-emerald-500/50"
          />
        </svg>

        {/* Piano roll */}
        <svg viewBox={`0 0 ${VW} ${ROLL_H}`} preserveAspectRatio="none" className="block w-full" style={{ height: ROLL_H }}>
          {notes.map((n, i) => (
            <rect
              key={i}
              x={x(n.startSec)}
              y={y(n.midi) - 2}
              width={Math.max(0.8, x(n.endSec) - x(n.startSec))}
              height={4}
              rx={1}
              className="fill-indigo-500"
            />
          ))}
        </svg>

        {/* Playhead */}
        <div className="pointer-events-none absolute inset-y-0 w-px bg-red-500" style={{ left: `${playheadPct}%` }} />
      </div>

      <p className="text-xs text-muted-foreground">
        Top band: what it recognized. Middle: per-window confidence (green = passed the
        gate, gray = unsure). Bottom: the notes it transcribed from your playing.
      </p>
    </div>
  );
}
