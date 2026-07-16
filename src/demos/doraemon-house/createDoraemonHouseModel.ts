import * as THREE from 'three';

/**
 * DORAEMON HOUSE — an isometric residential-diorama scene rebuilt in code from a single
 * hand-illustrated reference ("DORAEMON HOUSE", illustrated by Khoa Hee Bin) via img2threejs.
 *
 * Identity-defining systems reproduced from the reference:
 *  - An interlocking cluster of gabled volumes with bright RED ribbed roofs + cream eave/ridge trim,
 *    stacked over two storeys (tall back gable w/ antenna, mid dormer, wide front gables).
 *  - Cream / tan stucco walls with blue-glass white-framed windows, a strawberry emblem plaque,
 *    a wood front door under an awning, a purple garage door, and drainpipes.
 *  - NOBITA (brown hair, glasses, yellow tee, blue shorts) sitting on the top ridge, legs dangling.
 *  - DORAEMON (blue round cat, white face, red collar + bell) lying on a lower red roof slope.
 *  - A gray cinder-block perimeter wall with two light-wood slat gates, green lawn + rounded trees.
 *  - Two concrete utility poles with cross-arms + flat street-lamp heads and a web of black wires.
 *  - A metal trash can + garbage bag on the asphalt road (yellow centre line) wrapping the lot.
 *  - Cyan sky gradient backdrop; warm key-light from upper-left as in the reference.
 *
 * Built in world space on a rectangular base tile, framed for an isometric ~3/4 camera.
 * Subtle life via root.userData.tick: swaying tree canopies, twinkling dusk windows,
 * a gentle bob on the two characters. Action-ready nodes exposed on root.userData.sculptRuntime.
 */

export interface DoraemonHouseOptions {
  scale?: number;
  shadows?: boolean;
}

// ---------------------------------------------------------------------------
// palette (sampled from the reference)
// ---------------------------------------------------------------------------
const ROOF_RED = 0xcf1e12; // deep saturated red — stays red under ACES highlights, not coral
const TRIM_CREAM = 0xf6ecd4;
const WALL_CREAM = 0xe9d6ac;
const WALL_TAN = 0xdcc493;
const WALL_SHADE = 0xc7ac7d;
const GLASS_BLUE = 0xbcd8e8;
const FRAME_WHITE = 0xfaf3e2;
const DOOR_WOOD = 0xb15f37;
const DOOR_PURPLE = 0x7d6390;
const BLOCK_GRAY = 0xa9a2ba;
const BLOCK_GRAY_DK = 0x827c93;
const BLOCK_CAP = 0xc2bccf;
const ROAD_DARK = 0x35343d;
const ROAD_LINE = 0xe6c23c;
const CURB_TAN = 0xcdbb8c;
const GRASS = 0x67ad48;
const FOLIAGE = 0x57a634;
const FOLIAGE_HI = 0x93cf4c;
const FOLIAGE_DK = 0x367821;
const TRUNK = 0x6e4a2a;
const POLE_GRAY = 0xb4bac1;
const POLE_GRAY_DK = 0x8b9198;
const WIRE = 0x171717;
const BASE_SIDE = 0x2a2a31;

// character palette
const SKIN = 0xf1c39a;
const HAIR = 0x53331a;
const TEE_YELLOW = 0xf0cf3a;
const SHORTS_BLUE = 0x2f6fb0;
const GLASS_FRAME = 0x1c1c1c;
const DORA_BLUE = 0x1fa8dc;
const DORA_FACE = 0xf6f4ec;
const DORA_RED = 0xe23a2c;
const DORA_YELLOW = 0xf4c93a;

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

function hex(c: number): string {
  return '#' + c.toString(16).padStart(6, '0');
}

function newCanvas(w: number, h: number): { cv: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  return { cv, ctx: cv.getContext('2d')! };
}

// ---------------------------------------------------------------------------
// textures
// ---------------------------------------------------------------------------

/** Ribbed corrugated-roof texture: red base with regularly spaced darker seam lines + a few vents. */
function makeRoofTexture(): THREE.CanvasTexture {
  const S = 256;
  const { cv, ctx } = newCanvas(S, S);
  ctx.fillStyle = hex(ROOF_RED);
  ctx.fillRect(0, 0, S, S);
  // subtle vertical sheen bands — highlight kept minimal so the red reads deep & punchy,
  // shade side pushed a touch for slope contrast (depth without washing the hue out)
  const grad = ctx.createLinearGradient(0, 0, S, 0);
  grad.addColorStop(0, 'rgba(255,90,60,0.03)');
  grad.addColorStop(0.5, 'rgba(0,0,0,0.0)');
  grad.addColorStop(1, 'rgba(80,10,6,0.24)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, S, S);
  // ribs (seams running down-slope => horizontal lines in UV)
  const ribs = 11;
  for (let i = 0; i <= ribs; i++) {
    const y = (i / ribs) * S;
    ctx.strokeStyle = 'rgba(120,25,16,0.8)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(S, y);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,110,88,0.32)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, y + 3);
    ctx.lineTo(S, y + 3);
    ctx.stroke();
  }
  // a couple of little roof-vent marks
  const rand = mulberry32(0x0a11);
  ctx.fillStyle = 'rgba(150,45,32,0.7)';
  for (let i = 0; i < 3; i++) {
    const x = 40 + rand() * (S - 80);
    const y = 40 + rand() * (S - 80);
    ctx.fillRect(x, y, 14, 9);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** Cinder-block wall texture: gray blocks with darker mortar grid + faint speckle. */
function makeBlockTexture(): THREE.CanvasTexture {
  const S = 256;
  const { cv, ctx } = newCanvas(S, S);
  ctx.fillStyle = hex(BLOCK_GRAY);
  ctx.fillRect(0, 0, S, S);
  const cols = 4;
  const rows = 6;
  const cw = S / cols;
  const ch = S / rows;
  ctx.strokeStyle = hex(BLOCK_GRAY_DK);
  ctx.lineWidth = 4;
  for (let r = 0; r <= rows; r++) {
    ctx.beginPath();
    ctx.moveTo(0, r * ch);
    ctx.lineTo(S, r * ch);
    ctx.stroke();
  }
  for (let c = 0; c <= cols; c++) {
    ctx.beginPath();
    ctx.moveTo(c * cw, 0);
    ctx.lineTo(c * cw, S);
    ctx.stroke();
  }
  const rand = mulberry32(0x0b12);
  for (let i = 0; i < 500; i++) {
    ctx.fillStyle = `rgba(0,0,0,${0.03 + rand() * 0.05})`;
    ctx.fillRect(rand() * S, rand() * S, 2, 2);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** Cyan sky gradient used as scene backdrop. */
export function makeSkyTexture(): THREE.CanvasTexture {
  const { cv, ctx } = newCanvas(16, 256);
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, '#2f96d8');
  g.addColorStop(0.55, '#49b0e6');
  g.addColorStop(1, '#7fd2f4');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 16, 256);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ---------------------------------------------------------------------------
// shared geometry/material caches
// ---------------------------------------------------------------------------
interface Ctx {
  shadows: boolean;
  roofTex: THREE.CanvasTexture;
  blockTex: THREE.CanvasTexture;
  mats: Record<string, THREE.Material>;
  windows: THREE.MeshStandardMaterial[];
}

function mkStd(color: number, opts: Partial<THREE.MeshStandardMaterialParameters> = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.0, ...opts });
}

function box(
  ctx: Ctx,
  w: number,
  h: number,
  d: number,
  mat: THREE.Material,
): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.castShadow = ctx.shadows;
  m.receiveShadow = ctx.shadows;
  return m;
}

// ---------------------------------------------------------------------------
// roof piece: a gabled (triangular-prism) roof with ribbed red material + cream trim
// ---------------------------------------------------------------------------
function makeGableRoof(
  ctx: Ctx,
  width: number, // along ridge
  span: number, // eave-to-eave
  height: number, // ridge rise
  overhang = 0.18,
): THREE.Group {
  const g = new THREE.Group();
  const w = width + overhang * 2;
  const s = span + overhang * 2;

  const roofMat = new THREE.MeshStandardMaterial({
    map: ctx.roofTex.clone(),
    color: 0xffffff,
    roughness: 0.78,
    metalness: 0.0,
    emissive: 0x2a0803,
    emissiveIntensity: 0.05, // was 0.18 — less self-lit so the red stays deep, not coral
  });
  (roofMat.map as THREE.Texture).repeat.set(Math.max(1, w * 1.1), Math.max(1, s * 0.9));
  (roofMat.map as THREE.Texture).needsUpdate = true;

  // triangular prism via extruded shape (cross-section in X=span, Y=height)
  const shape = new THREE.Shape();
  shape.moveTo(-s / 2, 0);
  shape.lineTo(s / 2, 0);
  shape.lineTo(0, height);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: w, bevelEnabled: false });
  geo.translate(0, 0, -w / 2);
  geo.rotateY(Math.PI / 2); // ridge now runs along X
  const roof = new THREE.Mesh(geo, roofMat);
  roof.castShadow = ctx.shadows;
  roof.receiveShadow = ctx.shadows;
  g.add(roof);

  // cream ridge cap
  const ridge = box(ctx, w, 0.09, 0.14, ctx.mats.trim as THREE.Material);
  ridge.position.y = height + 0.005;
  g.add(ridge);

  // cream eave fascia boards on both long edges
  const slope = Math.sqrt((s / 2) * (s / 2) + height * height);
  const angle = Math.atan2(height, s / 2);
  for (const sign of [-1, 1]) {
    const fascia = box(ctx, w, 0.11, 0.05, ctx.mats.trim as THREE.Material);
    fascia.position.set(0, height / 2, (sign * s) / 2 - sign * 0.0);
    // sit fascia along the sloped edge
    fascia.position.set(0, height / 2 - 0.02, 0);
    const edge = box(ctx, w, 0.09, 0.07, ctx.mats.trim as THREE.Material);
    edge.rotation.x = sign * -angle;
    edge.position.set(0, (height - height) + (Math.sin(angle) * 0) , 0);
    // place trim strip running along the sloped face bottom edge:
    edge.position.set(0, 0.02, (sign * s) / 2);
    edge.rotation.z = 0;
    g.add(edge);
    void slope;
    void fascia;
  }

  return g;
}

// ---------------------------------------------------------------------------
// a window (blue glass + white frame), optionally emissive (dusk glow)
// ---------------------------------------------------------------------------
function makeWindow(ctx: Ctx, w: number, h: number, glow = false): THREE.Group {
  const g = new THREE.Group();
  const frame = box(ctx, w, h, 0.06, ctx.mats.frame as THREE.Material);
  g.add(frame);
  const glassMat = new THREE.MeshStandardMaterial({
    color: glow ? 0xffcf7a : GLASS_BLUE,
    roughness: 0.25,
    metalness: 0.1,
    emissive: glow ? 0xffb457 : 0x0a1a24,
    emissiveIntensity: glow ? 0.9 : 0.15,
  });
  if (glow) ctx.windows.push(glassMat);
  const glass = new THREE.Mesh(new THREE.BoxGeometry(w - 0.08, h - 0.08, 0.02), glassMat);
  glass.position.z = 0.03;
  g.add(glass);
  // muntin cross
  const mv = box(ctx, 0.03, h - 0.08, 0.04, ctx.mats.frame as THREE.Material);
  mv.position.z = 0.045;
  g.add(mv);
  return g;
}

// ---------------------------------------------------------------------------
// downpipe (drain) running down a wall
// ---------------------------------------------------------------------------
function makeDownpipe(ctx: Ctx, h: number): THREE.Mesh {
  const m = new THREE.Mesh(
    new THREE.CylinderGeometry(0.045, 0.045, h, 10),
    ctx.mats.wallShade as THREE.Material,
  );
  m.castShadow = ctx.shadows;
  return m;
}

// ---------------------------------------------------------------------------
// HOUSE — interlocking cream volumes + red gable roofs, matching the reference stack
// ---------------------------------------------------------------------------
function makeHouse(ctx: Ctx): { group: THREE.Group; topRidgeY: number; doraSlope: THREE.Object3D } {
  const g = new THREE.Group();
  const wallMat = ctx.mats.wall as THREE.Material;
  const wallTanMat = ctx.mats.wallTan as THREE.Material;

  // ---- lower-front wide block (front-left facade, holds front door + strawberry) ----
  const frontW = 4.2;
  const frontD = 3.0;
  const frontH = 1.7;
  const front = box(ctx, frontW, frontH, frontD, wallMat);
  front.position.set(-1.7, frontH / 2, 1.6);
  g.add(front);
  const frontRoof = makeGableRoof(ctx, frontW, frontD, 1.15);
  frontRoof.position.set(-1.7, frontH, 1.6);
  frontRoof.rotation.y = 0; // ridge along X
  g.add(frontRoof);

  // ---- lower-right wide block (front-right facade, garage/purple door) ----
  const rW = 4.6;
  const rD = 3.0;
  const rH = 1.7;
  const rightLow = box(ctx, rW, rH, rD, wallTanMat);
  rightLow.position.set(2.5, rH / 2, 1.2);
  g.add(rightLow);
  const rightRoof = makeGableRoof(ctx, rD, rW, 1.2);
  rightRoof.position.set(2.5, rH, 1.2);
  rightRoof.rotation.y = Math.PI / 2; // ridge along Z
  g.add(rightRoof);

  // ---- central mid block behind, slightly taller ----
  const midW = 3.2;
  const midD = 3.0;
  const midH = 2.7;
  const mid = box(ctx, midW, midH, midD, wallMat);
  mid.position.set(0.3, midH / 2, -0.9);
  g.add(mid);
  const midRoof = makeGableRoof(ctx, midW, midD, 1.1);
  midRoof.position.set(0.3, midH, -0.9);
  g.add(midRoof);

  // ---- tall back gable (top storey) with antenna ----
  const topW = 2.6;
  const topD = 2.4;
  const topH = 3.9;
  const top = box(ctx, topW, topH, topD, wallMat);
  top.position.set(-0.5, topH / 2, -1.9);
  g.add(top);
  const topRoof = makeGableRoof(ctx, topW, topD, 1.15);
  topRoof.position.set(-0.5, topH, -1.9);
  g.add(topRoof);
  const topRidgeY = topH + 1.15;

  // small dormer box to the right of the tall gable
  const dormW = 1.6;
  const dormH = 2.9;
  const dormD = 1.8;
  const dorm = box(ctx, dormW, dormH, dormD, wallTanMat);
  dorm.position.set(1.5, dormH / 2, -1.6);
  g.add(dorm);
  const dormRoof = makeGableRoof(ctx, dormD, dormW, 0.7);
  dormRoof.rotation.y = Math.PI / 2;
  dormRoof.position.set(1.5, dormH, -1.6);
  g.add(dormRoof);

  // ---- antenna on the top ridge ----
  const antenna = new THREE.Group();
  const mast = new THREE.Mesh(
    new THREE.CylinderGeometry(0.02, 0.02, 1.1, 6),
    ctx.mats.poleDk as THREE.Material,
  );
  mast.position.y = 0.55;
  antenna.add(mast);
  for (let i = 0; i < 4; i++) {
    const bar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.012, 0.012, 0.5 - i * 0.07, 6),
      ctx.mats.poleDk as THREE.Material,
    );
    bar.rotation.z = Math.PI / 2;
    bar.position.y = 0.75 + i * 0.11;
    antenna.add(bar);
  }
  antenna.position.set(0.1, topRidgeY, -1.9);
  g.add(antenna);

  // ---- windows ----
  const winGroup = new THREE.Group();
  // top gable front face windows (two small, dusk-glow)
  const w1 = makeWindow(ctx, 0.55, 0.7, false);
  w1.position.set(-0.9, topH * 0.72, -1.9 + topD / 2 + 0.01);
  winGroup.add(w1);
  const w2 = makeWindow(ctx, 0.55, 0.7, false);
  w2.position.set(-0.15, topH * 0.72, -1.9 + topD / 2 + 0.01);
  winGroup.add(w2);
  // dormer window (facing front, glowing)
  const w3 = makeWindow(ctx, 0.5, 0.6, true);
  w3.position.set(1.5, dormH * 0.62, -1.6 + dormD / 2 + 0.01);
  winGroup.add(w3);
  // front-left facade window pair (facing +Z front)
  const w4 = makeWindow(ctx, 0.9, 0.7, false);
  w4.rotation.y = 0;
  w4.position.set(-2.6, 0.95, 1.6 + frontD / 2 + 0.01);
  winGroup.add(w4);
  // front-right facade windows (glowing dusk)
  const w5 = makeWindow(ctx, 0.7, 0.6, true);
  w5.position.set(3.9, 0.9, 1.2 + rD / 2 + 0.01);
  winGroup.add(w5);
  g.add(winGroup);

  // ---- front door + awning (front-left facade) ----
  const door = box(ctx, 0.6, 1.1, 0.08, ctx.mats.door as THREE.Material);
  door.position.set(-1.1, 0.55, 1.6 + frontD / 2 + 0.02);
  g.add(door);
  const awning = box(ctx, 0.85, 0.08, 0.35, ctx.mats.roofRed as THREE.Material);
  awning.position.set(-1.1, 1.2, 1.6 + frontD / 2 + 0.18);
  awning.rotation.x = 0.25;
  g.add(awning);

  // ---- strawberry emblem plaque (front-left facade) ----
  const berry = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 12), mkStd(0xe23a2c, { roughness: 0.5 }));
  berry.scale.set(1, 0.85, 0.4);
  berry.position.set(-2.9, 1.25, 1.6 + frontD / 2 + 0.02);
  g.add(berry);
  const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.12, 5), mkStd(0x3f9b2e));
  leaf.position.set(-2.9, 1.42, 1.6 + frontD / 2 + 0.03);
  g.add(leaf);

  // ---- purple garage door (front-right facade) ----
  const garage = box(ctx, 1.5, 1.1, 0.1, ctx.mats.doorPurple as THREE.Material);
  garage.position.set(2.9, 0.6, 1.2 + rD / 2 + 0.02);
  g.add(garage);
  // horizontal garage slats
  for (let i = 0; i < 4; i++) {
    const slat = box(ctx, 1.5, 0.02, 0.02, ctx.mats.frame as THREE.Material);
    slat.position.set(2.9, 0.25 + i * 0.26, 1.2 + rD / 2 + 0.08);
    g.add(slat);
  }

  // ---- downpipes ----
  const p1 = makeDownpipe(ctx, frontH + 0.3);
  p1.position.set(-3.75, (frontH + 0.3) / 2, 1.6 + frontD / 2 - 0.05);
  g.add(p1);
  const p2 = makeDownpipe(ctx, topH);
  p2.position.set(0.75, topH / 2, -1.9 + topD / 2 - 0.05);
  g.add(p2);

  // slope Doraemon lies on: the front-left gable's +Z-facing slope, near ridge
  const doraSlope = new THREE.Object3D();
  doraSlope.position.set(-1.4, frontH + 0.75, 1.6 + 0.55);
  doraSlope.rotation.x = -0.6;
  g.add(doraSlope);

  return { group: g, topRidgeY, doraSlope };
}

// ---------------------------------------------------------------------------
// NOBITA — stylized chibi boy sitting with legs dangling
// ---------------------------------------------------------------------------
function makeNobita(ctx: Ctx): THREE.Group {
  const g = new THREE.Group();
  const skin = mkStd(SKIN, { roughness: 0.7 });
  const tee = mkStd(TEE_YELLOW, { roughness: 0.8 });
  const shorts = mkStd(SHORTS_BLUE, { roughness: 0.8 });
  const hair = mkStd(HAIR, { roughness: 0.9 });

  // torso
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.2, 6, 12), tee);
  torso.position.y = 0.55;
  torso.castShadow = ctx.shadows;
  g.add(torso);
  // head
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 20, 16), skin);
  head.position.y = 0.92;
  head.castShadow = ctx.shadows;
  g.add(head);
  // hair cap
  const hairMesh = new THREE.Mesh(new THREE.SphereGeometry(0.235, 20, 16, 0, Math.PI * 2, 0, Math.PI * 0.62), hair);
  hairMesh.position.y = 0.95;
  g.add(hairMesh);
  // glasses (two rings)
  for (const dx of [-0.09, 0.09]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.014, 8, 16), mkStd(GLASS_FRAME, { roughness: 0.4 }));
    ring.position.set(dx, 0.92, 0.2);
    g.add(ring);
  }
  // arms (down at sides, hands on roof)
  for (const sx of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.24, 4, 8), tee);
    arm.position.set(sx * 0.2, 0.5, 0.02);
    arm.rotation.z = sx * 0.35;
    g.add(arm);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 8), skin);
    hand.position.set(sx * 0.28, 0.36, 0.05);
    g.add(hand);
  }
  // legs dangling forward/down
  for (const sx of [-1, 1]) {
    const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.16, 4, 8), shorts);
    thigh.position.set(sx * 0.09, 0.34, 0.16);
    thigh.rotation.x = 1.15;
    g.add(thigh);
    const shin = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.2, 4, 8), skin);
    shin.position.set(sx * 0.09, 0.12, 0.26);
    g.add(shin);
    const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.08, 0.16), mkStd(0xf4f4f4));
    shoe.position.set(sx * 0.09, 0.02, 0.33);
    g.add(shoe);
  }
  return g;
}

// ---------------------------------------------------------------------------
// DORAEMON — stylized round blue cat lying prone on a roof slope
// ---------------------------------------------------------------------------
function makeDoraemon(ctx: Ctx): THREE.Group {
  const g = new THREE.Group();
  const blue = mkStd(DORA_BLUE, { roughness: 0.55 });
  const face = mkStd(DORA_FACE, { roughness: 0.5 });

  const body = new THREE.Mesh(new THREE.SphereGeometry(0.3, 20, 16), blue);
  body.scale.set(1, 0.95, 1.05);
  body.castShadow = ctx.shadows;
  g.add(body);
  // white belly/face front disc
  const faceDisc = new THREE.Mesh(new THREE.SphereGeometry(0.235, 20, 16), face);
  faceDisc.position.set(0, -0.01, 0.13);
  faceDisc.scale.set(1, 1, 0.7);
  g.add(faceDisc);
  // eyes
  for (const sx of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 10), mkStd(0xffffff, { roughness: 0.3 }));
    eye.position.set(sx * 0.07, 0.16, 0.21);
    g.add(eye);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.02, 8, 6), mkStd(0x111111));
    pupil.position.set(sx * 0.085, 0.15, 0.26);
    g.add(pupil);
  }
  // red nose
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 10), mkStd(DORA_RED, { roughness: 0.3 }));
  nose.position.set(0, 0.08, 0.3);
  g.add(nose);
  // red collar
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.035, 8, 20), mkStd(DORA_RED, { roughness: 0.5 }));
  collar.rotation.x = Math.PI / 2;
  collar.position.set(0, -0.13, 0.05);
  g.add(collar);
  // bell
  const bell = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 10), mkStd(DORA_YELLOW, { roughness: 0.35, metalness: 0.2 }));
  bell.position.set(0, -0.18, 0.24);
  g.add(bell);
  // little arms forward (prone)
  for (const sx of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.14, 4, 8), blue);
    arm.position.set(sx * 0.24, -0.02, 0.16);
    arm.rotation.z = sx * 0.6;
    arm.rotation.x = 0.5;
    g.add(arm);
    const paw = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), face);
    paw.position.set(sx * 0.32, -0.06, 0.28);
    g.add(paw);
  }
  return g;
}

// ---------------------------------------------------------------------------
// TREE — rounded low-poly canopy (icosahedron clusters) + trunk
// ---------------------------------------------------------------------------
function makeTree(ctx: Ctx, seed: number, radius: number, conical = false): THREE.Group {
  const g = new THREE.Group();
  const rand = mulberry32(seed);
  const trunkH = radius * (conical ? 1.0 : 0.9);
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 0.13, radius * 0.18, trunkH, 8),
    ctx.mats.trunk as THREE.Material,
  );
  trunk.position.y = trunkH / 2;
  trunk.castShadow = ctx.shadows;
  g.add(trunk);

  const canopy = new THREE.Group();
  const greens = [FOLIAGE, FOLIAGE_HI, FOLIAGE_DK];
  if (conical) {
    // stacked cones for a tall bushy tree
    const layers = 4;
    for (let i = 0; i < layers; i++) {
      const t = i / (layers - 1);
      const r = radius * (1 - t * 0.65);
      const cone = new THREE.Mesh(
        new THREE.ConeGeometry(r, radius * 0.9, 9),
        mkStd(greens[i % greens.length], { roughness: 0.95, flatShading: true }),
      );
      cone.position.y = trunkH + i * radius * 0.55;
      cone.rotation.y = rand() * Math.PI;
      cone.castShadow = ctx.shadows;
      canopy.add(cone);
    }
  } else {
    // clustered blobs for a round bush-tree — layered so the canopy reads with real
    // volume: darker greens sit low/inside, brighter highlight blobs catch the top.
    const blobs = 13;
    for (let i = 0; i < blobs; i++) {
      const r = radius * (0.42 + rand() * 0.34);
      const a = rand() * Math.PI * 2;
      const rr = rand() * radius * 0.6;
      const yOff = (rand() - 0.28) * radius * 0.7;
      const y = trunkH + radius * 0.5 + yOff;
      // vertical tone gradient: low blobs darker, crown lighter — sun-catch on top
      const hi = yOff / (radius * 0.7); // ~ -0.28..0.72
      const green =
        hi > 0.3 ? FOLIAGE_HI : hi < -0.05 ? FOLIAGE_DK : FOLIAGE;
      const blob = new THREE.Mesh(
        new THREE.IcosahedronGeometry(r, 1),
        mkStd(green, { roughness: 0.98, flatShading: true }),
      );
      blob.position.set(Math.cos(a) * rr, y, Math.sin(a) * rr);
      blob.rotation.set(rand() * Math.PI, rand() * Math.PI, rand() * Math.PI);
      blob.scale.set(1, 0.92 + rand() * 0.2, 1);
      blob.castShadow = ctx.shadows;
      canopy.add(blob);
    }
    // a low skirt of small tufts around the trunk base grounds the bush to the lawn
    const tufts = 5;
    for (let i = 0; i < tufts; i++) {
      const a = (i / tufts) * Math.PI * 2 + rand() * 0.6;
      const tuft = new THREE.Mesh(
        new THREE.IcosahedronGeometry(radius * 0.28, 0),
        mkStd(FOLIAGE_DK, { roughness: 1.0, flatShading: true }),
      );
      tuft.position.set(Math.cos(a) * radius * 0.5, trunkH * 0.6, Math.sin(a) * radius * 0.5);
      tuft.castShadow = ctx.shadows;
      canopy.add(tuft);
    }
  }
  g.add(canopy);
  g.userData.canopy = canopy;
  g.userData.phase = rand() * Math.PI * 2;
  return g;
}

// ---------------------------------------------------------------------------
// UTILITY POLE — concrete pole + cross-arms + flat street-lamp head
// ---------------------------------------------------------------------------
function makeUtilityPole(ctx: Ctx, height: number, withLamp = true): THREE.Group {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.11, 0.14, height, 12),
    ctx.mats.pole as THREE.Material,
  );
  pole.position.y = height / 2;
  pole.castShadow = ctx.shadows;
  g.add(pole);

  // cross-arms near the top
  for (let i = 0; i < 2; i++) {
    const arm = new THREE.Mesh(
      new THREE.BoxGeometry(1.5, 0.09, 0.12),
      ctx.mats.poleDk as THREE.Material,
    );
    arm.position.set(0, height - 0.35 - i * 0.4, 0);
    arm.castShadow = ctx.shadows;
    g.add(arm);
    // little insulators
    for (const dx of [-0.55, 0, 0.55]) {
      const ins = new THREE.Mesh(
        new THREE.CylinderGeometry(0.04, 0.04, 0.1, 6),
        ctx.mats.frame as THREE.Material,
      );
      ins.position.set(dx, height - 0.35 - i * 0.4 + 0.09, 0);
      g.add(ins);
    }
  }

  if (withLamp) {
    const armY = height * 0.72;
    const lampArm = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.06, 0.7),
      ctx.mats.pole as THREE.Material,
    );
    lampArm.position.set(0, armY, 0.35);
    g.add(lampArm);
    const head = new THREE.Mesh(
      new THREE.BoxGeometry(0.28, 0.08, 0.5),
      ctx.mats.poleDk as THREE.Material,
    );
    head.position.set(0, armY - 0.03, 0.68);
    head.rotation.x = 0.12;
    g.add(head);
    const lens = new THREE.Mesh(
      new THREE.BoxGeometry(0.22, 0.03, 0.42),
      new THREE.MeshStandardMaterial({ color: 0xfff2c8, emissive: 0xffd77a, emissiveIntensity: 0.5, roughness: 0.4 }),
    );
    lens.position.set(0, armY - 0.08, 0.68);
    lens.rotation.x = 0.12;
    g.add(lens);
  }
  return g;
}

// ---------------------------------------------------------------------------
// WIRE — catenary tube between two world points
// ---------------------------------------------------------------------------
function makeWire(ctx: Ctx, a: THREE.Vector3, b: THREE.Vector3, sag: number): THREE.Mesh {
  // real overhead lines hang as a catenary — sample a drooped curve with many points
  // so the sag is smooth, then sweep a thin tube (thinner + smoother than before).
  const pts: THREE.Vector3[] = [];
  const N = 24;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const p = a.clone().lerp(b, t);
    p.y -= Math.sin(t * Math.PI) * sag; // parabolic droop, deepest at mid-span
    pts.push(p);
  }
  const curve = new THREE.CatmullRomCurve3(pts);
  const geo = new THREE.TubeGeometry(curve, 40, 0.009, 6, false);
  const m = new THREE.Mesh(geo, ctx.mats.wire as THREE.Material);
  m.castShadow = ctx.shadows;
  return m;
}

// ---------------------------------------------------------------------------
// main factory
// ---------------------------------------------------------------------------
export function createDoraemonHouseModel(options: DoraemonHouseOptions = {}): THREE.Group {
  const shadows = options.shadows ?? true;
  const root = new THREE.Group();
  root.name = 'DoraemonHouse';

  const ctx: Ctx = {
    shadows,
    roofTex: makeRoofTexture(),
    blockTex: makeBlockTexture(),
    windows: [],
    mats: {
      wall: mkStd(WALL_CREAM),
      wallTan: mkStd(WALL_TAN),
      wallShade: mkStd(WALL_SHADE),
      trim: mkStd(TRIM_CREAM, { roughness: 0.7 }),
      frame: mkStd(FRAME_WHITE, { roughness: 0.6 }),
      roofRed: mkStd(ROOF_RED, { roughness: 0.55 }),
      door: mkStd(DOOR_WOOD, { roughness: 0.7 }),
      doorPurple: mkStd(DOOR_PURPLE, { roughness: 0.6 }),
      pole: mkStd(POLE_GRAY, { roughness: 0.7 }),
      poleDk: mkStd(POLE_GRAY_DK, { roughness: 0.7 }),
      trunk: mkStd(TRUNK, { roughness: 0.95 }),
      wire: mkStd(WIRE, { roughness: 0.6 }),
    },
  };

  // ---------- base tile ----------
  const LOT_W = 13;
  const LOT_D = 10;
  const baseTop = new THREE.Mesh(
    new THREE.BoxGeometry(LOT_W, 0.4, LOT_D),
    mkStd(ROAD_DARK, { roughness: 0.9 }),
  );
  baseTop.position.y = -0.2;
  baseTop.receiveShadow = shadows;
  baseTop.castShadow = shadows;
  // side color for the tile
  (baseTop.material as THREE.MeshStandardMaterial).color.set(BASE_SIDE);
  root.add(baseTop);

  // road top surface (asphalt) with tan curb border + yellow centre line along near/right edges
  const road = new THREE.Mesh(
    new THREE.PlaneGeometry(LOT_W, LOT_D),
    mkStd(ROAD_DARK, { roughness: 0.95 }),
  );
  road.rotation.x = -Math.PI / 2;
  road.position.y = 0.001;
  road.receiveShadow = shadows;
  root.add(road);

  // inner property ground (grass) raised slightly, inset from the roads
  const yardW = 9.4;
  const yardD = 6.6;
  const yard = new THREE.Mesh(
    new THREE.BoxGeometry(yardW, 0.12, yardD),
    mkStd(GRASS, { roughness: 1.0 }),
  );
  yard.position.set(-0.6, 0.06, -0.2);
  yard.receiveShadow = shadows;
  root.add(yard);

  // tan curb ring around the yard
  const curb = new THREE.Mesh(
    new THREE.BoxGeometry(yardW + 0.5, 0.1, yardD + 0.5),
    mkStd(CURB_TAN, { roughness: 0.9 }),
  );
  curb.position.set(-0.6, 0.05, -0.2);
  root.add(curb);
  yard.position.y = 0.11;

  // yellow road centre lines (two near edges)
  const lineMat = mkStd(ROAD_LINE, { roughness: 0.8, emissive: 0x2a2405, emissiveIntensity: 0.15 });
  const lineFront = new THREE.Mesh(new THREE.PlaneGeometry(LOT_W - 1, 0.12), lineMat);
  lineFront.rotation.x = -Math.PI / 2;
  lineFront.position.set(0, 0.01, LOT_D / 2 - 0.55);
  root.add(lineFront);
  const lineRight = new THREE.Mesh(new THREE.PlaneGeometry(0.12, LOT_D - 1), lineMat);
  lineRight.rotation.x = -Math.PI / 2;
  lineRight.position.set(LOT_W / 2 - 0.55, 0.01, 0);
  root.add(lineRight);

  // ---------- perimeter cinder-block wall (instanced blocks) ----------
  const wallGroup = new THREE.Group();
  const blockGeo = new THREE.BoxGeometry(0.62, 0.62, 0.28);
  const blockMat = new THREE.MeshStandardMaterial({
    map: ctx.blockTex,
    color: 0xffffff,
    roughness: 0.9,
  });
  const capMat = mkStd(BLOCK_CAP, { roughness: 0.8 });
  const halfW = yardW / 2 + 0.25;
  const halfD = yardD / 2 + 0.25;
  const cx = -0.6;
  const cz = -0.2;
  const wallH = 2; // block rows (kept low so the yard + trees read as in the reference)
  // gate gaps (skip blocks): front-left gate + right gate
  function runWall(x0: number, z0: number, x1: number, z1: number, gapStart: number, gapLen: number) {
    const dx = x1 - x0;
    const dz = z1 - z0;
    const len = Math.hypot(dx, dz);
    const n = Math.round(len / 0.62);
    const ux = dx / n;
    const uz = dz / n;
    const angle = Math.atan2(dz, dx);
    const totalBlocks = n * wallH;
    const inst = new THREE.InstancedMesh(blockGeo, blockMat, totalBlocks);
    const capInst = new THREE.InstancedMesh(blockGeo, capMat, n);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -angle, 0));
    let k = 0;
    let ck = 0;
    for (let i = 0; i < n; i++) {
      const t = i / n;
      if (t >= gapStart && t < gapStart + gapLen) continue; // gate gap
      const px = x0 + ux * (i + 0.5);
      const pz = z0 + uz * (i + 0.5);
      for (let r = 0; r < wallH; r++) {
        m.compose(new THREE.Vector3(px, 0.18 + r * 0.6, pz), q, new THREE.Vector3(1, 1, 1));
        inst.setMatrixAt(k++, m);
      }
      m.compose(new THREE.Vector3(px, 0.18 + wallH * 0.6, pz), q, new THREE.Vector3(1.05, 0.28, 1.15));
      capInst.setMatrixAt(ck++, m);
    }
    inst.count = k;
    capInst.count = ck;
    inst.castShadow = shadows;
    inst.receiveShadow = shadows;
    capInst.castShadow = shadows;
    wallGroup.add(inst);
    wallGroup.add(capInst);
  }
  // four sides (with gaps for gates on front + right)
  runWall(cx - halfW, cz + halfD, cx + halfW, cz + halfD, 0.62, 0.16); // front (+Z) — gate near right
  runWall(cx + halfW, cz + halfD, cx + halfW, cz - halfD, 0.05, 0.16); // right (+X) — gate near front
  runWall(cx + halfW, cz - halfD, cx - halfW, cz - halfD, -1, 0); // back (-Z)
  runWall(cx - halfW, cz - halfD, cx - halfW, cz + halfD, -1, 0); // left (-X)
  root.add(wallGroup);

  // wooden slat gates (two)
  function makeGate(): THREE.Group {
    const gg = new THREE.Group();
    const wood = mkStd(0xd8b57a, { roughness: 0.8 });
    for (let i = 0; i < 5; i++) {
      const slat = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.1, 0.05), wood);
      slat.position.set(-0.35 + i * 0.18, 0.55, 0);
      slat.castShadow = shadows;
      gg.add(slat);
    }
    for (const yy of [0.35, 0.85]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.09, 0.06), wood);
      rail.position.set(0, yy, 0.01);
      gg.add(rail);
    }
    return gg;
  }
  const gateFront = makeGate();
  gateFront.position.set(cx + halfW - 1.0, 0.05, cz + halfD);
  root.add(gateFront);
  const gateRight = makeGate();
  gateRight.rotation.y = Math.PI / 2;
  gateRight.position.set(cx + halfW, 0.05, cz + halfD - 1.0);
  root.add(gateRight);

  // ---------- house ----------
  const { group: house, topRidgeY, doraSlope } = makeHouse(ctx);
  house.position.set(0.2, 0.17, -0.2);
  root.add(house);

  // ---------- characters ----------
  // Nobita + Doraemon removed per art direction — the code-built likenesses didn't
  // read true enough, so the roofscape is left clean (makeNobita/makeDoraemon kept
  // for reference/future use, and topRidgeY/doraSlope stay available as sockets).
  void topRidgeY;
  void makeNobita;
  void makeDoraemon;

  // ---------- trees + bushes (front-left cluster + a tall conical, as in the reference) ----------
  // All kept clear of the house footprint (front block spans x -3.98..0.58) so no roof skewers them.
  const trees = new THREE.Group();
  const bigTree = makeTree(ctx, 0x111, 1.1, false);
  bigTree.position.set(-4.4, 0.17, 1.5);
  trees.add(bigTree);
  const coneTree = makeTree(ctx, 0x333, 0.95, true);
  coneTree.position.set(-4.5, 0.17, 2.9);
  trees.add(coneTree);
  const midTree = makeTree(ctx, 0x222, 0.7, false);
  midTree.position.set(-4.6, 0.17, 0.2);
  trees.add(midTree);
  const smallBush = makeTree(ctx, 0x266, 0.5, false);
  smallBush.position.set(-3.7, 0.17, 3.0);
  trees.add(smallBush);
  // small bushes near the right/back wall
  const rTree1 = makeTree(ctx, 0x444, 0.55, false);
  rTree1.position.set(3.9, 0.17, -2.8);
  trees.add(rTree1);
  const rTree2 = makeTree(ctx, 0x555, 0.5, false);
  rTree2.position.set(2.4, 0.17, -3.0);
  trees.add(rTree2);
  root.add(trees);

  // ---------- utility poles ----------
  const poleTall = makeUtilityPole(ctx, 5.4, false);
  poleTall.position.set(5.6, 0.0, -1.2);
  root.add(poleTall);
  const poleFront = makeUtilityPole(ctx, 4.4, true);
  poleFront.position.set(1.4, 0.0, 3.4);
  root.add(poleFront);
  const poleStreet = makeUtilityPole(ctx, 3.6, true);
  poleStreet.position.set(-3.9, 0.0, 3.9);
  root.add(poleStreet);

  // ---------- overhead wires (from tall pole to house + other poles) ----------
  const wires = new THREE.Group();
  const tallTop = new THREE.Vector3(5.6, 5.1, -1.2);
  const targets = [
    new THREE.Vector3(1.4, 4.1, 3.4),
    new THREE.Vector3(0.0, 4.6, -1.5),
    new THREE.Vector3(-0.5, 3.0, 1.7),
    new THREE.Vector3(2.9, 2.6, 1.9),
  ];
  for (const t of targets) {
    wires.add(makeWire(ctx, tallTop, t, 0.5 + t.distanceTo(tallTop) * 0.06));
  }
  // a couple between front pole and house
  wires.add(makeWire(ctx, new THREE.Vector3(1.4, 4.0, 3.4), new THREE.Vector3(-0.6, 3.2, 1.7), 0.4));
  root.add(wires);

  // ---------- trash can + bag on road ----------
  const can = new THREE.Mesh(
    new THREE.CylinderGeometry(0.22, 0.19, 0.55, 14),
    mkStd(0xc7ccd2, { roughness: 0.5, metalness: 0.3 }),
  );
  can.position.set(0.7, 0.28, 4.3);
  can.castShadow = shadows;
  root.add(can);
  const canLid = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.06, 14), mkStd(0x9aa0a6, { metalness: 0.3, roughness: 0.5 }));
  canLid.position.set(0.7, 0.57, 4.3);
  root.add(canLid);
  const bag = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 10), mkStd(0x2b2b30, { roughness: 0.7 }));
  bag.scale.set(1, 0.8, 1);
  bag.position.set(1.15, 0.2, 4.4);
  bag.castShadow = shadows;
  root.add(bag);

  // ---------- runtime (action-ready) ----------
  const twinkleWindows = ctx.windows;
  root.userData.sculptRuntime = {
    nodes: { house, trees, wires, poleTall, poleFront },
    materials: ctx.mats,
    sockets: { doraSlope },
  };

  const treeList = [bigTree, midTree, coneTree, rTree1, rTree2];
  root.userData.tick = (_dt: number, elapsed: number) => {
    // sway canopies
    for (const tr of treeList) {
      const canopy = tr.userData.canopy as THREE.Group;
      const ph = tr.userData.phase as number;
      if (canopy) {
        canopy.rotation.z = Math.sin(elapsed * 0.8 + ph) * 0.03;
        canopy.rotation.x = Math.cos(elapsed * 0.6 + ph) * 0.02;
      }
    }
    // dusk windows twinkle
    for (let i = 0; i < twinkleWindows.length; i++) {
      const w = twinkleWindows[i];
      w.emissiveIntensity = 0.7 + Math.sin(elapsed * 1.5 + i * 1.3) * 0.25;
    }
  };

  const s = options.scale ?? 1;
  root.scale.setScalar(s);
  return root;
}

// ---------------------------------------------------------------------------
// look-dev lighting — warm key from upper-left, cool sky fill, matching the reference
// ---------------------------------------------------------------------------
export function createDoraemonHouseLookDevLights(): THREE.Group {
  const g = new THREE.Group();

  // key dialled down (2.15 -> 1.65) + steeper angle so cast shadows read stronger
  const key = new THREE.DirectionalLight(0xfff2d6, 1.65);
  key.position.set(-6.5, 8, 4);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 40;
  const cam = key.shadow.camera as THREE.OrthographicCamera;
  cam.left = -12;
  cam.right = 12;
  cam.top = 12;
  cam.bottom = -12;
  cam.updateProjectionMatrix();
  key.shadow.bias = -0.0004;
  key.shadow.radius = 3; // soft contact shadows
  g.add(key);

  // fill/ambient trimmed so shadow cores stay dark (more depth, less blown-out brightness)
  const fill = new THREE.DirectionalLight(0x9fccf0, 0.34);
  fill.position.set(6, 4, 6);
  g.add(fill);

  const hemi = new THREE.HemisphereLight(0xbfe6ff, 0x415a34, 0.3);
  g.add(hemi);

  const amb = new THREE.AmbientLight(0xffffff, 0.05);
  g.add(amb);

  return g;
}
