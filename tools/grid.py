"""Draw a labeled 10% grid over an image to locate features: python tools/grid.py in.jpg out.jpg [width]"""
import sys

from PIL import Image, ImageDraw, ImageFont

src, out = sys.argv[1], sys.argv[2]
w = int(sys.argv[3]) if len(sys.argv) > 3 else 1400
im = Image.open(src).convert("RGB")
im = im.resize((w, round(im.height * w / im.width)), Image.LANCZOS)
d = ImageDraw.Draw(im)
font = ImageFont.truetype("arial.ttf", 16)
for i in range(1, 10):
    x, y = im.width * i // 10, im.height * i // 10
    d.line([(x, 0), (x, im.height)], fill=(255, 0, 0), width=1)
    d.line([(0, y), (im.width, y)], fill=(255, 0, 0), width=1)
    d.text((x + 3, 3), f"{i*10}", fill=(255, 255, 0), font=font)
    d.text((3, y + 3), f"{i*10}", fill=(255, 255, 0), font=font)
im.save(out, quality=88)
print(out, im.size)
