// 310 Duncaster — 3D floor plan viewer (Overall / Plan / Walk).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { MapControls } from 'three/addons/controls/MapControls.js';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { requireUnlock } from './gate.js';
import { makeMaterials, THEMES } from './materials.js';
import { buildFloor } from './build.js';
import { makeCollider } from './collision.js';
import { WalkControls } from './walk.js';
import { initUI } from './ui.js';

const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const TOPBAR = () => (document.querySelector('.topbar')?.getBoundingClientRect().bottom || 100);

document.addEventListener('gesturestart', e => e.preventDefault());
document.addEventListener('dblclick', e => e.preventDefault());

await requireUnlock();
document.getElementById('app').hidden = false;

// ── renderer / scene ─────────────────────────────────────────
const stage = document.getElementById('stage');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
stage.appendChild(renderer.domElement);
const labelRenderer = new CSS2DRenderer();
Object.assign(labelRenderer.domElement.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
stage.appendChild(labelRenderer.domElement);

const scene = new THREE.Scene();
const M = makeMaterials(renderer);

const hemi = new THREE.HemisphereLight(0xffffff, 0x8d8578, 2);
const sun = new THREE.DirectionalLight(0xffffff, 1);   // soft fill for form; no shadows
sun.position.set(-55, 80, 70);
scene.add(hemi, sun);

const skyMat = new THREE.ShaderMaterial({
  uniforms: { top: { value: new THREE.Color() }, bottom: { value: new THREE.Color() } },
  vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: 'uniform vec3 top; uniform vec3 bottom; varying vec3 vP; void main(){ float h = clamp(vP.y * 1.8 + 0.02, 0.0, 1.0); gl_FragColor = vec4(mix(bottom, top, pow(h, 0.7)), 1.0);\n#include <colorspace_fragment>\n}',
  side: THREE.BackSide, depthWrite: false, fog: false,
});
const sky = new THREE.Mesh(new THREE.SphereGeometry(1500, 32, 16), skyMat);
sky.renderOrder = -1;
scene.add(sky);
const ground = new THREE.Mesh(new THREE.CircleGeometry(1400, 64), M.ground);
ground.rotation.x = -Math.PI / 2; ground.position.y = -0.82;
scene.add(ground);
scene.fog = new THREE.Fog(0xffffff, 260, 1100);

function applyTheme(name) {
  const t = THEMES[name] || THEMES.light;
  skyMat.uniforms.top.value.set(t.skyTop);
  skyMat.uniforms.bottom.value.set(t.skyHorizon);
  scene.fog.color.set(t.fog);
  M.ground.color.set(t.ground);
  hemi.intensity = t.hemi; sun.intensity = t.dir;
  dirty = true;
}

// ── cameras & controls ───────────────────────────────────────
const persp = new THREE.PerspectiveCamera(40, 1, 0.5, 4000);
const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 1000);
ortho.up.set(0, 0, -1);
const walkCam = new THREE.PerspectiveCamera(70, 1, 0.2, 4000);

const orbit = new OrbitControls(persp, renderer.domElement);
Object.assign(orbit, { enableDamping: true, dampingFactor: 0.09, screenSpacePanning: false,
  minDistance: 12, maxDistance: 700, maxPolarAngle: 1.38, rotateSpeed: 0.8, zoomToCursor: true });

const planCtl = new MapControls(ortho, renderer.domElement);
Object.assign(planCtl, { enableRotate: false, enableDamping: true, dampingFactor: 0.12, screenSpacePanning: true,
  minZoom: 0.6, maxZoom: 9, zoomToCursor: true });
planCtl.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_PAN };
planCtl.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };

const walk = new WalkControls(walkCam, renderer.domElement, scene, M.marker);

// ── state ────────────────────────────────────────────────────
const state = { mode: 'overall', floor: 1 };
const floors = {};          // n -> { data, built, collider }
let current = null;
let dirty = true;
const tweens = [];

async function loadFloor(n) {
  if (floors[n]) return floors[n];
  const res = await fetch(`data/floor-${n}.json`, { cache: 'no-cache' });
  const data = await res.json();
  const built = buildFloor(data, M);
  floors[n] = { data, built, collider: makeCollider(built.collision) };
  return floors[n];
}

function viewSize() {
  return { w: stage.clientWidth || window.innerWidth, h: stage.clientHeight || window.innerHeight };
}

// Keep the house centred in the area below the top bar (Overall/Plan)
function applyViewOffset(cam) {
  const { w, h } = viewSize();
  const top = cam === walkCam ? 0 : TOPBAR();
  if (top > 0) cam.setViewOffset(w, h + top, 0, 0, w, h); else cam.clearViewOffset();
}

function resize() {
  const { w, h } = viewSize();
  const top = TOPBAR();
  renderer.setSize(w, h);
  labelRenderer.setSize(w, h);
  // Overall/Plan render a w x (h + top) virtual view so the house centres below the top bar
  persp.aspect = w / (h + top);
  walkCam.aspect = w / h;
  // ~80° horizontal field of view, whatever the orientation
  walkCam.fov = THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(40)) / walkCam.aspect)), 55, 95);
  walkCam.updateProjectionMatrix();
  setOrthoFrustum();
  applyViewOffset(persp); applyViewOffset(ortho);
  persp.updateProjectionMatrix(); ortho.updateProjectionMatrix();
  dirty = true;
}

let planBase = 60;   // plan frustum height (ft) at zoom 1
function setOrthoFrustum() {
  const { w, h } = viewSize(), a = w / (h + TOPBAR());
  ortho.left = -planBase * a / 2; ortho.right = planBase * a / 2;
  ortho.top = planBase / 2; ortho.bottom = -planBase / 2;
  ortho.updateProjectionMatrix();
}

function center(b) { return new THREE.Vector3((b.x0 + b.x1) / 2, 0, (b.y0 + b.y1) / 2); }

// ── tweens ───────────────────────────────────────────────────
function tween(dur, step, done) {
  for (const t of tweens) t.cancelled = true;
  tweens.length = 0;
  tweens.push({ t0: performance.now(), dur: dur * 1000, step, done });
}
function runTweens(now) {
  if (!tweens.length) return false;
  for (const t of [...tweens]) {
    const k = Math.min(1, (now - t.t0) / t.dur);
    t.step(ease(k));
    if (k >= 1) { tweens.splice(tweens.indexOf(t), 1); t.done?.(); }
  }
  return true;
}

// ── framing ──────────────────────────────────────────────────
function overallFit(b, instant) {
  const c = center(b);
  const { h } = viewSize(), top = TOPBAR();
  const H = current?.data.ceilingHeight || 12;
  const az = THREE.MathUtils.degToRad(18), el = THREE.MathUtils.degToRad(52);
  const dir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
  const corners = [];
  for (const x of [b.x0, b.x1]) for (const z of [b.y0, b.y1]) for (const y of [0, H]) corners.push(new THREE.Vector3(x, y, z));
  // iterate: place camera, project the bounding box, scale distance until it fits the visible area
  const cam = persp.clone();
  const hh = (h - top) / h, yc = -top / h;   // usable NDC band below the top bar
  let dist = Math.hypot(b.x1 - b.x0, b.y1 - b.y0) * 1.5;
  for (let i = 0; i < 4; i++) {
    cam.position.copy(c).addScaledVector(dir, dist); cam.lookAt(c); cam.updateMatrixWorld();
    let ux = 0, uy = 0;
    for (const p of corners) { const q = p.clone().project(cam); ux = Math.max(ux, Math.abs(q.x)); uy = Math.max(uy, Math.abs(q.y - yc)); }
    dist *= Math.max(ux / 0.9, uy / (hh * 0.9));
  }
  flyOrbit(c, c.clone().addScaledVector(dir, dist), instant);
}
function flyOrbit(target, pos, instant) {
  if (instant) { orbit.target.copy(target); persp.position.copy(pos); orbit.update(); dirty = true; return; }
  const t0 = orbit.target.clone(), p0 = persp.position.clone();
  orbit.enabled = false;
  tween(0.9, k => {
    orbit.target.lerpVectors(t0, target, k);
    persp.position.lerpVectors(p0, pos, k);
    persp.lookAt(orbit.target);
  }, () => { orbit.enabled = state.mode === 'overall'; orbit.update(); });
}
function overallRoom(room) {
  const b = bboxOfPoly(room.polygon);
  const c = center(b);
  const size = Math.max(b.x1 - b.x0, b.y1 - b.y0);
  const dir = persp.position.clone().sub(orbit.target).normalize();
  if (dir.y < 0.55) { dir.y = 0.55; dir.normalize(); }
  flyOrbit(c, c.clone().add(dir.multiplyScalar(size * 2.1 + 16)));
}

function planFit(b, instant) {
  const { w, h } = viewSize(), top = TOPBAR();
  planBase = Math.max((b.y1 - b.y0) * (h + top) / (h - top - 24), (b.x1 - b.x0) * (h + top) / w) * 1.06;
  setOrthoFrustum();
  flyPlan(center(b), 1, instant);
}
function flyPlan(c, zoom, instant) {
  const apply = (x, z, zm) => {
    planCtl.target.set(x, 0, z);
    ortho.position.set(x, 150, z);
    ortho.zoom = zm; ortho.updateProjectionMatrix();
    ortho.lookAt(x, 0, z);
  };
  if (instant) { apply(c.x, c.z, zoom); planCtl.update(); dirty = true; return; }
  const x0 = planCtl.target.x, z0 = planCtl.target.z, zm0 = ortho.zoom;
  planCtl.enabled = false;
  tween(0.8, k => apply(x0 + (c.x - x0) * k, z0 + (c.z - z0) * k, zm0 + (zoom - zm0) * k),
    () => { planCtl.enabled = state.mode === 'plan'; planCtl.update(); });
}
function planRoom(room) {
  const b = bboxOfPoly(room.polygon);
  const { w, h } = viewSize(), top = TOPBAR();
  const need = Math.max((b.y1 - b.y0) * (h + top) / (h - top), (b.x1 - b.x0) * (h + top) / w) * 1.5 + 6;
  flyPlan(center(b), THREE.MathUtils.clamp(planBase / need, planCtl.minZoom, planCtl.maxZoom));
}

function bboxOfPoly(p) {
  const xs = p.map(q => q[0]), ys = p.map(q => q[1]);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

// Keep the camera over the house
function clampTarget(ctl, cam, pad) {
  if (!current) return;
  const b = current.built.bounds, t = ctl.target;
  const cx = THREE.MathUtils.clamp(t.x, b.x0 - pad, b.x1 + pad), cz = THREE.MathUtils.clamp(t.z, b.y0 - pad, b.y1 + pad);
  if (cx !== t.x || cz !== t.z) { cam.position.x += cx - t.x; cam.position.z += cz - t.z; t.x = cx; t.z = cz; }
}
orbit.addEventListener('change', () => { clampTarget(orbit, persp, 12); dirty = true; });
planCtl.addEventListener('change', () => { clampTarget(planCtl, ortho, 4); dirty = true; });

// ── modes / floors ───────────────────────────────────────────
function activeCamera() { return state.mode === 'plan' ? ortho : state.mode === 'walk' ? walkCam : persp; }

function setMode(mode, first) {
  state.mode = mode;
  orbit.enabled = mode === 'overall';
  planCtl.enabled = mode === 'plan';
  walk.enabled = mode === 'walk';
  if (current) {
    current.built.headers.visible = mode !== 'plan';
    current.built.labels.visible = mode === 'plan';
    current.built.ceiling.visible = mode === 'walk';
  }
  ui.showHint(mode === 'walk');
  const b = current.built.bounds;
  if (mode === 'overall') overallFit(b, true);
  if (mode === 'plan') planFit(b, true);
  if (mode === 'walk') {
    const s = current.data.start || { at: [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2], heading: 0 };
    walk.place(s.at[0], s.at[1], s.heading);
  }
  if (!first) dirty = true;
}

async function setFloor(n) {
  const f = await loadFloor(n);
  if (current) scene.remove(current.built.group);
  current = f; state.floor = n;
  scene.add(f.built.group);
  walk.setContext({ floor: f.built, collider: f.collider });
  ui.setRooms(f.data.rooms);
  setMode(state.mode);
}

function goRoom(id) {
  if (id === '__all') {
    const b = current.built.bounds;
    if (state.mode === 'overall') overallFit(b);
    else if (state.mode === 'plan') planFit(b);
    else { const s = current.data.start; walk.glideTo(s.at[0], s.at[1]); }
    return;
  }
  const room = current.data.rooms.find(r => r.id === id);
  if (!room) return;
  if (state.mode === 'overall') overallRoom(room);
  else if (state.mode === 'plan') planRoom(room);
  else walk.glideTo(room.labelAt[0], room.labelAt[1]);
}

const ui = initUI({
  onMode: m => setMode(m),
  onFloor: n => setFloor(n),
  onRoom: goRoom,
  onTheme: applyTheme,
});

// ── boot ─────────────────────────────────────────────────────
applyTheme(document.documentElement.dataset.theme);
resize();
window.addEventListener('resize', resize);
window.visualViewport?.addEventListener('resize', resize);
await setFloor(1);
loadFloor(2);                        // warm the other floor in the background
document.getElementById('loading').hidden = true;

let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  let changed = runTweens(now);
  if (state.mode === 'overall' && orbit.enabled) changed = orbit.update() || changed;
  if (state.mode === 'plan' && planCtl.enabled) changed = planCtl.update() || changed;
  if (state.mode === 'walk') changed = walk.update(dt) || changed;
  if (changed || dirty) {
    dirty = false;
    const cam = activeCamera();
    sky.position.copy(cam.position);
    renderer.render(scene, cam);
    labelRenderer.render(scene, cam);
  }
}
requestAnimationFrame(frame);
