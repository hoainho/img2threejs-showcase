/**
 * M9 Bayonet | Doppler Phase 2
 *
 * Ported from the img2threejs pipeline build (skill `builds/m9-doppler`). Unlike the earlier
 * fully-procedural version, this uses the pipeline's actual output:
 *   - geometry: the traced `geo.json` (exact silhouette: sawteeth, thumb-hole, wedge blade),
 *   - blade/handle albedo: projected reference crops served from `public/m9-doppler/`,
 *   - grip knurl + guard steel: procedural canvas maps.
 *
 * The heavy model code lives verbatim in `./m9-bayonet.js` (the proven generated build); this
 * module only adapts it to the showcase's DemoEntry contract (loads geo, wires the light rig
 * and background).
 */
import * as THREE from 'three';
import geo from './geo.json';
import { createM9BayonetModel } from './m9-bayonet.js';

export interface M9DopplerOptions {
  /** Cast/receive shadows on every part (default true). */
  shadows?: boolean;
}

export function createM9DopplerModel(options: M9DopplerOptions = {}): THREE.Group {
  const shadows = options.shadows ?? true;
  return createM9BayonetModel({ geo, castShadow: shadows, receiveShadow: shadows });
}

/**
 * Three-point studio rig + contact-shadow ground, ported from the build's standalone harness.
 * Routed through DemoEntry.installLights so the Viewer skips its default rig (no double-lighting).
 */
export function createM9DopplerLookDevLights(): THREE.Group {
  const g = new THREE.Group();

  const key = new THREE.DirectionalLight(0xfff4e0, 2.6);
  key.position.set(-2, 4, 3);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 20;
  key.shadow.camera.left = -3;
  key.shadow.camera.right = 3;
  key.shadow.camera.top = 3;
  key.shadow.camera.bottom = -3;
  key.shadow.bias = -0.0004;

  const fill = new THREE.DirectionalLight(0xbcd0ff, 0.8);
  fill.position.set(3, 1, 2.5);

  const rim = new THREE.DirectionalLight(0x8fb6ff, 1.6);
  rim.position.set(1, -1.5, -4);

  g.add(key, fill, rim, new THREE.AmbientLight(0x223344, 0.4));

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(20, 20),
    new THREE.ShadowMaterial({ opacity: 0.4 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.45;
  ground.receiveShadow = true;
  g.add(ground);

  return g;
}

/**
 * Near-black radial studio backdrop for THIS demo only (set by build() on the scene, which runs
 * after the Viewer's constructor so it wins). Dark edges + a faint centre lift make the Doppler
 * blade pop. Self-contained here — no shared registry theming.
 */
export function makeM9DopplerBackground(): THREE.CanvasTexture {
  const size = 512;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const c = cv.getContext('2d')!;
  const grad = c.createRadialGradient(
    size * 0.5, size * 0.46, size * 0.04,
    size * 0.5, size * 0.5, size * 0.72,
  );
  grad.addColorStop(0, '#0e1220'); // faint centre lift behind the blade
  grad.addColorStop(1, '#020305'); // near-black edges
  c.fillStyle = grad;
  c.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
