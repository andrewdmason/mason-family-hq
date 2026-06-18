"""
ByteDance piano transcription for the worker (plan U10).

Turns the recording into a MIDI of the notes actually played, so the app can
store that (tiny, less sensitive than audio) instead of keeping the recording,
and build a note-level debug view on it. The chroma matcher still does the piece
recognition; this is an added artifact.

Two upstream quirks worked around:
- the package auto-downloads its checkpoint with `wget` (absent on macOS) — we
  fetch it with urllib instead;
- its bundled `load_audio` calls a librosa internal removed in modern librosa —
  we load with librosa.load directly.
"""
import os
import tempfile
import urllib.request
from pathlib import Path

import librosa
from piano_transcription_inference import PianoTranscription, sample_rate

_CKPT = f"{Path.home()}/piano_transcription_inference_data/note_F1=0.9677_pedal_F1=0.9186.pth"
_CKPT_URL = (
    "https://zenodo.org/record/4034264/files/"
    "CRNN_note_F1%3D0.9677_pedal_F1%3D0.9186.pth?download=1"
)
_model = None


def _ensure_checkpoint():
    if os.path.exists(_CKPT) and os.path.getsize(_CKPT) > 1.6e8:
        return
    os.makedirs(os.path.dirname(_CKPT), exist_ok=True)
    urllib.request.urlretrieve(_CKPT_URL, _CKPT)  # noqa: S310 (trusted zenodo URL)


def _get_model():
    global _model
    if _model is None:
        _ensure_checkpoint()
        _model = PianoTranscription(device="cpu", checkpoint_path=_CKPT)
    return _model


def transcribe_to_midi_bytes(audio_path: str) -> bytes:
    """Transcribe the recording and return the MIDI file bytes."""
    audio, _ = librosa.load(audio_path, sr=sample_rate, mono=True)
    tmp = tempfile.NamedTemporaryFile(suffix=".mid", delete=False)
    tmp.close()
    try:
        _get_model().transcribe(audio, tmp.name)
        with open(tmp.name, "rb") as f:
            return f.read()
    finally:
        os.unlink(tmp.name)
