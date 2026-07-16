import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

// ---------------------------------------------------------------------------
// Beach Character 08 — stylized low-poly, action-ready procedural factory.
// Hand-authored (refine-code) from sculpt/spec.json. Feet at y=0, +Y up,
// +Z front, ~1.75 m tall. All meshes live under named pivot Groups so the
// rig stays animation/detach ready; runtime maps on root.userData.sculptRuntime.
// ---------------------------------------------------------------------------

export type ProceduralModelOptions = {
  castShadow?: boolean;
  receiveShadow?: boolean;
};

export type ProceduralModelRuntime = {
  nodes: Record<string, THREE.Object3D>;
  meshes: Record<string, THREE.Mesh>;
  sockets: Record<string, THREE.Object3D>;
  colliders: Record<string, unknown>;
  destructionGroups: Record<string, THREE.Object3D[]>;
};

const COL = {
  jersey: '#a9c6d6',
  denim: '#7fa0c4',
  denimDark: '#5c7fa6',
  clog: '#e9e6dd',
  tote: '#1e1e20',
  strap: '#ededea',
  skin: '#e7c3a6',
  hair: '#15161c',
  black: '#101014',
};

function std(color: string, roughness: number, metalness = 0.0) {
  return new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness, metalness });
}

// deterministic grayscale fabric bump (no Math.random) — tactile weave under grazing light
function fabricBump(kind: 'weave' | 'twill' | 'canvas'): THREE.Texture {
  const N = 256;
  const c = document.createElement('canvas'); c.width = N; c.height = N;
  const g = c.getContext('2d')!;
  const img = g.createImageData(N, N);
  const h = (x: number, y: number) => {
    const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
    return s - Math.floor(s);
  };
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      let v: number;
      if (kind === 'weave') v = 0.5 + 0.5 * Math.sin(x * 1.4) * Math.sin(y * 1.4) + (h(x, y) - 0.5) * 0.25;
      else if (kind === 'twill') v = 0.5 + 0.35 * Math.sin((x + y) * 0.9) + (h(x, y) - 0.5) * 0.2;
      else v = 0.5 + 0.4 * (Math.sin(x * 0.8) * 0.5 + Math.sin(y * 0.8) * 0.5) + (h(x, y) - 0.5) * 0.3;
      const p = (y * N + x) * 4; const c8 = Math.max(0, Math.min(255, v * 255));
      img.data[p] = img.data[p + 1] = img.data[p + 2] = c8; img.data[p + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(6, 6);
  return t;
}

// canvas texture for the chest graphic: HARD BALL / 08 / ORBIT
function chestGraphicTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 512;
  const g = c.getContext('2d')!;
  g.fillStyle = COL.jersey; g.fillRect(0, 0, 512, 512);
  g.textAlign = 'center';
  g.fillStyle = '#f4f7f8';
  g.font = 'bold 46px Arial';
  g.fillText('HARD', 150, 150);
  g.fillText('BALL', 372, 150);
  // big 08 with soft outline
  g.font = 'bold 260px Arial Black, Arial';
  g.lineWidth = 10; g.strokeStyle = '#7fa7bd';
  g.strokeText('08', 256, 380);
  g.fillStyle = '#fbfdfd';
  g.fillText('08', 256, 380);
  g.font = 'bold 60px Arial Black, Arial';
  g.fillStyle = '#f2a93b';
  g.fillText('ORBIT', 256, 440);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function swooshTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = COL.tote; g.fillRect(0, 0, 256, 256);
  g.strokeStyle = '#f5f5f2'; g.lineWidth = 22; g.lineCap = 'round';
  g.beginPath();
  g.moveTo(40, 170);
  g.quadraticCurveTo(120, 200, 210, 70);
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createBeachCharacter08Model(options: ProceduralModelOptions = {}): THREE.Group {
  const castShadow = options.castShadow ?? true;
  const receiveShadow = options.receiveShadow ?? true;

  const root = new THREE.Group();
  root.name = 'Beach Character 08';

  const runtime: ProceduralModelRuntime = {
    nodes: {}, meshes: {}, sockets: {}, colliders: {}, destructionGroups: {},
  };

  const mats = {
    jersey: std(COL.jersey, 0.86),
    denim: std(COL.denim, 0.82),
    clog: std(COL.clog, 0.5),
    tote: (() => { const m = std('#ffffff', 0.78); m.map = swooshTexture(); return m; })(),
    strap: std(COL.strap, 0.7),
    skin: std(COL.skin, 0.62),
    hair: std(COL.hair, 0.42),
    black: std(COL.black, 0.32, 0.1),
  };
  const chestMat = (() => { const m = std('#ffffff', 0.86); m.map = chestGraphicTexture(); return m; })();

  // material locality: tactile fabric bump so cloth is not flat plastic under grazing light
  mats.jersey.bumpMap = fabricBump('weave'); mats.jersey.bumpScale = 0.012;
  mats.denim.bumpMap = fabricBump('twill'); mats.denim.bumpScale = 0.02;
  mats.tote.bumpMap = fabricBump('canvas'); mats.tote.bumpScale = 0.02;
  chestMat.bumpMap = mats.jersey.bumpMap; chestMat.bumpScale = 0.008;

  // helper: named pivot group at a local origin
  function pivot(name: string, x: number, y: number, z: number, parent: THREE.Object3D = root) {
    const g = new THREE.Group();
    g.name = name; g.position.set(x, y, z);
    parent.add(g);
    runtime.nodes[name] = g;
    return g;
  }
  // helper: add a mesh (centered at `pos` relative to `parent`)
  function mesh(id: string, geo: THREE.BufferGeometry, mat: THREE.Material,
                parent: THREE.Object3D, pos: [number, number, number] = [0, 0, 0]) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(...pos);
    m.castShadow = castShadow; m.receiveShadow = receiveShadow;
    m.name = id; parent.add(m); runtime.meshes[id] = m;
    return m;
  }
  function socket(id: string, parent: THREE.Object3D, pos: [number, number, number]) {
    const s = new THREE.Object3D(); s.name = id; s.position.set(...pos);
    parent.add(s); runtime.sockets[id] = s; return s;
  }
  // capsule limb from a→b in parent-local space
  function limb(id: string, parent: THREE.Object3D, a: [number, number, number],
                b: [number, number, number], radius: number, mat: THREE.Material) {
    const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b);
    const len = va.distanceTo(vb);
    const geo = new THREE.CapsuleGeometry(radius, Math.max(0.001, len - radius * 2), 6, 12);
    const g = new THREE.Group();
    g.position.copy(va);
    const dir = vb.clone().sub(va).normalize();
    g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    const m = new THREE.Mesh(geo, mat);
    m.position.y = len / 2;
    m.castShadow = castShadow; m.receiveShadow = receiveShadow; m.name = id;
    g.add(m); parent.add(g);
    runtime.meshes[id] = m; runtime.nodes[id] = g;
    return g;
  }

  // ---- lower body ----------------------------------------------------------
  // hips pivot sits at the world origin; children below use world-space Y
  // (legs are parented to root with absolute coords, so keep hips at 0).
  const hips = pivot('hips', 0, 0, 0);
  runtime.colliders['body'] = { type: 'capsule', height: 1.75, radius: 0.28 };

  // legs: left weight-bearing straight; right slightly forward
  const legDefs: Array<[string, number, number]> = [['l', -0.11, 0.0], ['r', 0.12, 0.12]];
  for (const [s, x, zf] of legDefs) {
    limb(`thigh-${s}`, root, [x, 0.86, zf * 0.4], [x, 0.47, zf * 0.7], 0.09, mats.skin);
    limb(`shin-${s}`, root, [x, 0.47, zf * 0.7], [x, 0.09, zf], 0.07, mats.skin);
    // clog
    const clog = pivot(`clog-${s}`, x, 0.045, zf + 0.06);
    mesh(`clog-${s}-body`, new RoundedBoxGeometry(0.13, 0.075, 0.28, 3, 0.035), mats.clog, clog);
    mesh(`clog-${s}-strap`, new THREE.TorusGeometry(0.06, 0.014, 6, 12, Math.PI),
         mats.clog, clog, [0, 0.02, -0.09]);
    runtime.destructionGroups[`clog-${s}`] = [clog];
  }

  // shorts (baggy denim, knee length) over the hips
  const shorts = pivot('shorts', 0, 0.78, 0.02, hips);
  mesh('shorts-block', new RoundedBoxGeometry(0.44, 0.5, 0.34, 3, 0.05), mats.denim, shorts, [0, 0, 0]);
  mesh('shorts-inseam', new THREE.BoxGeometry(0.02, 0.34, 0.34), std(COL.denimDark, 0.85), shorts, [0, -0.08, 0.01]);
  runtime.destructionGroups['shorts'] = [shorts];

  // ---- torso + oversized jersey -------------------------------------------
  const chest = pivot('chest', 0, 1.0, 0, hips);
  // oversized boxy jersey drape (wider than shoulders, hangs over shorts top)
  const jerseyGeo = new RoundedBoxGeometry(0.5, 0.56, 0.32, 4, 0.07);
  const jerseyTorso = mesh('jersey-torso', jerseyGeo, mats.jersey, chest, [0, 0.26, 0]);
  jerseyTorso.scale.set(1.0, 1.0, 1.0);
  // slight drape: widen the hem so it reads as loose cloth over the shorts
  mesh('jersey-hem', new RoundedBoxGeometry(0.54, 0.12, 0.34, 3, 0.05), mats.jersey, chest, [0, 0.02, 0]);
  // chest graphic plane on the front
  mesh('jersey-graphic', new THREE.PlaneGeometry(0.34, 0.34), chestMat, chest, [0, 0.24, 0.161]);
  // v-neck hint
  const collar = mesh('jersey-collar', new THREE.TorusGeometry(0.06, 0.02, 6, 16, Math.PI),
                      std('#93b6c8', 0.8), chest, [0, 0.5, 0.13]);
  collar.rotation.z = Math.PI;
  runtime.destructionGroups['jersey'] = [runtime.meshes['jersey-torso']];

  // shoulders + arms
  const shoulderY = 0.48; // local to chest
  const armDefs: Array<[string, [number, number, number], [number, number, number]]> = [
    // left arm hangs down and slightly out
    ['l', [-0.30, 0.16, 0.02], [-0.34, -0.10, 0.05]],
    // right arm bent, hand toward hip/pocket
    ['r', [0.30, 0.16, 0.03], [0.16, -0.06, 0.12]],
  ];
  for (const [s, elbow, hand] of armDefs) {
    const sx = s === 'l' ? -0.26 : 0.26;
    socket(`shoulder-${s}`, chest, [sx, shoulderY, 0]);
    // sleeve (jersey) shoulder→elbow
    limb(`sleeve-${s}`, chest, [sx, shoulderY - 0.02, 0], elbow, 0.075, mats.jersey);
    // forearm (skin) elbow→hand
    limb(`forearm-${s}`, chest, elbow, hand, 0.05, mats.skin);
    // hand
    mesh(`hand-${s}`, new THREE.SphereGeometry(0.055, 12, 10), mats.skin, chest, hand);
  }

  // ---- neck + head ---------------------------------------------------------
  const neck = pivot('neck', 0, 1.5, 0, hips);
  mesh('neck', new THREE.CylinderGeometry(0.05, 0.06, 0.1, 12), mats.skin, neck, [0, 0.04, 0]);
  const head = pivot('head', 0, 1.6, 0, hips);
  head.rotation.y = -0.12; // slight turn toward camera-left, as in the reference
  head.rotation.z = 0.03;
  const headMesh = mesh('head', new THREE.SphereGeometry(0.1, 24, 18), mats.skin, head, [0, 0.06, 0]);
  headMesh.scale.set(0.92, 1.08, 0.98);
  // hair cap (covers top + back, fringe front)
  const hair = mesh('hair', new THREE.SphereGeometry(0.108, 20, 16,
    0, Math.PI * 2, 0, Math.PI * 0.62), mats.hair, head, [0, 0.075, -0.005]);
  hair.scale.set(1.02, 1.05, 1.03);
  mesh('hair-fringe', new THREE.BoxGeometry(0.19, 0.05, 0.06), mats.hair, head, [0, 0.11, 0.075]);
  // glasses: bridge + two rims
  const glasses = pivot('glasses', 0, 1.64, 0.085, hips);
  runtime.destructionGroups['glasses'] = [glasses];
  mesh('glasses-bridge', new THREE.BoxGeometry(0.05, 0.012, 0.012), mats.black, glasses);
  for (const gx of [-0.05, 0.05]) {
    mesh(`glasses-rim-${gx < 0 ? 'l' : 'r'}`,
         new THREE.TorusGeometry(0.032, 0.008, 8, 16), mats.black, glasses, [gx, 0, 0]);
  }
  socket('glasses_nose', head, [0, 0.04, 0.1]);

  // ---- crossbody tote bag --------------------------------------------------
  socket('shoulder_bag', chest, [0.22, shoulderY, 0.04]);
  // strap: right shoulder → left hip
  limb('bag-strap', chest, [0.2, shoulderY, 0.06], [-0.22, -0.12, 0.14], 0.012, mats.strap);
  const bag = pivot('tote-bag', -0.24, 0.82, 0.14, hips);
  mesh('tote-body', new RoundedBoxGeometry(0.24, 0.32, 0.09, 3, 0.03), mats.tote, bag);
  runtime.destructionGroups['tote-bag'] = [bag];

  // ---- wrist accessories ---------------------------------------------------
  mesh('watch', new THREE.BoxGeometry(0.045, 0.02, 0.05), mats.black,
       runtime.nodes['forearm-l'], [0, 0.2, 0.02]);
  mesh('bracelet', new THREE.TorusGeometry(0.03, 0.008, 8, 16), mats.clog,
       runtime.nodes['forearm-r'], [0, 0.16, 0]);

  root.userData.sculptRuntime = runtime;
  return root;
}

// ---------------------------------------------------------------------------
// Look-dev lights (overcast dusk beach). neutral | grazing | reference.
// ---------------------------------------------------------------------------
export function createBeachCharacter08LookDevLights(
  mode: 'neutral' | 'grazing' | 'reference' = 'neutral',
): THREE.Group {
  const lights = new THREE.Group();
  lights.name = 'lookdev-lights';
  const hemi = new THREE.HemisphereLight(
    mode === 'reference' ? 0xcfd6dc : 0xdfe6f2, 0x6e6a62,
    mode === 'grazing' ? 0.35 : 0.9);
  lights.add(hemi);
  const key = new THREE.DirectionalLight(
    mode === 'reference' ? 0xffd9a0 : 0xfff2e2, mode === 'grazing' ? 3.2 : 1.9);
  if (mode === 'grazing') key.position.set(6, 1.4, 4);
  else if (mode === 'reference') key.position.set(4.5, 6.5, 4.0); // sun break upper-right
  else key.position.set(3.5, 6, 5);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 0.5; key.shadow.camera.far = 20;
  (key.shadow.camera as THREE.OrthographicCamera).left = -3;
  (key.shadow.camera as THREE.OrthographicCamera).right = 3;
  (key.shadow.camera as THREE.OrthographicCamera).top = 3;
  (key.shadow.camera as THREE.OrthographicCamera).bottom = -1;
  key.shadow.bias = -0.0003;
  lights.add(key);
  const fill = new THREE.DirectionalLight(0xa8c4ff, 0.4);
  fill.position.set(-4, 3, 3.5);
  lights.add(fill);
  const rim = new THREE.DirectionalLight(0xfff1c4, mode === 'grazing' ? 0.3 : 0.7);
  rim.position.set(0.5, 4.5, -6);
  lights.add(rim);
  return lights;
}
