// Browser-only half of pitch auto-detection: fetch the at-bat's video and decode
// its sound to mono samples. Resampling to 22.05kHz keeps the glove-pop band
// (up to ~11kHz) and halves the work.

const RATE = 22050;

export async function decodeAudio(
  url: string,
  onProgress: (fraction: number) => void,
  signal: AbortSignal,
): Promise<{ samples: Float32Array; rate: number }> {
  const res = await fetch(url, { signal });
  if (!res.ok || !res.body) throw new Error(`Couldn't download the video (${res.status})`);
  const total = Number(res.headers.get("content-length")) || 0;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    if (total) onProgress(got / total);
  }
  const bytes = new Uint8Array(got);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.length;
  }

  // An OfflineAudioContext decodes straight to its own sample rate.
  const ctx = new OfflineAudioContext(1, 1, RATE);
  let audio: AudioBuffer;
  try {
    audio = await ctx.decodeAudioData(bytes.buffer);
  } catch {
    throw new Error("This browser couldn't read the video's sound");
  }
  const samples = new Float32Array(audio.length);
  for (let c = 0; c < audio.numberOfChannels; c++) {
    const ch = audio.getChannelData(c);
    for (let i = 0; i < ch.length; i++) samples[i] += ch[i] / audio.numberOfChannels;
  }
  return { samples, rate: audio.sampleRate };
}
