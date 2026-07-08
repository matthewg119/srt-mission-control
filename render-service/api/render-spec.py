"""
Vercel Python serverless function: render a Workflow Builder v2 spec MP4.

Mission Control POSTs a workflow's baked render_spec: N still-image shots with
start/end times, text chips at arbitrary timestamps, and the workflow's OWN
song URL. We render with srt_reel.spec_engine (custom song looped/trimmed to
the spec duration), upload the MP4 to the Supabase `reels` bucket, and return
its URL. All Slack posting + DB writes stay in TypeScript.

Request  (POST, header `x-reel-secret: $REEL_RENDER_SECRET`):
  { "song_url": str|null,              # null = default bed (song_master)
    "duration": float,                 # total seconds, <= 60
    "shots": [ { "image_url": str, "start": float, "end": float,
                 "zoom": float|0 }, ... ],
    "texts": [ { "text": str, "at_second": float, "out_second": float,
                 "position": "top|upper_side|upper_middle|center|lower|bottom",
                 "color": str|null, "size": "small|medium|large" }, ... ] }

URLs only (Supabase public URLs) — Vercel rejects bodies over ~4.5 MB.

Response:
  { "url": "https://.../reels/<id>.mp4", "duration": float }
  { "mp4_b64": "<base64>" }            # fallback when Supabase env is missing
"""

import base64
import json
import os
import sys
import tempfile
import urllib.request
import uuid
from http.server import BaseHTTPRequestHandler

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from srt_reel import spec_engine


def _supabase_upload(mp4_path: str) -> str | None:
    base = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not base or not key:
        return None
    base = base.rstrip("/")
    name = f"{uuid.uuid4().hex}.mp4"
    with open(mp4_path, "rb") as fh:
        body = fh.read()
    req = urllib.request.Request(
        f"{base}/storage/v1/object/reels/{name}",
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {key}",
            "apikey": key,
            "Content-Type": "video/mp4",
            "x-upsert": "true",
        },
    )
    urllib.request.urlopen(req, timeout=60).read()
    return f"{base}/storage/v1/object/public/reels/{name}"


def _download(url: str, dest: str, what: str):
    try:
        with urllib.request.urlopen(url, timeout=60) as resp:
            data = resp.read()
    except Exception as e:
        raise ValueError(f"could not download {what}: {url} ({e})")
    if not data:
        raise ValueError(f"empty download for {what}: {url}")
    with open(dest, "wb") as fh:
        fh.write(data)
    return dest


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

        shots = body.get("shots") or []
        texts = body.get("texts") or []
        try:
            duration = float(body.get("duration") or 0)
        except (TypeError, ValueError):
            return self._send(400, {"error": "duration must be a number"})

        problems = spec_engine.validate_spec(shots, texts, duration)
        if problems:
            return self._send(400, {"error": "invalid spec", "problems": problems})

        tmpdir = tempfile.mkdtemp(prefix="spec_")
        out_path = os.path.join(tmpdir, "reel.mp4")
        try:
            image_paths = []
            for i, s in enumerate(shots):
                path = os.path.join(tmpdir, f"shot_{i}")
                _download(s["image_url"], path, f"shot {i + 1} image")
                image_paths.append(path)

            song_path = None
            song_url = body.get("song_url")
            if song_url:
                song_path = _download(song_url, os.path.join(tmpdir, "song"), "song")

            spec_engine.render_spec(
                shots, texts, image_paths, song_path, duration, out_path, quiet=True
            )

            url = _supabase_upload(out_path)
            if url:
                return self._send(200, {"url": url, "duration": duration})
            with open(out_path, "rb") as fh:
                return self._send(
                    200,
                    {
                        "mp4_b64": base64.b64encode(fh.read()).decode("ascii"),
                        "duration": duration,
                    },
                )
        except ValueError as e:
            return self._send(400, {"error": str(e)})
        except Exception as e:
            return self._send(500, {"error": str(e)})
