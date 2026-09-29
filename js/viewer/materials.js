// All finishes live here so they can be swapped (or set per room) later.
import * as THREE from 'three';

export const COLORS = {
  wall:      new THREE.Color('#f3f1ec'),
  wallTop:   new THREE.Color('#44403a'),   // cut wall tops read like a floor plan
  cabinet:   new THREE.Color('#fbfaf7'),
  cabTop:    new THREE.Color('#ebe7df'),
  frame:     '#34363a',
  glass:     '#cfe3ea',
  slabSide:  '#d9d4ca',
  tile:      '#e4e0d8',
  concrete:  '#cfccc6',
  stair:     '#d6c09a',
  voidWell:  '#3a3733',
  marker:    '#9c7a3c',
};

// Sky / ground per viewer theme
export const THEMES = {
  light: { skyTop: '#9fc3e6', skyHorizon: '#eef1ee', ground: '#d3dac6', fog: '#eef1ee', hemi: 2.0, dir: 1.7 },
  dark:  { skyTop: '#0d1522', skyHorizon: '#2a3140', ground: '#23272a', fog: '#2a3140', hemi: 1.4, dir: 0.9 },
};

// Procedural white-oak planks: one tile = 8 ft x 8 ft, 8" planks, staggered lengths.
function whiteOakTexture(renderer) {
  const S = 1024, planks = 12, pw = S / planks;
  const c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d');
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < planks; i++) {
    let y = -rnd() * S;
    while (y < S) {
      const len = S * (0.35 + rnd() * 0.5);
      const l = 79 + rnd() * 5, h = 35 + rnd() * 4;
      g.fillStyle = `hsl(${h}, ${26 + rnd() * 6}%, ${l}%)`;
      g.fillRect(i * pw, y, pw, len);
      // grain
      g.globalAlpha = 0.06;
      for (let k = 0; k < 7; k++) {
        g.strokeStyle = rnd() > 0.5 ? '#8a6a44' : '#ffffff';
        g.lineWidth = 0.6 + rnd() * 1.4;
        const x = i * pw + 4 + rnd() * (pw - 8);
        g.beginPath(); g.moveTo(x, y); g.bezierCurveTo(x + 6 * (rnd() - 0.5), y + len * 0.3, x + 6 * (rnd() - 0.5), y + len * 0.7, x, y + len); g.stroke();
      }
      g.globalAlpha = 1;
      // butt joint
      g.fillStyle = 'rgba(90,70,45,0.25)'; g.fillRect(i * pw, y, pw, 1.5);
      y += len;
    }
    g.fillStyle = 'rgba(90,70,45,0.22)'; g.fillRect(i * pw, 0, 1.5, S);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1 / 8, 1 / 8);           // shape UVs are in feet
  tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  return tex;
}

export function makeMaterials(renderer) {
  const lam = (o) => new THREE.MeshLambertMaterial(o);
  return {
    wall:     lam({ vertexColors: true }),
    cabinet:  lam({ vertexColors: true }),
    floor:    lam({ map: whiteOakTexture(renderer) }),
    slabSide: lam({ color: COLORS.slabSide }),
    tile:     lam({ color: COLORS.tile, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
    concrete: lam({ color: COLORS.concrete, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
    stair:    lam({ color: COLORS.stair }),
    frame:    lam({ color: COLORS.frame }),
    glass:    lam({ color: COLORS.glass, transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide }),
    rail:     lam({ color: COLORS.frame }),
    voidWell: lam({ color: COLORS.voidWell }),
    ceiling:  new THREE.MeshBasicMaterial({ color: '#e7e4dd', side: THREE.BackSide }),
    ground:   lam({ color: THEMES.light.ground }),
    marker:   new THREE.MeshBasicMaterial({ color: COLORS.marker, transparent: true, opacity: 0.9, depthWrite: false }),
  };
}

// Floor finish by name (used by data "finishes" zones and extra slabs)
export function finishMaterial(M, name) {
  return ({ tile: M.tile, concrete: M.concrete, oak: M.floor })[name] || M.tile;
}
