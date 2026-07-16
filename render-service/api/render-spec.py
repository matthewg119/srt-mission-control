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
    "shots": [ { "image_url": str, "video_url": str|null, "start": float,
                 "end": float, "zoom": float|0 }, ... ],
                 # video_url (an animated clip) renders in place of the still,
                 # trimmed to the shot; falls back to image_url when absent. The
                 # clip's own audio is mixed FAINTLY (CLIP_AUDIO_VOLUME) under the
                 # song, which stays the main track.
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
import shutil
import subprocess
import sys
import tempfile
import urllib.parse
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


def _download(url: str, dest: str, what: str, expect_video: bool = False):
    try:
        with urllib.request.urlopen(url, timeout=60) as resp:
            content_type = resp.headers.get("Content-Type", "unknown")
            data = resp.read()
    except Exception as e:
        raise ValueError(f"could not download {what}: {url} ({e})")
    if not data:
        raise ValueError(f"empty download for {what}: {url}")
    if expect_video:
        # MP4/MOV/M4V carry "ftyp" at offset 4; WebM/MKV start with the EBML magic.
        is_video = data[4:8] == b"ftyp" or data[:4] == b"\x1a\x45\xdf\xa3"
        if not is_video:
            host = urllib.parse.urlparse(url).hostname or "?"
            raise ValueError(
                f"{what}: download from {host} is not a video "
                f"(content-type {content_type}, {len(data)} bytes, starts {data[:12]!r})"
            )
    with open(dest, "wb") as fh:
        fh.write(data)
    return dest


def _extract_video_audio(src: str, dest: str, seconds: float) -> bool:
    """Pull the clip's OWN audio track (trimmed to the shot slot) so the engine can mix
    it faintly under the song. Returns False when the clip is silent / has no audio
    stream (many image-to-video exports are), which just means nothing to mix."""
    eng = spec_engine.engine
    cmd = [
        eng.FFMPEG, "-y", "-loglevel", "error",
        "-i", src, "-t", f"{max(0.001, seconds):.3f}",
        "-vn", "-c:a", "aac", "-b:a", "128k", dest,
    ]
    if subprocess.run(cmd).returncode != 0:
        return False
    return os.path.exists(dest) and os.path.getsize(dest) > 0


def _extract_video_frames(src: str, frames_dir: str, seconds: float, what: str) -> int:
    """Explode a video into cover-cropped 9:16 JPEG frames at the render FPS, capped
    to `seconds` (so a clip longer than its shot is trimmed at the end). The
    cover-crop mirrors engine.cover(); frames come out already sized WxH so the
    per-frame loop treats them exactly like a still. Returns the frame count.

    JPEG, not PNG: a 5s 720x1280 clip is ~250 MB as PNGs vs ~25 MB as JPEGs, and
    Vercel's /tmp is 500 MB total — three PNG clips exhaust it mid-render."""
    eng = spec_engine.engine
    w, h, fps = eng.W, eng.H, eng.FPS
    vf = (
        f"scale={w}:{h}:force_original_aspect_ratio=increase,"
        f"crop={w}:{h},fps={fps}"
    )
    cmd = [
        eng.FFMPEG, "-y", "-loglevel", "error",
        "-i", src, "-t", f"{max(0.001, seconds):.3f}",
        "-vf", vf, "-q:v", "3", os.path.join(frames_dir, "%05d.jpg"),
    ]
    proc = subprocess.run(cmd, stderr=subprocess.PIPE)
    stderr_tail = proc.stderr.decode("utf-8", "ignore").strip()[-400:]
    if proc.returncode != 0:
        raise ValueError(f"{what}: ffmpeg could not decode the clip: {stderr_tail or f'exit {proc.returncode}'}")
    count = len([n for n in os.listdir(frames_dir) if n.endswith(".jpg")])
    if count <= 0:
        raise ValueError(f"{what}: the clip produced no frames{f' ({stderr_tail})' if stderr_tail else ''}")
    return count


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
            # Each shot's background is a still image OR an animated video clip.
            # A video is downloaded and pre-exploded into cover-cropped frames
            # (trimmed to the shot length); the engine then treats those frames
            # exactly like a still per frame.
            sources = []
            for i, s in enumerate(shots):
                video_url = s.get("video_url")
                if video_url:
                    what = f"shot {i + 1} video"
                    vid_path = os.path.join(tmpdir, f"shot_{i}.mp4")
                    _download(video_url, vid_path, what, expect_video=True)
                    frames_dir = os.path.join(tmpdir, f"shot_{i}_frames")
                    os.makedirs(frames_dir, exist_ok=True)
                    slot = float(s.get("end", 0)) - float(s.get("start", 0))
                    count = _extract_video_frames(vid_path, frames_dir, slot, what)
                    # The clip's own sound rides under the song at CLIP_AUDIO_VOLUME;
                    # a silent clip simply contributes nothing.
                    audio_path = os.path.join(tmpdir, f"shot_{i}_audio.m4a")
                    if not _extract_video_audio(vid_path, audio_path, slot):
                        audio_path = None
                    # /tmp is only 500 MB and shared across warm invocations — drop
                    # the source clip as soon as its frames + audio are extracted.
                    os.remove(vid_path)
                    sources.append({
                        "kind": "video",
                        "frames_dir": frames_dir,
                        "count": count,
                        "audio_path": audio_path,
                    })
                else:
                    path = os.path.join(tmpdir, f"shot_{i}")
                    _download(s["image_url"], path, f"shot {i + 1} image")
                    sources.append({"kind": "image", "path": path})

            song_path = None
            song_url = body.get("song_url")
            if song_url:
                song_path = _download(song_url, os.path.join(tmpdir, "song"), "song")

            spec_engine.render_spec(
                shots, texts, sources, song_path, duration, out_path,
                quiet=True, voiceover=body.get("voiceover"), workdir=tmpdir,
            )

            engine_version = getattr(spec_engine, "ENGINE_VERSION", "unknown")
            url = _supabase_upload(out_path)
            if url:
                return self._send(
                    200, {"url": url, "duration": duration, "engine_version": engine_version}
                )
            with open(out_path, "rb") as fh:
                return self._send(
                    200,
                    {
                        "mp4_b64": base64.b64encode(fh.read()).decode("ascii"),
                        "duration": duration,
                        "engine_version": engine_version,
                    },
                )
        except ValueError as e:
            return self._send(400, {"error": str(e)})
        except Exception as e:
            return self._send(500, {"error": str(e)})
        finally:
            # /tmp persists across warm invocations; leaking ~100s of MB of frames
            # per render exhausts it and kills the NEXT render mid-extraction.
            shutil.rmtree(tmpdir, ignore_errors=True)
