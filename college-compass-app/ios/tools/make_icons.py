#!/usr/bin/env python3
"""Generate the College Compass iOS app icon + launch logo (original compass-needle mark).

Usage: python3 ios/tools/make_icons.py   (needs Pillow). Run from college-compass-app/.
Outputs:
  ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png   1024x1024, opaque RGB (no alpha)
  ios/App/App/Assets.xcassets/LaunchLogo.imageset/LaunchLogo{,@2x,@3x}.png  transparent mark
  docs/app-store/icon-1024.png                                          copy for App Store Connect
"""
import math
import os
from PIL import Image, ImageDraw

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
XC = os.path.join(ROOT, "ios/App/App/Assets.xcassets")
SS = 4  # supersampling factor

NAVY_TOP = (22, 38, 66)
NAVY_BOT = (9, 14, 22)
RING = (122, 172, 224)
NEEDLE_N = (255, 122, 61)
NEEDLE_S = (218, 228, 242)
PIVOT_RING = (255, 255, 255)
PIVOT = (11, 17, 26)


def rotate(pt, c, deg):
    a = math.radians(deg)
    x, y = pt[0] - c[0], pt[1] - c[1]
    return (c[0] + x * math.cos(a) - y * math.sin(a), c[1] + x * math.sin(a) + y * math.cos(a))


def draw_mark(d, size, cx, cy, scale):
    """Draw ring, ticks and needle centred at (cx, cy); scale = ring-radius in px."""
    r = scale
    w = r * 0.085
    d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=RING, width=int(w))
    # four ticks inside the ring
    for deg in (0, 90, 180, 270):
        p1 = rotate((cx, cy - r + w * 0.4), (cx, cy), deg)
        p2 = rotate((cx, cy - r + w * 2.6), (cx, cy), deg)
        d.line([p1, p2], fill=RING, width=int(w * 0.95))
    # needle: north half (orange) and south half (pale), rotated 35deg clockwise
    L = r * 0.66      # half length
    B = r * 0.17      # half base width
    tilt = 35
    north = [rotate(p, (cx, cy), tilt) for p in [(cx, cy - L), (cx + B, cy), (cx - B, cy)]]
    south = [rotate(p, (cx, cy), tilt) for p in [(cx, cy + L), (cx + B, cy), (cx - B, cy)]]
    d.polygon(south, fill=NEEDLE_S)
    d.polygon(north, fill=NEEDLE_N)
    # pivot
    pr = r * 0.075
    d.ellipse([cx - pr * 1.55, cy - pr * 1.55, cx + pr * 1.55, cy + pr * 1.55], fill=PIVOT_RING)
    d.ellipse([cx - pr, cy - pr, cx + pr, cy + pr], fill=PIVOT)


def icon(size=1024):
    big = size * SS
    img = Image.new("RGB", (big, big))
    px = ImageDraw.Draw(img)
    for y in range(big):  # vertical gradient
        t = y / (big - 1)
        px.line([(0, y), (big, y)], fill=tuple(int(NAVY_TOP[i] + (NAVY_BOT[i] - NAVY_TOP[i]) * t) for i in range(3)))
    draw_mark(px, big, big / 2, big / 2, big * 0.355)
    return img.resize((size, size), Image.LANCZOS).convert("RGB")


def logo(size):
    big = size * SS
    img = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    draw_mark(ImageDraw.Draw(img), big, big / 2, big / 2, big * 0.46)
    return img.resize((size, size), Image.LANCZOS)


def main():
    ic = icon(1024)
    assert ic.mode == "RGB"
    path = os.path.join(XC, "AppIcon.appiconset/AppIcon-512@2x.png")
    ic.save(path, "PNG", optimize=True)
    os.makedirs(os.path.join(ROOT, "docs/app-store"), exist_ok=True)
    ic.save(os.path.join(ROOT, "docs/app-store/icon-1024.png"), "PNG", optimize=True)
    d = os.path.join(XC, "LaunchLogo.imageset")
    os.makedirs(d, exist_ok=True)
    for name, px_size in (("LaunchLogo.png", 120), ("LaunchLogo@2x.png", 240), ("LaunchLogo@3x.png", 360)):
        logo(px_size).save(os.path.join(d, name), "PNG", optimize=True)
    print("ok")


if __name__ == "__main__":
    main()
