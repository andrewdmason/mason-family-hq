"""Small pure-python audio toolkit (no numpy) used by build.py.

Everything is a list of floats in -1..1 at SR. Slow but dependency-free; the
whole build takes a couple of minutes.
"""
import math
import os
import re
import shutil
import struct
import subprocess
import wave
from math import sin, cos, pi, exp, tan

SR = 44100
FFMPEG = shutil.which("ffmpeg") or "/opt/homebrew/bin/ffmpeg"


def n_(dur):
    return int(round(dur * SR))


# ---------------------------------------------------------------- sources

def osc(freq, dur, shape="sin", amp=1.0, phase=0.0):
    """freq is a number or a function of time in seconds."""
    n = n_(dur)
    ph = phase
    out = [0.0] * n
    if callable(freq):
        for i in range(n):
            ph += freq(i / SR) / SR
            out[i] = ph
    else:
        inc = freq / SR
        for i in range(n):
            ph += inc
            out[i] = ph
    if shape == "sin":
        return [amp * sin(2 * pi * p) for p in out]
    if shape == "saw":
        return [amp * (2 * (p - math.floor(p)) - 1) for p in out]
    if shape == "sq":
        return [amp if (p - math.floor(p)) < 0.5 else -amp for p in out]
    if shape == "tri":
        return [amp * (4 * abs((p - math.floor(p)) - 0.5) - 1) for p in out]
    raise ValueError(shape)


def white(n, rng):
    u = rng.uniform
    return [u(-1.0, 1.0) for _ in range(n)]


def bell(f, dur, tau, partials=((1, 1, 1), (2, 0.3, 0.6), (3, 0.15, 0.4), (4.07, 0.08, 0.3))):
    """Chime: decaying sine partials (ratio, level, decay scale)."""
    n = n_(dur)
    out = [0.0] * n
    for ratio, lvl, ds in partials:
        w = 2 * pi * f * ratio / SR
        k = 1.0 / (tau * ds * SR)
        for i in range(n):
            out[i] += lvl * sin(w * i) * exp(-i * k)
    na = max(1, n_(0.002))
    for i in range(min(na, n)):
        out[i] *= i / na
    return out


# ---------------------------------------------------------------- shaping

def decay(x, tau, attack=0.002):
    na = max(1, n_(attack))
    k = 1.0 / (tau * SR)
    return [v * min(1.0, i / na) * exp(-i * k) for i, v in enumerate(x)]


def hann(x, skew=1.0):
    n = len(x)
    return [v * sin(pi * ((i / n) ** skew)) ** 2 for i, v in enumerate(x)]


def fade(x, fin=0.002, fout=0.01):
    x = list(x)
    a = min(len(x) // 2, max(1, n_(fin)))
    b = min(len(x) // 2, max(1, n_(fout)))
    for i in range(a):
        x[i] *= i / a
    for i in range(b):
        x[-1 - i] *= i / b
    return x


def gain(x, g):
    return [v * g for v in x]


def mul(x, fn):
    """Multiply by a function of time."""
    return [v * fn(i / SR) for i, v in enumerate(x)]


def mix(layers):
    """layers: (samples, start seconds, gain)."""
    n = max(n_(at) + len(x) for x, at, g in layers)
    out = [0.0] * n
    for x, at, g in layers:
        o = n_(at)
        for i, v in enumerate(x):
            out[o + i] += v * g
    return out


def add_wrap(dst, src, at, g=1.0):
    """Mix src into the loop dst, wrapping past the end back to the start."""
    n = len(dst)
    o = n_(at) % n
    for i, v in enumerate(src):
        dst[(o + i) % n] += v * g


def speed(x, r):
    """Play back r times faster (pitch and length change together)."""
    n = int((len(x) - 1) / r)
    out = [0.0] * n
    for i in range(n):
        p = i * r
        j = int(p)
        f = p - j
        out[i] = x[j] * (1 - f) + x[j + 1] * f
    return out


def svf(x, fc, q=0.707, mode="lp"):
    """State-variable filter (stable at any cutoff). fc: Hz or function of time."""
    k = 1.0 / q
    var = callable(fc)
    lim = SR * 0.49

    def coef(f):
        g = tan(pi * max(10.0, min(f, lim)) / SR)
        a1 = 1.0 / (1.0 + g * (g + k))
        a2 = g * a1
        return a1, a2, g * a2

    a1, a2, a3 = coef(fc(0.0) if var else fc)
    ic1 = ic2 = 0.0
    out = [0.0] * len(x)
    m = {"lp": 0, "bp": 1, "hp": 2}[mode]
    for i, v in enumerate(x):
        if var and not (i & 15):
            a1, a2, a3 = coef(fc(i / SR))
        v3 = v - ic2
        v1 = a1 * ic1 + a2 * v3
        v2 = ic2 + a2 * ic1 + a3 * v3
        ic1 = 2 * v1 - ic1
        ic2 = 2 * v2 - ic2
        if m == 0:
            out[i] = v2
        elif m == 1:
            out[i] = k * v1
        else:
            out[i] = v - k * v1 - v2
    return out


def reverb(x, rt=0.8, wet=0.25, tail=None, damp=5000):
    """Small Schroeder reverb: four combs, two allpasses."""
    n = len(x) + n_(rt if tail is None else tail)
    xin = list(x) + [0.0] * (n - len(x))
    acc = [0.0] * n
    for d_ms in (29.7, 37.1, 41.1, 43.7):
        d = int(d_ms * SR / 1000)
        g = 10 ** (-3 * (d / SR) / rt)
        buf = [0.0] * d
        j = 0
        for i in range(n):
            y = buf[j]
            buf[j] = xin[i] + g * y
            acc[i] += y
            j += 1
            if j == d:
                j = 0
    for d_ms in (5.0, 1.7):
        d = int(d_ms * SR / 1000)
        buf = [0.0] * d
        j = 0
        for i in range(n):
            b = buf[j]
            y = b - 0.7 * acc[i]
            buf[j] = acc[i] + 0.7 * y
            acc[i] = y
            j += 1
            if j == d:
                j = 0
    acc = svf(acc, damp, 0.707, "lp")
    return [xin[i] * (1 - wet) + acc[i] * wet * 0.4 for i in range(n)]


def loop_noise(dur, rng, proc, xf=1.0):
    """Filtered noise that repeats seamlessly: the tail is cross-faded into the head."""
    n = n_(dur)
    x = n_(xf)
    raw = proc(white(n + x, rng))
    return fold(raw, n)


def fold(raw, n):
    """Equal-power cross-fade of everything past n back into the start."""
    x = len(raw) - n
    out = raw[:n]
    for i in range(x):
        a = i / x
        out[i] = raw[i] * sin(a * pi / 2) + raw[n + i] * cos(a * pi / 2)
    return out


# ---------------------------------------------------------------- levels and files

def peak(*chans):
    return max(max(abs(v) for v in c) for c in chans)


def normalize(chans, db=-3.0):
    p = peak(*chans) or 1.0
    g = 10 ** (db / 20) / p
    return [[v * g for v in c] for c in chans]


def trim(x, thr_db=-50.0):
    p = peak(x) or 1.0
    t = p * 10 ** (thr_db / 20)
    a = 0
    while a < len(x) and abs(x[a]) < t:
        a += 1
    b = len(x)
    while b > a and abs(x[b - 1]) < t:
        b -= 1
    return x[a:b]


def finish(x, db=-3.0, fin=0.001, fout=0.008, maxlen=None):
    """Trim silence, optionally cap the length, fade the edges, peak-normalise."""
    x = trim(x)
    if maxlen and len(x) > n_(maxlen):
        x = fade(x[: n_(maxlen)], 0.0, 0.12)
    x = fade(x, fin, fout)
    return normalize([x], db)[0]


def write_wav(path, chans):
    n = len(chans[0])
    frames = bytearray()
    pk = struct.Struct("<h").pack
    for i in range(n):
        for c in chans:
            frames += pk(int(round(max(-1.0, min(1.0, c[i])) * 32767)))
    with wave.open(path, "wb") as w:
        w.setnchannels(len(chans))
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(bytes(frames))


def decode_raw(path, channels, extra=()):
    """Decode any audio file to s16le bytes at SR."""
    if not os.path.exists(path):
        raise SystemExit("missing source file: " + path)
    with open(path, "rb") as f:
        if b"git-lfs" in f.read(60):
            raise SystemExit("still a Git LFS pointer (run lfs.sh on its pack first): " + path)
    r = subprocess.run([FFMPEG, "-v", "error", "-i", path, *extra, "-ac", str(channels),
                        "-ar", str(SR), "-f", "s16le", "-"], capture_output=True)
    if r.returncode or not r.stdout:
        raise SystemExit("ffmpeg could not decode %s: %s" % (path, r.stderr.decode()[:300]))
    return r.stdout


def load(path):
    """Decode to mono floats."""
    b = decode_raw(path, 1)
    return [v / 32768.0 for v in struct.unpack("<%dh" % (len(b) // 2), b)]


def encode_m4a(wav, out, pad=4096):
    """Stereo AAC at 128 kbps that loops without a gap or a tick.

    Apple's encoder (afconvert) records how many decoded frames are encoder priming and
    padding, so players return exactly the source frames. On top of that the loop is encoded
    with `pad` frames of its own end in front and of its own start behind, and those are then
    declared as extra priming/padding (the iTunSMPB tag). The encoder therefore never sees a
    hard start or stop at the loop points, which otherwise leaves a few samples of noise there.
    """
    if os.path.exists(out):
        os.remove(out)
    if not shutil.which("afconvert"):
        print("  afconvert not found: plain ffmpeg AAC for %s (the loop join will not be as clean)" % out)
        subprocess.run([FFMPEG, "-v", "error", "-y", "-i", wav, "-c:a", "aac", "-b:a", "128k", out],
                       check=True)
        return
    with wave.open(wav, "rb") as w:
        params, n = w.getparams(), w.getnframes()
        pcm = w.readframes(n)
    fb = params.nchannels * params.sampwidth
    padded = wav + ".padded.wav"
    with wave.open(padded, "wb") as w:
        w.setparams(params)
        w.writeframes(pcm[-pad * fb:] + pcm + pcm[: pad * fb])
    try:
        subprocess.run(["afconvert", "-f", "m4af", "-d", "aac", "-b", "128000", "-q", "127",
                        "-s", "0", padded, out], check=True)
    finally:
        os.remove(padded)
    with open(out, "rb") as f:
        b = f.read()
    m = re.search(rb"iTunSMPB.{0,64}? 00000000 ([0-9A-F]{8}) ([0-9A-F]{8}) ([0-9A-F]{16})", b, re.S)
    if not m or int(m.group(3), 16) != n + 2 * pad:
        raise SystemExit("could not find the gapless tag in " + out)
    prim, rem = int(m.group(1), 16), int(m.group(2), 16)
    new = b"%08X %08X %016X" % (prim + pad, rem + pad, n)
    b = b[: m.start(1)] + new + b[m.end(3):]
    with open(out, "wb") as f:
        f.write(b)
