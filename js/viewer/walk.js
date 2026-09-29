// First-person walk: tap the floor to walk there, drag to look. Works with touch and mouse (no pointer lock).
import * as THREE from 'three';

const EYE = 5.5;                 // 5'6" eye height
const SPEED = 7;                 // ft per second
const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export class WalkControls {
  constructor(camera, dom, scene, markerMat) {
    this.camera = camera; this.dom = dom;
    this.enabled = false;
    this.yaw = 0; this.pitch = 0;
    this.pos = [0, 0];
    this.move = null;           // active movement tween
    this.ctx = null;            // { floor, collider }
    this.pointers = new Map();
    this.ray = new THREE.Raycaster();
    this.keys = new Set();
    camera.rotation.order = 'YXZ';

    // Ground marker at the tap target
    this.marker = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.62, 40), markerMat);
    this.marker.rotation.x = -Math.PI / 2;
    this.marker.visible = false;
    this.marker.renderOrder = 3;
    scene.add(this.marker);
    this.markerFade = 0;

    this._down = this._down.bind(this); this._moveP = this._moveP.bind(this); this._up = this._up.bind(this);
    this._key = this._key.bind(this);
    dom.addEventListener('pointerdown', this._down);
    dom.addEventListener('pointermove', this._moveP);
    dom.addEventListener('pointerup', this._up);
    dom.addEventListener('pointercancel', this._up);
    window.addEventListener('keydown', this._key);
    window.addEventListener('keyup', this._key);
  }

  setContext(ctx) { this.ctx = ctx; }

  place(x, y, headingDeg) {
    const p = this.ctx.collider.nearestFree(x, y) || [x, y];
    this.pos = p;
    if (headingDeg != null) this.yaw = -THREE.MathUtils.degToRad(headingDeg);
    this.pitch = -0.08;
    this.move = null;
    this.marker.visible = false;
    this._apply();
  }

  // Smoothly glide (ignoring walls) — used for the rooms menu.
  glideTo(x, y) {
    const p = this.ctx.collider.nearestFree(x, y);
    if (!p) return;
    this._startMove(p, Math.min(1.4, 0.5 + Math.hypot(p[0] - this.pos[0], p[1] - this.pos[1]) / 40));
  }

  _startMove(target, dur) {
    this.move = { from: this.pos.slice(), to: target, t: 0, dur: Math.max(0.25, dur) };
    this.marker.position.set(target[0], 0.03, target[1]);
    this.marker.visible = true; this.marker.material.opacity = 0.9; this.markerFade = 0;
  }

  _apply() {
    this.camera.position.set(this.pos[0], EYE, this.pos[1]);
    this.camera.rotation.set(this.pitch, this.yaw, 0);
  }

  _down(e) {
    if (!this.enabled) return;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t0: performance.now() });
    this.dom.setPointerCapture?.(e.pointerId);
  }
  _moveP(e) {
    if (!this.enabled) return;
    const p = this.pointers.get(e.pointerId);
    if (!p || this.pointers.size > 1) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    const k = e.pointerType === 'mouse' ? 0.0035 : 0.0055;
    this.yaw += dx * k;
    this.pitch = THREE.MathUtils.clamp(this.pitch + dy * k, -1.2, 1.2);
    this.dirty = true;
  }
  _up(e) {
    if (!this.enabled) return;
    const p = this.pointers.get(e.pointerId);
    const multi = this.pointers.size > 1;
    this.pointers.delete(e.pointerId);
    if (!p || multi || e.type === 'pointercancel') return;
    const moved = Math.hypot(e.clientX - p.x0, e.clientY - p.y0);
    if (moved < 8 && performance.now() - p.t0 < 450) this._tap(e.clientX, e.clientY);
  }

  _tap(cx, cy) {
    const r = this.dom.getBoundingClientRect();
    const ndc = new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(ndc, this.camera);
    const { floor } = this.ctx;
    const hits = this.ray.intersectObjects([...floor.floors, ...floor.solids], false);
    if (!hits.length) return;
    const h = hits[0].point;
    const target = this.ctx.collider.sweep(this.pos, [h.x, h.z]);
    const d = Math.hypot(target[0] - this.pos[0], target[1] - this.pos[1]);
    if (d < 0.3) return;
    this._startMove(target, d / SPEED + 0.25);
  }

  _key(e) {
    if (!this.enabled) return;
    const k = e.key.toLowerCase();
    if (!['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd'].includes(k)) return;
    if (e.type === 'keydown') this.keys.add(k); else this.keys.delete(k);
    e.preventDefault();
  }

  // returns true when the view changed
  update(dt) {
    if (!this.enabled) return false;
    let changed = !!this.dirty; this.dirty = false;
    if (this.move) {
      const m = this.move;
      m.t = Math.min(1, m.t + dt / m.dur);
      const k = ease(m.t);
      this.pos = [m.from[0] + (m.to[0] - m.from[0]) * k, m.from[1] + (m.to[1] - m.from[1]) * k];
      if (m.t >= 1) this.move = null;
      changed = true;
    } else if (this.marker.visible) {
      this.markerFade += dt;
      this.marker.material.opacity = Math.max(0, 0.9 - this.markerFade * 1.6);
      if (this.marker.material.opacity <= 0) this.marker.visible = false;
      changed = true;
    }
    if (this.keys.size) {
      const turn = (this.keys.has('arrowleft') || this.keys.has('a') ? 1 : 0) - (this.keys.has('arrowright') || this.keys.has('d') ? 1 : 0);
      const fwd = (this.keys.has('arrowup') || this.keys.has('w') ? 1 : 0) - (this.keys.has('arrowdown') || this.keys.has('s') ? 1 : 0);
      this.yaw += turn * dt * 1.8;
      if (fwd) {
        const step = fwd * SPEED * dt;
        const next = [this.pos[0] - Math.sin(this.yaw) * step, this.pos[1] - Math.cos(this.yaw) * step];
        if (this.ctx.collider.free(next[0], next[1])) this.pos = next;
      }
      this.move = null;
      changed = true;
    }
    if (changed) this._apply();
    return changed;
  }
}
