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
    .add_local_python_source("server", "align", "transcribe", "midi")
)

app = modal.App("practice-alignment", image=image)


@app.function(
    gpu="T4",  # ~seconds transcription instead of minutes (~pennies/session,
    #          #   scale-to-zero). transcribe.py auto-uses CUDA when present.
    timeout=600,
    scaledown_window=300,  # keep a warm container (model loaded) for 5 min after a request
    secrets=[modal.Secret.from_name("practice-worker")],
)
@modal.asgi_app()
def fastapi_app():
    from server import app as web_app

    return web_app
