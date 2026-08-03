/**
 * Joining the pieces of a chapter into one file, and knowing exactly how long
 * each piece is.
 *
 * A chapter is narrated in several requests and has to come back as a single
 * track. That is easy — MP3 is a stream of self-contained frames, so the bytes
 * simply concatenate — but the timing map is not: each piece's alignment comes
 * back relative to its own start, so every piece after the first has to be
 * shifted by the exact duration of everything before it.
 *
 * "Exact" is the operative word. The obvious shortcut is to take the last spoken
 * character's end time as the piece's duration, but that is the end of SPEECH,
 * not the end of the FILE — there is trailing room tone, and the file is rounded
 * up to a whole frame besides. The error is tens of milliseconds per piece and
 * it accumulates in one direction, so by the end of a long chapter the highlight
 * is running visibly ahead of the voice. Counting frames is the only way to get
 * a number that doesn't drift: a frame is a fixed number of samples, so the
 * duration of a file is a property of its bytes rather than an estimate.
 */

/** Samples per frame, indexed by [mpegVersion][layer]. */
const SAMPLES_PER_FRAME: Record<number, Record<number, number>> = {
  // MPEG 2.5
  0: { 1: 576, 2: 1152, 3: 384 },
  // MPEG 2
  2: { 1: 576, 2: 1152, 3: 384 },
  // MPEG 1
  3: { 1: 1152, 2: 1152, 3: 384 },
};

const BITRATES_V1_L3 = [
  0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0,
];
const BITRATES_V2_L3 = [
  0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0,
];
const SAMPLE_RATES: Record<number, number[]> = {
  0: [11025, 12000, 8000], // MPEG 2.5
  2: [22050, 24000, 16000], // MPEG 2
  3: [44100, 48000, 32000], // MPEG 1
};

type Frame = { offset: number; length: number; samples: number; sampleRate: number };

/**
 * Where the audio actually starts, past any ID3v2 tag.
 *
 * The tag's size is stored "syncsafe" — seven bits per byte, so the length can
 * never itself contain a frame sync pattern.
 */
function audioStart(buf: Uint8Array): number {
  if (buf.length >= 10 && buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) {
    const size =
      ((buf[6] & 0x7f) << 21) |
      ((buf[7] & 0x7f) << 14) |
      ((buf[8] & 0x7f) << 7) |
      (buf[9] & 0x7f);
    const footer = (buf[5] & 0x10) !== 0 ? 10 : 0;
    return 10 + size + footer;
  }
  return 0;
}

/** Decode the frame header at `offset`, or null if that isn't a valid header. */
function frameAt(buf: Uint8Array, offset: number): Frame | null {
  if (offset + 4 > buf.length) return null;
  if (buf[offset] !== 0xff || (buf[offset + 1] & 0xe0) !== 0xe0) return null;

  const version = (buf[offset + 1] >> 3) & 0x03; // 3 = MPEG1, 2 = MPEG2, 0 = MPEG2.5
  const layer = (buf[offset + 1] >> 1) & 0x03; // 1 = Layer III
  if (version === 1 || layer === 0) return null; // reserved

  const bitrateIndex = (buf[offset + 2] >> 4) & 0x0f;
  const sampleRateIndex = (buf[offset + 2] >> 2) & 0x03;
  const padding = (buf[offset + 2] >> 1) & 0x01;
  if (bitrateIndex === 0 || bitrateIndex === 15 || sampleRateIndex === 3) return null;

  const sampleRate = SAMPLE_RATES[version]?.[sampleRateIndex];
  const samples = SAMPLES_PER_FRAME[version]?.[layer];
  if (!sampleRate || !samples) return null;

  const table = version === 3 ? BITRATES_V1_L3 : BITRATES_V2_L3;
  const bitrate = table[bitrateIndex] * 1000;
  if (!bitrate) return null;

  // Layer I counts in 4-byte slots; II and III in bytes.
  const length =
    layer === 3
      ? (Math.floor((12 * bitrate) / sampleRate) + padding) * 4
      : Math.floor((samples / 8) * (bitrate / sampleRate)) + padding;
  if (length <= 4) return null;

  return { offset, length, samples, sampleRate };
}

/**
 * A Xing/Info/VBRI frame is metadata about the file, not audio: it decodes to
 * silence. Harmless at the front of a file, so we leave the first one alone, but
 * one buried at every join is a run of small silences down the length of a
 * chapter — and, worse, the frame still counts toward the duration, so the
 * timing map would be offset by one frame per join.
 */
function isHeaderFrame(buf: Uint8Array, frame: Frame): boolean {
  const end = Math.min(frame.offset + frame.length, buf.length);
  for (let i = frame.offset + 4; i < end - 3; i++) {
    const tag =
      String.fromCharCode(buf[i]) +
      String.fromCharCode(buf[i + 1]) +
      String.fromCharCode(buf[i + 2]) +
      String.fromCharCode(buf[i + 3]);
    if (tag === "Xing" || tag === "Info" || tag === "VBRI") return true;
  }
  return false;
}

/** Every audio frame in the buffer, in order, skipping tags and junk. */
function frames(buf: Uint8Array): Frame[] {
  const out: Frame[] = [];
  let cursor = audioStart(buf);
  while (cursor < buf.length) {
    const frame = frameAt(buf, cursor);
    if (frame) {
      out.push(frame);
      cursor += frame.length;
      continue;
    }
    // Not a frame boundary — a trailing ID3v1 tag, or a byte of junk. Step
    // forward looking for the next sync rather than giving up on the file.
    cursor++;
  }
  return out;
}

/** Exact playing time of an MP3, from its frame count. */
export function mp3DurationMs(buf: Uint8Array): number {
  let ms = 0;
  for (const frame of frames(buf)) ms += (frame.samples / frame.sampleRate) * 1000;
  return Math.round(ms);
}

export type ConcatenatedMp3 = {
  audio: Uint8Array;
  /** Playing time of each input, in order — what shifts each piece's timings. */
  durationsMs: number[];
  totalMs: number;
};

/**
 * Concatenate MP3s into one playable file, reporting each part's exact duration.
 *
 * Rebuilt frame by frame rather than by joining the raw buffers: that drops the
 * ID3 tags and metadata frames that would otherwise land mid-chapter, and it
 * means the durations reported here are measured from the bytes actually
 * written rather than from the bytes handed in.
 */
export function concatMp3(parts: Uint8Array[]): ConcatenatedMp3 {
  const kept: Uint8Array[] = [];
  const durationsMs: number[] = [];
  let total = 0;

  for (const part of parts) {
    const all = frames(part);
    const audio = all.filter(
      (frame, i) => !(i === 0 && isHeaderFrame(part, frame))
    );
    let ms = 0;
    for (const frame of audio) {
      ms += (frame.samples / frame.sampleRate) * 1000;
      kept.push(part.subarray(frame.offset, frame.offset + frame.length));
      total += frame.length;
    }
    durationsMs.push(ms);
  }

  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of kept) {
    out.set(chunk, at);
    at += chunk.length;
  }

  return {
    audio: out,
    durationsMs: durationsMs.map((ms) => Math.round(ms)),
    totalMs: Math.round(durationsMs.reduce((a, b) => a + b, 0)),
  };
}
