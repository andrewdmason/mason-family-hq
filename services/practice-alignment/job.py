"""
The full processing job: fetch the recording + reference MIDIs, align, transcribe,
and POST the result to the app's callback URL. Shared by the Modal spawn
(modal_app.run_job) and the local worker's background task (server.py /process),
so prod and local dev run identical logic.
"""
import base64
import json
import os
import tempfile
import urllib.request

from align import align
from transcribe import transcribe_to_midi_bytes


def _fetch(url: str) -> bytes:
    with urllib.request.urlopen(url, timeout=180) as resp:  # noqa: S310 (signed URLs)
        return resp.read()


def run_and_callback(payload: dict) -> None:
    out = {"sessionId": payload["sessionId"], "secret": os.environ.get("WORKER_SECRET")}
    try:
        refs = [{"pieceId": r["pieceId"], "midi": _fetch(r["midiUrl"])} for r in payload["references"]]
        audio = _fetch(payload["recordingUrl"])
        with tempfile.NamedTemporaryFile(suffix=".m4a") as f:
            f.write(audio)
            f.flush()
            result = align(f.name, refs)
            try:
                result["transcriptionMidiB64"] = base64.b64encode(
                    transcribe_to_midi_bytes(f.name)
                ).decode()
            except Exception as e:  # noqa: BLE001
                result["transcriptionMidiB64"] = None
                result["transcriptionError"] = str(e)[:300]
        out.update(result)
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
