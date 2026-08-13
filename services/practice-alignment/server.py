"""
HTTP endpoint for the alignment worker (plan U6).

POST /align  { recordingUrl, references: [{ pieceId, midiUrl }] }  -> segments contract.

Fetches the recording + reference MIDIs from (signed) URLs, runs the windowed
alignment, returns the result synchronously. v1 is synchronous because practice
recordings are short (minutes) and the caller's function budget covers it; when
this moves to Modal for longer jobs, switch to async + a webhook callback (the
orchestration route in src/app/practice/session/api/ already isolates that seam).

Auth: optional shared secret via the X-Worker-Secret header (set WORKER_SECRET).

Run locally:  ./.venv/bin/uvicorn server:app --port $(node ../../scripts/free-port.js)
"""
import base64
import os
import tempfile
import urllib.request

from fastapi import BackgroundTasks, FastAPI, Header, HTTPException
from pydantic import BaseModel

from align import align
from job import _run_segment, run_and_callback
from scales import classify_scales
from transcribe import transcribe_to_midi_bytes

app = FastAPI(title="practice-alignment")


class ReferenceInput(BaseModel):
    pieceId: str
    midiUrl: str


class AlignRequest(BaseModel):
    recordingUrl: str
    references: list[ReferenceInput]
    # Plan U2/KTD4: absent/"session" = multi-reference recognition (today's
    # behavior); "segment" = known-piece alignment against references[0],
    # returning spans + totalMeasures instead of segments.
    mode: str | None = None
    recordingId: str | None = None


def _fetch(url: str) -> bytes:
    with urllib.request.urlopen(url, timeout=60) as resp:  # noqa: S310 (trusted signed URLs)
        return resp.read()


def _check_secret(secret: str | None):
    expected = os.environ.get("WORKER_SECRET")
    if expected and secret != expected:
        raise HTTPException(status_code=401, detail="bad worker secret")


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/process")
def process(payload: dict, background_tasks: BackgroundTasks):
    """Async kickoff for local dev (mirrors the Modal `process` endpoint): validate
    the secret, run the job in the background, return immediately. The job POSTs the
    result to payload['callbackUrl'] when done."""
    _check_secret(payload.get("secret"))
    background_tasks.add_task(run_and_callback, payload)
    return {"status": "accepted"}


@app.post("/align")
def do_align(req: AlignRequest, x_worker_secret: str | None = Header(default=None)):
    _check_secret(x_worker_secret)
    audio = _fetch(req.recordingUrl)
    with tempfile.NamedTemporaryFile(suffix=".m4a") as f:
        f.write(audio)
        f.flush()
        if req.mode == "segment":
            # Known-piece recording job (plan U2): transcription + measure spans
            # against the single supplied reference; no recognition, no scales.
            # Delegates to job.py's _run_segment so the sync (here) and async
            # (server.py /process, Modal) paths share one implementation.
            job_payload = {
                "references": [
                    {"pieceId": r.pieceId, "midiUrl": r.midiUrl} for r in req.references
                ]
            }
            result = _run_segment(job_payload, f.name)
            if req.recordingId is not None:
                result["recordingId"] = req.recordingId
            return result
        refs = [{"pieceId": r.pieceId, "midi": _fetch(r.midiUrl)} for r in req.references]
        result = align(f.name, refs)
        # Transcribe the playing to MIDI so the app can store it (and drop the
        # audio), and use the notes to flag scale runs. Failure here shouldn't
        # sink the segments — the alignment is the essential part.
        try:
            midi = transcribe_to_midi_bytes(f.name)
            classify_scales(midi, result["segments"])
            result["transcriptionMidiB64"] = base64.b64encode(midi).decode()
        except Exception as e:  # noqa: BLE001
            result["transcriptionMidiB64"] = None
            result["transcriptionError"] = str(e)[:300]
    return result
