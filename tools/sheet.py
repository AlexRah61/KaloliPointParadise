"""Compose labeled review sheets from image files: python tools/sheet.py out.jpg cols width file1 file2 ..."""
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

out, cols, tw, *files = sys.argv[1:]
cols, tw = int(cols), int(tw)
ims = [Image.open(f).convert("RGB") for f in files]
th = max(int(tw * im.height / im.width) for im in ims)
font = ImageFont.truetype("arialbd.ttf", max(14, tw // 40))
rows = (len(ims) + cols - 1) // cols
sheet = Image.new("RGB", (cols * tw, rows * (th + 30)), "white")
d = ImageDraw.Draw(sheet)
for i, (im, f) in enumerate(zip(ims, files)):
    im.thumbnail((tw, th))
    x, y = (i % cols) * tw, (i // cols) * (th + 30)
    sheet.paste(im, (x, y))
    d.text((x + 4, y + th + 4), Path(f).stem, fill="black", font=font)
sheet.save(out, quality=88)
print(out, sheet.size)
