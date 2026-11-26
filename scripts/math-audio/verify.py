#!/usr/bin/env python3
"""Check the built Math audio folder.

    python3 scripts/math-audio/verify.py [audio-folder] [--src dir-of-pre-encode-wavs]

Prints duration, channels, sample rate, peak, mean level and size for every file, flags
anything silent, clipped, mis-formatted or over length, then checks each loop's seam:
the file is decoded and joined to itself, and the kink (second difference) across the join
is compared with the kinks that occur naturally inside the file. With --src (the folder build.py reports,
or its --keep-wav folder) the decoded length is also compared with the source WAV, which
catches encoder padding (a gap).
"""
import array
import os
import re
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT = os.path.normpath(os.path.join(HERE, "../../ios/Tuttles/iPhone/Math/MathAssets/audio"))
FFMPEG = shutil.which("ffmpeg") or "/opt/homebrew/bin/ffmpeg"
FFPROBE = shutil.which("ffprobe") or "/opt/homebrew/bin/ffprobe"

EFFECTS = ("star-1 star-2 star-3 jump land slide lane step-1 step-2 step-3 step-4 throw thud warn crash "
           "caught power magnet jetpack spring board shield-break correct wrong tick tick-urgent free wave-up "
           "gameover door buy equip tap deny bell goal voice-1 voice-2 voice-3 voice-4 voice-5").split()
LOOPS = "music-run music-menu amb-hall amb-outside amb-cafeteria amb-gym amb-strange".split()
# name -> (min seconds, max seconds); effects without an entry must be under 2 s
LIMITS = {"jetpack": (3, 4), "wave-up": (0, 1.5), "gameover": (2, 3), "bell": (1, 2), "goal": (0, 2.5),
          "music-run": (60, 120), "music-menu": (30, 90), "amb-hall": (15, 30), "amb-outside": (15, 30),
          "amb-cafeteria": (15, 30), "amb-gym": (15, 30), "amb-strange": (30, 45)}
LIMITS.update({"voice-%d" % i: (0.4, 1.2) for i in range(1, 6)})


def probe(path):
    r = subprocess.run([FFPROBE, "-v", "error", "-select_streams", "a:0", "-show_entries",
                        "stream=channels,sample_rate,codec_name,bit_rate:format=duration", "-of",
                        "default=nw=1", path], capture_output=True, text=True).stdout
    d = dict(l.split("=", 1) for l in r.strip().splitlines())
    v = subprocess.run([FFMPEG, "-hide_banner", "-i", path, "-af", "volumedetect", "-f", "null", "-"],
                       capture_output=True, text=True).stderr
    mx = float(re.search(r"max_volume: (-?[\d.]+)", v).group(1))
    mean = float(re.search(r"mean_volume: (-?[\d.]+)", v).group(1))
    return d, mx, mean


def decode(path, ch):
    b = subprocess.run([FFMPEG, "-v", "error", "-i", path, "-f", "s16le", "-ac", str(ch), "-"],
                       capture_output=True).stdout
    a = array.array("h")
    a.frombytes(b)
    return a


def seam(path, ch, src=None):
    """Join the decoded file to itself and look for a click or a gap at the join."""
    a = decode(path, ch)
    frames = len(a) // ch
    worst, worst_max, quiet = 0.0, 0.0, 1e9
    for c in range(ch):
        x = a[c::ch]
        # curvature (second difference): a click is a kink far sharper than the signal's own
        d2 = sorted(abs(x[i - 1] - 2 * x[i] + x[i + 1]) for i in range(1, frames - 1))
        p999 = max(1, d2[int(len(d2) * 0.999)])
        j = max(abs(x[-2] - 2 * x[-1] + x[0]), abs(x[-1] - 2 * x[0] + x[1]))
        worst = max(worst, j / p999)
        worst_max = max(worst_max, j / max(1, d2[-1]))
        lead = 0
        while lead < frames and abs(x[lead]) <= 2:
            lead += 1
        trail = 0
        while trail < frames and abs(x[-1 - trail]) <= 2:
            trail += 1
        quiet = min(quiet, lead + trail)
    # pass: the join is no sharper than kinks that already occur inside the file
    ok = worst_max <= 1.0
    msg = "%d frames; kink at the join = %.2fx the file's sharpest internal kink (%.2fx its 99.9th percentile)" % (
        frames, worst_max, worst)
    if quiet > 220:
        msg += "; %.0f ms of digital silence at the edges (a rest in the source, or padding)" % (quiet / 44.1)
    if src and os.path.exists(src):
        import wave
        with wave.open(src) as w_:
            sf = w_.getnframes()
        msg += "; source WAV %d frames (%s)" % (sf, "same length, no encoder gap" if sf == frames else "LENGTH DIFFERS by %d" % (frames - sf))
        ok = ok and sf == frames
    return ok, msg


def main():
    args = sys.argv[1:]
    srcdir = None
    if "--src" in args:
        i = args.index("--src")
        srcdir = args[i + 1]
        del args[i:i + 2]
    folder = os.path.abspath(args[0]) if args else DEFAULT
    problems = []
    total = 0
    print("%-18s %8s %3s %6s %8s %8s %9s  %s" % ("file", "seconds", "ch", "rate", "peak dB", "mean dB", "bytes", "notes"))
    found = {}
    for f in sorted(os.listdir(folder)):
        p = os.path.join(folder, f)
        total += os.path.getsize(p)
        base, ext = os.path.splitext(f)
        if ext not in (".wav", ".m4a", ".caf"):
            continue
        found[base] = ext
        d, mx, mean = probe(p)
        dur, ch, sr, size = float(d["duration"]), int(d["channels"]), int(d["sample_rate"]), os.path.getsize(p)
        notes = []
        if mx < -30 or mean < -65:
            notes.append("SILENT?")
        if mx > -0.1:
            notes.append("CLIPPED?")
        lo, hi = LIMITS.get(base, (0, 2.0))
        if not lo <= dur <= hi:
            notes.append("LENGTH outside %s-%s s" % (lo, hi))
        if base in EFFECTS:
            if (ext, ch, sr, d["codec_name"]) != (".wav", 1, 44100, "pcm_s16le"):
                notes.append("FORMAT not mono 44.1k 16-bit wav")
            if size > 150_000:
                notes.append("over 150 KB (length needs it)")
        elif base in LOOPS:
            if ch != 2 or (ext == ".m4a" and d["codec_name"] != "aac"):
                notes.append("FORMAT not stereo AAC")
            if ext == ".m4a":
                notes.append("%d kbps" % (size * 8 / dur / 1000))
        else:
            notes.append("UNEXPECTED FILE")
        problems += ["%s: %s" % (f, n) for n in notes if n.split()[0].isupper() and n[0].isalpha() and n.split()[0] not in ("over",)]
        print("%-18s %8.2f %3d %6d %8.1f %8.1f %9d  %s" % (f, dur, ch, sr, mx, mean, size, ", ".join(notes)))
    for name in EFFECTS + LOOPS:
        if name not in found:
            problems.append("MISSING " + name)
    print("\ntotal folder size: %.2f MB (%d bytes)" % (total / 1e6, total))
    print("\nloop seams (file joined to itself):")
    for name in LOOPS + ["jetpack"]:
        if name not in found:
            continue
        ch = 1 if name == "jetpack" else 2
        src = os.path.join(srcdir, name + ".wav") if srcdir and name != "jetpack" else None
        ok, msg = seam(os.path.join(folder, name + found[name]), ch, src)
        print("  %-14s %s  %s" % (name, "ok  " if ok else "FAIL", msg))
        if not ok:
            problems.append("seam " + name)
    print("\nproblems: " + ("none" if not problems else "; ".join(problems)))
    sys.exit(1 if problems else 0)


if __name__ == "__main__":
    main()
