"""
The full processing job: fetch the recording + reference MIDIs, align, transcribe,
and POST the result to the app's callback URL. Shared by the Modal spawn
(modal_app.run_job) and the local worker's background task (server.py /process),
so prod and local dev run identical logic.

Two modes (plan U2/KTD4), selected by payload["mode"]:
- absent or "session": today's open-session pipeline — multi-reference
  recognition, transcription, scale classification. Result carries segments/
  confidence/windows.
- "segment": known-piece recording job — transcription plus windowed alignment
  against the ONE supplied reference, returning measure-level spans +
  totalMeasures. No recognition, no scale classification. With no reference
  supplied it's transcription-only (spans []).

The callback envelope echoes sessionId and/or recordingId from the payload
(recording jobs have no sessionId) plus ok/secret.
"""
import base64
import json
import os
import tempfile
import urllib.request

from align import align, align_to_reference
from scales import classify_scales
from transcribe import transcribe_to_midi_bytes


def _fetch(url: str) -> bytes:
    with urllib.request.urlopen(url, timeout=180) as resp:  # noqa: S310 (signed URLs)
        return resp.read()


def _transcribe_into(result: dict, audio_path: str) -> bytes | None:
    """Transcribe into result; failure never sinks the job (alignment is the
    essential part; the app marks missing transcription via transcriptionError)."""
    try:
        midi = transcribe_to_midi_bytes(audio_path)
        result["transcriptionMidiB64"] = base64.b64encode(midi).decode()
        return midi
    except Exception as e:  # noqa: BLE001
        result["transcriptionMidiB64"] = None
        result["transcriptionError"] = str(e)[:300]
        return None


def _run_session(payload: dict, audio_path: str) -> dict:
    refs = [{"pieceId": r["pieceId"], "midi": _fetch(r["midiUrl"])} for r in payload["references"]]
    result = align(audio_path, refs)
    midi = _transcribe_into(result, audio_path)
    if midi is not None:
        # Reclassify unmatched stretches that are scale runs (needs the notes).
        classify_scales(midi, result["segments"])
    return result


def _run_segment(payload: dict, audio_path: str) -> dict:
    refs = payload.get("references") or []
    result = {"spans": [], "totalMeasures": 0}
    _transcribe_into(result, audio_path)  # transcribe first (plan U2)
    if refs:
        result.update(align_to_reference(audio_path, _fetch(refs[0]["midiUrl"])))
    return result


def run_and_callback(payload: dict) -> None:
    out = {"secret": os.environ.get("WORKER_SECRET")}
    # Recording jobs identify by recordingId, session jobs by sessionId; echo
    # whichever the payload carries so the callback route can route the result.
    if "sessionId" in payload:
        out["sessionId"] = payload["sessionId"]
    if "recordingId" in payload:
        out["recordingId"] = payload["recordingId"]
    try:
        audio = _fetch(payload["recordingUrl"])
        with tempfile.NamedTemporaryFile(suffix=".m4a") as f:
            f.write(audio)
            f.flush()
            if payload.get("mode") == "segment":
                out.update(_run_segment(payload, f.name))
            else:
                out.update(_run_session(payload, f.name))
        out["ok"] = True
    except Exception as e:  # noqa: BLE001
        out["ok"] = False
        out["error"] = str(e)[:500]

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
