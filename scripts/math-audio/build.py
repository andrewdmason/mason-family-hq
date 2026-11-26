#!/usr/bin/env python3
"""Build every sound for the Math runner (ios/Tuttles/iPhone/Math/MathAssets/audio).

    python3 scripts/math-audio/build.py <jam-folder> [out-folder] [--only a,b] [--keep-wav dir]

<jam-folder> is a checkout of the free-asset library holding the Kenney packs
(kenney-music-loops, kenney-impact-sounds, kenney-interface-sounds), with the
Git LFS pointers already replaced by the real .ogg files.
Everything else is synthesised here. All output is CC0 / original.
"""
import array
import os
import random
import struct
import subprocess
import sys
import tempfile
from math import sin, cos, pi, exp

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from synth import (SR, FFMPEG, n_, osc, white, bell, decay, hann, fade, gain, mul, mix, add_wrap,  # noqa: E402
                   speed, svf, reverb, loop_noise, fold, normalize, finish, write_wav, decode_raw,
                   load, encode_m4a)

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_OUT = os.path.normpath(os.path.join(HERE, "../../ios/Tuttles/iPhone/Math/MathAssets/audio"))

IMP = "kenney-impact-sounds/audio/Audio/"
UI = "kenney-interface-sounds/audio/Audio/"
MUS = "kenney-music-loops/audio/Loops/"

# The two music choices. Change these names to try another Kenney loop.
RUN_LOOP = "Flowing Rocks"
RUN_PASSES = 3
MENU_LOOP = "Mishief Stroll"
# Exact musical length of a loop in seconds, where the pack file is not a whole number of
# beats long (measured from the beat period; a file that is 30 ms too long stumbles every time
# it repeats). Longer file: cut, and let the cut-off tail ring over the start. Shorter: pad.
#   Flowing Rocks: 125.00 bpm, file is 64.06 beats  -> 64 beats = 30.72 s
#   Mishief Stroll: beat 0.9973 s, file is 31.92 beats -> 32 beats = 31.913 s
LOOP_SECONDS = {"Flowing Rocks": 30.72, "Mishief Stroll": 31.913}

JAM = None
USED = {}  # output name -> pack files it used


def pk(name, rel):
    USED.setdefault(name, []).append(rel)
    return load(os.path.join(JAM, rel))


def rng_for(name):
    return random.Random("math-audio:" + name)


# ================================================================ effects

def star(k):
    f = (1046.5, 1318.5, 1568.0)[k]
    a = decay(mix([(osc(f, 0.06), 0, 1), (osc(f * 2, 0.06), 0, 0.3)]), 0.05)
    b = decay(mix([(osc(f * 1.5, 0.26), 0, 1), (osc(f * 3, 0.26), 0, 0.22)]), 0.07)
    return mix([(a, 0, 1), (b, 0.045, 1)])


def jump():
    f = lambda t: 280 * 2.9 ** (t / 0.2)
    x = mix([(osc(f, 0.22, "tri"), 0, 0.7), (osc(f, 0.22), 0, 0.6)])
    return svf(decay(x, 0.1, 0.006), 3000)


def land(name):
    return mix([(pk(name, IMP + "footstep_concrete_004.ogg"), 0, 1.0),
                (speed(pk(name, IMP + "impactSoft_medium_000.ogg"), 0.8), 0.004, 0.8)])


def slide(name):
    r = rng_for(name)
    d = 0.5
    nz = white(n_(d), r)
    x = mix([(svf(nz, lambda t: 2600 - 1500 * t / d, 1.2, "bp"), 0, 1.0),
             (svf(nz, 520, 1.0, "bp"), 0, 0.5)])
    x = mul(x, lambda t: 0.75 + 0.25 * sin(2 * pi * 38 * t))
    return decay(x, 0.2, 0.015)


def lane(name):
    r = rng_for(name)
    d = 0.2
    x = svf(white(n_(d), r), lambda t: 700 + 1500 * sin(pi * t / d), 1.5, "bp")
    return hann(x)


def throw(name):
    r = rng_for(name)
    d = 0.42
    x = svf(white(n_(d), r), lambda t: 400 + 2600 * sin(pi * (t / d) ** 0.7) ** 2, 2.5, "bp")
    return hann(x, 1.4)


def thud(name):
    return mix([(speed(pk(name, IMP + "impactPunch_heavy_000.ogg"), 0.8), 0, 1.0),
                (speed(pk(name, IMP + "impactSoft_heavy_000.ogg"), 0.75), 0.005, 0.9),
                (decay(osc(lambda t: 95 - 60 * t, 0.3, "tri"), 0.08), 0, 0.5)])


def warn(name):
    r = rng_for(name)
    return mix([(decay(osc(1250, 0.08), 0.018, 0.0005), 0, 1.0),
                (decay(osc(2500, 0.05), 0.01, 0.0005), 0, 0.3),
                (svf(white(n_(0.002), r), 2000, 0.7, "hp"), 0, 0.5)])


def step(name, k):
    x = pk(name, IMP + "footstep_concrete_00%d.ogg" % k)
    return svf(svf(x, 140, 0.7, "hp"), 6500)


def crash(name):
    return mix([(pk(name, IMP + "impactWood_heavy_000.ogg"), 0, 1.0),
                (pk(name, IMP + "impactMetal_medium_000.ogg"), 0.05, 0.8),
                (pk(name, IMP + "impactPlank_medium_000.ogg"), 0.12, 0.9),
                (pk(name, IMP + "impactTin_medium_000.ogg"), 0.31, 0.6),
                (speed(pk(name, IMP + "impactWood_medium_001.ogg"), 1.2), 0.43, 0.5)])


def caught(name):
    dy = mix([(osc(98, 0.9, "tri"), 0, 1), (osc(103.8, 0.9, "tri"), 0, 1),
              (osc(196, 0.9), 0, 0.35), (osc(207.7, 0.9), 0, 0.35)])
    return mix([(speed(pk(name, IMP + "impactPunch_medium_000.ogg"), 0.8), 0, 1.0),
                (decay(osc(lambda t: 120 - 100 * t, 0.7, "tri"), 0.3), 0, 0.7),
                (decay(svf(dy, 700), 0.4, 0.01), 0.02, 0.45)])


def power(name):
    r = rng_for(name)
    notes = (523.3, 659.3, 784.0, 1046.5, 1318.5, 1568.0)
    ls = [(bell(f, 0.6 if i == 5 else 0.35, 0.3 if i == 5 else 0.12), i * 0.05, 0.8) for i, f in enumerate(notes)]
    sh = svf(white(n_(0.6), r), 6000, 0.7, "hp")
    sh = mul(sh, lambda t: (t / 0.3) ** 2 if t < 0.3 else exp(-(t - 0.3) / 0.08))
    return mix(ls + [(sh, 0, 0.09)])


def magnet(name):
    r = rng_for(name)
    d = 0.32
    car = osc(lambda t: 140 + 500 * t / d, d, "saw")
    car = mul(car, lambda t: 1.0 if sin(2 * pi * 60 * t) > 0 else -0.6)
    gates = [r.random() < 0.55 for _ in range(int(d / 0.008) + 2)]
    cr = svf(white(n_(d), r), 3000, 2.0, "bp")
    cr = mul(cr, lambda t: 1.0 if gates[int(t / 0.008)] else 0.0)
    x = svf(mix([(car, 0, 0.7), (cr, 0, 0.8)]), 5000)
    return fade(x, 0.003, 0.04)


def jetpack(name):
    r = rng_for(name)
    d = 3.2

    def proc(nz):
        return mix([(svf(nz, 900), 0, 1.0), (svf(nz, 180, 1.0, "bp"), 0, 1.5),
                    (svf(nz, 3000, 0.7, "hp"), 0, 0.12)])

    x = loop_noise(d, r, proc, 0.5)
    # flutter rates are whole numbers of cycles over the loop, so the seam stays exact
    return mul(x, lambda t: 1 + 0.18 * sin(2 * pi * 27.5 * t) + 0.1 * sin(2 * pi * 11.25 * t))


def spring():
    d = 0.55
    f = lambda t: 200 + 250 * t / d + 60 * exp(-t * 4) * sin(2 * pi * 30 * t)
    x = mix([(osc(f, d, "tri"), 0, 0.8), (osc(lambda t: 2 * f(t), d), 0, 0.3)])
    return decay(x, 0.2, 0.004)


def board(name):
    r = rng_for(name)
    roll = svf(svf(white(n_(0.7), r), 650, 0.8, "bp"), 2000)
    roll = mul(roll, lambda t: 0.55 + 0.45 * abs(sin(2 * pi * 17 * t)) ** 4)
    return mix([(speed(pk(name, IMP + "impactWood_medium_002.ogg"), 1.1), 0, 1.0),
                (pk(name, IMP + "impactGeneric_light_000.ogg"), 0.02, 0.6),
                (decay(roll, 0.28, 0.02), 0.01, 1.4)])


def shield_break(name):
    return mix([(pk(name, IMP + "impactWood_heavy_001.ogg"), 0, 1.0),
                (pk(name, IMP + "impactPlank_medium_002.ogg"), 0.03, 0.9),
                (speed(pk(name, IMP + "impactWood_light_001.ogg"), 1.3), 0.16, 0.7),
                (speed(pk(name, IMP + "impactWood_light_003.ogg"), 1.5), 0.26, 0.5),
                (fade(osc(lambda t: 700 - 1700 * t, 0.3, "tri"), 0.005, 0.1), 0.05, 0.22)])


def correct():
    x = mix([(bell(783.99, 0.9, 0.35), 0, 0.8), (bell(987.77, 0.9, 0.35), 0, 0.6),
             (bell(1174.66, 0.9, 0.4), 0.13, 0.8), (bell(1567.98, 0.9, 0.4), 0.13, 0.7)])
    return reverb(x, 0.6, 0.15)


def wrong():
    a = fade(osc(185, 0.17, "saw"), 0.008, 0.03)
    b = fade(osc(139, 0.27, "saw"), 0.008, 0.06)
    return svf(mix([(a, 0, 1), (b, 0.19, 1)]), 800)


def tick(name, urgent):
    r = rng_for(name)
    if urgent:
        return mix([(decay(osc(3300, 0.06), 0.008, 0.0003), 0, 1.0),
                    (decay(osc(1650, 0.06), 0.012, 0.0003), 0, 0.6),
                    (svf(white(n_(0.002), r), 3000, 0.7, "hp"), 0, 0.9)])
    return mix([(decay(osc(2300, 0.05), 0.006, 0.0003), 0, 0.8),
                (decay(osc(950, 0.05), 0.012, 0.0003), 0, 0.7),
                (svf(white(n_(0.0015), r), 2000, 0.7, "hp"), 0, 0.5)])


def free(name):
    r = rng_for(name)
    d = 0.5
    w = svf(white(n_(d), r), lambda t: 350 * 12 ** (t / d), 2.0, "bp")
    w = fade(mul(w, lambda t: (t / d) ** 1.5), 0.0, 0.06)
    ch = [(bell(f, 0.9, 0.3), 0.38 + i * 0.025, 0.6) for i, f in enumerate((1046.5, 1318.5, 1568.0, 2093.0))]
    return reverb(mix([(w, 0, 0.8)] + ch), 0.6, 0.15)


def chip(f, d, tau):
    return decay(mix([(osc(f, d, "tri"), 0, 0.7), (osc(f, d), 0, 0.5), (osc(2 * f, d), 0, 0.15)]), tau, 0.003)


def wave_up():
    ls = [(chip(f, 0.11, 0.07), i * 0.08, 0.8) for i, f in enumerate((523.3, 659.3, 784.0))]
    ls += [(chip(f, 0.9, 0.3), 0.24, g) for f, g in ((1046.5, 0.8), (1318.5, 0.55), (1568.0, 0.45))]
    ls += [(bell(2093.0, 0.7, 0.25), 0.24, 0.25)]
    return reverb(mix(ls), 0.5, 0.15)


def gameover():
    ls = []
    for i, f in enumerate((440.0, 349.2, 293.7, 207.7)):
        d, tau = (1.5, 0.9) if i == 3 else (0.9, 0.5)
        n = mix([(osc(f * 0.994, d), 0, 0.5), (osc(f * 1.006, d), 0, 0.5), (osc(f * 2, d), 0, 0.12),
                 (osc(f, d, "tri"), 0, 0.15)])
        ls.append((decay(n, tau, 0.012), i * 0.45, 0.8))
    low = mix([(osc(103.8, 1.4, "tri"), 0, 1), (osc(104.6, 1.4, "tri"), 0, 1)])
    ls.append((fade(svf(low, 500), 0.25, 0.9), 1.35, 0.28))
    return reverb(mix(ls), 1.5, 0.3)


def door(name):
    r = rng_for(name)
    w = svf(white(n_(0.4), r), lambda t: 200 + 900 * sin(pi * t / 0.4) ** 2, 0.9)
    slam = mix([(speed(pk(name, IMP + "impactWood_heavy_003.ogg"), 0.55), 0, 1.0),
                (speed(pk(name, IMP + "impactMetal_heavy_000.ogg"), 0.5), 0.004, 0.5),
                (decay(osc(lambda t: 70 - 50 * t, 0.45, "tri"), 0.12), 0, 0.8)])
    return mix([(hann(w, 1.3), 0, 0.45), (reverb(slam, 1.0, 0.3), 0.36, 1.0)])


def buy(name):
    r = rng_for(name)
    ls = [(pk(name, IMP + "impactTin_medium_000.ogg"), 0, 0.5),
          (bell(2637.0, 0.6, 0.25), 0.06, 0.7), (bell(3520.0, 0.8, 0.35), 0.13, 0.7)]
    for _ in range(5):
        ls.append((bell(r.uniform(4000, 6000), 0.2, 0.05), r.uniform(0.2, 0.5), 0.12))
    return mix(ls)


def equip(name):
    return mix([(pk(name, UI + "drop_002.ogg"), 0, 1.0),
                (decay(osc(lambda t: 500 + 400 * t / 0.04, 0.04), 0.02), 0, 0.4)])


def tap(name):
    return pk(name, UI + "click_001.ogg")


def deny():
    a = fade(osc(233.1, 0.09, "tri"), 0.005, 0.02)
    b = fade(osc(196.0, 0.14, "tri"), 0.005, 0.04)
    return svf(mix([(a, 0, 1), (b, 0.14, 1)]), 1200)


def school_bell(name):
    r = rng_for(name)
    d, ring, rate = 1.5, 1.15, 22.0
    n = n_(d)
    parts = ((1480, 1.0), (2230, 0.8), (2960, 0.6), (3890, 0.5), (4720, 0.35), (5830, 0.25))
    tone = [0.0] * n
    for f, a in parts:
        w = 2 * pi * f / SR
        for i in range(n):
            tone[i] += a * sin(w * i)
    fast = slow = 0.0
    kf, ks = exp(-1 / (0.03 * SR)), exp(-1 / (0.3 * SR))
    period = int(SR / rate)
    click = svf(white(n, r), 3500, 0.7, "hp")
    out = [0.0] * n
    ce = 0.0
    for i in range(n):
        if i < n_(ring) and i % period == 0:
            fast += 1.0
            slow = min(1.0, slow + 0.25)
            ce = 1.0
        out[i] = tone[i] * (0.6 * fast + 0.5 * slow) + click[i] * ce * 0.5
        fast *= kf
        slow *= ks
        ce *= 0.985
    return out


def brass(f, d):
    x = mix([(osc(f, d, "saw"), 0, 0.6), (osc(f * 1.004, d, "saw"), 0, 0.4)])
    return fade(svf(x, lambda t: 900 + 2200 * min(1.0, t / 0.04), 0.9), 0.012, 0.05)


def goal():
    c5, e5, g5, c6 = 523.3, 659.3, 784.0, 1046.5
    ls = [(brass(c5, 0.11), 0.0, 0.8), (brass(c5, 0.11), 0.15, 0.8), (brass(c5, 0.11), 0.30, 0.8),
          (brass(e5, 0.2), 0.45, 0.8),
          (fade(brass(g5, 1.1), 0.012, 0.5), 0.68, 0.7), (fade(brass(e5, 1.1), 0.012, 0.5), 0.68, 0.4),
          (fade(brass(c5, 1.1), 0.012, 0.5), 0.68, 0.4), (bell(c6, 0.9, 0.35), 0.68, 0.3)]
    return reverb(mix(ls), 0.7, 0.18)


VOICES = (
    (108, ((0.20, 0, 1.0), (0.20, -1, 0.9), (0.32, -3, 1.0))),
    (98, ((0.24, 0, 1.0), (0.28, -2, 1.0))),
    (115, ((0.17, 0, 0.8), (0.17, 1, 1.0), (0.20, 0, 0.9), (0.17, -1, 0.8), (0.36, -4, 1.0))),
    (92, ((0.50, -1, 1.0),)),
    (104, ((0.20, 0, 1.0), (0.18, 0, 0.7), (0.20, -1, 0.9), (0.30, 2, 1.0))),
)


def voice(k):
    """A cartoon teacher's 'wah wah': a low sawtooth through two moving formants."""
    f0, sylls = VOICES[k]
    op, pit = [], []
    prev = sylls[0][1]
    for d, semi, openness in sylls:
        ns = n_(d)
        for i in range(ns):
            u = i / ns
            op.append(openness * sin(pi * u) ** 0.6)
            pit.append(prev + (semi - prev) * min(1.0, u * 4))
        prev = semi
    n = len(op)
    ph = 0.0
    src = [0.0] * n
    for i in range(n):
        t = i / SR
        ph += f0 * 2 ** (pit[i] / 12) * (1 + 0.02 * sin(2 * pi * 5.3 * t) - 0.03 * t) / SR
        src[i] = 2 * (ph - int(ph)) - 1
    at = lambda t: min(n - 1, int(t * SR))
    f1 = svf(src, lambda t: 320 + 480 * op[at(t)], 4.0, "bp")
    f2 = svf(src, lambda t: 950 + 350 * op[at(t)], 5.0, "bp")
    body = svf(src, 250)
    x = [(f1[i] + 0.5 * f2[i] + 0.3 * body[i]) * (0.15 + 0.85 * op[i]) for i in range(n)]
    return fade(svf(svf(x, 2800), 2200), 0.01, 0.04)


def effects():
    """name -> (builder, credit, options for finish())."""
    S = "synthesised"
    e = {}
    for k in range(3):
        e["star-%d" % (k + 1)] = (lambda n, k=k: star(k), S + ": two-note sine blip, pitch step %d of 3" % (k + 1), {})
    e["jump"] = (lambda n: jump(), S + ": rising triangle/sine sweep", {})
    e["land"] = (land, "layered and pitched", {})
    e["slide"] = (slide, S + ": band-passed noise scrape with a falling centre", {})
    e["lane"] = (lane, S + ": short band-passed noise whoosh", {"fin": 0.0, "fout": 0.0})
    for k in range(4):
        e["step-%d" % (k + 1)] = (lambda n, k=k: step(n, k), "filtered", {"fout": 0.004})
    e["throw"] = (throw, S + ": resonant noise whoosh sweeping up and back", {"fin": 0.0, "fout": 0.0})
    e["thud"] = (thud, "layered and pitched down, plus a synthesised low thump", {})
    e["warn"] = (warn, S + ": woodblock-like damped tone", {"fin": 0.0})
    e["crash"] = (crash, "five impacts layered into a clatter", {})
    e["caught"] = (caught, "pitched down, under a synthesised low falling tone and a close low dyad", {})
    e["power"] = (power, S + ": rising arpeggio of chime tones with a noise shimmer", {})
    e["magnet"] = (magnet, S + ": ring-modulated sawtooth with gated noise crackle", {})
    e["jetpack"] = (jetpack, S + ": filtered noise roar with flutter; a seamless 3.2 s loop", {"loop": True})
    e["spring"] = (lambda n: spring(), S + ": triangle tone with a wobbling, rising pitch", {})
    e["board"] = (board, "impacts over synthesised rolling-wheel noise", {})
    e["shield-break"] = (shield_break, "wood impacts layered, with a synthesised falling tone", {})
    e["correct"] = (lambda n: correct(), S + ": two rising chime dyads (G major)", {})
    e["wrong"] = (lambda n: wrong(), S + ": two low filtered sawtooth notes, falling", {})
    e["tick"] = (lambda n: tick(n, False), S + ": damped click", {"fin": 0.0})
    e["tick-urgent"] = (lambda n: tick(n, True), S + ": brighter, higher damped click", {"fin": 0.0})
    e["free"] = (free, S + ": rising noise whoosh into a chime arpeggio", {})
    e["wave-up"] = (lambda n: wave_up(), S + ": quick rising arpeggio into a major chord", {"maxlen": 1.4})
    e["gameover"] = (lambda n: gameover(), S + ": four falling detuned notes ending on a tritone, over a low drone", {"maxlen": 2.8})
    e["door"] = (door, "pitched-down impacts with reverb after a synthesised low whoosh", {"maxlen": 1.6})
    e["buy"] = (buy, "under synthesised high chimes ('ka-ching')", {})
    e["equip"] = (equip, "with a tiny synthesised pop", {})
    e["tap"] = (tap, "trimmed", {})
    e["deny"] = (lambda n: deny(), S + ": two blunt low triangle notes", {})
    e["bell"] = (school_bell, S + ": inharmonic metal partials struck 22 times a second, then ringing out", {})
    e["goal"] = (lambda n: goal(), S + ": short brass-like fanfare (filtered sawtooths)", {"maxlen": 2.4})
    for k in range(5):
        e["voice-%d" % (k + 1)] = (lambda n, k=k: voice(k), S + ": low sawtooth through two moving formant filters ('wah-wah' teacher murmur, no speech)", {"fout": 0.03})
    return e


# ================================================================ ambience loops

def stereo_bed(name, dur, proc):
    r = rng_for(name + ":bed")
    return [loop_noise(dur, r, proc), loop_noise(dur, r, proc)]


def babble(name, dur, voices, f0lo, f0hi, rlo, rhi, lp, xf=1.5):
    """Distant crowd murmur: many low sawtooth 'voices' with syllable-shaped loudness."""
    r = rng_for(name + ":babble")
    n = n_(dur + xf)
    L = [0.0] * n
    R = [0.0] * n
    B = 64
    for _ in range(voices):
        base = r.uniform(f0lo, f0hi)
        r1, r2 = r.uniform(0.15, 0.4), r.uniform(0.5, 1.1)
        rate, pr = r.uniform(rlo, rhi), r.uniform(0.08, 0.2)
        p1, p2, p3, p4 = (r.uniform(0, 2 * pi) for _ in range(4))
        pan = r.uniform(0.1, 0.9)
        gl, gr = cos(pan * pi / 2), sin(pan * pi / 2)
        ph = r.random()
        a = 0.0
        for b in range(0, n, B):
            t = b / SR
            f = base * (1 + 0.10 * sin(2 * pi * r1 * t + p1) + 0.06 * sin(2 * pi * r2 * t + p2))
            syl = max(0.0, sin(2 * pi * rate * t + p3 + 1.3 * sin(2 * pi * rate * 0.37 * t)))
            phr = min(1.0, max(0.0, 0.5 + 1.5 * sin(2 * pi * pr * t + p4)))
            da = (syl ** 1.5 * phr - a) / B
            inc = f / SR
            for i in range(b, min(n, b + B)):
                ph += inc
                ph -= int(ph)
                a += da
                s = (2 * ph - 1) * a
                L[i] += s * gl
                R[i] += s * gr
    out = []
    for c in (L, R):
        c = svf(svf(c, lp), 180, 0.7, "hp")
        out.append(fold(c, n_(dur)))
    return out


def rms(c):
    return (sum(v * v for v in c) / len(c)) ** 0.5


def scale_to(chans, target_rms):
    g = target_rms / max(1e-9, max(rms(c) for c in chans))
    return [gain(c, g) for c in chans]


def place(chans, src, at, g, pan):
    add_wrap(chans[0], src, at, g * cos(pan * pi / 2))
    add_wrap(chans[1], src, at, g * sin(pan * pi / 2))


def amb_hall(name):
    d = 24.0
    bed = stereo_bed(name, d, lambda nz: mix([(svf(nz, 220), 0, 1.0), (svf(nz, 900, 0.5, "bp"), 0, 0.06)]))
    bed = scale_to(bed, 0.05)
    mur = scale_to(babble(name, d, 7, 90, 240, 2.5, 4.5, 650), 0.035)
    ch = [[a + b for a, b in zip(bed[i], mur[i])] for i in range(2)]
    clunk = reverb(svf(speed(pk(name, IMP + "impactMetal_light_000.ogg"), 0.6), 900), 1.4, 0.6)
    knock = reverb(svf(speed(pk(name, IMP + "impactWood_heavy_002.ogg"), 0.7), 900), 1.4, 0.6)
    place(ch, clunk, 6.3, 0.5, 0.3)
    place(ch, knock, 15.8, 0.4, 0.7)
    return ch, -9.0, ("synthesised room tone (filtered noise) and distant murmur (low sawtooth 'voices'); "
                      "two far-off clunks from the pack files")


def chirp(f0, f1, d):
    f = lambda t: f0 + (f1 - f0) * t / d
    return hann(mix([(osc(f, d), 0, 1.0), (osc(lambda t: 2 * f(t), d), 0, 0.15)]))


def amb_outside(name):
    d = 26.0
    r = rng_for(name)
    wind = stereo_bed(name, d, lambda nz: svf(nz, 420, 0.6))
    rust = stereo_bed(name + ":leaves", d, lambda nz: svf(nz, 3500, 0.7, "bp"))
    ch = []
    for i in range(2):
        p1, p2 = r.uniform(0, 6.28), r.uniform(0, 6.28)
        # gusts: whole cycles over the loop, so they repeat exactly
        g = lambda t: 0.55 + 0.3 * sin(2 * pi * 2 * t / d + p1) + 0.15 * sin(2 * pi * 5 * t / d + p2)
        w = scale_to([wind[i]], 0.06)[0]
        l = scale_to([rust[i]], 0.012)[0]
        ch.append([w[k] * g(k / SR) + l[k] * g(k / SR) ** 2 for k in range(len(w))])
    for _ in range(24):
        # keep calls clear of the loop point so nothing loud straddles the join
        at, pan, lvl = r.uniform(0.5, d - 1.5), r.uniform(0.05, 0.95), r.uniform(0.06, 0.3)
        kind = r.choice("AABC")
        if kind == "A":  # rising tweets
            f = r.uniform(2800, 3600)
            for j in range(r.randint(3, 5)):
                place(ch, chirp(f, f * 1.35, 0.07), at + j * 0.14, lvl, pan)
        elif kind == "B":  # fast falling trill
            f = r.uniform(4500, 5600)
            for j in range(r.randint(7, 12)):
                place(ch, chirp(f, f * 0.8, 0.03), at + j * 0.055, lvl * 0.8, pan)
        else:  # two-note call
            f = r.uniform(3300, 3900)
            place(ch, chirp(f, f * 0.98, 0.2), at, lvl, pan)
            place(ch, chirp(f * 0.84, f * 0.82, 0.26), at + 0.27, lvl, pan)
    return ch, -9.0, "synthesised: gusting filtered-noise wind and leaf rustle, sine-sweep bird calls"


def amb_cafeteria(name):
    d = 24.0
    r = rng_for(name)
    bed = scale_to(stereo_bed(name, d, lambda nz: svf(nz, 300)), 0.04)
    mur = scale_to(babble(name, d, 14, 100, 360, 3.0, 5.5, 1100), 0.07)
    ch = [[a + b for a, b in zip(bed[i], mur[i])] for i in range(2)]
    files = ["impactPlate_light_000", "impactPlate_light_001", "impactPlate_light_002",
             "impactPlate_medium_000", "impactPlate_medium_001", "impactTin_medium_000",
             "impactTin_medium_001", "impactGlass_light_000", "impactGeneric_light_000"]
    srcs = [reverb(pk(name, IMP + f + ".ogg"), 0.9, 0.35) for f in files]
    for _ in range(26):
        s = speed(r.choice(srcs), r.uniform(0.85, 1.3))
        place(ch, s, r.uniform(0.3, d - 1.2), r.uniform(0.06, 0.3), r.uniform(0.05, 0.95))
    return ch, -8.0, ("synthesised murmur (low sawtooth 'voices') and room tone, with plate, tin and glass "
                      "clatter from the pack files scattered through it")


def amb_gym(name):
    d = 24.0
    r = rng_for(name)
    bed = stereo_bed(name, d, lambda nz: mix([(svf(nz, 350), 0, 1.0), (svf(nz, 1200, 0.4, "bp"), 0, 0.1)]))
    ch = scale_to(bed, 0.05)
    for _ in range(6):  # sneaker squeaks
        f, dur = r.uniform(2700, 3600), r.uniform(0.07, 0.15)
        sq = hann(mix([(osc(lambda t: f * (1 + 0.25 * t / dur), dur), 0, 1.0),
                       (osc(lambda t: 2 * f * (1 + 0.25 * t / dur), dur), 0, 0.4),
                       (osc(lambda t: 3 * f * (1 + 0.25 * t / dur), dur), 0, 0.2)]))
        place(ch, reverb(sq, 2.0, 0.5), r.uniform(0.5, d - 1.0), r.uniform(0.08, 0.2), r.uniform(0.1, 0.9))
    thump = mix([(decay(osc(lambda t: 110 - 300 * t, 0.12, "tri"), 0.05), 0, 1.0),
                 (svf(white(n_(0.004), r), 1500), 0, 0.6)])
    thump = reverb(thump, 2.0, 0.5)
    for start in (3.0, 14.5):  # a ball bounced a few times, far away
        t, pan = start, r.uniform(0.2, 0.8)
        for j in range(5):
            place(ch, thump, t, 0.5 - 0.06 * j, pan)
            t += 0.44 - 0.03 * j
    return ch, -9.0, "synthesised: reverberant room tone, sneaker squeaks and a distant bouncing ball"


def amb_strange(name):
    d = 40.0
    n = n_(d)
    r = rng_for(name)
    ch = [[0.0] * n, [0.0] * n]
    # Every frequency below is a multiple of 1/40 Hz, so each tone meets itself at the loop point.
    # Low tones a little out of tune with each other (a flat fifth, a sharp octave ...).
    for f, lvl, cyc in ((55.0, 1.0, 2), (55.35, 0.9, 3), (82.1, 0.7, 4), (110.6, 0.55, 5), (164.3, 0.4, 3)):
        w = 2 * pi * f / SR
        tone = [sin(w * i) + 0.5 * sin(2 * w * i) + 0.3 * sin(3 * w * i) + 0.15 * sin(4 * w * i) for i in range(n)]
        for c in ch:
            p = r.uniform(0, 2 * pi)
            wl = 2 * pi * cyc / d / SR
            for i in range(n):
                c[i] += tone[i] * lvl * 0.05 * (0.6 + 0.4 * sin(wl * i + p))
    # the same unease higher up, where a phone speaker can actually play it: three mid tones
    # and two pairs of faint high tones beating against each other
    for f, lvl, cyc in ((220.9, 0.25, 3), (331.3, 0.18, 7), (441.95, 0.1, 5),
                        (987.75, 0.02, 2), (990.0, 0.02, 2), (1318.5, 0.014, 3), (1321.25, 0.014, 3)):
        w = 2 * pi * f / SR
        for c in ch:
            p = r.uniform(0, 2 * pi)
            wl = 2 * pi * cyc / d / SR
            for i in range(n):
                c[i] += sin(w * i) * lvl * 0.05 * (0.5 + 0.5 * sin(wl * i + p))
    # a slow soft throb, 16 beats over the loop
    wt = 2 * pi * 73.4 / SR
    wp = 2 * pi * (16 / d) / SR
    for i in range(n):
        e = (0.5 + 0.5 * cos(wp * i)) ** 4
        v = (sin(wt * i) + 0.5 * sin(2 * wt * i) + 0.25 * sin(3 * wt * i)) * e * 0.07
        ch[0][i] += v
        ch[1][i] += v
    # fluorescent hum: 60 Hz and harmonics, a faint ballast buzz, and two flickers
    hw = 2 * pi * 60 / SR
    amps = ((1, 1.0), (2, 0.7), (3, 0.5), (4, 0.25), (5, 0.3), (6, 0.12), (7, 0.15), (9, 0.08))
    hum = [sum(a * sin(k * hw * i) for k, a in amps) for i in range(n)]
    buzz = loop_noise(d, r, lambda nz: svf(nz, 4200, 1.0, "bp"))
    flick = [1.0] * n
    for t0 in (11.3, 11.5, 27.8, 27.95, 28.2):
        a, b = n_(t0), n_(t0 + 0.07)
        for i in range(a, b):
            flick[i] = 1 - 0.85 * sin(pi * (i - a) / (b - a)) ** 0.5
    for i in range(n):
        v = (hum[i] * 0.016 + buzz[i] * 0.01 * abs(sin(hw * i)) ** 8) * flick[i]
        ch[0][i] += v * 0.8
        ch[1][i] += v * 1.0
    # reversed swells: a decaying detuned chord with reverb, played backwards
    for at, root, pan in ((4.0, 220.0, 0.3), (17.5, 207.7, 0.7), (30.0, 233.1, 0.45)):
        chord = mix([(osc(root, 3.2), 0, 1.0), (osc(root * 1.189 * 1.006, 3.2), 0, 0.8),
                     (osc(root * 1.414, 3.2), 0, 0.6), (osc(root * 2.01, 3.2), 0, 0.3)])
        sw = reverb(decay(chord, 0.9, 0.01), 1.8, 0.5)
        sw = fade(sw[::-1], 0.3, 0.03)
        place(ch, sw, at, 0.09, pan)
    return ch, -8.0, ("synthesised: detuned low sine tones (55 / 55.35 / 82.1 / 110.6 / 164.3 Hz), a slow throb, "
                      "mid and faint high tones beating against each other, 60 Hz hum with harmonics and flicker, "
                      "three reversed chord swells")


AMBIENCE = {"amb-hall": amb_hall, "amb-outside": amb_outside, "amb-cafeteria": amb_cafeteria,
            "amb-gym": amb_gym, "amb-strange": amb_strange}


# ================================================================ music

def exact_loop(name, loop):
    """Decode a pack loop (stereo s16le bytes) and fit it to its exact musical length."""
    rel = MUS + loop + ".ogg"
    USED.setdefault(name, []).append(rel)
    raw = decode_raw(os.path.join(JAM, rel), 2, ("-af", "volume=-2dB"))
    want = LOOP_SECONDS.get(loop)
    if not want:
        return raw
    have, target = len(raw) // 4, n_(want)
    s = array.array("h")
    s.frombytes(raw)
    if target >= have:  # pad: fade the last 5 ms to zero, then silence
        k = min(have, n_(0.005))
        for i in range(k):
            g = i / k
            s[2 * (have - 1 - i)] = int(s[2 * (have - 1 - i)] * g)
            s[2 * (have - 1 - i) + 1] = int(s[2 * (have - 1 - i) + 1] * g)
        return s.tobytes() + bytes(4 * (target - have))
    extra = have - target  # cut: the tail past the loop point rings on over the start
    for i in range(extra):
        g = 1 - i / extra
        for c in (0, 1):
            v = s[2 * i + c] + s[2 * (target + i) + c] * g
            s[2 * i + c] = int(max(-32767, min(32767, v)))
    return s[: 2 * target].tobytes()


def music_run(name, wav_path):
    """RUN_LOOP repeated RUN_PASSES times; the last pass opens with a four-bar filter sweep
    (muffled, opening up to full) so the long loop has one landmark."""
    raw = exact_loop(name, RUN_LOOP)
    frames = len(raw) // 4
    seg = frames // 4  # the loop is 16 bars; this is 4
    s = struct.unpack("<%dh" % (seg * 2), raw[: seg * 4])
    T = seg / SR
    fc = lambda t: 300.0 * 60.0 ** (t / T)
    out = []
    for c in range(2):
        dry = [v / 32768.0 for v in s[c::2]]
        wet = svf(dry, fc, 0.8)
        x0 = int(seg * 0.85)
        for i in range(x0, seg):  # hand back to the untouched signal before the sweep ends
            a = (i - x0) / (seg - x0)
            wet[i] = wet[i] * (1 - a) + dry[i] * a
        out.append(wet)
    swept = bytearray()
    p = struct.Struct("<hh").pack
    for l, r_ in zip(out[0], out[1]):
        swept += p(int(max(-1, min(1, l)) * 32767), int(max(-1, min(1, r_)) * 32767))
    body = raw * (RUN_PASSES - 1) + bytes(swept) + raw[seg * 4:]
    write_raw_wav(wav_path, body)
    return ("%s x%d, trimmed to exactly 64 beats so it repeats in time; the last pass opens with a "
            "four-bar low-pass sweep added here" % (RUN_LOOP, RUN_PASSES))


def music_menu(name, wav_path):
    write_raw_wav(wav_path, exact_loop(name, MENU_LOOP))
    return "%s, one pass, padded with 73 ms of silence to exactly 32 beats so it repeats in time" % MENU_LOOP


def write_raw_wav(path, pcm):
    import wave
    with wave.open(path, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm)


MUSIC = {"music-run": music_run, "music-menu": music_menu}


# ================================================================ main

def pack_credit(name):
    fs = USED.get(name, [])
    if not fs:
        return ""
    by = {}
    for f in fs:
        packname, _, rest = f.partition("/")
        by.setdefault(packname, []).append(os.path.basename(rest))
    return "; ".join("%s: %s" % (p, ", ".join(v)) for p, v in by.items())


def main():
    global JAM
    args = [a for a in sys.argv[1:]]
    only, keep = None, None
    for flag in ("--only", "--keep-wav"):
        if flag in args:
            i = args.index(flag)
            val = args[i + 1]
            del args[i:i + 2]
            if flag == "--only":
                only = set(val.split(","))
            else:
                keep = val
    if not args:
        raise SystemExit(__doc__)
    JAM = os.path.abspath(args[0])
    out = os.path.abspath(args[1]) if len(args) > 1 else DEFAULT_OUT
    os.makedirs(out, exist_ok=True)
    tmp = keep or tempfile.mkdtemp(prefix="math-audio-")
    os.makedirs(tmp, exist_ok=True)
    for p in ("kenney-music-loops", "kenney-impact-sounds", "kenney-interface-sounds"):
        lic = os.path.join(JAM, p, "audio", "License.txt")
        if not os.path.exists(lic) or "Creative Commons Zero" not in open(lic, errors="replace").read():
            raise SystemExit("pack %s is missing or its License.txt does not say CC0" % p)

    credits = []
    want = lambda name: only is None or name in only

    for name, (fn, note, opt) in effects().items():
        if not want(name):
            continue
        x = fn(name)
        if opt.get("loop"):
            x = normalize([x], -3.0)[0]
        else:
            x = finish(x, **{k: v for k, v in opt.items() if k != "loop"})
        write_wav(os.path.join(out, name + ".wav"), [x])
        src = pack_credit(name)
        credits.append((name + ".wav", (src + " -- " + note) if src else note))
        print("built", name + ".wav", "%.2fs" % (len(x) / SR), flush=True)

    for name, fn in MUSIC.items():
        if not want(name):
            continue
        wav = os.path.join(tmp, name + ".wav")
        note = fn(name, wav)
        encode_m4a(wav, os.path.join(out, name + ".m4a"))
        credits.append((name + ".m4a", pack_credit(name) + " -- " + note))
        print("built", name + ".m4a", flush=True)

    for name, fn in AMBIENCE.items():
        if not want(name):
            continue
        ch, db, note = fn(name)
        ch = normalize(ch, db)
        wav = os.path.join(tmp, name + ".wav")
        write_wav(wav, ch)
        encode_m4a(wav, os.path.join(out, name + ".m4a"))
        src = pack_credit(name)
        credits.append((name + ".m4a", (src + " -- " + note) if src else note))
        print("built", name + ".m4a", "%.1fs" % (len(ch[0]) / SR), flush=True)

    if only is None:
        with open(os.path.join(out, "CREDITS.txt"), "w") as f:
            f.write("Math runner audio: sources and licences\n"
                    "=======================================\n\n"
                    "Every file here is either public domain (CC0 1.0) material from Kenney (www.kenney.nl)\n"
                    "or was synthesised from scratch by scripts/math-audio/build.py, or a mix of the two.\n"
                    "The synthesised sounds are original work made for this app and are likewise released\n"
                    "as CC0 1.0. No attribution is required for any of it.\n\n"
                    "Kenney packs used (each pack's own License.txt says Creative Commons Zero, CC0):\n"
                    "  kenney-music-loops       Music Loops (1.1)\n"
                    "  kenney-impact-sounds     Impact Sounds (1.0)\n"
                    "  kenney-interface-sounds  Interface Sounds (1.0)\n"
                    "  http://creativecommons.org/publicdomain/zero/1.0/\n\n"
                    "Rebuild with: python3 scripts/math-audio/build.py <jam-folder>\n\n"
                    "file -- source -- licence\n"
                    "-------------------------\n")
            for fn_, note in credits:
                f.write("%s -- %s -- CC0 1.0\n" % (fn_, note))
        print("wrote CREDITS.txt")
    print("pre-encode loop WAVs are in", tmp)


if __name__ == "__main__":
    main()
