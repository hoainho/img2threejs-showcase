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

  constructor(mount: HTMLElement, options: ViewerOptions = {}) {
    this.mount = mount;

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    mount.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(options.background ?? 0xf5f4ee);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    this.camera = new THREE.PerspectiveCamera(options.cameraFov ?? 36, 1, 0.1, 100);
    const [px, py, pz] = options.cameraPosition ?? [1.6, 1.1, 2.4];
    this.camera.position.set(px, py, pz);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    const [tx, ty, tz] = options.cameraTarget ?? [0, 0, 0];
    this.controls.target.set(tx, ty, tz);
    this.controls.update();

    if (options.installLights) {
      options.installLights(this.scene);
    } else {
      installDefaultStudioLights(this.scene);
    }

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(30, 30),
      new THREE.ShadowMaterial({ opacity: 0.3 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

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
