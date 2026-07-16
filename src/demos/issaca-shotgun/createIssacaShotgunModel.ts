import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

/**
 * ISSACA 12 GAUGE SHOTGUN — "Bolton Dynamics", rebuilt in code from a sheet of studio
 * reference renders (img2threejs).
 *
 * Faithful to the reference identity systems:
 *  - Bullpup pistol-shotgun silhouette: rear BLACK POLYMER pistol grip + oval trigger guard,
 *    long SLATE-GRAY painted receiver, AMBER MARBLED BAKELITE handguard, SATIN STEEL barrel.
 *  - Amber handguard with a row of 4 elongated vent slots + a mottled marble clearcoat.
 *  - Fluted satin barrel ending in a slotted hex muzzle brake; knurled gas knob + angled
 *    front hand-stop under the barrel base.
 *  - Top open reflex RED-DOT sight: tinted blue lens, glowing red aiming dot, hooded housing,
 *    two slotted screws + a knurled windage knob, clamped to a short pic rail.
 *  - Painted stencils: "ISSACA / 12 GAUGE SHOTGUN", the hatched "BOLTON DYNAMICS" triangle,
 *    a monochrome US flag, plus takedown pins and a selector button; light edge wear.
 *  - A loose red "EXECUTIVE RIFLED SLUG" 12ga shell (ribbed red hull + brass head) is the
 *    ejecting casing.
 *
 * FIRING VFX driven by root.userData.tick(dt, elapsed):
 *  - additive muzzle flash (star sprite + stubby cone + burst point light) at the muzzle socket
 *  - full-gun RECOIL: a fast rearward kick + muzzle rise about a grip pivot, spring-eased back
 *  - a brass SHELL EJECTS from the port: launches up/out with tumble + gravity, then fades
 *  - charge handle / bolt snaps back and returns; the red dot reticle flares on each shot
 *
 * Action-ready: exposes root.userData.sculptRuntime with named nodes, sockets, materials and
 * a fire() trigger; root.userData.tick auto-fires on a loop for the live demo.
 */

export interface IssacaShotgunOptions {
  /** overall scale multiplier (default 1) */
  scale?: number;
  /** enable cast/receive shadows (default true) */
  shadows?: boolean;
  /** seconds between auto-fire shots in the live demo (default 2.4; set 0 to disable auto-fire) */
  autoFireInterval?: number;
}

// ---------------------------------------------------------------------------
// palette (sampled from the reference)
// ---------------------------------------------------------------------------
const SLATE = 0x5c646d;
const SLATE_DARK = 0x40464e;
const SLATE_LIGHT = 0x7b828b;
const AMBER = 0xd98a2c;
const AMBER_LIGHT = 0xf0b45a;
const AMBER_DARK = 0xa5601a;
const STEEL = 0xc6cad0;
const STEEL_DARK = 0x8a8f97;
const POLY_BLACK = 0x232629;
const DARK_METAL = 0x2b2e33;
const BRASS = 0xc7a24a;
const SHELL_RED = 0xd0332a;
const RED_DOT = 0xff2418;
const FLASH_CORE = 0xfff2c4;
const FLASH_EDGE = 0xffa32a;
const GLASS_TINT = 0x8fb6c9;

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

/** Amber bakelite: warm base with lighter/darker marble swirls + fine streaks. */
function makeMarbleTexture(): THREE.CanvasTexture {
  const S = 512;
  const { cv, ctx } = newCanvas(S, S);
  const rand = mulberry32(0xba7e11);
  ctx.fillStyle = hex(AMBER);
  ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 120; i++) {
    const x = rand() * S;
    const y = rand() * S;
    const r = 20 + rand() * 90;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const col = rand() > 0.5 ? AMBER_LIGHT : AMBER_DARK;
    g.addColorStop(0, hex(col));
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = 0.22 + rand() * 0.4;
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // fine horizontal grain streaks
  ctx.globalAlpha = 0.12;
  for (let i = 0; i < 80; i++) {
    ctx.strokeStyle = rand() > 0.5 ? hex(AMBER_LIGHT) : hex(AMBER_DARK);
    ctx.lineWidth = 0.6 + rand() * 1.4;
    ctx.beginPath();
    const y = rand() * S;
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(S * 0.3, y + (rand() - 0.5) * 30, S * 0.7, y + (rand() - 0.5) * 30, S, y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** Subtle painted-metal scratch/wear bump for the slate receiver. */
function makeScratchBump(): THREE.CanvasTexture {
  const S = 512;
  const { cv, ctx } = newCanvas(S, S);
  const rand = mulberry32(0x5ca7c3);
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, S, S);
  // speckle
  for (let i = 0; i < 4000; i++) {
    const v = 128 + (rand() - 0.5) * 26;
    ctx.fillStyle = `rgb(${v | 0},${v | 0},${v | 0})`;
    ctx.fillRect(rand() * S, rand() * S, 1, 1);
  }
  // scratches
  for (let i = 0; i < 60; i++) {
    ctx.strokeStyle = rand() > 0.5 ? '#c8c8c8' : '#5a5a5a';
    ctx.lineWidth = 0.5 + rand() * 1.2;
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    const x = rand() * S;
    const y = rand() * S;
    const a = rand() * Math.PI;
    const len = 10 + rand() * 90;
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** Radial knurl bump for the knobs (concentric diamond cross-hatch). */
function makeKnurlBump(): THREE.CanvasTexture {
  const S = 128;
  const { cv, ctx } = newCanvas(S, S);
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, S, S);
  ctx.strokeStyle = '#d8d8d8';
  ctx.lineWidth = 1.2;
  for (let i = -S; i < S; i += 6) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + S, S);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(i + S, 0);
    ctx.lineTo(i, S);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(6, 2);
  return tex;
}

/** A transparent decal canvas: light-gray stencil markings on the receiver flank. */
function makeMarkingsDecal(mirror: boolean): THREE.CanvasTexture {
  const W = 512;
  const H = 256;
  const { cv, ctx } = newCanvas(W, H);
  ctx.clearRect(0, 0, W, H);
  if (mirror) {
    ctx.translate(W, 0);
    ctx.scale(-1, 1);
  }
  ctx.fillStyle = 'rgba(214,219,224,0.92)';
  ctx.textBaseline = 'top';
  // ISSACA wordmark (letter-spaced)
  ctx.font = '600 34px Georgia, "Times New Roman", serif';
  const iss = 'I S S A C A';
  ctx.fillText(iss, 250, 96);
  ctx.font = '600 15px Arial, sans-serif';
  ctx.fillStyle = 'rgba(200,206,212,0.85)';
  ctx.fillText('12 GAUGE SHOTGUN', 252, 138);
  // hatched triangle "BOLTON DYNAMICS" logo (left third)
  ctx.save();
  ctx.strokeStyle = 'rgba(210,215,220,0.9)';
  ctx.lineWidth = 2.2;
  const tx = 70;
  const ty = 70;
  ctx.beginPath();
  ctx.moveTo(tx, ty + 70);
  ctx.lineTo(tx + 34, ty);
  ctx.lineTo(tx + 68, ty + 70);
  ctx.closePath();
  ctx.stroke();
  // interior hatch lines
  ctx.lineWidth = 1.4;
  for (let i = 1; i <= 6; i++) {
    const yy = ty + (70 * i) / 7;
    const half = (34 * (70 - (70 * i) / 7)) / 70;
    ctx.beginPath();
    ctx.moveTo(tx + 34 - half, yy);
    ctx.lineTo(tx + 34 + half, yy);
    ctx.stroke();
  }
  ctx.restore();
  ctx.fillStyle = 'rgba(200,206,212,0.8)';
  ctx.font = '600 12px Arial, sans-serif';
  ctx.fillText('BOLTON DYNAMICS', 42, 150);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** A small monochrome US-flag decal (etched/painted look). */
function makeFlagDecal(): THREE.CanvasTexture {
  const W = 128;
  const H = 80;
  const { cv, ctx } = newCanvas(W, H);
  ctx.clearRect(0, 0, W, H);
  // stripes
  const stripe = H / 7;
  for (let i = 0; i < 7; i++) {
    ctx.fillStyle = i % 2 === 0 ? 'rgba(210,214,219,0.9)' : 'rgba(120,126,132,0.85)';
    ctx.fillRect(0, i * stripe, W, stripe);
  }
  // canton
  ctx.fillStyle = 'rgba(70,76,84,0.92)';
  ctx.fillRect(0, 0, W * 0.42, stripe * 4);
  // stars (dots)
  ctx.fillStyle = 'rgba(220,224,228,0.95)';
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 5; c++) {
      ctx.beginPath();
      ctx.arc(6 + c * 10, 6 + r * 8, 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Ribbed red hull texture for the 12ga shell. */
function makeShellHullTexture(): THREE.CanvasTexture {
  const W = 256;
  const H = 128;
  const { cv, ctx } = newCanvas(W, H);
  ctx.fillStyle = hex(SHELL_RED);
  ctx.fillRect(0, 0, W, H);
  // vertical ribs (around circumference)
  for (let x = 0; x < W; x += 4) {
    ctx.fillStyle = 'rgba(0,0,0,0.10)';
    ctx.fillRect(x, 0, 1.4, H);
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(x + 2, 0, 1, H);
  }
  // printing
  ctx.fillStyle = '#20120f';
  ctx.font = '700 15px Arial, sans-serif';
  ctx.fillText('EXECUTIVE', 78, 40);
  ctx.font = '800 20px Arial, sans-serif';
  ctx.fillText('RIFLED SLUG', 66, 60);
  ctx.font = '600 10px Arial, sans-serif';
  ctx.fillText('2¾"      70MM', 92, 86);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}

/** Radial flash star sprite (additive). */
function makeFlashSprite(): THREE.CanvasTexture {
  const S = 256;
  const { cv, ctx } = newCanvas(S, S);
  const cx = S / 2;
  const cy = S / 2;
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, S / 2);
  g.addColorStop(0, 'rgba(255,248,224,1)');
  g.addColorStop(0.18, 'rgba(255,214,120,0.95)');
  g.addColorStop(0.45, 'rgba(255,150,50,0.5)');
  g.addColorStop(1, 'rgba(255,120,30,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  // spikes
  ctx.strokeStyle = 'rgba(255,235,180,0.9)';
  ctx.lineWidth = 6;
  ctx.lineCap = 'round';
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.2;
    const len = i % 2 === 0 ? S * 0.46 : S * 0.30;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(a) * len, cy + Math.sin(a) * len);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Soft round smoke puff sprite. */
function makeSmokeSprite(): THREE.CanvasTexture {
  const S = 128;
  const { cv, ctx } = newCanvas(S, S);
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(180,180,185,0.55)');
  g.addColorStop(0.5, 'rgba(150,150,156,0.28)');
  g.addColorStop(1, 'rgba(120,120,126,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  return new THREE.CanvasTexture(cv);
}

// ---------------------------------------------------------------------------
// small geometry helpers
// ---------------------------------------------------------------------------
function xCyl(
  rTop: number,
  rBot: number,
  len: number,
  seg: number,
  mat: THREE.Material,
): THREE.Mesh {
  const g = new THREE.CylinderGeometry(rTop, rBot, len, seg);
  g.rotateZ(Math.PI / 2); // axis -> X
  return new THREE.Mesh(g, mat);
}

// ===========================================================================
// MAIN FACTORY
// ===========================================================================
export function createIssacaShotgunModel(options: IssacaShotgunOptions = {}): THREE.Group {
  const scale = options.scale ?? 1;
  const shadows = options.shadows ?? true;
  const autoFireInterval = options.autoFireInterval ?? 2.4;

  const root = new THREE.Group();
  root.name = 'IssacaShotgun';

  // ---- materials -----------------------------------------------------------
  const scratch = makeScratchBump();
  scratch.repeat.set(3, 1);
  const slateMat = new THREE.MeshStandardMaterial({
    color: SLATE,
    roughness: 0.62,
    metalness: 0.55,
    bumpMap: scratch,
    bumpScale: 0.006,
  });
  const slateDarkMat = new THREE.MeshStandardMaterial({ color: SLATE_DARK, roughness: 0.55, metalness: 0.6 });
  const slateLightMat = new THREE.MeshStandardMaterial({ color: SLATE_LIGHT, roughness: 0.5, metalness: 0.62 });

  const marble = makeMarbleTexture();
  const bakeliteMat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    map: marble,
    roughness: 0.32,
    metalness: 0.0,
    clearcoat: 0.7,
    clearcoatRoughness: 0.28,
    sheen: 0.2,
  });

  const knurl = makeKnurlBump();
  const steelMat = new THREE.MeshStandardMaterial({ color: STEEL, roughness: 0.3, metalness: 0.92 });
  const steelDarkMat = new THREE.MeshStandardMaterial({ color: STEEL_DARK, roughness: 0.38, metalness: 0.9 });
  const darkMetalMat = new THREE.MeshStandardMaterial({ color: DARK_METAL, roughness: 0.42, metalness: 0.75 });
  const knobMat = new THREE.MeshStandardMaterial({
    color: 0x1e2024,
    roughness: 0.55,
    metalness: 0.6,
    bumpMap: knurl,
    bumpScale: 0.01,
  });

  const polyMatSheen = new THREE.MeshPhysicalMaterial({
    color: POLY_BLACK,
    roughness: 0.42,
    metalness: 0.05,
    sheen: 0.5,
    sheenColor: new THREE.Color(0x556070),
  });

  const brassMat = new THREE.MeshStandardMaterial({ color: BRASS, roughness: 0.3, metalness: 0.95 });
  const shellHull = makeShellHullTexture();
  const shellMat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: shellHull, roughness: 0.5, metalness: 0.05 });

  const glassMat = new THREE.MeshPhysicalMaterial({
    color: GLASS_TINT,
    roughness: 0.05,
    metalness: 0,
    transmission: 0.9,
    transparent: true,
    opacity: 0.55,
    ior: 1.45,
    thickness: 0.05,
  });
  const dotMat = new THREE.MeshStandardMaterial({
    color: RED_DOT,
    emissive: new THREE.Color(RED_DOT),
    emissiveIntensity: 4,
    roughness: 0.4,
  });

  // ---- pivot structure for recoil -----------------------------------------
  // recoilPivot sits at the grip; gunGroup is offset back so world coords stay natural.
  const pivot = new THREE.Vector3(1.15, -0.15, 0);
  const recoilPivot = new THREE.Group();
  recoilPivot.name = 'recoilPivot';
  recoilPivot.position.copy(pivot);
  const gun = new THREE.Group();
  gun.name = 'gunBody';
  gun.position.set(-pivot.x, -pivot.y, -pivot.z);
  recoilPivot.add(gun);
  root.add(recoilPivot);

  const add = (mesh: THREE.Object3D, parent: THREE.Object3D = gun): THREE.Object3D => {
    if (shadows) {
      mesh.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.castShadow = true;
          m.receiveShadow = true;
        }
      });
    }
    parent.add(mesh);
    return mesh;
  };

  // =========================================================================
  // RECEIVER (slate-gray painted body)
  // =========================================================================
  const receiver = new THREE.Group();
  receiver.name = 'receiver';
  add(receiver);

  // main block
  const body = new THREE.Mesh(new RoundedBoxGeometry(1.5, 0.36, 0.19, 4, 0.03), slateMat);
  body.position.set(0.28, 0.06, 0);
  add(body, receiver);

  // top rail deck (raised, over the rear / above the ejection area)
  const topDeck = new THREE.Mesh(new RoundedBoxGeometry(0.95, 0.06, 0.15, 3, 0.015), slateDarkMat);
  topDeck.position.set(0.55, 0.27, 0);
  add(topDeck, receiver);
  // pic-rail ridges on the deck
  for (let i = 0; i < 9; i++) {
    const r = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.02, 0.14), slateLightMat);
    r.position.set(0.28 + i * 0.06, 0.31, 0);
    add(r, receiver);
  }

  // rear upper wedge going toward the grip (angular sci-fi tail)
  const tailShape = new THREE.Shape();
  tailShape.moveTo(0, -0.18);
  tailShape.lineTo(0.42, -0.18);
  tailShape.lineTo(0.42, 0.06);
  tailShape.lineTo(0.16, 0.2);
  tailShape.lineTo(0, 0.18);
  tailShape.closePath();
  const tail = new THREE.Mesh(
    new THREE.ExtrudeGeometry(tailShape, { depth: 0.185, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 2 }),
    slateMat,
  );
  tail.position.set(0.86, 0.06, -0.0925);
  add(tail, receiver);

  // ejection port recess (top-right) — SHELL SPAWN SOCKET on +Z flank
  const portRecess = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.1, 0.03), darkMetalMat);
  portRecess.position.set(0.62, 0.16, 0.098);
  add(portRecess, receiver);
  const portLip = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.14, 0.02), slateLightMat);
  portLip.position.set(0.62, 0.16, 0.088);
  add(portLip, receiver);
  // punch the visible opening
  const portHole = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.08, 0.02), new THREE.MeshStandardMaterial({ color: 0x0a0b0d, roughness: 0.9 }));
  portHole.position.set(0.62, 0.16, 0.1);
  add(portHole, receiver);

  // charge handle / bolt (steel) protruding at the port — animates on fire
  const boltGroup = new THREE.Group();
  boltGroup.name = 'bolt';
  boltGroup.position.set(0.7, 0.16, 0.108);
  const boltHandle = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.06, 12), steelMat);
  boltHandle.rotation.x = Math.PI / 2;
  add(boltHandle, boltGroup);
  const boltTip = new THREE.Mesh(new THREE.SphereGeometry(0.026, 12, 10), steelMat);
  boltTip.position.z = 0.03;
  add(boltTip, boltGroup);
  add(boltGroup, receiver);

  // internal exposed bolt spring (visible steel behind the handguard on top)
  const spring = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.2, 10, 1, true), steelDarkMat);
  spring.geometry.rotateZ(Math.PI / 2);
  spring.position.set(0.0, 0.2, 0);
  add(spring, receiver);
  const boltShaft = xCyl(0.026, 0.026, 0.34, 14, steelMat);
  boltShaft.position.set(-0.05, 0.2, 0);
  add(boltShaft, receiver);

  // flank decals (right +Z and mirrored left -Z)
  const markR = new THREE.Mesh(
    new THREE.PlaneGeometry(0.9, 0.45),
    new THREE.MeshStandardMaterial({ map: makeMarkingsDecal(false), transparent: true, roughness: 0.7, metalness: 0.2, polygonOffset: true, polygonOffsetFactor: -2 }),
  );
  markR.position.set(0.34, 0.03, 0.096);
  add(markR, receiver);
  const markL = new THREE.Mesh(
    new THREE.PlaneGeometry(0.9, 0.45),
    new THREE.MeshStandardMaterial({ map: makeMarkingsDecal(true), transparent: true, roughness: 0.7, metalness: 0.2, polygonOffset: true, polygonOffsetFactor: -2 }),
  );
  markL.position.set(0.34, 0.03, -0.096);
  markL.rotation.y = Math.PI;
  add(markL, receiver);

  // US flag decal (near grip, right flank)
  const flag = new THREE.Mesh(
    new THREE.PlaneGeometry(0.13, 0.08),
    new THREE.MeshStandardMaterial({ map: makeFlagDecal(), transparent: true, roughness: 0.75, metalness: 0.1, polygonOffset: true, polygonOffsetFactor: -2 }),
  );
  flag.position.set(0.86, 0.12, 0.097);
  add(flag, receiver);

  // takedown pins + selector button
  for (const px of [0.55, 0.78]) {
    const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.02, 16), slateLightMat);
    pin.rotation.x = Math.PI / 2;
    pin.position.set(px, -0.04, 0.097);
    add(pin, receiver);
  }
  const selector = new THREE.Mesh(new RoundedBoxGeometry(0.09, 0.035, 0.02, 2, 0.008), slateDarkMat);
  selector.position.set(0.78, 0.05, 0.097);
  add(selector, receiver);

  // =========================================================================
  // HANDGUARD (amber marbled bakelite) with 4 vent slots
  // =========================================================================
  const handguard = new THREE.Group();
  handguard.name = 'handguard';
  add(handguard);
  const hgBody = new THREE.Mesh(new RoundedBoxGeometry(1.02, 0.26, 0.2, 5, 0.055), bakeliteMat);
  hgBody.position.set(-0.62, 0.09, 0);
  add(hgBody, handguard);
  // vent slots (repetition system) — dark recessed rounded slots on both flanks
  const ventMat = new THREE.MeshStandardMaterial({ color: 0x1c1305, roughness: 0.7, metalness: 0.1 });
  for (let i = 0; i < 4; i++) {
    const vx = -0.95 + i * 0.2;
    for (const z of [0.101, -0.101]) {
      const slot = new THREE.Mesh(new RoundedBoxGeometry(0.12, 0.05, 0.02, 2, 0.02), ventMat);
      slot.position.set(vx, 0.06, z);
      add(slot, handguard);
    }
  }

  // =========================================================================
  // BARREL group (steel) + muzzle brake + gas knob + front hand-stop
  // =========================================================================
  const barrelGroup = new THREE.Group();
  barrelGroup.name = 'barrel';
  add(barrelGroup);

  // exposed fluted barrel between handguard and brake
  const barrel = xCyl(0.052, 0.052, 0.34, 20, steelMat);
  barrel.position.set(-1.28, 0.12, 0);
  add(barrel, barrelGroup);
  // top flute (dark inset groove)
  const flute = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.02, 0.03), steelDarkMat);
  flute.position.set(-1.28, 0.168, 0);
  add(flute, barrelGroup);

  // muzzle brake (satin, slotted, hex end)
  const brake = xCyl(0.07, 0.07, 0.26, 24, steelMat);
  brake.position.set(-1.56, 0.12, 0);
  add(brake, barrelGroup);
  const brakeSlotMat = new THREE.MeshStandardMaterial({ color: 0x53575d, roughness: 0.5, metalness: 0.85 });
  for (let i = 0; i < 3; i++) {
    const s = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.03, 0.11), brakeSlotMat);
    s.position.set(-1.62 + i * 0.06, 0.185, 0);
    add(s, barrelGroup);
  }
  // hex end cap + bore
  const hexCap = new THREE.Mesh(new THREE.CylinderGeometry(0.078, 0.078, 0.05, 8), steelDarkMat);
  hexCap.rotation.z = Math.PI / 2;
  hexCap.position.set(-1.7, 0.12, 0);
  add(hexCap, barrelGroup);
  const bore = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.02, 16), new THREE.MeshStandardMaterial({ color: 0x08090b, roughness: 0.95 }));
  bore.rotation.z = Math.PI / 2;
  bore.position.set(-1.725, 0.12, 0);
  add(bore, barrelGroup);

  // knurled gas knob at barrel base
  const gasKnob = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.05, 24), knobMat);
  gasKnob.position.set(-1.12, 0.02, 0.0);
  add(gasKnob, barrelGroup);
  const gasStem = xCyl(0.03, 0.03, 0.08, 12, steelDarkMat);
  gasStem.position.set(-1.12, 0.075, 0);
  add(gasStem, barrelGroup);

  // angled front hand-stop (gray polymer wedge hanging below)
  const hsShape = new THREE.Shape();
  hsShape.moveTo(0, 0);
  hsShape.lineTo(0.16, 0);
  hsShape.lineTo(0.1, -0.16);
  hsShape.lineTo(0.02, -0.16);
  hsShape.closePath();
  const handstop = new THREE.Mesh(
    new THREE.ExtrudeGeometry(hsShape, { depth: 0.12, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.012, bevelSegments: 2 }),
    slateDarkMat,
  );
  handstop.position.set(-1.02, -0.03, -0.06);
  add(handstop, barrelGroup);

  // magazine tube under the barrel/handguard
  const magTube = xCyl(0.05, 0.05, 0.95, 18, steelDarkMat);
  magTube.position.set(-0.7, -0.04, 0);
  add(magTube, barrelGroup);
  const magCap = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.05, 0.05, 18), darkMetalMat);
  magCap.rotation.z = Math.PI / 2;
  magCap.position.set(-1.19, -0.04, 0);
  add(magCap, barrelGroup);

  // =========================================================================
  // RED DOT SIGHT (top, open reflex)
  // =========================================================================
  // short mount rail on the receiver top under the optic (so the optic sits on something)
  const opticRail = new THREE.Mesh(new RoundedBoxGeometry(0.26, 0.05, 0.15, 2, 0.012), slateDarkMat);
  opticRail.position.set(-0.24, 0.26, 0);
  add(opticRail, receiver);
  for (let i = 0; i < 4; i++) {
    const t = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.14), slateLightMat);
    t.position.set(-0.32 + i * 0.055, 0.29, 0);
    add(t, receiver);
  }

  const redDot = new THREE.Group();
  redDot.name = 'redDot';
  redDot.position.set(-0.24, 0.4, 0);
  add(redDot);
  // clamp base — reaches DOWN onto the optic rail (no floating gap)
  const clamp = new THREE.Mesh(new RoundedBoxGeometry(0.17, 0.14, 0.15, 2, 0.012), slateDarkMat);
  clamp.position.set(0, -0.12, 0);
  add(clamp, redDot);
  // thumb-nut clamp lever on the side of the base
  const clampNut = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.04, 16), knobMat);
  clampNut.rotation.x = Math.PI / 2;
  clampNut.position.set(0.05, -0.12, 0.095);
  add(clampNut, redDot);
  // knurled windage knob (side)
  const wind = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.05, 20), knobMat);
  wind.rotation.x = Math.PI / 2;
  wind.position.set(-0.02, -0.05, 0.09);
  add(wind, redDot);
  // hood / housing: rear post + front post + top bridge (open sight)
  const rearPost = new THREE.Mesh(new RoundedBoxGeometry(0.05, 0.2, 0.16, 2, 0.012), slateLightMat);
  rearPost.position.set(0.06, 0.04, 0);
  add(rearPost, redDot);
  const frontPost = new THREE.Mesh(new RoundedBoxGeometry(0.04, 0.14, 0.16, 2, 0.012), slateLightMat);
  frontPost.position.set(-0.09, 0.02, 0);
  add(frontPost, redDot);
  const hoodTop = new THREE.Mesh(new RoundedBoxGeometry(0.2, 0.03, 0.16, 2, 0.01), slateLightMat);
  hoodTop.position.set(-0.02, 0.12, 0);
  hoodTop.rotation.z = 0.12;
  add(hoodTop, redDot);
  // tinted lens (angled)
  const lens = new THREE.Mesh(new THREE.PlaneGeometry(0.14, 0.16), glassMat);
  lens.position.set(-0.01, 0.03, 0);
  lens.rotation.y = Math.PI / 2;
  lens.rotation.z = -0.14;
  add(lens, redDot);
  // glowing red dot on the lens
  const reticle = new THREE.Mesh(new THREE.CircleGeometry(0.012, 16), dotMat);
  reticle.position.set(0.005, 0.03, 0);
  reticle.rotation.y = Math.PI / 2;
  add(reticle, redDot);
  // two slotted screws on top
  for (const sx of [-0.06, 0.02]) {
    const screw = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.01, 12), steelDarkMat);
    screw.position.set(sx, 0.135, 0.05);
    add(screw, redDot);
  }

  // =========================================================================
  // TRIGGER GROUP + oval guard
  // =========================================================================
  const triggerGroup = new THREE.Group();
  triggerGroup.name = 'triggerGroup';
  add(triggerGroup);
  // oval guard (torus, flattened)
  const guard = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.016, 12, 28), slateDarkMat);
  guard.scale.set(1.15, 0.85, 1);
  guard.position.set(0.62, -0.16, 0);
  add(guard, triggerGroup);
  // trigger blade
  const trigger = new THREE.Mesh(new RoundedBoxGeometry(0.03, 0.1, 0.03, 2, 0.01), darkMetalMat);
  trigger.name = 'triggerBlade';
  trigger.position.set(0.64, -0.13, 0);
  trigger.rotation.z = 0.25;
  add(trigger, triggerGroup);

  // =========================================================================
  // PISTOL GRIP (black polymer, angled back)
  // =========================================================================
  const gripGroup = new THREE.Group();
  gripGroup.name = 'grip';
  gripGroup.position.set(1.02, -0.02, 0);
  gripGroup.rotation.z = -0.34;
  add(gripGroup);
  const gripBody = new THREE.Mesh(new RoundedBoxGeometry(0.2, 0.5, 0.16, 5, 0.07), polyMatSheen);
  gripBody.position.set(0.06, -0.24, 0);
  gripBody.scale.set(1, 1, 1.02);
  add(gripBody, gripGroup);
  // palm swell / flare at the base
  const gripBase = new THREE.Mesh(new RoundedBoxGeometry(0.26, 0.1, 0.19, 4, 0.05), polyMatSheen);
  gripBase.position.set(0.08, -0.47, 0);
  add(gripBase, gripGroup);
  // beavertail top
  const beaver = new THREE.Mesh(new RoundedBoxGeometry(0.22, 0.12, 0.16, 3, 0.05), polyMatSheen);
  beaver.position.set(-0.02, 0.02, 0);
  add(beaver, gripGroup);

  // =========================================================================
  // MUZZLE FLASH VFX (child of gun so it rides the recoil)
  // =========================================================================
  const muzzleSocket = new THREE.Group();
  muzzleSocket.name = 'muzzleSocket';
  muzzleSocket.position.set(-1.78, 0.12, 0);
  add(muzzleSocket);

  const flashSprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: makeFlashSprite(), color: 0xffffff, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0 }),
  );
  flashSprite.scale.set(0.6, 0.6, 0.6);
  muzzleSocket.add(flashSprite);

  const flashCone = new THREE.Mesh(
    new THREE.ConeGeometry(0.09, 0.34, 16, 1, true),
    new THREE.MeshBasicMaterial({ color: FLASH_EDGE, blending: THREE.AdditiveBlending, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }),
  );
  flashCone.rotation.z = Math.PI / 2; // point -X
  flashCone.position.x = -0.16;
  muzzleSocket.add(flashCone);

  const flashCore = new THREE.Mesh(
    new THREE.SphereGeometry(0.06, 12, 10),
    new THREE.MeshBasicMaterial({ color: FLASH_CORE, blending: THREE.AdditiveBlending, transparent: true, opacity: 0, depthWrite: false }),
  );
  muzzleSocket.add(flashCore);

  const flashLight = new THREE.PointLight(0xffb050, 0, 4, 2);
  flashLight.position.set(-0.1, 0, 0);
  muzzleSocket.add(flashLight);

  // muzzle smoke pool
  const smokeTex = makeSmokeSprite();
  interface Puff {
    sprite: THREE.Sprite;
    life: number;
    maxLife: number;
    vel: THREE.Vector3;
    seed: number;
  }
  const puffs: Puff[] = [];
  for (let i = 0; i < 8; i++) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex, transparent: true, opacity: 0, depthWrite: false }));
    sp.scale.setScalar(0.12);
    sp.visible = false;
    muzzleSocket.add(sp);
    puffs.push({ sprite: sp, life: 0, maxLife: 1, vel: new THREE.Vector3(), seed: i });
  }

  // =========================================================================
  // EJECTING SHELL POOL (children of root, fly in world space)
  // =========================================================================
  function buildShell(): THREE.Group {
    const g = new THREE.Group();
    const hull = xCyl(0.05, 0.05, 0.13, 20, shellMat);
    add(hull, g);
    const base = xCyl(0.055, 0.055, 0.05, 20, brassMat);
    base.position.x = 0.08;
    add(base, g);
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.062, 0.014, 20), brassMat);
    rim.rotation.z = Math.PI / 2;
    rim.position.x = 0.104;
    add(rim, g);
    const primer = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.016, 12), steelDarkMat);
    primer.rotation.z = Math.PI / 2;
    primer.position.x = 0.11;
    add(primer, g);
    return g;
  }
  interface FlyShell {
    group: THREE.Group;
    active: boolean;
    vel: THREE.Vector3;
    ang: THREE.Vector3;
    life: number;
  }
  const shells: FlyShell[] = [];
  for (let i = 0; i < 5; i++) {
    const g = buildShell();
    g.visible = false;
    g.scale.setScalar(0.9);
    root.add(g);
    shells.push({ group: g, active: false, vel: new THREE.Vector3(), ang: new THREE.Vector3(), life: 0 });
  }

  // static "loose" reference shell resting near the gun (matches the reference sheet)
  const looseShell = buildShell();
  looseShell.position.set(0.35, -0.55, 0.55);
  looseShell.rotation.set(0, 0.4, Math.PI / 2 + 0.1);
  looseShell.scale.setScalar(0.9);
  add(looseShell, root);

  // ejection port world anchor (recomputed each eject)
  const ejectAnchor = new THREE.Object3D();
  ejectAnchor.position.set(0.62, 0.22, 0.14);
  receiver.add(ejectAnchor);

  // =========================================================================
  // FIRING STATE MACHINE
  // =========================================================================
  const rand = mulberry32(0x1122ff);
  const state = {
    recoil: 0, // 0..1 kick amount (decays)
    flash: 0, // flash timer remaining
    sinceFire: autoFireInterval * 0.5,
    shotIndex: 0,
  };
  const GRAVITY = 6.5;
  const tmpV = new THREE.Vector3();

  function spawnShell(): void {
    const slot = shells.find((s) => !s.active) ?? shells[state.shotIndex % shells.length];
    ejectAnchor.getWorldPosition(tmpV);
    slot.group.position.copy(tmpV);
    slot.group.rotation.set(rand() * Math.PI, rand() * Math.PI, Math.PI / 2 + (rand() - 0.5));
    // fling up, toward camera (+Z), slightly rearward (+X)
    slot.vel.set(0.5 + rand() * 0.4, 2.6 + rand() * 0.6, 1.7 + rand() * 0.6);
    slot.ang.set((rand() - 0.5) * 22, (rand() - 0.5) * 18, (rand() - 0.5) * 26);
    slot.life = 1.6;
    slot.active = true;
    slot.group.visible = true;
  }

  function fire(): void {
    state.recoil = 1;
    state.flash = 0.07;
    state.sinceFire = 0;
    state.shotIndex++;
    // shell ejects a touch after ignition
    window.setTimeout(spawnShell, 70);
  }

  // =========================================================================
  // TICK
  // =========================================================================
  const baseGunPos = gun.position.clone();
  const tick = (dt: number, elapsed: number): void => {
    // idle: gentle presentation sway on the whole prop
    root.rotation.y = Math.sin(elapsed * 0.3) * 0.28;
    root.position.y = 0.55 + Math.sin(elapsed * 0.9) * 0.01;

    // auto-fire loop
    state.sinceFire += dt;
    if (autoFireInterval > 0 && state.sinceFire >= autoFireInterval) {
      fire();
    }

    // recoil spring: instant kick, damped return
    state.recoil = Math.max(0, state.recoil - dt * 3.2);
    const r = state.recoil * state.recoil; // ease
    recoilPivot.rotation.z = -r * 0.16; // muzzle rises
    gun.position.set(baseGunPos.x + r * 0.14, baseGunPos.y + r * 0.02, baseGunPos.z);
    // bolt kicks back with the recoil, plus trigger squeeze
    boltGroup.position.x = 0.7 + r * 0.12;
    trigger.rotation.z = 0.25 + r * 0.35;

    // muzzle flash envelope
    if (state.flash > 0) {
      state.flash -= dt;
      const f = Math.max(0, state.flash / 0.07); // 1 -> 0
      const fm = flashSprite.material as THREE.SpriteMaterial;
      fm.opacity = f;
      const s = 0.5 + (1 - f) * 0.5 + f * 0.5;
      flashSprite.scale.setScalar(0.4 + s * 0.5);
      flashSprite.material.rotation = state.shotIndex * 1.3;
      (flashCone.material as THREE.MeshBasicMaterial).opacity = f * 0.9;
      flashCone.scale.set(0.7 + (1 - f) * 0.6, 1, 0.7 + (1 - f) * 0.6);
      (flashCore.material as THREE.MeshBasicMaterial).opacity = f;
      flashLight.intensity = f * 9;
      // reticle flares on shot
      dotMat.emissiveIntensity = 4 + f * 6;
    } else {
      flashLight.intensity = 0;
      (flashSprite.material as THREE.SpriteMaterial).opacity = 0;
      (flashCone.material as THREE.MeshBasicMaterial).opacity = 0;
      (flashCore.material as THREE.MeshBasicMaterial).opacity = 0;
      dotMat.emissiveIntensity = 4 + Math.sin(elapsed * 6) * 0.6;
    }

    // spawn a smoke puff right after a flash
    if (state.flash > 0.05 && rand() > 0.4) {
      const p = puffs.find((q) => q.life <= 0);
      if (p) {
        p.life = p.maxLife = 0.7 + rand() * 0.5;
        p.sprite.position.set(-0.1, 0, 0);
        p.sprite.scale.setScalar(0.1);
        p.vel.set(-0.25 - rand() * 0.2, 0.15 + rand() * 0.1, (rand() - 0.5) * 0.1);
        p.sprite.visible = true;
      }
    }
    for (const p of puffs) {
      if (p.life <= 0) continue;
      p.life -= dt;
      const t = p.life / p.maxLife;
      p.sprite.position.addScaledVector(p.vel, dt);
      p.sprite.scale.setScalar(0.1 + (1 - t) * 0.28);
      (p.sprite.material as THREE.SpriteMaterial).opacity = Math.max(0, t) * 0.5;
      if (p.life <= 0) p.sprite.visible = false;
    }

    // fly ejected shells
    for (const s of shells) {
      if (!s.active) continue;
      s.life -= dt;
      s.vel.y -= GRAVITY * dt;
      s.group.position.addScaledVector(s.vel, dt);
      s.group.rotation.x += s.ang.x * dt;
      s.group.rotation.y += s.ang.y * dt;
      s.group.rotation.z += s.ang.z * dt;
      if (s.group.position.y < 0.03) {
        // bounce once, lose energy
        s.group.position.y = 0.03;
        s.vel.y = Math.abs(s.vel.y) * 0.32;
        s.vel.x *= 0.5;
        s.vel.z *= 0.5;
        s.ang.multiplyScalar(0.4);
      }
      if (s.life <= 0) {
        s.active = false;
        s.group.visible = false;
      }
    }
  };
  root.userData.tick = tick;

  // ---- action-ready runtime ------------------------------------------------
  root.userData.sculptRuntime = {
    nodes: { receiver, handguard, barrel: barrelGroup, redDot, grip: gripGroup, triggerGroup, bolt: boltGroup },
    sockets: { muzzle: muzzleSocket, ejectionPort: ejectAnchor },
    materials: { slateMat, bakeliteMat, steelMat, polyMat: polyMatSheen, glassMat, dotMat },
    actions: { fire },
    vfx: { flashSprite, flashLight, shells, puffs },
  };

  root.scale.setScalar(scale);
  return root;
}

// ===========================================================================
// LOOKDEV LIGHTS — matches the moody studio-key look of the reference sheet
// ===========================================================================
export function createIssacaShotgunLookDevLights(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'IssacaShotgunLights';

  const key = new THREE.DirectionalLight(0xfff2e2, 2.6);
  key.position.set(-3.2, 4.2, 3.6);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 20;
  (key.shadow.camera as THREE.OrthographicCamera).left = -4;
  (key.shadow.camera as THREE.OrthographicCamera).right = 4;
  (key.shadow.camera as THREE.OrthographicCamera).top = 4;
  (key.shadow.camera as THREE.OrthographicCamera).bottom = -4;
  key.shadow.bias = -0.0004;
  g.add(key);

  const rim = new THREE.DirectionalLight(0x9fc2ff, 1.3);
  rim.position.set(4.0, 2.0, -3.2);
  g.add(rim);

  const fill = new THREE.DirectionalLight(0xbfd0ff, 0.4);
  fill.position.set(2.4, 0.6, 3.0);
  g.add(fill);

  const hemi = new THREE.HemisphereLight(0xbfd0ff, 0x14161c, 0.4);
  g.add(hemi);

  return g;
}

/** Dark vignette studio background like the reference hero renders. */
export function makeIssacaBackground(): THREE.Texture {
  const S = 512;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d')!;
  const g = ctx.createRadialGradient(S / 2, S * 0.42, 40, S / 2, S / 2, S * 0.75);
  g.addColorStop(0, '#2b2f36');
  g.addColorStop(0.6, '#181a1f');
  g.addColorStop(1, '#0c0d10');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
