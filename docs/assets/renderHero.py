#!/usr/bin/env python3
"""
Renders the README hero.

It was a hand-made image, which meant the rename could not reach it: the front
page went on saying OpenVideo in 60px type while everything else said OpenScene.
Generating it from the same palette and geometry the app uses makes the next
brand or copy change a one-line edit rather than a design task.

Run: python3 docs/assets/renderHero.py
"""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'mobile' / 'scripts'))
from renderIcons import _gradient_for, _mask, diagonal_gradient, BG_STOPS, MARK_STOPS  # noqa: E402

W, H = 1742, 696
SS = 2  # supersample, for text and hairlines

BG = (0x0B, 0x0A, 0x11)
GRID = (0xFF, 0xFF, 0xFF, 4)
TEXT = (0xF5, 0xF5, 0xF7)
MUTED = (0x9A, 0x9A, 0xA6)
LINE = (0x2A, 0x28, 0x38)
PANEL = (0x14, 0x13, 0x1E)
ACCENT = (0xA6, 0x90, 0xFF)
MINT = (0x78, 0xF7, 0xBC)

HELVETICA = '/System/Library/Fonts/Helvetica.ttc'
MENLO = '/System/Library/Fonts/Menlo.ttc'


def font(size: int, bold: bool = False, mono: bool = False) -> ImageFont.FreeTypeFont:
    if mono:
        return ImageFont.truetype(MENLO, size * SS)
    return ImageFont.truetype(HELVETICA, size * SS, index=1 if bold else 0)


def gradient_text(canvas: Image.Image, xy, text: str, typeface, stops) -> int:
    """Paints text through a gradient scoped to the text's own box."""
    mask = Image.new('L', canvas.size, 0)
    ImageDraw.Draw(mask).text(xy, text, font=typeface, fill=255)
    box = mask.getbbox()
    if box is None:
        return 0
    span = max(box[2] - box[0], box[3] - box[1])
    ramp = Image.new('RGBA', canvas.size, (0, 0, 0, 0))
    ramp.paste(diagonal_gradient(span, stops).convert('RGBA'), (box[0], box[1]))
    canvas.paste(ramp, (0, 0), mask)
    return box[2] - box[0]


def rounded(draw: ImageDraw.ImageDraw, box, radius: int, fill=None, outline=None, width: int = 1) -> None:
    draw.rounded_rectangle(
        [c * SS for c in box], radius=radius * SS, fill=fill, outline=outline, width=width * SS
    )


def main() -> None:
    canvas = Image.new('RGBA', (W * SS, H * SS), BG + (255,))
    draw = ImageDraw.Draw(canvas)

    # Grid, then a wash of brand colour in the corners, as the original had.
    for x in range(0, W, 58):
        draw.line([(x * SS, 0), (x * SS, H * SS)], fill=GRID, width=1)
    for y in range(0, H, 58):
        draw.line([(0, y * SS), (W * SS, y * SS)], fill=GRID, width=1)

    # The app mark, drawn by the icon renderer's own primitives — but the play
    # triangle alone. The full icon carries a timeline and a playhead that turn
    # to mud at 80px, where the icon itself is never shown that small.
    tile = 1024
    art = Image.new('RGBA', (tile, tile), (0, 0, 0, 0))
    art.paste(diagonal_gradient(tile, BG_STOPS).convert('RGBA'), (0, 0))
    # Centred by its own bounding box rather than by eye: the stroked triangle's
    # box is (376,226)-(692,554), so its centre sits right and low of the tile's.
    scale = 1.18
    triangle = _mask(tile, scale, (512 - 534 * scale, 512 - 390 * scale), [('triangle',)])
    art.paste(_gradient_for(triangle, tile), (0, 0), triangle)
    corner = Image.new('L', (tile, tile), 0)
    ImageDraw.Draw(corner).rounded_rectangle([0, 0, tile - 1, tile - 1], radius=228, fill=255)
    art.putalpha(corner)
    canvas.paste(art.resize((80 * SS, 80 * SS), Image.LANCZOS), (96 * SS, 152 * SS), art.resize((80 * SS, 80 * SS), Image.LANCZOS))

    # Wordmark: "Open" plain, "Scene" through the brand gradient.
    word = font(66, bold=True)
    draw.text((200 * SS, 158 * SS), 'Open', font=word, fill=TEXT)
    open_width = draw.textlength('Open', font=word)
    gradient_text(canvas, (200 * SS + open_width, 158 * SS), 'Scene', word, [(0.0, ACCENT), (1.0, MINT)])

    head = font(31, bold=True)
    draw.text((96 * SS, 274 * SS), 'The video editor ', font=head, fill=TEXT)
    lead = draw.textlength('The video editor ', font=head)
    draw.text((96 * SS + lead, 274 * SS), 'that', font=head, fill=ACCENT)
    draw.text((96 * SS, 320 * SS), 'edits with you.', font=head, fill=MINT)

    body = font(15)
    for index, line in enumerate([
        'A local-first editor with an agent at the controls — it reads your',
        'timeline, cuts clips, generates voice, images and video, and exports',
        'with your own FFmpeg. Desktop and mobile share one editing core.'
    ]):
        draw.text((96 * SS, (388 + index * 30) * SS), line, font=body, fill=MUTED)

    # Pills. "Runs from source" was true before there were installers.
    pill = font(11, mono=True)
    x = 96
    for text in ['LOCAL-FIRST', 'MIT', 'DESKTOP + MOBILE']:
        width = draw.textlength(text, font=pill) / SS + 44
        rounded(draw, (x, 508, x + width, 548), 20, outline=LINE, width=1)
        draw.text(((x + 22) * SS, 521 * SS), text, font=pill, fill=MUTED)
        x += width + 16

    # The mock window.
    wx, wy, ww, wh = 904, 134, 740, 430
    rounded(draw, (wx, wy, wx + ww, wy + wh), 16, fill=PANEL, outline=LINE, width=1)
    for index, dot in enumerate(range(3)):
        cx = wx + 22 + index * 16
        draw.ellipse([cx * SS, (wy + 20) * SS, (cx + 8) * SS, (wy + 28) * SS], fill=(0x3A, 0x38, 0x48))

    tab = font(12, bold=True)
    tabs = ['Editing', 'Voice', 'Image', 'Video']
    tx = wx + 84
    for index, name in enumerate(tabs):
        width = draw.textlength(name, font=tab) / SS + 22
        if index == 0:
            rounded(draw, (tx, wy + 12, tx + width, wy + 38), 7, fill=(0x24, 0x22, 0x32))
        draw.text(((tx + 11) * SS, (wy + 18) * SS), name, font=tab, fill=TEXT if index == 0 else MUTED)
        tx += width + 6

    # Program monitor, timeline, then the agent column.
    rounded(draw, (wx + 20, wy + 56, wx + 460, wy + 250), 10, fill=(0x1B, 0x1A, 0x2A))
    triangle = [(wx + 228, wy + 138), (wx + 228, wy + 168), (wx + 254, wy + 153)]
    draw.polygon([(px * SS, py * SS) for px, py in triangle], fill=(0xE8, 0xE8, 0xF0))

    for index in range(14):
        tick = wx + 24 + index * 31
        draw.line([(tick * SS, (wy + 262) * SS), (tick * SS, (wy + 270) * SS)], fill=LINE, width=1 * SS)

    rounded(draw, (wx + 20, wy + 282, wx + 460, wy + 314), 6, fill=(0x1B, 0x1A, 0x2A))
    rounded(draw, (wx + 20, wy + 282, wx + 232, wy + 314), 6, fill=ACCENT)
    rounded(draw, (wx + 238, wy + 282, wx + 386, wy + 314), 6, fill=(0x6F, 0xD9, 0xA8))
    draw.line([((wx + 226) * SS, (wy + 278) * SS), ((wx + 226) * SS, (wy + 318) * SS)], fill=TEXT, width=2 * SS)
    rounded(draw, (wx + 20, wy + 324, wx + 460, wy + 356), 6, fill=(0x1B, 0x1A, 0x2A))
    rounded(draw, (wx + 20, wy + 324, wx + 300, wy + 356), 6, fill=(0x4F, 0xB5, 0x8B))

    draw.line([((wx + 486) * SS, (wy + 12) * SS), ((wx + 486) * SS, (wy + wh - 12) * SS)], fill=LINE, width=1 * SS)

    label = font(10, mono=True)
    small = font(13)
    draw.text(((wx + 508) * SS, (wy + 62) * SS), 'You', font=label, fill=MUTED)
    draw.text(((wx + 508) * SS, (wy + 84) * SS), 'Trim the intro and drop the', font=small, fill=TEXT)
    draw.text(((wx + 508) * SS, (wy + 104) * SS), 'B-roll after it.', font=small, fill=TEXT)
    draw.text(((wx + 508) * SS, (wy + 140) * SS), 'Agent', font=label, fill=MUTED)

    mono = font(11, mono=True)
    for index, call in enumerate(['trimTimelineClip', 'addClipToTimeline']):
        top = wy + 162 + index * 40
        rounded(draw, (wx + 504, top, wx + 720, top + 30), 7, outline=LINE, width=1)
        draw.text(((wx + 516) * SS, (top + 9) * SS), f'✓ {call}', font=mono, fill=MINT)

    rounded(draw, (wx + 504, wy + 248, wx + 720, wy + 308), 8, outline=ACCENT, width=1)
    ask = font(12)
    draw.text(((wx + 516) * SS, (wy + 260) * SS), 'Run exportProjectVideo?', font=ask, fill=TEXT)
    draw.text(((wx + 516) * SS, (wy + 280) * SS), 'Once / Always / Deny', font=ask, fill=MUTED)

    out = Path(__file__).with_name('openscene-hero.png')
    canvas.convert('RGB').resize((W, H), Image.LANCZOS).save(out)
    print('wrote', out)


if __name__ == '__main__':
    main()
