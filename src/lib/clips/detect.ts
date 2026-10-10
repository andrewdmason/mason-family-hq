// Pitch auto-detection, the experiment: find the moments a pitch reaches the
// plate from the at-bat's sound alone, so they can be laid next to the hand-
// marked pitches and compared. Nothing here is saved — it's a "does this work
// at all?" probe, run from the player's edit mode.
//
// The bet: a glove pop or a bat crack is the sharpest sound at a ballfield —
// loud, broadband, and from silence to peak in a few milliseconds. Crowd noise
// and chatter are louder for longer but rise slowly. So: high-pass the audio
// (drop wind, engines and most voice), track loudness in 10ms frames, and score
// each frame by how sharply it jumps over the moment just before it AND how far
// it stands above the last second and a half. Claps and the catcher's throw
// back to the pitcher will fool it — that's what the comparison is for.
//
// Pure: no DOM, no IO. `decodeAudio` (browser-only) lives in detect-audio.ts.

export const DETECT = {
  /** High-pass corner — glove pops and bat cracks live well above it. */
  highpassHz: 1500,
  /** Loudness frame and hop. */
  frameS: 0.01,
  hopS: 0.005,
  /** The "moment just before" a sharp sound rises out of: 10–40ms back. */
  riseFromS: [0.01, 0.04] as const,
  /** Background loudness: the median of the last stretch, in 100ms blocks. */
  backgroundS: 1.5,
  /** At most one detection per this window — the strongest wins. */
  minGapS: 1.5,
  /** Below this (dB) a peak isn't worth reporting at any sensitivity. */
  floorDb: 6,
  /** The sensitivity the player starts at (dB). */
  defaultThresholdDb: 14,
  /** A detection counts as a hand-marked pitch if it's this close. */
  matchToleranceS: 0.4,
} as const;

export type Onset = {
  /** Seconds into the video. */
  t: number;
  /** min(sharpness, height over background), in dB. */
  strength: number;
};

export type Detection = {
  onsets: Onset[];
  /** The strength curve squeezed to `CURVE_POINTS` (max per bucket), for drawing. */
  curve: number[];
};

const CURVE_POINTS = 600;

/** In-place 2nd-order Butterworth high-pass (RBJ cookbook biquad). */
function highpass(x: Float32Array, rate: number, hz: number): Float32Array {
  const w = (2 * Math.PI * hz) / rate;
  const alpha = Math.sin(w) / (2 * Math.SQRT1_2);
  const cos = Math.cos(w);
  const a0 = 1 + alpha;
  const b0 = (1 + cos) / 2 / a0;
  const b1 = -(1 + cos) / a0;
  const b2 = b0;
  const a1 = (-2 * cos) / a0;
  const a2 = (1 - alpha) / a0;
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = x[i];
    y2 = y1;
    y1 = v;
    y[i] = v;
  }
  return y;
}

function median(a: number[]): number {
  const s = [...a].sort((p, q) => p - q);
  return s[s.length >> 1];
}

/** Score every hop of the audio; returns the strength curve (dB) and its hop. */
export function onsetStrength(samples: Float32Array, rate: number): { hop: number; strength: Float32Array } {
  const x = highpass(samples, rate, DETECT.highpassHz);
  const frame = Math.max(1, Math.round(DETECT.frameS * rate));
  const hop = Math.max(1, Math.round(DETECT.hopS * rate));
  const n = Math.max(0, Math.floor((x.length - frame) / hop) + 1);

  // Loudness per frame, in dB.
  const db = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let j = i * hop, end = j + frame; j < end; j++) sum += x[j] * x[j];
    db[i] = 10 * Math.log10(sum / frame + 1e-12);
  }

  // Background: mean dB per 100ms block, then a running median of the blocks
  // before the current one (so a pop never raises its own floor).
  const hopS = hop / rate;
  const per = Math.max(1, Math.round(0.1 / hopS));
  const blocks: number[] = [];
  for (let b = 0; b * per < n; b++) {
    let s = 0, c = 0;
    for (let i = b * per; i < Math.min(n, (b + 1) * per); i++) {
      s += db[i];
      c++;
    }
    blocks.push(s / c);
  }
  const span = Math.max(1, Math.round(DETECT.backgroundS / 0.1));
  const bgBlock = blocks.map((_, b) => median(blocks.slice(Math.max(0, b - span), Math.max(1, b))));

  const [near, far] = DETECT.riseFromS.map((s) => Math.max(1, Math.round(s / hopS)));
  const strength = new Float32Array(n);
  for (let i = far; i < n; i++) {
    let before = -Infinity;
    for (let j = i - far; j <= i - near; j++) before = Math.max(before, db[j]);
    const rise = db[i] - before;
    const above = db[i] - bgBlock[Math.floor(i / per)];
    strength[i] = Math.max(0, Math.min(rise, above));
  }
  return { hop: hopS, strength };
}

/** The peaks: local maxima above the floor, at most one per `minGapS`. */
export function pickOnsets(strength: Float32Array, hopS: number): Onset[] {
  const gap = Math.max(1, Math.round(DETECT.minGapS / hopS));
  const candidates: number[] = [];
  for (let i = 0; i < strength.length; i++) if (strength[i] >= DETECT.floorDb) candidates.push(i);
  // Strongest first; each claims its window.
  candidates.sort((a, b) => strength[b] - strength[a]);
  const taken: number[] = [];
  for (const i of candidates) if (taken.every((k) => Math.abs(k - i) >= gap)) taken.push(i);
  return taken
    .sort((a, b) => a - b)
    .map((i) => ({ t: i * hopS + DETECT.frameS / 2, strength: Math.round(strength[i] * 10) / 10 }));
}

export function detectPitches(samples: Float32Array, rate: number): Detection {
  const { hop, strength } = onsetStrength(samples, rate);
  const curve: number[] = [];
  const per = Math.max(1, Math.ceil(strength.length / CURVE_POINTS));
  for (let i = 0; i < strength.length; i += per) {
    let m = 0;
    for (let j = i; j < Math.min(strength.length, i + per); j++) m = Math.max(m, strength[j]);
    curve.push(m);
  }
  return { onsets: pickOnsets(strength, hop), curve };
}

export type Comparison = {
  /** Each matched pair; `offset` is detected minus marked (positive = detected later). */
  matched: { markT: number; onsetT: number; offset: number }[];
  /** Hand-marked pitches with no detection near them. */
  missed: number[];
  /** Detections with no hand-marked pitch near them. */
  extra: number[];
};

/** One-to-one, closest pairs first, within the match tolerance. */
export function compareToMarks(onsets: Onset[], marks: number[]): Comparison {
  const pairs: { m: number; o: number; d: number }[] = [];
  marks.forEach((mt, m) =>
    onsets.forEach((on, o) => {
      const d = Math.abs(on.t - mt);
      if (d <= DETECT.matchToleranceS) pairs.push({ m, o, d });
    }),
  );
  pairs.sort((a, b) => a.d - b.d);
  const usedM = new Set<number>();
  const usedO = new Set<number>();
  const matched: Comparison["matched"] = [];
  for (const p of pairs) {
    if (usedM.has(p.m) || usedO.has(p.o)) continue;
    usedM.add(p.m);
    usedO.add(p.o);
    matched.push({ markT: marks[p.m], onsetT: onsets[p.o].t, offset: onsets[p.o].t - marks[p.m] });
  }
  matched.sort((a, b) => a.markT - b.markT);
  return {
    matched,
    missed: marks.filter((_, m) => !usedM.has(m)),
    extra: onsets.filter((_, o) => !usedO.has(o)).map((o) => o.t),
  };
}
