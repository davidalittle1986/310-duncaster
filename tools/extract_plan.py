#!/usr/bin/env python3
"""
310 Duncaster - floor plan geometry extractor (local tool, not linked from the site).

Reads the architect's vector PDF (kept OUT of git, in iCloud "Arch Drawings/"),
extracts walls / openings / rooms, merges hand-edited overrides from
tools/overrides.json, and writes data/floor-1.json and data/floor-2.json (feet).

Walls are recognised from the drawing styles used by the architect's CAD export:
  - interior walls: 75% gray solid fill
  - exterior walls: 50% gray hatch (0.51pt) closed into a solid band
  - wall outlines: black 1.42pt strokes (thin enclosed strips become walls)
Scale: 1/4" = 1'-0"  ->  18 PDF points per foot.  Both pages share one origin.

Usage (needs: pip install pymupdf numpy scipy opencv-python-headless):
  python3 tools/extract_plan.py [--pdf PATH] [--debug DIR]
"""
import argparse, json, os, sys
import numpy as np, cv2, fitz
from scipy import ndimage as ndi

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
DEFAULT_PDF = os.path.expanduser(
    "~/Library/Mobile Documents/com~apple~CloudDocs/Claude/PROJECTS/"
    "310 Duncaster Website/Arch Drawings/Architectural Plans 8-20-25.pdf")

PAGES = {1: 1, 2: 2}                     # floor -> PDF page index
CROP = {1: (486.5, 128.5, 1333, 1457),   # x, y, w, h in PDF points
        2: (486.0, 289.5, 1192, 1313)}
PT_PER_FT = 18.0
R = 2                                    # raster px per PDF point
CEIL = {1: 12, 2: 11}
TMAX = 26 * R                            # max wall thickness (px)

def col(c): return tuple(round(v, 2) for v in c) if c else None

def subpaths(d, ox, oy):
    """Drawing -> list of int32 point arrays (3-bit fixed point, for cv2 shift=3)."""
    out, cur, last = [], [], None
    P = lambda p: (int(round((p.x - ox) * R * 8)), int(round((p.y - oy) * R * 8)))
    for it in d['items']:
        k = it[0]
        if k in ('re', 'qu'):
            if cur: out.append(cur); cur = []
            if k == 're': r = it[1]; pts = [r.tl, r.tr, r.br, r.bl]
            else: q = it[1]; pts = [q.ul, q.ur, q.lr, q.ll]
            out.append([P(p) for p in pts]); last = None; continue
        if k == 'l': pts = [it[1], it[2]]
        elif k == 'c':
            p0, p1, p2, p3 = it[1:5]; pts = []
            for t in np.linspace(0, 1, 9):
                m = 1 - t
                pts.append(fitz.Point(m**3*p0.x + 3*m*m*t*p1.x + 3*m*t*t*p2.x + t**3*p3.x,
                                      m**3*p0.y + 3*m*m*t*p1.y + 3*m*t*t*p2.y + t**3*p3.y))
        else: continue
        if last is None or abs(last.x - pts[0].x) > .01 or abs(last.y - pts[0].y) > .01:
            if cur: out.append(cur)
            cur = [P(pts[0])]
        cur += [P(p) for p in pts[1:]]; last = pts[-1]
    if cur: out.append(cur)
    return [np.array(s, np.int32) for s in out if len(s) >= 2]

def rasterize(page, floor):
    ox, oy, w, h = CROP[floor]; W, H = int(w * R), int(h * R)
    silver, hatch, outl, thin = (np.zeros((H, W), np.uint8) for _ in range(4))
    arcs = []
    for d in page.get_drawings():
        f, c, wd = col(d.get('fill')), col(d.get('color')), round(d.get('width') or 0, 2)
        sp = subpaths(d, ox, oy)
        if not sp: continue
        st = 's' in d['type']
        if f == (0.75, 0.75, 0.75) and 'f' in d['type']:
            cv2.fillPoly(silver, sp, 255, shift=3)
        if st and c == (0.5, 0.5, 0.5) and wd == 0.51:
            cv2.polylines(hatch, sp, False, 255, 1, shift=3)
        if st and c == (0, 0, 0) and wd == 1.42:
            cv2.polylines(outl, sp, bool(d.get('closePath')), 255, 2, shift=3)
        if st and c == (0, 0, 0) and wd in (0.51, 0.71, 0.87, 1.0):
            cv2.polylines(thin, sp, bool(d.get('closePath')), 255, 1, shift=3)
            for it in d['items']:
                if it[0] == 'c':
                    xs = [p.x for p in it[1:5]]; ys = [p.y for p in it[1:5]]
                    arcs.append(((min(xs)-ox)*R, (min(ys)-oy)*R, (max(xs)-ox)*R, (max(ys)-oy)*R))
    return silver > 0, hatch, outl, thin > 0, arcs

def wall_mask(silver, hatch, outl):
    hatchc = cv2.morphologyEx(hatch, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9))) > 0
    free = outl == 0
    lab, n = ndi.label(free)
    idx = np.arange(1, n + 1)
    mx = ndi.maximum(ndi.distance_transform_edt(free), lab, idx)
    sz = ndi.sum(free, lab, idx)
    ok = np.zeros(n + 1, bool); ok[1:] = (mx <= 9 * R) & (sz > 30)
    W = silver | hatchc | ok[lab]
    W = W | ((outl > 0) & ndi.binary_dilation(W, iterations=2))
    W = ndi.binary_closing(W, np.ones((3, 3)))
    W = ndi.binary_closing(W, np.ones((5, 5)))
    holes = ndi.binary_fill_holes(W) & ~W
    hl, hn = ndi.label(holes)
    small = np.zeros(hn + 1, bool); small[1:] = ndi.sum(holes, hl, np.arange(1, hn + 1)) < 400
    W = W | small[hl]
    return ndi.binary_opening(W, np.ones((5, 5)))

def run_lengths(a):
    out = np.zeros(a.shape, np.int32)
    for y in range(a.shape[0]):
        r = a[y]
        if not r.any(): continue
        d = np.diff(np.concatenate([[0], r.astype(np.int8), [0]]))
        for s, e in zip(np.where(d == 1)[0], np.where(d == -1)[0]): out[y, s:e] = e - s
    return out

def group_columns(mask):
    """Horizontal strips -> rects (x0,x1,y0,y1) by merging equal column runs."""
    H, W = mask.shape; open_, rects = {}, []
    for x in range(W + 1):
        colm = mask[:, x] if x < W else np.zeros(H, bool)
        d = np.diff(np.concatenate([[0], colm.astype(np.int8), [0]]))
        new, used = {}, set()
        for y0, y1 in zip(np.where(d == 1)[0], np.where(d == -1)[0]):
            key = next((k for k, v in open_.items() if k not in used and abs(v[0]-y0) <= 1 and abs(v[1]-y1) <= 1), None)
            if key is not None:
                v = open_[key]; v[3].append((y0, y1)); used.add(key); new[key] = v
            else:
                new[(x, y0)] = (y0, y1, x, [(y0, y1)])
        for k, v in open_.items():
            if k not in used:
                a = np.array(v[3]); rects.append((v[2], x, int(np.median(a[:, 0])), int(np.median(a[:, 1]))))
        open_ = new
    return rects

def decompose(W):
    hr = run_lengths(W); vr = run_lengths(W.T).T
    Hm = W & (vr <= hr) & (vr <= TMAX)
    Vm = W & (hr < vr) & (hr <= TMAX)
    rects = [('h',) + r for r in group_columns(Hm) if r[1]-r[0] >= 6 and r[3]-r[2] >= 6]
    rects += [('v', c, d, a, b) for (a, b, c, d) in group_columns(Vm.T) if b-a >= 6 and d-c >= 6]
    rm = np.zeros_like(W)
    for o, x0, x1, y0, y1 in rects: rm[y0:y1, x0:x1] = True
    rem = ndi.binary_opening(W & ~rm, np.ones((3, 3)))
    cnts, _ = cv2.findContours(rem.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    polys = [cv2.approxPolyDP(c, 1.0, True).reshape(-1, 2).tolist() for c in cnts if cv2.contourArea(c) >= 40]
    return rects, [p for p in polys if len(p) >= 3], rm | rem

def r_ok(r):
    t = r[3] - r[2]; L = r[1] - r[0]
    return t >= 4.5 * R and L >= 3 * R

def find_openings(rects, W, thin, arcs, polys=()):
    """Gaps between collinear wall strips of equal thickness -> candidate openings."""
    ops = []
    for p in polys:
        a = np.array(p); x0, y0 = a.min(0); x1, y1 = a.max(0)
        rects = list(rects) + [('h', int(x0), int(x1), int(y0), int(y1)), ('v', int(x0), int(x1), int(y0), int(y1))]
    for orient in ('h', 'v'):
        # work in "horizontal" frame: transpose vertical data
        def T(r):  # -> (x0,x1,y0,y1) along-axis x
            _, x0, x1, y0, y1 = r
            return (x0, x1, y0, y1) if orient == 'h' else (y0, y1, x0, x1)
        Wt = W if orient == 'h' else W.T
        Tt = thin if orient == 'h' else thin.T
        # ignore slivers: real walls are >= ~3in thick and at least that long
        same = [T(r) for r in rects if r[0] == orient and r_ok(T(r))]
        cross = [T(r) for r in rects if r[0] != orient and r_ok(T(r))]
        for A in same:
            best = None
            for B in same + cross:
                if B is A: continue
                is_cross = B in cross
                if is_cross:
                    if not (B[2] <= A[2] + 2 and B[3] >= A[3] - 2): continue
                else:
                    if min(A[3], B[3]) - max(A[2], B[2]) < 0.6 * min(A[3]-A[2], B[3]-B[2]): continue
                g = B[0] - A[1]
                if g < 1.4*PT_PER_FT*R or g > 22*PT_PER_FT*R: continue
                if best is None or g < best[1][0] - A[1]: best = (is_cross, B)
            if not best: continue
            B = best[1]
            if best[0]: y0, y1 = A[2], A[3]
            else: y0, y1 = max(A[2], B[2]), min(A[3], B[3])
            x0, x1 = A[1], B[0]
            if y1 - y0 < 4: continue
            if Wt[y0:y1, x0:x1].mean() > 0.08: continue
            # glass: rows where thin lines span >=80% of the gap
            band = ndi.binary_dilation(Tt[max(0, y0-1):y1+1, x0:x1], np.ones((3, 1)))
            full = band.mean(axis=1) >= 0.8
            nlines = int(ndi.label(full)[1])
            ops.append(dict(orient=orient, x0=x0, x1=x1, y0=y0, y1=y1, glassLines=nlines))
    # de-dupe (same gap found from both sides) and map back to image frame
    seen, out = set(), []
    for o in ops:
        key = (o['orient'], o['x0']//3, o['x1']//3, o['y0']//6)
        if key in seen: continue
        seen.add(key)
        if o['orient'] == 'h': box = (o['x0'], o['x1'], o['y0'], o['y1'])
        else: box = (o['y0'], o['y1'], o['x0'], o['x1'])
        bx0, bx1, by0, by1 = box
        L = (o['x1'] - o['x0'])
        ex = L + 6
        swing = any(not (a[2] < bx0 - (ex if o['orient'] == 'v' else 6) or a[0] > bx1 + (ex if o['orient'] == 'v' else 6) or
                         a[3] < by0 - (ex if o['orient'] == 'h' else 6) or a[1] > by1 + (ex if o['orient'] == 'h' else 6))
                    and max(a[2]-a[0], a[3]-a[1]) > L * 0.5 for a in arcs)
        out.append(dict(orient=o['orient'], box=box, glassLines=o['glassLines'], swing=swing))
    return out

def drop_strays(walls, slabs):
    """Remove tiny isolated slivers and anything lying outside the floor slabs."""
    from shapely.geometry import Polygon, box
    from shapely.ops import unary_union
    def geom(w):
        if 'polygon' in w: return Polygon(w['polygon']).buffer(0)
        (ax, ay), (bx, by), t = w['a'], w['b'], w['thickness']
        if abs(ay - by) < 1e-6: return box(min(ax, bx), ay - t/2, max(ax, bx), ay + t/2)
        return box(ax - t/2, min(ay, by), ax + t/2, max(ay, by))
    area = unary_union([Polygon(p).buffer(0) for p in slabs]).buffer(0.6)
    gs = [geom(w) for w in walls]
    keep = []
    for i, (w, g) in enumerate(zip(walls, gs)):
        if not g.intersects(area): continue
        minx, miny, maxx, maxy = g.bounds
        if max(maxx - minx, maxy - miny) < 1.5:
            near = g.buffer(0.15)
            if not any(j != i and near.intersects(h) for j, h in enumerate(gs)): continue
        keep.append(w)
    print(f"  dropped {len(walls) - len(keep)} stray wall pieces")
    return keep

def to_ft(px, py, origin):
    return [round(px / R / PT_PER_FT - origin[0], 2), round(py / R / PT_PER_FT - origin[1], 2)]

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--pdf', default=DEFAULT_PDF)
    ap.add_argument('--debug', default=None)
    args = ap.parse_args()
    ov = json.load(open(os.path.join(HERE, 'overrides.json')))
    cfg = json.load(open(os.path.join(HERE, 'rooms.json')))
    doc = fitz.open(args.pdf)
    # common origin (feet, in page coords) so both floors stack
    origin = ov['originFt']
    for floor in (1, 2):
        ox, oy, cw, ch = CROP[floor]
        # page-feet offset of this crop relative to the shared origin
        off = (ox / PT_PER_FT, oy / PT_PER_FT)
        o2 = (origin[0] - off[0], origin[1] - off[1])
        silver, hatch, outl, thin, arcs = rasterize(doc[PAGES[floor]], floor)
        W = wall_mask(silver, hatch, outl)
        rects, polys, Wd = decompose(W)
        ops = find_openings(rects, W, thin, arcs, polys)
        fov = ov['floors'][str(floor)]
        def ft2px(pt): return ((pt[0] + o2[0]) * PT_PER_FT * R, (pt[1] + o2[1]) * PT_PER_FT * R)
        for m in fov.get('addOpenings', []):
            (ax, ay), (bx, by) = ft2px(m['a']), ft2px(m['b']); t = m['thickness'] * PT_PER_FT * R / 2
            if abs(ay - by) < abs(ax - bx):
                box = (int(min(ax, bx)), int(max(ax, bx)), int(ay - t), int(ay + t)); orient = 'h'
            else:
                box = (int(ax - t), int(ax + t), int(min(ay, by)), int(max(ay, by))); orient = 'v'
            ops.append(dict(orient=orient, box=box, glassLines=0, swing=False, manual=m))
        # footprint: close every opening, flood outside
        closed = W | Wd
        for o in ops:
            x0, x1, y0, y1 = o['box']; closed[y0:y1, x0:x1] = True
        closed = ndi.binary_closing(closed, np.ones((3, 3)), iterations=2)
        outside = ~ndi.binary_fill_holes(closed)
        lab_free, _ = ndi.label(~closed)
        # classify openings
        out_ops = []
        H, Wimg = W.shape
        for i, o in enumerate(ops):
            x0, x1, y0, y1 = o['box']; cxp, cyp = (x0+x1)//2, (y0+y1)//2
            d = 40
            if o['orient'] == 'h': s1, s2 = (cxp, max(0, y0-d)), (cxp, min(H-1, y1+d))
            else: s1, s2 = (max(0, x0-d), cyp), (min(Wimg-1, x1+d), cyp)
            ext = bool(outside[s1[1], s1[0]] or outside[s2[1], s2[0]])
            o['ext'] = ext
            wft = (x1-x0)/R/PT_PER_FT if o['orient'] == 'h' else (y1-y0)/R/PT_PER_FT
            if o['glassLines'] >= 2 and not o['swing']: typ = 'window'
            elif not ext and wft > 6.5 and o['glassLines'] < 2: typ = 'open'
            else: typ = 'door'
            if o['orient'] == 'h': a, b, t = to_ft(x0, (y0+y1)/2, o2), to_ft(x1, (y0+y1)/2, o2), (y1-y0)/R/PT_PER_FT
            else: a, b, t = to_ft((x0+x1)/2, y0, o2), to_ft((x0+x1)/2, y1, o2), (x1-x0)/R/PT_PER_FT
            op = dict(id=f"o{i+1}", type=typ, a=a, b=b, thickness=round(t, 2), exterior=ext)
            if 'manual' in o:
                op.update({k: v for k, v in o['manual'].items()}); op['id'] = o['manual'].get('id', f"m{i+1}")
            out_ops.append(op)
        # de-duplicate parallel overlapping detections (keep glass / thicker one)
        def mid(o): return ((o['a'][0] + o['b'][0]) / 2, (o['a'][1] + o['b'][1]) / 2)
        def horiz(o): return abs(o['a'][1] - o['b'][1]) < abs(o['a'][0] - o['b'][0])
        def span(o): k = 0 if horiz(o) else 1; return sorted([o['a'][k], o['b'][k]])
        rank = {'window': 2, 'door': 1, 'open': 0}
        keep = []
        for o in sorted(out_ops, key=lambda o: (-rank[o['type']], -o['thickness'])):
            dup = False
            for k in keep:
                if horiz(o) != horiz(k): continue
                s1, s2 = span(o), span(k)
                ov_ = min(s1[1], s2[1]) - max(s1[0], s2[0])
                perp = abs(mid(o)[1] - mid(k)[1]) if horiz(o) else abs(mid(o)[0] - mid(k)[0])
                if ov_ > 0.5 * min(s1[1] - s1[0], s2[1] - s2[0]) and perp < 2.5: dup = True; break
            if not dup: keep.append(o)
        out_ops = keep
        # hand corrections, matched by location so they survive re-runs
        for fix in fov.get('fixOpenings', []):
            hit = [o for o in out_ops if abs(mid(o)[0] - fix['at'][0]) < 1.0 and abs(mid(o)[1] - fix['at'][1]) < 1.0]
            if not hit: print(f"  (fix at {fix['at']} matched nothing)")
            for o in hit: o.update({k: v for k, v in fix.items() if k != 'at'})
        out_ops = [o for o in out_ops if o['type'] not in ('remove', 'open')]
        for i, o in enumerate(sorted(out_ops, key=lambda o: (round(mid(o)[1]), mid(o)[0]))): o['id'] = f"o{i+1}"
        
        dflt = fov['defaults']
        for op in out_ops:
            if op['type'] == 'window':
                op.setdefault('sill', dflt['windowSill']); op.setdefault('head', dflt['windowHead'])
            elif op['type'] == 'door':
                op.setdefault('sill', 0); op.setdefault('head', dflt['doorHead'])
            else:
                op.setdefault('sill', 0); op.setdefault('head', CEIL[floor])
        # snap wall faces to a 1-inch grid so neighbouring pieces line up cleanly
        snap = lambda v: round(round(v * 12) / 12, 3)
        walls = []
        for i, (o, x0, x1, y0, y1) in enumerate(rects):
            fx0, fy0 = to_ft(x0, y0, o2); fx1, fy1 = to_ft(x1, y1, o2)
            fx0, fx1, fy0, fy1 = snap(fx0), snap(fx1), snap(fy0), snap(fy1)
            if fx1 - fx0 < 0.04 or fy1 - fy0 < 0.04: continue
            if o == 'h': a, b, t = [fx0, round((fy0+fy1)/2, 3)], [fx1, round((fy0+fy1)/2, 3)], fy1 - fy0
            else: a, b, t = [round((fx0+fx1)/2, 3), fy0], [round((fx0+fx1)/2, 3), fy1], fx1 - fx0
            walls.append(dict(id=f"w{i+1}", a=a, b=b, thickness=round(t, 3)))
        for j, p in enumerate(polys):
            walls.append(dict(id=f"p{j+1}", polygon=[[snap(v) for v in to_ft(x, y, o2)] for x, y in p]))
        # rooms: names/positions from the app's hotspots; extents from hand-set frames
        rooms = []
        for r in cfg[str(floor)]:
            px = int((r['x'] / 1000) * cw * R); py = int((r['y'] / 1000) * ch * R)
            if closed[py, px]:  # hotspot sits on a wall: nudge to nearest open spot
                ys, xs = np.where(~closed[max(0, py-40):py+40, max(0, px-40):px+40])
                k = np.argmin((ys-40)**2 + (xs-40)**2); py, px = py-40+ys[k], px-40+xs[k]
            x0, y0, x1, y1 = r['frame']
            rooms.append(dict(id=r['id'], name=r['label'], polygon=[[x0, y0], [x1, y0], [x1, y1], [x0, y1]],
                              labelAt=to_ft(px, py, o2), areaFt=round((x1-x0)*(y1-y0))))
        if args.debug:
            report_leaks(closed, rooms, o2, floor)
            viz = np.zeros(closed.shape + (3,), np.uint8); viz[closed] = (0, 0, 255)
            ids = {}
            for rm in rooms:
                x, y = rm['labelAt']; l = lab_free[int((y + o2[1]) * PT_PER_FT * R), int((x + o2[0]) * PT_PER_FT * R)]
                ids.setdefault(l, tuple(int(v) for v in np.random.default_rng(int(l)).integers(60, 255, 3)))
            for l, c in ids.items(): viz[lab_free == l] = c
            cv2.imwrite(os.path.join(args.debug, f'free_floor{floor}.png'), cv2.resize(viz, None, fx=0.3, fy=0.3, interpolation=cv2.INTER_NEAREST))
        # footprint polygon(s) for the floor slab
        fp = ~outside
        cnts, _ = cv2.findContours(fp.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        slabs = [[to_ft(x, y, o2) for x, y in cv2.approxPolyDP(c, 2.0, True).reshape(-1, 2)]
                 for c in cnts if cv2.contourArea(c) > (R*PT_PER_FT*4)**2]
        walls = drop_strays(walls, slabs + fov.get('extraSlabs', []))
        data = dict(floor=floor, ceilingHeight=CEIL[floor], units='ft',
                    source=dict(pdf=os.path.basename(args.pdf), page=PAGES[floor]+1, scale='1/4in=1ft',
                                originFt=origin, note='generated by tools/extract_plan.py; edit tools/overrides.json'),
                    walls=walls, openings=out_ops, rooms=rooms,
                    slabs=slabs, extraSlabs=fov.get('extraSlabs', []), finishes=fov.get('finishes', []),
                    stairs=fov.get('stairs', []), rails=fov.get('rails', []),
                    cabinets=fov.get('cabinets', []), voids=fov.get('voids', []),
                    start=fov.get('start'))
        os.makedirs(os.path.join(REPO, 'data'), exist_ok=True)
        with open(os.path.join(REPO, 'data', f'floor-{floor}.json'), 'w') as f:
            json.dump(data, f, separators=(',', ':'))
        print(f"floor {floor}: {len(walls)} walls, {len(out_ops)} openings "
              f"({sum(o['type']=='window' for o in out_ops)} windows), {len(rooms)} rooms, {len(slabs)} slabs")
        if args.debug:
            debug_overlay(doc[PAGES[floor]], floor, rects, polys, ops, out_ops, rooms, o2, args.debug, lab_free)

def report_leaks(closed, rooms, o2, floor):
    free = ~closed
    free[0, :] = free[-1, :] = free[:, 0] = free[:, -1] = True
    dist = ndi.distance_transform_edt(free)
    border = np.zeros_like(free); border[0, :] = border[-1, :] = border[:, 0] = border[:, -1] = True
    for rm in rooms:
        x, y = rm['labelAt']; px, py = int((x + o2[0]) * PT_PER_FT * R), int((y + o2[1]) * PT_PER_FT * R)
        def conn(r):
            lab, _ = ndi.label(dist > r)
            l = lab[py, px]
            return l != 0 and (lab[border] == l).any(), lab
        c, _ = conn(0.5)
        if not c: continue
        lo, hi = 0.5, 400.0
        while hi - lo > 0.5:
            m = (lo + hi) / 2
            if conn(m)[0]: lo = m
            else: hi = m
        _, lab = conn(hi)
        A = ndi.binary_dilation(lab == lab[py, px], iterations=3)
        Bl = set(np.unique(lab[border])) - {0}
        B = ndi.binary_dilation(np.isin(lab, list(Bl)), iterations=3)
        cand = np.where(A & B & (dist > lo - 1))
        if len(cand[0]):
            yy, xx = int(np.median(cand[0])), int(np.median(cand[1]))
            print(f"  LEAK floor {floor} room {rm['id']}: gap ~{2*lo/R/PT_PER_FT:.1f}ft at "
                  f"({xx/R/PT_PER_FT - o2[0]:.1f}, {yy/R/PT_PER_FT - o2[1]:.1f})")

def debug_overlay(page, floor, rects, polys, ops, out_ops, rooms, o2, outdir, lab_free):
    ox, oy, cw, ch = CROP[floor]
    pix = page.get_pixmap(matrix=fitz.Matrix(R, R), clip=fitz.Rect(ox, oy, ox+cw, oy+ch))
    img = np.frombuffer(pix.samples, np.uint8).reshape(pix.h, pix.w, pix.n)[:, :, :3]
    img = cv2.cvtColor(img, cv2.COLOR_RGB2BGR)
    img = (img * 0.45 + 140).astype(np.uint8)
    rng = np.random.default_rng(3)
    lay = img.copy()
    for rm in rooms:
        pts = np.array([[(x + o2[0]) * PT_PER_FT * R, (y + o2[1]) * PT_PER_FT * R] for x, y in rm['polygon']], np.int32)
        cv2.fillPoly(lay, [pts], tuple(int(v) for v in rng.integers(120, 255, 3)))
    img = cv2.addWeighted(lay, 0.35, img, 0.65, 0)
    H, Wi = img.shape[:2]
    for k in range(-80, 81):
        gx = int((k + o2[0]) * PT_PER_FT * R); gy = int((k + o2[1]) * PT_PER_FT * R)
        c = (90, 90, 90) if k % 5 == 0 else (200, 200, 200); w = 2 if k % 5 == 0 else 1
        if 0 <= gx < Wi: cv2.line(img, (gx, 0), (gx, H), c, w)
        if 0 <= gy < H: cv2.line(img, (0, gy), (Wi, gy), c, w)
        if k % 5 == 0:
            if 0 <= gx < Wi: cv2.putText(img, str(k), (gx + 3, 40), cv2.FONT_HERSHEY_SIMPLEX, 1.4, (0, 0, 0), 3)
            if 0 <= gy < H: cv2.putText(img, str(k), (5, gy - 5), cv2.FONT_HERSHEY_SIMPLEX, 1.4, (0, 0, 0), 3)
    for o, x0, x1, y0, y1 in rects: cv2.rectangle(img, (x0, y0), (x1-1, y1-1), (0, 0, 210), -1)
    for p in polys: cv2.fillPoly(img, [np.array(p, np.int32)], (200, 0, 200))
    colors = dict(window=(230, 170, 0), door=(0, 170, 0), open=(0, 200, 230))
    for o, oo in zip(ops, out_ops + [None]*len(ops)):
        pass
    for op in out_ops:
        a = [(op['a'][0] + o2[0]) * PT_PER_FT * R, (op['a'][1] + o2[1]) * PT_PER_FT * R]
        b = [(op['b'][0] + o2[0]) * PT_PER_FT * R, (op['b'][1] + o2[1]) * PT_PER_FT * R]
        t = op['thickness'] * PT_PER_FT * R / 2
        x0, x1 = sorted([a[0], b[0]]); y0, y1 = sorted([a[1], b[1]])
        if abs(a[1]-b[1]) < 1: y0 -= t; y1 += t
        else: x0 -= t; x1 += t
        cv2.rectangle(img, (int(x0), int(y0)), (int(x1), int(y1)), colors.get(op['type'], (0, 0, 0)), -1)
        cv2.putText(img, op['id'], (int(x0), int(y0) - 3), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0, 0, 0), 2)
    for rm in rooms:
        x, y = rm['labelAt']; p = (int((x + o2[0]) * PT_PER_FT * R), int((y + o2[1]) * PT_PER_FT * R))
        cv2.circle(img, p, 8, (0, 0, 0), -1)
        cv2.putText(img, f"{rm['name']} {rm['areaFt']}", (p[0] + 10, p[1]), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (120, 0, 0), 2)
    os.makedirs(outdir, exist_ok=True)
    cv2.imwrite(os.path.join(outdir, f'debug_floor{floor}.png'), img)
    cv2.imwrite(os.path.join(outdir, f'debug_floor{floor}_small.png'), cv2.resize(img, None, fx=0.4, fy=0.4, interpolation=cv2.INTER_AREA))

if __name__ == '__main__':
    main()
