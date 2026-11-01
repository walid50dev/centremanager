#!/usr/bin/env python3
"""Generate the Tauri app icons (PNG/ICO/ICNS) for CentreManager.

The mark is a white "C" on the brand blue (#2563EB) rounded square, matching
`public/logo.svg`. Drawn with Pillow so it works without an SVG rasteriser.

Usage:  python3 tools/generate_icons.py
"""

from __future__ import annotations

import math
import os
from pathlib import Path

from PIL import Image, ImageDraw

BRAND = (37, 99, 235, 255)  # #2563EB
WHITE = (255, 255, 255, 255)
CANVAS = 1024
CORNER = 224  # ~14/64 of the canvas
RADIUS = 300
STROKE = 124


def draw_mark() -> Image.Image:
    image = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((0, 0, CANVAS - 1, CANVAS - 1), radius=CORNER, fill=BRAND)

    center = CANVAS / 2
    box = (center - RADIUS, center - RADIUS, center + RADIUS, center + RADIUS)
    # Pillow angles: 0° = 3 o'clock, clockwise. 40° -> 320° leaves the gap on
    # the right, i.e. a "C".
    start, end = 40, 320
    draw.arc(box, start=start, end=end, fill=WHITE, width=STROKE)

    # Round caps at both ends. Pillow draws `arc(width=...)` *inward* from the
    # bounding box, so the stroke centreline sits at RADIUS - STROKE / 2.
    centreline = RADIUS - STROKE / 2
    for angle in (start, end):
        radians = math.radians(angle)
        x = center + centreline * math.cos(radians)
        y = center + centreline * math.sin(radians)
        cap = STROKE / 2
        draw.ellipse((x - cap, y - cap, x + cap, y + cap), fill=WHITE)

    return image


def main() -> None:
    base = draw_mark()
    out = Path(__file__).resolve().parent.parent / "src-tauri" / "icons"
    out.mkdir(parents=True, exist_ok=True)

    png_sizes = {
        "32x32.png": 32,
        "128x128.png": 128,
        "128x128@2x.png": 256,
        "icon.png": 512,
        "Square30x30Logo.png": 30,
        "Square44x44Logo.png": 44,
        "Square71x71Logo.png": 71,
        "Square89x89Logo.png": 89,
        "Square107x107Logo.png": 107,
        "Square142x142Logo.png": 142,
        "Square150x150Logo.png": 150,
        "Square284x284Logo.png": 284,
        "Square310x310Logo.png": 310,
        "StoreLogo.png": 50,
    }
    for name, size in png_sizes.items():
        base.resize((size, size), Image.LANCZOS).save(out / name)

    base.resize((256, 256), Image.LANCZOS).save(
        out / "icon.ico",
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )
    base.resize((512, 512), Image.LANCZOS).save(out / "icon.icns")
    base.resize((512, 512), Image.LANCZOS).save(out / "icon-preview.png")

    print(f"Generated {len(png_sizes) + 3} icon files in {out}")


if __name__ == "__main__":
    os.environ.setdefault("PYTHONWARNINGS", "ignore")
    main()
