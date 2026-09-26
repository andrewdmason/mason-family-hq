"""
Local dev server for the clips worker (prod runs on Modal — see modal_app.py).
Mirrors the Modal `process` endpoint: check the shared secret, run the job in
the background, and return at once; the job POSTs its result to the callback.

Run: ./run.sh   (then set CLIPS_WORKER_URL=http://127.0.0.1:<port>/process)
"""
import os

from fastapi import BackgroundTasks, FastAPI, HTTPException

from job import run_and_callback

app = FastAPI(title="baseball-clips")


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/process")
def process(payload: dict, background_tasks: BackgroundTasks):
    expected = os.environ.get("WORKER_SECRET")
    if expected and payload.get("secret") != expected:
        raise HTTPException(status_code=401, detail="bad worker secret")
    background_tasks.add_task(run_and_callback, payload)
    return {"status": "accepted"}
