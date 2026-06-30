"""
Vercel Python serverless function: sample evenly-spaced frames from a direct video URL.

Mission Control (TypeScript) re-uploads a Slack-dropped video to the Supabase `reels`
bucket and POSTs the resulting PUBLIC url here. We download the bytes (plain urllib, no
yt-dlp), sample N evenly-spaced frames with ffmpeg, upload the frames (JPEG) back to the
`reels` bucket, and return their public URLs. Claude vision then reads the frames to build
a shot-by-shot storyboard + pest-control remake.

This is the sibling of ig-frames.py; the only real difference is the input is a direct,
publicly-fetchable URL (so no yt-dlp / cookies and no caption), and we probe duration
from ffmpeg's stderr since imageio-ffmpeg bundles ffmpeg but not ffprobe.

All Slack posting + DB writes stay in TypeScript; this function ONLY extracts frames.

Request (POST, header `x-reel-secret: $REEL_RENDER_SECRET`):
  { "url": str, "count": int }            # count defaults to 8, clamped 1..12
Response:
  { "frames": ["https://.../reels/analyzer/<id>.jpg", ...], "duration": float }
"""

import json
import os
import re
import shutil
import tempfile
import uuid
import subprocess
import urllib.request
from http.server import BaseHTTPRequestHandler


def _ffmpeg_bin() -> str:
    sys_ff = shutil.which("ffmpeg")
    if sys_ff:
        return sys_ff
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return "ffmpeg"


def _supabase_upload_jpg(path: str) -> str | None:
    base = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not base or not key:
        return None
    base = base.rstrip("/")
    name = f"analyzer/{uuid.uuid4().hex}.jpg"
    with open(path, "rb") as fh:
        body = fh.read()
    req = urllib.request.Request(
        f"{base}/storage/v1/object/reels/{name}",
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {key}",
            "apikey": key,
            "Content-Type": "image/jpeg",
            "x-upsert": "true",
        },
    )
    urllib.request.urlopen(req, timeout=60).read()
    return f"{base}/storage/v1/object/public/reels/{name}"


def _fetch_video(url: str, tmpdir: str) -> str:
    """Download a direct, public video URL to tmp. Returns the local path."""
    path = os.path.join(tmpdir, "src.mp4")
    req = urllib.request.Request(url, headers={"User-Agent": "srt-reel-render/1.0"})
    with urllib.request.urlopen(req, timeout=120) as resp, open(path, "wb") as fh:
        shutil.copyfileobj(resp, fh)
    return path


def _probe_duration(video_path: str) -> float:
    """imageio-ffmpeg bundles ffmpeg but not ffprobe, so read the duration from
    `ffmpeg -i`'s stderr ("Duration: HH:MM:SS.ss"). Returns 0.0 if not found."""
    ff = _ffmpeg_bin()
    try:
        proc = subprocess.run(
            [ff, "-i", video_path],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            timeout=30,
        )
        err = proc.stderr.decode("utf-8", "ignore")
        m = re.search(r"Duration:\s*(\d+):(\d+):([\d.]+)", err)
        if m:
            h, mnt, sec = int(m.group(1)), int(m.group(2)), float(m.group(3))
            return h * 3600 + mnt * 60 + sec
    except Exception:
        pass
    return 0.0


def _extract_frames(video_path: str, tmpdir: str, count: int, duration: float):
    ff = _ffmpeg_bin()
    frames = []
    # Sample at the midpoint of `count` equal segments so we never grab a black
    # first frame or the very last frame.
    if duration <= 0:
        duration = 6.0
    for i in range(count):
        t = duration * (i + 0.5) / count
        out = os.path.join(tmpdir, f"frame_{i}.jpg")
        cmd = [ff, "-y", "-ss", f"{t:.2f}", "-i", video_path, "-frames:v", "1", "-q:v", "3", out]
        subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=60)
        if os.path.exists(out) and os.path.getsize(out) > 0:
            frames.append(out)
    return frames


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

        url = (body.get("url") or "").strip()
        if not url:
            return self._send(400, {"error": "need url"})
        count = max(1, min(12, int(body.get("count") or 8)))

        tmpdir = tempfile.mkdtemp(prefix="vf_")
        try:
            video_path = _fetch_video(url, tmpdir)
            duration = _probe_duration(video_path)
            frame_paths = _extract_frames(video_path, tmpdir, count, duration)
            if not frame_paths:
                return self._send(500, {"error": "no frames extracted"})

            urls = []
            for p in frame_paths:
                u = _supabase_upload_jpg(p)
                if u:
                    urls.append(u)
            if not urls:
                return self._send(500, {"error": "supabase not configured (no frame urls)"})

            return self._send(200, {"frames": urls, "duration": duration})
        except Exception as e:
            return self._send(500, {"error": str(e)})
        finally:
            shutil.rmtree(tmpdir, ignore_errors=True)
