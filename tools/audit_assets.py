"""Read-only audit of the original media library in ./assets (never modifies originals)."""
import hashlib
import json
import sys
from pathlib import Path

from PIL import Image, ExifTags, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets"
OUT = ROOT / "tools" / "_audit"
OUT.mkdir(parents=True, exist_ok=True)

EXIF_TAGS = {v: k for k, v in ExifTags.TAGS.items()}


def dhash(img: Image.Image, size: int = 8) -> int:
    g = img.convert("L").resize((size + 1, size), Image.LANCZOS)
    px = list(g.getdata())
    bits = 0
    for r in range(size):
        for c in range(size):
            bits = (bits << 1) | (px[r * (size + 1) + c] > px[r * (size + 1) + c + 1])
    return bits


def exif_fields(img: Image.Image) -> dict:
    out = {}
    try:
        ex = img.getexif()
        ifd = ex.get_ifd(0x8769)
        merged = {**{ExifTags.TAGS.get(k, k): v for k, v in ex.items()},
                  **{ExifTags.TAGS.get(k, k): v for k, v in ifd.items()}}
        for key in ("Make", "Model", "DateTimeOriginal", "FocalLength", "LensModel", "Orientation"):
            if key in merged:
                v = merged[key]
                out[key] = float(v) if key == "FocalLength" else str(v).strip()
    except Exception as e:  # noqa: BLE001
        out["exif_error"] = str(e)
    return out


rows = []
for p in sorted(ASSETS.rglob("*")):
    if not p.is_file():
        continue
    rel = p.relative_to(ROOT).as_posix()
    row = {"path": rel, "bytes": p.stat().st_size, "sha256": hashlib.sha256(p.read_bytes()).hexdigest()}
    if p.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp"}:
        with Image.open(p) as im:
            row.update(width=im.width, height=im.height, mode=im.mode,
                       aspect=round(im.width / im.height, 4), dhash=f"{dhash(im):016x}", **exif_fields(im))
    rows.append(row)

# near-duplicate detection on dhash hamming distance
imgs = [r for r in rows if "dhash" in r]
near = []
for i in range(len(imgs)):
    for j in range(i + 1, len(imgs)):
        d = bin(int(imgs[i]["dhash"], 16) ^ int(imgs[j]["dhash"], 16)).count("1")
        if d <= 10:
            near.append((imgs[i]["path"], imgs[j]["path"], d))
exact = {}
for r in rows:
    exact.setdefault(r["sha256"], []).append(r["path"])

(OUT / "assets.json").write_text(json.dumps({"files": rows, "near_duplicates": near,
                                             "exact_duplicates": [v for v in exact.values() if len(v) > 1]},
                                            indent=2), encoding="utf-8")

for r in rows:
    dims = f"{r.get('width','')}x{r.get('height','')}" if "width" in r else ""
    print(f"{r['path']:<95} {r['bytes']/1e6:7.2f}MB {dims:>11} {r.get('aspect','')!s:>7} "
          f"{r.get('Model','')!s:<14} {r.get('DateTimeOriginal','')!s:<20} f={r.get('FocalLength','')}")
print("near-duplicates:", near)
print("exact duplicates:", [v for v in exact.values() if len(v) > 1])


def contact_sheet(paths, name, cols=4, tw=480):
    font = ImageFont.truetype("arialbd.ttf", 22) if sys.platform == "win32" else ImageFont.load_default()
    th = int(tw * 2 / 3)
    rows_n = (len(paths) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * tw, rows_n * (th + 34)), "white")
    d = ImageDraw.Draw(sheet)
    for i, p in enumerate(paths):
        with Image.open(p) as im:
            im = im.convert("RGB")
            im.thumbnail((tw, th))
            x, y = (i % cols) * tw, (i // cols) * (th + 34)
            sheet.paste(im, (x + (tw - im.width) // 2, y + (th - im.height) // 2))
            d.text((x + 6, y + th + 4), f"{i+1:02d} {Path(p).stem}", fill="black", font=font)
    sheet.save(OUT / name, quality=85)


photos = sorted((ASSETS / "Photos").glob("*.jpg"))
contact_sheet(photos[:12], "sheet_photos_1.jpg")
contact_sheet(photos[12:24], "sheet_photos_2.jpg")
contact_sheet(photos[24:], "sheet_photos_3.jpg")
plans = sorted((ASSETS / "Floor Plan Without Dimensions").glob("*.jpg")) + sorted((ASSETS / "Floor Plan With Dimensions").glob("*.jpg"))
contact_sheet(plans, "sheet_plans.jpg", cols=4, tw=600)
