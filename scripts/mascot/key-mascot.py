"""
Turn a generated mascot video with a baked-in checkerboard into a transparent, looping animated WebP.

    python scripts/mascot/key-mascot.py <video.mp4> <out-name> [--height 240] [--fps 12] [--no-still]

Writes src/lib/concierge/mascot/<out-name>.webp (ping-pong loop) and, unless --no-still, a still PNG
for prefers-reduced-motion. Name a flourish <mascot>-<state>, e.g. wizard-cat-wand-throw.

WHY A FLOOD FILL AND NOT A COLOUR KEY (measured 2026-09-16): the Veo clips of the wizard cat are 1280x720
with a fake transparency checkerboard of pure white (255) and light grey (~238) painted into the frame.
A global colour key on those two values would also eat the whites of the cat's eyes and the star
sparkles. The background is the near-white region CONNECTED TO THE FRAME'S EDGE, so that is what is
removed: a flood fill from the border over near-white, low-saturation pixels. The cat's dark outline stops
it, and everything inside the outline keeps its colour.

‼️ THE BACKGROUND TONES ARE SAMPLED PER FRAME, NOT HARDCODED TO NEAR-WHITE (2026-09-16). The blue alien
clips generated the same afternoon carry a DARK grey checkerboard (~128/150), and two of the three start
on a near-white frame and switch to it partway through. A fixed `lo >= 214` floor left the checkerboard
baked into every one of those frames. What actually identifies the background is that it is low
saturation AND the tone found along the frame's own border, so that is what is measured, on each frame
independently. The lightness band keeps the flood off the subject's dark outline exactly as the old
floor did: the cat's outline is near-black, the alien's trousers are near-black, and neither is within
tolerance of a border tone.
"""

import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
OUT_DIR = ROOT / "src" / "lib" / "concierge" / "mascot"


def arg(name: str, default: str) -> str:
    if name in sys.argv:
        return sys.argv[sys.argv.index(name) + 1]
    return default


def frames_of(video: str, fps: int, tmp: Path) -> list[Path]:
    subprocess.run(
        ["ffmpeg", "-v", "error", "-i", video, "-vf", f"fps={fps}", str(tmp / "f%03d.png")],
        check=True,
    )
    return sorted(tmp.glob("f*.png"))


SAT_TOL = 18
TONE_TOL = 26


def background_band(rgb: np.ndarray) -> tuple[int, int]:
    """
    The lightness band the frame's own border sits in, as (low, high).

    Measured from the border because that is the only part of the frame we know is background. Only
    low-saturation border pixels count, so a subject that happens to touch an edge cannot widen the
    band into its own colours. Percentiles rather than min/max: a single stray pixel of the subject
    or of codec noise on the border should not open the band by forty levels.
    """
    border = np.concatenate(
        [rgb[0, :, :], rgb[-1, :, :], rgb[:, 0, :], rgb[:, -1, :]]
    ).astype(int)
    hi = border.max(axis=1)
    lo = border.min(axis=1)
    flat = lo[(hi - lo) <= SAT_TOL]
    if flat.size == 0:
        # No flat border at all. Fall back to the near-white floor this script shipped with, which is
        # right for every wizard-cat clip and simply keys nothing when it is wrong.
        return 214, 255
    return int(np.percentile(flat, 2)) - TONE_TOL, int(np.percentile(flat, 98)) + TONE_TOL


def background_mask(rgb: np.ndarray, band: tuple[int, int]) -> np.ndarray:
    """True where the pixel is checkerboard, reachable from the frame's edge."""
    r, g, b = rgb[..., 0].astype(int), rgb[..., 1].astype(int), rgb[..., 2].astype(int)
    hi = np.maximum(np.maximum(r, g), b)
    lo = np.minimum(np.minimum(r, g), b)
    candidate = (lo >= band[0]) & (lo <= band[1]) & ((hi - lo) <= SAT_TOL)

    reach = np.zeros_like(candidate)
    reach[0, :] = candidate[0, :]
    reach[-1, :] = candidate[-1, :]
    reach[:, 0] = candidate[:, 0]
    reach[:, -1] = candidate[:, -1]

    # Iterative dilation constrained to the candidate region. Converges in a few hundred passes on a
    # 1280x720 frame because the background is one large connected region.
    for _ in range(4000):
        grown = reach.copy()
        grown[1:, :] |= reach[:-1, :]
        grown[:-1, :] |= reach[1:, :]
        grown[:, 1:] |= reach[:, :-1]
        grown[:, :-1] |= reach[:, 1:]
        grown &= candidate
        if np.array_equal(grown, reach):
            break
        reach = grown
    return reach


def keyed(path: Path) -> Image.Image:
    rgb = np.array(Image.open(path).convert("RGB"))
    band = background_band(rgb)
    bg = background_mask(rgb, band)
    alpha = np.where(bg, 0, 255).astype(np.uint8)

    # A one pixel fringe touching the removed region is compression halo, half alpha. "Halo" means a
    # pixel part way between the subject and the background, so the test is relative to the band that
    # was just measured rather than to a fixed brightness: on the dark alien checkerboard a halo pixel
    # is mid-grey, and a >= 190 test found none of them.
    fg = ~bg
    edge = fg & (
        np.roll(bg, 1, 0) | np.roll(bg, -1, 0) | np.roll(bg, 1, 1) | np.roll(bg, -1, 1)
    )
    near = (rgb.min(axis=2) >= band[0] - 40) & (rgb.min(axis=2) <= band[1] + 40)
    alpha[edge & near] = 90

    rgba = np.dstack([rgb, alpha])
    return Image.fromarray(rgba, "RGBA")


def main() -> None:
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)
    video, name = sys.argv[1], sys.argv[2]
    height = int(arg("--height", "240"))
    fps = int(arg("--fps", "12"))
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory() as t:
        tmp = Path(t)
        paths = frames_of(video, fps, tmp)
        frames = [keyed(p) for p in paths]

    # One crop box for every frame, so the cat does not jitter as the box follows the wand.
    boxes = [f.getchannel("A").point(lambda a: 255 if a > 40 else 0).getbbox() for f in frames]
    boxes = [b for b in boxes if b]
    left = min(b[0] for b in boxes)
    top = min(b[1] for b in boxes)
    right = max(b[2] for b in boxes)
    bottom = max(b[3] for b in boxes)
    pad = 6
    box = (max(0, left - pad), max(0, top - pad), right + pad, bottom + pad)

    colors = int(arg("--colors", "48"))
    out = []
    palette_src = None
    for f in frames:
        c = f.crop(box)
        w = round(c.width * height / c.height)
        c = c.resize((w, height), Image.LANCZOS)
        # ‼️ A FLAT PALETTE, SHARED BY EVERY FRAME. The source is pixel art passed through a video codec,
        # so every frame carries its own shimmer of near-identical colours and WebP stores that shimmer
        # as change. Quantizing to one palette makes still pixels actually still, which is most of the
        # size. No dithering: dither is exactly the per-frame noise this removes.
        a = c.getchannel("A").point(lambda v: 255 if v >= 128 else 0)
        rgb = c.convert("RGB")
        if palette_src is None:
            palette_src = rgb.quantize(colors=colors, method=Image.MEDIANCUT, dither=Image.Dither.NONE)
        q = rgb.quantize(palette=palette_src, dither=Image.Dither.NONE).convert("RGB")
        q.putalpha(a)
        out.append(q)

    # Ping-pong: forward then back, so a 4 second clip loops with no jump.
    #
    # ‼️ --once SKIPS IT, AND A FLOURISH ALWAYS WANTS IT SKIPPED. Ping-pong exists so a RESTING loop has
    # no visible jump. A flourish is a gesture the widget plays once before going back to idle, so
    # playing it backwards afterwards shows the cat un-throwing its wand, and it doubles the file for
    # the privilege. These ship onto a client's website, so the halved size is the point as much as
    # the look is.
    loop = out if "--once" in sys.argv else out + out[-2:0:-1]
    webp = OUT_DIR / f"{name}.webp"
    loop[0].save(
        webp,
        save_all=True,
        append_images=loop[1:],
        duration=round(1000 / fps),
        loop=0,
        lossless=arg("--lossless", "0") == "1",
        quality=int(arg("--quality", "75")),
        method=6,
    )
    print(f"{webp.name}: {len(loop)} frames, {out[0].width}x{height}, {webp.stat().st_size // 1024} KB")

    # ‼️ ONE STILL PER MASCOT, AND IT IS THE IDLE ONE. The still is what prefers-reduced-motion gets and
    # what holds the corner until the animation has loaded, so it must be the mascot at rest. A flourish
    # writing its own still would leave the reduced-motion reader looking at a cat mid-throw.
    if "--no-still" not in sys.argv:
        still = OUT_DIR / f"{name}-still.png"
        out[0].save(still, optimize=True)
        print(f"{still.name}: {still.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
