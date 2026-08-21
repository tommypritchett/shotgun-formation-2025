#!/usr/bin/env python3
"""
Generate the app's web art from the approved logo.

Source of truth is art/shotgun-logo-transparent.png. This script only ever
CROPS and SCALES it — the art itself is never regenerated or retouched.

It uses the WORDMARK-ONLY crop, not the full lockup. docs/logo-lockup.html is
explicit about why: "Below roughly 150px the characters stop reading as
individuals and turn into texture." Every icon here is at or below that.

The canvas is opaque chalkboard (--sf-board), never transparent, so the icon
does not vanish on a dark home screen.

It also emits the web-sized lockup used on the Join screen. `art/` holds the
print-density original (1800px, ~927 KB); shipping that to a phone to render it
at ~300px would be silly, so this writes a right-sized derivative into
client/public/ where CRA serves it as a plain URL. CRA cannot import from
outside src/, and a 927 KB data URI in the bundle would be worse than either.

Run:  python3 scripts/make-icons.py
"""
import struct
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'art' / 'shotgun-logo-transparent.png'
OUT = ROOT / 'client' / 'public'

BOARD = (13, 16, 23, 255)      # --sf-board #0D1017
WORDMARK_BAND = (533, 946)     # y range holding SHOTGUN + FORMATION, measured
MARGIN = 0.06                  # side margin as a fraction of the canvas


def wordmark(src: Image.Image) -> Image.Image:
    """The SH⬛TGUN / FORMATION lockup, alpha-trimmed."""
    band = src.crop((0, WORDMARK_BAND[0], src.width, WORDMARK_BAND[1]))
    box = band.getbbox()
    return band.crop(box)


def square_icon(mark: Image.Image, size: int) -> Image.Image:
    """The wordmark centred on an opaque square."""
    canvas = Image.new('RGBA', (size, size), BOARD)
    target_w = max(1, int(size * (1 - 2 * MARGIN)))
    target_h = max(1, round(target_w * mark.height / mark.width))
    scaled = mark.resize((target_w, target_h), Image.LANCZOS)
    canvas.alpha_composite(scaled, ((size - target_w) // 2, (size - target_h) // 2))
    return canvas


def write_ico(images, path: Path):
    """
    A PNG-in-ICO container. Every browser that matters has read this since IE11,
    and it avoids hand-rolling a BMP encoder for something this small.
    """
    blobs = []
    for im in images:
        from io import BytesIO
        buf = BytesIO()
        im.convert('RGBA').save(buf, format='PNG', optimize=True)
        blobs.append(buf.getvalue())

    header = struct.pack('<HHH', 0, 1, len(blobs))
    offset = 6 + 16 * len(blobs)
    entries, body = b'', b''
    for im, blob in zip(images, blobs):
        w = 0 if im.width >= 256 else im.width
        h = 0 if im.height >= 256 else im.height
        entries += struct.pack('<BBBBHHII', w, h, 0, 0, 1, 32, len(blob), offset)
        offset += len(blob)
        body += blob
    path.write_bytes(header + entries + body)


def lockup(src: Image.Image, width: int) -> Image.Image:
    """
    The full lockup — characters and all — trimmed and scaled for the web.

    Kept on transparency: the Join screen is already chalkboard, and the
    characters have to sit on it without a plate behind them.
    """
    trimmed = src.crop(src.getbbox())
    height = round(width * trimmed.height / trimmed.width)
    return trimmed.resize((width, height), Image.LANCZOS)


def main():
    src = Image.open(SRC).convert('RGBA')
    mark = wordmark(src)
    print(f'wordmark crop: {mark.width}x{mark.height} '
          f'({mark.width / mark.height:.2f}:1)')

    for size, name in [(512, 'logo512.png'), (192, 'logo192.png'),
                       (180, 'apple-touch-icon.png')]:
        icon = square_icon(mark, size)
        icon.convert('RGB').save(OUT / name, format='PNG', optimize=True)
        print(f'  {name:24s} {size}x{size}')

    ico_sizes = [16, 32, 48]
    write_ico([square_icon(mark, s) for s in ico_sizes], OUT / 'favicon.ico')
    print(f'  {"favicon.ico":24s} {", ".join(str(s) for s in ico_sizes)}')

    # ~3x the largest size it renders at on a phone, which is all it needs.
    web = lockup(src, 900)
    web.save(OUT / 'logo-lockup.png', format='PNG', optimize=True)
    kb = (OUT / 'logo-lockup.png').stat().st_size / 1024
    print(f'  {"logo-lockup.png":24s} {web.width}x{web.height}  {kb:.0f} KB')


if __name__ == '__main__':
    main()
