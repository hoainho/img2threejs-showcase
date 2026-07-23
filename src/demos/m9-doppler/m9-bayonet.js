// createM9BayonetModel — procedural CS2 M9 Bayonet | Doppler Phase 2
// Code-only reconstruction from a broadside reference. No meshes, no art packs.
// Frame: long axis = X (+X = tip, -X = pommel), spine = +Y, edge = -Y, thickness = Z.
// Action-ready: root.userData.sculptRuntime = { nodes, sockets, colliders, destructionGroups }.
import * as THREE from 'three';

// ---------- dimensions (measured off the reference) ----------
const SPINE = 0.25, EDGE = -0.25, LB = 2.2;      // blade half-heights, length
const HR = 0.27, HL = 1.16;                       // grip radius, length

// ---------- blade silhouette ----------
function bladeOutline() {
  const p = [];
  // bottom edge, left -> right: straight cutting edge, then belly curving up to a fine tip
  p.push([0.00, EDGE], [0.10, EDGE], [1.55, EDGE]);
  p.push([1.78, -0.21], [1.98, -0.14], [2.12, -0.07], [LB, -0.03]);
  // top edge, right -> left: concave clip point down to the tip
  p.push([2.12, 0.05], [2.0, 0.13], [1.84, 0.20], [1.68, 0.24], [1.58, SPINE]);
  p.push([1.00, SPINE]);                           // flat spine (thumb-hole sits below here)
  // 10 deep rounded U sawteeth from x=0.95 down to 0.16 (right -> left)
  const hi = 1.0, lo = 0.16, n = 11, pitch = (hi - lo) / n, dep = 0.10;
  for (let k = 0; k < n; k++) {
    const xr = hi - k * pitch, xtl = xr - pitch * 0.22, g0 = xtl, g1 = xr - pitch;
    p.push([xr, SPINE], [xtl, SPINE]);             // narrow tooth crest
    for (let i = 1; i <= 12; i++) {                // wide shallow rounded scallop
      const t = i / 12;
      p.push([g0 + (g1 - g0) * t, SPINE - dep * Math.sin(Math.PI * t)]);
    }
  }
  p.push([0.12, SPINE], [0.00, SPINE]);            // ricasso top
  return p;
}

function thumbHole() {                             // horizontal stadium
  const path = new THREE.Path(), cx = 1.30, cy = 0.02, rx = 0.12, ry = 0.06;
  for (let i = 0; i <= 32; i++) {
    const a = (2 * Math.PI * i) / 32;
    // stadium: stretch the circle horizontally with flattened top/bottom
    const x = cx + rx * Math.cos(a), y = cy + ry * Math.sin(a) * (0.6 + 0.4 * Math.abs(Math.cos(a)));
    i === 0 ? path.moveTo(x, y) : path.lineTo(x, y);
  }
  return path;
}

function normalizeUVs(geo) {                       // u along length, v across height
  geo.computeBoundingBox();
  const bb = geo.boundingBox, pos = geo.attributes.position;
  const w = bb.max.x - bb.min.x, h = bb.max.y - bb.min.y, uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = (pos.getX(i) - bb.min.x) / w;
    uv[i * 2 + 1] = (pos.getY(i) - bb.min.y) / h;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

// ---------- noise ----------
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function valueNoise(cells, rnd) {
  const g = []; for (let i = 0; i < (cells + 1) * (cells + 1); i++) g.push(rnd());
  const s = t => t * t * (3 - 2 * t);
  return (x, y) => {
    x *= cells; y *= cells; const ix = Math.floor(x), iy = Math.floor(y), tx = s(x - ix), ty = s(y - iy);
    const at = (a, b) => g[((b % (cells + 1) + (cells + 1)) % (cells + 1)) * (cells + 1) + (a % (cells + 1) + (cells + 1)) % (cells + 1)];
    const a = at(ix, iy), b = at(ix + 1, iy), c = at(ix, iy + 1), d = at(ix + 1, iy + 1);
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
  };
}
function fbmMaker(rnd) {
  const oct = [valueNoise(3, rnd), valueNoise(7, rnd), valueNoise(15, rnd), valueNoise(31, rnd)];
  return (x, y) => oct[0](x, y) * 0.5 + oct[1](x, y) * 0.28 + oct[2](x, y) * 0.15 + oct[3](x, y) * 0.07;
}

function lerpHex(a, b, t) {
  const pa = [parseInt(a.slice(1, 3), 16), parseInt(a.slice(3, 5), 16), parseInt(a.slice(5, 7), 16)];
  const pb = [parseInt(b.slice(1, 3), 16), parseInt(b.slice(3, 5), 16), parseInt(b.slice(5, 7), 16)];
  return pa.map((v, i) => v + (pb[i] - v) * t);
}
function gradientAt(stops, u) {
  let i = 0; while (i < stops.length - 1 && u > stops[i + 1][0]) i++;
  const [t0, c0] = stops[i], [t1, c1] = stops[Math.min(i + 1, stops.length - 1)];
  const t = t1 > t0 ? (u - t0) / (t1 - t0) : 0;
  return lerpHex(c0, c1, Math.max(0, Math.min(1, t)));
}

// ---------- Doppler Phase 2 blade albedo ----------
function bladeAlbedo() {
  const w = 1536, h = 512, cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const c = cv.getContext('2d');
  const stops = [                                  // u = root(0) -> tip(1)
    [0.00, '#1e42c8'], [0.12, '#2f5cf2'], [0.28, '#5150ee'], [0.42, '#7042e6'],
    [0.54, '#7e39d8'], [0.64, '#6a3fe2'], [0.75, '#3f6fe0'], [0.88, '#22a6c4'], [1.00, '#33c2c8'],
  ];
  const rnd = mulberry32(20260722), fbm = fbmMaker(rnd), warp = fbmMaker(mulberry32(97));
  const img = c.createImageData(w, h), d = img.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const u = x / w, v = y / h, idx = (y * w + x) * 4;
    let col = gradientAt(stops, u);
    // domain-warped fbm -> wispy organic black smoke, densest in mid, thin at ends
    const wx = u + (warp(u * 2.2, v * 2.2) - 0.5) * 0.5, wy = v + (warp(u * 2.2 + 5, v * 2.2 + 5) - 0.5) * 0.5;
    const smoke = fbm(wx * 2.4, wy * 2.0);
    const band = Math.exp(-((u - 0.42) ** 2) / 0.14) * 0.9 + 0.25;
    let dark = Math.min(0.92, Math.pow(Math.max(0, smoke * band - 0.34), 1.35) * 2.8);
    col = col.map((ch, i) => ch * (1 - dark * (i === 2 ? 0.82 : 1)));
    // bright cyan sheen just under the teeth (spine side, v high)
    if (v > 0.80) { const s = (v - 0.80) / 0.20 * 0.55; col = [col[0] * (1 - s) + 120 * s, col[1] * (1 - s) + 235 * s, col[2] * (1 - s) + 250 * s]; }
    // primary grind: lower band slightly brighter/cooler
    if (v < 0.34) col = col.map((ch, i) => ch * (i === 2 ? 1.12 : 1.04));
    // bright sharpened edge (bottom 6%)
    if (v < 0.06) { const s = (0.06 - v) / 0.06; col = [col[0] * (1 - s) + 205 * s, col[1] * (1 - s) + 225 * s, col[2] * (1 - s) + 245 * s]; }
    d[idx] = col[0]; d[idx + 1] = col[1]; d[idx + 2] = col[2]; d[idx + 3] = 255;
  }
  c.putImageData(img, 0, 0);
  // grind line
  c.strokeStyle = 'rgba(180,210,255,0.35)'; c.lineWidth = 3;
  c.beginPath(); c.moveTo(w * 0.05, h * 0.66); c.lineTo(w * 0.98, h * 0.5); c.stroke();
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 16;
  return tex;
}

// ---------- knurled worn-gunmetal grip ----------
function gripMaps() {
  const w = 512, h = 256, alb = document.createElement('canvas'), bmp = document.createElement('canvas');
  alb.width = bmp.width = w; alb.height = bmp.height = h;
  const ca = alb.getContext('2d'), cb = bmp.getContext('2d');
  const rnd = mulberry32(55), fbm = fbmMaker(rnd);
  const img = ca.createImageData(w, h), d = img.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const u = x / w, v = y / h, i = (y * w + x) * 4;
    const m = fbm(u * 3, v * 3) * 0.7 + fbm(u * 9, v * 9) * 0.3;
    const g = 58 + m * 46;                         // blue-grey gunmetal, worn
    d[i] = g * 0.86; d[i + 1] = g * 0.94; d[i + 2] = g * 1.12; d[i + 3] = 255;
  }
  ca.putImageData(img, 0, 0);
  // scratches
  ca.strokeStyle = 'rgba(170,180,200,0.18)'; ca.lineWidth = 1;
  for (let k = 0; k < 60; k++) { const yy = rnd() * h, x0 = rnd() * w; ca.beginPath(); ca.moveTo(x0, yy); ca.lineTo(x0 + 20 + rnd() * 90, yy + (rnd() - 0.5) * 6); ca.stroke(); }
  // diamond knurl on the bump map (mid grey base, light diagonal cross-hatch)
  cb.fillStyle = '#808080'; cb.fillRect(0, 0, w, h);
  cb.strokeStyle = '#c8c8c8'; cb.lineWidth = 2;
  for (let o = -h; o < w; o += 14) { cb.beginPath(); cb.moveTo(o, 0); cb.lineTo(o + h, h); cb.stroke(); cb.beginPath(); cb.moveTo(o + h, 0); cb.lineTo(o, h); cb.stroke(); }
  // horizontal mid seam (brick split between top/bottom rows) darker
  cb.strokeStyle = '#404040'; cb.lineWidth = 5; cb.beginPath(); cb.moveTo(0, h / 2); cb.lineTo(w, h / 2); cb.stroke();
  const a = new THREE.CanvasTexture(alb); a.colorSpace = THREE.SRGBColorSpace;
  const b = new THREE.CanvasTexture(bmp); b.colorSpace = THREE.NoColorSpace;
  a.wrapS = a.wrapT = b.wrapS = b.wrapT = THREE.RepeatWrapping; a.repeat.set(3, 1); b.repeat.set(6, 1);
  a.anisotropy = b.anisotropy = 8;
  return { alb: a, bump: b };
}

function projectedTex(path) {                 // real reference crop projected onto geometry
  const tex = new THREE.TextureLoader().load(path, t => { t.needsUpdate = true; });
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 16;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

// planar (orthographic front) UV: map world x,y over a bbox to [0,1] — a flat side-view
// crop then reads correctly on the camera-facing surface (same idea as the blade).
function planarUV(geo, minx, maxx, miny, maxy) {
  const pos = geo.attributes.position, w = maxx - minx, h = maxy - miny;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = (pos.getX(i) - minx) / w;
    uv[i * 2 + 1] = (pos.getY(i) - miny) / h;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

function makeMaterials() {
  // patterns carry Valve's baked colour/lighting -> keep non-metallic; a clearcoat adds the
  // candy gloss on the blade without tinting the albedo through metalness.
  const doppler = new THREE.MeshPhysicalMaterial({
    map: projectedTex(import.meta.env.BASE_URL + 'm9-doppler/blade-fill.png'), metalness: 0.0, roughness: 0.34,
    clearcoat: 0.85, clearcoatRoughness: 0.07, envMapIntensity: 0.9,
  });
  const handleTex = new THREE.MeshPhysicalMaterial({
    map: projectedTex(import.meta.env.BASE_URL + 'm9-doppler/handle-fill.png'), metalness: 0.1, roughness: 0.62, envMapIntensity: 0.7,
  });
  const guardSteel = new THREE.MeshPhysicalMaterial({
    color: 0x2c3566, metalness: 0.85, roughness: 0.42,
    clearcoat: 0.5, clearcoatRoughness: 0.2, envMapIntensity: 1.15,
  });
  const grooveDark = new THREE.MeshStandardMaterial({ color: 0x14161c, metalness: 0.6, roughness: 0.6 });
  const pommelSteel = new THREE.MeshPhysicalMaterial({ color: 0x545a66, metalness: 0.8, roughness: 0.5, envMapIntensity: 1.1 });
  const tangCore = new THREE.MeshStandardMaterial({ color: 0x7d7358, metalness: 0.55, roughness: 0.7 });
  return { doppler, handleTex, guardSteel, grooveDark, pommelSteel, tangCore };
}

// ---------- traced blade (exact silhouette from reference) + sharp wedge cross-section ----------
function buildTracedBlade(bg, mat, options) {
  const top = bg.top, bot = bg.bot;
  const shape = new THREE.Shape();
  top.forEach(([x, y], i) => (i === 0 ? shape.moveTo(x, y) : shape.lineTo(x, y)));
  for (let i = bot.length - 1; i >= 0; i--) shape.lineTo(bot[i][0], bot[i][1]);
  shape.closePath();
  if (bg.hole) {
    const h = bg.hole, p = new THREE.Path();
    for (let i = 0; i <= 32; i++) {
      const a = (2 * Math.PI * i) / 32;
      const x = h.cx + h.rx * Math.cos(a), y = h.cy + h.ry * Math.sin(a);
      i === 0 ? p.moveTo(x, y) : p.lineTo(x, y);
    }
    shape.holes.push(p);
  }
  const depth = 0.048;                                  // thin blade (was too thick)
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: 0.005, bevelSize: 0.004, bevelSegments: 1, steps: 1 });
  g.translate(0, 0, -depth / 2 - 0.004);
  const interp = (arr, x) => {
    if (x <= arr[0][0]) return arr[0][1];
    if (x >= arr[arr.length - 1][0]) return arr[arr.length - 1][1];
    let lo = 0, hi = arr.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; arr[m][0] < x ? (lo = m) : (hi = m); }
    const t = (x - arr[lo][0]) / (arr[hi][0] - arr[lo][0]);
    return arr[lo][1] + (arr[hi][1] - arr[lo][1]) * t;
  };
  const sm = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const pos = g.attributes.position, L = bg.length;
  for (let i = 0; i < pos.count; i++) {                 // taper Z -> real wedge = sharp edge + point
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const yt = interp(top, x), yb = interp(bot, x), rng = Math.max(1e-4, yt - yb);
    const t = (y - yb) / rng;                            // 0 = cutting edge, 1 = spine
    // flat blade faces (smooth, no facets); only the thin bottom strip + tip taper to an edge
    let fz = sm(0, 0.16, t);                             // sharp cutting-edge strip
    const clip = sm(L * 0.74, L * 0.97, x);              // false-edge clip near the tip
    if (clip > 0) fz *= (1 - clip) + clip * sm(0, 0.16, 1 - t);
    pos.setZ(i, z * fz);
  }
  g.computeVertexNormals();
  normalizeUVs(g);
  return new THREE.Mesh(g, mat);
}

// ---------- model ----------
export function createM9BayonetModel(options = {}) {
  if (!options.geo) throw new Error('createM9BayonetModel requires options.geo (traced geo.json)');
  const mats = makeMaterials();
  const root = new THREE.Group(); root.name = 'M9 Bayonet | Doppler Phase 2';
  const nodes = { root }, meshes = {}, sockets = {}, colliders = {}, destructionGroups = {};
  const addNode = (id, parent, pos = [0, 0, 0], rot = [0, 0, 0]) => {
    const gp = new THREE.Group(); gp.name = id + '__pivot'; gp.position.set(...pos); gp.rotation.set(...rot);
    (nodes[parent] ?? root).add(gp); nodes[id] = gp; return gp;
  };
  const mesh = (geo, mat, parent, frac) => {
    const m = new THREE.Mesh(geo, mat); m.castShadow = options.castShadow ?? true; m.receiveShadow = options.receiveShadow ?? true;
    (nodes[parent] ?? root).add(m); if (frac) (destructionGroups[frac] ??= []).push(nodes[parent]); return m;
  };

  // --- Blade: exact traced silhouette + sharp wedge cross-section, ricasso tucked into guard ---
  addNode('blade', 'root', [-0.075, 0, 0]);   // base plugs left into the crossguard (no gap)
  const bblade = buildTracedBlade(options.geo.blade, mats.doppler, options);
  bblade.castShadow = options.castShadow ?? true; bblade.receiveShadow = options.receiveShadow ?? true;
  nodes.blade.add(bblade); meshes['blade'] = bblade; (destructionGroups['blade'] ??= []).push(nodes.blade);
  const L = options.geo.blade.length;
  colliders['blade'] = { type: 'box', size: [L, 0.5, 0.1] };
  const tip = new THREE.Object3D(); tip.name = 'tip'; tip.position.set(L, 0, 0); nodes.blade.add(tip); sockets['blade:tip'] = tip;

  // --- Guard (traced from ref: SLIM crossguard, small ring on a neck, short quillon) ---
  // Ref measurements (world, blade len 2.2): plate ~0.11 wide x 0.52 tall, centered worldX -0.126;
  // ring outer R 0.05 top at worldY +0.578; lower quillon width 0.08 down to worldY -0.46.
  const hg = options.geo.handle, R = hg.radius;
  addNode('guard', 'root', [hg.rightX / 2, 0, 0]);            // world x -0.128, centered in the gap
  // THIN crossguard plate (ref plate is only ~0.09-0.14 wide). Parts are joined by the handle
  // collar + blade ricasso PLUGGING INTO this plate — not by fattening the plate itself.
  meshes['crossguard'] = mesh(new THREE.BoxGeometry(0.14, 0.52, 0.11), mats.guardSteel, 'guard', 'guard');
  meshes['crossguard'].position.y = 0.03;                    // plate spans worldY +0.29..-0.23
  // steel collar bridging the rubber grip end (-0.2555) into the crossguard's left face (no gap)
  const collar = mesh(new THREE.CylinderGeometry(R * 0.72, R * 0.82, 0.12, 28), mats.guardSteel, 'guard', 'guard');
  collar.rotation.z = Math.PI / 2; collar.position.set(-0.1, 0, 0);   // world x -0.228..-0.128
  // short neck rising to the ring
  const neck = mesh(new THREE.CylinderGeometry(0.022, 0.028, 0.20, 20), mats.guardSteel, 'guard', 'guard');
  neck.position.set(0, 0.37, 0);
  // muzzle ring: small torus (traced outer R 0.05), sits just above the spine
  const ring = mesh(new THREE.TorusGeometry(0.05, 0.016, 20, 48), mats.guardSteel, 'guard', 'guard');
  ring.position.set(0, 0.52, 0); colliders['muzzleRing'] = { type: 'torus', radius: 0.05, tube: 0.016 };
  // short lower quillon peg
  const quill = mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.20, 20), mats.guardSteel, 'guard', 'guard');
  quill.position.set(0, -0.33, 0);

  // --- Handle: single grip cylinder with the REAL grip texture planar-projected, + groove
  //     rings for relief + pommel cap with exposed tang core. Spans traced world x. ---
  addNode('grip', 'root', [0, 0, 0]);
  const cx = (hg.leftX + hg.rightX) / 2, nSeg = 8;
  const gripGeo = new THREE.CylinderGeometry(R, R, hg.length, 48, 176); gripGeo.rotateZ(Math.PI / 2); gripGeo.translate(cx, 0, 0);
  {                                                     // bulge each of the 8 stacked segments (relief)
    const p = gripGeo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const frac = ((x - hg.leftX) / hg.length) * nSeg % 1;
      const bulge = 1 + 0.06 * Math.sin(Math.PI * (frac < 0 ? frac + 1 : frac));
      p.setY(i, y * bulge); p.setZ(i, z * bulge);
    }
    gripGeo.computeVertexNormals();
  }
  planarUV(gripGeo, hg.leftX, hg.rightX, -R, R);
  const gripMesh = new THREE.Mesh(gripGeo, mats.handleTex);
  gripMesh.castShadow = gripMesh.receiveShadow = true; nodes.grip.add(gripMesh); meshes['grip'] = gripMesh;
  (destructionGroups['handle'] ??= []).push(nodes.grip);
  colliders['grip'] = { type: 'capsule', radius: R, height: hg.length };
  const gr = new THREE.Object3D(); gr.name = 'grip-root'; gr.position.set(hg.rightX, 0, 0); nodes.grip.add(gr); sockets['grip:root'] = gr;
  for (let i = 1; i < 8; i++) {                               // segment groove rings
    const rr = new THREE.Mesh(new THREE.TorusGeometry(R * 1.008, 0.007, 8, 44), mats.grooveDark);
    rr.rotation.y = Math.PI / 2; rr.position.x = hg.leftX + (i * hg.length) / 8; nodes.grip.add(rr);
  }
  // pommel cap + exposed tang core at the butt (left end)
  addNode('pommel', 'grip', [0, 0, 0]);
  const pcap = new THREE.CylinderGeometry(R * 1.06, R * 0.98, 0.08, 40); pcap.rotateZ(Math.PI / 2);
  mesh(pcap, mats.pommelSteel, 'pommel', 'handle').position.set(hg.leftX + 0.02, 0, 0);
  const core = new THREE.Mesh(new THREE.CircleGeometry(R * 0.6, 32), mats.tangCore);
  core.rotation.y = -Math.PI / 2; core.position.set(hg.leftX - 0.02, 0, 0); nodes.pommel.add(core); meshes['tangCore'] = core;

  // ---------- runtime rigging ----------
  // adjacency = pairs of parts that MUST physically touch (bbox overlap along the join axis).
  // A connectivity validator reads this to fail the build if any joint floats. See
  // grimoire/readiness/joint_attachment.md.
  const adjacency = [
    { a: 'grip', b: 'guard', axis: 'x' },
    { a: 'guard', b: 'blade', axis: 'x' },
  ];
  root.userData.sculptRuntime = { nodes, meshes, sockets, colliders, destructionGroups, adjacency };
  root.userData.actionAnchors = { gripPivot: nodes.grip, balancePivot: nodes.guard, throwFrom: sockets['grip:root'], stab: sockets['blade:tip'] };
  root.userData.actionReadiness = { note: 'nodes=pivots; sockets=attach points; colliders=physics proxies; destructionGroups blade/handle/guard snap the tang seam.' };

  const box = new THREE.Box3().setFromObject(root); root.position.sub(box.getCenter(new THREE.Vector3()));
  return root;
}
export default createM9BayonetModel;
