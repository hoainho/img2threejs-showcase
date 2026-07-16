import * as THREE from 'three';

/**
 * GERBER Paracord Knife — a skeletonized full-tang tactical fixed-blade with a bright
 * orange kernmantle-paracord wrapped handle, rebuilt in code from a single studio
 * reference sheet (img2threejs).
 *
 * Faithful to the reference identity systems:
 *  - Modified-TANTO blade: straight spine + angled clip to a robust point, deep swept belly,
 *    black-oxide / stonewash PVD finish (cloudy mottled specular) with a bright SATIN edge bevel.
 *  - Spine JIMPING: a row of ~9 filework notches for thumb grip near the ricasso.
 *  - Brand ETCH: "GERBER" wordmark + the sword/anchor emblem on the flat, and a vertical
 *    serial "3012863D" micro-etch on the ricasso (light-gray laser marks, both faces).
 *  - Skeletonized full-TANG frame: forward lashing slot + ricasso hole cut through the slab,
 *    tapering into a faceted HEX POMMEL with a lanyard hole.
 *  - PARACORD wrap: a ~13-turn helix of orange-red rope hugging the flat tang (flattened-oval
 *    coil), a woven herringbone braid texture with a slight nylon sheen, finished by an
 *    overhand KNOT and two loose TAILS ending in melted/glued translucent tips.
 *
 * VFX via root.userData.tick(dt, elapsed): a slow studio "display" rock (yaw oscillation +
 * gentle bob) so the stonewash specular and the woven cord catch travelling highlights.
 *
 * Action-ready: exposes root.userData.sculptRuntime with named nodes, sockets and materials.
 */

export interface GerberKnifeOptions {
  /** overall scale multiplier (default 1) */
  scale?: number;
  /** enable cast/receive shadows (default true) */
  shadows?: boolean;
  /** enable the idle display rock (default true) */
  animate?: boolean;
}

// ---------------------------------------------------------------------------
// palette (sampled from the reference)
// ---------------------------------------------------------------------------
const BLADE_DARK = 0x31353b; // black-oxide / stonewash body
const BLADE_EDGE = 0x9aa0a8; // bright satin secondary bevel
const STEEL_BARE = 0xd7dbe1; // bright bare polished steel — the sharpened edge bevel
const ETCH_GRAY = 0xdfe3e8; // laser-etch light gray
const CORD_ORANGE = 0xbc4526; // kernmantle base orange-red
const CORD_ORANGE_HI = 0xe07a3f; // raised strand highlight
const CORD_ORANGE_LO = 0x6f2814; // recessed weave shadow
const CORD_TIP = 0xc9ab72; // melted/glued translucent amber tip

// ---------------------------------------------------------------------------
// deterministic PRNG (skill requires seeded procedural noise)
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

// ---------------------------------------------------------------------------
// canvas texture helpers
// ---------------------------------------------------------------------------
function newCanvas(w: number, h: number): { cv: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  return { cv, ctx: cv.getContext('2d')! };
}

function hex(c: number): string {
  return '#' + c.toString(16).padStart(6, '0');
}

/** Cloudy stonewash / black-oxide patina used as the blade roughness+bump breakup. */
function makeStonewashTexture(): THREE.CanvasTexture {
  const S = 512;
  const { cv, ctx } = newCanvas(S, S);
  const rand = mulberry32(0x9e3b17);
  // mid-gray base = mid roughness
  ctx.fillStyle = '#8a8a8a';
  ctx.fillRect(0, 0, S, S);
  // soft cloudy blotches (some glossier, some more matte) — higher contrast stonewash
  for (let i = 0; i < 200; i++) {
    const x = rand() * S;
    const y = rand() * S;
    const r = 18 + rand() * 100;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const v = rand() > 0.5 ? 40 + rand() * 45 : 170 + rand() * 80;
    g.addColorStop(0, `rgba(${v},${v},${v},${0.3 + rand() * 0.45})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // fine grinding scratches (mostly along the blade length = horizontal)
  ctx.globalAlpha = 0.10;
  for (let i = 0; i < 260; i++) {
    const y = rand() * S;
    ctx.strokeStyle = rand() > 0.5 ? '#c8c8c8' : '#4a4a4a';
    ctx.lineWidth = 0.6 + rand() * 1.1;
    ctx.beginPath();
    ctx.moveTo(0, y + (rand() - 0.5) * 6);
    ctx.lineTo(S, y + (rand() - 0.5) * 6);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 1);
  return tex;
}

/** Kernmantle braid — a fine diagonal herringbone. Returns matching albedo + bump canvases. */
function makeCordTextures(): { albedo: THREE.CanvasTexture; bump: THREE.CanvasTexture } {
  const W = 256;
  const H = 128;
  const a = newCanvas(W, H);
  const b = newCanvas(W, H);
  a.ctx.fillStyle = hex(CORD_ORANGE);
  a.ctx.fillRect(0, 0, W, H);
  b.ctx.fillStyle = '#808080';
  b.ctx.fillRect(0, 0, W, H);

  // herringbone: two mirrored families of bold diagonal strands (kernmantle braid)
  const strand = 13; // px between strands (bolder, clearly visible)
  const draw = (dir: 1 | -1, yTop: number, yBot: number) => {
    const dx = yBot - yTop;
    for (let k = -H; k < W + H; k += strand) {
      // albedo strand: bright rounded core between dark valleys
      const grad = a.ctx.createLinearGradient(k, yTop, k + dir * dx, yBot);
      grad.addColorStop(0.0, hex(CORD_ORANGE_LO));
      grad.addColorStop(0.5, hex(CORD_ORANGE_HI));
      grad.addColorStop(1.0, hex(CORD_ORANGE_LO));
      a.ctx.strokeStyle = grad;
      a.ctx.lineCap = 'round';
      a.ctx.lineWidth = 7.5;
      a.ctx.beginPath();
      a.ctx.moveTo(k, yTop);
      a.ctx.lineTo(k + dir * dx, yBot);
      a.ctx.stroke();
      // bump strand: raised ridge (white) flanked by dark valley
      b.ctx.strokeStyle = '#f2f2f2';
      b.ctx.lineWidth = 5.0;
      b.ctx.beginPath();
      b.ctx.moveTo(k, yTop);
      b.ctx.lineTo(k + dir * dx, yBot);
      b.ctx.stroke();
      b.ctx.strokeStyle = '#161616';
      b.ctx.lineWidth = 2.4;
      b.ctx.beginPath();
      b.ctx.moveTo(k + 5.0, yTop);
      b.ctx.lineTo(k + 5.0 + dir * dx, yBot);
      b.ctx.stroke();
    }
  };
  // top half leans one way, bottom half the other → chevron weave
  draw(1, 0, H / 2);
  draw(-1, H / 2, H);

  const albedo = new THREE.CanvasTexture(a.cv);
  albedo.colorSpace = THREE.SRGBColorSpace;
  albedo.wrapS = albedo.wrapT = THREE.RepeatWrapping;
  const bump = new THREE.CanvasTexture(b.cv);
  bump.wrapS = bump.wrapT = THREE.RepeatWrapping;
  return { albedo, bump };
}

/** Transparent decal canvas → texture for a face overlay (etch marks). */
function etchTexture(
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
  w: number,
  h: number,
): THREE.CanvasTexture {
  const { cv, ctx } = newCanvas(w, h);
  draw(ctx, w, h);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

// ---------------------------------------------------------------------------
// blade / tang profile (XY plane; extruded along Z). +X = tip, -X = pommel.
// ---------------------------------------------------------------------------
const SPINE_Y = 0.24;
const EDGE_Y = -0.24;
const TANG_TOP = 0.19;
const TANG_BOT = -0.19;

/** Outline points for the cutting edge (choil → belly → tip), used for the satin edge strip. */
const EDGE_PATH: Array<[number, number]> = [];

function buildBladeTangShape(): THREE.Shape {
  const s = new THREE.Shape();
  // Start at ricasso spine, go clockwise around blade to the tip, down the edge,
  // back through the choil into the tang, around the hex pommel, and close.
  s.moveTo(0.0, SPINE_Y);
  s.lineTo(1.30, SPINE_Y + 0.02); // straight spine, slight rise
  s.lineTo(1.52, SPINE_Y + 0.03); // spine shoulder before the clip
  s.lineTo(2.16, -0.055); // angled tanto clip down to the point
  // belly: point → deep swept curve → plunge/choil
  s.quadraticCurveTo(1.55, -0.34, 0.78, -0.255);
  s.quadraticCurveTo(0.5, -0.225, 0.36, -0.205); // toward ricasso edge
  s.lineTo(0.16, -0.20); // sharpening choil shoulder
  s.quadraticCurveTo(0.06, -0.185, 0.02, EDGE_Y + 0.02); // small choil dip
  // into the tang (bottom edge)
  s.lineTo(-0.06, TANG_BOT);
  s.lineTo(-1.86, TANG_BOT + 0.01);
  // faceted hex pommel (bottom → back → top)
  s.lineTo(-2.02, TANG_BOT - 0.02);
  s.lineTo(-2.20, -0.11);
  s.lineTo(-2.30, 0.0);
  s.lineTo(-2.20, 0.11);
  s.lineTo(-2.02, TANG_TOP + 0.02);
  s.lineTo(-1.86, TANG_TOP - 0.01);
  // tang top edge back to ricasso spine
  s.lineTo(-0.06, TANG_TOP);
  s.lineTo(0.0, SPINE_Y);

  // record the sharpened edge polyline (point → choil) for the bright bevel strip
  EDGE_PATH.length = 0;
  const pts: Array<[number, number]> = [
    [2.16, -0.055],
    [1.9, -0.2],
    [1.55, -0.30],
    [1.2, -0.33],
    [0.9, -0.315],
    [0.6, -0.255],
    [0.36, -0.205],
    [0.16, -0.20],
  ];
  for (const p of pts) EDGE_PATH.push(p);

  // skeletonizing holes
  const forwardSlot = new THREE.Path();
  addRoundedSlot(forwardSlot, -0.42, 0.0, 0.20, 0.11);
  s.holes.push(forwardSlot);

  const ricassoHole = new THREE.Path();
  ricassoHole.absarc(-0.12, 0.0, 0.052, 0, Math.PI * 2, true);
  s.holes.push(ricassoHole);

  const pommelHole = new THREE.Path();
  pommelHole.absarc(-2.13, 0.0, 0.062, 0, Math.PI * 2, true);
  s.holes.push(pommelHole);

  return s;
}

/** Append an axis-aligned rounded slot (obround) to a Path, centered at (cx,cy). */
function addRoundedSlot(path: THREE.Path, cx: number, cy: number, len: number, thick: number): void {
  const r = thick / 2;
  const hx = len / 2 - r;
  // clockwise for a hole
  path.absarc(cx - hx, cy, r, Math.PI / 2, -Math.PI / 2, true);
  path.absarc(cx + hx, cy, r, -Math.PI / 2, Math.PI / 2, true);
}

// ---------------------------------------------------------------------------
// paracord helix — one long tube coiled around the flat tang
// ---------------------------------------------------------------------------
function buildCordCurve(): THREE.CatmullRomCurve3 {
  const rand = mulberry32(0x0c07d0);
  const pts: THREE.Vector3[] = [];

  const xStart = -0.5;
  const xEnd = -1.84;
  const turns = 15;
  const per = 28; // samples per turn
  const Ry = 0.25; // oval half-height (over the tang top/bottom edges)
  const Rz = 0.115; // oval half-depth (front/back faces)

  const total = turns * per;
  for (let i = 0; i <= total; i++) {
    const f = i / total;
    const theta = f * turns * Math.PI * 2;
    const x = xStart + (xEnd - xStart) * f;
    // hand-wrapped jitter
    const jy = (rand() - 0.5) * 0.012;
    const jz = (rand() - 0.5) * 0.010;
    const y = Ry * Math.sin(theta) + jy;
    const z = Rz * Math.cos(theta) + jz;
    pts.push(new THREE.Vector3(x, y, z));
  }
  const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.5);
  return curve;
}

/** A short overhand-knot + two tails past the pommel (approximate pretzel cluster). */
function buildKnotCurve(): THREE.CatmullRomCurve3 {
  // stylized knot near the pommel then two divergent tails toward -X
  const p: THREE.Vector3[] = [
    new THREE.Vector3(-1.82, 0.24, 0.02),
    new THREE.Vector3(-1.95, 0.16, 0.14),
    new THREE.Vector3(-2.12, 0.02, 0.16),
    new THREE.Vector3(-2.24, -0.12, 0.02),
    new THREE.Vector3(-2.18, -0.10, -0.14),
    new THREE.Vector3(-2.0, 0.04, -0.16),
    new THREE.Vector3(-1.9, 0.14, -0.05),
    new THREE.Vector3(-2.02, 0.06, 0.08),
    new THREE.Vector3(-2.2, -0.02, 0.12),
    new THREE.Vector3(-2.45, 0.04, 0.05), // tail A end (up)
  ];
  return new THREE.CatmullRomCurve3(p, false, 'catmullrom', 0.4);
}

function buildTailCurve(): THREE.CatmullRomCurve3 {
  const p: THREE.Vector3[] = [
    new THREE.Vector3(-2.18, -0.04, -0.02),
    new THREE.Vector3(-2.34, -0.12, 0.02),
    new THREE.Vector3(-2.5, -0.2, 0.03),
    new THREE.Vector3(-2.66, -0.24, 0.02), // tail B end (down)
  ];
  return new THREE.CatmullRomCurve3(p, false, 'catmullrom', 0.4);
}

// ---------------------------------------------------------------------------
// factory
// ---------------------------------------------------------------------------
export function createGerberKnifeModel(options: GerberKnifeOptions = {}): THREE.Group {
  const scale = options.scale ?? 1;
  const shadows = options.shadows ?? true;
  const animate = options.animate ?? true;

  const root = new THREE.Group();
  root.name = 'gerber-knife';

  const nodes: Record<string, THREE.Object3D> = {};
  const sockets: Record<string, THREE.Object3D> = {};

  const THICK = 0.12;

  // ---- shared textures / materials -----------------------------------------
  const stonewash = makeStonewashTexture();
  const { albedo: cordMap, bump: cordBump } = makeCordTextures();

  const bladeMat = new THREE.MeshPhysicalMaterial({
    color: BLADE_DARK,
    metalness: 0.9,
    roughness: 0.52,
    roughnessMap: stonewash,
    bumpMap: stonewash,
    bumpScale: 0.016,
    clearcoat: 0.08,
    clearcoatRoughness: 0.7,
    envMapIntensity: 1.2,
  });
  const edgeMat = new THREE.MeshStandardMaterial({
    color: BLADE_EDGE,
    metalness: 0.95,
    roughness: 0.28,
    envMapIntensity: 1.4,
  });
  const bareSteelMat = new THREE.MeshStandardMaterial({
    color: STEEL_BARE,
    metalness: 0.96,
    roughness: 0.16,
    envMapIntensity: 1.9,
  });
  const cordMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: cordMap,
    bumpMap: cordBump,
    bumpScale: 0.05,
    roughnessMap: cordBump,
    roughness: 0.44,
    metalness: 0.0,
    envMapIntensity: 1.0,
  });
  const tipMat = new THREE.MeshPhysicalMaterial({
    color: CORD_TIP,
    roughness: 0.15,
    metalness: 0.0,
    transmission: 0.6,
    ior: 1.45,
    thickness: 0.06,
    clearcoat: 1.0,
    clearcoatRoughness: 0.12,
    envMapIntensity: 1.2,
  });
  const etchMat = (tex: THREE.CanvasTexture): THREE.MeshBasicMaterial =>
    new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
      opacity: 1.0,
      toneMapped: false,
    });

  // ---- blade + tang slab ----------------------------------------------------
  const shape = buildBladeTangShape();
  const bladeGeo = new THREE.ExtrudeGeometry(shape, {
    depth: THICK,
    bevelEnabled: true,
    bevelThickness: 0.028,
    bevelSize: 0.02,
    bevelSegments: 3,
    curveSegments: 48,
  });
  bladeGeo.translate(0, 0, -THICK / 2);
  bladeGeo.computeVertexNormals();
  const blade = new THREE.Mesh(bladeGeo, bladeMat);
  blade.name = 'blade-tang';
  if (shadows) {
    blade.castShadow = true;
    blade.receiveShadow = true;
  }
  root.add(blade);
  nodes.blade = blade;

  // ---- sharpened edge bevel — a bright bare-steel "mài" strip along the cutting edge ----
  // apex polyline (tip → choil) + an inward-offset top line = a thin ground bevel band.
  const BEVEL_W = 0.05; // width of the sharpened bevel
  const apex: THREE.Vector2[] = EDGE_PATH.map(([x, y]) => new THREE.Vector2(x, y));
  const bevelTop: THREE.Vector2[] = apex.map((p, i) => {
    const prev = apex[Math.max(0, i - 1)];
    const next = apex[Math.min(apex.length - 1, i + 1)];
    const tan = next.clone().sub(prev).normalize();
    // inward normal (rotate tangent +90°) points up into the blade body
    let n = new THREE.Vector2(-tan.y, tan.x);
    if (n.y < 0) n.negate();
    return p.clone().add(n.multiplyScalar(BEVEL_W));
  });
  const bevelShape = new THREE.Shape();
  bevelShape.moveTo(apex[0].x, apex[0].y);
  for (let i = 1; i < apex.length; i++) bevelShape.lineTo(apex[i].x, apex[i].y);
  for (let i = bevelTop.length - 1; i >= 0; i--) bevelShape.lineTo(bevelTop[i].x, bevelTop[i].y);
  bevelShape.closePath();
  const bevelGeo = new THREE.ExtrudeGeometry(bevelShape, {
    depth: 0.006,
    bevelEnabled: false,
    curveSegments: 24,
  });
  const halfDepthEdge = THICK / 2 + 0.028;
  const bevelFront = new THREE.Mesh(bevelGeo, bareSteelMat);
  bevelFront.position.z = halfDepthEdge;
  bevelFront.name = 'edge-bevel-front';
  root.add(bevelFront);
  const bevelBack = new THREE.Mesh(bevelGeo, bareSteelMat);
  bevelBack.position.z = -halfDepthEdge - 0.006;
  bevelBack.name = 'edge-bevel-back';
  root.add(bevelBack);
  nodes.edge = bevelFront;

  // crisp bright apex line (rounds the very cutting edge in the silhouette)
  const edgePts = EDGE_PATH.map(([x, y]) => new THREE.Vector3(x, y, 0));
  const edgeCurve = new THREE.CatmullRomCurve3(edgePts, false, 'catmullrom', 0.5);
  const edgeGeo = new THREE.TubeGeometry(edgeCurve, 96, 0.008, 8, false);
  const edgeStrip = new THREE.Mesh(edgeGeo, bareSteelMat);
  edgeStrip.name = 'edge-apex';
  root.add(edgeStrip);

  // ---- two-tone flat (saber) grind — a lighter satin facet over the lower blade ----
  const grindShape = new THREE.Shape();
  // grind line (tip → choil), sitting mid-blade
  grindShape.moveTo(2.08, -0.03);
  grindShape.lineTo(1.7, 0.02);
  grindShape.lineTo(1.3, 0.03);
  grindShape.lineTo(0.9, 0.01);
  grindShape.lineTo(0.5, -0.03);
  grindShape.lineTo(0.22, -0.09);
  // back down to the top of the sharpened bevel band (choil → tip)
  for (let i = bevelTop.length - 1; i >= 0; i--) grindShape.lineTo(bevelTop[i].x, bevelTop[i].y);
  grindShape.closePath();

  const grindMat = new THREE.MeshStandardMaterial({
    color: 0x565c64, // lighter satin than the coated flat → reads as the ground bevel
    metalness: 0.94,
    roughness: 0.34,
    roughnessMap: stonewash,
    envMapIntensity: 1.5,
  });
  const grindGeo = new THREE.ExtrudeGeometry(grindShape, {
    depth: 0.005,
    bevelEnabled: false,
    curveSegments: 24,
  });
  const halfDepth = THICK / 2 + 0.028;
  const grindFront = new THREE.Mesh(grindGeo, grindMat);
  grindFront.position.z = halfDepth - 0.001;
  grindFront.name = 'grind-facet-front';
  root.add(grindFront);
  const grindBack = new THREE.Mesh(grindGeo, grindMat);
  grindBack.position.z = -(halfDepth - 0.001) - 0.005;
  grindBack.name = 'grind-facet-back';
  root.add(grindBack);
  nodes.grind = grindFront;

  // ---- spine jimping (row of filework notches near the ricasso) ------------
  const jimping = new THREE.Group();
  jimping.name = 'jimping';
  const jimpMat = new THREE.MeshStandardMaterial({
    color: 0x202226,
    metalness: 0.9,
    roughness: 0.5,
  });
  const notchGeo = new THREE.CylinderGeometry(0.02, 0.02, THICK + 0.02, 10);
  notchGeo.rotateX(Math.PI / 2);
  for (let i = 0; i < 9; i++) {
    const n = new THREE.Mesh(notchGeo, jimpMat);
    const x = 1.28 - i * 0.075;
    n.position.set(x, SPINE_Y + 0.028, 0);
    jimping.add(n);
  }
  root.add(jimping);
  nodes.jimping = jimping;

  // ---- brand etch overlays (both faces) ------------------------------------
  const wordTex = etchTexture(
    (ctx, w, h) => {
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = hex(ETCH_GRAY);
      ctx.font = `bold ${Math.floor(h * 0.5)}px Arial, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      (ctx as unknown as { letterSpacing: string }).letterSpacing = `${Math.floor(h * 0.08)}px`;
      ctx.fillText('GERBER', w / 2, h / 2);
    },
    512,
    160,
  );
  const logoTex = etchTexture(
    (ctx, w, h) => {
      ctx.clearRect(0, 0, w, h);
      ctx.strokeStyle = hex(ETCH_GRAY);
      ctx.fillStyle = hex(ETCH_GRAY);
      ctx.lineWidth = h * 0.05;
      // stylized Gerber "sword / anchor" emblem inside a soft diamond
      const cx = w / 2;
      const cy = h / 2;
      // vertical blade
      ctx.fillRect(cx - h * 0.05, cy - h * 0.34, h * 0.1, h * 0.68);
      // crossguard
      ctx.fillRect(cx - h * 0.24, cy - h * 0.08, h * 0.48, h * 0.09);
      // anchor arc at the base
      ctx.beginPath();
      ctx.arc(cx, cy + h * 0.14, h * 0.24, Math.PI * 0.12, Math.PI * 0.88, false);
      ctx.stroke();
      // pommel dot
      ctx.beginPath();
      ctx.arc(cx, cy - h * 0.34, h * 0.07, 0, Math.PI * 2);
      ctx.fill();
    },
    160,
    160,
  );
  const serialTex = etchTexture(
    (ctx, w, h) => {
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = hex(ETCH_GRAY);
      ctx.font = `${Math.floor(h * 0.62)}px Arial, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      (ctx as unknown as { letterSpacing: string }).letterSpacing = '2px';
      ctx.fillText('3012863D', w / 2, h / 2);
    },
    320,
    64,
  );

  // NB: the extrude bevel adds `bevelThickness` beyond THICK/2, so the real blade
  // half-depth is THICK/2 + bevelThickness. Sit the etch decals just proud of that.
  const BEVEL_THICKNESS = 0.028;
  const zFront = THICK / 2 + BEVEL_THICKNESS + 0.006;
  const zBack = -(THICK / 2 + BEVEL_THICKNESS + 0.006);

  const addFaceDecal = (
    tex: THREE.CanvasTexture,
    x: number,
    y: number,
    wpx: number,
    hpx: number,
    rot = 0,
    front = true,
  ) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(wpx, hpx), etchMat(tex));
    m.position.set(x, y, front ? zFront : zBack);
    m.rotation.z = rot;
    if (!front) m.rotation.y = Math.PI; // mirror onto the back face
    m.renderOrder = 2;
    root.add(m);
    return m;
  };

  // wordmark near the ricasso/flat (front side has it lower per ref image 3)
  const word = addFaceDecal(wordTex, 0.74, 0.04, 0.6, 0.185, 0, true);
  word.name = 'etch-gerber';
  nodes.etchWordmark = word;
  addFaceDecal(logoTex, 0.74, -0.14, 0.2, 0.2, 0, true);
  // back face wordmark sits a touch forward (ref image 1 bottom knife)
  addFaceDecal(wordTex, 0.66, 0.06, 0.6, 0.185, 0, false);
  addFaceDecal(logoTex, 0.66, -0.11, 0.2, 0.2, 0, false);
  // vertical serial on the ricasso (both faces)
  addFaceDecal(serialTex, 0.04, 0.03, 0.32, 0.05, Math.PI / 2, true);
  addFaceDecal(serialTex, 0.04, 0.03, 0.32, 0.05, Math.PI / 2, false);

  // ---- paracord wrap --------------------------------------------------------
  const wrap = new THREE.Group();
  wrap.name = 'paracord';

  const cordCurve = buildCordCurve();
  const cordGeo = new THREE.TubeGeometry(cordCurve, 620, 0.062, 14, false);
  // tile the weave: dense along length, a few times around the circumference
  applyCordUV(cordMap, cordBump, 150, 5);
  const cordMesh = new THREE.Mesh(cordGeo, cordMat);
  cordMesh.name = 'cord-helix';
  if (shadows) {
    cordMesh.castShadow = true;
    cordMesh.receiveShadow = true;
  }
  wrap.add(cordMesh);
  nodes.cordHelix = cordMesh;

  // knot + tails at the pommel
  const knotGeo = new THREE.TubeGeometry(buildKnotCurve(), 120, 0.052, 10, false);
  const knot = new THREE.Mesh(knotGeo, cordMat);
  knot.name = 'cord-knot';
  if (shadows) knot.castShadow = true;
  wrap.add(knot);

  const tailGeo = new THREE.TubeGeometry(buildTailCurve(), 60, 0.05, 10, false);
  const tail = new THREE.Mesh(tailGeo, cordMat);
  tail.name = 'cord-tail';
  if (shadows) tail.castShadow = true;
  wrap.add(tail);

  // melted/glued translucent tips at the two loose ends (flattened burnt caps)
  const tipGeo = new THREE.SphereGeometry(0.052, 16, 12);
  const knotEnd = buildKnotCurve();
  const tailEnd = buildTailCurve();
  const placeTip = (curve: THREE.CatmullRomCurve3, name: string): THREE.Mesh => {
    const t = new THREE.Mesh(tipGeo, tipMat);
    const p = curve.getPoint(1);
    const tan = curve.getTangent(1).normalize();
    t.position.copy(p).add(tan.clone().multiplyScalar(0.03));
    // flatten across the cut and align the flat to the cord direction
    t.scale.set(1.0, 0.95, 0.7);
    t.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), tan);
    t.name = name;
    wrap.add(t);
    return t;
  };
  const tipA = placeTip(knotEnd, 'cord-tip-a');
  placeTip(tailEnd, 'cord-tip-b');

  // a short anchor loop tucking into the forward lashing slot (ref image 3)
  const anchor = new THREE.Mesh(
    new THREE.TorusGeometry(0.11, 0.05, 10, 24, Math.PI * 1.3),
    cordMat,
  );
  anchor.position.set(-0.42, 0.0, 0.0);
  anchor.rotation.set(Math.PI / 2, 0, Math.PI * 0.15);
  anchor.name = 'cord-anchor-loop';
  wrap.add(anchor);

  root.add(wrap);
  sockets.pommelLanyard = tipA;
  sockets.forwardLashing = anchor;

  // ---- normalize + place ----------------------------------------------------
  // recenter around the handle/blade join so orbit framing is easy
  root.position.set(0, 0, 0);
  root.scale.setScalar(scale);

  // ---- idle "display" rock --------------------------------------------------
  const baseY = 0;
  const tick = (_dt: number, elapsed: number): void => {
    if (!animate) return;
    // gentle rock biased toward the logo-facing 3/4 so the etch stays readable
    root.rotation.y = 0.12 + Math.sin(elapsed * 0.42) * 0.3;
    root.rotation.z = Math.sin(elapsed * 0.33) * 0.035;
    root.position.y = baseY + Math.sin(elapsed * 0.9) * 0.03;
  };
  root.userData.tick = tick;

  root.userData.sculptRuntime = {
    nodes,
    sockets,
    materials: { bladeMat, edgeMat, bareSteelMat, cordMat, tipMat },
    destructionGroups: ['blade', 'tang', 'paracord', 'pommel'],
  };

  return root;
}

/** Set repeat/wrap on the cord weave textures (shared instances). */
function applyCordUV(
  map: THREE.CanvasTexture,
  bump: THREE.CanvasTexture,
  repU: number,
  repV: number,
): void {
  for (const t of [map, bump]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repU, repV);
  }
}

// ---------------------------------------------------------------------------
// look-dev lighting rig — neutral studio, cool key + warm rim (matches the ref)
// ---------------------------------------------------------------------------
export function createGerberKnifeLookDevLights(): THREE.Group {
  const lights = new THREE.Group();
  lights.name = 'lookdev-lights';

  const hemi = new THREE.HemisphereLight(0xdfe6f2, 0x1a1c22, 0.5);
  lights.add(hemi);

  // crisp key from upper-front-left → rakes the stonewash + lights the cord weave
  const key = new THREE.DirectionalLight(0xffffff, 3.0);
  key.position.set(-3.2, 4.2, 3.6);
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

  // cool fill from the right to open the shadow side
  const fill = new THREE.DirectionalLight(0x9fb6d8, 0.55);
  fill.position.set(4.0, 1.2, 2.0);
  lights.add(fill);

  // warm rim from behind to pop the blade spine + cord silhouette
  const rim = new THREE.DirectionalLight(0xffd9a8, 1.1);
  rim.position.set(1.5, 2.5, -4.5);
  lights.add(rim);

  // tight specular accent that travels across the blade as it rocks
  const accent = new THREE.PointLight(0xffffff, 6, 10, 2);
  accent.position.set(1.6, 1.8, 2.4);
  lights.add(accent);

  return lights;
}

/** Radial studio-gradient background matching the reference sheet's dark vignette. */
export function makeStudioBackground(): THREE.CanvasTexture {
  const S = 1024;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d')!;
  const g = ctx.createRadialGradient(S * 0.5, S * 0.46, S * 0.1, S * 0.5, S * 0.5, S * 0.72);
  g.addColorStop(0, '#3a4048');
  g.addColorStop(0.55, '#2b3037');
  g.addColorStop(1, '#181b20');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
