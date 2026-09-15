#!/usr/bin/env python3
"""Stitch the client's world map art into one PNG per WorldMapArea row.

Blizzard-derived output: it stays on this box (never commit or upload it).

  1. Build the extractor (line at the top of mpq_extract.c), then pull the tiles
     out of the STOCK archives, lowest priority first:
       D=/opt/wow/extract/client/Data; L=$D/enUS
       ./mpq_extract /opt/wow/extract/worldmap-blp 'interface\\worldmap\\' \\
         $D/common.MPQ $D/common-2.MPQ $D/expansion.MPQ $D/lichking.MPQ \\
         $L/locale-enUS.MPQ $L/expansion-locale-enUS.MPQ $L/lichking-locale-enUS.MPQ \\
         $D/patch.MPQ $L/patch-enUS.MPQ $D/patch-2.MPQ $L/patch-enUS-2.MPQ \\
         $D/patch-3.MPQ $L/patch-enUS-3.MPQ
  2. python3 tools/extract_worldmap.py [--tiles DIR] [--dbc-dir DIR] [--out DIR]

Base map: 12 tiles of 256 px in a 4x3 grid. The client's WorldMapDetailFrame is
1002x668 (FrameXML worldmapframe.xml) with tile 1 at its top-left, so the
1024x768 mosaic is cropped to 1002x668 and WorldMapArea bounds span that crop.

Zone base tiles are blank parchment; towns, lakes and roads are WorldMapOverlay
textures the client reveals as areas are explored. Every overlay is drawn here
(fully explored), placed the way WorldMapFrame_Update does it: a grid of
ceil(w/256) x ceil(h/256) tiles at (offsetX + 256*col, offsetY + 256*row), the
last column/row showing only the remainder of a power-of-two file.
"""

import argparse
import json
import math
import os
import struct
import sys
from collections import defaultdict

from PIL import Image

TILE = 256
WIDTH, HEIGHT = 1002, 668


def read_dbc(path, fields, size, fmt):
    data = open(path, "rb").read()
    magic, records, got_fields, got_size, _ = struct.unpack("<4s4I", data[:20])
    if magic != b"WDBC" or got_fields != fields or got_size != size:
        sys.exit(f"{path}: unexpected layout {magic} fields={got_fields} size={got_size}")
    strings = data[20 + records * size:]

    def text(ofs):
        return strings[ofs:strings.index(b"\0", ofs)].decode("utf-8", "replace")

    rows = [struct.unpack(fmt, data[20 + i * size:20 + (i + 1) * size]) for i in range(records)]
    return rows, text


def world_map_areas(path):
    rows, text = read_dbc(path, 11, 44, "<4I4f3i")
    return [dict(id=r[0], map=r[1], zone=r[2], name=text(r[3]), left=r[4], right=r[5],
                 top=r[6], bottom=r[7], virtual_map=r[8]) for r in rows]


def world_map_overlays(path):
    # ID, WorldMapAreaID, AreaID[4], MapPointX, MapPointY, TextureName,
    # TextureWidth, TextureHeight, OffsetX, OffsetY, HitRect[4]
    rows, text = read_dbc(path, 17, 68, "<17i")
    overlays = defaultdict(list)
    for r in rows:
        name = text(r[8])
        if name:
            overlays[r[1]].append(dict(texture=name, width=r[9], height=r[10], x=r[11], y=r[12]))
    return overlays


def load_tile(path):
    with Image.open(path) as tile:
        return tile.convert("RGBA")


def pixel_and_file_size(index, count, total):
    """Displayed pixels and power-of-two file size for tile `index` of `count`."""
    if index < count - 1:
        return TILE, TILE
    pixels = total % TILE or TILE
    file_size = 16
    while file_size < pixels:
        file_size *= 2
    return pixels, file_size


def draw_overlay(canvas, folder, overlay, missing):
    cols = math.ceil(overlay["width"] / TILE)
    rows = math.ceil(overlay["height"] / TILE)
    n = 0
    for row in range(rows):
        ph, fh = pixel_and_file_size(row, rows, overlay["height"])
        for col in range(cols):
            n += 1
            pw, fw = pixel_and_file_size(col, cols, overlay["width"])
            path = os.path.join(folder, f"{overlay['texture'].lower()}{n}.blp")
            if not os.path.isfile(path):
                missing.append(os.path.basename(path))
                continue
            tile = load_tile(path)
            crop = tile.crop((0, 0, round(tile.width * pw / fw), round(tile.height * ph / fh)))
            if crop.size != (pw, ph):
                crop = crop.resize((pw, ph), Image.LANCZOS)
            canvas.alpha_composite(crop, (overlay["x"] + TILE * col, overlay["y"] + TILE * row))


def stitch(tile_dir, area, overlays, missing):
    folder = os.path.join(tile_dir, area["name"].lower())
    paths = [os.path.join(folder, f"{area['name'].lower()}{n}.blp") for n in range(1, 13)]
    if not all(os.path.isfile(p) for p in paths):
        return None
    canvas = Image.new("RGBA", (4 * TILE, 3 * TILE))
    for n, path in enumerate(paths):
        tile = load_tile(path)
        if tile.size != (TILE, TILE):
            tile = tile.resize((TILE, TILE), Image.LANCZOS)
        canvas.paste(tile, ((n % 4) * TILE, (n // 4) * TILE))
    for overlay in overlays:
        draw_overlay(canvas, folder, overlay, missing)
    image = canvas.crop((0, 0, WIDTH, HEIGHT))
    if image.getextrema()[3][0] == 255:
        image = image.convert("RGB")
    return image


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--tiles", default="/opt/wow/extract/worldmap-blp/interface/worldmap")
    ap.add_argument("--dbc-dir", default="/opt/wow/server/data/dbc")
    ap.add_argument("--out", default="/opt/wow/server/data/dashboard-maps")
    args = ap.parse_args()

    overlays = world_map_overlays(os.path.join(args.dbc_dir, "WorldMapOverlay.dbc"))
    os.makedirs(args.out, exist_ok=True)
    manifest, skipped, missing = [], [], []
    for area in world_map_areas(os.path.join(args.dbc_dir, "WorldMapArea.dbc")):
        area_overlays = overlays.get(area["id"], [])
        image = stitch(args.tiles, area, area_overlays, missing)
        if image is None:
            skipped.append(area["name"])
            continue
        area["file"] = f"{area['name'].lower()}.png"
        area["width"], area["height"] = WIDTH, HEIGHT
        area["overlays"] = len(area_overlays)
        image.save(os.path.join(args.out, area["file"]), optimize=True)
        manifest.append(area)

    with open(os.path.join(args.out, "manifest.json"), "w") as f:
        json.dump(manifest, f, indent=1)
    print(f"{len(manifest)} maps written to {args.out}, "
          f"{sum(a['overlays'] for a in manifest)} overlays drawn")
    if skipped:
        print(f"skipped {len(skipped)} rows without base tiles: {', '.join(skipped)}")
    if missing:
        print(f"{len(missing)} overlay tiles missing: {', '.join(missing[:20])}")


if __name__ == "__main__":
    main()
