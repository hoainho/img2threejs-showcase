import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

/**
 * XR-078 "IRONMOLE" / BRUTEFANG — heavy assault-breach vehicle, rebuilt in code from the
 * multi-view concept sheet (orthographic + isometric + detail crops) via img2threejs.
 *
 * Reconstruction targets (matched against the concept sheet, not a toy render):
 *  - LOW + LONG integrated silhouette (8.4m long, 3.9m tall in-fiction) — not stacked cubes
 *  - Weathered BRASS everywhere: darker, dirtier, roughness-varied, edge-worn (no plastic gold)
 *  - Green oxidation blended ONLY across the top of the rounded rear armor hump (height-driven,
 *    blotchy) — not a leopard-spot texture on a floating box
 *  - Angular gold cab: star hatch, ACCESS PANEL, SECTOR 07 plate, NO-ENTRY triangle, roof LED
 *    strip, twin slit headlights, twin corrugated hoses, side canister, louvered vents, bolts
 *  - Front breach assembly: riveted plow + 5 long polished-steel claw blades
 *  - 6 off-road tyres with a small CONCENTRATED red reactor-hub glow + teal underglow accents
 *
 * VFX via root.userData.tick(dt, elapsed): exhaust smoke, travelling glint across the blades,
 * rolling wheels with pulsing hubs, faint tyre dust, breathing neon arena ring.
 *
 * Action-ready: root.userData.sculptRuntime exposes named nodes, sockets and materials.
 */

export interface WarHaulerOptions {
  scale?: number;
  shadows?: boolean;
}

// ---------------------------------------------------------------------------
// palette — desaturated brass / bronze, sampled from the concept sheet
// ---------------------------------------------------------------------------
const BRASS = 0xb1852f; // warm brass base (clean, with only subtle grime)
const BRASS_BRIGHT = 0xd8b055; // worn highlight edges
const BRASS_DARK = 0x5a4418; // deep recesses / brackets
const PATINA = 0x3f6f4c; // teal-green oxidation (reads clearly on the hump top)
const STEEL = 0xd2d6dd;
const RUBBER = 0x121319;
const RED_HOT = 0xff1e08;
const RED_GLOW = 0xff4a1e;
const TEAL = 0x27d6c4;
const NEON_AMBER = 0xffab44;
const LED_WHITE = 0xfff2d6;

// ---------------------------------------------------------------------------
// deterministic PRNG
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
// canvas helpers
// ---------------------------------------------------------------------------
function newCanvas(w: number, h = w): { cv: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  return { cv, ctx: cv.getContext('2d')! };
}

/**
 * Grime/dirt map for brass. Near-white base (so material.color = brass tint shows through),
 * darkened by soot streaks, blotches and edge wear. Doubles as a roughness map (grime = rough).
 */
function makeDirtMap(): THREE.CanvasTexture {
  const S = 1024;
  const { cv, ctx } = newCanvas(S);
  const rand = mulberry32(0x0d1a7c);
  // clean bright base so material.color (brass) shows through; grime is SUBTLE only
  ctx.fillStyle = '#efefef';
  ctx.fillRect(0, 0, S, S);
  // faint dark grime blotches (low alpha, mostly in the "recess" feel)
  for (let i = 0; i < 130; i++) {
    const x = rand() * S;
    const y = rand() * S;
    const r = 30 + rand() * 90;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(60,50,30,${0.04 + rand() * 0.1})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // faint vertical soot streaks
  for (let i = 0; i < 60; i++) {
    ctx.strokeStyle = `rgba(50,40,26,${0.05 + rand() * 0.1})`;
    ctx.lineWidth = 1 + rand() * 3;
    const x = rand() * S;
    const y0 = rand() * S;
    ctx.beginPath();
    ctx.moveTo(x, y0);
    ctx.bezierCurveTo(x + (rand() - 0.5) * 24, y0 + 60, x + (rand() - 0.5) * 24, y0 + 140, x + (rand() - 0.5) * 18, y0 + 210);
    ctx.stroke();
  }
  // subtle brushed scratches for roughness variation
  for (let i = 0; i < 420; i++) {
    ctx.strokeStyle = rand() > 0.5 ? `rgba(255,255,255,${0.06 + rand() * 0.12})` : `rgba(120,100,60,${0.05 + rand() * 0.1})`;
    ctx.lineWidth = rand() * 1.2;
    const x = rand() * S;
    const y = rand() * S;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (rand() - 0.5) * 36, y + (rand() - 0.5) * 6);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

function makeTreadTexture(): THREE.CanvasTexture {
  const W = 256;
  const H = 64;
  const { cv, ctx } = newCanvas(W, H);
  ctx.fillStyle = '#3a3a3a';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#cfcfcf';
  const blocks = 20;
  for (let i = 0; i < blocks; i++) {
    const x = (i / blocks) * W;
    const off = i % 2 === 0 ? 5 : -5;
    ctx.fillRect(x + off + 2, 4, 8, 22);
    ctx.fillRect(x + off - 2, 38, 8, 22);
  }
  ctx.fillStyle = '#1e1e1e';
  ctx.fillRect(0, 30, W, 4);
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function makeHazardTexture(): THREE.CanvasTexture {
  const S = 128;
  const { cv, ctx } = newCanvas(S);
  ctx.fillStyle = '#0d0d0d';
  ctx.fillRect(0, 0, S, S);
  ctx.fillStyle = '#d9a51c';
  ctx.save();
  ctx.translate(S / 2, S / 2);
  ctx.rotate(-Math.PI / 4);
  for (let x = -S; x < S; x += 26) ctx.fillRect(x, -S, 13, S * 2);
  ctx.restore();
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function makeStarTexture(): THREE.CanvasTexture {
  const S = 256;
  const { cv, ctx } = newCanvas(S);
  const cx = S / 2;
  const cy = S / 2;
  ctx.fillStyle = '#e7dcc0';
  ctx.beginPath();
  const rO = S * 0.36;
  const rI = S * 0.15;
  for (let i = 0; i < 10; i++) {
    const ang = -Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 === 0 ? rO : rI;
    const x = cx + Math.cos(ang) * r;
    const y = cy + Math.sin(ang) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeLabelTexture(
  text: string,
  opts: { bg?: string; fg?: string; accent?: string; dashes?: boolean; wide?: boolean; sub?: string } = {},
): THREE.CanvasTexture {
  const W = opts.wide ? 512 : 256;
  const H = 128;
  const { cv, ctx } = newCanvas(W, H);
  if (opts.bg) {
    ctx.fillStyle = opts.bg;
    ctx.fillRect(0, 0, W, H);
  }
  ctx.fillStyle = opts.fg ?? '#e7dcc0';
  ctx.font = `bold ${opts.wide ? 54 : 42}px "Arial Narrow", Arial, sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 16, opts.sub ? H * 0.38 : H / 2);
  if (opts.sub) {
    ctx.font = '20px Arial, sans-serif';
    ctx.fillStyle = 'rgba(200,190,160,0.7)';
    ctx.fillText(opts.sub, 16, H * 0.72);
  }
  if (opts.dashes) {
    ctx.fillStyle = opts.accent ?? '#e0902a';
    const y = H - 18;
    for (let x = 16; x < W - 16; x += 24) ctx.fillRect(x, y, 15, 7);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Yellow NO-ENTRY warning triangle decal (transparent bg). */
function makeWarningTriangle(): THREE.CanvasTexture {
  const S = 128;
  const { cv, ctx } = newCanvas(S);
  ctx.fillStyle = '#e0b020';
  ctx.beginPath();
  ctx.moveTo(S / 2, 14);
  ctx.lineTo(S - 14, S - 20);
  ctx.lineTo(14, S - 20);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#111';
  ctx.font = 'bold 60px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('!', S / 2, S / 2 + 8);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeLouverTexture(): THREE.CanvasTexture {
  const W = 128;
  const H = 128;
  const { cv, ctx } = newCanvas(W, H);
  ctx.fillStyle = '#161a17';
  ctx.fillRect(0, 0, W, H);
  for (let y = 10; y < H; y += 15) {
    ctx.fillStyle = '#050605';
    ctx.fillRect(6, y, W - 12, 9);
    ctx.fillStyle = '#3f524a';
    ctx.fillRect(6, y - 2, W - 12, 2);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

let _glowTex: THREE.Texture | null = null;
function glowTexture(): THREE.Texture {
  if (_glowTex) return _glowTex;
  const S = 128;
  const { cv, ctx } = newCanvas(S);
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.22, 'rgba(255,255,255,0.7)');
  g.addColorStop(0.55, 'rgba(255,255,255,0.16)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  _glowTex = new THREE.CanvasTexture(cv);
  return _glowTex;
}

let _smokeTex: THREE.Texture | null = null;
function smokeTexture(): THREE.Texture {
  if (_smokeTex) return _smokeTex;
  const S = 128;
  const { cv, ctx } = newCanvas(S);
  const rand = mulberry32(0x5a0e11);
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(220,220,225,0.85)');
  g.addColorStop(0.5, 'rgba(160,160,170,0.35)');
  g.addColorStop(1, 'rgba(120,120,130,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  ctx.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 46; i++) {
    const a = rand() * Math.PI * 2;
    const r = S * (0.3 + rand() * 0.2);
    ctx.beginPath();
    ctx.arc(S / 2 + Math.cos(a) * r, S / 2 + Math.sin(a) * r, 4 + rand() * 12, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(0,0,0,${0.3 + rand() * 0.4})`;
    ctx.fill();
  }
  _smokeTex = new THREE.CanvasTexture(cv);
  return _smokeTex;
}

function makeGlowSprite(color: number, size: number, opacity = 1): THREE.Sprite {
  const s = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: glowTexture(),
      color,
      transparent: true,
      opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  s.scale.setScalar(size);
  return s;
}

// ---------------------------------------------------------------------------
// materials
// ---------------------------------------------------------------------------
function makeBrass(dirt: THREE.Texture, repeat = 1): THREE.MeshStandardMaterial {
  const map = dirt.clone();
  map.needsUpdate = true;
  map.repeat.set(repeat, repeat);
  return new THREE.MeshStandardMaterial({
    color: BRASS,
    map,
    roughness: 0.52,
    roughnessMap: map,
    metalness: 1.0,
    envMapIntensity: 0.7,
  });
}

/** Brass whose upper region oxidizes to blotchy teal-green (height-driven, matches the sheet). */
function makeWeatheredBrass(dirt: THREE.Texture, lo: number, hi: number): THREE.MeshStandardMaterial {
  const map = dirt.clone();
  map.needsUpdate = true;
  map.repeat.set(1.4, 1.4);
  const mat = new THREE.MeshStandardMaterial({
    color: BRASS,
    map,
    roughness: 0.6,
    roughnessMap: map,
    metalness: 0.9,
    envMapIntensity: 0.6,
  });
  const patina = new THREE.Color(PATINA).convertSRGBToLinear();
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uLo = { value: lo };
    shader.uniforms.uHi = { value: hi };
    shader.vertexShader =
      'varying vec3 vWPosW;\n' +
      shader.vertexShader.replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>\n vWPosW = (modelMatrix * vec4(transformed,1.0)).xyz;`,
      );
    shader.fragmentShader =
      `varying vec3 vWPosW;\nuniform float uLo;\nuniform float uHi;\n` +
      shader.fragmentShader.replace(
        '#include <color_fragment>',
        `#include <color_fragment>
         float _h = clamp((vWPosW.y - uLo) / (uHi - uLo), 0.0, 1.0);
         // smooth organic blotches (multi-octave sines — no hard cells)
         float _n = 0.5 + 0.5 * sin(vWPosW.x * 7.3 + 1.7) * sin(vWPosW.z * 5.1 - 0.9);
         _n += 0.35 * (0.5 + 0.5 * sin(vWPosW.x * 15.7 - 2.1) * sin(vWPosW.z * 12.3 + 0.4));
         _n = clamp(_n / 1.35, 0.0, 1.0);
         float _g = smoothstep(0.25, 0.9, _h) * smoothstep(0.25, 0.75, _n);
         diffuseColor.rgb = mix(diffuseColor.rgb, vec3(${patina.r.toFixed(4)}, ${patina.g.toFixed(4)}, ${patina.b.toFixed(4)}), _g * 0.92);`,
      );
  };
  mat.customProgramCacheKey = () => 'warhauler-patina-v2';
  return mat;
}

function makeBrassBright(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: BRASS_BRIGHT, metalness: 1.0, roughness: 0.34, envMapIntensity: 0.9 });
}
function makeBrassDark(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: BRASS_DARK, metalness: 1.0, roughness: 0.55 });
}
function makeDarkMetal(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: 0x14161a, metalness: 0.85, roughness: 0.5 });
}
function makeSteel(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: STEEL,
    metalness: 1.0,
    roughness: 0.11,
    emissive: 0xffffff,
    emissiveIntensity: 0,
    envMapIntensity: 1.6,
  });
}
function makeRubber(tread: THREE.Texture): THREE.MeshStandardMaterial {
  const t = tread.clone();
  t.needsUpdate = true;
  t.repeat.set(11, 1);
  return new THREE.MeshStandardMaterial({ color: RUBBER, metalness: 0, roughness: 0.95, bumpMap: t, bumpScale: 0.02 });
}
function makeGlass(): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color: 0x070d10,
    metalness: 0.5,
    roughness: 0.1,
    clearcoat: 1,
    clearcoatRoughness: 0.06,
    envMapIntensity: 1.3,
  });
}
function makeEmissive(color: number, intensity: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: intensity, metalness: 0.2, roughness: 0.4 });
}

// ---------------------------------------------------------------------------
// small reusable geometry
// ---------------------------------------------------------------------------
const BOLT_GEO = new THREE.SphereGeometry(0.025, 8, 6);

function boltRow(count: number, from: THREE.Vector3, to: THREE.Vector3, mat: THREE.Material): THREE.InstancedMesh {
  const inst = new THREE.InstancedMesh(BOLT_GEO, mat, count);
  const m = new THREE.Matrix4();
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : i / (count - 1);
    const p = from.clone().lerp(to, t);
    m.makeTranslation(p.x, p.y, p.z);
    inst.setMatrixAt(i, m);
  }
  inst.instanceMatrix.needsUpdate = true;
  return inst;
}

/** thin recessed panel-line groove on a surface (dark inset box). */
function panelLine(w: number, h: number, d: number, mat: THREE.Material): THREE.Mesh {
  return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
}

function decalPlane(tex: THREE.Texture, w: number, h: number, emissive = false): THREE.Mesh {
  const mat = new THREE.MeshStandardMaterial({
    map: tex,
    transparent: true,
    roughness: 0.7,
    metalness: 0,
    emissive: emissive ? 0xffffff : 0x000000,
    emissiveMap: emissive ? tex : null,
    emissiveIntensity: emissive ? 1.0 : 0,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
  });
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
}

function makeBladeGeometry(): THREE.ExtrudeGeometry {
  const w = 0.07;
  const shape = new THREE.Shape();
  shape.moveTo(-w, 0);
  shape.lineTo(w, 0);
  shape.lineTo(w * 0.5, -0.62);
  shape.lineTo(0, -1.18);
  shape.lineTo(-w * 0.5, -0.62);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.045, bevelEnabled: true, bevelThickness: 0.018, bevelSize: 0.02, bevelSegments: 2 });
  geo.center();
  return geo;
}

function makeFenderGeometry(width: number): THREE.ExtrudeGeometry {
  const R = 0.76;
  const ri = 0.6;
  const shape = new THREE.Shape();
  shape.absarc(0, 0, R, 0, Math.PI, false);
  shape.lineTo(-ri, 0);
  shape.absarc(0, 0, ri, Math.PI, 0, true);
  shape.lineTo(R, 0);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: false, curveSegments: 28 });
  geo.translate(0, 0, -width / 2);
  geo.rotateY(Math.PI / 2);
  return geo;
}

/** corrugated hose along a curve, with ribs. */
function makeHose(pts: THREE.Vector3[], radius: number, tubeMat: THREE.Material, ribMat: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const curve = new THREE.CatmullRomCurve3(pts);
  g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 30, radius, 10, false), tubeMat));
  const ribGeo = new THREE.TorusGeometry(radius * 1.15, radius * 0.28, 6, 12);
  for (let i = 0; i <= 10; i++) {
    const p = curve.getPoint(i / 10);
    const rib = new THREE.Mesh(ribGeo, ribMat);
    rib.position.copy(p);
    rib.lookAt(p.clone().add(curve.getTangent(i / 10)));
    g.add(rib);
  }
  return g;
}

// ---------------------------------------------------------------------------
// wheel — tyre + detailed rim + small concentrated red reactor hub
// ---------------------------------------------------------------------------
interface WheelParts {
  group: THREE.Group;
  hubMat: THREE.MeshStandardMaterial;
  coreMat: THREE.MeshStandardMaterial;
  halo: THREE.Sprite;
}

function buildWheel(radius: number, width: number, rubber: THREE.Material, brassBright: THREE.Material, brassDark: THREE.Material, shadows: boolean): WheelParts {
  const g = new THREE.Group();
  const outX = width / 2;

  const tyre = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, width, 44, 1, false), rubber);
  tyre.rotation.z = Math.PI / 2;
  if (shadows) {
    tyre.castShadow = true;
    tyre.receiveShadow = true;
  }
  g.add(tyre);

  // chunky sidewall lugs
  const sidewall = new THREE.Mesh(new THREE.TorusGeometry(radius * 0.78, radius * 0.14, 10, 40), new THREE.MeshStandardMaterial({ color: 0x0a0b0e, roughness: 0.9 }));
  sidewall.rotation.y = Math.PI / 2;
  sidewall.position.x = outX - 0.01;
  g.add(sidewall);

  // gold rim ring + inner rim disc
  const rim = new THREE.Mesh(new THREE.TorusGeometry(radius * 0.58, 0.045, 12, 44), brassBright);
  rim.rotation.y = Math.PI / 2;
  rim.position.x = outX + 0.01;
  g.add(rim);
  const rimDisc = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.56, radius * 0.56, 0.05, 40), brassDark);
  rimDisc.rotation.z = Math.PI / 2;
  rimDisc.position.x = outX;
  g.add(rimDisc);

  // dark hub well (recessed, reads as AO around the glow)
  const well = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.4, radius * 0.44, 0.12, 32), new THREE.MeshStandardMaterial({ color: 0x0b0705, roughness: 0.6, metalness: 0.3 }));
  well.rotation.z = Math.PI / 2;
  well.position.x = outX - 0.02;
  g.add(well);

  // small bright red reactor ring (concentrated, not a floodlight)
  const hubMat = makeEmissive(RED_GLOW, 2.6);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(radius * 0.2, 0.03, 12, 36), hubMat);
  ring.rotation.y = Math.PI / 2;
  ring.position.x = outX + 0.03;
  g.add(ring);
  const coreMat = makeEmissive(RED_HOT, 3.0);
  const core = new THREE.Mesh(new THREE.CircleGeometry(radius * 0.15, 28), coreMat);
  core.rotation.y = Math.PI / 2;
  core.position.x = outX + 0.028;
  g.add(core);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.06, radius * 0.06, 0.06, 16), new THREE.MeshStandardMaterial({ color: 0x180402, roughness: 0.5, metalness: 0.4 }));
  cap.rotation.z = Math.PI / 2;
  cap.position.x = outX + 0.05;
  g.add(cap);

  // lug bolts around the rim (rotate with wheel)
  const lugMat = brassDark;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const lug = new THREE.Mesh(BOLT_GEO, lugMat);
    lug.position.set(outX + 0.02, Math.sin(a) * radius * 0.46, Math.cos(a) * radius * 0.46);
    lug.scale.setScalar(1.4);
    g.add(lug);
  }

  const halo = makeGlowSprite(RED_HOT, radius * 0.95, 0.75);
  halo.position.x = outX + 0.05;
  g.add(halo);

  return { group: g, hubMat, coreMat, halo };
}

// ---------------------------------------------------------------------------
// main factory
// ---------------------------------------------------------------------------
export function createWarHaulerModel(options: WarHaulerOptions = {}): THREE.Group {
  const scale = options.scale ?? 1;
  const shadows = options.shadows ?? true;

  const root = new THREE.Group();
  root.name = 'war-hauler';

  const dirt = makeDirtMap();
  const treadTex = makeTreadTexture();
  const louverTex = makeLouverTexture();

  const brass = makeBrass(dirt, 1);
  const brassBright = makeBrassBright();
  const brassDark = makeBrassDark();
  const darkMetal = makeDarkMetal();
  const steel = makeSteel();
  const rubber = makeRubber(treadTex);
  const glass = makeGlass();
  const louverMat = new THREE.MeshStandardMaterial({ map: louverTex, metalness: 0.7, roughness: 0.6 });

  const nodes: Record<string, THREE.Object3D> = {};
  const sockets: Record<string, THREE.Object3D> = {};

  const body = new THREE.Group();
  body.name = 'body';
  root.add(body);

  // ---- chassis / underbody (dark, low) --------------------------------------
  const chassis = new THREE.Mesh(new RoundedBoxGeometry(1.5, 0.5, 4.0, 2, 0.04), darkMetal);
  chassis.position.set(0, 0.6, 0.3);
  if (shadows) chassis.castShadow = true;
  body.add(chassis);
  nodes.chassis = chassis;

  // ==========================================================================
  // FRONT CAB — forward is -Z. Low, angular, integrated.
  // ==========================================================================
  const cab = new THREE.Group();
  cab.name = 'cab';
  body.add(cab);
  nodes.cab = cab;

  // sloped lower snout down to the plow
  const snout = new THREE.Mesh(new RoundedBoxGeometry(1.34, 0.46, 1.1, 2, 0.04), brass);
  snout.position.set(0, 0.86, -1.62);
  snout.rotation.x = -0.24;
  if (shadows) snout.castShadow = true;
  cab.add(snout);

  // raised hood hatch (star + ACCESS PANEL) — beveled lid, dark recessed sides
  const hoodBase = new THREE.Mesh(new RoundedBoxGeometry(1.18, 0.14, 1.3, 2, 0.03), brassDark);
  hoodBase.position.set(-0.03, 1.06, -1.2);
  cab.add(hoodBase);
  const hood = new THREE.Mesh(new RoundedBoxGeometry(1.0, 0.22, 1.12, 2, 0.05), brass);
  hood.position.set(-0.03, 1.2, -1.2);
  if (shadows) hood.castShadow = true;
  cab.add(hood);
  nodes.hood = hood;
  const hoodCap = new THREE.Mesh(new RoundedBoxGeometry(0.82, 0.06, 0.94, 2, 0.02), brassBright);
  hoodCap.position.set(-0.03, 1.33, -1.2);
  cab.add(hoodCap);

  const star = decalPlane(makeStarTexture(), 0.3, 0.3);
  star.rotation.x = -Math.PI / 2;
  star.position.set(-0.2, 1.365, -1.42);
  cab.add(star);
  const accessLabel = decalPlane(makeLabelTexture('ACCESS PANEL', { fg: '#cabfa2', wide: true }), 0.44, 0.1);
  accessLabel.rotation.x = -Math.PI / 2;
  accessLabel.position.set(0.02, 1.365, -1.0);
  cab.add(accessLabel);

  // hazard-stripe lip at the hood front
  const hazardTex = makeHazardTexture();
  hazardTex.repeat.set(3, 1);
  const hazardLip = new THREE.Mesh(new THREE.BoxGeometry(0.98, 0.14, 0.05), new THREE.MeshStandardMaterial({ map: hazardTex, roughness: 0.5, metalness: 0.3 }));
  hazardLip.position.set(-0.03, 1.16, -1.8);
  hazardLip.rotation.x = -0.18;
  cab.add(hazardLip);

  cab.add(boltRow(8, new THREE.Vector3(0.46, 1.31, -1.72), new THREE.Vector3(0.46, 1.31, -0.7), brassDark));
  cab.add(boltRow(8, new THREE.Vector3(-0.52, 1.31, -1.72), new THREE.Vector3(-0.52, 1.31, -0.7), brassDark));

  // upper cabin block — lower than before, angular
  const cabin = new THREE.Mesh(new RoundedBoxGeometry(1.28, 0.5, 1.0, 2, 0.05), brass);
  cabin.position.set(0, 1.36, -0.5);
  if (shadows) cabin.castShadow = true;
  cab.add(cabin);
  nodes.cabin = cabin;
  // crisp top plate
  const cabinTop = new THREE.Mesh(new RoundedBoxGeometry(1.14, 0.06, 0.86, 2, 0.02), brassBright);
  cabinTop.position.set(0, 1.62, -0.5);
  cab.add(cabinTop);

  // angled dark windshield/visor
  const visor = new THREE.Mesh(new THREE.BoxGeometry(1.06, 0.34, 0.05), glass);
  visor.position.set(0, 1.34, -0.95);
  visor.rotation.x = -0.5;
  cab.add(visor);
  nodes.visor = visor;
  // visor hood brow
  const brow = new THREE.Mesh(new THREE.BoxGeometry(1.12, 0.08, 0.22), brassDark);
  brow.position.set(0, 1.55, -0.96);
  brow.rotation.x = -0.3;
  cab.add(brow);

  // roof LED strip
  const ledMat = makeEmissive(LED_WHITE, 3.2);
  const ledStrip = new THREE.Group();
  for (let i = 0; i < 6; i++) {
    const led = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.045, 0.07), ledMat);
    led.position.set(-0.42 + i * 0.17, 1.66, -0.88);
    ledStrip.add(led);
    const gl = makeGlowSprite(LED_WHITE, 0.2, 0.5);
    gl.position.copy(led.position).add(new THREE.Vector3(0, 0.01, -0.03));
    ledStrip.add(gl);
  }
  cab.add(ledStrip);
  nodes.ledStrip = ledStrip;

  // sensor pod on the roof
  const pod = new THREE.Mesh(new RoundedBoxGeometry(0.5, 0.1, 0.3, 2, 0.03), brassBright);
  pod.position.set(0.06, 1.68, -0.3);
  cab.add(pod);

  // twin angular slit headlights + housings
  const headMat = makeEmissive(0xffffff, 3.6);
  for (const sx of [-0.36, 0.36]) {
    const housing = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.14, 0.08), brassDark);
    housing.position.set(sx, 1.02, -1.02);
    housing.rotation.z = sx < 0 ? -0.32 : 0.32;
    cab.add(housing);
    const hl = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.06, 0.05), headMat);
    hl.position.set(sx, 1.02, -1.06);
    hl.rotation.z = sx < 0 ? -0.32 : 0.32;
    cab.add(hl);
    const gl = makeGlowSprite(0xfff0d0, 0.42, 0.85);
    gl.position.set(sx, 1.02, -1.1);
    cab.add(gl);
  }

  // SECTOR 07 side plate
  const sector = decalPlane(makeLabelTexture('SECTOR 07', { bg: '#0a0b0e', fg: '#e2dac6', accent: '#e0902a', dashes: true, wide: true }), 0.56, 0.15);
  sector.position.set(0.66, 0.86, -0.95);
  sector.rotation.y = -Math.PI / 2;
  cab.add(sector);

  // NO ENTRY warning triangle on the side
  const warn = decalPlane(makeWarningTriangle(), 0.14, 0.14);
  warn.position.set(0.66, 1.22, -1.35);
  warn.rotation.y = -Math.PI / 2;
  cab.add(warn);

  // blue data sticker
  const sticker = decalPlane(makeLabelTexture('ID-4471', { bg: '#0f2c52', fg: '#a9caf5' }), 0.18, 0.09);
  sticker.position.set(0.66, 1.16, -0.7);
  sticker.rotation.y = -Math.PI / 2;
  cab.add(sticker);

  // side canister
  const canister = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.3, 16), new THREE.MeshStandardMaterial({ color: 0x5c6158, metalness: 0.7, roughness: 0.45 }));
  canister.position.set(0.62, 0.92, -0.45);
  canister.rotation.z = Math.PI / 2;
  cab.add(canister);

  // twin corrugated hoses on the right side (as in the sheet)
  const hoseMat = new THREE.MeshStandardMaterial({ color: 0x2a2018, metalness: 0.5, roughness: 0.7 });
  const ribMat = new THREE.MeshStandardMaterial({ color: 0x171009, metalness: 0.4, roughness: 0.85 });
  const hoseA = makeHose(
    [new THREE.Vector3(0.5, 1.2, -0.7), new THREE.Vector3(0.72, 1.0, -0.85), new THREE.Vector3(0.76, 0.78, -1.05), new THREE.Vector3(0.6, 0.62, -1.22)],
    0.05, hoseMat, ribMat,
  );
  cab.add(hoseA);
  const hoseB = makeHose(
    [new THREE.Vector3(0.44, 1.24, -0.55), new THREE.Vector3(0.64, 1.06, -0.6), new THREE.Vector3(0.7, 0.84, -0.7), new THREE.Vector3(0.58, 0.66, -0.82)],
    0.04, hoseMat, ribMat,
  );
  cab.add(hoseB);
  nodes.exhaust = hoseA;

  const smokeSocket = new THREE.Object3D();
  smokeSocket.position.set(0.6, 0.62, -1.24);
  cab.add(smokeSocket);
  sockets.exhaustOutlet = smokeSocket;

  // ==========================================================================
  // REAR ARMOR HUMP — one rounded mass, green oxidation blended across its top
  // ==========================================================================
  const rear = new THREE.Group();
  rear.name = 'rear-hump';
  body.add(rear);
  nodes.rear = rear;

  // gold connector torso overlapping the cab (no floating gap)
  const connector = new THREE.Mesh(new RoundedBoxGeometry(1.42, 0.72, 0.7, 2, 0.05), brass);
  connector.position.set(0, 1.1, 0.05);
  if (shadows) connector.castShadow = true;
  body.add(connector);
  nodes.connector = connector;

  // lower engine base
  const base = new THREE.Mesh(new RoundedBoxGeometry(1.5, 0.7, 1.95, 2, 0.06), brass);
  base.position.set(0, 1.1, 1.0);
  if (shadows) base.castShadow = true;
  rear.add(base);

  // rounded top hump (big fillets → pillowy armored cover) with weathered patina
  const humpMat = makeWeatheredBrass(dirt, 1.35, 1.95);
  const hump = new THREE.Mesh(new RoundedBoxGeometry(1.46, 0.82, 1.8, 4, 0.3), humpMat);
  hump.position.set(0, 1.62, 0.95);
  if (shadows) {
    hump.castShadow = true;
    hump.receiveShadow = true;
  }
  rear.add(hump);
  nodes.hump = hump;

  // horizontal louver vents on the hump sides
  for (const sx of [-0.75, 0.75]) {
    const vent = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.42, 1.3), louverMat);
    vent.position.set(sx, 1.5, 0.95);
    rear.add(vent);
  }
  // rear louver bank
  const rearVent = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.5, 0.06), louverMat);
  rearVent.position.set(0, 1.45, 1.95);
  rear.add(rearVent);

  // panel lines across the hump top
  for (let i = 0; i < 3; i++) {
    const pl = panelLine(1.2, 0.02, 0.03, brassDark);
    pl.position.set(0, 2.0, 0.4 + i * 0.5);
    rear.add(pl);
  }

  const caution = decalPlane(makeLabelTexture('CAUTION', { fg: '#d9bf3a', wide: true }), 0.46, 0.12);
  caution.rotation.x = -Math.PI / 2;
  caution.position.set(0.1, 2.03, 0.2);
  caution.rotation.z = 0.02;
  rear.add(caution);

  rear.add(boltRow(9, new THREE.Vector3(-0.7, 0.82, 1.95), new THREE.Vector3(0.7, 0.82, 1.95), brassDark));

  // rear teal accent underglow strip + red tail
  const tealStrip = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.04, 0.03), makeEmissive(TEAL, 2.0));
  tealStrip.position.set(0, 0.92, 1.98);
  rear.add(tealStrip);
  rear.add(makeGlowSprite(TEAL, 1.2, 0.3));
  (rear.children[rear.children.length - 1] as THREE.Sprite).position.set(0, 0.9, 2.05);

  // ==========================================================================
  // FRONT BREACH ASSEMBLY — plow + 5 steel claw blades
  // ==========================================================================
  const plow = new THREE.Group();
  plow.name = 'plow';
  body.add(plow);
  nodes.plow = plow;

  const plowPlate = new THREE.Mesh(new RoundedBoxGeometry(1.86, 0.86, 0.1, 3, 0.03), brass);
  plowPlate.position.set(0, 0.66, -2.32);
  plowPlate.rotation.x = 0.6;
  if (shadows) plowPlate.castShadow = true;
  plow.add(plowPlate);

  const plowBar = new THREE.Mesh(new RoundedBoxGeometry(1.9, 0.12, 0.14, 2, 0.03), brassBright);
  plowBar.position.set(0, 0.98, -2.08);
  plow.add(plowBar);
  plow.add(boltRow(12, new THREE.Vector3(-0.84, 1.04, -2.06), new THREE.Vector3(0.84, 1.04, -2.06), brassDark));

  for (const sx of [-0.94, 0.94]) {
    const wing = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.66, 0.46), brassDark);
    wing.position.set(sx, 0.66, -2.28);
    wing.rotation.x = 0.5;
    plow.add(wing);
  }

  const blades: THREE.Mesh[] = [];
  const bladeTips: THREE.Sprite[] = [];
  const bladeGeo = makeBladeGeometry();
  for (let i = 0; i < 5; i++) {
    const blade = new THREE.Mesh(bladeGeo, steel.clone());
    const x = -0.7 + i * 0.35;
    blade.position.set(x, 0.34, -2.62);
    blade.rotation.x = 1.12;
    blade.scale.setScalar(i === 2 ? 1.12 : 1.0);
    if (shadows) blade.castShadow = true;
    plow.add(blade);
    blades.push(blade);
    const glint = makeGlowSprite(0xffffff, 0.2, 0);
    glint.position.set(x, -0.02, -2.98);
    plow.add(glint);
    bladeTips.push(glint);
  }
  nodes.blades = plow;

  const groundPlate = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.05, 1.3), new THREE.MeshStandardMaterial({ color: 0x2f2f33, metalness: 0.4, roughness: 0.9 }));
  groundPlate.position.set(0, 0.025, -2.3);
  if (shadows) groundPlate.receiveShadow = true;
  body.add(groundPlate);

  // ==========================================================================
  // WHEELS (6) + fenders
  // ==========================================================================
  const wheelZ = [-0.78, 0.42, 1.62];
  const wheelRadius = 0.55;
  const wheelWidth = 0.4;
  const wheels: WheelParts[] = [];
  const fenderGeo = makeFenderGeometry(wheelWidth + 0.12);
  for (const z of wheelZ) {
    for (const sx of [-1, 1]) {
      const parts = buildWheel(wheelRadius, wheelWidth, rubber, brassBright, brassDark, shadows);
      parts.group.position.set(sx * 0.8, wheelRadius, z);
      if (sx < 0) parts.group.rotation.y = Math.PI;
      body.add(parts.group);
      wheels.push(parts);

      const fender = new THREE.Mesh(fenderGeo, brass);
      fender.position.set(sx * 0.82, wheelRadius, z);
      if (shadows) fender.castShadow = true;
      body.add(fender);
    }
  }
  nodes.wheels = body;

  // side skirts
  for (const sx of [-1, 1]) {
    const skirt = new THREE.Mesh(new RoundedBoxGeometry(0.09, 0.42, 3.0, 2, 0.03), brass);
    skirt.position.set(sx * 0.72, 0.55, 0.45);
    if (shadows) skirt.castShadow = true;
    body.add(skirt);
  }

  // ==========================================================================
  // NEON ARENA RING
  // ==========================================================================
  const arena = new THREE.Group();
  const neon = new THREE.Mesh(new THREE.TorusGeometry(2.5, 0.04, 12, 96), makeEmissive(NEON_AMBER, 2.0));
  neon.rotation.x = -Math.PI / 2;
  neon.position.set(0, 0.03, 0.1);
  neon.scale.set(1, 1.24, 1);
  arena.add(neon);
  const glowDisc = makeGlowSprite(NEON_AMBER, 4.8, 0.1);
  glowDisc.position.set(0, 0.05, 0.1);
  arena.add(glowDisc);
  root.add(arena);
  nodes.arena = arena;

  // ==========================================================================
  // EXHAUST SMOKE + tyre dust pools
  // ==========================================================================
  interface Puff {
    sprite: THREE.Sprite;
    life: number;
    ttl: number;
    vel: THREE.Vector3;
    seed: number;
  }
  const rand = mulberry32(0x7a3c19);
  const smokeBaseMat = new THREE.SpriteMaterial({ map: smokeTexture(), color: 0x8f8f92, transparent: true, opacity: 0, depthWrite: false });
  const puffs: Puff[] = [];
  for (let i = 0; i < 26; i++) {
    const sprite = new THREE.Sprite(smokeBaseMat.clone());
    sprite.scale.setScalar(0.2);
    root.add(sprite);
    puffs.push({ sprite, life: rand(), ttl: 1.6 + rand() * 1.2, vel: new THREE.Vector3(), seed: rand() * 100 });
  }
  const dust: Puff[] = [];
  for (let i = 0; i < 10; i++) {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTexture(), color: 0x5d564c, transparent: true, opacity: 0, depthWrite: false }));
    sprite.scale.setScalar(0.15);
    root.add(sprite);
    dust.push({ sprite, life: rand(), ttl: 0.8 + rand() * 0.6, vel: new THREE.Vector3(), seed: rand() * 100 });
  }

  root.scale.setScalar(scale);

  // ==========================================================================
  // ANIMATION
  // ==========================================================================
  const tmpV = new THREE.Vector3();
  const originLocal = new THREE.Vector3(0.6, 0.62, -1.24);

  const respawn = (p: Puff, base: THREE.Vector3, spread: number, up: number, back: number): void => {
    p.life = 0;
    p.ttl = 1.6 + Math.sin(p.seed) * 0.4 + 0.8;
    p.sprite.position.copy(base);
    p.sprite.position.x += (Math.sin(p.seed * 3.1) - 0.5) * spread;
    p.sprite.position.z += (Math.cos(p.seed * 1.7) - 0.5) * spread;
    p.vel.set((Math.sin(p.seed * 5.0) - 0.5) * 0.2, up, back);
  };

  const tick = (dt: number, elapsed: number): void => {
    const d = Math.min(dt, 0.05);

    const wheelSpin = d * 3.4;
    for (let i = 0; i < wheels.length; i++) {
      const w = wheels[i];
      w.group.rotation.x -= wheelSpin;
      const pulse = 3.0 + Math.sin(elapsed * 4 + i) * 0.8;
      w.hubMat.emissiveIntensity = pulse;
      w.coreMat.emissiveIntensity = pulse * 1.25;
      const hs = 1 + Math.sin(elapsed * 6 + i) * 0.1;
      w.halo.scale.setScalar(wheelRadius * 0.95 * hs);
      (w.halo.material as THREE.SpriteMaterial).opacity = 0.55 + Math.sin(elapsed * 4 + i) * 0.2;
    }

    body.position.y = Math.sin(elapsed * 8) * 0.01;
    body.rotation.x = Math.sin(elapsed * 2.3) * 0.003;

    const sweep = (elapsed * 0.9) % (blades.length + 1.5);
    for (let i = 0; i < blades.length; i++) {
      const g = Math.max(0, 1 - Math.abs(sweep - i) * 1.4);
      (blades[i].material as THREE.MeshStandardMaterial).emissiveIntensity = g * g * 1.0;
      (bladeTips[i].material as THREE.SpriteMaterial).opacity = g * g;
      bladeTips[i].scale.setScalar(0.14 + g * 0.14);
    }

    root.getWorldPosition(tmpV);
    const base = originLocal.clone().multiplyScalar(scale).add(tmpV);
    for (const p of puffs) {
      p.life += d;
      if (p.life >= p.ttl) {
        respawn(p, base, 0.1 * scale, 0.5 * scale, -0.22 * scale);
        continue;
      }
      const f = p.life / p.ttl;
      p.vel.y += d * 0.15 * scale;
      p.vel.x += Math.sin(elapsed * 2 + p.seed) * d * 0.14 * scale;
      p.sprite.position.addScaledVector(p.vel, d);
      (p.sprite.material as THREE.SpriteMaterial).opacity = Math.sin(f * Math.PI) * 0.42;
      p.sprite.scale.setScalar((0.16 + f * 0.65) * scale);
    }

    const dustBase = new THREE.Vector3(0.5 * scale, 0.1 * scale, 1.85 * scale).add(tmpV);
    for (const p of dust) {
      p.life += d;
      if (p.life >= p.ttl) {
        p.life = 0;
        p.ttl = 0.8 + Math.sin(p.seed) * 0.3;
        p.sprite.position.copy(dustBase);
        p.sprite.position.x += (Math.sin(p.seed * 3) - 0.5) * 1.6 * scale;
        p.vel.set((Math.sin(p.seed * 2) - 0.5) * 0.15, 0.1 * scale, 0.1 * scale);
        continue;
      }
      const f = p.life / p.ttl;
      p.sprite.position.addScaledVector(p.vel, d);
      (p.sprite.material as THREE.SpriteMaterial).opacity = Math.sin(f * Math.PI) * 0.22;
      p.sprite.scale.setScalar((0.12 + f * 0.4) * scale);
    }

    (neon.material as THREE.MeshStandardMaterial).emissiveIntensity = 1.8 + Math.sin(elapsed * 1.6) * 0.3;
  };

  root.userData.tick = tick;
  root.userData.sculptRuntime = {
    nodes,
    sockets,
    materials: { brass, humpMat, brassBright, steel, rubber, darkMetal, glass },
    animation: { setWheelSpeed: (_v: number) => {} },
    destructionGroups: ['cab', 'rear-hump', 'plow', 'wheels', 'blades'],
  };

  return root;
}

// ---------------------------------------------------------------------------
// look-dev lighting — moody, high-contrast (matches the cinematic concept sheet)
// ---------------------------------------------------------------------------
export function createWarHaulerLookDevLights(): THREE.Group {
  const lights = new THREE.Group();
  lights.name = 'lookdev-lights';

  // low cool ambient so shadows stay deep
  const hemi = new THREE.HemisphereLight(0x8fa6c8, 0x0a0c10, 0.35);
  lights.add(hemi);

  // strong warm key from upper-front-left
  const key = new THREE.DirectionalLight(0xffdca6, 3.1);
  key.position.set(-5.5, 7, -5);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 32;
  const kc = key.shadow.camera as THREE.OrthographicCamera;
  kc.left = -5;
  kc.right = 5;
  kc.top = 5;
  kc.bottom = -5;
  key.shadow.bias = -0.0004;
  lights.add(key);

  // teal rim from the right-back (the sheet's signature cool edge light) — kept off the hubs
  const rim = new THREE.DirectionalLight(0x38e0d0, 1.05);
  rim.position.set(6.5, 3.2, 5);
  lights.add(rim);

  // weak cool fill
  const fill = new THREE.DirectionalLight(0x6f86b8, 0.28);
  fill.position.set(3, 3, -4);
  lights.add(fill);

  // warm accent to catch the steel blades / front breach
  const accent = new THREE.PointLight(0xffc294, 14, 9, 2);
  accent.position.set(0, 1.3, -3.4);
  lights.add(accent);

  // teal underglow accent (low + short range so it lights the underbody, not the wheel faces)
  const tealUnder = new THREE.PointLight(TEAL, 3.2, 4, 2);
  tealUnder.position.set(-1.2, 0.2, 1.6);
  lights.add(tealUnder);

  // red bounce from the reactor hubs
  const redBounce = new THREE.PointLight(RED_HOT, 5, 5, 2);
  redBounce.position.set(1.2, 0.5, 0.5);
  lights.add(redBounce);

  return lights;
}
