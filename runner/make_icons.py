"""Generates the PWA icons. Run: python3 runner/make_icons.py"""
from pathlib import Path
from PIL import Image, ImageDraw

OUT = Path(__file__).parent / "icons"


def icon(size, maskable=False):
    s = size / 512
    img = Image.new("RGB", (size, size), "#0b0221")
    d = ImageDraw.Draw(img)
    # sky gradient
    for y in range(size):
        t = y / size
        r = int(11 + (60 - 11) * t)
        g = int(2 + (10 - 2) * t)
        b = int(33 + (80 - 33) * t)
        d.line([(0, y), (size, y)], fill=(r, g, b))
    pad = 0.1 if maskable else 0
    cx, hy = size / 2, size * (0.55 - pad * 0.2)
    # sun
    R = 150 * s * (1 - pad)
    d.ellipse([cx - R, hy - R * 1.6, cx + R, hy + R * 0.4], fill="#ff2a6d")
    for i in range(5):
        yy = hy - R * 0.5 + i * R * 0.22
        d.rectangle([0, yy, size, yy + R * 0.06 * (i + 1) * 0.6], fill=(40, 8, 70))
    # road
    d.polygon([(cx - 8 * s, hy), (cx + 8 * s, hy), (size * 0.95, size), (size * 0.05, size)], fill="#120622")
    d.line([(cx - 8 * s, hy), (size * 0.05, size)], fill="#05d9e8", width=max(2, int(10 * s)))
    d.line([(cx + 8 * s, hy), (size * 0.95, size)], fill="#05d9e8", width=max(2, int(10 * s)))
    d.rectangle([0, hy - 2 * s, size, hy + 2 * s], fill="#ff2a6d")
    # runner silhouette
    k = s * (1 - pad)
    bx, by = cx, size * 0.86
    d.line([(bx - 22 * k, by - 90 * k), (bx - 30 * k, by)], fill="#1b1035", width=int(24 * k))
    d.line([(bx + 22 * k, by - 90 * k), (bx + 28 * k, by - 30 * k)], fill="#1b1035", width=int(24 * k))
    d.rounded_rectangle([bx - 45 * k, by - 175 * k, bx + 45 * k, by - 85 * k], radius=int(18 * k), fill="#05d9e8")
    d.ellipse([bx - 28 * k, by - 235 * k, bx + 28 * k, by - 179 * k], fill="#1b1035")
    d.rectangle([bx - 36 * k, by - 4 * k, bx - 14 * k, by + 8 * k], fill="#f9c80e")
    return img


OUT.mkdir(exist_ok=True)
for n in (192, 512):
    icon(n).save(OUT / f"icon-{n}.png")
icon(512, maskable=True).save(OUT / "maskable-512.png")
icon(180).save(OUT / "apple-touch-icon.png")
