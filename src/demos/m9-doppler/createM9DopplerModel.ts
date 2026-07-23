import * as THREE from 'three';
import geoData from './geo.json';

/**
 * M9 Bayonet | Doppler Phase 2 — procedural reconstruction (img2threejs).
 *
 * Code-only: every mesh is built from a traced silhouette (`geo.json`, a per-column pixel
 * scan of the reference broadside — see the source repo's
 * `grimoire/intake/reference_silhouette_tracing.md`) and every material is a canvas-generated
 * procedural texture. No imported mesh, no downloaded texture pack — the Doppler Phase 2
 * blade finish is an original gradient + domain-warped "smoke" generator approximating the
 * blue -> violet -> cyan colourway, not a copy of Valve's authored pattern.
 *
 * Geometry: blade = ExtrudeGeometry from the traced spine (with the real scalloped sawteeth)
 * + cutting-edge/belly profiles, thumb-hole as a traced Path hole, each vertex Z-tapered to a
 * sharp wedge cross-section. Handle = single grip cylinder at the traced length/radius with a
 * procedural worn-gunmetal knurl. Guard = a single continuous flat-bar profile (ring -> blunt
 * tip) traced off the reference, not a box + separate rod.
 *
 * Action-ready: root.userData.sculptRuntime = { nodes, meshes, sockets, colliders,
 * destructionGroups, adjacency }; root.userData.actionAnchors for swing/spin/throw/stab pivots.
 */

export interface M9DopplerOptions {
  /** overall scale multiplier (default 1) */
  scale?: number;
  /** enable cast/receive shadows (default true) */
  shadows?: boolean;
  /** enable the idle display rock (default true) */
  animate?: boolean;
}

interface BladeGeo {
  top: [number, number][];
  bot: [number, number][];
  hole?: { cx: number; cy: number; rx: number; ry: number };
  length: number;
}
interface HandleGeo {
  length: number;
  radius: number;
  rightX: number;
  leftX: number;
}
const GEO = geoData as unknown as { blade: BladeGeo; handle: HandleGeo };

// ---------------------------------------------------------------------------
// deterministic PRNG + value-noise fbm (skill requires seeded procedural noise)
// ---------------------------------------------------------------------------
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function valueNoise(cells: number, rnd: () => number): (x: number, y: number) => number {
  const g: number[] = [];
  for (let i = 0; i < (cells + 1) * (cells + 1); i++) g.push(rnd());
  const s = (t: number) => t * t * (3 - 2 * t);
  return (x: number, y: number) => {
    x *= cells;
    y *= cells;
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const tx = s(x - ix);
    const ty = s(y - iy);
    const at = (a: number, b: number) =>
      g[
        (((b % (cells + 1)) + (cells + 1)) % (cells + 1)) * (cells + 1) +
          (((a % (cells + 1)) + (cells + 1)) % (cells + 1))
      ];
    const a = at(ix, iy);
    const b = at(ix + 1, iy);
    const c = at(ix, iy + 1);
    const d = at(ix + 1, iy + 1);
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
  };
}
function fbmMaker(rnd: () => number): (x: number, y: number) => number {
  const oct = [valueNoise(3, rnd), valueNoise(7, rnd), valueNoise(15, rnd), valueNoise(31, rnd)];
  return (x: number, y: number) =>
    oct[0](x, y) * 0.5 + oct[1](x, y) * 0.28 + oct[2](x, y) * 0.15 + oct[3](x, y) * 0.07;
}
// wider/slower fbm for large-scale marbling blotches (distinct from the fine "smoke" fbm)
function fbmMakerWide(rnd: () => number): (x: number, y: number) => number {
  const oct = [valueNoise(2, rnd), valueNoise(4, rnd), valueNoise(8, rnd)];
  return (x: number, y: number) => oct[0](x, y) * 0.55 + oct[1](x, y) * 0.32 + oct[2](x, y) * 0.13;
}
function lerpHex(a: string, b: string, t: number): number[] {
  const pa = [parseInt(a.slice(1, 3), 16), parseInt(a.slice(3, 5), 16), parseInt(a.slice(5, 7), 16)];
  const pb = [parseInt(b.slice(1, 3), 16), parseInt(b.slice(3, 5), 16), parseInt(b.slice(5, 7), 16)];
  return pa.map((v, i) => v + (pb[i] - v) * t);
}
function gradientAt(stops: [number, string][], u: number): number[] {
  let i = 0;
  while (i < stops.length - 1 && u > stops[i + 1][0]) i++;
  const [t0, c0] = stops[i];
  const [t1, c1] = stops[Math.min(i + 1, stops.length - 1)];
  const t = t1 > t0 ? (u - t0) / (t1 - t0) : 0;
  return lerpHex(c0, c1, Math.max(0, Math.min(1, t)));
}

// ---------------------------------------------------------------------------
// Doppler Phase 2 -style blade albedo — original gradient + domain-warped smoke,
// not a copy of Valve's pattern (procedural only, no source texture).
// ---------------------------------------------------------------------------
function bladeAlbedo(): THREE.CanvasTexture {
  const w = 2048;
  const h = 640;
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const c = cv.getContext('2d')!;
  // a bigger, non-monotonic stop matrix (root -> tip): blue near the ricasso, swings into
  // violet mid-blade, back to blue, only a faint cool fleck right at the point — read off
  // the overall blue/violet/black-smoke colourway of the reference, not sampled from it.
  const stops: [number, string][] = [
    [0.0, '#132a86'],
    [0.08, '#183296'],
    [0.16, '#1f3fb4'],
    [0.24, '#2d3fc6'],
    [0.32, '#3d3fd2'],
    [0.4, '#4d38ca'],
    [0.48, '#5c33b8'],
    [0.55, '#6a3aae'],
    [0.62, '#673fb2'],
    [0.69, '#5641ba'],
    [0.76, '#4348bc'],
    [0.83, '#3452b2'],
    [0.9, '#2c62a8'],
    [0.96, '#2c76a0'],
    [1.0, '#2e8698'],
  ];
  const rnd = mulberry32(20260722);
  const fbm = fbmMaker(rnd);
  const warp = fbmMaker(mulberry32(97));
  const blotch = fbmMakerWide(mulberry32(413));
  const img = c.createImageData(w, h);
  const d = img.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = x / w;
      // CanvasTexture flips vertically on upload (flipY=true) -> invert here so v=0
      // lands on the mesh's actual cutting edge (bottom), not the spine/sawtooth side.
      const v = 1 - y / h;
      const idx = (y * w + x) * 4;
      let col = gradientAt(stops, u);
      const wx = u + (warp(u * 2.2, v * 2.2) - 0.5) * 0.5;
      const wy = v + (warp(u * 2.2 + 5, v * 2.2 + 5) - 0.5) * 0.5;
      const smoke = fbm(wx * 2.4, wy * 2.0);
      // large irregular black-smoke blotches scattered along the FULL length (not one
      // centred band) — closer to the reference's marbling than a single gaussian patch.
      const patches = blotch(u * 1.6, v * 1.1) * 0.6 + blotch(u * 1.6 + 11, v * 1.1 + 11) * 0.4;
      const dark = Math.min(0.9, Math.pow(Math.max(0, smoke * 0.6 + patches * 0.7 - 0.32), 1.3) * 2.5);
      col = col.map((ch, i) => ch * (1 - dark * (i === 2 ? 0.82 : 1)));
      if (v > 0.82) {
        const s = ((v - 0.82) / 0.18) * 0.3;
        col = [col[0] * (1 - s) + 95 * s, col[1] * (1 - s) + 165 * s, col[2] * (1 - s) + 225 * s];
      }
      if (v < 0.34) col = col.map((ch, i) => ch * (i === 2 ? 1.12 : 1.04));
      d[idx] = col[0];
      d[idx + 1] = col[1];
      d[idx + 2] = col[2];
      d[idx + 3] = 255;
    }
  }
  c.putImageData(img, 0, 0);
  c.strokeStyle = 'rgba(180,210,255,0.35)';
  c.lineWidth = 3;
  c.beginPath();
  c.moveTo(w * 0.05, h * 0.66);
  c.lineTo(w * 0.98, h * 0.5);
  c.stroke();
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 16;
  return tex;
}

// ---------------------------------------------------------------------------
// procedural knurled worn-gunmetal grip (albedo + bump)
// ---------------------------------------------------------------------------
function gripMaps(): { alb: THREE.CanvasTexture; bump: THREE.CanvasTexture } {
  const w = 512;
  const h = 256;
  const alb = document.createElement('canvas');
  const bmp = document.createElement('canvas');
  alb.width = bmp.width = w;
  alb.height = bmp.height = h;
  const ca = alb.getContext('2d')!;
  const cb = bmp.getContext('2d')!;
  const rnd = mulberry32(55);
  const fbm = fbmMaker(rnd);
  const img = ca.createImageData(w, h);
  const d = img.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = x / w;
      const v = y / h;
      const i = (y * w + x) * 4;
      const m = fbm(u * 3, v * 3) * 0.7 + fbm(u * 9, v * 9) * 0.3;
      const g = 20 + m * 22; // near-black matte rubber, not gunmetal steel
      d[i] = g * 1.0;
      d[i + 1] = g * 0.96;
      d[i + 2] = g * 0.9;
      d[i + 3] = 255;
    }
  }
  ca.putImageData(img, 0, 0);
  ca.strokeStyle = 'rgba(120,110,100,0.14)';
  ca.lineWidth = 1;
  for (let k = 0; k < 60; k++) {
    const yy = rnd() * h;
    const x0 = rnd() * w;
    ca.beginPath();
    ca.moveTo(x0, yy);
    ca.lineTo(x0 + 20 + rnd() * 90, yy + (rnd() - 0.5) * 6);
    ca.stroke();
  }
  cb.fillStyle = '#808080';
  cb.fillRect(0, 0, w, h);
  cb.strokeStyle = '#c8c8c8';
  cb.lineWidth = 2;
  for (let o = -h; o < w; o += 14) {
    cb.beginPath();
    cb.moveTo(o, 0);
    cb.lineTo(o + h, h);
    cb.stroke();
    cb.beginPath();
    cb.moveTo(o + h, 0);
    cb.lineTo(o, h);
    cb.stroke();
  }
  cb.strokeStyle = '#404040';
  cb.lineWidth = 5;
  cb.beginPath();
  cb.moveTo(0, h / 2);
  cb.lineTo(w, h / 2);
  cb.stroke();
  const a = new THREE.CanvasTexture(alb);
  a.colorSpace = THREE.SRGBColorSpace;
  const b = new THREE.CanvasTexture(bmp);
  b.colorSpace = THREE.NoColorSpace;
  a.wrapS = a.wrapT = b.wrapS = b.wrapT = THREE.RepeatWrapping;
  a.repeat.set(3, 1);
  b.repeat.set(6, 1);
  a.anisotropy = b.anisotropy = 8;
  return { alb: a, bump: b };
}

function normalizeUVs(geo: THREE.BufferGeometry): void {
  geo.computeBoundingBox();
  const bb = geo.boundingBox!;
  const pos = geo.attributes.position;
  const w = bb.max.x - bb.min.x;
  const h = bb.max.y - bb.min.y;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = (pos.getX(i) - bb.min.x) / w;
    uv[i * 2 + 1] = (pos.getY(i) - bb.min.y) / h;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

// planar (orthographic front) UV: map world x,y over a bbox to [0,1].
function planarUV(geo: THREE.BufferGeometry, minx: number, maxx: number, miny: number, maxy: number): void {
  const pos = geo.attributes.position;
  const w = maxx - minx;
  const h = maxy - miny;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = (pos.getX(i) - minx) / w;
    uv[i * 2 + 1] = (pos.getY(i) - miny) / h;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

function makeMaterials() {
  // the pattern carries its own colour/lighting -> keep non-metallic; a clearcoat adds the
  // candy gloss on the blade without tinting the albedo through metalness.
  const grip = gripMaps();
  const doppler = new THREE.MeshPhysicalMaterial({
    map: bladeAlbedo(),
    metalness: 0.0,
    roughness: 0.34,
    clearcoat: 0.85,
    clearcoatRoughness: 0.07,
    envMapIntensity: 0.9,
  });
  const handleTex = new THREE.MeshPhysicalMaterial({
    map: grip.alb,
    bumpMap: grip.bump,
    bumpScale: 0.006,
    metalness: 0.04,
    roughness: 0.88,
    envMapIntensity: 0.35,
  });
  const guardSteel = new THREE.MeshPhysicalMaterial({
    color: 0x2c3566,
    metalness: 0.85,
    roughness: 0.42,
    clearcoat: 0.5,
    clearcoatRoughness: 0.2,
    envMapIntensity: 1.15,
  });
  const grooveDark = new THREE.MeshStandardMaterial({ color: 0x14161c, metalness: 0.6, roughness: 0.6 });
  const pommelSteel = new THREE.MeshPhysicalMaterial({ color: 0x545a66, metalness: 0.8, roughness: 0.5, envMapIntensity: 1.1 });
  const tangCore = new THREE.MeshStandardMaterial({ color: 0x7d7358, metalness: 0.55, roughness: 0.7 });
  return { doppler, handleTex, guardSteel, grooveDark, pommelSteel, tangCore };
}

// ---------- traced blade (exact silhouette from the reference) + sharp wedge cross-section ----------
function buildTracedBlade(bg: BladeGeo, mat: THREE.Material): THREE.Mesh {
  const top = bg.top;
  const bot = bg.bot;
  const shape = new THREE.Shape();
  top.forEach(([x, y], i) => (i === 0 ? shape.moveTo(x, y) : shape.lineTo(x, y)));
  for (let i = bot.length - 1; i >= 0; i--) shape.lineTo(bot[i][0], bot[i][1]);
  shape.closePath();
  if (bg.hole) {
    const hole = bg.hole;
    const p = new THREE.Path();
    for (let i = 0; i <= 32; i++) {
      const a = (2 * Math.PI * i) / 32;
      const x = hole.cx + hole.rx * Math.cos(a);
      const y = hole.cy + hole.ry * Math.sin(a);
      i === 0 ? p.moveTo(x, y) : p.lineTo(x, y);
    }
    shape.holes.push(p);
  }
  const depth = 0.048;
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: 0.005, bevelSize: 0.004, bevelSegments: 1, steps: 1 });
  g.translate(0, 0, -depth / 2 - 0.004);
  const interp = (arr: [number, number][], x: number): number => {
    if (x <= arr[0][0]) return arr[0][1];
    if (x >= arr[arr.length - 1][0]) return arr[arr.length - 1][1];
    let lo = 0;
    let hi = arr.length - 1;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      arr[m][0] < x ? (lo = m) : (hi = m);
    }
    const t = (x - arr[lo][0]) / (arr[hi][0] - arr[lo][0]);
    return arr[lo][1] + (arr[hi][1] - arr[lo][1]) * t;
  };
  const sm = (a: number, b: number, x: number) => {
    const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  const pos = g.attributes.position;
  const L = bg.length;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const yt = interp(top, x);
    const yb = interp(bot, x);
    const rng = Math.max(1e-4, yt - yb);
    const t = (y - yb) / rng;
    let fz = sm(0, 0.16, t);
    const clip = sm(L * 0.74, L * 0.97, x);
    if (clip > 0) fz *= (1 - clip) + clip * sm(0, 0.16, 1 - t);
    pos.setZ(i, z * fz);
  }
  g.computeVertexNormals();
  normalizeUVs(g);
  return new THREE.Mesh(g, mat);
}

// ---------------------------------------------------------------------------
// model
// ---------------------------------------------------------------------------
export function createM9DopplerModel(options: M9DopplerOptions = {}): THREE.Group {
  const shadows = options.shadows ?? true;
  const mats = makeMaterials();
  const root = new THREE.Group();
  root.name = 'M9 Bayonet | Doppler Phase 2';
  const nodes: Record<string, THREE.Object3D> = { root };
  const meshes: Record<string, THREE.Object3D> = {};
  const sockets: Record<string, THREE.Object3D> = {};
  const colliders: Record<string, unknown> = {};
  const destructionGroups: Record<string, THREE.Object3D[]> = {};
  const addNode = (id: string, parent: string, pos: [number, number, number] = [0, 0, 0], rot: [number, number, number] = [0, 0, 0]) => {
    const gp = new THREE.Group();
    gp.name = id + '__pivot';
    gp.position.set(...pos);
    gp.rotation.set(...rot);
    (nodes[parent] ?? root).add(gp);
    nodes[id] = gp;
    return gp;
  };
  const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material, parent: string, frac?: string) => {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = shadows;
    m.receiveShadow = shadows;
    (nodes[parent] ?? root).add(m);
    if (frac) (destructionGroups[frac] ??= []).push(nodes[parent]);
    return m;
  };

  // --- Blade: exact traced silhouette + sharp wedge cross-section, ricasso tucked into guard ---
  addNode('blade', 'root', [-0.075, 0, 0]);
  const bblade = buildTracedBlade(GEO.blade, mats.doppler);
  bblade.castShadow = shadows;
  bblade.receiveShadow = shadows;
  nodes.blade.add(bblade);
  meshes['blade'] = bblade;
  (destructionGroups['blade'] ??= []).push(nodes.blade);
  const L = GEO.blade.length;
  colliders['blade'] = { type: 'box', size: [L, 0.5, 0.1] };
  const tip = new THREE.Object3D();
  tip.name = 'tip';
  tip.position.set(L, 0, 0);
  nodes.blade.add(tip);
  sockets['blade:tip'] = tip;

  // --- Guard: a single continuous flat bar from the ring down to a blunt tip, traced off
  // the reference (no box + separate round neck/quillon), so there is no cross-section seam.
  const hg = GEO.handle;
  const R = hg.radius;
  addNode('guard', 'root', [hg.rightX / 2, 0, 0]);
  const barPts: [number, number][] = [
    [0.41, 0.028],
    [0.34, 0.04],
    [0.25, 0.05],
    [0.0, 0.048],
    [-0.15, 0.045],
    [-0.28, 0.04],
    [-0.36, 0.032],
    [-0.4, 0.02],
  ];
  const barShape = new THREE.Shape();
  barShape.moveTo(barPts[0][1], barPts[0][0]);
  for (let i = 1; i < barPts.length; i++) barShape.lineTo(barPts[i][1], barPts[i][0]);
  for (let i = barPts.length - 1; i >= 0; i--) barShape.lineTo(-barPts[i][1], barPts[i][0]);
  barShape.closePath();
  const barGeo = new THREE.ExtrudeGeometry(barShape, { depth: 0.11, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 2 });
  barGeo.translate(0, 0, -0.055);
  meshes['crossguard'] = mesh(barGeo, mats.guardSteel, 'guard', 'guard');
  const quillTip = mesh(new THREE.SphereGeometry(0.02, 12, 8), mats.guardSteel, 'guard', 'guard');
  quillTip.position.set(0, -0.4, 0);
  const boltHole = mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.14, 16), mats.grooveDark, 'guard', 'guard');
  boltHole.rotation.x = Math.PI / 2;
  boltHole.position.set(0, -0.31, 0);
  const collar = mesh(new THREE.CylinderGeometry(R * 0.72, R * 0.82, 0.12, 28), mats.guardSteel, 'guard', 'guard');
  collar.rotation.z = Math.PI / 2;
  collar.position.set(-0.1, 0, 0);
  const ring = mesh(new THREE.TorusGeometry(0.045, 0.014, 20, 48), mats.guardSteel, 'guard', 'guard');
  ring.scale.set(1, 1.12, 1);
  ring.position.set(0, 0.46, 0);
  colliders['muzzleRing'] = { type: 'torus', radius: 0.045, tube: 0.014 };

  // --- Handle: single grip cylinder with a procedural worn-gunmetal knurl planar-projected,
  // + groove rings for relief + pommel cap with exposed tang core. ---
  addNode('grip', 'root', [0, 0, 0]);
  const cx = (hg.leftX + hg.rightX) / 2;
  const nSeg = 8;
  const gripGeo = new THREE.CylinderGeometry(R, R, hg.length, 48, 176);
  gripGeo.rotateZ(Math.PI / 2);
  gripGeo.translate(cx, 0, 0);
  {
    const p = gripGeo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      const y = p.getY(i);
      const z = p.getZ(i);
      const frac = (((x - hg.leftX) / hg.length) * nSeg) % 1;
      const bulge = 1 + 0.06 * Math.sin(Math.PI * (frac < 0 ? frac + 1 : frac));
      p.setY(i, y * bulge);
      p.setZ(i, z * bulge);
    }
    gripGeo.computeVertexNormals();
  }
  planarUV(gripGeo, hg.leftX, hg.rightX, -R, R);
  const gripMesh = new THREE.Mesh(gripGeo, mats.handleTex);
  gripMesh.castShadow = gripMesh.receiveShadow = shadows;
  nodes.grip.add(gripMesh);
  meshes['grip'] = gripMesh;
  (destructionGroups['handle'] ??= []).push(nodes.grip);
  colliders['grip'] = { type: 'capsule', radius: R, height: hg.length };
  const gr = new THREE.Object3D();
  gr.name = 'grip-root';
  gr.position.set(hg.rightX, 0, 0);
  nodes.grip.add(gr);
  sockets['grip:root'] = gr;
  for (let i = 1; i < 8; i++) {
    const rr = new THREE.Mesh(new THREE.TorusGeometry(R * 1.008, 0.007, 8, 44), mats.grooveDark);
    rr.rotation.y = Math.PI / 2;
    rr.position.x = hg.leftX + (i * hg.length) / 8;
    nodes.grip.add(rr);
  }
  addNode('pommel', 'grip', [0, 0, 0]);
  const pcap = new THREE.CylinderGeometry(R * 1.06, R * 0.98, 0.08, 40);
  pcap.rotateZ(Math.PI / 2);
  mesh(pcap, mats.pommelSteel, 'pommel', 'handle').position.set(hg.leftX + 0.02, 0, 0);
  const core = new THREE.Mesh(new THREE.CircleGeometry(R * 0.6, 32), mats.tangCore);
  core.rotation.y = -Math.PI / 2;
  core.position.set(hg.leftX - 0.02, 0, 0);
  nodes.pommel.add(core);
  meshes['tangCore'] = core;

  // ---------- runtime rigging ----------
  const adjacency = [
    { a: 'grip', b: 'guard', axis: 'x' },
    { a: 'guard', b: 'blade', axis: 'x' },
  ];
  root.userData.sculptRuntime = { nodes, meshes, sockets, colliders, destructionGroups, adjacency };
  root.userData.actionAnchors = { gripPivot: nodes.grip, balancePivot: nodes.guard, throwFrom: sockets['grip:root'], stab: sockets['blade:tip'] };

  const box = new THREE.Box3().setFromObject(root);
  root.position.sub(box.getCenter(new THREE.Vector3()));

  if (options.animate ?? true) {
    const base = root.rotation.y;
    root.userData.tick = (_dt: number, elapsed: number) => {
      root.rotation.y = base + Math.sin(elapsed * 0.5) * 0.28;
      root.rotation.x = Math.sin(elapsed * 0.33) * 0.05;
    };
  }
  if (options.scale) root.scale.setScalar(options.scale);

  return root;
}

// ---------------------------------------------------------------------------
// look-dev lighting rig — cool studio key + violet rim (matches the Doppler colourway)
// ---------------------------------------------------------------------------
export function createM9DopplerLookDevLights(): THREE.Group {
  const lights = new THREE.Group();
  lights.name = 'lookdev-lights';

  const hemi = new THREE.HemisphereLight(0xdbe4ff, 0x14121e, 0.5);
  lights.add(hemi);

  const key = new THREE.DirectionalLight(0xffffff, 3.0);
  key.position.set(-3.0, 4.0, 3.4);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 20;
  const kc = key.shadow.camera as THREE.OrthographicCamera;
  kc.left = -4;
  kc.right = 4;
  kc.top = 4;
  kc.bottom = -4;
  key.shadow.bias = -0.0004;
  lights.add(key);

  const fill = new THREE.DirectionalLight(0x9fc4ff, 0.5);
  fill.position.set(3.8, 1.2, 2.0);
  lights.add(fill);

  const rim = new THREE.DirectionalLight(0xb08cff, 1.3);
  rim.position.set(1.2, 2.2, -4.2);
  lights.add(rim);

  const accent = new THREE.PointLight(0x7ee8ff, 6, 10, 2);
  accent.position.set(1.4, 1.6, 2.2);
  lights.add(accent);

  return lights;
}

/** Radial studio-gradient background echoing the Doppler blue/violet colourway. */
export function makeM9DopplerBackground(): THREE.CanvasTexture {
  const S = 1024;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d')!;
  const g = ctx.createRadialGradient(S * 0.5, S * 0.46, S * 0.1, S * 0.5, S * 0.5, S * 0.72);
  g.addColorStop(0, '#232a45');
  g.addColorStop(0.55, '#181b30');
  g.addColorStop(1, '#0c0d1a');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
