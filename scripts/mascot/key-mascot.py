"""
Turn a generated mascot video with a baked-in checkerboard into a transparent, looping animated WebP.

    python scripts/mascot/key-mascot.py <video.mp4> <out-name> [--height 240] [--fps 12]

Writes src/lib/concierge/mascot/<out-name>.webp (ping-pong loop) and, for the first video, a still PNG
for prefers-reduced-motion.

WHY A FLOOD FILL AND NOT A COLOUR KEY (measured 2026-09-16): the Veo clips of the wizard cat are 1280x720
with a fake transparency checkerboard of pure white (255) and light grey (~238) painted into the frame.
A global colour key on those two values would also eat the whites of the cat's eyes and the star
sparkles. The background is the near-white region CONNECTED TO THE FRAME'S EDGE, so that is what is
removed: a flood fill from the border over near-white, low-saturation pixels. The cat's dark outline stops
it, and everything inside the outline keeps its colour.
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


def background_mask(rgb: np.ndarray) -> np.ndarray:
    """True where the pixel is checkerboard, reachable from the frame's edge."""
    r, g, b = rgb[..., 0].astype(int), rgb[..., 1].astype(int), rgb[..., 2].astype(int)
    hi = np.maximum(np.maximum(r, g), b)
    lo = np.minimum(np.minimum(r, g), b)
    candidate = (lo >= 214) & ((hi - lo) <= 18)

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
    bg = background_mask(rgb)
    alpha = np.where(bg, 0, 255).astype(np.uint8)

    # A one pixel fringe of light pixels touching the removed region is compression halo, half alpha.
    fg = ~bg
    edge = fg & (
        np.roll(bg, 1, 0) | np.roll(bg, -1, 0) | np.roll(bg, 1, 1) | np.roll(bg, -1, 1)
    )
    light = rgb.min(axis=2) >= 190
    alpha[edge & light] = 90

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
    loop = out + out[-2:0:-1]
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
    still = OUT_DIR / f"{name}-still.png"
    out[0].save(still, optimize=True)
    print(f"{webp.name}: {len(loop)} frames, {out[0].width}x{height}, {webp.stat().st_size // 1024} KB")
    print(f"{still.name}: {still.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
