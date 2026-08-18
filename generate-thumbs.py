#!/usr/bin/env python3
# Generate small grid thumbnails mirrored under thumbs/<floor>/<room>/<file>.
# Run after adding photos:  python3 generate-thumbs.py
import os
from PIL import Image, ImageOps

SRC = "photos"
OUT = "thumbs"
MAX = 400          # longest side, px
QUALITY = 72
EXTS = {".jpg", ".jpeg", ".png", ".webp", ".heic", ".gif"}

made = skipped = 0
for root, dirs, files in os.walk(SRC):
    for f in files:
        ext = os.path.splitext(f)[1].lower()
        if ext not in EXTS:
            continue
        src = os.path.join(root, f)
        rel = os.path.relpath(src, SRC)          # floor/room/file
        out = os.path.join(OUT, rel)
        os.makedirs(os.path.dirname(out), exist_ok=True)
        # skip if thumb is newer than source
        if os.path.exists(out) and os.path.getmtime(out) >= os.path.getmtime(src):
            skipped += 1
            continue
        try:
            im = Image.open(src)
            im = ImageOps.exif_transpose(im)      # respect orientation
            im.thumbnail((MAX, MAX), Image.LANCZOS)
            if im.mode in ("RGBA", "P"):
                im = im.convert("RGB")
            im.save(out, "JPEG", quality=QUALITY, optimize=True)
            made += 1
        except Exception as e:
            print(f"  ! {rel}: {e}")

print(f"✓ thumbnails: {made} generated, {skipped} up-to-date")
