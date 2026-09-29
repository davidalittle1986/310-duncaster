// 2D collision in plan feet: walls, cabinets, stairs, rails are polygons; you must stay on a slab.

function inPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function segDist(x, y, [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
  let t = L2 ? ((x - ax) * dx + (y - ay) * dy) / L2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
}
function edgeDist(x, y, poly) {
  let d = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) d = Math.min(d, segDist(x, y, poly[j], poly[i]));
  return d;
}

export function makeCollider({ obstacles, walkable, holes }, radius = 0.75) {
  function free(x, y, r = radius) {
    let onSlab = false;
    for (const p of walkable) if (inPoly(x, y, p)) { onSlab = true; break; }
    if (!onSlab) return false;
    for (const h of holes) if (inPoly(x, y, h) || edgeDist(x, y, h) < r * 0.7) return false;
    for (const o of obstacles) {
      const b = o.box;
      if (x < b.x0 - r || x > b.x1 + r || y < b.y0 - r || y > b.y1 + r) continue;
      if (inPoly(x, y, o.poly) || edgeDist(x, y, o.poly) < r) return false;
    }
    return true;
  }

  // Walk from a toward b; stop just before the first blocked point.
  function sweep(a, b) {
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.max(1, Math.ceil(d / 0.12));
    let last = a;
    for (let i = 1; i <= n; i++) {
      const p = [a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n];
      if (!free(p[0], p[1])) break;
      last = p;
    }
    return last;
  }

  // Nearest walkable spot to (x, y), searching outward in rings.
  function nearestFree(x, y, maxR = 14) {
    if (free(x, y)) return [x, y];
    for (let r = 0.25; r <= maxR; r += 0.25) {
      const n = Math.max(8, Math.round(r * 10));
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2, px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
        if (free(px, py)) return [px, py];
      }
    }
    return null;
  }

  return { free, sweep, nearestFree };
}
