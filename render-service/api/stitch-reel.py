"""
Vercel Python serverless function: stitch pre-made clips into one music+hook reel.

Mission Control (TypeScript) POSTs an ordered list of clip URLs (the per-shot MP4s
already rendered by the motion engine, uploaded to the Supabase `reels` bucket) plus
the chosen on-screen hook. We download the clips, ffmpeg-concat them onto the locked
720x1280 canvas, lay the fixed `song_master.m4a` bed, burn a beat-synced hook chip
(rendered by the vendored srt_reel engine's chip renderer), upload the final MP4 to
the Supabase `reels` bucket, and return its URL.

All Slack posting + DB writes stay in TypeScript; this function ONLY stitches.

Request  (POST, header `x-reel-secret: $REEL_RENDER_SECRET`):
  { "clips": ["https://.../clip0.mp4", ...],   # ordered, required, non-empty
    "hook":  "on-screen text" | null,          # optional; no chip if blank
    "color": "pink" }                          # optional accent (engine.PALETTE key)
Response:
  { "url": "https://.../reels/<id>.mp4" }       # when Supabase is configured
  { "mp4_b64": "<base64>" }                     # fallback when Supabase env is missing
"""

import json
import os
import sys
import tempfile
import uuid
import base64
import subprocess
import urllib.request
from http.server import BaseHTTPRequestHandler

# Make the vendored engine importable regardless of Vercel's cwd/sys.path.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from srt_reel import engine


def _supabase_upload(mp4_path: str) -> str | None:
    """PUT the stitched MP4 into the Supabase `reels` bucket; return its public URL.
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


def _pick_color(raw) -> str:
    """Validate the requested accent against the locked palette; default SRT pink.
    `white` is reserved for the top label, so never use it for a hook chip."""
    c = str(raw or "").strip().lower()
    if c and c != "white" and c in engine.PALETTE:
        return c
    return "pink"


def _stitch(clip_paths, song_idx, chip_path, chip_idx, out_path):
    """Build + run the single ffmpeg invocation: normalize -> concat -> song -> hook chip."""
    n = len(clip_paths)
    parts = []
    for i in range(n):
        parts.append(
            f"[{i}:v]scale={engine.W}:{engine.H}:force_original_aspect_ratio=increase,"
            f"crop={engine.W}:{engine.H},setsar=1,fps={engine.FPS}[v{i}]"
        )
    concat_inputs = "".join(f"[v{i}]" for i in range(n))
    parts.append(f"{concat_inputs}concat=n={n}:v=1:a=0[vcat]")

    if chip_path:
        # Drop the hook on the first card beat of the locked song (CUES[1] ~= 0.2s),
        # high-third like the body cards, fading in over a quarter second.
        t = engine.CUES[1] if len(engine.CUES) > 1 else 0.2
        y = int(engine.H * 0.16)
        parts.append(f"[{chip_idx}:v]format=rgba,fade=in:st={t}:d=0.25:alpha=1[ck]")
        parts.append(f"[vcat][ck]overlay=(W-w)/2:{y}:enable='gte(t,{t})'[vout]")
        vlabel = "[vout]"
    else:
        vlabel = "[vcat]"

    cmd = [engine.FFMPEG, "-y", "-loglevel", "error"]
    for p in clip_paths:
        cmd += ["-i", p]
    cmd += ["-stream_loop", "-1", "-i", engine.SONG]
    if chip_path:
        cmd += ["-i", chip_path]
    cmd += [
        "-filter_complex", ";".join(parts),
        "-map", vlabel, "-map", f"{song_idx}:a",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "medium", "-crf", "20",
        "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", out_path,
    ]
    proc = subprocess.run(cmd, capture_output=True, timeout=110)
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg stitch failed: {proc.stderr.decode('utf-8', 'ignore')[-400:]}")


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

        clips = [str(x).strip() for x in (body.get("clips") or []) if str(x).strip()]
        if not clips:
            return self._send(400, {"error": "need a non-empty `clips` list of URLs"})
        hook = str(body.get("hook") or "").strip()
        color = _pick_color(body.get("color"))

        tmpdir = tempfile.mkdtemp(prefix="stitch_")
        out_path = os.path.join(tmpdir, "reel.mp4")
        chip_path = None
        try:
            clip_paths = []
            for i, url in enumerate(clips):
                p = os.path.join(tmpdir, f"clip_{i}.mp4")
                with urllib.request.urlopen(url, timeout=60) as resp:
                    with open(p, "wb") as fh:
                        fh.write(resp.read())
                clip_paths.append(p)

            if hook:
                chip = engine.render_chip(hook, color, kind="body")
                chip_path = os.path.join(tmpdir, "hook.png")
                chip.save(chip_path, "PNG")

            song_idx = len(clip_paths)
            chip_idx = song_idx + 1 if chip_path else None
            _stitch(clip_paths, song_idx, chip_path, chip_idx, out_path)

            url = _supabase_upload(out_path)
            if url:
                return self._send(200, {"url": url})

            with open(out_path, "rb") as fh:
                return self._send(200, {"mp4_b64": base64.b64encode(fh.read()).decode("ascii")})
        except Exception as e:
            return self._send(500, {"error": str(e)})
