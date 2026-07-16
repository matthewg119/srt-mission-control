"""
Chip line-break preview harness.

Renders caption pills through the real engine (no ffmpeg needed) so you can
eyeball line breaks before deploying. Saves individual PNGs plus one
contact-sheet PNG to tests/out/.

Run from repo root:  py "render-service\\tests\\preview_chips.py"
"""

import os, sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "api"))

from PIL import Image, ImageDraw
from srt_reel import engine

OUT = os.path.join(HERE, "out")
os.makedirs(OUT, exist_ok=True)

# (name, text, kind, scale) — scale 0.72 == spec_engine "medium"
CASES = [
    ("pov_hook",      "POV: You got $150K without the bank.", "body", 1.0),
    ("pov_hook_med",  "POV: You got $150K without the bank.", "body", 0.72),
    ("tip1",          "1: Stop applying to banks. Every hard pull makes it worse", "body", 1.0),
    ("tip1_med",      "1: Stop applying to banks. Every hard pull makes it worse", "body", 0.72),
    ("tip2",          "2: Get your last 4 months of bank statements ready (real underwriting)", "body", 1.0),
    ("tip2_med",      "2: Get your last 4 months of bank statements ready (real underwriting)", "body", 0.72),
    ("tip3",          "3: Use revenue-based funding. Your deposits qualify you, not your FICO.", "body", 1.0),
    ("tip3_med",      "3: Use revenue-based funding. Your deposits qualify you, not your FICO.", "body", 0.72),
    ("cta",           "That's how owners land $25K-$500K in 24-48 hours.", "cta", 1.0),
    ("two_words",     "Get funded", "body", 1.0),
    ("emoji",         "You got funded 🔥💰", "body", 1.0),
    ("long_word",     "Supercalifragilisticexpialidociousrefinancing", "body", 1.0),
    ("manual_break",  "Stop.\nBreathe.\nGet funded.", "body", 1.0),
    ("label",         "MCA & business funding tips", "label", 1.0),
]

COLORS = ["green", "pink", "orange", "red", "purple", "blue"]

chips = []
for i, (name, text, kind, scale) in enumerate(CASES):
    color = "white" if kind == "label" else COLORS[i % len(COLORS)]
    img = engine.render_chip(text, color, kind=kind, scale=scale)
    img.save(os.path.join(OUT, f"{name}.png"))

    # report the chosen layout via the same path render_chip used
    probe = ImageDraw.Draw(Image.new("RGBA", (10, 10)))
    if kind == "label":
        fp, base, max_w, max_lines, padx = engine.FONT_LABEL, 28, int(engine.W * 0.80), 1, 26
    elif kind == "cta":
        fp, base, max_w, max_lines, padx = engine.FONT_BODY, 38, int(engine.W * 0.62), 2, 30
    else:
        fp, base, max_w, max_lines, padx = engine.FONT_BODY, 48, int(engine.W * 0.80), 3, 30
    base = max(22, int(base * scale)); padx = int(padx * scale)
    font, lines = engine.smart_fit(probe, text, fp, max_w - 2 * padx, max_lines, base)
    print(f"{name:14s} kind={kind:5s} scale={scale:<4} size={font.size:2d}  " +
          " | ".join(lines))
    chips.append((name, img))

# contact sheet on video-frame gray, one chip per row
GAP = 24
sheet_w = max(im.width for _, im in chips) + 2 * GAP
sheet_h = sum(im.height for _, im in chips) + GAP * (len(chips) + 1)
sheet = Image.new("RGB", (sheet_w, sheet_h), (88, 88, 88))
y = GAP
for name, im in chips:
    sheet.paste(im, ((sheet_w - im.width) // 2, y), im)
    y += im.height + GAP
sheet_path = os.path.join(OUT, "contact_sheet.png")
sheet.save(sheet_path)
print(f"\ncontact sheet -> {sheet_path}")
