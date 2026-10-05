"""Audit-only: fetch the public listing page + its photos to compare against ./assets (never used in production)."""
import json
import re
import urllib.request
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "tools" / "_audit" / "brokerage"
OUT.mkdir(parents=True, exist_ok=True)
URL = "https://iokuarealestate.com/properties/15-1077-amau-rd-keaau-hi-us-96749-733498"
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}


def get(url: str) -> bytes:
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60).read()


html = get(URL).decode("utf-8", "ignore")
(OUT / "page.html").write_text(html, encoding="utf-8")
urls = list(dict.fromkeys(re.findall(r"https://dlajgvw9htjpb\.cloudfront\.net/cms/[\w-]+/733498/-?\d+\.jpg", html)))
print("photo urls:", len(urls))
for kw in ("virtual", "tour", "youtube", "vimeo", "matterport", "iframe", ".mp4"):
    hits = sorted({m.group(0)[:200] for m in re.finditer(r"[^\"'\s<>]*" + re.escape(kw) + r"[^\"'\s<>]*", html, re.I)})
    print(kw, "->", [h for h in hits if "http" in h][:10])
(OUT / "urls.json").write_text(json.dumps(urls, indent=1))


def dhash(img, size=8):
    g = img.convert("L").resize((size + 1, size), Image.LANCZOS)
    px = list(g.getdata())
    bits = 0
    for r in range(size):
        for c in range(size):
            bits = (bits << 1) | (px[r * (size + 1) + c] > px[r * (size + 1) + c + 1])
    return bits


ours = {p.name: dhash(Image.open(p)) for p in sorted((ROOT / "assets" / "Photos").glob("*.jpg"))}
unmatched = []
for i, u in enumerate(urls, 1):
    f = OUT / f"b{i:02d}.jpg"
    if not f.exists():
        f.write_bytes(get(u))
    im = Image.open(f)
    h = dhash(im)
    best = min(ours.items(), key=lambda kv: bin(kv[1] ^ h).count("1"))
    dist = bin(best[1] ^ h).count("1")
    print(f"b{i:02d} {im.width}x{im.height} -> {best[0]} (d={dist})")
    if dist > 10:
        unmatched.append(f)

print("unmatched:", [f.name for f in unmatched])
if unmatched:
    font = ImageFont.truetype("arialbd.ttf", 22)
    tw, th, cols = 480, 320, 4
    rows = (len(unmatched) + cols - 1) // cols
    s = Image.new("RGB", (cols * tw, rows * (th + 30)), "white")
    d = ImageDraw.Draw(s)
    for i, f in enumerate(unmatched):
        im = Image.open(f).convert("RGB")
        im.thumbnail((tw, th))
        x, y = (i % cols) * tw, (i // cols) * (th + 30)
        s.paste(im, (x, y))
        d.text((x + 4, y + th + 2), f.name, fill="black", font=font)
    s.save(OUT.parent / "sheet_brokerage_unmatched.jpg", quality=85)
