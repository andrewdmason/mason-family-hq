export type ParsedReferenceMidi = {
  ppq: number;
  noteCount: number;
  measureCount: number;
};

export type PerformanceNote = { midi: number; startSec: number; endSec: number };
export type ParsedPerformance = {
  durationSec: number;
  notes: PerformanceNote[];
};

/**
 * Parse a transcribed performance MIDI into timed note events for the debug
 * view's piano roll. Same lenient SMF walk as parseReferenceMidi, but it keeps
 * note on/off and converts ticks → seconds via the tempo map.
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
  const raw: Array<{ tick: number; on: boolean; pitch: number }> = [];

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
        raw.push({ tick, on: buf[p + 1] > 0, pitch: buf[p] });
        p += 2;
      } else if (hi === 0x80) {
        raw.push({ tick, on: false, pitch: buf[p] });
        p += 2;
      } else if (hi === 0xa0 || hi === 0xb0 || hi === 0xe0) {
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
  const maxTick = raw.reduce((m, e) => Math.max(m, e.tick), 0);
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

  const pending: Record<number, number[]> = {};
  const notes: PerformanceNote[] = [];
  for (const e of raw) {
    if (e.on) {
      (pending[e.pitch] ??= []).push(e.tick);
    } else if (pending[e.pitch]?.length) {
      const startTick = pending[e.pitch].shift()!;
      notes.push({ midi: e.pitch, startSec: tickToSec(startTick), endSec: tickToSec(e.tick) });
    }
  }
  return { durationSec: tickToSec(maxTick), notes };
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
