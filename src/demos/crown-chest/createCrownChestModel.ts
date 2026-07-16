import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

/**
 * Procedural Crown Chest loot-box, rebuilt in code from a single 3/4 reference image.
 * Faithful to: chunky rounded-bevel lid+body, purple->blue->teal glossy enamel gradient,
 * 8 gold corner brackets, gold front latch, gold D-ring side handle, emissive crown emblem.
 *
 * Action-ready: exposes root.userData.sculptRuntime with named nodes + sockets.
 */

export interface CrownChestOptions {
  /** total world width of the body (default 1.0) */
  scale?: number;
}

// ---- palette (sampled from the reference) ----
const GOLD = 0xf4c531;
const GRADIENT_STOPS = [
  { t: 0.0, c: 0x159c86 }, // bottom: green
  { t: 0.3, c: 0x1c7fa6 }, // teal
  { t: 0.55, c: 0x1f3fa0 }, // royal blue
  { t: 0.8, c: 0x4a2e9e }, // purple
  { t: 1.0, c: 0x7a2ca6 }, // top: magenta
];

// Overall chest extents (object space), used to map the world-height gradient.
const CHEST_MIN_Y = -0.5;
const CHEST_MAX_Y = 0.42;

/** Glossy enamel with an object-height purple->blue->teal gradient + clearcoat. */
function makeEnamelMaterial(): THREE.MeshPhysicalMaterial {
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    roughness: 0.2,
    metalness: 0.0,
    clearcoat: 0.85,
    clearcoatRoughness: 0.1,
    envMapIntensity: 0.4, // keep the gradient saturated instead of veiling it white
  });

  const stops = GRADIENT_STOPS.map((s) => {
    const col = new THREE.Color(s.c).convertSRGBToLinear();
    return { t: s.t, r: col.r, g: col.g, b: col.b };
  });

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uMinY = { value: CHEST_MIN_Y };
    shader.uniforms.uMaxY = { value: CHEST_MAX_Y };

    // pass the object's world-space Y to the fragment shader
    shader.vertexShader =
      'varying float vGradY;\n' +
      shader.vertexShader.replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
         vec4 _wp = modelMatrix * vec4( transformed, 1.0 );
         vGradY = _wp.y;`,
      );

    // build the ramp mix in the fragment shader
    let ramp = 'vec3 gradCol = vec3(' +
      `${stops[0].r.toFixed(4)}, ${stops[0].g.toFixed(4)}, ${stops[0].b.toFixed(4)});\n`;
    for (let i = 1; i < stops.length; i++) {
      const a = stops[i - 1];
      const b = stops[i];
      ramp +=
        `gradCol = mix(gradCol, vec3(${b.r.toFixed(4)}, ${b.g.toFixed(4)}, ${b.b.toFixed(4)}), ` +
        `smoothstep(${a.t.toFixed(4)}, ${b.t.toFixed(4)}, gY));\n`;
    }

    shader.fragmentShader =
      'varying float vGradY;\nuniform float uMinY;\nuniform float uMaxY;\n' +
      shader.fragmentShader.replace(
        '#include <color_fragment>',
        `#include <color_fragment>
         float gY = clamp((vGradY - uMinY) / (uMaxY - uMinY), 0.0, 1.0);
         ${ramp}
         diffuseColor.rgb *= gradCol;`,
      );
  };
  mat.customProgramCacheKey = () => 'crown-chest-enamel-gradient-v1';
  return mat;
}

function makeGoldMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: GOLD,
    metalness: 1.0,
    roughness: 0.26,
  });
}

function makeCrownPanelMaterial(): THREE.MeshStandardMaterial {
  // warm YELLOW glowing plate (the reference halo colour) — controlled, not white-hot
  return new THREE.MeshStandardMaterial({
    color: 0xcaa015,
    emissive: 0xffbc2e,
    emissiveIntensity: 0.62,
    roughness: 0.6,
    metalness: 0.0,
  });
}

function makeCrownGlyphMaterial(): THREE.MeshStandardMaterial {
  // golden glowing crown with a warm-white core (matches the reference emblem)
  return new THREE.MeshStandardMaterial({
    color: 0xffe6a0,
    emissive: 0xffcf55,
    emissiveIntensity: 1.35,
    roughness: 0.5,
    metalness: 0.0,
  });
}

/** A gold corner bracket for the (+,+,+) octant: three thin plates hugging the corner + rivets. */
function makeCornerBracket(gold: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const plate = 0.19; // side length of the square patch
  const thick = 0.035;
  const inset = 0.012; // sit just proud of the surface

  const mkPlate = (
    w: number, h: number, d: number, pos: [number, number, number],
  ) => {
    const geo = new RoundedBoxGeometry(w, h, d, 3, 0.02);
    const m = new THREE.Mesh(geo, gold);
    m.position.set(...pos);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  };

  // plate on +X face, +Y face, +Z face, all meeting at the corner
  g.add(mkPlate(thick, plate, plate, [inset, -plate / 2, -plate / 2]));
  g.add(mkPlate(plate, thick, plate, [-plate / 2, inset, -plate / 2]));
  g.add(mkPlate(plate, plate, thick, [-plate / 2, -plate / 2, inset]));

  // rivet studs
  const rivetGeo = new THREE.SphereGeometry(0.018, 12, 10);
  const rivetPos: [number, number, number][] = [
    [inset + thick / 2, -0.04, -0.04],
    [inset + thick / 2, -0.14, -0.14],
    [-0.04, -0.04, inset + thick / 2],
    [-0.14, -0.14, inset + thick / 2],
  ];
  for (const p of rivetPos) {
    const r = new THREE.Mesh(rivetGeo, gold);
    r.scale.set(1, 1, 0.6);
    r.position.set(...p);
    g.add(r);
  }
  return g;
}

/** 3-peak crown glyph as an extruded shape (brightest emissive element). */
function makeCrownShape(): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(-0.10, -0.055);
  s.lineTo(0.10, -0.055);
  s.lineTo(0.10, 0.045);
  s.lineTo(0.05, -0.005);
  s.lineTo(0.0, 0.07);
  s.lineTo(-0.05, -0.005);
  s.lineTo(-0.10, 0.045);
  s.lineTo(-0.10, -0.055);
  return s;
}

export function createCrownChestModel(options: CrownChestOptions = {}): THREE.Group {
  const scale = options.scale ?? 1.0;
  const root = new THREE.Group();
  root.name = 'crown-chest';

  const enamel = makeEnamelMaterial();
  const gold = makeGoldMaterial();
  const panelMat = makeCrownPanelMaterial();
  const glyphMat = makeCrownGlyphMaterial();

  const nodes: Record<string, THREE.Object3D> = {};
  const sockets: Record<string, THREE.Object3D> = {};

  // ---- body ----
  const bodyGeo = new RoundedBoxGeometry(1.0, 0.6, 0.82, 6, 0.09);
  const body = new THREE.Mesh(bodyGeo, enamel);
  body.name = 'body';
  body.position.y = -0.175;
  body.castShadow = true;
  body.receiveShadow = true;
  root.add(body);
  nodes.body = body;

  // ---- lid (hinged group so it can open later) ----
  const lidHinge = new THREE.Group();
  lidHinge.name = 'lid-hinge';
  lidHinge.position.set(0, 0.06, -0.42); // hinge along the back-top edge
  root.add(lidHinge);
  nodes.lidHinge = lidHinge;
  sockets.lidHinge = lidHinge;

  const lidGeo = new RoundedBoxGeometry(1.02, 0.34, 0.84, 6, 0.09);
  const lid = new THREE.Mesh(lidGeo, enamel);
  lid.name = 'lid';
  lid.position.set(0, 0.175, 0.42); // offset back into place relative to the hinge
  lid.castShadow = true;
  lid.receiveShadow = true;
  lidHinge.add(lid);
  nodes.lid = lid;

  // ---- 8 gold corner brackets ----
  const brackets = new THREE.Group();
  brackets.name = 'corner-brackets';
  root.add(brackets);
  const corners: { pos: [number, number, number]; sx: number; sy: number; sz: number }[] = [
    // top row (on the lid)
    { pos: [0.5, 0.39, 0.41], sx: 1, sy: 1, sz: 1 },
    { pos: [-0.5, 0.39, 0.41], sx: -1, sy: 1, sz: 1 },
    { pos: [0.5, 0.39, -0.41], sx: 1, sy: 1, sz: -1 },
    { pos: [-0.5, 0.39, -0.41], sx: -1, sy: 1, sz: -1 },
    // bottom row (on the body)
    { pos: [0.5, -0.46, 0.41], sx: 1, sy: -1, sz: 1 },
    { pos: [-0.5, -0.46, 0.41], sx: -1, sy: -1, sz: 1 },
    { pos: [0.5, -0.46, -0.41], sx: 1, sy: -1, sz: -1 },
    { pos: [-0.5, -0.46, -0.41], sx: -1, sy: -1, sz: -1 },
  ];
  for (const c of corners) {
    const b = makeCornerBracket(gold);
    b.position.set(...c.pos);
    b.scale.set(c.sx, c.sy, c.sz);
    brackets.add(b);
  }
  nodes.brackets = brackets;

  // ---- gold front latch straddling the lid/body seam ----
  const latch = new THREE.Group();
  latch.name = 'front-latch';
  const latchPlate = new THREE.Mesh(new RoundedBoxGeometry(0.19, 0.15, 0.05, 3, 0.03), gold);
  latch.add(latchPlate);
  const latchBoss = new THREE.Mesh(new RoundedBoxGeometry(0.08, 0.08, 0.05, 3, 0.02), gold);
  latchBoss.position.z = 0.03;
  latch.add(latchBoss);
  latch.position.set(0, 0.12, 0.44);
  root.add(latch);
  nodes.latch = latch;

  // ---- gold D-ring side handle (left face) ----
  const handle = new THREE.Group();
  handle.name = 'side-handle';
  // symmetric half-loop D-ring lying in the Y-Z plane (normal = -X), bowing outward + down
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.026, 16, 40, Math.PI), gold);
  ring.rotation.y = Math.PI / 2; // ring plane parallel to the left face
  ring.rotation.x = Math.PI; // flip the arc so it hangs downward (apex at bottom)
  handle.add(ring);
  // two mount studs at the top ends of the loop
  const pinGeo = new THREE.CylinderGeometry(0.026, 0.026, 0.05, 14);
  for (const pz of [0.12, -0.12]) {
    const pin = new THREE.Mesh(pinGeo, gold);
    pin.rotation.z = Math.PI / 2;
    pin.position.set(0.01, 0, pz);
    handle.add(pin);
  }
  handle.position.set(-0.5, 0.02, 0);
  root.add(handle);
  nodes.handle = handle;
  sockets.handleMount = handle;

  // ---- emissive crown emblem on the front face ----
  const emblem = new THREE.Group();
  emblem.name = 'crown-emblem';
  // dark recessed frame so the glowing panel reads as a crisp rounded-rectangle inset
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x140a2e, roughness: 0.5, metalness: 0.0 });
  const frame = new THREE.Mesh(new RoundedBoxGeometry(0.46, 0.4, 0.035, 4, 0.09), frameMat);
  frame.name = 'crown-frame';
  frame.position.z = -0.01;
  emblem.add(frame);
  // glowing panel (rounded square)
  const panel = new THREE.Mesh(new RoundedBoxGeometry(0.4, 0.34, 0.04, 4, 0.08), panelMat);
  panel.name = 'crown-panel';
  emblem.add(panel);
  // crown glyph extruded proud of the panel, brightest
  const glyphGeo = new THREE.ExtrudeGeometry(makeCrownShape(), {
    depth: 0.03,
    bevelEnabled: true,
    bevelThickness: 0.008,
    bevelSize: 0.008,
    bevelSegments: 2,
  });
  const glyph = new THREE.Mesh(glyphGeo, glyphMat);
  glyph.name = 'crown-glyph';
  glyph.position.set(0, 0.0, 0.035);
  glyph.scale.set(1.3, 1.3, 1);
  emblem.add(glyph);
  // warm point light spilling from the emblem onto nearby gold/enamel (very subtle)
  const glow = new THREE.PointLight(0xffcf6a, 0.12, 0.45, 2.5);
  glow.position.set(0, 0, 0.14);
  emblem.add(glow);
  emblem.position.set(0, -0.13, 0.42);
  root.add(emblem);
  nodes.emblem = emblem;
  sockets.crownEmitter = emblem;

  root.scale.setScalar(scale);

  // ---- action-ready runtime metadata ----
  root.userData.sculptRuntime = {
    nodes,
    sockets,
    materials: { enamel, gold, crownPanel: panelMat, crownGlyph: glyphMat },
    animation: {
      openLid: (t: number) => {
        lidHinge.rotation.x = -t * (Math.PI * 0.42);
      },
    },
    destructionGroups: ['lid', 'body', 'corner-brackets', 'front-latch', 'side-handle', 'crown-emblem'],
  };

  return root;
}
