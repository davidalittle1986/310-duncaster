// Turns a floor JSON (feet; x east, y south) into Three.js meshes + 2D collision data.
// Plan (x, y) maps to world (x, 0, y). Each floor is built with its own floor at y = 0.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { COLORS, finishMaterial } from './materials.js';

const INFLATE = 0.03;      // tiny overlap so neighbouring wall pieces never show a seam
const SLAB = 0.8;          // visible slab thickness under the floor

// ── geometry helpers ─────────────────────────────────────────
function shapeFrom(poly) {
  const s = new THREE.Shape();
  poly.forEach(([x, y], i) => (i ? s.lineTo(x, -y) : s.moveTo(x, -y)));
  s.closePath();
  return s;
}
function pathFrom(poly) {
  const p = new THREE.Path();
  poly.forEach(([x, y], i) => (i ? p.lineTo(x, -y) : p.moveTo(x, -y)));
  p.closePath();
  return p;
}
// vertical prism from a plan polygon, from y0 to y1
function prism(poly, y0, y1) {
  const g = new THREE.ExtrudeGeometry(shapeFrom(poly), { depth: y1 - y0, bevelEnabled: false });
  g.rotateX(-Math.PI / 2);
  g.translate(0, y0, 0);
  return g.index ? g.toNonIndexed() : g;
}
// axis-aligned (or any) segment a-b with thickness t, from y0 to y1
function beam(a, b, t, y0, y1, inflate = INFLATE) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) + inflate * 2;
  const g = new THREE.BoxGeometry(len, y1 - y0, t + inflate * 2).toNonIndexed();
  g.rotateY(-Math.atan2(dy, dx));
  g.translate((a[0] + b[0]) / 2, (y0 + y1) / 2, (a[1] + b[1]) / 2);
  return g;
}
function paint(g, side, top) {
  const n = g.attributes.normal, cols = new Float32Array(n.count * 3);
  for (let i = 0; i < n.count; i++) {
    const c = n.getY(i) > 0.5 ? top : side;
    cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  return g;
}
function stripToPosNormal(g) {
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'color'].includes(k)) g.deleteAttribute(k);
  g.clearGroups();
  return g;
}
function merged(list) {
  if (!list.length) return null;
  return mergeGeometries(list.map(stripToPosNormal), false);
}
// rectangle polygon (for collision) around segment a-b with thickness t
function segRect(a, b, t) {
  const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1;
  const nx = -dy / L * t / 2, ny = dx / L * t / 2;
  return [[a[0] + nx, a[1] + ny], [b[0] + nx, b[1] + ny], [b[0] - nx, b[1] - ny], [a[0] - nx, a[1] - ny]];
}
function bboxOf(poly) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of poly) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return { x0, y0, x1, y1 };
}

// ── main builder ─────────────────────────────────────────────
export function buildFloor(data, M) {
  const H = data.ceilingHeight;
  const group = new THREE.Group();
  const headers = new THREE.Group();          // hidden in Plan mode so doorways read as gaps
  const labels = new THREE.Group();            // Plan-mode room labels
  const floors = [];                           // raycast targets for tap-to-walk
  const solids = [];                           // raycast blockers (walls, cabinets)
  const obstacles = [];                        // 2D polygons you can't walk through
  const walkable = [];                         // slab polygons you can walk on
  const holes = [];                            // voids (stair opening) — not walkable

  // Walls
  const wallGeos = [];
  for (const w of data.walls) {
    if (w.polygon) {
      wallGeos.push(paint(prism(w.polygon, 0, H), COLORS.wall, COLORS.wallTop));
      obstacles.push(w.polygon);
    } else {
      wallGeos.push(paint(beam(w.a, w.b, w.thickness, 0, H), COLORS.wall, COLORS.wallTop));
      obstacles.push(segRect(w.a, w.b, w.thickness));
    }
  }

  // Openings: doors = open doorway + header; windows = sill + glass + frame + header
  const headGeos = [], frameGeos = [], glassGeos = [];
  for (const o of data.openings) {
    const t = o.thickness;
    const head = Math.min(o.head ?? 8, H);
    if (head < H - 0.01) headGeos.push(paint(beam(o.a, o.b, t, head, H), COLORS.wall, COLORS.wallTop));
    if (o.type === 'window') {
      const sill = Math.max(0, o.sill ?? 3);
      if (sill > 0.01) wallGeos.push(paint(beam(o.a, o.b, t, 0, sill), COLORS.wall, COLORS.wall));
      obstacles.push(segRect(o.a, o.b, t));
      const L = Math.hypot(o.b[0] - o.a[0], o.b[1] - o.a[1]);
      const ux = (o.b[0] - o.a[0]) / L, uy = (o.b[1] - o.a[1]) / L;
      const P = s => [o.a[0] + ux * s, o.a[1] + uy * s];
      const f = 0.12, d = Math.min(0.3, t * 0.6);
      glassGeos.push(beam(o.a, o.b, 0.04, sill, head, 0));
      frameGeos.push(beam(o.a, o.b, d, head - f, head, 0), beam(o.a, o.b, d, sill, sill + f, 0));
      const panes = Math.max(1, Math.round(L / 3.2));
      for (let i = 0; i <= panes; i++) {
        const s = Math.min(Math.max(i * L / panes, f / 2), L - f / 2);
        frameGeos.push(beam(P(s - f / 2), P(s + f / 2), d, sill, head, 0));
      }
    }
  }
  const wallMesh = new THREE.Mesh(merged(wallGeos), M.wall);
  group.add(wallMesh); solids.push(wallMesh);
  const hg = merged(headGeos);
  if (hg) { const m = new THREE.Mesh(hg, M.wall); headers.add(m); solids.push(m); }
  const fg = merged(frameGeos); if (fg) group.add(new THREE.Mesh(fg, M.frame));
  const gg = merged(glassGeos);
  if (gg) { const m = new THREE.Mesh(gg, M.glass); m.renderOrder = 2; group.add(m); }
  group.add(headers);

  // Floor slabs (main footprint gets the void cut out)
  const voids = data.voids || [];
  for (const v of voids) holes.push(v.polygon);
  const slabList = [...data.slabs.map((p, i) => ({ polygon: p, finish: 'oak', main: i === 0 }))];
  for (const p of data.extraSlabs || []) slabList.push({ polygon: p, finish: 'tile' });
  for (const s of slabList) {
    const shape = shapeFrom(s.polygon);
    if (s.main) for (const v of voids) shape.holes.push(pathFrom(v.polygon));
    const g = new THREE.ExtrudeGeometry(shape, { depth: SLAB, bevelEnabled: false });
    g.rotateX(-Math.PI / 2); g.translate(0, -SLAB, 0);
    const mesh = new THREE.Mesh(g, [s.finish === 'oak' ? M.floor : finishMaterial(M, s.finish), M.slabSide]);
    group.add(mesh); floors.push(mesh);
    walkable.push(s.polygon);
  }
  // Ceiling (shown in Walk mode only; the dollhouse views stay open-topped)
  const ceiling = new THREE.Group();
  for (const s of slabList.filter(s => s.finish === 'oak')) {
    const g = new THREE.ShapeGeometry(shapeFrom(s.polygon));
    g.rotateX(-Math.PI / 2); g.translate(0, H, 0);
    ceiling.add(new THREE.Mesh(g, M.ceiling));
  }
  ceiling.visible = false;
  group.add(ceiling);
  for (const z of data.finishes || []) {
    const g = new THREE.ShapeGeometry(shapeFrom(z.polygon));
    g.rotateX(-Math.PI / 2); g.translate(0, 0.005, 0);
    const mesh = new THREE.Mesh(g, finishMaterial(M, z.material));
    group.add(mesh); floors.push(mesh);
  }
  for (const v of voids) {                     // dark floor of the stair opening, just above the ground
    const g = new THREE.ShapeGeometry(shapeFrom(v.polygon));
    g.rotateX(-Math.PI / 2); g.translate(0, -(v.depth || 0.78), 0);
    group.add(new THREE.Mesh(g, M.voidWell));
  }

  // Cabinets (simple white boxes)
  const cabGeos = [];
  for (const c of data.cabinets || []) {
    cabGeos.push(paint(prism(c.polygon, 0, c.height || 3), COLORS.cabinet, COLORS.cabTop));
    obstacles.push(c.polygon);
  }
  const cg = merged(cabGeos);
  if (cg) { const m = new THREE.Mesh(cg, M.cabinet); group.add(m); solids.push(m); }

  // Stairs: treads per run (floating so the space under the run stays visible)
  const stairGeos = [];
  for (const s of data.stairs || []) {
    const b = bboxOf(s.polygon), n = s.steps || 1;
    const clip = s.clipBelow ?? -Infinity;
    for (let i = 0; i < n; i++) {
      const h = n === 1 ? s.to : s.from + (i + 1) * (s.to - s.from) / n;
      if (h > H + 0.01 || h <= clip) continue;
      let x0 = b.x0, x1 = b.x1, y0 = b.y0, y1 = b.y1;
      const k0 = i / n, k1 = (i + 1) / n;
      if (s.dir === 'n') { y1 = b.y1 - (b.y1 - b.y0) * k0; y0 = b.y1 - (b.y1 - b.y0) * k1; }
      if (s.dir === 's') { y0 = b.y0 + (b.y1 - b.y0) * k0; y1 = b.y0 + (b.y1 - b.y0) * k1; }
      if (s.dir === 'w') { x1 = b.x1 - (b.x1 - b.x0) * k0; x0 = b.x1 - (b.x1 - b.x0) * k1; }
      if (s.dir === 'e') { x0 = b.x0 + (b.x1 - b.x0) * k0; x1 = b.x0 + (b.x1 - b.x0) * k1; }
      const bottom = s.from <= 0.01 && s.from >= 0 ? 0 : Math.max(clip, h - 0.6);
      stairGeos.push(prism([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], bottom, h));
    }
    if (s.from >= 0) obstacles.push(s.polygon);
  }
  const sg = merged(stairGeos); if (sg) group.add(new THREE.Mesh(sg, M.stair));

  // Guard rails: glass panel + dark top rail
  const railGeos = [], railGlass = [];
  for (const r of data.rails || []) {
    const h = r.height || 3.5;
    for (let i = 0; i < r.path.length - 1; i++) {
      const a = r.path[i], b = r.path[i + 1];
      railGeos.push(beam(a, b, 0.16, h - 0.12, h, 0.08));
      railGlass.push(beam(a, b, 0.04, 0.1, h - 0.12, 0));
      obstacles.push(segRect(a, b, 0.3));
    }
  }
  const rg = merged(railGeos); if (rg) group.add(new THREE.Mesh(rg, M.rail));
  const rgg = merged(railGlass); if (rgg) { const m = new THREE.Mesh(rgg, M.glass); m.renderOrder = 2; group.add(m); }

  // Room labels
  for (const room of data.rooms) {
    const el = document.createElement('div');
    el.className = 'room-label';
    el.textContent = room.name;
    const obj = new CSS2DObject(el);
    obj.position.set(room.labelAt[0], 0.3, room.labelAt[1]);
    labels.add(obj);
  }
  labels.visible = false;
  group.add(labels);

  // Bounds (feet) of the main slab + extras
  const all = slabList.flatMap(s => s.polygon);
  const bounds = bboxOf(all);

  return {
    group, headers, labels, ceiling, floors, solids, bounds,
    collision: { obstacles: obstacles.map(p => ({ poly: p, box: bboxOf(p) })), walkable, holes },
  };
}
