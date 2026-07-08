"""
SRT Spec Engine (Workflow Builder v2)
-------------------------------------
Renders a fully spec-driven vertical reel: N still-image shots with start/end
times, text chips that appear/disappear at arbitrary timestamps, and the
workflow's OWN song (looped when shorter than the video, trimmed when longer).

This is the generic counterpart to engine.render(): that one is the locked
Vargas format (one image, fixed song_master, fixed cue times); this one takes
a workflow's render_spec verbatim. engine.py stays untouched; we reuse its
primitives (cover, render_chip, ease_pop, PALETTE, FFMPEG, W/H/FPS).
"""

import math
import random
import subprocess

from PIL import Image

from . import engine

W, H, FPS = engine.W, engine.H, engine.FPS

# Bump on every renderer behavior change so a render response can prove which
# build actually ran (surfaced in render-spec.py's JSON + logged by render-client.ts).
ENGINE_VERSION = "spec-2026-07-08-decollide"

POP = 0.18        # seconds of pop-in (same feel as engine.render)
FADE_OUT = 0.12   # seconds of alpha fade before a text's out_second
STACK_GAP = 12    # px between two chips active at the same position
MAX_DURATION = 60.0

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
        if not s.get("image_url"):
            problems.append(f"shot {i + 1} has no image_url")
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


def _prep_shots(shots, image_paths):
    """Cover-crop every shot image once; keep slot times."""
    out = []
    for s, path in zip(shots, image_paths):
        out.append(
            dict(
                img=engine.cover(path),
                start=float(s.get("start", 0)),
                end=float(s.get("end", 0)),
                zoom=float(s.get("zoom") or 0.0),
            )
        )
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


def _shot_frame(shot, t):
    """The shot's frame at time t, zoom progressing over the shot's OWN slot."""
    if shot["zoom"] <= 0:
        return shot["img"].convert("RGBA")
    slot = max(0.001, shot["end"] - shot["start"])
    p = min(1.0, max(0.0, (t - shot["start"]) / slot))
    z = 1 + shot["zoom"] * p
    fw, fh = int(W * z), int(H * z)
    return (
        shot["img"]
        .resize((fw, fh), Image.LANCZOS)
        .crop(((fw - W) // 2, (fh - H) // 2, (fw - W) // 2 + W, (fh - H) // 2 + H))
        .convert("RGBA")
    )


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


def render_spec(shots, texts, image_paths, song_path, duration, out_path, quiet=True):
    """Render the spec to out_path.

    shots:       [{image_url, start, end, zoom?}] (image_url only used for errors)
    texts:       [{text, at_second, out_second, position?, color?, size?}]
    image_paths: local file per shot, same order as shots
    song_path:   local audio file, or None for the default bed (engine.SONG)
    duration:    total seconds (song loops if shorter, trims if longer)
    """
    prepped_shots = _prep_shots(shots, image_paths)
    prepped_texts = _prep_texts(texts)
    total = float(duration)
    nframes = int(math.ceil(total * FPS))

    song = song_path or engine.SONG
    cmd = [
        engine.FFMPEG, "-y", "-loglevel", "error",
        "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
        "-stream_loop", "-1", "-i", song,
        "-t", f"{total:.3f}",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "medium", "-crf", "20",
        "-c:a", "aac", "-b:a", "192k", "-shortest",
        "-movflags", "+faststart", out_path,
    ]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE)

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
    proc.wait()
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg exited with {proc.returncode}")
    if not quiet:
        print(f"  -> {out_path}  ({total:.1f}s, {nframes} frames)")
    return out_path
