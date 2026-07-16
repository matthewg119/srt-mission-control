"""
SRT Reel Engine
---------------
Turns ONE background image + a few headlines into a beat-synced vertical video
in the locked Vargas / SRT format (white label -> colored hook lines -> CTA pill),
over the same 117 BPM song every time.

You give it: an image + headlines.
It does:    auto color assignment (from the locked palette, no two adjacent the same),
            beat-locked pop-in animation, the fixed song, 720x1280 H.264 export.
"""

import os, sys, json, math, random, subprocess, re, shutil
from itertools import combinations
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
FONTS = os.path.join(HERE, "fonts")
ASSETS = os.path.join(HERE, "assets")

def _ffmpeg_bin():
    """Use system ffmpeg if present; otherwise the static binary that ships
    with imageio-ffmpeg (pip install imageio-ffmpeg) — so the desktop app
    needs nothing installed but Python."""
    sys_ff = shutil.which("ffmpeg")
    if sys_ff:
        return sys_ff
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return "ffmpeg"  # last resort; errors clearly if truly missing

FFMPEG = _ffmpeg_bin()

# ---------------------------------------------------------------- LOCKED LOOK
W, H, FPS = 720, 1280, 30
SONG = os.path.join(ASSETS, "song_master.m4a")     # the one song, every time
# Cards drop on the real beat hits of song_master.m4a (measured, not BPM-derived).
# Cue order = [label, body0, body1, ..., cta]. Every reel is a fixed 5.0s.
CUES = [0.0, 0.2, 1.2, 3.3]   # seconds; index = card's appearance order
CUE_GAP = 1.0                  # fallback spacing if a reel has more cards than cues
CLIP_SECONDS = 6.0   # floor; players never round a 6.0s clip down to 0:04, CTA breathes

# The palette you've been using. White is reserved for the top label.
# Each accent has a background + the text color that reads on it.
PALETTE = {
    "white":  {"bg": "#FFFFFF", "fg": "#0B0B0B"},   # top audience label
    "pink":   {"bg": "#EC1E5C", "fg": "#FFFFFF"},
    "purple": {"bg": "#9B1FB0", "fg": "#FFFFFF"},
    "orange": {"bg": "#F5811E", "fg": "#FFFFFF"},
    "green":  {"bg": "#2FBF5B", "fg": "#08240F"},    # dark text on green
    "blue":   {"bg": "#0FA0E6", "fg": "#FFFFFF"},
    "red":    {"bg": "#E4243C", "fg": "#FFFFFF"},
}
ACCENTS = ["pink", "purple", "orange", "green", "blue", "red"]  # randomizable set

# Inter (neo-grotesque, Helvetica-like) to match Instagram's native caption look.
# Bold/SemiBold read cleaner and more compact than Poppins-ExtraBold.
FONT_BODY  = os.path.join(FONTS, "Inter-Bold.ttf")
FONT_LABEL = os.path.join(FONTS, "Inter-SemiBold.ttf")
FONT_EMOJI = os.path.join(FONTS, "NotoColorEmoji.ttf")
EMOJI_NATIVE = 109   # NotoColorEmoji only renders at 109px; we scale the bitmap


# ---------------------------------------------------------------- color logic
def assign_colors(n_lines, seed=None, cta=True, locked=None):
    """Pick a distinct accent per hook line (+CTA), no two neighbors equal.
    `locked` = optional dict {line_index: 'colorname'} to force specific colors."""
    rng = random.Random(seed)
    locked = locked or {}
    pool = ACCENTS[:]
    rng.shuffle(pool)
    chosen, prev = [], None
    seq = pool * (n_lines + 3)  # enough to draw from
    it = iter(seq)
    for i in range(n_lines):
        if i in locked:
            c = locked[i]
        else:
            c = next(it)
            while c == prev:
                c = next(it)
        chosen.append(c); prev = c
    cta_color = None
    if cta:
        if "cta" in locked:
            cta_color = locked["cta"]
        else:
            cta_color = next(it)
            while cta_color == prev:
                cta_color = next(it)
    return chosen, cta_color


# ---------------------------------------------------------------- text helpers
_EMOJI_RE = re.compile(
    "[\U0001F000-\U0001FAFF\U00002600-\U000027BF\U0001F1E6-\U0001F1FF\u2764\ufe0f\u2728\u2705]+"
)

def split_emoji(text):
    """Return list of ('txt', s) / ('emo', s) chunks so we can color-render emoji."""
    out, last = [], 0
    for m in _EMOJI_RE.finditer(text):
        if m.start() > last:
            out.append(("txt", text[last:m.start()]))
        out.append(("emo", m.group()))
        last = m.end()
    if last < len(text):
        out.append(("txt", text[last:]))
    return out or [("txt", text)]

def wrap(draw, text, font, max_w):
    words = text.split()
    lines, cur = [], ""
    for w_ in words:
        t = (cur + " " + w_).strip()
        if draw.textlength(t, font=font) <= max_w or not cur:
            cur = t
        else:
            lines.append(cur); cur = w_
    if cur:
        lines.append(cur)
    return lines

def fit_font(draw, text, path, max_w, max_lines, start, floor=26):
    """Shrink font until the wrapped text fits max_w within max_lines."""
    size = start
    while size > floor:
        f = ImageFont.truetype(path, size)
        ls = wrap(draw, text, f, max_w)
        if len(ls) <= max_lines and all(draw.textlength(l, font=f) <= max_w for l in ls):
            return f, ls
        size -= 2
    f = ImageFont.truetype(path, floor)
    return f, wrap(draw, text, f, max_w)


# ------------------------------------------------------- smart line breaking
def _line_width(draw, s, font, lh):
    """Pixel width of one rendered line, emoji-aware (each emoji ~ one em = lh),
    matching the exact math render_chip draws with."""
    w = 0
    for kind, chunk in split_emoji(s):
        if kind == "emo":
            w += lh * len(chunk)
        else:
            w += int(draw.textlength(chunk, font=font))
    return w

_STRONG_END = re.compile(r'[.!?…]["\')\]]*$')   # token ends a sentence
_MEDIUM_END = re.compile(r'[,:;]["\')\]]*$')          # token ends a clause
# Connectors/function words that must not dangle at the end of a line —
# break BEFORE them so they start the next line ("months | of bank statements").
FUNC_WORDS = {
    "a", "an", "the", "of", "to", "in", "on", "at", "for", "with",
    "and", "or", "but", "nor", "so", "if", "as", "by", "from",
    "into", "onto", "over", "than", "your", "our", "my", "their",
    "his", "her", "its",
}

def _classify_gaps(words):
    """For each gap g (between words[g-1] and words[g]) return
    (kind[g], depth[g]) where kind is 'strong'|'medium'|'paren_open'|
    'func_end'|'plain' and depth>0 means the gap sits inside (...)."""
    kind, depth = {}, {}
    d = 0
    for g in range(1, len(words)):
        prev, nxt = words[g - 1], words[g]
        d += prev.count("(") - prev.count(")")
        depth[g] = d
        if _STRONG_END.search(prev):
            kind[g] = "strong"
        elif _MEDIUM_END.search(prev):
            kind[g] = "medium"
        elif nxt.startswith("("):
            kind[g] = "paren_open"
        elif prev.lower().strip("\"'") in FUNC_WORDS:
            kind[g] = "func_end"
        else:
            kind[g] = "plain"
    return kind, depth

_LIST_INDEX = re.compile(r"^\d+[.:)]?$")   # "1:", "2." — visually tiny, not a word

def _layout_cost(size, base, widths, cuts, breaks, kind, depth, forced, wcounts):
    """Cost of one candidate layout, in 'pixels of shrink' units scaled to base.
    wcounts[i] = 1 if words[i] counts toward the per-line word cap."""
    L = len(widths)
    cost = float(base - size)                      # 1.0 per px of shrink
    cost += 0.22 * base * (L - 1)                  # fewer-lines preference
    if L > 1:
        wmax = max(widths) or 1
        rag = sum((1 - w / wmax) ** 2 for w in widths) / L
        cost += 0.35 * base * rag                  # balance (kept mild: asymmetric
        if cuts[-1] - cuts[-2] == 1:               # punctuation breaks look good)
            cost += 0.50 * base                    # 1-word last line (orphan)
        if cuts[1] - cuts[0] == 1:
            cost += 0.20 * base                    # 1-word first line, mild
        for i in range(L):
            wc = sum(wcounts[cuts[i]:cuts[i + 1]])
            cost += 0.15 * base * max(0, wc - 5)   # soft ~5-words-per-line cap
    for g in breaks:
        if g in forced:
            continue                               # explicit \n: no bonus/penalty
        if depth.get(g, 0) > 0:
            cost += 0.60 * base                    # break inside (...)
        elif kind[g] == "strong":
            cost -= 0.20 * base
        elif kind[g] == "medium":
            cost -= 0.10 * base
        elif kind[g] == "paren_open":
            cost -= 0.08 * base
        elif kind[g] == "func_end":
            cost += 0.35 * base                    # connector dangling at line end
    return cost

def smart_fit(draw, text, path, max_w, max_lines, start, floor=26):
    """Drop-in replacement for fit_font: returns (font, lines).
    Scores every possible split — prefers one line at a slightly smaller size,
    breaks at punctuation, keeps parentheticals intact, ~5 words/line,
    no orphans, never ends a line on a connector. Explicit \\n = forced break."""
    floor = min(floor, start)
    segments = [s for s in (p.strip() for p in text.split("\n")) if s]
    words, forced = [], set()
    for si, seg in enumerate(segments):
        if si:
            forced.add(len(words))
        words.extend(seg.split())
    n = len(words)
    if n == 0:
        return ImageFont.truetype(path, start), [""]
    if max_lines == 1 or n == 1:
        forced = set()                             # labels: \n joined, one line
    kind, depth = _classify_gaps(words)
    wcounts = [0 if _LIST_INDEX.match(w_) else 1 for w_ in words]
    eff_max_lines = max(max_lines, len(forced) + 1)

    best = None                                    # (cost, size, lines)
    for size in range(start, floor - 1, -2):
        # cost >= shrink - max possible break bonuses, so smaller sizes can't win
        if best and (start - size) - 0.45 * start >= best[0]:
            break
        f = ImageFont.truetype(path, size)
        asc, desc = f.getmetrics()
        lh = asc + desc
        span = {}
        def w_of(i, j):
            if (i, j) not in span:
                span[(i, j)] = _line_width(draw, " ".join(words[i:j]), f, lh)
            return span[(i, j)]
        for k in range(len(forced) + 1, eff_max_lines + 1):
            for breaks in combinations(range(1, n), k - 1):
                if not forced <= set(breaks):
                    continue
                cuts = (0,) + breaks + (n,)
                widths = [w_of(cuts[i], cuts[i + 1]) for i in range(k)]
                if max(widths) > max_w:
                    continue
                cost = _layout_cost(size, start, widths, cuts, breaks, kind, depth, forced, wcounts)
                if best is None or cost < best[0]:
                    best = (cost, size,
                            [" ".join(words[c1:c2]) for c1, c2 in zip(cuts, cuts[1:])])
    if best is None:                               # e.g. one giant word
        f = ImageFont.truetype(path, floor)
        return f, wrap(draw, text, f, max_w)
    return ImageFont.truetype(path, best[1]), best[2]


# ---------------------------------------------------------------- box renderer
def render_chip(text, color, kind="body", scale=1.0):
    """Render one rounded text chip to a tight RGBA image (with soft shadow).
    `scale` shrinks the whole chip (font + padding) for auto-fit."""
    bg = PALETTE[color]["bg"]; fg = PALETTE[color]["fg"]
    # Instagram-caption sizing: smaller than before, in Inter (label 28/cta 38/body 48).
    if kind == "label":
        font_path, base, max_w, max_lines = FONT_LABEL, 28, int(W*0.80), 1
        padx, pady, radius = 26, 14, 14
    elif kind == "cta":
        font_path, base, max_w, max_lines = FONT_BODY, 38, int(W*0.62), 2
        padx, pady, radius = 30, 18, 22
    else:  # body hook line
        font_path, base, max_w, max_lines = FONT_BODY, 48, int(W*0.80), 3
        padx, pady, radius = 30, 18, 22
    base = max(22, int(base*scale)); padx = int(padx*scale)
    pady = int(pady*scale); radius = int(radius*scale)

    probe = ImageDraw.Draw(Image.new("RGBA", (10, 10)))
    font, lines = smart_fit(probe, text, font_path, max_w - 2*padx, max_lines, base)

    # measure
    asc, desc = font.getmetrics()
    lh = asc + desc
    gap = int(lh * 0.06)
    has_emoji = any(c for ln in lines for k, c in split_emoji(ln) if k == "emo")
    line_ws = [_line_width(probe, ln, font, lh) for ln in lines]
    text_w = max(line_ws) if line_ws else 1
    text_h = len(lines) * lh + (len(lines) - 1) * gap

    box_w = text_w + 2 * padx
    box_h = text_h + 2 * pady
    pad = 18  # room for shadow
    img = Image.new("RGBA", (box_w + 2*pad, box_h + 2*pad), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # soft shadow
    sh = Image.new("RGBA", img.size, (0, 0, 0, 0))
    ds = ImageDraw.Draw(sh)
    ds.rounded_rectangle([pad+3, pad+7, pad+box_w+3, pad+box_h+7], radius, fill=(0, 0, 0, 90))
    from PIL import ImageFilter
    sh = sh.filter(ImageFilter.GaussianBlur(7))
    img.alpha_composite(sh)

    # box
    d.rounded_rectangle([pad, pad, pad+box_w, pad+box_h], radius, fill=bg)

    # text (centered), with color-emoji support
    emoji_font = ImageFont.truetype(FONT_EMOJI, EMOJI_NATIVE) if has_emoji else None
    y = pad + pady
    for ln, lw in zip(lines, line_ws):
        x = pad + (box_w - lw) // 2
        for kind2, s in split_emoji(ln):
            if kind2 == "emo" and emoji_font:
                for ch in s:
                    em = Image.new("RGBA", (EMOJI_NATIVE, EMOJI_NATIVE), (0,0,0,0))
                    ImageDraw.Draw(em).text((0, 0), ch, font=emoji_font, embedded_color=True)
                    target = lh
                    em = em.resize((target, target), Image.LANCZOS)
                    img.alpha_composite(em, (x, y + (lh - target)//2))
                    x += target
            else:
                d.text((x, y), s, font=font, fill=fg)
                x += int(probe.textlength(s, font=font))
        y += lh + gap
    return img


# ---------------------------------------------------------------- compositor
def cover(img_path):
    im = Image.open(img_path).convert("RGB")
    s = max(W / im.width, H / im.height)
    im = im.resize((int(im.width*s), int(im.height*s)), Image.LANCZOS)
    x = (im.width - W)//2; y = (im.height - H)//2
    return im.crop((x, y, x+W, y+H))

def cue_time(i):
    if i < len(CUES):
        return CUES[i]
    return CUES[-1] + (i - (len(CUES) - 1)) * CUE_GAP

def ease_pop(p):
    """0..1 -> scale factor with a little overshoot (CapCut-style pop)."""
    if p <= 0: return 0.0
    if p >= 1: return 1.0
    # overshoot curve
    return 1 + 2.7*(p-1)**3 + 1.7*(p-1)**2  # ends at 1, slight overshoot mid

def build_layout(headlines, colors, cta_color):
    """Stack chips top-to-bottom by their real heights so nothing overlaps.
    Auto-scales the whole stack down if it would overflow the safe area.
    Returns list of {chip, cx, cy(center), t_in} and the clip end time."""
    MARGIN = 20
    GAP = 16
    body_lines = headlines["lines"]
    USABLE_TOP = int(H * 0.11)
    USABLE_BOT = int(H * 0.93)

    def vis_h(chip):
        return chip.size[1] - 2*MARGIN

    def build(scale):
        items = []
        chips = []
        base = 0
        if headlines.get("label"):
            chips.append(("label", headlines["label"], "white", cue_time(0)))
            base = 1
        for i, txt in enumerate(body_lines):
            chips.append(("body", txt, colors[i], cue_time(base + i)))
        rendered = [(k, render_chip(t, c, k, scale), tin) for k, t, c, tin in chips]
        total = sum(vis_h(ch) for _, ch, _ in rendered) + GAP*(len(rendered)-1)
        cta_chip = None
        if headlines.get("cta"):
            cta_chip = render_chip(headlines["cta"], cta_color, "cta", scale)
            total += GAP + vis_h(cta_chip)
        return rendered, cta_chip, total

    scale = 1.0
    while scale > 0.5:
        rendered, cta_chip, total = build(scale)
        if total <= (USABLE_BOT - USABLE_TOP):
            break
        scale -= 0.06

    items = []
    y = USABLE_TOP
    last_bottom = y
    for idx, (kind, chip, tin) in enumerate(rendered):
        h = vis_h(chip)
        bump = 10 if kind == "label" else 0
        items.append(dict(chip=chip, cx=W//2, cy=y + h//2, t_in=tin, is_label=(kind == "label")))
        y += h + GAP + bump
        last_bottom = y - GAP - bump + (GAP if kind!="label" else 0)
        last_bottom = y

    base = 1 if headlines.get("label") else 0
    cta_t = cue_time(base + len(body_lines))
    if cta_chip is not None:
        h = vis_h(cta_chip)
        cta_cy = max(int(H * 0.74), last_bottom + h//2)
        cta_cy = min(cta_cy, USABLE_BOT - h//2)
        items.append(dict(chip=cta_chip, cx=W//2, cy=cta_cy, t_in=cta_t, is_cta=True))
        end = cta_t + 1.6
    else:
        end = cta_t + 1.0
    return items, end

def render(image, headlines, out, seed=None, locked=None, zoom=0.0, quiet=False):
    """headlines = {'label': str|None, 'lines': [str,...], 'cta': str|None}"""
    colors, cta_color = assign_colors(len(headlines["lines"]), seed=seed,
                                       cta=bool(headlines.get("cta")), locked=locked)
    if not quiet:
        print(f"  colors -> lines={colors}  cta={cta_color}")
    bg = cover(image)
    items, end = build_layout(headlines, colors, cta_color)
    total = max(CLIP_SECONDS, end)
    nframes = int(math.ceil(total * FPS))

    # ffmpeg: receive raw frames on stdin, mux the fixed song (looped/trimmed)
    cmd = [FFMPEG, "-y", "-loglevel", "error",
           "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
           "-stream_loop", "-1", "-i", SONG,
           "-t", f"{total:.3f}",
           "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "medium", "-crf", "20",
           "-c:a", "aac", "-b:a", "192k", "-shortest",
           "-movflags", "+faststart", out]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE)

    POP = 0.18  # seconds of pop animation
    for fi in range(nframes):
        t = fi / FPS
        if zoom > 0:
            z = 1 + zoom * (t/total)
            fw, fh = int(W*z), int(H*z)
            fr = bg.resize((fw, fh), Image.LANCZOS).crop(
                ((fw-W)//2, (fh-H)//2, (fw-W)//2+W, (fh-H)//2+H)).convert("RGBA")
        else:
            fr = bg.copy().convert("RGBA")
        for it in items:
            if t < it["t_in"]:
                continue
            if it.get("is_label"):
                # Title is always-on: fully sized + opaque from frame 0, no pop.
                scale, alpha = 1.0, 1.0
            else:
                p = min(1.0, (t - it["t_in"]) / POP)
                scale = ease_pop(p)
                alpha = min(1.0, (t - it["t_in"]) / (POP*0.6))
            chip = it["chip"]
            cw, ch = chip.size
            sw, sh = max(1, int(cw*scale)), max(1, int(ch*scale))
            c2 = chip.resize((sw, sh), Image.LANCZOS)
            if alpha < 1:
                a = c2.split()[3].point(lambda v: int(v*alpha))
                c2.putalpha(a)
            fr.alpha_composite(c2, (it["cx"]-sw//2, it["cy"]-sh//2))
        proc.stdin.write(fr.convert("RGB").tobytes())
    proc.stdin.close()
    proc.wait()
    if not quiet:
        print(f"  -> {out}  ({total:.1f}s, {nframes} frames)")
    return out
