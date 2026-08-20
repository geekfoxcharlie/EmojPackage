#!/usr/bin/env python3
import struct
import zlib
import os
import sys

PALETTE = [
    (229, 72, 77),
    (245, 165, 36),
    (70, 167, 88),
    (0, 178, 255),
    (142, 78, 198),
    (255, 122, 182),
    (23, 195, 178),
    (255, 224, 102),
    (141, 145, 153),
]

SIZE = 640
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "test-assets")


def png_chunk(tag, data):
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)


def solid_png(rgb):
    r, g, b = rgb
    row = b"\x00" + bytes([r, g, b]) * SIZE
    raw = row * SIZE
    ihdr = struct.pack(">IIBBBBB", SIZE, SIZE, 8, 2, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + png_chunk(b"IHDR", ihdr)
        + png_chunk(b"IDAT", zlib.compress(raw, 9))
        + png_chunk(b"IEND", b"")
    )


def main():
    os.makedirs(OUT, exist_ok=True)
    for i, rgb in enumerate(PALETTE, 1):
        path = os.path.join(OUT, "emoji_%d.png" % i)
        with open(path, "wb") as f:
            f.write(solid_png(rgb))
        print(path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
