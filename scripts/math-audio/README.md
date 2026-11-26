# Math runner audio

Rebuilds everything in `ios/Tuttles/iPhone/Math/MathAssets/audio/` (effects, music, ambience
and `CREDITS.txt`). All of it is CC0: Kenney pack material or sound synthesised here.

## Run

```sh
python3 scripts/math-audio/build.py <jam-folder>            # about 20 s
python3 scripts/math-audio/verify.py --src <folder build.py printed>
```

- `<jam-folder>` is a checkout of the free-asset library containing `kenney-music-loops`,
  `kenney-impact-sounds` and `kenney-interface-sounds`, with their Git LFS pointers already
  replaced by the real `.ogg` files (the build stops with a clear message if one is still a pointer,
  or if a pack's `License.txt` does not say CC0).
- Optional: a second argument for a different output folder; `--only jump,amb-gym` to rebuild a
  few files (CREDITS.txt is only rewritten on a full build); `--keep-wav <dir>` to choose where the
  uncompressed loop WAVs go.
- Needs `python3` (standard library only) and `ffmpeg`. On a Mac it also uses `afconvert` for the
  AAC loops, which is what makes them gapless; without it the loops still build but less cleanly.
- The build is deterministic: random choices are seeded from each file's name.

## Files

- `synth.py`: the small synthesis toolkit (oscillators, noise, filter, reverb, WAV/AAC writing).
- `build.py`: one function per sound. The music choices are the `RUN_LOOP` / `MENU_LOOP` names at
  the top; `LOOP_SECONDS` holds each loop's exact musical length (see below).
- `verify.py`: prints the table (duration, channels, rate, peak, mean, size), flags anything
  silent, clipped, mis-formatted or the wrong length, and checks every loop's join.

## Things worth knowing

- Effects are mono 44.1 kHz 16-bit WAV, trimmed and peak-normalised to -3 dBFS. `jetpack.wav` is a
  seamless loop, so it is not trimmed or faded.
- Loops are stereo AAC `.m4a` at 128 kbps. They are encoded with a little of their own end in
  front and their own start behind, declared as encoder priming/padding in the file's gapless tag
  (iTunSMPB), so the decoded audio is exactly the loop and the join carries no encoder noise.
  Play them with `AVAudioPlayer` (`numberOfLoops = -1`) or `AVAudioFile` + `AVAudioPlayerNode`;
  both honour that tag. `AVPlayer` is not gapless.
- Two Kenney loops are not a whole number of beats long, which makes them stumble on every
  repeat. `build.py` fits them to the measured beat: "Flowing Rocks" is cut from 64.06 to 64 beats
  (the cut tail rings over the start), "Mishief Stroll" is padded from 31.92 to 32 beats. If you
  change `RUN_LOOP` / `MENU_LOOP`, measure the new loop and update `LOOP_SECONDS`.
