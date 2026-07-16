import * as THREE from 'three';
import { createCrownChestModel } from './crown-chest/createCrownChestModel';
import {
  createBeachCharacter08Model,
  createBeachCharacter08LookDevLights,
} from './character/createCharacterModel';
import {
  createPortraitBustModel,
  createPortraitBustLookDevLights,
} from './portrait/createPortraitModel';

export interface DemoEntry {
  /** route id, e.g. 'crown-chest' */
  id: string;
  title: string;
  subjectClass: 'object' | 'character';
  /** 1-2 sentences */
  blurb: string;
  referenceImage: string;
  /** repo-relative path shown in UI */
  sourcePath: string;
  sourceUrl: string;
  generatedWith: string;
  status: 'placeholder' | 'final';
  cameraPosition: [number, number, number];
  cameraTarget: [number, number, number];
  cameraFov: number;
  /** Adds the model (and any demo-specific lights) to the scene, returns the group. */
  build: (scene: THREE.Scene) => THREE.Group;
}

const BASE = import.meta.env.BASE_URL;
const REPO = 'https://github.com/hoainho/img2threejs-showcase/blob/main';

export const demos: DemoEntry[] = [
  {
    id: 'crown-chest',
    title: 'Crowned Loot Chest',
    subjectClass: 'object',
    blurb:
      'A chunky rounded-bevel loot chest rebuilt in code from a single 3/4 reference photo: ' +
      'purple-to-teal glossy enamel gradient, eight gold corner brackets, and an emissive crown emblem.',
    referenceImage: `${BASE}references/crown-chest.png`,
    sourcePath: 'src/demos/crown-chest/createCrownChestModel.ts',
    sourceUrl: `${REPO}/src/demos/crown-chest/createCrownChestModel.ts`,
    generatedWith: 'img2threejs v1.2',
    status: 'placeholder',
    cameraPosition: [-0.95, 0.5, 2.55],
    cameraTarget: [0, -0.05, 0],
    cameraFov: 38,
    build: (scene) => {
      const group = createCrownChestModel();
      scene.add(group);
      return group;
    },
  },
  {
    id: 'character',
    title: 'Beach Character (stylized)',
    subjectClass: 'character',
    blurb:
      'A stylized beach-outfit character rebuilt procedurally: oversized jersey, baggy denim shorts, ' +
      'clogs, and a crossbody tote, with deterministic fabric-weave bump maps standing in for cloth detail.',
    referenceImage: `${BASE}references/character.png`,
    sourcePath: 'src/demos/character/createCharacterModel.ts',
    sourceUrl: `${REPO}/src/demos/character/createCharacterModel.ts`,
    generatedWith: 'img2threejs v1.2',
    status: 'placeholder',
    cameraPosition: [2.7, 1.15, 3.25],
    cameraTarget: [0, 0.92, 0],
    cameraFov: 32,
    build: (scene) => {
      const group = createBeachCharacter08Model({ castShadow: true, receiveShadow: true });
      scene.add(group);
      const lights = createBeachCharacter08LookDevLights('neutral');
      scene.add(lights);
      return group;
    },
  },
  {
    id: 'portrait',
    title: 'Portrait Bust (stylized likeness)',
    subjectClass: 'character',
    blurb:
      'A stylized portrait bust reconstructed for likeness from a single photo, with reference-derived ' +
      'material zones and a full key/fill/rim look-dev lighting rig.',
    referenceImage: `${BASE}references/portrait.png`,
    sourcePath: 'src/demos/portrait/createPortraitModel.ts',
    sourceUrl: `${REPO}/src/demos/portrait/createPortraitModel.ts`,
    generatedWith: 'img2threejs v1.2',
    status: 'placeholder',
    cameraPosition: [-0.95, 0.78, 2.05],
    cameraTarget: [0, 0.55, 0],
    cameraFov: 34,
    build: (scene) => {
      const group = createPortraitBustModel();
      scene.add(group);
      const lights = createPortraitBustLookDevLights('neutral');
      scene.add(lights);
      return group;
    },
  },
];

export function getDemo(id: string): DemoEntry | undefined {
  return demos.find((demo) => demo.id === id);
}
