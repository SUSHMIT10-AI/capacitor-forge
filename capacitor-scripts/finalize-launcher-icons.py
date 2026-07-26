#!/usr/bin/env python3
"""Finalize Android launcher icons so the user artwork sits edge-perfect.

Problem this solves: the adaptive-icon background was a fixed theme color
(often blue) while the foreground artwork was inset inside the 66dp safe
zone. Launchers therefore drew a colored ring/lines around the logo.

Fix: sample the artwork's own border color, use it for BOTH the adaptive
background layer and as an opaque backdrop baked behind the foreground and
legacy bitmaps. The result is a seamless icon with no colored edges,
whatever mask (circle / squircle / rounded square) the launcher applies.

Usage: finalize-launcher-icons.py <res_dir> <icon_candidate> [more candidates...]
"""
import os
import re
import sys
import glob

try:
    from PIL import Image
except Exception:  # pragma: no cover - PIL is installed by the CI step
    print("Pillow unavailable — skipping launcher icon finalization.")
    sys.exit(0)

BUCKETS = [
    ("mipmap-mdpi", 48, 108),
    ("mipmap-hdpi", 72, 162),
    ("mipmap-xhdpi", 96, 216),
    ("mipmap-xxhdpi", 144, 324),
    ("mipmap-xxxhdpi", 192, 432),
]
# Android adaptive icons are 108dp with an 18dp bleed on each side; only the
# inner 72dp is guaranteed visible. Keep artwork inside that safe zone.
SAFE_ZONE = 72.0 / 108.0


def square(img: "Image.Image") -> "Image.Image":
    w, h = img.size
    side = min(w, h)
    return img.crop(((w - side) // 2, (h - side) // 2, (w - side) // 2 + side, (h - side) // 2 + side))


def border_color(img: "Image.Image"):
    """Median color of the artwork's outer border pixels (opaque ones only)."""
    small = img.resize((64, 64), Image.LANCZOS)
    px = small.load()
    samples = []
    for i in range(64):
        for (x, y) in ((i, 0), (i, 63), (0, i), (63, i)):
            r, g, b, a = px[x, y]
            if a >= 200:
                samples.append((r, g, b))
    if len(samples) < 16:
        return (255, 255, 255)
    samples.sort(key=lambda c: c[0] * 299 + c[1] * 587 + c[2] * 114)
    return samples[len(samples) // 2]


def write_background_color(res_dir: str, rgb):
    hex_value = "#%02X%02X%02X" % rgb
    pattern = re.compile(r'(<color\s+name="ic_launcher_background"\s*>)[^<]*(</color>)')
    replaced = False
    for path in glob.glob(os.path.join(res_dir, "values*", "*.xml")):
        try:
            text = open(path, encoding="utf-8").read()
        except Exception:
            continue
        if 'name="ic_launcher_background"' not in text:
            continue
        new_text = pattern.sub(lambda m: m.group(1) + hex_value + m.group(2), text)
        if new_text != text:
            open(path, "w", encoding="utf-8").write(new_text)
        replaced = True
    if not replaced:
        values_dir = os.path.join(res_dir, "values")
        os.makedirs(values_dir, exist_ok=True)
        with open(os.path.join(values_dir, "ic_launcher_background.xml"), "w", encoding="utf-8") as f:
            f.write(
                '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n'
                '    <color name="ic_launcher_background">%s</color>\n</resources>\n' % hex_value
            )
    print("Adaptive icon background color set to %s (sampled from artwork)." % hex_value)


def main():
    if len(sys.argv) < 3:
        print("usage: finalize-launcher-icons.py <res_dir> <icon> [icon...]")
        return 1
    res_dir = sys.argv[1]
    src = next((p for p in sys.argv[2:] if p and os.path.isfile(p) and os.path.getsize(p) > 0), None)
    if not src:
        print("No source icon found — leaving generated icons untouched.")
        return 0
    try:
        base = square(Image.open(src).convert("RGBA"))
    except Exception as e:
        print("Cannot open source icon (%s) — leaving generated icons untouched." % e)
        return 0

    bg = border_color(base)
    flat = Image.new("RGBA", base.size, bg + (255,))
    flat.alpha_composite(base)

    for folder, legacy_size, adaptive_size in BUCKETS:
        out = os.path.join(res_dir, folder)
        os.makedirs(out, exist_ok=True)
        legacy = flat.resize((legacy_size, legacy_size), Image.LANCZOS)
        legacy.save(os.path.join(out, "ic_launcher.png"), "PNG")
        legacy.save(os.path.join(out, "ic_launcher_round.png"), "PNG")

        inner = max(1, int(round(adaptive_size * SAFE_ZONE)))
        fg = Image.new("RGBA", (adaptive_size, adaptive_size), bg + (255,))
        art = base.resize((inner, inner), Image.LANCZOS)
        offset = (adaptive_size - inner) // 2
        fg.alpha_composite(art, (offset, offset))
        fg.save(os.path.join(out, "ic_launcher_foreground.png"), "PNG")

    splash_dir = os.path.join(res_dir, "drawable")
    splash_path = os.path.join(splash_dir, "splash_icon.png")
    if os.path.isfile(splash_path):
        os.makedirs(splash_dir, exist_ok=True)
        base.resize((384, 384), Image.LANCZOS).save(splash_path, "PNG")

    write_background_color(res_dir, bg)
    print("✅ Launcher icons finalized — artwork is edge-to-edge with no colored border.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
