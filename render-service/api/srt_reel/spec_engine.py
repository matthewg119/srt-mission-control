"""
SRT Spec Engine (Workflow Builder v2)
-------------------------------------
Renders a fully spec-driven vertical reel: N shots (still images or animated
clips) with start/end times, text chips that appear/disappear at arbitrary
timestamps, and the workflow's OWN song (looped when shorter than the video,
trimmed when longer). A video shot's own audio is mixed in faintly at
CLIP_AUDIO_VOLUME; the song stays the main track.

This is the generic counterpart to engine.render(): that one is the locked
Vargas format (one image, fixed song_master, fixed cue times); this one takes
a workflow's render_spec verbatim. engine.py stays untouched; we reuse its
primitives (cover, render_chip, ease_pop, PALETTE, FFMPEG, W/H/FPS).
"""

import math
import os
import random
import re
import subprocess
import tempfile
import urllib.parse
import urllib.request

from PIL import Image

from . import engine

W, H, FPS = engine.W, engine.H, engine.FPS

# Bump on every renderer behavior change so a render response can prove which
# build actually ran (surfaced in render-spec.py's JSON + logged by render-client.ts).
ENGINE_VERSION = "spec-2026-07-16-smart-linebreaks"  # must match EXPECTED_ENGINE_VERSION in render-client.ts

POP = 0.18        # seconds of pop-in (same feel as engine.render)
FADE_OUT = 0.12   # seconds of alpha fade before a text's out_second
STACK_GAP = 12    # px between two chips active at the same position
MAX_DURATION = 60.0

# Voiceover: each text line is synthesized (free keyless TTS — Google Translate first,
# Edge neural as fallback), lightly sped up (pitch-preserving), mixed at its at_second over
# a ducked music bed.
TTS_SAMPLE_RATE = 44100
# atempo multiplier per style. This changes SPEED only and preserves pitch (no chipmunk), so
# the voice stays natural and understandable. 1.0 = fully natural pace.
# Valid atempo range is 0.5-2.0.
VO_STYLE_SPEED = {"chipmunk": 1.0}
VO_DEFAULT_SPEED = 1.0
DUCK_VOLUME = 0.30                    # music bed level while voiceover plays
VO_LINE_GAP = 0.15                    # min silence between two voice lines (no talk-over)
CLIP_AUDIO_VOLUME = 0.05              # a video shot's OWN sound, faint under the song ("volume 5")

# y-center of each named position, as a fraction of H. x is always centered.
POSITIONS = {
    "top": 0.14,
    "upper_side": 0.16,
    "upper_middle": 0.27,
    "center": 0.50,
    "lower": 0.72,
    "bottom": 0.86,
}
DEFAULT_POSITION = "center"

# Smaller than the locked format so the chips stop covering the footage (matches
# how Matthew edits in CapCut). Tunable: "medium" is the default and lands ~46px.
SIZE_SCALE = {"small": 0.60, "medium": 0.72, "large": 0.85}

SAFE_TOP = int(H * 0.11)
SAFE_BOT = int(H * 0.93)


def _color_cycle():
    """Yield palette color keys in a shuffled cycle so every box that doesn't pin
    its own color gets a different one (pink/green/purple/... mix). Reshuffles
    each time the deck is exhausted."""
    keys = list(engine.PALETTE.keys())
    random.shuffle(keys)
    i = 0
    while True:
        if i >= len(keys):
            random.shuffle(keys)
            i = 0
        yield keys[i]
        i += 1


def validate_spec(shots, texts, duration):
    """Return a list of human-readable problems; empty list = renderable."""
    problems = []
    if not shots:
        problems.append("shots is empty")
    if not duration or duration <= 0:
        problems.append("duration must be > 0")
    if duration and duration > MAX_DURATION:
        problems.append(f"duration {duration}s exceeds the {MAX_DURATION:.0f}s cap")
    for i, s in enumerate(shots):
        if not s.get("image_url") and not s.get("video_url"):
            problems.append(f"shot {i + 1} has no image_url or video_url")
        start, end = float(s.get("start", 0)), float(s.get("end", 0))
        if end <= start:
            problems.append(f"shot {i + 1}: end ({end}) must be after start ({start})")
    for j, t in enumerate(texts or []):
        if not str(t.get("text") or "").strip():
            problems.append(f"text {j + 1} is empty")
        at = float(t.get("at_second", 0))
        out = float(t.get("out_second", 0))
        if out <= at:
            problems.append(f"text {j + 1}: out_second ({out}) must be after at_second ({at})")
        if duration and at >= duration:
            problems.append(f"text {j + 1} starts at {at}s, past the end of the video")
        pos = t.get("position")
        if pos and pos not in POSITIONS:
            problems.append(
                f"text {j + 1}: unknown position '{pos}' (use {', '.join(POSITIONS)})"
            )
        color = t.get("color")
        if color and color not in engine.PALETTE:
            problems.append(
                f"text {j + 1}: unknown color '{color}' (use {', '.join(engine.PALETTE)})"
            )
    return problems


def _prep_shots(shots, sources):
    """Prep each shot's background, keeping slot times.

    `sources[i]` mirrors `shots[i]` (before the start-sort) and is either
    {"kind":"image","path":...} (cover-cropped once here) or
    {"kind":"video","frames_dir":...,"count":N} (frames already cover-cropped to
    WxH by render-spec.py). A bare path is treated as an image for back-compat."""
    out = []
    for s, src in zip(shots, sources):
        shot = dict(
            start=float(s.get("start", 0)),
            end=float(s.get("end", 0)),
            zoom=float(s.get("zoom") or 0.0),
        )
        if isinstance(src, dict) and src.get("kind") == "video":
            shot.update(
                kind="video",
                frames_dir=src["frames_dir"],
                count=int(src["count"]),
                audio_path=src.get("audio_path"),
            )
        else:
            path = src["path"] if isinstance(src, dict) else src
            shot.update(kind="image", img=engine.cover(path))
        out.append(shot)
    out.sort(key=lambda x: x["start"])
    return out


def _prep_texts(texts):
    """Render every chip once; keep timing + placement.

    `pop` (default True) animates the chip in with the CapCut-style pop; a chip
    with pop=False just appears at full size the instant it's due (used for the
    first line of each shot, which is baked into the cut). Chips without an
    explicit `color` get a randomized palette color."""
    palette = _color_cycle()
    out = []
    for t in texts or []:
        position = t.get("position") or DEFAULT_POSITION
        color = t.get("color") or next(palette)
        scale = SIZE_SCALE.get(t.get("size") or "medium", SIZE_SCALE["medium"])
        chip = engine.render_chip(str(t["text"]), color, "body", scale)
        out.append(
            dict(
                chip=chip,
                at=float(t.get("at_second", 0)),
                out=float(t.get("out_second", 0)),
                position=position,
                pop=bool(t.get("pop", True)),
            )
        )
    out.sort(key=lambda x: x["at"])
    return out


def _active_shot(shots, t):
    """Shot whose slot contains t; first shot before its start, last shot holds."""
    for s in shots:
        if s["start"] <= t < s["end"]:
            return s
    if t < shots[0]["start"]:
        return shots[0]
    return shots[-1]


def _zoomed(img, shot, t):
    """Ken-burns crop of a WxH image, zoom progressing over the shot's OWN slot."""
    slot = max(0.001, shot["end"] - shot["start"])
    p = min(1.0, max(0.0, (t - shot["start"]) / slot))
    z = 1 + shot["zoom"] * p
    fw, fh = int(W * z), int(H * z)
    return img.resize((fw, fh), Image.LANCZOS).crop(
        ((fw - W) // 2, (fh - H) // 2, (fw - W) // 2 + W, (fh - H) // 2 + H)
    )


def _shot_frame(shot, t):
    """The shot's frame at time t.

    Stills apply the ken-burns zoom over the shot's slot. A video shot returns its
    pre-extracted (already cover-cropped) frame at the local time, holding the last
    frame if the clip is shorter than the shot; zoom is applied only when set > 0
    so the clip's own motion normally reads on its own."""
    if shot["kind"] == "video":
        idx = max(0, min(shot["count"] - 1, int((t - shot["start"]) * FPS)))
        img = Image.open(
            os.path.join(shot["frames_dir"], f"{idx + 1:05d}.jpg")
        ).convert("RGB")
        return (_zoomed(img, shot, t) if shot["zoom"] > 0 else img).convert("RGBA")
    if shot["zoom"] <= 0:
        return shot["img"].convert("RGBA")
    return _zoomed(shot["img"], shot, t).convert("RGBA")


def _place_texts(active, t):
    """Yield (chip, x, y_center, scale, alpha) for every active text at time t.

    Each chip is anchored to its own position's y-center, but a lower chip is
    pushed DOWN whenever it would cover the chip above it (across all positions,
    not just chips sharing a position). This keeps the title fixed and drops the
    next line below it instead of on top. Nothing ever overlaps."""
    # Top -> bottom by position, then resolve collisions in one downward sweep.
    ordered = sorted(active, key=lambda it: POSITIONS[it["position"]])
    placed = []          # (item, top_y)
    prev_bottom = SAFE_TOP
    for it in ordered:
        ch = it["chip"].size[1]
        anchor_top = int(H * POSITIONS[it["position"]]) - ch // 2
        top = max(anchor_top, prev_bottom)
        placed.append((it, top))
        prev_bottom = top + ch + STACK_GAP
    # If the stack ran past the bottom safe line, shift the whole group up.
    overflow = (prev_bottom - STACK_GAP) - SAFE_BOT
    if overflow > 0:
        placed = [(it, top - overflow) for it, top in placed]

    for it, top in placed:
        chip = it["chip"]
        if it["pop"]:
            p_in = min(1.0, (t - it["at"]) / POP)
            scale = engine.ease_pop(p_in)
            alpha = min(1.0, (t - it["at"]) / (POP * 0.6))
        else:
            # First line of the shot: appears with the cut, no pop / no fade-in.
            scale = 1.0
            alpha = 1.0
        remaining = it["out"] - t
        if remaining < FADE_OUT:
            alpha *= max(0.0, remaining / FADE_OUT)
        cw, ch = chip.size
        yield chip, (W - cw) // 2, top + ch // 2, scale, alpha


def _tts_text(raw):
    """The line as spoken: drop emoji chunks, collapse whitespace."""
    parts = [s for kind, s in engine.split_emoji(str(raw)) if kind == "txt"]
    return " ".join("".join(parts).split())


EDGE_VOICE = "en-US-GuyNeural"   # neutral neural voice; chipmunked at mux time


def _tts_google(text, dest):
    """Free keyless Google Translate TTS (same endpoint gTTS uses) -> mp3 at dest.
    Short lines only (the endpoint caps ~200 chars, well above ours)."""
    url = "https://translate.google.com/translate_tts?" + urllib.parse.urlencode(
        {"ie": "UTF-8", "client": "tw-ob", "tl": "en", "q": text[:200]}
    )
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        data = resp.read()
    if not data:
        raise ValueError("empty audio")
    with open(dest, "wb") as fh:
        fh.write(data)
    return dest


def _tts_edge(text, dest):
    """Free keyless Microsoft Edge neural TTS (edge-tts package) -> mp3 at dest."""
    import asyncio
    import edge_tts

    async def _go():
        await edge_tts.Communicate(text, EDGE_VOICE).save(dest)

    asyncio.run(_go())
    if not os.path.exists(dest) or not os.path.getsize(dest):
        raise ValueError("empty audio")
    return dest


def _synthesize_tts(text, dest):
    """Free, keyless text-to-speech -> mp3 at dest. Google Translate TTS first; if it
    fails (e.g. the server IP gets rate-limited) fall back to Edge neural TTS. Raises
    ValueError only if BOTH fail."""
    try:
        return _tts_google(text, dest)
    except Exception as e_google:
        try:
            return _tts_edge(text, dest)
        except Exception as e_edge:
            raise ValueError(f"TTS failed (google: {e_google}; edge: {e_edge})")


def _audio_duration(path):
    """Clip duration in seconds. imageio-ffmpeg bundles ffmpeg but not ffprobe, so read
    it from `ffmpeg -i`'s stderr ("Duration: HH:MM:SS.ss"). Returns 0.0 if not found."""
    try:
        proc = subprocess.run(
            [engine.FFMPEG, "-i", path],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            timeout=30,
        )
        err = proc.stderr.decode("utf-8", "ignore")
        m = re.search(r"Duration:\s*(\d+):(\d+):([\d.]+)", err)
        if m:
            return int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3))
    except Exception:
        pass
    return 0.0


def _prep_voiceover(texts, voiceover, workdir):
    """Synthesize a clip per text line. Returns [(path, at_second, duration), ...]
    ordered by at_second. No API key required."""
    clips = []
    for k, t in enumerate(sorted(texts or [], key=lambda x: float(x.get("at_second", 0)))):
        spoken = _tts_text(t.get("text", ""))
        if not spoken:
            continue
        dest = os.path.join(workdir or ".", f"vo_{k}.mp3")
        _synthesize_tts(spoken, dest)
        # ~15 chars/sec of speech is a safe estimate when the probe comes up empty,
        # so the no-overlap sequencing still has something to work with.
        dur = _audio_duration(dest) or (len(spoken) / 15.0)
        clips.append((dest, float(t.get("at_second", 0)), dur))
    return clips


def _sequence_voiceover(clips, speed):
    """Turn cue times into start times that never overlap: each line starts at its
    at_second OR when the previous line has finished (+ VO_LINE_GAP), whichever is
    later. Voice can drift later than the on-screen text on dense workflows, but two
    lines never talk over each other. Returns [(path, start_second), ...]."""
    out = []
    prev_end = 0.0
    for path, at, dur in clips:
        start = max(at, prev_end)
        effective = (dur / speed) if speed else dur
        prev_end = start + effective + VO_LINE_GAP
        out.append((path, start))
    return out


def render_spec(shots, texts, sources, song_path, duration, out_path,
                quiet=True, voiceover=None, workdir=None):
    """Render the spec to out_path.

    shots:     [{image_url, video_url?, start, end, zoom?}] (urls only used for errors)
    texts:     [{text, at_second, out_second, position?, color?, size?}]
    sources:   per-shot background, same order as shots: {"kind":"image","path":...}
               or {"kind":"video","frames_dir":...,"count":N}
    song_path: local audio file, or None for the default bed (engine.SONG)
    duration:  total seconds (song loops if shorter, trims if longer)
    voiceover: {"enabled": bool, "style": "chipmunk"} or None. When enabled, each text
               line is read aloud (TTS) at its at_second (pushed later if the previous
               line hasn't finished — lines never overlap), natural pitch and pace,
               over a ducked music bed.
    workdir:   temp dir for the synthesized voiceover clips.
    """
    prepped_shots = _prep_shots(shots, sources)
    prepped_texts = _prep_texts(texts)
    total = float(duration)
    nframes = int(math.ceil(total * FPS))

    song = song_path or engine.SONG

    vo_clips = []
    if voiceover and voiceover.get("enabled"):
        vo_clips = _prep_voiceover(texts, voiceover, workdir)

    # A video shot's own soundtrack (extracted by render-spec.py, already trimmed to the
    # slot) plays faintly under the song from the shot's start. The song stays the main bed.
    clip_audios = [
        (s["audio_path"], s["start"])
        for s in prepped_shots
        if s["kind"] == "video" and s.get("audio_path")
    ]

    cmd = [
        engine.FFMPEG, "-y", "-loglevel", "error",
        "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
        "-stream_loop", "-1", "-i", song,
    ]
    if vo_clips or clip_audios:
        # One mix graph: song bed (ducked only while VO plays) + delayed voice lines +
        # delayed faint clip audio. Inputs: 0=video pipe, 1=song, extras from 2 up.
        extra_inputs = []
        parts = [f"[1:a]volume={DUCK_VOLUME if vo_clips else 1.0}[bg]"]
        mix_labels = ["[bg]"]
        if vo_clips:
            speed = VO_STYLE_SPEED.get((voiceover or {}).get("style"), VO_DEFAULT_SPEED)
            for path, at in _sequence_voiceover(vo_clips, speed):
                extra_inputs.append(path)
                ff_in = 1 + len(extra_inputs)
                ms = max(0, int(at * 1000))
                lbl = f"[v{ff_in}]"
                parts.append(f"[{ff_in}:a]atempo={speed},adelay={ms}|{ms}{lbl}")
                mix_labels.append(lbl)
        for path, at in clip_audios:
            extra_inputs.append(path)
            ff_in = 1 + len(extra_inputs)
            ms = max(0, int(at * 1000))
            lbl = f"[c{ff_in}]"
            parts.append(f"[{ff_in}:a]volume={CLIP_AUDIO_VOLUME},adelay={ms}|{ms}{lbl}")
            mix_labels.append(lbl)
        for path in extra_inputs:
            cmd += ["-i", path]
        parts.append(
            "".join(mix_labels)
            + f"amix=inputs={len(mix_labels)}:normalize=0:duration=first[aout]"
        )
        cmd += [
            "-filter_complex", ";".join(parts),
            "-map", "0:v", "-map", "[aout]",
            "-t", f"{total:.3f}",
            "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "medium", "-crf", "20",
            "-c:a", "aac", "-b:a", "192k",
            "-movflags", "+faststart", out_path,
        ]
    else:
        cmd += [
            "-t", f"{total:.3f}",
            "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "medium", "-crf", "20",
            "-c:a", "aac", "-b:a", "192k", "-shortest",
            "-movflags", "+faststart", out_path,
        ]
    # stderr goes to a file (not a pipe) so a chatty/dying ffmpeg can't deadlock
    # against our stdin writes; its tail makes the failure message actionable.
    stderr_path = os.path.join(workdir or tempfile.gettempdir(), "ffmpeg_encode_stderr.log")
    with open(stderr_path, "wb") as stderr_fh:
        proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stderr=stderr_fh)

        try:
            for fi in range(nframes):
                t = fi / FPS
                fr = _shot_frame(_active_shot(prepped_shots, t), t)
                active = [x for x in prepped_texts if x["at"] <= t < x["out"]]
                for chip, x, y_center, scale, alpha in _place_texts(active, t):
                    if alpha <= 0:
                        continue
                    cw, ch = chip.size
                    sw, sh = max(1, int(cw * scale)), max(1, int(ch * scale))
                    c2 = chip.resize((sw, sh), Image.LANCZOS) if scale < 1 else chip
                    if alpha < 1:
                        a = c2.split()[3].point(lambda v: int(v * alpha))
                        c2 = c2.copy()
                        c2.putalpha(a)
                    fr.alpha_composite(c2, (x + (cw - sw) // 2, y_center - sh // 2))
                proc.stdin.write(fr.convert("RGB").tobytes())
            proc.stdin.close()
        except BrokenPipeError:
            pass  # ffmpeg died mid-stream; fall through to report its stderr
        proc.wait()
    if proc.returncode != 0:
        try:
            with open(stderr_path, "rb") as fh:
                tail = fh.read().decode("utf-8", "ignore").strip()[-400:]
        except OSError:
            tail = ""
        raise RuntimeError(
            f"ffmpeg encode failed (exit {proc.returncode}){f': {tail}' if tail else ''}"
        )
    if not quiet:
        print(f"  -> {out_path}  ({total:.1f}s, {nframes} frames)")
    return out_path
