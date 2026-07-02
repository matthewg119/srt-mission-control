"""
Vercel Python serverless function: analyze a song's beat grid (beat-sync foundation).

Mission Control POSTs a public audio URL (a song Matthew attached in Slack, stored in the
Supabase `reels` bucket). We decode it to mono PCM with the bundled ffmpeg (imageio-ffmpeg,
already a dependency of the render engine), run a pure-python energy-envelope onset
detection, estimate the BPM from the inter-onset intervals, and lay a regular beat grid
phase-aligned to the strongest onsets. Mission Control then snaps shot transitions and
text drops to the returned beats.

Request  (POST, header `x-reel-secret: $REEL_RENDER_SECRET`):
  { "audio_url": "https://.../song.m4a", "max_seconds": 60 }
Response:
  { "bpm": 117.2 | null, "beats": [0.0, 0.51, ...], "onsets": [...], "duration": 31.4 }
"""

import array
import json
import math
import os
import subprocess
import tempfile
import urllib.request
from http.server import BaseHTTPRequestHandler


SR = 22050  # decode sample rate
HOP = 512   # energy hop (about 23ms)


def _ffmpeg_exe() -> str:
    import imageio_ffmpeg

    return imageio_ffmpeg.get_ffmpeg_exe()


def _decode_mono(path: str, max_seconds: float) -> array.array:
    """Decode any audio file to mono s16le PCM at SR via ffmpeg. Returns int16 samples."""
    cmd = [
        _ffmpeg_exe(),
        "-v", "error",
        "-i", path,
        "-t", str(max_seconds),
        "-ac", "1",
        "-ar", str(SR),
        "-f", "s16le",
        "-",
    ]
    proc = subprocess.run(cmd, capture_output=True, timeout=120)
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg decode failed: {proc.stderr.decode('utf-8', 'ignore')[-300:]}")
    samples = array.array("h")
    samples.frombytes(proc.stdout[: (len(proc.stdout) // 2) * 2])
    return samples


def _onsets(samples: array.array) -> list[float]:
    """Energy-envelope onset detection: per-hop energy -> positive novelty -> adaptive
    threshold -> local-max peaks at least 0.22s apart. Returns onset times in seconds."""
    n_hops = len(samples) // HOP
    if n_hops < 8:
        return []
    energy = []
    for i in range(n_hops):
        seg = samples[i * HOP : (i + 1) * HOP]
        e = 0.0
        for s in seg:
            e += float(s) * float(s)
        energy.append(e / HOP)

    novelty = [0.0] + [max(0.0, energy[i] - energy[i - 1]) for i in range(1, n_hops)]
    # Light smoothing (3-hop moving average).
    smooth = [
        (novelty[max(0, i - 1)] + novelty[i] + novelty[min(n_hops - 1, i + 1)]) / 3.0
        for i in range(n_hops)
    ]
    mean = sum(smooth) / len(smooth)
    var = sum((x - mean) ** 2 for x in smooth) / len(smooth)
    thresh = mean + 1.2 * math.sqrt(var)

    min_gap = int(0.22 * SR / HOP)
    onsets: list[float] = []
    last = -min_gap
    for i in range(1, n_hops - 1):
        if smooth[i] >= thresh and smooth[i] >= smooth[i - 1] and smooth[i] >= smooth[i + 1]:
            if i - last >= min_gap:
                onsets.append(round(i * HOP / SR, 3))
                last = i
    return onsets


def _median(xs: list[float]) -> float:
    s = sorted(xs)
    m = len(s) // 2
    return s[m] if len(s) % 2 else (s[m - 1] + s[m]) / 2.0


def _beat_grid(onsets: list[float], duration: float):
    """Estimate BPM from inter-onset intervals (folded into 60-180) and lay a regular grid
    phase-aligned to the onsets. Returns (bpm | None, beats)."""
    if len(onsets) < 4:
        return None, onsets
    intervals = [b - a for a, b in zip(onsets, onsets[1:]) if 0.2 <= (b - a) <= 2.0]
    if not intervals:
        return None, onsets
    period = _median(intervals)
    while period < 60.0 / 180.0:
        period *= 2.0
    while period > 60.0 / 60.0:
        period /= 2.0
    bpm = 60.0 / period

    # Phase: try each early onset as the grid anchor; keep the phase that catches the most
    # onsets within 70ms of a grid line.
    best_phase, best_score = onsets[0] % period, -1
    for anchor in onsets[:8]:
        phase = anchor % period
        score = 0
        for o in onsets:
            k = round((o - phase) / period)
            if abs((phase + k * period) - o) <= 0.07:
                score += 1
        if score > best_score:
            best_phase, best_score = phase, score

    beats = []
    t = best_phase
    while t <= duration + 1e-6:
        beats.append(round(t, 3))
        t += period
    return round(bpm, 2), beats


class handler(BaseHTTPRequestHandler):
    def _send(self, code: int, payload: dict):
        data = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        secret = os.environ.get("REEL_RENDER_SECRET")
        if secret and self.headers.get("x-reel-secret") != secret:
            return self._send(401, {"error": "unauthorized"})

        try:
            length = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(length) or b"{}")
        except Exception as e:
            return self._send(400, {"error": f"bad json: {e}"})

        audio_url = body.get("audio_url")
        if not audio_url:
            return self._send(400, {"error": "need audio_url"})
        max_seconds = float(body.get("max_seconds") or 60)

        tmpdir = tempfile.mkdtemp(prefix="song_")
        audio_path = os.path.join(tmpdir, "song")
        try:
            with urllib.request.urlopen(audio_url, timeout=60) as resp:
                with open(audio_path, "wb") as fh:
                    fh.write(resp.read())
            samples = _decode_mono(audio_path, max_seconds)
            duration = round(len(samples) / SR, 3)
            onsets = _onsets(samples)
            bpm, beats = _beat_grid(onsets, duration)
            return self._send(200, {"bpm": bpm, "beats": beats, "onsets": onsets, "duration": duration})
        except Exception as e:
            return self._send(500, {"error": str(e)})
