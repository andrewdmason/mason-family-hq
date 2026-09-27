"""
The clips worker's jobs, shared by the Modal spawn (modal_app.run_job) and the
local dev server (server.py), so prod and local run identical logic.

  prepare — probe an uploaded at-bat (duration, frame rate, size, when it was
            recorded), make the seek-friendly playback copy, and grab a poster.
  export  — render one or more at-bats' quick versions (real-speed pitch
            windows, slowed swing replays, captions, title cards) into a single
            shareable MP4.

The app passes signed URLs to read sources from and to upload results to, and
this POSTs the outcome back to the app's callback. Nothing here talks to the
database or holds storage credentials.
"""
import json
import os
import shutil
import subprocess
import tempfile
import urllib.request

# The playback copy: 1080p H.264 with a keyframe every quarter second and no
# B-frames, so the browser can land on any frame (scrubbing, frame-stepping,
# holding to play backward) by decoding at most a few frames. That costs ~50%
# more bytes than a normal encode; CRF 27 + a bitrate cap keeps a 2-minute
# at-bat around 150MB.
PLAYBACK_CRF = "27"
PLAYBACK_MAXRATE = "12M"

EXPORT_W, EXPORT_H = 1920, 1080
CARD_SECONDS = 2.0

HDR_TRANSFERS = {"arib-std-b67", "smpte2084"}
# iPhone HDR (HLG / Dolby Vision) tone-mapped down to SDR, so exports and the
# playback copy don't come out grey and washed-out on ordinary screens.
TONEMAP = (
    "zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,"
    "tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p,"
)
NET_OPTS = ["-reconnect", "1", "-reconnect_streamed", "1", "-reconnect_delay_max", "10"]


def _run(args: list[str]) -> str:
    proc = subprocess.run(args, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(f"{os.path.basename(args[0])} failed: {proc.stderr.strip()[-600:]}")
    return proc.stdout


def _download(url: str, dest: str) -> None:
    with urllib.request.urlopen(url, timeout=120) as resp, open(dest, "wb") as out:  # noqa: S310 (signed URLs)
        shutil.copyfileobj(resp, out, length=1 << 20)


def _upload(signed_url: str, path: str, content_type: str) -> None:
    """PUT a file to a Supabase signed upload URL (streamed, not read into memory)."""
    size = os.path.getsize(path)
    with open(path, "rb") as f:
        req = urllib.request.Request(
            signed_url,
            data=f,
            method="PUT",
            headers={
                "Content-Type": content_type,
                "Content-Length": str(size),
                "x-upsert": "true",
                "cache-control": "max-age=3600",
            },
        )
        with urllib.request.urlopen(req, timeout=600) as resp:  # noqa: S310
            if resp.status >= 300:
                raise RuntimeError(f"upload failed: {resp.status}")


def _ratio(s: str | None) -> float:
    if not s or s in ("0/0", "N/A"):
        return 0.0
    if "/" in s:
        a, b = s.split("/")
        return float(a) / float(b) if float(b) else 0.0
    return float(s)


def probe(src: str) -> dict:
    out = json.loads(
        _run(
            [
                "ffprobe", "-v", "error", "-print_format", "json",
                "-show_entries",
                "stream=codec_type,codec_name,width,height,avg_frame_rate,r_frame_rate,color_transfer"
                ":stream_side_data=rotation:format=duration:format_tags",
                src,
            ]
        )
    )
    streams = out.get("streams", [])
    v = next((s for s in streams if s.get("codec_type") == "video"), None)
    if not v:
        raise RuntimeError("No video stream in the file")
    fps = _ratio(v.get("avg_frame_rate")) or _ratio(v.get("r_frame_rate")) or 30.0
    # iPhone frame rates are nominally whole numbers (30, 60, 120, 240) with a
    # little jitter in the average; snap to the whole number when close.
    fps = round(fps) if abs(fps - round(fps)) < 0.3 else round(fps, 3)
    rotation = 0
    for sd in v.get("side_data_list", []) or []:
        if "rotation" in sd:
            rotation = int(sd["rotation"])
    w, h = int(v.get("width", 0)), int(v.get("height", 0))
    if abs(rotation) % 180 == 90:
        w, h = h, w
    tags = out.get("format", {}).get("tags", {}) or {}
    recorded = tags.get("com.apple.quicktime.creationdate") or tags.get("creation_time")
    return {
        "durationS": float(out.get("format", {}).get("duration") or 0),
        "fps": fps,
        "width": w,
        "height": h,
        "codec": v.get("codec_name"),
        "recordedAt": recorded,
        "hdr": v.get("color_transfer") in HDR_TRANSFERS,
        "hasAudio": any(s.get("codec_type") == "audio" for s in streams),
    }


def prepare(payload: dict, work: str) -> dict:
    src = os.path.join(work, "original")
    _download(payload["sourceUrl"], src)
    meta = probe(src)
    fps = meta["fps"]
    gop = str(max(4, round(fps / 4)))

    playback = os.path.join(work, "playback.mp4")
    # Keep the short side at most 1080 (portrait clips stay portrait).
    scale = "scale='if(gte(iw,ih),-2,min(1080,iw))':'if(gte(iw,ih),min(1080,ih),-2)'"
    vf = (TONEMAP if meta["hdr"] else "") + scale
    _run(
        [
            "ffmpeg", "-y", "-v", "error", "-i", src,
            "-map", "0:v:0", "-map", "0:a:0?",
            "-vf", vf, "-fps_mode", "cfr", "-r", str(fps),
            "-c:v", "libx264", "-preset", "veryfast", "-crf", PLAYBACK_CRF,
            "-maxrate", PLAYBACK_MAXRATE, "-bufsize", "24M",
            "-g", gop, "-keyint_min", gop, "-sc_threshold", "0", "-bf", "0",
            "-pix_fmt", "yuv420p", "-profile:v", "high",
            "-c:a", "aac", "-b:a", "128k",
            "-movflags", "+faststart",
            playback,
        ]
    )
    _upload(payload["playbackUpload"], playback, "video/mp4")

    poster = os.path.join(work, "poster.jpg")
    _run(
        [
            "ffmpeg", "-y", "-v", "error", "-ss", f"{meta['durationS'] * 0.4:.2f}", "-i", playback,
            "-frames:v", "1", "-vf", "scale=640:-2", "-q:v", "4", poster,
        ]
    )
    _upload(payload["posterUpload"], poster, "image/jpeg")

    return {
        "atBatId": payload["atBatId"],
        "playbackPath": payload["playbackPath"],
        "posterPath": payload["posterPath"],
        "meta": {k: meta[k] for k in ("durationS", "fps", "width", "height", "codec", "recordedAt")},
    }


def _card_png(path: str, title: str, subtitle: str) -> None:
    """A title card's text: the at-bat big, the game and date smaller beneath."""
    from PIL import Image, ImageDraw, ImageFont

    big, small = ImageFont.load_default(size=110), ImageFont.load_default(size=52)
    probe_draw = ImageDraw.Draw(Image.new("RGBA", (1, 1)))
    tb = probe_draw.textbbox((0, 0), title, font=big)
    sb = probe_draw.textbbox((0, 0), subtitle, font=small) if subtitle else (0, 0, 0, 0)
    gap = 36
    w = max(tb[2] - tb[0], sb[2] - sb[0]) + 20
    h = (tb[3] - tb[1]) + (gap + sb[3] - sb[1] if subtitle else 0) + 20
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.text(((w - (tb[2] - tb[0])) / 2 - tb[0], 10 - tb[1]), title, font=big, fill=(255, 255, 255, 255))
    if subtitle:
        y = 10 + (tb[3] - tb[1]) + gap - sb[1]
        d.text(((w - (sb[2] - sb[0])) / 2 - sb[0], y), subtitle, font=small, fill=(255, 255, 255, 170))
    img.save(path)


def _caption_png(path: str, text: str, size: int, card: bool) -> None:
    """Draw a caption as a transparent PNG to overlay on the video. Captions are
    drawn with Pillow rather than ffmpeg's drawtext so any ffmpeg build works."""
    from PIL import Image, ImageDraw, ImageFont

    font = ImageFont.load_default(size=size)
    pad = size // 3
    probe_draw = ImageDraw.Draw(Image.new("RGBA", (1, 1)))
    left, top, right, bottom = probe_draw.textbbox((0, 0), text, font=font)
    w, h = right - left + 2 * pad, bottom - top + 2 * pad
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0 if card else 150))
    ImageDraw.Draw(img).text((pad - left, pad - top), text, font=font, fill=(255, 255, 255, 255))
    img.save(path)


def _encode_args(fps: int) -> list[str]:
    # Identical settings for every piece so they concatenate without re-encoding.
    return [
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
        "-profile:v", "high", "-r", str(fps), "-g", str(fps * 2),
        "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2",
        "-video_track_timescale", "90000",
    ]


def export(payload: dict, work: str) -> dict:
    sources = payload["sources"]
    metas = [probe(s["url"]) for s in sources]
    fps = min(60, max(30, max(round(m["fps"]) for m in metas)))
    fit = (
        f"scale={EXPORT_W}:{EXPORT_H}:force_original_aspect_ratio=decrease,"
        f"pad={EXPORT_W}:{EXPORT_H}:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps={fps}"
    )
    pieces: list[str] = []

    def piece_path() -> str:
        return os.path.join(work, f"piece{len(pieces):03d}.mp4")

    def caption(text: str, size: int = 44, card: bool = False) -> str:
        p = os.path.join(work, f"caption{len(pieces):03d}.png")
        _caption_png(p, text, size, card)
        return p

    for src, meta in zip(sources, metas):
        card = src.get("card")
        if card:
            # Older callers sent a plain string.
            title, subtitle = (card, "") if isinstance(card, str) else (card["title"], card.get("subtitle", ""))
            card_png = os.path.join(work, f"card{len(pieces):03d}.png")
            _card_png(card_png, title, subtitle)
            out = piece_path()
            _run(
                [
                    "ffmpeg", "-y", "-v", "error",
                    "-f", "lavfi", "-i", f"color=c=black:s={EXPORT_W}x{EXPORT_H}:r={fps}:d={CARD_SECONDS}",
                    "-i", card_png,
                    "-f", "lavfi", "-t", str(CARD_SECONDS), "-i", "anullsrc=r=48000:cl=stereo",
                    "-filter_complex", "[0:v][1:v]overlay=(W-w)/2:(H-h)/2,format=yuv420p[v]",
                    "-map", "[v]", "-map", "2:a", "-t", str(CARD_SECONDS),
                    *_encode_args(fps), out,
                ]
            )
            pieces.append(out)

        for seg in src["segments"]:
            start, end, rate = float(seg["start"]), float(seg["end"]), float(seg["rate"])
            length = max(0.05, end - start)
            out_len = length / rate
            slow = f"setpts={1 / rate:.4f}*PTS," if rate != 1 else ""
            # Replay zoom: crop to the at-bat's box (fractions of the frame)
            # before scaling back up to 1080p — from a 4K original a 2× zoom
            # stays full-HD sharp.
            box = seg.get("crop")
            crop = (
                f"crop=w=iw*{box['s']:.4f}:h=ih*{box['s']:.4f}:x=iw*{box['x']:.4f}:y=ih*{box['y']:.4f},"
                if box
                else ""
            )
            vf = (TONEMAP if meta["hdr"] else "") + crop + slow + fit
            video = f"[0:v]{vf}[base];[base][1:v]overlay=40:40,format=yuv420p[v]"
            with_audio = meta["hasAudio"] and not seg.get("muted") and rate == 1
            net = NET_OPTS if src["url"].startswith("http") else []
            args = [
                "ffmpeg", "-y", "-v", "error", *net,
                "-ss", f"{start:.3f}", "-t", f"{length:.3f}", "-i", src["url"],
                "-i", caption(seg["caption"]),
            ]
            if with_audio:
                args += [
                    "-filter_complex", f"{video};[0:a]aresample=48000,aformat=channel_layouts=stereo[a]",
                    "-map", "[v]", "-map", "[a]",
                ]
            else:
                args += [
                    "-f", "lavfi", "-t", f"{out_len:.3f}", "-i", "anullsrc=r=48000:cl=stereo",
                    "-filter_complex", video, "-map", "[v]", "-map", "2:a",
                ]
            out = piece_path()
            _run([*args, "-t", f"{out_len:.3f}", *_encode_args(fps), out])
            pieces.append(out)

    if not pieces:
        raise RuntimeError("Nothing to render")
    listing = os.path.join(work, "pieces.txt")
    with open(listing, "w") as f:
        f.writelines(f"file '{p}'\n" for p in pieces)
    final = os.path.join(work, "export.mp4")
    _run(["ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", listing, "-c", "copy", "-movflags", "+faststart", final])
    _upload(payload["upload"], final, "video/mp4")
    return {"exportId": payload["exportId"], "path": payload["path"]}


def run_and_callback(payload: dict) -> None:
    job = payload.get("job")
    out: dict = {"job": job, "secret": os.environ.get("WORKER_SECRET")}
    if job == "prepare":
        out["atBatId"] = payload.get("atBatId")
    elif job == "export":
        out["exportId"] = payload.get("exportId")
    work = tempfile.mkdtemp(prefix=f"clips-{job}-")
    try:
        if job == "prepare":
            out.update(prepare(payload, work))
        elif job == "export":
            out.update(export(payload, work))
        else:
            raise RuntimeError(f"unknown job {job!r}")
        out["ok"] = True
    except Exception as e:  # noqa: BLE001
        out["ok"] = False
        out["error"] = str(e)[:500]
        # A failed transcode can still report what the probe learned, so the
        # player can frame-step the original at the right rate.
        if job == "prepare":
            try:
                src = os.path.join(work, "original")
                if os.path.exists(src):
                    m = probe(src)
                    out["meta"] = {k: m[k] for k in ("durationS", "fps", "width", "height", "codec", "recordedAt")}
            except Exception:  # noqa: BLE001
                pass
    finally:
        shutil.rmtree(work, ignore_errors=True)

    # Don't follow redirects: an auth/login redirect must surface as an error
    # rather than silently "succeeding" against a login page.
    class _NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args, **kwargs):
            return None

    opener = urllib.request.build_opener(_NoRedirect)
    try:
        req = urllib.request.Request(
            payload["callbackUrl"],
            data=json.dumps(out).encode(),
            headers={"content-type": "application/json"},
            method="POST",
        )
        resp = opener.open(req, timeout=120)  # noqa: S310
        print(f"callback {payload['callbackUrl']} -> {resp.status}")
    except Exception as e:  # noqa: BLE001
        print(f"callback to {payload['callbackUrl']} FAILED: {e}")


if __name__ == "__main__":  # pragma: no cover
    import sys

    print(json.dumps(probe(sys.argv[1]), indent=2), file=sys.stderr)
