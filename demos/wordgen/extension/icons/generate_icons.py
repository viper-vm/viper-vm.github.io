#!/usr/bin/env python3
"""Generate the WordGen extension icons.

The logo: a rounded square filled with a warm diagonal gradient
(terracotta -> amber, the Paper theme palette) carrying a bold white "W"
whose centre peak is cut with a small pen-nib notch + slit.

Everything renders at 1024px and is downsampled with Lanczos so edges stay
crisp. The 16px icon uses a simplified variant — no nib notch, a slightly
larger and heavier W — so it remains legible in the browser toolbar.

Outputs (next to this script): icon16.png icon32.png icon48.png icon128.png
and an equivalent icon.svg.

Usage: python3 generate_icons.py
"""

import os
import sys

from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))

TERRACOTTA = (196, 89, 59)  # #C4593B — Paper theme accent
AMBER = (232, 166, 60)      # #E8A63C
WHITE = (255, 255, 255, 255)

BASE = 1024                 # supersampled master size
CORNER_RADIUS_FRAC = 0.225  # rounded-square corner radius, fraction of size

RESAMPLE = getattr(Image, "Resampling", Image)


def lerp_color(c0, c1, t):
    return tuple(round(c0[i] + (c1[i] - c0[i]) * t) for i in range(3))


def diagonal_gradient(size, c0, c1):
    """Top-left c0 -> bottom-right c1; built small then scaled (smooth + fast)."""
    n = 64
    grad = Image.new("RGB", (n, n))
    grad.putdata([
        lerp_color(c0, c1, (x + y) / (2 * (n - 1)))
        for y in range(n)
        for x in range(n)
    ])
    return grad.resize((size, size), RESAMPLE.BILINEAR)


def load_w_font(px):
    """Helvetica Bold from the system .ttc when available, else Pillow default."""
    ttc = "/System/Library/Fonts/Helvetica.ttc"
    if os.path.exists(ttc):
        regular = None
        for index in range(12):
            try:
                font = ImageFont.truetype(ttc, px, index=index)
            except (OSError, ValueError):
                break
            style = font.getname()[1].lower()
            if "bold" in style and "oblique" not in style:
                return font
            if regular is None:
                regular = font
        if regular is not None:
            return regular
    try:
        return ImageFont.load_default(size=px)  # Pillow >= 10.1
    except TypeError:
        return ImageFont.load_default()


def draw_w_mask(size, glyph_w_frac, stroke_frac, notch):
    """Antialiased L mask of the W, optionally with the pen-nib notch cut in."""
    mask = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(mask)

    # Size the font so the glyph spans glyph_w_frac of the icon width.
    probe = load_w_font(size)
    left, top, right, bottom = draw.textbbox((0, 0), "W", font=probe)
    probe_w = max(1, right - left)
    px = max(8, int(size * glyph_w_frac / probe_w * size))
    font = load_w_font(px)

    stroke = max(0, round(size * stroke_frac))
    left, top, right, bottom = draw.textbbox((0, 0), "W", font=font, stroke_width=stroke)
    cx, cy = size / 2, size * 0.515
    origin = (cx - (left + right) / 2, cy - (top + bottom) / 2)
    draw.text(origin, "W", font=font, fill=255, stroke_width=stroke, stroke_fill=255)

    if notch:
        # Find the W's centre peak by scanning the middle third of the mask,
        # then cut a V wider than the peak's flat top: the V edges cross the
        # peak's own diagonals a little below the apex, leaving two clean
        # pointed tines instead of wispy slivers.
        pix = mask.load()
        x0, x1 = size // 3, 2 * size // 3
        apex = next(
            (y for y in range(size) if any(pix[x, y] > 96 for x in range(x0, x1))),
            None,
        )
        if apex is not None:
            row = [x for x in range(x0, x1) if pix[x, apex + 2] > 96]
            peak_cx = (min(row) + max(row)) / 2
            half = (max(row) - min(row)) / 2 * 1.35
            depth = size * 0.115
            draw.polygon(
                [(peak_cx - half, apex - 3), (peak_cx + half, apex - 3), (peak_cx, apex + depth)],
                fill=0,
            )
            # Nib slit: runs from the notch tip down into the counter between
            # the W's inner strokes.
            slit_half = size * 0.011
            draw.rectangle(
                [peak_cx - slit_half, apex + depth - size * 0.01,
                 peak_cx + slit_half, apex + size * 0.205],
                fill=0,
            )
    return mask


def build_master(simplified):
    size = BASE
    icon = diagonal_gradient(size, TERRACOTTA, AMBER).convert("RGBA")

    # Subtle sheen across the top for a bit of depth.
    sheen = Image.new("L", (1, size), 0)
    fade = size * 0.55
    for y in range(size):
        sheen.putpixel((0, y), max(0, 26 - int(26 * y / fade)))
    icon.paste(Image.new("RGBA", (size, size), WHITE), (0, 0), sheen.resize((size, size)))

    if simplified:
        w_mask = draw_w_mask(size, glyph_w_frac=0.70, stroke_frac=0.028, notch=False)
    else:
        w_mask = draw_w_mask(size, glyph_w_frac=0.64, stroke_frac=0.008, notch=True)
    icon.paste(Image.new("RGBA", (size, size), WHITE), (0, 0), w_mask)

    # Alpha applied last so transparent pixels keep gradient RGB — no dark
    # fringes when Lanczos blends across the rounded edge.
    shape = Image.new("L", (size, size), 0)
    ImageDraw.Draw(shape).rounded_rectangle(
        [0, 0, size - 1, size - 1], radius=round(size * CORNER_RADIUS_FRAC), fill=255
    )
    icon.putalpha(shape)
    return icon


SVG = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">
  <defs>
    <linearGradient id="wg" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="128" y2="128">
      <stop offset="0" stop-color="#C4593B"/>
      <stop offset="1" stop-color="#E8A63C"/>
    </linearGradient>
  </defs>
  <rect width="128" height="128" rx="29" fill="url(#wg)"/>
  <path d="M23 39 L44 91 L64 50 L84 91 L105 39" fill="none" stroke="#FFFFFF" stroke-width="15" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M57.5 41 L70.5 41 L64 58 Z" fill="url(#wg)"/>
  <rect x="62.6" y="52" width="2.8" height="11" fill="url(#wg)"/>
</svg>
"""


def sharpen_rgb(icon):
    """Mild unsharp on colour only — alpha untouched so the edge stays smooth."""
    channels = list(icon.split())
    rgb = Image.merge("RGB", channels[:3]).filter(
        ImageFilter.UnsharpMask(radius=0.6, percent=120, threshold=0)
    )
    return Image.merge("RGBA", (*rgb.split(), channels[3]))


def main():
    master = build_master(simplified=False)
    small = build_master(simplified=True)

    outputs = []
    for size, source in ((128, master), (48, master), (32, master), (16, small)):
        icon = source.resize((size, size), RESAMPLE.LANCZOS)
        if size == 16:
            icon = sharpen_rgb(icon)
        path = os.path.join(HERE, f"icon{size}.png")
        icon.save(path, optimize=True)
        outputs.append(path)

    svg_path = os.path.join(HERE, "icon.svg")
    with open(svg_path, "w", encoding="utf-8") as handle:
        handle.write(SVG)
    outputs.append(svg_path)

    failures = []
    for path in outputs:
        name = os.path.basename(path)
        if not os.path.isfile(path) or os.path.getsize(path) == 0:
            failures.append(f"{name}: missing or empty")
            continue
        if path.endswith(".png"):
            try:
                with Image.open(path) as img:
                    img.load()
                    expected = int(name.replace("icon", "").replace(".png", ""))
                    if img.size != (expected, expected):
                        failures.append(f"{name}: unexpected size {img.size}")
                        continue
                    print(f"ok  {name}  {img.size[0]}x{img.size[1]} {img.mode}  {os.path.getsize(path)} bytes")
            except Exception as exc:  # noqa: BLE001 — report any decode failure
                failures.append(f"{name}: {exc}")
        else:
            with open(path, encoding="utf-8") as handle:
                if not handle.read().lstrip().startswith("<svg"):
                    failures.append(f"{name}: not an SVG")
                    continue
            print(f"ok  {name}  {os.path.getsize(path)} bytes")

    if failures:
        for failure in failures:
            print(f"FAIL {failure}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
