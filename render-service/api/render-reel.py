"""
Vercel Python serverless function: render one SRT Reel Studio MP4.

Mission Control (TypeScript) POSTs the final reel script + the background image
(base64). We render with the vendored srt_reel engine (the exact desktop-app
look: white label -> colored hooks -> CTA pill, beat-synced over the fixed song),
upload the MP4 to the Supabase `reels` storage bucket, and return its URL.

All Slack posting + DB writes stay in TypeScript; this function ONLY renders.

Request  (POST, header `x-reel-secret: $REEL_RENDER_SECRET`):
  { "label": str|null, "lines": [str, ...], "cta": str|null,
    "image_b64": str, "image_mime": str, "seed": int|null,
    "locks": { "0": "blue", "cta": "red" }|null }     # optional color locks
Response:
  { "url": "https://.../reels/<id>.mp4" }              # when Supabase is configured
  { "mp4_b64": "<base64>" }                            # fallback for short reels
"""

import json
import os
import sys
import tempfile
import uuid
import base64
import urllib.request
from http.server import BaseHTTPRequestHandler

# Make the vendored engine importable regardless of Vercel's cwd/sys.path.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from srt_reel import engine


def _supabase_upload(mp4_path: str) -> str | None:
    """PUT the rendered MP4 into the Supabase `reels` bucket; return its public URL.
    Returns None if Supabase env is missing (caller falls back to base64)."""
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


def _parse_locks(raw):
    """{ "0": "blue", "cta": "red" } -> { 0: "blue", "cta": "red" } for engine.render."""
    locked = {}
    for k, v in (raw or {}).items():
        if not v:
            continue
        locked[int(k) if str(k).isdigit() else k] = str(v).strip()
    return locked


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

        lines = [str(x) for x in (body.get("lines") or []) if str(x).strip()]
        image_b64 = body.get("image_b64")
        if not image_b64 or not lines:
            return self._send(400, {"error": "need image_b64 and at least one line"})

        tmpdir = tempfile.mkdtemp(prefix="reel_")
        img_path = os.path.join(tmpdir, "bg")
        out_path = os.path.join(tmpdir, "reel.mp4")
        try:
            with open(img_path, "wb") as fh:
                fh.write(base64.b64decode(image_b64))

            headlines = {
                "label": (body.get("label") or None),
                "lines": lines,
                "cta": (body.get("cta") or None),
            }
            engine.render(
                img_path,
                headlines,
                out_path,
                seed=body.get("seed"),
                locked=_parse_locks(body.get("locks")),
                zoom=float(body.get("zoom") or 0.0),
                quiet=True,
            )

            url = _supabase_upload(out_path)
            if url:
                return self._send(200, {"url": url})

            with open(out_path, "rb") as fh:
                return self._send(200, {"mp4_b64": base64.b64encode(fh.read()).decode("ascii")})
        except Exception as e:
            return self._send(500, {"error": str(e)})
