"""
Vercel Python serverless function: pull sample frames + caption from a social video.

Mission Control (TypeScript) POSTs an Instagram (or other yt-dlp supported) URL. We
download the video with yt-dlp, sample N evenly-spaced frames with ffmpeg, upload the
frames (JPEG) to the Supabase `reels` bucket, and return their public URLs + the caption.
Claude vision then reads the frames + caption to build a POV recreation.

All Slack posting + DB writes stay in TypeScript; this function ONLY extracts frames.

Request (POST, header `x-reel-secret: $REEL_RENDER_SECRET`):
  { "url": str, "count": int }            # count defaults to 5, clamped 1..8
Response:
  { "frames": ["https://.../reels/<id>.jpg", ...], "caption": str, "duration": float }

NOTE: Instagram increasingly requires auth for anonymous downloads. Set env
YTDLP_COOKIES (full cookies.txt contents) to pass a logged-in session if public
fetch fails with "login required".
"""

import json
import os
import sys
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
    name = f"ig/{uuid.uuid4().hex}.jpg"
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


def _download(url: str, tmpdir: str):
    """Download the video with yt-dlp; return (video_path, caption, duration)."""
    import yt_dlp

    out_tmpl = os.path.join(tmpdir, "src.%(ext)s")
    opts = {
        "outtmpl": out_tmpl,
        "format": "mp4/bestvideo*+bestaudio/best",
        "quiet": True,
        "noplaylist": True,
        "nocheckcertificate": True,
    }

    cookies = os.environ.get("YTDLP_COOKIES")
    if cookies:
        cookie_path = os.path.join(tmpdir, "cookies.txt")
        with open(cookie_path, "w", encoding="utf-8") as fh:
            fh.write(cookies)
        opts["cookiefile"] = cookie_path

    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=True)
        path = ydl.prepare_filename(info)

    # prepare_filename may report the pre-merge ext; fall back to whatever landed in tmp.
    if not os.path.exists(path):
        files = [os.path.join(tmpdir, f) for f in os.listdir(tmpdir) if f.startswith("src.")]
        path = files[0] if files else path

    caption = info.get("description") or info.get("title") or ""
    duration = float(info.get("duration") or 0.0)
    return path, caption, duration


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
        count = max(1, min(8, int(body.get("count") or 5)))

        tmpdir = tempfile.mkdtemp(prefix="ig_")
        try:
            video_path, caption, duration = _download(url, tmpdir)
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

            return self._send(200, {"frames": urls, "caption": caption, "duration": duration})
        except Exception as e:
            return self._send(500, {"error": str(e)})
        finally:
            shutil.rmtree(tmpdir, ignore_errors=True)
