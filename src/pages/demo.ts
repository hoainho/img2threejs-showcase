import * as THREE from 'three';
import { getDemo } from '../demos/registry';
import { Viewer } from '../scene';
import { navigate } from '../router';

const GITHUB_URL = 'https://github.com/hoainho/img2threejs';

/**
 * Renders the full-viewport demo viewer + info panel for `id`.
 * Returns a cleanup function the router must call before switching routes.
 * If `id` is unknown, redirects to home and returns a no-op cleanup.
 */
export function renderDemo(mount: HTMLElement, id: string): () => void {
  const demo = getDemo(id);
  if (!demo) {
    navigate('#/');
    return () => {};
  }

  mount.innerHTML = `
    <div class="demo-page">
      <div class="demo-canvas-mount" id="demo-canvas-mount"></div>
      <div class="demo-panel">
        <a class="back-link" href="#/"><span class="back-arrow">&larr;</span> Back to gallery</a>
        <header class="demo-panel-head">
          <span class="demo-kicker">img2threejs · reconstruction</span>
          <h2>${demo.title}</h2>
          <p class="demo-author">by
            <a href="${demo.authorUrl}" target="_blank" rel="noopener noreferrer">${demo.author}</a>
          </p>
        </header>
        <figure class="demo-ref">
          <img class="demo-ref-thumb" src="${demo.referenceImage}" alt="${demo.title} reference" />
          <figcaption>source reference</figcaption>
        </figure>
        <div class="demo-meta">
          <div class="badges">
            <span class="badge badge-${demo.subjectClass}">${demo.subjectClass}</span>
            <span class="badge">${demo.generatedWith}</span>
            <span class="badge badge-status status-${demo.status}">${demo.status}</span>
          </div>
          <p>${demo.blurb}</p>
        </div>
        <div class="demo-links">
          <a class="btn" href="${demo.sourceUrl}" target="_blank" rel="noopener noreferrer">
            &lt;/&gt; View generated source
          </a>
          <a class="btn btn-star" href="${GITHUB_URL}" target="_blank" rel="noopener noreferrer">
            &#9733; Star img2threejs on GitHub
          </a>
        </div>
      </div>
      <div class="hint"><span class="hint-glyph">&#8635;</span> drag to orbit &middot; scroll to zoom</div>
    </div>
  `;

  // Per-demo theming: tint the panel accent to the object's signature colour.
  if (demo.accent) {
    const page = mount.querySelector<HTMLElement>('.demo-page');
    page?.style.setProperty('--accent', demo.accent);
    page?.style.setProperty('--accent-strong', demo.accent);
    page?.classList.add('demo-themed');
  }

  // Headless-evaluation capture mode: `#/demo/<id>?capture=1` renders on a flat white studio
  // background with a frozen camera for the Divine Eye reference loop. Default off (normal viewing).
  const capture = /[?&]capture=1\b/.test(window.location.hash) ||
    new URLSearchParams(window.location.search).get('capture') === '1';

  // Per-demo tone-mapping (optional on the entry; read structurally so demo.ts is independent of
  // the DemoEntry field being declared). AgX preserves the Ruby-Doppler crimson that ACES washes.
  const toneMapping = (demo as { toneMapping?: 'aces' | 'agx' | 'neutral' }).toneMapping;

  const canvasMount = mount.querySelector<HTMLDivElement>('#demo-canvas-mount')!;
  const viewer = new Viewer(canvasMount, {
    cameraPosition: demo.cameraPosition,
    cameraTarget: demo.cameraTarget,
    cameraFov: demo.cameraFov,
    backgroundGradient: demo.backgroundGradient,
    exposure: demo.exposure,
    environmentIntensity: demo.environmentIntensity,
    installLights: demo.installLights,
    toneMapping,
    capture,
  });

  demo.build(viewer.scene);
  if (capture) {
    // Flat white bg + hide the UI overlay + freeze per-frame animation so the evaluation
    // frame is deterministic and shows only the object (matches the reference plate).
    viewer.scene.background = new THREE.Color(0xffffff);
    viewer.scene.traverse((o) => {
      if ((o.userData as { tick?: unknown }).tick) delete (o.userData as { tick?: unknown }).tick;
    });
    for (const sel of ['.demo-panel', '.hint', '.back-link']) {
      mount.querySelector<HTMLElement>(sel)?.style.setProperty('display', 'none');
    }
    // Side-on auto-framing so the evaluation silhouette matches the side-on reference plate.
    viewer.frameForCapture();
  }
  viewer.start();

  return () => viewer.dispose();
}
