"""
Modal deployment of the baseball clips worker (ffmpeg on CPU — no GPU needed).

The Vercel app POSTs jobs to the `process` endpoint (CLIPS_WORKER_URL) with the
shared WORKER_SECRET; `process` spawns `run_job` and returns immediately, and
the job calls back to /clips/api/callback when it's done.

Deploy:
  python3 -m venv .venv && ./.venv/bin/pip install modal
  ./.venv/bin/modal deploy modal_app.py
  # prints the process endpoint URL -> set it as CLIPS_WORKER_URL in Vercel.

Reuses the practice worker's Modal secret (same WORKER_SECRET value):
  ./.venv/bin/modal secret create practice-worker WORKER_SECRET=<value>
"""
import modal

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg")
    .pip_install("fastapi", "pillow")
    .add_local_python_source("job")
)

app = modal.App("baseball-clips", image=image)
SECRET = modal.Secret.from_name("practice-worker")


@app.function(cpu=8.0, memory=8192, timeout=1800, secrets=[SECRET])
def run_job(payload: dict):
    """The ffmpeg work, spawned in the background so no Vercel function waits on it."""
    from job import run_and_callback

    run_and_callback(payload)


@app.function(secrets=[SECRET])
@modal.fastapi_endpoint(method="POST")
def process(payload: dict):
    import os

    from fastapi import Response

    if payload.get("secret") != os.environ.get("WORKER_SECRET"):
        return Response(status_code=401)
    run_job.spawn(payload)
    return {"status": "accepted"}
