import { demos } from '../demos/registry';

const GITHUB_URL = 'https://github.com/hoainho/img2threejs';

export function renderHome(mount: HTMLElement): void {
  const cards = demos
    .map(
      (demo) => `
      <a class="card" href="#/demo/${demo.id}">
        <img class="card-thumb" src="${demo.referenceImage}" alt="${demo.title} reference" loading="lazy" />
        <div class="card-body">
          <div class="card-title">${demo.title}</div>
          <div class="badges">
            <span class="badge badge-${demo.subjectClass}">${demo.subjectClass}</span>
            <span class="badge">${demo.generatedWith}</span>
          </div>
        </div>
      </a>`,
    )
    .join('');

  mount.innerHTML = `
    <div class="home">
      <div class="hero">
        <span class="hero-eyebrow">img2threejs &middot; live demo gallery &middot; v1.2</span>
        <h1>img2threejs &mdash; Live Demo Gallery</h1>
        <p>
          Feed img2threejs a single object or character photo and it rebuilds the subject as a
          quality-gated, animation-ready procedural Three.js model &mdash; code only, no imported meshes.
        </p>
        <div class="cta-row">
          <a class="btn btn-star" href="${GITHUB_URL}" target="_blank" rel="noopener noreferrer">
            &#9733; Star img2threejs on GitHub
          </a>
        </div>
      </div>
      <div class="grid">
        ${cards}
      </div>
      <div class="footer">
        source &middot; <a href="${GITHUB_URL}" target="_blank" rel="noopener noreferrer">github.com/hoainho/img2threejs</a>
      </div>
    </div>
  `;
}
