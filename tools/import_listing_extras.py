"""Copy the three owner-approved listing photos (sunset/night) out of the audit cache into assets-listing/ with provenance."""
import json
import shutil
from pathlib import Path

from PIL import ExifTags, Image

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "tools" / "_audit" / "brokerage"
DST = ROOT / "assets-listing"
DST.mkdir(exist_ok=True)
urls = json.loads((SRC / "urls.json").read_text())

picks = {28: "listing-sunset-yard.jpg", 29: "listing-sunset-house.jpg", 30: "listing-night-sky.jpg"}
provenance = []
for idx, name in picks.items():
    src = SRC / f"b{idx:02d}.jpg"
    shutil.copy2(src, DST / name)
    with Image.open(src) as im:
        ex = im.getexif()
        merged = {ExifTags.TAGS.get(k, k): v for k, v in ex.items()}
        merged.update({ExifTags.TAGS.get(k, k): v for k, v in ex.get_ifd(0x8769).items()})
        provenance.append({
            "file": name,
            "source_url": urls[idx - 1],
            "width": im.width,
            "height": im.height,
            "orientation": merged.get("Orientation"),
            "device": f"{merged.get('Make', '')} {merged.get('Model', '')}".strip() or None,
            "captured": str(merged.get("DateTimeOriginal", "")) or None,
        })
(DST / "provenance.json").write_text(json.dumps(provenance, indent=2))
print(json.dumps(provenance, indent=2))
