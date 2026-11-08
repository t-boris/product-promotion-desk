#!/usr/bin/env python3
"""Draws the application icon and writes build/icon.png (1024 px) and build/icon.icns.

Only needed to regenerate the icon; the generated files are committed, so building the app does not run this.
Requires Pillow and, for the .icns, macOS `iconutil`:  python3 scripts/make-icon.py

Design: the macOS rounded square in the application's indigo, a white speech bubble (a reply) with a check mark
(approved by the owner before it is sent). Everything is drawn at 4x and scaled down for clean edges.
"""
import shutil
import subprocess
import sys
from math import cos, pi, sin
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
BUILD = ROOT / "build"
K = 4  # drawing scale
S = 1024 * K

TOP = (139, 146, 255)  # lighter indigo (dark theme accent family)
BOTTOM = (67, 56, 202)  # deeper indigo
CHECK = (67, 56, 202)


def px(v: float) -> int:
    return round(v * K)


def squircle_mask() -> Image.Image:
    """The macOS icon body: 824 px wide inside the 1024 px canvas, a superellipse rather than a plain rounded rectangle."""
    n, a, steps = 5.0, 412.0, 720
    points = []
    for i in range(steps):
        t = 2 * pi * i / steps
        c, s = cos(t), sin(t)
        x = 512 + a * (abs(c) ** (2 / n)) * (1 if c >= 0 else -1)
        y = 512 + a * (abs(s) ** (2 / n)) * (1 if s >= 0 else -1)
        points.append((px(x), px(y)))
    mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(mask).polygon(points, fill=255)
    return mask


def vertical_gradient(top: tuple, bottom: tuple) -> Image.Image:
    ramp = Image.linear_gradient("L").resize((S, S))  # black at the top, white at the bottom
    return Image.composite(Image.new("RGB", (S, S), bottom), Image.new("RGB", (S, S), top), ramp)


def smooth(mask: Image.Image, radius: float) -> Image.Image:
    """Rounds the corners of a drawn shape: blur, then cut back to a hard edge (downscaling anti-aliases it)."""
    return mask.filter(ImageFilter.GaussianBlur(px(radius))).point(lambda v: 255 if v > 127 else 0)


def glyph_mask() -> Image.Image:
    mask = Image.new("L", (S, S), 0)
    d = ImageDraw.Draw(mask)
    d.rounded_rectangle((px(262), px(286), px(762), px(646)), radius=px(104), fill=255)  # bubble
    d.polygon([(px(384), px(630)), (px(336), px(754)), (px(520), px(630))], fill=255)  # tail, joined on the flat part of the bottom edge
    return smooth(mask, 9)


def check_mask() -> Image.Image:
    mask = Image.new("L", (S, S), 0)
    d = ImageDraw.Draw(mask)
    pts = [(px(392), px(468)), (px(474), px(552)), (px(642), px(380))]
    width = px(58)
    d.line(pts, fill=255, width=width, joint="curve")
    for x, y in (pts[0], pts[-1]):
        r = width // 2
        d.ellipse((x - r, y - r, x + r, y + r), fill=255)
    return mask


def drop_shadow(mask: Image.Image, dy: float, blur: float, alpha: int) -> Image.Image:
    shifted = ImageChops.offset(mask, 0, px(dy))
    soft = shifted.filter(ImageFilter.GaussianBlur(px(blur))).point(lambda v: v * alpha // 255)
    layer = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    layer.putalpha(soft)
    return layer


def render() -> Image.Image:
    body = squircle_mask()
    canvas = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    canvas.alpha_composite(drop_shadow(body, 14, 22, 90))  # the usual soft shadow under a macOS icon

    face = vertical_gradient(TOP, BOTTOM).convert("RGBA")
    # A faint light from the top edge so the surface does not look flat.
    sheen = Image.linear_gradient("L").transpose(Image.FLIP_TOP_BOTTOM).resize((S, S)).point(lambda v: max(0, v - 130) * 40 // 255)
    glow = Image.new("RGBA", (S, S), (255, 255, 255, 0))
    glow.putalpha(sheen)
    face.alpha_composite(glow)
    canvas.paste(face, (0, 0), body)

    bubble = glyph_mask()
    canvas.alpha_composite(drop_shadow(bubble, 16, 14, 70))
    white = Image.new("RGBA", (S, S), (255, 255, 255, 255))
    canvas.paste(white, (0, 0), bubble)
    canvas.paste(Image.new("RGBA", (S, S), CHECK + (255,)), (0, 0), check_mask())
    return canvas


def main() -> int:
    BUILD.mkdir(exist_ok=True)
    master = render()
    master.resize((1024, 1024), Image.LANCZOS).save(BUILD / "icon.png")

    iconset = BUILD / "icon.iconset"
    shutil.rmtree(iconset, ignore_errors=True)
    iconset.mkdir()
    for size in (16, 32, 128, 256, 512):
        master.resize((size, size), Image.LANCZOS).save(iconset / f"icon_{size}x{size}.png")
        master.resize((size * 2, size * 2), Image.LANCZOS).save(iconset / f"icon_{size}x{size}@2x.png")
    try:
        subprocess.run(["iconutil", "-c", "icns", str(iconset), "-o", str(BUILD / "icon.icns")], check=True)
    finally:
        shutil.rmtree(iconset, ignore_errors=True)
    print(f"wrote {BUILD / 'icon.png'} and {BUILD / 'icon.icns'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
