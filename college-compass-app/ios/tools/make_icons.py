#!/usr/bin/env python3
"""Generate the Tierwise app icon, launch logo and web icons ("Stepped T" mark).

The mark is a T whose crossbar steps down through tiers into a solid stem,
off-white on a spruce gradient (colors from src/styles/base.css).

Usage: python3 ios/tools/make_icons.py   (needs Pillow). Run from college-compass-app/.
Outputs:
  ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png   1024x1024, opaque RGB (no alpha)
  ios/App/App/Assets.xcassets/LaunchLogo.imageset/LaunchLogo{,@2x,@3x}.png  rounded tile, transparent corners
  docs/app-store/icon-1024.png                                          copy for App Store Connect
  public/icons/{apple-touch-icon-180,icon-192,icon-512,maskable-512}.png  web / home-screen icons
"""
import os
from PIL import Image, ImageDraw

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
XC = os.path.join(ROOT, "ios/App/App/Assets.xcassets")
SS = 4  # supersampling factor

BG_TOP = (0x23, 0x6B, 0x58)
BG_BOT = (0x17, 0x49, 0x3C)
MARK = (0xF1, 0xF2, 0xEE)

# Bars in 1024-unit space: (x, y, w, h); every bar has corner radius 65.
BARS = [(172, 168, 680, 130), (282, 322, 460, 130), (392, 476, 240, 380)]
RADIUS = 65
CENTER = (512, 512)


def background(big):
    img = Image.new("RGB", (big, big))
    d = ImageDraw.Draw(img)
    for y in range(big):  # vertical gradient
        t = y / (big - 1)
        d.line([(0, y), (big, y)], fill=tuple(int(BG_TOP[i] + (BG_BOT[i] - BG_TOP[i]) * t) for i in range(3)))
    return img


def draw_mark(img, big, scale=1.0):
    """Draw the stepped T; scale < 1 shrinks it about the centre (for maskable icons)."""
    d = ImageDraw.Draw(img)
    k = big / 1024
    cx, cy = CENTER
    for x, y, w, h in BARS:
        x0 = (cx + (x - cx) * scale) * k
        y0 = (cy + (y - cy) * scale) * k
        d.rounded_rectangle([x0, y0, x0 + w * scale * k, y0 + h * scale * k], radius=RADIUS * scale * k, fill=MARK)


def icon(size=1024, scale=1.0):
    big = size * SS
    img = background(big)
    draw_mark(img, big, scale)
    return img.resize((size, size), Image.LANCZOS).convert("RGB")


def rounded_tile(size):
    """The icon as a rounded tile on transparency, so it sits well on light and dark launch screens."""
    big = size * SS
    art = background(big)
    draw_mark(art, big)
    mask = Image.new("L", (big, big), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, big - 1, big - 1], radius=int(big * 0.225), fill=255)
    out = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    out.paste(art, (0, 0), mask)
    return out.resize((size, size), Image.LANCZOS)


def main():
    ic = icon(1024)
    assert ic.mode == "RGB"
    ic.save(os.path.join(XC, "AppIcon.appiconset/AppIcon-512@2x.png"), "PNG", optimize=True)
    os.makedirs(os.path.join(ROOT, "docs/app-store"), exist_ok=True)
    ic.save(os.path.join(ROOT, "docs/app-store/icon-1024.png"), "PNG", optimize=True)

    d = os.path.join(XC, "LaunchLogo.imageset")
    os.makedirs(d, exist_ok=True)
    for name, px_size in (("LaunchLogo.png", 120), ("LaunchLogo@2x.png", 240), ("LaunchLogo@3x.png", 360)):
        rounded_tile(px_size).save(os.path.join(d, name), "PNG", optimize=True)

    web = os.path.join(ROOT, "public/icons")
    os.makedirs(web, exist_ok=True)
    for name, px_size in (("apple-touch-icon-180.png", 180), ("icon-192.png", 192), ("icon-512.png", 512)):
        icon(px_size).save(os.path.join(web, name), "PNG", optimize=True)
    # Maskable icons can be cropped to a circle of radius 40%; shrink the mark to stay inside it.
    icon(512, scale=0.78).save(os.path.join(web, "maskable-512.png"), "PNG", optimize=True)
    print("ok")


if __name__ == "__main__":
    main()
