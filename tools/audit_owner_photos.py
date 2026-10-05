"""Audit a folder of owner photos: size, orientation, capture date, device, GPS; writes a labeled contact sheet."""
import sys
from pathlib import Path

from PIL import ExifTags, Image, ImageDraw, ImageFont, ImageOps

folder, out = Path(sys.argv[1]), Path(sys.argv[2])
files = sorted(p for p in folder.iterdir() if p.suffix.lower() in {".jpg", ".jpeg", ".png"})


def gps_decimal(gps: dict) -> str:
    try:
        def conv(v, ref):
            d, m, s = (float(x) for x in v)
            val = d + m / 60 + s / 3600
            return -val if ref in ("S", "W") else val
        return f"{conv(gps[2], gps[1]):.5f},{conv(gps[4], gps[3]):.5f}"
    except Exception:  # noqa: BLE001
        return ""


font = ImageFont.truetype("arialbd.ttf", 20)
thumbs = []
for p in files:
    im = Image.open(p)
    ex = im.getexif()
    tags = {ExifTags.TAGS.get(k, k): v for k, v in ex.items()}
    ifd = {ExifTags.TAGS.get(k, k): v for k, v in ex.get_ifd(0x8769).items()}
    gps = ex.get_ifd(0x8825)
    upright = ImageOps.exif_transpose(im)
    print(f"{p.name:16s} raw={im.width}x{im.height} upright={upright.width}x{upright.height} orient={tags.get('Orientation')} "
          f"date={ifd.get('DateTimeOriginal', '')} device={tags.get('Make', '')} {tags.get('Model', '')} gps={gps_decimal(gps)}")
    t = upright.convert("RGB")
    t.thumbnail((520, 520))
    thumbs.append((p.name, t))

cols = 3
cell = 540
rows = (len(thumbs) + cols - 1) // cols
sheet = Image.new("RGB", (cols * cell, rows * (cell + 30)), "white")
d = ImageDraw.Draw(sheet)
for i, (name, t) in enumerate(thumbs):
    x, y = (i % cols) * cell, (i // cols) * (cell + 30)
    sheet.paste(t, (x + (cell - t.width) // 2, y + (cell - t.height) // 2))
    d.text((x + 6, y + cell + 4), f"{i + 1:02d} {name}", fill="black", font=font)
sheet.save(out, quality=85)
print(out, sheet.size)
