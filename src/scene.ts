import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

export interface ViewerOptions {
  /** Install per-demo lights into the scene. Falls back to a neutral studio rig. */
  installLights?: (scene: THREE.Scene) => void;
  cameraPosition?: [number, number, number];
  cameraTarget?: [number, number, number];
  cameraFov?: number;
  background?: number;
  /** Radial gradient backdrop (inner→outer hex) — a premium themed stage for hero props. */
  backgroundGradient?: { inner: string; outer: string };
  /** Tone-mapping operator (default 'aces'). 'agx' preserves saturated reds/crimson that ACES
   * desaturates toward pink/brown (critical for a Ruby-Doppler blade); 'neutral' scales linearly. */
  toneMapping?: 'aces' | 'agx' | 'neutral';
  /** Tone-mapping exposure (default 1.0). <1 darkens the whole render for a moody look. */
  exposure?: number;
  /** Scene environment (IBL) intensity (default 1.0). <1 cuts ambient fill. */
  environmentIntensity?: number;
  /**
   * Headless-evaluation capture mode (default false). When true the viewer renders on a flat
   * white studio background (to match reference-photo framing), skips the contact-shadow ground,
   * and freezes the camera (no orbit damping) so a deterministic PNG can be captured for the
   * Divine Eye reference loop. Does NOT change the object's own appearance — capture-only.
   */
  capture?: boolean;
}

/** Build a radial-gradient backdrop as a CanvasTexture (colorSpace = SRGB for a colour bg). */
function makeGradientBackground(inner: string, outer: string): THREE.CanvasTexture {
  const size = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size * 0.5, size * 0.42, size * 0.05, size * 0.5, size * 0.5, size * 0.72);
  g.addColorStop(0, inner);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Reusable Three.js viewer: renderer, camera, OrbitControls, PMREM environment,
 * a contact-shadow ground plane, resize handling, and a render loop.
 * Call dispose() before mounting a different demo to free GPU resources.
 */
export class Viewer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;

  private readonly mount: HTMLElement;
  private rafHandle = 0;
  private readonly onResize: () => void;
  private readonly capture: boolean;

  constructor(mount: HTMLElement, options: ViewerOptions = {}) {
    this.mount = mount;

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = options.toneMapping === 'agx'
      ? THREE.AgXToneMapping
      : options.toneMapping === 'neutral'
        ? THREE.NeutralToneMapping
        : THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = options.exposure ?? 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    mount.appendChild(this.renderer.domElement);

    this.capture = options.capture ?? false;

    this.scene = new THREE.Scene();
    if (this.capture) {
      // Flat white studio bg matches the reference photos (white-bg) → fair silhouette IoU.
      this.scene.background = new THREE.Color(0xffffff);
    } else if (options.backgroundGradient) {
      this.scene.background = makeGradientBackground(
        options.backgroundGradient.inner,
        options.backgroundGradient.outer,
      );
    } else {
      this.scene.background = new THREE.Color(options.background ?? 0x1b1d24);
    }

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = options.environmentIntensity ?? 1.0;
    pmrem.dispose();

    this.camera = new THREE.PerspectiveCamera(options.cameraFov ?? 36, 1, 0.1, 100);
    const [px, py, pz] = options.cameraPosition ?? [1.6, 1.1, 2.4];
    this.camera.position.set(px, py, pz);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    // Freeze the camera in capture mode so evaluation renders are deterministic.
    this.controls.enableDamping = !this.capture;
    this.controls.enabled = !this.capture;
    const [tx, ty, tz] = options.cameraTarget ?? [0, 0, 0];
    this.controls.target.set(tx, ty, tz);
    this.controls.update();

    if (options.installLights) {
      options.installLights(this.scene);
    } else {
      installDefaultStudioLights(this.scene);
    }

    // Skip the contact-shadow ground in capture mode: the reference photos have no cast shadow,
    // and a shadow blob on the white bg would pollute the silhouette IoU.
    if (!this.capture) {
      const ground = new THREE.Mesh(
        new THREE.PlaneGeometry(30, 30),
        new THREE.ShadowMaterial({ opacity: 0.16 }),
      );
      ground.rotation.x = -Math.PI / 2;
      ground.receiveShadow = true;
      this.scene.add(ground);
    }

    this.onResize = () => this.handleResize();
    window.addEventListener('resize', this.onResize);
    this.handleResize();
  }

  private handleResize(): void {
    const width = this.mount.clientWidth || window.innerWidth;
    const height = this.mount.clientHeight || window.innerHeight;
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  start(): void {
    const clock = new THREE.Clock();
    // Collect per-frame updaters exposed by demos via `object.userData.tick`.
    const tickers: Array<(dt: number, elapsed: number) => void> = [];
    this.scene.traverse((object) => {
      const tick = (object.userData as { tick?: unknown }).tick;
      if (typeof tick === 'function') {
        tickers.push(tick as (dt: number, elapsed: number) => void);
      }
    });

    const loop = (): void => {
      this.rafHandle = requestAnimationFrame(loop);
      const dt = clock.getDelta();
      const elapsed = clock.getElapsedTime();
      for (const tick of tickers) tick(dt, elapsed);
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    };
    loop();

    // Headless-evaluation ready-signal: wait for async texture loads (DefaultLoadingManager),
    // then a few frames so shaders compile + buffers flip, then flag the page as capture-ready.
    // Fixes the load-race that produced false "chrome"/white renders. No-op for normal viewing
    // beyond setting a window flag. See grimoire/feedback/render_capture.md.
    const w = window as unknown as { __IMG2THREEJS_READY__?: boolean };
    w.__IMG2THREEJS_READY__ = false;
    let signalled = false;
    const signalReady = (): void => {
      if (signalled) return;
      signalled = true;
      let framesToWait = 6;
      const pump = (): void => {
        if (framesToWait-- > 0) {
          requestAnimationFrame(pump);
          return;
        }
        w.__IMG2THREEJS_READY__ = true;
      };
      pump();
    };
    THREE.DefaultLoadingManager.onLoad = signalReady;
    // Fallback: if no async loads are pending, onLoad never fires → kick after a short delay.
    setTimeout(signalReady, 600);
  }

  /**
   * Capture-mode auto-framing: place the camera side-on (looking down +Z at the model's
   * bounding-box centre) at a distance that fits the object, matching a side-on reference plate.
   * Call AFTER the demo's build() so the model exists. Near-ortho fov reduces perspective skew.
   */
  frameForCapture(fovDeg = 20, margin = 1.12): void {
    const box = new THREE.Box3();
    this.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh && mesh.geometry) box.expandByObject(mesh);
    });
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    this.camera.fov = fovDeg;
    const vFov = (fovDeg * Math.PI) / 180;
    const halfH = size.y / 2;
    const halfW = size.x / 2;
    const aspect = this.camera.aspect || 1;
    const distH = halfH / Math.tan(vFov / 2);
    const distW = halfW / Math.tan(vFov / 2) / aspect;
    const dist = Math.max(distH, distW) * margin + size.z / 2;
    this.camera.position.set(center.x, center.y, center.z + dist);
    this.camera.near = Math.max(0.01, dist - size.z);
    this.camera.far = dist + size.z * 4;
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(center);
    this.controls.target.copy(center);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  /** Frees renderer/GPU resources. Call this before swapping to a new demo. */
  dispose(): void {
    cancelAnimationFrame(this.rafHandle);
    window.removeEventListener('resize', this.onResize);
    this.controls.dispose();

    this.scene.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (mesh.geometry) {
        mesh.geometry.dispose();
      }
      const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (material) {
        const materials = Array.isArray(material) ? material : [material];
        for (const mat of materials) {
          disposeMaterialTextures(mat);
          mat.dispose();
        }
      }
    });

    this.renderer.dispose();
    if (this.renderer.domElement.parentElement === this.mount) {
      this.mount.removeChild(this.renderer.domElement);
    }
  }
}

function disposeMaterialTextures(material: THREE.Material): void {
  const record = material as unknown as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    const value = record[key];
    if (value instanceof THREE.Texture) {
      value.dispose();
    }
  }
}

function installDefaultStudioLights(scene: THREE.Scene): void {
  const key = new THREE.DirectionalLight(0xfff6e8, 2.2);
  key.position.set(-2.4, 3.2, 2.4);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 12;
  key.shadow.bias = -0.0004;
  scene.add(key);

  const fill = new THREE.DirectionalLight(0x9fb4ff, 0.35);
  fill.position.set(2.8, 0.8, 1.6);
  scene.add(fill);

  const hemi = new THREE.HemisphereLight(0xbfd0ff, 0x20263a, 0.35);
  scene.add(hemi);
}
