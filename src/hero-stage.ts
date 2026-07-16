import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import type { DemoEntry } from './demos/registry';

const CYCLE_MS = 5200; // time each demo stays on the turntable
const MATERIALIZE_S = 1.05; // entry animation length

/**
 * Cinematic hero turntable: builds each demo in turn, orbits a camera around it
 * with bloom + a drifting particle field, and materializes the model on entry.
 * Calls `onDemo` whenever the active demo changes so the page can crossfade the
 * matching source photo (the image -> 3D story).
 */
export class HeroStage {
  private readonly mount: HTMLElement;
  private readonly demos: DemoEntry[];
  private readonly onDemo: (demo: DemoEntry, index: number) => void;

  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly composer: EffectComposer;
  private readonly clock = new THREE.Clock();
  private readonly ro: ResizeObserver;

  private readonly target = new THREE.Vector3();
  private orbitRadius = 3;
  private orbitAngle = 0;
  private orbitHeight = 1;

  private activeObjects: THREE.Object3D[] = [];
  private index = -1;
  private elapsed = 0;
  private entryStart = 0;
  private sinceSwap = 0;
  private rafHandle = 0;
  private disposed = false;
  private readonly reduceMotion: boolean;

  constructor(
    mount: HTMLElement,
    demos: DemoEntry[],
    onDemo: (demo: DemoEntry, index: number) => void,
  ) {
    this.mount = mount;
    this.demos = demos;
    this.onDemo = onDemo;
    this.reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    mount.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';

    this.scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    this.camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);

    this.scene.add(this.buildParticles());

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.composer.addPass(
      new UnrealBloomPass(new THREE.Vector2(1, 1), 0.55, 0.5, 0.82),
    );
    this.composer.addPass(new OutputPass());

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(mount);
    this.resize();
  }

  private buildParticles(): THREE.Points {
    const count = 340;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 12;
      positions[i * 3 + 1] = Math.random() * 8 - 1.5;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 12;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.4, 'rgba(150,200,255,0.55)');
    g.addColorStop(1, 'rgba(150,200,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    const sprite = new THREE.CanvasTexture(canvas);
    sprite.colorSpace = THREE.SRGBColorSpace;

    const mat = new THREE.PointsMaterial({
      size: 0.09,
      map: sprite,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      opacity: 0.7,
    });
    const points = new THREE.Points(geo, mat);
    points.name = '__particles';
    points.renderOrder = -1;
    return points;
  }

  private resize(): void {
    const w = this.mount.clientWidth || 1;
    const h = this.mount.clientHeight || 1;
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
  }

  private clearActive(): void {
    for (const obj of this.activeObjects) {
      this.scene.remove(obj);
      obj.traverse((node) => {
        const mesh = node as THREE.Mesh;
        mesh.geometry?.dispose();
        const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (!material) return;
        for (const mat of Array.isArray(material) ? material : [material]) mat.dispose();
      });
    }
    this.activeObjects = [];
  }

  private showDemo(index: number): void {
    this.clearActive();
    const demo = this.demos[index];
    const before = new Set(this.scene.children);
    demo.build(this.scene);
    // Some demos set an opaque scene.background; keep the hero canvas transparent
    // so the CSS aurora shows through.
    this.scene.background = null;
    this.activeObjects = this.scene.children.filter((c) => !before.has(c));

    const [tx, ty, tz] = demo.cameraTarget;
    const [px, py, pz] = demo.cameraPosition;
    this.target.set(tx, ty, tz);
    const dx = px - tx;
    const dz = pz - tz;
    this.orbitRadius = Math.hypot(dx, dz);
    this.orbitAngle = Math.atan2(dz, dx);
    this.orbitHeight = py - ty;
    this.camera.fov = demo.cameraFov;
    this.camera.updateProjectionMatrix();

    this.entryStart = this.elapsed;
    this.index = index;
    this.onDemo(demo, index);
  }

  private next(): void {
    this.showDemo((this.index + 1) % this.demos.length);
  }

  start(): void {
    if (this.demos.length === 0) return;
    this.showDemo(0);
    const loop = (): void => {
      if (this.disposed) return;
      this.rafHandle = requestAnimationFrame(loop);
      const dt = Math.min(0.05, this.clock.getDelta());
      this.elapsed += dt;
      const elapsed = this.elapsed;

      // turntable orbit
      if (!this.reduceMotion) this.orbitAngle += dt * 0.32;
      this.camera.position.set(
        this.target.x + this.orbitRadius * Math.cos(this.orbitAngle),
        this.target.y + this.orbitHeight,
        this.target.z + this.orbitRadius * Math.sin(this.orbitAngle),
      );
      this.camera.lookAt(this.target);

      // materialize entry: scale-up + settle
      const t = Math.min(1, (elapsed - this.entryStart) / MATERIALIZE_S);
      const eased = 1 - Math.pow(1 - t, 3);
      const scale = 0.82 + 0.18 * eased;
      const model = this.activeObjects[0];
      if (model) {
        model.scale.setScalar(scale);
        model.position.y = (1 - eased) * 0.25;
      }

      // drift particles upward, wrap around
      const particles = this.scene.getObjectByName('__particles') as THREE.Points | null;
      if (particles && !this.reduceMotion) {
        const pos = particles.geometry.getAttribute('position') as THREE.BufferAttribute;
        for (let i = 0; i < pos.count; i++) {
          let y = pos.getY(i) + dt * 0.35;
          if (y > 6.5) y = -1.5;
          pos.setY(i, y);
        }
        pos.needsUpdate = true;
        particles.rotation.y = elapsed * 0.02;
      }

      // advance to the next demo
      this.sinceSwap += dt * 1000;
      if (this.sinceSwap >= CYCLE_MS) {
        this.sinceSwap = 0;
        this.next();
      }

      this.composer.render();
    };
    loop();
  }

  /** Jump to a specific demo (e.g. when the user hovers a card). */
  focus(index: number): void {
    if (index < 0 || index >= this.demos.length || index === this.index) return;
    this.sinceSwap = 0;
    this.showDemo(index);
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.rafHandle);
    this.ro.disconnect();
    this.clearActive();
    this.scene.traverse((node) => {
      const mesh = node as THREE.Mesh;
      mesh.geometry?.dispose();
      const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (material) for (const mat of Array.isArray(material) ? material : [material]) mat.dispose();
    });
    this.composer.dispose();
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement === this.mount) {
      this.mount.removeChild(this.renderer.domElement);
    }
  }
}
