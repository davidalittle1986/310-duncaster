# 3D viewer geometry tools (local only — not linked from the site)

`extract_plan.py` reads the architect's vector PDF (kept in iCloud `Arch Drawings/`, never committed)
and writes `data/floor-1.json` and `data/floor-2.json` for `viewer.html`.

```
python3 -m venv ~/duncaster-venv
~/duncaster-venv/bin/pip install pymupdf numpy scipy opencv-python-headless shapely
~/duncaster-venv/bin/python tools/extract_plan.py --debug /tmp/duncaster-debug
```

How it reads the plan (scale 1/4" = 1'-0", 18 PDF points per foot, both pages share one origin):
- 75% gray solid fill -> interior walls; 50% gray hatch -> exterior walls; black 1.42pt strips -> walls
- gaps between collinear wall pieces -> openings; thin parallel glass lines -> window, swing arcs -> door

Hand corrections live in `overrides.json` (all in viewer feet: x east, y south):
- `fixOpenings`: change/remove a detected opening by its midpoint (`type`, `sill`, `head`)
- `stairs`, `rails`, `voids`, `cabinets`, `finishes`, `extraSlabs` (veranda, porch), `start` (walk start)

Room names/positions come from `rooms.json` (copied from `js/config.js`); `frame` = fly-to extents.
`--debug` writes overlay PNGs of the extracted walls/openings on top of the drawing.
