export type ParsedReferenceMidi = {
  ppq: number;
  noteCount: number;
  measureCount: number;
};

export type PerformanceNote = {
  midi: number;
  startSec: number;
  endSec: number;
  /** Note-on velocity, 1–127. The transcription model regresses real dynamics. */
  velocity: number;
};
/** A sustain-pedal press: CC64 ≥ 64 opens the span, < 64 closes it. */
export type PedalSpan = { startSec: number; endSec: number };
export type ParsedPerformance = {
  durationSec: number;
  notes: PerformanceNote[];
  pedals: PedalSpan[];
};

/** A note positioned in MIDI ticks, for the reference-MIDI piano roll.
 *  `velocity` is the note-on velocity (1–127) so the roll can shade dynamics;
 *  `track` is the source MTrk index so hands/voices can be coloured apart. */
export type ReferenceRollNote = {
  midi: number;
  startTick: number;
  endTick: number;
  velocity: number;
  track: number;
};
/** The three piano pedals we recognise: sustain (CC64), sostenuto (CC66) and
 *  soft / una corda (CC67). */
export type PedalKind = "sustain" | "sostenuto" | "soft";
/** A pedal-press span in ticks, for the reference-MIDI piano roll. */
export type ReferenceRollPedal = { startTick: number; endTick: number; kind: PedalKind };
/** A tempo change: `usPerQuarter` microseconds per quarter note, taking effect
 *  at `tick` (from a `0xFF 0x51` meta event). bpm = 60_000_000 / usPerQuarter. */
export type ReferenceRollTempo = { tick: number; usPerQuarter: number };
/** A single measure's tick span. `measure` is 1-indexed; `endTick` is the next
 *  barline (startTick + a full measure of ticks) so interpolation stays uniform
 *  even when the final bar runs slightly past the last note. */
export type MeasureBoundary = { measure: number; startTick: number; endTick: number };
export type ParsedReferenceRoll = {
  ppq: number;
  notes: ReferenceRollNote[];
  pedals: ReferenceRollPedal[];
  tempos: ReferenceRollTempo[];
  measures: MeasureBoundary[];
  maxTick: number;
};

/**
 * Parse a transcribed performance MIDI into timed note events for the debug
 * view's piano roll. Same lenient SMF walk as parseReferenceMidi, but it keeps
 * note on/off (with velocity) plus CC64 sustain-pedal spans, and converts
 * ticks → seconds via the tempo map.
 */
export function parsePerformanceMidi(
  bytes: ArrayBuffer | Uint8Array
): ParsedPerformance {
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (buf.length < 14 || buf[0] !== 0x4d || buf[1] !== 0x54) {
    throw new Error("Not a MIDI file");
  }
  const division = dv.getUint16(12);
  const ppq = division & 0x8000 ? 480 : division;
  const ntracks = dv.getUint16(10);

  let p = 14;
  const readVarlen = (): number => {
    let val = 0;
    for (;;) {
      const b = buf[p++];
      val = (val << 7) | (b & 0x7f);
      if (!(b & 0x80)) return val;
    }
  };

  const tempoMap: Array<{ tick: number; us: number }> = [];
  const raw: Array<{ tick: number; on: boolean; pitch: number; velocity: number }> = [];
  const cc64: Array<{ tick: number; down: boolean }> = [];

  for (let t = 0; t < ntracks && p + 8 <= buf.length; t++) {
    if (!(buf[p] === 0x4d && buf[p + 1] === 0x54 && buf[p + 2] === 0x72 && buf[p + 3] === 0x6b)) break;
    const len = dv.getUint32(p + 4);
    p += 8;
    const end = Math.min(p + len, buf.length);
    let tick = 0;
    let running = 0;
    while (p < end) {
      tick += readVarlen();
      let status = buf[p];
      if (status & 0x80) { p++; running = status; } else { status = running; }
      const hi = status & 0xf0;
      if (status === 0xff) {
        const type = buf[p++];
        const mlen = readVarlen();
        if (type === 0x51 && mlen === 3) {
          tempoMap.push({ tick, us: (buf[p] << 16) | (buf[p + 1] << 8) | buf[p + 2] });
        }
        p += mlen;
      } else if (status === 0xf0 || status === 0xf7) {
        p += readVarlen();
      } else if (hi === 0x90) {
        raw.push({ tick, on: buf[p + 1] > 0, pitch: buf[p], velocity: buf[p + 1] });
        p += 2;
      } else if (hi === 0x80) {
        raw.push({ tick, on: false, pitch: buf[p], velocity: 0 });
        p += 2;
      } else if (hi === 0xb0) {
        if (buf[p] === 64) cc64.push({ tick, down: buf[p + 1] >= 64 });
        p += 2;
      } else if (hi === 0xa0 || hi === 0xe0) {
        p += 2;
      } else if (hi === 0xc0 || hi === 0xd0) {
        p += 1;
      } else {
        p++;
      }
    }
    p = end;
  }

  if (!tempoMap.length) tempoMap.push({ tick: 0, us: 500000 });
  tempoMap.sort((a, b) => a.tick - b.tick);
  const maxTick = [...raw, ...cc64].reduce((m, e) => Math.max(m, e.tick), 0);
  const tickToSec = (tick: number): number => {
    let sec = 0;
    let last = 0;
    let cur = tempoMap[0].us;
    for (const ev of [...tempoMap.slice(1), { tick: maxTick + 1, us: tempoMap[tempoMap.length - 1].us }]) {
      const segEnd = Math.min(tick, ev.tick);
      if (segEnd > last) sec += ((segEnd - last) / ppq) * (cur / 1_000_000);
      if (ev.tick >= tick) break;
      last = ev.tick;
      cur = ev.us;
    }
    return sec;
  };

  const pending: Record<number, Array<{ tick: number; velocity: number }>> = {};
  const notes: PerformanceNote[] = [];
  for (const e of raw) {
    if (e.on) {
      (pending[e.pitch] ??= []).push({ tick: e.tick, velocity: e.velocity });
    } else if (pending[e.pitch]?.length) {
      const start = pending[e.pitch].shift()!;
      notes.push({
        midi: e.pitch,
        startSec: tickToSec(start.tick),
        endSec: tickToSec(e.tick),
        velocity: start.velocity,
      });
    }
  }

  // Pair pedal presses; a press left dangling at EOF closes at the last event.
  cc64.sort((a, b) => a.tick - b.tick);
  const pedals: PedalSpan[] = [];
  let downTick: number | null = null;
  for (const e of cc64) {
    if (e.down && downTick === null) {
      downTick = e.tick;
    } else if (!e.down && downTick !== null) {
      pedals.push({ startSec: tickToSec(downTick), endSec: tickToSec(e.tick) });
      downTick = null;
    }
  }
  if (downTick !== null) {
    pedals.push({ startSec: tickToSec(downTick), endSec: tickToSec(maxTick) });
  }

  return { durationSec: tickToSec(maxTick), notes, pedals };
}

/**
 * Lenient Standard MIDI File parse for the recognizability badge: pulls ppq, note
 * count, and measure count.
 *
 * Deliberately hand-rolled rather than using @tonejs/midi or `mido`. The U1 spike
 * found a real seed file (Bach French Suite 5) that BOTH of those strict parsers
 * reject ("no MTrk header at start of track") even though it's a perfectly usable
 * MIDI. This parser seeks past each declared track length, so old-sequencer quirks
 * don't fail the whole file. Throws only if the bytes aren't a note-bearing MIDI.
 */
export function parseReferenceMidi(
  bytes: ArrayBuffer | Uint8Array
): ParsedReferenceMidi {
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

  if (
    buf.length < 14 ||
    buf[0] !== 0x4d || buf[1] !== 0x54 || buf[2] !== 0x68 || buf[3] !== 0x64 // "MThd"
  ) {
    throw new Error("Not a MIDI file");
  }

  const division = dv.getUint16(12);
  const ppq = division & 0x8000 ? 480 : division; // assume metrical timing
  const ntracks = dv.getUint16(10);

  let p = 14;
  let noteCount = 0;
  let maxTick = 0;
  const timesigs: Array<{ tick: number; num: number; den: number }> = [];

  const readVarlen = (): number => {
    let val = 0;
    for (;;) {
      const b = buf[p++];
      val = (val << 7) | (b & 0x7f);
      if (!(b & 0x80)) return val;
    }
  };

  for (let t = 0; t < ntracks && p + 8 <= buf.length; t++) {
    // "MTrk"
    if (!(buf[p] === 0x4d && buf[p + 1] === 0x54 && buf[p + 2] === 0x72 && buf[p + 3] === 0x6b)) {
      break;
    }
    const len = dv.getUint32(p + 4);
    p += 8;
    const end = Math.min(p + len, buf.length);
    let tick = 0;
    let running = 0;
    while (p < end) {
      tick += readVarlen();
      let status = buf[p];
      if (status & 0x80) {
        p++;
        running = status;
      } else {
        status = running;
      }
      const hi = status & 0xf0;
      if (status === 0xff) {
        const type = buf[p++];
        const mlen = readVarlen();
        if (type === 0x58 && mlen >= 2) {
          timesigs.push({ tick, num: buf[p], den: 1 << buf[p + 1] });
        }
        p += mlen;
      } else if (status === 0xf0 || status === 0xf7) {
        p += readVarlen();
      } else if (hi === 0x90) {
        if (buf[p + 1] > 0) noteCount++;
        p += 2;
      } else if (hi === 0x80 || hi === 0xa0 || hi === 0xb0 || hi === 0xe0) {
        p += 2;
      } else if (hi === 0xc0 || hi === 0xd0) {
        p += 1;
      } else {
        p++;
      }
      if (tick > maxTick) maxTick = tick;
    }
    p = end;
  }

  if (noteCount === 0) {
    throw new Error("MIDI contains no notes");
  }

  // Measures from the time-signature map (defaults to 4/4 when absent).
  const segs = timesigs.length ? timesigs : [{ tick: 0, num: 4, den: 4 }];
  segs.sort((a, b) => a.tick - b.tick);
  let measures = 0;
  for (let i = 0; i < segs.length; i++) {
    const next = i + 1 < segs.length ? segs[i + 1].tick : maxTick;
    const ticksPerMeasure = (ppq * 4 * segs[i].num) / segs[i].den;
    if (ticksPerMeasure > 0 && next > segs[i].tick) {
      measures += (next - segs[i].tick) / ticksPerMeasure;
    }
  }

  return { ppq, noteCount, measureCount: Math.round(measures) };
}

/**
 * Parse a reference MIDI into tick-positioned notes plus explicit per-measure
 * tick boundaries, for the "Measure view" piano roll. Same lenient SMF walk as
 * the other two parsers; it keeps note on/off in ticks (geometry is tick-based,
 * no tempo map needed), the note-on velocity (so the roll can shade dynamics),
 * the source track index (so hands/voices can be coloured apart), CC64/66/67
 * pedal spans and the tempo map, and emits one boundary per measure derived from
 * the time-signature map. Server-side only. Throws only if the bytes aren't a
 * note-bearing MIDI.
 */
export function parseReferenceRoll(
  bytes: ArrayBuffer | Uint8Array
): ParsedReferenceRoll {
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

  if (
    buf.length < 14 ||
    buf[0] !== 0x4d || buf[1] !== 0x54 || buf[2] !== 0x68 || buf[3] !== 0x64 // "MThd"
  ) {
    throw new Error("Not a MIDI file");
  }

  const division = dv.getUint16(12);
  const ppq = division & 0x8000 ? 480 : division;
  const ntracks = dv.getUint16(10);

  let p = 14;
  let maxTick = 0;
  const timesigs: Array<{ tick: number; num: number; den: number }> = [];
  const tempoMap: ReferenceRollTempo[] = [];
  const raw: Array<{ tick: number; on: boolean; pitch: number; velocity: number; track: number }> = [];
  const pedalEvents: Array<{ tick: number; kind: PedalKind; down: boolean }> = [];

  const readVarlen = (): number => {
    let val = 0;
    for (;;) {
      const b = buf[p++];
      val = (val << 7) | (b & 0x7f);
      if (!(b & 0x80)) return val;
    }
  };

  for (let t = 0; t < ntracks && p + 8 <= buf.length; t++) {
    if (!(buf[p] === 0x4d && buf[p + 1] === 0x54 && buf[p + 2] === 0x72 && buf[p + 3] === 0x6b)) {
      break;
    }
    const len = dv.getUint32(p + 4);
    p += 8;
    const end = Math.min(p + len, buf.length);
    let tick = 0;
    let running = 0;
    while (p < end) {
      tick += readVarlen();
      let status = buf[p];
      if (status & 0x80) {
        p++;
        running = status;
      } else {
        status = running;
      }
      const hi = status & 0xf0;
      if (status === 0xff) {
        const type = buf[p++];
        const mlen = readVarlen();
        if (type === 0x58 && mlen >= 2) {
          timesigs.push({ tick, num: buf[p], den: 1 << buf[p + 1] });
        } else if (type === 0x51 && mlen === 3) {
          tempoMap.push({ tick, usPerQuarter: (buf[p] << 16) | (buf[p + 1] << 8) | buf[p + 2] });
        }
        p += mlen;
      } else if (status === 0xf0 || status === 0xf7) {
        p += readVarlen();
      } else if (hi === 0x90) {
        raw.push({ tick, on: buf[p + 1] > 0, pitch: buf[p], velocity: buf[p + 1], track: t });
        p += 2;
      } else if (hi === 0x80) {
        raw.push({ tick, on: false, pitch: buf[p], velocity: 0, track: t });
        p += 2;
      } else if (hi === 0xb0) {
        const cc = buf[p];
        if (cc === 64 || cc === 66 || cc === 67) {
          const kind: PedalKind = cc === 64 ? "sustain" : cc === 66 ? "sostenuto" : "soft";
          pedalEvents.push({ tick, kind, down: buf[p + 1] >= 64 });
        }
        p += 2;
      } else if (hi === 0xa0 || hi === 0xe0) {
        p += 2;
      } else if (hi === 0xc0 || hi === 0xd0) {
        p += 1;
      } else {
        p++;
      }
      if (tick > maxTick) maxTick = tick;
    }
    p = end;
  }

  // Pair note-on → note-off (polyphony-safe), keeping ticks, on-velocity and the
  // track the note-on came from.
  const pending: Record<number, Array<{ tick: number; velocity: number; track: number }>> = {};
  const notes: ReferenceRollNote[] = [];
  for (const e of raw) {
    if (e.on) {
      (pending[e.pitch] ??= []).push({ tick: e.tick, velocity: e.velocity, track: e.track });
    } else if (pending[e.pitch]?.length) {
      const start = pending[e.pitch].shift()!;
      notes.push({
        midi: e.pitch,
        startTick: start.tick,
        endTick: e.tick,
        velocity: start.velocity,
        track: start.track,
      });
    }
  }

  if (notes.length === 0) {
    throw new Error("MIDI contains no notes");
  }

  // Pair each pedal's presses into spans independently; a press left open at EOF
  // closes at the last tick so a dangling pedal still renders.
  pedalEvents.sort((a, b) => a.tick - b.tick);
  const pedals: ReferenceRollPedal[] = [];
  const downByKind: Partial<Record<PedalKind, number>> = {};
  for (const e of pedalEvents) {
    const openTick = downByKind[e.kind];
    if (e.down && openTick === undefined) {
      downByKind[e.kind] = e.tick;
    } else if (!e.down && openTick !== undefined) {
      if (e.tick > openTick) pedals.push({ startTick: openTick, endTick: e.tick, kind: e.kind });
      delete downByKind[e.kind];
    }
  }
  for (const kind of Object.keys(downByKind) as PedalKind[]) {
    const openTick = downByKind[kind]!;
    if (maxTick > openTick) pedals.push({ startTick: openTick, endTick: maxTick, kind });
  }

  // Tempo map, sorted. Left empty when the file carries no tempo events, so the
  // player can tell "authored tempo" from "no tempo given" and fall back sensibly.
  tempoMap.sort((a, b) => a.tick - b.tick);
  const tempos: ReferenceRollTempo[] = tempoMap;

  // Per-measure tick boundaries from the time-signature map (defaults to 4/4).
  // Each measure is a full meter's worth of ticks; the final bar may extend a
  // little past maxTick, which keeps the x-interpolation uniform.
  const segs = timesigs.length ? timesigs : [{ tick: 0, num: 4, den: 4 }];
  segs.sort((a, b) => a.tick - b.tick);
  const measures: MeasureBoundary[] = [];
  let measureNum = 1;
  for (let i = 0; i < segs.length; i++) {
    const segStart = segs[i].tick;
    const segEnd = i + 1 < segs.length ? segs[i + 1].tick : maxTick;
    const ticksPerMeasure = (ppq * 4 * segs[i].num) / segs[i].den;
    if (ticksPerMeasure <= 0) continue;
    let t2 = segStart;
    // Guard against a degenerate file producing an unbounded number of bars.
    while (t2 < segEnd && measures.length < 5000) {
      measures.push({ measure: measureNum++, startTick: t2, endTick: t2 + ticksPerMeasure });
      t2 += ticksPerMeasure;
    }
  }
  if (measures.length === 0) {
    measures.push({ measure: 1, startTick: 0, endTick: (ppq * 4) || 1 });
  }

  return { ppq, notes, pedals, tempos, measures, maxTick };
}
