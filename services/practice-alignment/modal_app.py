"""
Modal deployment of the practice-alignment worker.

Wraps the FastAPI app (server.py) as a Modal ASGI app. The Vercel app calls the
deployed URL (PRACTICE_WORKER_URL) with the shared WORKER_SECRET. The model
checkpoint is baked into the image so cold starts don't re-download it.

Deploy:
  ./.venv/bin/modal deploy modal_app.py
  # prints a https://...modal.run URL -> set that as PRACTICE_WORKER_URL in Vercel.

The shared secret is read from a Modal secret named "practice-worker":
  ./.venv/bin/modal secret create practice-worker WORKER_SECRET=<value>
"""
import modal

CKPT_URL = (
    "https://zenodo.org/record/4034264/files/"
    "CRNN_note_F1%3D0.9677_pedal_F1%3D0.9186.pth?download=1"
)
# transcribe.py looks for the checkpoint under $HOME; in the container HOME=/root.
CKPT_PATH = "/root/piano_transcription_inference_data/note_F1=0.9677_pedal_F1=0.9186.pth"


def _bake_checkpoint():
    import os
    import urllib.request

    os.makedirs(os.path.dirname(CKPT_PATH), exist_ok=True)
    urllib.request.urlretrieve(CKPT_URL, CKPT_PATH)


image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg")
    .pip_install(
        "librosa",
        "numpy",
        "soundfile",
        "fastapi",
        "uvicorn[standard]",
        "piano_transcription_inference",
        "torch",
    )
    .run_function(_bake_checkpoint)
    .add_local_python_source("server", "align", "transcribe", "midi", "job", "scales")
)

app = modal.App("practice-alignment", image=image)
SECRET = modal.Secret.from_name("practice-worker")


@app.function(gpu="T4", timeout=1800, secrets=[SECRET])
def run_job(payload: dict):
    """The heavy job, spawned as a background call so it survives long recordings
    without any Vercel function holding open. Posts the result to the callback."""
    from job import run_and_callback

    run_and_callback(payload)


@app.function(secrets=[SECRET])
@modal.fastapi_endpoint(method="POST")
def process(payload: dict):
    """Kickoff endpoint Vercel calls: validate the shared secret, spawn the job,
    return immediately (the spawned run_job finishes and calls back)."""
    import os

    from fastapi import Response

    if payload.get("secret") != os.environ.get("WORKER_SECRET"):
        return Response(status_code=401)
    run_job.spawn(payload)
    return {"status": "accepted"}


@app.function(timeout=300, scaledown_window=300, secrets=[SECRET])
@modal.asgi_app()
def fastapi_app():
    """Kept for /health and sync /align (local-style testing)."""
    from server import app as web_app

    return web_app
