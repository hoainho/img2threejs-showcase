import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';

/**
 * BMX "Endurance" bike — hand-authored procedural reconstruction (img2threejs v1.3).
 *
 * Rebuilt in code from a 12-view reference set (3/4 front, side, drivetrain, U-brake,
 * grip, hub/peg, BB welds, saddle, pedal, head-tube decal, wireframe). This replaces the
 * earlier generated "every-part-is-a-cylinder" placeholder with real geometry:
 *   - 5-spoke solid aero MAG wheels (extruded disc + deep-dish barrel + orange rim lip)
 *   - all-black block-tread tyres with orange "TERRAIN MONSTER / SHARP / 2022" sidewall text
 *   - glossy clear-coat orange frame with fish-scale TIG weld beads at the joints
 *   - ribbed orange grips with inner flange, elongated PU-leather saddle
 *   - platform pedals with amber reflectors, 8-arm sunburst orange sprocket + roller chain
 *   - rear U-brake with straddle cable + barrel adjuster, knurled anodized pegs (4)
 *   - "BMX" / "Endurance" frame decals (no head-tube logo)
 *
 * Coordinate frame (root-local, matches the demo camera + drivetrain rig in registry.ts):
 *   +x = rear, -x = front · +y = up · z = axle/width.  Wheel centres: front (-0.62,-0.28),
 *   rear (0.62,-0.28). Bottom-bracket (-0.02,-0.24). Wheels/cranks spin about local z.
 *
 * Action-ready: root.userData.sculptRuntime.nodes exposes frontTire/frontRim/frontHub,
 * rearTire/rearRim/rearHub, crankArmL/crankArmR/chainring, pedalL/pedalR — each a Group
 * centred on its own pivot so the host rig can reparent + rotate it directly.
 */

export type ProceduralModelOptions = {
  castShadow?: boolean;
  receiveShadow?: boolean;
  wireframe?: boolean;
};

export type ProceduralModelRuntime = {
  nodes: Record<string, THREE.Object3D>;
  meshes: Record<string, THREE.Mesh>;
  sockets: Record<string, THREE.Object3D>;
  colliders: Record<string, unknown>;
  destructionGroups: Record<string, THREE.Object3D[]>;
};

// ---------------------------------------------------------------------------
// Palette (post-ACES tone-mapping targets, tuned against the reference render)
// ---------------------------------------------------------------------------
const COL = {
  frame: '#f57c00', // signal orange, glossy clear-coat (rich amber, spec §3)
  rimLip: '#ff9a1c', // painted orange rim edge
  gripOrange: '#f98a08',
  magBlack: '#0c0c0e', // gloss-black mag wheel / sprocket
  glossBlack: '#161616', // handlebar / stem / seatpost / levers
  rubber: '#121212', // tyre
  leather: '#191919', // saddle
  amber: '#ff8c12', // pedal reflector
  peg: '#1b1b1d', // anodized black peg
  chrome: '#c7ccd2', // cable barrel / bolts / seat rails
  chain: '#3a3a3e', // roller chain
  pedalBody: '#161618',
} as const;

const HAS_DOC = typeof document !== 'undefined';

// ---------------------------------------------------------------------------
// Canvas-texture helpers (all procedural — no external art)
// ---------------------------------------------------------------------------
function makeCanvas(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return { canvas, ctx: canvas.getContext('2d')! };
}

function canvasTexture(
  w: number,
  h: number,
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
  opts: { repeat?: [number, number]; srgb?: boolean; aniso?: number } = {},
): THREE.CanvasTexture | null {
  if (!HAS_DOC) return null;
  const { canvas, ctx } = makeCanvas(w, h);
  draw(ctx, w, h);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  if (opts.repeat) tex.repeat.set(opts.repeat[0], opts.repeat[1]);
  tex.anisotropy = opts.aniso ?? 8;
  tex.colorSpace = opts.srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Fish-scale TIG weld bead — a bump map of stacked overlapping arcs. */
function weldBumpTexture(): THREE.CanvasTexture | null {
  return canvasTexture(256, 64, (ctx, w, h) => {
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, w, h);
    const step = 13;
    for (let i = -1; i < w / step + 1; i++) {
      ctx.strokeStyle = '#f2f2f2';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(i * step, h * 0.5, step * 0.7, Math.PI * 0.15, Math.PI * 0.85);
      ctx.stroke();
      ctx.strokeStyle = '#4a4a4a';
      ctx.beginPath();
      ctx.arc(i * step, h * 0.5 + 2, step * 0.7, Math.PI * 0.15, Math.PI * 0.85);
      ctx.stroke();
    }
  }, { repeat: [1, 1] });
}

/** Ribbed rubber grip — horizontal ring grooves as a bump map. */
function gripBumpTexture(): THREE.CanvasTexture | null {
  return canvasTexture(64, 256, (ctx, w, h) => {
    const rings = 22;
    for (let i = 0; i < rings; i++) {
      const y = (i / rings) * h;
      const g = ctx.createLinearGradient(0, y, 0, y + h / rings);
      g.addColorStop(0, '#3a3a3a');
      g.addColorStop(0.5, '#ffffff');
      g.addColorStop(1, '#3a3a3a');
      ctx.fillStyle = g;
      ctx.fillRect(0, y, w, h / rings - 1);
    }
  }, { repeat: [1, 1] });
}

/** Diamond knurl for pegs — a fine cross-hatch bump. */
function knurlBumpTexture(): THREE.CanvasTexture | null {
  return canvasTexture(128, 128, (ctx, w, h) => {
    ctx.fillStyle = '#7a7a7a';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#e8e8e8';
    ctx.lineWidth = 1.4;
    const s = 9;
    for (let i = -w; i < w; i += s) {
      ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + h, h); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(i + h, 0); ctx.lineTo(i, h); ctx.stroke();
    }
  }, { repeat: [6, 3] });
}

/** PU-leather grain — soft mottled bump for the saddle (deterministic noise). */
function leatherBumpTexture(): THREE.CanvasTexture | null {
  let seed = 1337;
  const rnd = (): number => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  return canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#8a8a8a';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 2600; i++) {
      const x = rnd() * w;
      const y = rnd() * h;
      const r = 1 + rnd() * 2.5;
      const c = 90 + Math.floor(rnd() * 90);
      ctx.fillStyle = `rgb(${c},${c},${c})`;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }, { repeat: [3, 2] });
}

/** Prismatic reflector — small diamond cells for the amber pedal reflector. */
function reflectorBumpTexture(): THREE.CanvasTexture | null {
  return canvasTexture(128, 128, (ctx, w, h) => {
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, w, h);
    const s = 16;
    for (let x = 0; x < w; x += s) {
      for (let y = 0; y < h; y += s) {
        const g = ctx.createRadialGradient(x + s / 2, y + s / 2, 1, x + s / 2, y + s / 2, s * 0.7);
        g.addColorStop(0, '#ffffff');
        g.addColorStop(1, '#2a2a2a');
        ctx.fillStyle = g;
        ctx.fillRect(x, y, s - 1, s - 1);
      }
    }
  }, { repeat: [3, 1] });
}

/**
 * Tyre wrap: colour + bump for a TorusGeometry. Cross-section (v, vertical here)
 * runs around the tube: mid-band = crown (block tread), quarter-bands = sidewalls
 * (orange text + bead line). u (horizontal) runs around the wheel.
 */
function tyreTextures(): { map: THREE.CanvasTexture | null; bump: THREE.CanvasTexture | null } {
  const W = 2048;
  const H = 512;
  const map = canvasTexture(W, H, (ctx, w, h) => {
    ctx.fillStyle = COL.rubber; // all-black rubber; orange lives only on the rim lip
    ctx.fillRect(0, 0, w, h);
    // Sidewall lettering. LOWER sidewall (near the bead) = large repeated "SHARP";
    // UPPER sidewall (near the tread shoulder) = small "TERRAIN MONSTER" + "2022".
    // The two faces are vertically mirrored so each reads upright on its outward side.
    ctx.fillStyle = '#f2a01c';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    for (const [y, flip] of [[h * 0.13, 1], [h * 0.87, -1]]) {
      ctx.font = `bold ${Math.round(h * 0.11)}px Arial, sans-serif`;
      for (let i = 0; i < 4; i++) {
        ctx.save();
        ctx.translate((i / 4) * w + w * 0.03, y);
        if (flip < 0) ctx.scale(1, -1);
        ctx.fillText('SHARP', 0, 0);
        ctx.restore();
      }
    }
    const small = ['TERRAIN MONSTER', '2022'];
    for (const [y, flip] of [[h * 0.29, 1], [h * 0.71, -1]]) {
      ctx.font = `bold ${Math.round(h * 0.045)}px Arial, sans-serif`;
      for (let i = 0; i < 6; i++) {
        ctx.save();
        ctx.translate((i / 6) * w + w * 0.02, y);
        if (flip < 0) ctx.scale(1, -1);
        ctx.fillText(small[i % 2], 0, 0);
        ctx.restore();
      }
    }
  }, { repeat: [-1, 1], srgb: true }); // negative U flips the sidewall text to read correctly

  const bump = canvasTexture(W, H, (ctx, w, h) => {
    ctx.fillStyle = '#2a2a2a'; // deep grooves between knobs
    ctx.fillRect(0, 0, w, h);
    // crown block tread: fine, closely-spaced knobs (v 0.28..0.72)
    const rows = 3;
    const cols = 52;
    const bw = w / cols;
    const crownTop = h * 0.28;
    const crownH = h * 0.44;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = c * bw + (r % 2) * bw * 0.5;
        const y = crownTop + (r / rows) * crownH;
        // raised knob with a bright top and mid-grey shoulder for a beveled block
        ctx.fillStyle = '#6a6a6a';
        roundRect(ctx, x + bw * 0.08, y + crownH * 0.03, bw * 0.84, (crownH / rows) * 0.9, 6);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        roundRect(ctx, x + bw * 0.2, y + crownH * 0.08, bw * 0.6, (crownH / rows) * 0.7, 4);
        ctx.fill();
      }
    }
    // side lug rows just outboard of the crown
    ctx.fillStyle = '#c8c8c8';
    for (const yb of [h * 0.24, h * 0.76]) {
      for (let c = 0; c < cols; c++) {
        const x = c * bw + (c % 2) * bw * 0.4;
        roundRect(ctx, x + bw * 0.15, yb, bw * 0.5, h * 0.04, 3);
        ctx.fill();
      }
    }
  }, { repeat: [1, 1] });

  return { map, bump };
}

/** Transparent decal canvas → texture (sRGB). Drawn upright; the caller orients the
 *  quad along the tube's reading direction so the text stays right-way-up. */
function decalTexture(
  w: number,
  h: number,
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
): THREE.CanvasTexture | null {
  return canvasTexture(w, h, (ctx, cw, ch) => {
    ctx.clearRect(0, 0, cw, ch);
    draw(ctx, cw, ch);
  }, { repeat: [1, 1], srgb: true });
}

// ---------------------------------------------------------------------------
// Materials — PBR per the supplied specification
// ---------------------------------------------------------------------------
function buildMaterials(): Record<string, THREE.MeshPhysicalMaterial> {
  const env = 1.0;
  const frame = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(COL.frame),
    roughness: 0.15, metalness: 0.05, clearcoat: 0.8, clearcoatRoughness: 0.06, envMapIntensity: env * 1.1,
  });

  const weld = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(COL.frame),
    roughness: 0.38, metalness: 0.05, clearcoat: 0.4, clearcoatRoughness: 0.28,
    bumpMap: weldBumpTexture(), bumpScale: 3.0, envMapIntensity: env,
  });

  const magBlack = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(COL.magBlack),
    roughness: 0.1, metalness: 0.9, clearcoat: 0.9, clearcoatRoughness: 0.05, envMapIntensity: env * 1.3,
  });

  const rimOrange = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(COL.rimLip),
    roughness: 0.22, metalness: 0.1, clearcoat: 0.5, clearcoatRoughness: 0.12, envMapIntensity: env,
  });

  const glossBlack = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(COL.glossBlack),
    roughness: 0.3, metalness: 0.65, clearcoat: 0.45, clearcoatRoughness: 0.15, envMapIntensity: env,
  });

  const tyreTex = tyreTextures();
  const tyre = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color('#ffffff'), map: tyreTex.map, bumpMap: tyreTex.bump, bumpScale: 5.0,
    roughness: 0.85, metalness: 0.0, envMapIntensity: env * 0.45,
  });
  if (!tyreTex.map) tyre.color.set(COL.rubber);

  const grip = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(COL.gripOrange),
    roughness: 0.85, metalness: 0.0, bumpMap: gripBumpTexture(), bumpScale: 1.1, envMapIntensity: env * 0.7,
  });

  const leather = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(COL.leather),
    roughness: 0.62, metalness: 0.0, sheen: 0.4, sheenRoughness: 0.6, sheenColor: new THREE.Color('#2a2a2a'),
    bumpMap: leatherBumpTexture(), bumpScale: 0.6, envMapIntensity: env * 0.8,
  });

  const amber = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(COL.amber),
    roughness: 0.18, metalness: 0.0, transmission: 0.28, ior: 1.5, thickness: 0.02, clearcoat: 0.6,
    emissive: new THREE.Color(COL.amber), emissiveIntensity: 0.12,
    bumpMap: reflectorBumpTexture(), bumpScale: 1.2, envMapIntensity: env,
  });

  const peg = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(COL.peg),
    roughness: 0.55, metalness: 0.7, bumpMap: knurlBumpTexture(), bumpScale: 0.8, envMapIntensity: env,
  });

  const chrome = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(COL.chrome), roughness: 0.22, metalness: 1.0, envMapIntensity: env * 1.2,
  });

  const chain = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(COL.chain), roughness: 0.5, metalness: 0.9, envMapIntensity: env,
  });

  const pedalBody = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(COL.pedalBody), roughness: 0.5, metalness: 0.35, envMapIntensity: env,
  });

  // smooth matte black (front peg) — no knurl, low sheen
  const matteBlack = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color('#141416'), roughness: 0.7, metalness: 0.2, clearcoat: 0.1, envMapIntensity: env * 0.6,
  });

  return { frame, weld, magBlack, rimOrange, glossBlack, tyre, grip, leather, amber, peg, chrome, chain, pedalBody, matteBlack };
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------
const UP = new THREE.Vector3(0, 1, 0);

function v(x: number, y: number, z = 0): THREE.Vector3 {
  return new THREE.Vector3(x, y, z);
}

/** A cylinder spanning a→b (local points), radius r1 at a, r2 at b. */
function tube(
  a: THREE.Vector3,
  b: THREE.Vector3,
  r1: number,
  r2: number,
  mat: THREE.Material,
  radial = 20,
): THREE.Mesh {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const geo = new THREE.CylinderGeometry(r2, r1, len, radial, 1, false);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.quaternion.setFromUnitVectors(UP, dir.clone().normalize());
  mesh.position.copy(a).addScaledVector(dir, 0.5);
  return mesh;
}

/** A smooth cable/hose swept along a Catmull-Rom (bezier-like) curve through `pts`. */
function cable(pts: THREE.Vector3[], r: number, mat: THREE.Material, seg = 40): THREE.Mesh {
  const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.5);
  return new THREE.Mesh(new THREE.TubeGeometry(curve, seg, r, 8, false), mat);
}

/** Weld bead ring wrapping a tube of radius `tubeR` at `at`, with `dir` = tube axis. */
function weldRing(at: THREE.Vector3, dir: THREE.Vector3, tubeR: number, mat: THREE.Material): THREE.Mesh {
  const geo = new THREE.TorusGeometry(tubeR * 1.06, tubeR * 0.26, 10, 32);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir.clone().normalize());
  mesh.position.copy(at);
  return mesh;
}

function applyShadow(obj: THREE.Object3D, opts: ProceduralModelOptions): void {
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.castShadow = opts.castShadow ?? true;
      m.receiveShadow = opts.receiveShadow ?? true;
      if (opts.wireframe) {
        const mat = m.material as THREE.MeshStandardMaterial;
        if (mat && 'wireframe' in mat) mat.wireframe = true;
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Wheel — OPEN 5-spoke MAG (slim spokes with see-through gaps)
// ---------------------------------------------------------------------------
const TIRE_MAJOR = 0.32; // tyre centreline radius
const TIRE_TUBE = 0.05; // tyre cross-section radius → outer 0.37, inner bead ≈ 0.27
const WHEEL_WIDTH = 0.085; // hub / peg reference width

const HUB_R = 0.055;
const SPOKE_IN = 0.05;
const SPOKE_OUT = 0.244;
const RIM_RING_R = 0.244; // black structural rim the spokes meet (inboard of the lip)
const LIP_R = 0.268; // orange rim lip ring, sits at the tyre bead just outboard of the ring
const MAG_DEPTH = 0.03; // slim spoke / face thickness

/**
 * Open 5-spoke mag face: centre hub + 5 slim beveled spokes + a black rim ring, plus
 * the thin orange rim lip. The gaps between spokes are true voids — you can see through
 * to the far side of the wheel; there is NO solid disc.
 */
function magFace(mats: Record<string, THREE.MeshPhysicalMaterial>): THREE.Group {
  const g = new THREE.Group();

  const hub = new THREE.Mesh(new THREE.CylinderGeometry(HUB_R, HUB_R, MAG_DEPTH * 1.5, 28), mats.magBlack);
  hub.rotation.x = Math.PI / 2;
  g.add(hub);

  // five slim aero spokes — wider at the hub, tapering to the rim, beveled edges
  for (let i = 0; i < 5; i++) {
    const shape = new THREE.Shape();
    const wB = 0.05; // width at hub
    const wT = 0.03; // width at rim
    shape.moveTo(-wB / 2, SPOKE_IN);
    shape.lineTo(wB / 2, SPOKE_IN);
    shape.lineTo(wT / 2, SPOKE_OUT);
    shape.lineTo(-wT / 2, SPOKE_OUT);
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: MAG_DEPTH, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 2, steps: 1,
    });
    geo.translate(0, 0, -MAG_DEPTH / 2);
    const spoke = new THREE.Mesh(geo, mats.magBlack);
    spoke.rotation.z = (i / 5) * Math.PI * 2;
    g.add(spoke);
  }

  // black structural rim ring the spoke tips meet (kept inboard of the orange lip)
  const ring = new THREE.Mesh(new THREE.TorusGeometry(RIM_RING_R, 0.013, 18, 96), mats.magBlack);
  g.add(ring);

  // ORANGE rim lip — glossy burnt-orange painted edge sitting just OUTSIDE the black
  // ring, at the boundary with the tyre bead (visible band ≈ LIP_R−0.013 … tyre inner)
  const lip = new THREE.Mesh(new THREE.TorusGeometry(LIP_R, 0.013, 16, 110), mats.rimOrange);
  g.add(lip);

  return g;
}

/** Wheel parts returned as three sibling groups (each centred at local origin). */
function buildWheel(mats: Record<string, THREE.MeshPhysicalMaterial>): {
  tire: THREE.Group; rim: THREE.Group; hub: THREE.Group;
} {
  // rim group = the open mag face (spokes + rim ring + orange lip). No solid disc.
  const rim = magFace(mats);

  // tyre — all-black rubber torus (decals live in the material's map)
  const tire = new THREE.Group();
  tire.add(new THREE.Mesh(new THREE.TorusGeometry(TIRE_MAJOR, TIRE_TUBE, 30, 140), mats.tyre));

  // hub — compact all-black shell (no bright chrome caps)
  const hub = new THREE.Group();
  const shell = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, WHEEL_WIDTH, 24), mats.magBlack);
  shell.rotation.x = Math.PI / 2;
  hub.add(shell);
  for (const zside of [-1, 1]) {
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.024, 0.01, 16), mats.magBlack);
    cap.rotation.x = Math.PI / 2;
    cap.position.z = zside * WHEEL_WIDTH * 0.5;
    hub.add(cap);
  }

  return { tire, rim, hub };
}

// ---------------------------------------------------------------------------
// Small parts
// ---------------------------------------------------------------------------
function buildGrip(mats: Record<string, THREE.MeshPhysicalMaterial>): THREE.Group {
  // built with the grip axis along local x; positioned/oriented by the caller
  const g = new THREE.Group();
  const L = 0.115;
  const r = 0.026;
  const body = new THREE.Mesh(new THREE.CylinderGeometry(r, r, L, 24), mats.grip);
  body.rotation.z = Math.PI / 2;
  g.add(body);
  const flange = new THREE.Mesh(new THREE.TorusGeometry(r + 0.006, 0.006, 8, 24), mats.grip);
  flange.rotation.y = Math.PI / 2;
  flange.position.x = -L / 2 + 0.006;
  g.add(flange);
  const cap = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2), mats.glossBlack);
  cap.rotation.z = -Math.PI / 2;
  cap.position.x = L / 2;
  g.add(cap);
  return g;
}

function buildSaddle(mats: Record<string, THREE.MeshPhysicalMaterial>): THREE.Group {
  // Railed BMX seat: pointed, slightly upturned nose (−x = front) · scooped middle ·
  // fat rounded tail · puffy cushion. Long axis = local x (caller keeps it ~horizontal).
  const g = new THREE.Group();
  // Proportions from NotebookLM research (BMX/jump saddles ≈ 235mm long × 127mm rear
  // width → shorter than road saddles, ~1.9:1 length:width, nose clearly narrower).
  const shell = new THREE.Mesh(new THREE.SphereGeometry(0.5, 56, 34), mats.leather);
  shell.scale.set(0.32, 0.1, 0.15); // length · cushion thickness · rear width
  const pos = shell.geometry.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const t = THREE.MathUtils.clamp(x / 0.5, -1, 1); // nose −1 … tail +1
    // width: narrow pointed nose → full rounded tail
    const wf = 0.4 + 0.6 * THREE.MathUtils.smoothstep((t + 1) / 2, 0, 1);
    pos.setZ(i, z * wf);
    // Longitudinal profile (BMX railed/pivotal seat, per web research): a gentle upward
    // sweep — the middle sits slightly low, the NOSE kicks up (waterfall) and the TAIL
    // rises into a rounded rear bumper, so the top line arcs upward toward both ends.
    // Research: BMX seats sit nose-up with a longitudinal dip + raised rear. Make the
    // top line clearly sweep UP toward both ends (bigger tail bumper, upturned nose).
    const scoop = -0.022 * (1 - t * t); // seating dip
    const tail = 0.09 * Math.pow(Math.max(0, t), 1.3); // raised rounded rear bumper
    const nose = 0.07 * Math.pow(Math.max(0, -t), 1.4); // upturned nose (waterfall)
    const domeTop = y > 0 ? 0.01 * (1 - t * t) : 0; // slight cushion crown
    pos.setY(i, y + scoop + tail + nose + domeTop);
  }
  pos.needsUpdate = true;
  shell.geometry.computeVertexNormals();
  g.add(shell);
  const clamp = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.03, 0.045), mats.glossBlack);
  clamp.position.y = -0.05;
  g.add(clamp);
  for (const zside of [-1, 1]) {
    const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.26, 8), mats.chrome);
    rail.rotation.z = Math.PI / 2;
    rail.position.set(0, -0.045, zside * 0.025);
    g.add(rail);
  }
  return g;
}

function buildPedal(mats: Record<string, THREE.MeshPhysicalMaterial>): THREE.Group {
  const g = new THREE.Group();
  // spindle runs inboard to meet the crank arm (pedal sits outboard at z≈0.155)
  const spindle = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.14, 12), mats.chrome);
  spindle.rotation.x = Math.PI / 2;
  spindle.position.z = -0.02;
  g.add(spindle);
  const plat = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.022, 0.075), mats.pedalBody);
  plat.position.z = 0.05;
  g.add(plat);
  for (let ix = 0; ix < 4; ix++) {
    for (const yside of [-1, 1]) {
      const pin = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.006, 0.07), mats.pedalBody);
      pin.position.set(-0.04 + ix * 0.026, yside * 0.014, 0.05);
      g.add(pin);
    }
  }
  for (const xside of [-1, 1]) {
    const refl = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.014, 0.05), mats.amber);
    refl.position.set(xside * 0.056, 0, 0.05);
    g.add(refl);
  }
  return g;
}

/** 8-arm sunburst orange sprocket (chainring), in XY plane, axle z. */
function buildSprocket(mats: Record<string, THREE.MeshPhysicalMaterial>): THREE.Group {
  const g = new THREE.Group();
  const R = 0.11;
  const shape = new THREE.Shape();
  const teeth = 34;
  for (let i = 0; i <= teeth; i++) {
    const a = (i / teeth) * Math.PI * 2;
    const rr = R + (i % 2 === 0 ? 0.006 : 0.0);
    const x = Math.cos(a) * rr;
    const y = Math.sin(a) * rr;
    if (i === 0) shape.moveTo(x, y); else shape.lineTo(x, y);
  }
  const arms = 8;
  for (let i = 0; i < arms; i++) {
    const a = (i / arms) * Math.PI * 2 + Math.PI / arms;
    const hole = new THREE.Path();
    const ri = 0.028;
    const ro = R - 0.02;
    const aw = 0.22;
    hole.moveTo(Math.cos(a - aw * 0.4) * ri, Math.sin(a - aw * 0.4) * ri);
    for (let s = 0; s <= 8; s++) {
      const t = -aw + (2 * aw * s) / 8;
      hole.lineTo(Math.cos(a + t) * ro, Math.sin(a + t) * ro);
    }
    hole.lineTo(Math.cos(a + aw * 0.4) * ri, Math.sin(a + aw * 0.4) * ri);
    hole.closePath();
    shape.holes.push(hole);
  }
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 0.016, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.003, bevelSegments: 1, curveSegments: 8,
  });
  geo.center();
  g.add(new THREE.Mesh(geo, mats.rimOrange));
  // central spider boss so the ring reads as mounted, not a floating plate
  const boss = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.026, 20), mats.magBlack);
  boss.rotation.x = Math.PI / 2;
  g.add(boss);
  return g;
}

/**
 * Roller chain as an array of alternating link plates wrapping the chainring + rear cog.
 * Path = upper external run → wrap the rear (+x) of the cog → lower run → wrap the front
 * (−x) of the chainring. Links are placed tangent to the path (not two flat strips).
 */
function buildChain(
  c1: THREE.Vector2, r1: number, // chainring
  c2: THREE.Vector2, r2: number, // rear cog
  z: number,
  mats: Record<string, THREE.MeshPhysicalMaterial>,
): THREE.Group {
  const g = new THREE.Group();
  const pts: THREE.Vector2[] = [];
  const arc = (c: THREE.Vector2, r: number, a0: number, a1: number, n: number): void => {
    for (let i = 0; i <= n; i++) {
      const a = a0 + ((a1 - a0) * i) / n;
      pts.push(new THREE.Vector2(c.x + Math.cos(a) * r, c.y + Math.sin(a) * r));
    }
  };
  // top run start (top of chainring) → top of cog, then wrap cog rear, bottom run, wrap chainring front
  pts.push(new THREE.Vector2(c1.x, c1.y + r1));
  pts.push(new THREE.Vector2(c2.x, c2.y + r2));
  arc(c2, r2, Math.PI / 2, -Math.PI / 2, 10); // around the +x side of the cog
  pts.push(new THREE.Vector2(c1.x, c1.y - r1));
  arc(c1, r1, -Math.PI / 2, -Math.PI * 1.5, 16); // around the −x side of the chainring

  // resample at uniform spacing and drop an alternating link at each step
  const spacing = 0.016;
  let carry = 0;
  const linkOuter = new THREE.BoxGeometry(0.022, 0.012, 0.016);
  const linkInner = new THREE.BoxGeometry(0.02, 0.008, 0.01);
  let toggle = false;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const seg = b.clone().sub(a);
    let segLen = seg.length();
    const dir = seg.clone().normalize();
    let t = carry;
    while (t < segLen) {
      const p = a.clone().addScaledVector(dir, t);
      const link = new THREE.Mesh(toggle ? linkInner : linkOuter, mats.chain);
      link.position.set(p.x, p.y, z);
      link.rotation.z = Math.atan2(dir.y, dir.x);
      g.add(link);
      toggle = !toggle;
      t += spacing;
    }
    carry = t - segLen;
  }
  return g;
}

/** Rear U-brake: two arms hugging the tyre + straddle cable + barrel adjuster. */
function buildUBrake(mats: Record<string, THREE.MeshPhysicalMaterial>): THREE.Group {
  const g = new THREE.Group();
  for (const zside of [-1, 1]) {
    g.add(tube(v(0, 0, zside * 0.05), v(-0.02, 0.11, zside * 0.03), 0.01, 0.008, mats.glossBlack, 10));
    const pad = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.014, 0.02), mats.glossBlack);
    pad.position.set(0, 0, zside * 0.055);
    g.add(pad);
    const boltHead = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.01, 10), mats.chrome);
    boltHead.rotation.x = Math.PI / 2;
    boltHead.position.set(-0.02, 0.11, zside * 0.03);
    g.add(boltHead);
  }
  const yoke = v(0, 0.12, 0);
  g.add(tube(v(-0.02, 0.11, -0.03), yoke, 0.003, 0.003, mats.chrome, 6));
  g.add(tube(v(-0.02, 0.11, 0.03), yoke, 0.003, 0.003, mats.chrome, 6));
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.03, 10), mats.chrome);
  barrel.position.copy(yoke).add(v(0, 0.02, 0));
  g.add(barrel);
  // housing hugs forward along the seat stay toward the frame (local −x), not skyward
  g.add(cable([
    yoke.clone().add(v(0, 0.03, 0)),
    v(-0.12, 0.14, 0.01),
    v(-0.28, 0.11, 0),
    v(-0.4, 0.08, 0),
  ], 0.004, mats.glossBlack));
  return g;
}

/** A flat decal quad carrying a transparent canvas texture. */
function decalQuad(tex: THREE.CanvasTexture | null, w: number, h: number, fallbackColor = COL.frame): THREE.Mesh {
  const mat = new THREE.MeshPhysicalMaterial({
    map: tex ?? undefined,
    color: tex ? new THREE.Color('#ffffff') : new THREE.Color(fallbackColor),
    transparent: true, roughness: 0.25, clearcoat: 0.6,
    depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, envMapIntensity: 0.6,
  });
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
}

// ---------------------------------------------------------------------------
// Main factory
// ---------------------------------------------------------------------------
export function createBMXEnduranceBikeModel(options: ProceduralModelOptions = {}): THREE.Group {
  const root = new THREE.Group();
  root.name = 'BMX Endurance Bike';
  const M = buildMaterials();

  const nodes: Record<string, THREE.Object3D> = { root };
  const meshes: Record<string, THREE.Mesh> = {};
  const sockets: Record<string, THREE.Object3D> = {};
  const colliders: Record<string, unknown> = {};
  const destructionGroups: Record<string, THREE.Object3D[]> = {};

  const addNode = (id: string, obj: THREE.Object3D, group: string, parent: THREE.Object3D = root): void => {
    parent.add(obj);
    nodes[id] = obj;
    (destructionGroups[group] ??= []).push(obj);
  };

  // ---- Frame skeleton (joint coordinates) ----
  // BB, front & rear axles are FIXED (the registry drivetrain rig pivots on them).
  // Everything else is shaped for a low, stubby BMX freestyle stance.
  // Front axle pushed forward + rear axle pulled in (~16% shorter rear) for a compact
  // BMX wheelbase with a clean 3-4cm tyre↔down-tube gap. These MUST match registry.ts.
  const BB = v(-0.02, -0.24);
  const seatCluster = v(0.1, 0.04); // short seat tube → low, stubby stance
  const headTop = v(-0.47, 0.26); // head tube forward/up so the front tyre clears the down tube
  const headBot = v(-0.51, 0.12);
  const frontAxle = v(-0.66, -0.28); // pushed forward → ~4cm gap to the down tube
  const rearAxle = v(0.52, -0.28); // pulled in ~16% → tighter BMX rear end
  const barBase = v(-0.46, 0.35);

  const frameGroup = new THREE.Group();
  frameGroup.name = 'frame';
  root.add(frameGroup);
  destructionGroups['frame'] = [frameGroup];
  const addFrame = (mesh: THREE.Mesh): void => { frameGroup.add(mesh); };

  addFrame(tube(BB, seatCluster, 0.023, 0.021, M.frame)); // seat tube (short)
  addFrame(tube(BB, headBot, 0.034, 0.03, M.frame)); // down tube — fattest tube, steep
  addFrame(tube(seatCluster, headTop, 0.02, 0.019, M.frame)); // top tube — slimmer than down tube
  // Seat + chain stays bow OUTBOARD around the rear tyre (half-width ≈ 0.05) so they
  // clear it, then converge to the dropouts. Curved tubes, not straight (which pierced).
  for (const zs of [-1, 1]) {
    addFrame(cable([
      seatCluster.clone().setZ(0.02 * zs),
      v(0.28, -0.11, 0.092 * zs),
      rearAxle.clone().setZ(0.066 * zs),
    ], 0.011, M.frame)); // seat stay
    addFrame(cable([
      BB.clone().setZ(0.045 * zs),
      v(0.24, -0.3, 0.098 * zs),
      rearAxle.clone().setZ(0.066 * zs),
    ], 0.013, M.frame)); // chain stay
  }
  addFrame(tube(headTop, headBot, 0.034, 0.034, M.frame)); // head tube (beefy)

  const bbShell = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.13, 24), M.frame);
  bbShell.rotation.x = Math.PI / 2;
  bbShell.position.copy(BB);
  addFrame(bbShell);

  // Fork (orange): steerer stub + crown + long legs (spread wider than the tyre) + dropouts.
  const forkCrownPos = v(-0.51, 0.07);
  addFrame(tube(headBot, forkCrownPos, 0.022, 0.024, M.frame)); // lower steerer into crown
  const forkCrown = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.035, 0.14), M.frame);
  forkCrown.position.copy(forkCrownPos);
  addFrame(forkCrown);
  const forkZ = 0.065; // outboard of the tyre half-width (0.05)
  for (const zs of [-1, 1]) {
    // long raked leg, tapering down from a thicker crown to a slim dropout
    addFrame(tube(forkCrownPos.clone().setZ(forkZ * zs), frontAxle.clone().setZ(forkZ * zs), 0.019, 0.009, M.frame));
    // flat drilled dropout plate around the axle (thin box + hole ring)
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.09, 0.012), M.frame);
    plate.position.copy(frontAxle).setZ(forkZ * zs);
    addFrame(plate);
    const hole = new THREE.Mesh(new THREE.TorusGeometry(0.015, 0.006, 8, 16), M.glossBlack);
    hole.position.copy(frontAxle).setZ(forkZ * zs + 0.007 * zs);
    addFrame(hole);
  }

  // ---- TIG weld beads at the joints (fish-scale) ----
  const welds = new THREE.Group();
  welds.name = 'welds';
  root.add(welds);
  welds.add(weldRing(BB.clone().add(v(0.03, 0.06, 0)), new THREE.Vector3().subVectors(seatCluster, BB), 0.024, M.weld));
  welds.add(weldRing(BB.clone().add(v(-0.06, 0.03, 0)), new THREE.Vector3().subVectors(headBot, BB), 0.03, M.weld));
  welds.add(weldRing(headBot.clone().add(v(0.03, 0.02, 0)), new THREE.Vector3().subVectors(BB, headBot), 0.03, M.weld));
  welds.add(weldRing(headTop.clone().add(v(0.03, -0.02, 0)), new THREE.Vector3().subVectors(seatCluster, headTop), 0.024, M.weld));
  welds.add(weldRing(seatCluster.clone().add(v(-0.03, -0.02, 0)), new THREE.Vector3().subVectors(headTop, seatCluster), 0.023, M.weld));

  // ---- Seatpost + clamp + saddle: post slammed low, saddle near-horizontal ----
  const seatTop = v(0.11, 0.12); // very short post, tucked down near the frame
  addFrame(tube(seatCluster, seatTop, 0.015, 0.015, M.glossBlack));
  const clamp = new THREE.Mesh(new THREE.TorusGeometry(0.02, 0.007, 8, 20), M.glossBlack);
  clamp.rotation.x = Math.PI / 2;
  clamp.position.set(seatCluster.x, seatCluster.y + 0.02, 0);
  addFrame(clamp);
  const saddle = buildSaddle(M); // long axis already along x (nose −x = front)
  saddle.position.set(0.14, seatTop.y + 0.06, 0);
  saddle.rotation.z = -0.11; // ~6° nose-up, BMX-standard (research: BMX seats tilt up)
  addNode('saddle', saddle, 'seat');

  // ---- Cockpit: stem, tall riser bar, crossbar, grips, lever ----
  addFrame(tube(headTop, barBase, 0.02, 0.02, M.glossBlack)); // steerer riser
  const stemBlock = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.04, 0.05), M.glossBlack);
  stemBlock.position.copy(barBase);
  addFrame(stemBlock);

  const bx = barBase.x;
  const by = barBase.y;
  const bars = new THREE.Group();
  bars.name = 'handlebar';
  root.add(bars);
  bars.add(tube(v(bx, by, -0.12), v(bx, by, 0.12), 0.016, 0.016, M.glossBlack)); // bottom span
  for (const zs of [-1, 1]) {
    bars.add(tube(v(bx, by, 0.12 * zs), v(bx + 0.02, by + 0.16, 0.2 * zs), 0.015, 0.015, M.glossBlack)); // uprights
    bars.add(tube(v(bx + 0.02, by + 0.16, 0.2 * zs), v(bx + 0.03, by + 0.2, 0.28 * zs), 0.015, 0.015, M.glossBlack)); // bend to grip
  }
  bars.add(tube(v(bx + 0.015, by + 0.15, -0.19), v(bx + 0.015, by + 0.15, 0.19), 0.013, 0.013, M.glossBlack)); // crossbar

  const gripY = by + 0.2;
  for (const [id, zs] of [['gripL', -1], ['gripR', 1]] as const) {
    const grip = buildGrip(M);
    grip.position.set(bx + 0.035, gripY, 0.34 * zs);
    grip.rotation.y = Math.PI / 2; // grip axis → z (outboard)
    addNode(id, grip, 'cockpit');
  }
  const lever = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.012, 0.02), M.glossBlack);
  lever.position.set(bx + 0.04, gripY - 0.015, 0.26);
  lever.rotation.z = 0.2;
  bars.add(lever);
  // brake cable as a smooth curve from the lever down to the head-tube/frame
  bars.add(cable([
    v(bx + 0.06, gripY, 0.25),
    v(bx + 0.12, by + 0.06, 0.12),
    v(headTop.x + 0.03, headTop.y + 0.03, 0.04),
    v(headTop.x + 0.01, headTop.y - 0.06, 0.02),
  ], 0.0035, M.glossBlack));

  // ---- Wheels ----
  const placeWheel = (prefix: 'front' | 'rear', center: THREE.Vector3): void => {
    const parts = buildWheel(M);
    for (const [k, obj] of Object.entries(parts)) {
      obj.position.copy(center);
      const id = `${prefix}${k.charAt(0).toUpperCase()}${k.slice(1)}`; // frontTire/frontRim/frontHub
      addNode(id, obj, 'wheel');
    }
  };
  placeWheel('front', frontAxle);
  placeWheel('rear', rearAxle);

  // ---- Pegs (4: front + rear, both sides) — static ----
  const pegs = new THREE.Group();
  pegs.name = 'pegs';
  root.add(pegs);
  // Front axle: ONE slim, smooth matte-black peg (drive side).
  const frontPeg = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.13, 20), M.matteBlack);
  frontPeg.rotation.x = Math.PI / 2;
  frontPeg.position.copy(frontAxle).setZ(WHEEL_WIDTH * 0.5 + 0.085);
  pegs.add(frontPeg);
  // Rear axle: knurled anodized pegs on both sides.
  for (const zs of [-1, 1]) {
    const peg = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.12, 20), M.peg);
    peg.rotation.x = Math.PI / 2;
    peg.position.copy(rearAxle).setZ(zs * (WHEEL_WIDTH * 0.5 + 0.08));
    pegs.add(peg);
  }

  // ---- Drivetrain: BB spindle, bolted cranks, sprocket, pedals, roller chain, cog ----
  // static BB spindle through the shell — widened so the cranks sit outboard of the
  // chainstays and the pedals swing free (no frame collision at any crank angle).
  const CRANK_Z = 0.1;
  const spindle = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, CRANK_Z * 2 + 0.04, 16), M.chrome);
  spindle.rotation.x = Math.PI / 2;
  spindle.position.set(BB.x, BB.y, 0);
  addFrame(spindle);

  const crankBolt = (zoff: number): THREE.Mesh => {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.019, 0.014, 12), M.chrome);
    b.rotation.x = Math.PI / 2;
    b.position.z = zoff;
    return b;
  };

  const crankL = new THREE.Group();
  crankL.position.set(BB.x, BB.y, CRANK_Z);
  crankL.add(tube(v(0, 0, 0), v(0, -0.11, 0), 0.016, 0.013, M.glossBlack));
  crankL.add(crankBolt(0.014)); // nut fixing the arm to the spindle
  addNode('crankArmL', crankL, 'drivetrain');

  const crankR = new THREE.Group();
  crankR.position.set(BB.x, BB.y, -CRANK_Z);
  crankR.add(tube(v(0, 0, 0), v(0, 0.11, 0), 0.016, 0.013, M.glossBlack));
  crankR.add(crankBolt(-0.014));
  addNode('crankArmR', crankR, 'drivetrain');

  // sprocket + cog + chain share the SAME z-plane so the chain seats on both
  const DRIVE_Z = 0.058;
  const chainring = buildSprocket(M);
  chainring.position.set(BB.x, BB.y, DRIVE_Z);
  addNode('chainring', chainring, 'drivetrain');

  const cogR = 0.05;
  const cog = new THREE.Mesh(new THREE.CylinderGeometry(cogR, cogR, 0.016, 24), M.magBlack);
  cog.rotation.x = Math.PI / 2;
  cog.position.set(rearAxle.x, rearAxle.y, DRIVE_Z);
  root.add(cog);

  const pedalL = buildPedal(M);
  pedalL.position.set(BB.x, BB.y - 0.11, 0.155); // outboard of the crank + chainstay
  addNode('pedalL', pedalL, 'drivetrain');
  const pedalR = buildPedal(M);
  pedalR.position.set(BB.x, BB.y + 0.11, -0.155);
  addNode('pedalR', pedalR, 'drivetrain');

  // roller chain — array of alternating links wrapping sprocket teeth + rear cog
  root.add(buildChain(
    new THREE.Vector2(BB.x, BB.y), 0.116, // rides on the ~0.11 sprocket teeth
    new THREE.Vector2(rearAxle.x, rearAxle.y), cogR + 0.006,
    DRIVE_Z, M,
  ));

  // ---- Rear U-brake (above the rear tyre, mounted on the seat stays) ----
  const ubrake = buildUBrake(M);
  ubrake.position.set(rearAxle.x - 0.12, -0.02, 0);
  root.add(ubrake);

  // ---- Decals: BMX (top tube), Endurance (down tube), lightning (head tube) ----
  const bmxTex = decalTexture(512, 160, (ctx, _w, h) => {
    ctx.fillStyle = '#1a1a1a';
    for (let i = 0; i < 3; i++) ctx.fillRect(10 + i * 20, h * 0.2, 10, h * 0.6);
    ctx.font = `900 ${Math.round(h * 0.7)}px Arial, sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.fillText('BMX', 80, h * 0.5);
    ctx.fillStyle = '#f39a1b';
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.moveTo(360 + i * 26, h * 0.2);
      ctx.lineTo(380 + i * 26, h * 0.2);
      ctx.lineTo(360 + i * 26, h * 0.8);
      ctx.lineTo(340 + i * 26, h * 0.8);
      ctx.closePath();
      ctx.fill();
    }
  });
  const enduranceTex = decalTexture(512, 96, (ctx, _w, h) => {
    ctx.fillStyle = '#141414';
    ctx.font = `italic 800 ${Math.round(h * 0.72)}px Georgia, serif`;
    ctx.textBaseline = 'middle';
    ctx.fillText('Endurance', 8, h * 0.55);
  });
  const decals = new THREE.Group();
  decals.name = 'decals';
  root.add(decals);
  const topMid = seatCluster.clone().lerp(headTop, 0.52);
  // Reading direction runs front→back (−x → +x = screen left→right) so the text is
  // upright; using the front-pointing tube direction would spin it ~180°.
  const topAngle = Math.atan2(seatCluster.y - headTop.y, seatCluster.x - headTop.x);
  const downMid = BB.clone().lerp(headBot, 0.5);
  const downAngle = Math.atan2(BB.y - headBot.y, BB.x - headBot.x);
  // Decals are applied to the drive side (+z, the side the studio camera faces). A
  // single quad per graphic avoids the far-side mirror bleed-through a thin tube can't
  // occlude. Text reads left-to-right for a +z-facing viewer. (No head-tube logo.)
  {
    const bmx = decalQuad(bmxTex, 0.26, 0.055); // long, fills the top-tube width
    bmx.position.copy(topMid).setZ(0.021);
    bmx.rotation.set(0, 0, topAngle);
    decals.add(bmx);

    const end = decalQuad(enduranceTex, 0.2, 0.04); // bigger, up on the down tube
    end.position.copy(downMid).setZ(0.036);
    end.rotation.set(0, 0, downAngle);
    decals.add(end);
  }

  applyShadow(root, options);

  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) meshes[o.name || `mesh_${Object.keys(meshes).length}`] = m;
  });

  root.userData.sculptRuntime = { nodes, meshes, sockets, colliders, destructionGroups } satisfies ProceduralModelRuntime;
  root.userData.actionReadiness = {
    note: 'root.userData.sculptRuntime.nodes exposes wheels (frontTire/frontRim/frontHub, rear…), crankArmL/R, chainring, pedalL/R for the drivetrain rig.',
  };
  return root;
}

// ---------------------------------------------------------------------------
// Studio look-dev rig (per the supplied lighting spec)
// ---------------------------------------------------------------------------
export function createBMXEnduranceBikeLookDevLights(
  mode: 'neutral' | 'grazing' | 'reference' = 'neutral',
): THREE.Group {
  const lights = new THREE.Group();
  lights.name = 'BMX Endurance Bike look-dev lights';

  // Key — warm, high right, sharp shadow
  const key = new THREE.DirectionalLight(0xfff8f0, mode === 'grazing' ? 2.6 : 1.9);
  key.position.set(5, 8, 5);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.0003;
  key.shadow.normalBias = 0.02;
  key.shadow.radius = 6;
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 30;
  key.shadow.camera.left = -2.2;
  key.shadow.camera.right = 2.2;
  key.shadow.camera.top = 2.2;
  key.shadow.camera.bottom = -2.2;
  key.shadow.camera.updateProjectionMatrix();
  lights.add(key);

  // Fill — warm + soft, front-left; catches bevels without desaturating the orange
  const fill = new THREE.DirectionalLight(0xffe7cc, 0.45);
  fill.position.set(-6, 3, 4);
  lights.add(fill);

  // Rim — behind, separates black parts from the dark stage
  const rim = new THREE.DirectionalLight(0xfff1c4, mode === 'grazing' ? 3.0 : 1.9);
  rim.position.set(0, 6, -6);
  lights.add(rim);

  const hemi = new THREE.HemisphereLight(0xbfd0ff, 0x14161c, 0.3);
  lights.add(hemi);

  // Softbox panels — large area lights that paint the long, curved specular streaks
  // the reference shows running down the glossy frame + mag wheels. Kept modest so
  // they add streaks without flooding the scene and desaturating the orange.
  RectAreaLightUniformsLib.init();
  const softTop = new THREE.RectAreaLight(0xffffff, 2.2, 2.4, 0.5);
  softTop.position.set(0, 2.4, 1.2);
  softTop.lookAt(0, -0.2, 0);
  lights.add(softTop);

  const softSide = new THREE.RectAreaLight(0xfff2df, 1.5, 0.5, 2.0);
  softSide.position.set(1.6, 0.4, 2.2);
  softSide.lookAt(0, -0.1, 0);
  lights.add(softSide);

  lights.userData.reviewMode = mode;
  return lights;
}
