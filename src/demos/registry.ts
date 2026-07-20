import * as THREE from 'three';
import { createCrownChestModel } from './crown-chest/createCrownChestModel';
import {
  createWarHaulerModel,
  createWarHaulerLookDevLights,
} from './warhauler/createWarHaulerModel';
import {
  createDoraemonHouseModel,
  createDoraemonHouseLookDevLights,
  makeSkyTexture,
} from './doraemon-house/createDoraemonHouseModel';
import {
  createGerberKnifeModel,
  createGerberKnifeLookDevLights,
  makeStudioBackground,
} from './gerber-knife/createGerberKnifeModel';
import {
  createIssacaShotgunModel,
  createIssacaShotgunLookDevLights,
  makeIssacaBackground,
} from './issaca-shotgun/createIssacaShotgunModel';
import {
  createSonyWf1000xm3Model,
  createSonyWf1000xm3LookDevLights,
  makeSonyBackground,
} from './sony-wf1000xm3/createSonyWf1000xm3Model';

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
  /** display name of whoever contributed this demo */
  author: string;
  /** link to the author's profile (GitHub, etc.) */
  authorUrl: string;
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
    id: 'sony-wf1000xm3',
    title: 'Sony WF-1000XM3 Earbuds + Case',
    subjectClass: 'object',
    blurb:
      'The Sony WF-1000XM3 true-wireless earbuds and charging case rebuilt in code from a studio ' +
      'reference set, with the focus on colour & linework: a matte-black stadium case, a polished ' +
      'rose-gold/copper lid with an engraved SONY wordmark, a black inner lid framed by a copper ' +
      'rim and carrying the engraved spec plate (WF-1000XM3R / BC-WF1000XM3 / 5V), satin-graphite ' +
      'earbuds with copper SONY text + a copper mic ring, gold pogo contacts, and the L (grey) / ' +
      'R (red) + NFC markings. Live animation (looping): the lid opens, both buds rise while the ' +
      'case tilts, each bud spins a full turn, then they settle back into the wells and the lid closes.',
    referenceImage: `${BASE}references/sony-wf1000xm3.png`,
    sourcePath: 'src/demos/sony-wf1000xm3/createSonyWf1000xm3Model.ts',
    sourceUrl: `${REPO}/src/demos/sony-wf1000xm3/createSonyWf1000xm3Model.ts`,
    generatedWith: 'img2threejs v1.2',
    author: 'Hoài Nhớ',
    authorUrl: 'https://github.com/hoainho',
    status: 'final',
    cameraPosition: [3.6, 2.7, 5.4],
    cameraTarget: [0, 0.55, 0],
    cameraFov: 35,
    build: (scene) => {
      scene.background = makeSonyBackground();
      const group = createSonyWf1000xm3Model({ shadows: true });
      scene.add(group);
      const lights = createSonyWf1000xm3LookDevLights();
      scene.add(lights);
      return group;
    },
  },
  {
    id: 'issaca-shotgun',
    title: 'ISSACA 12 Gauge Shotgun',
    subjectClass: 'object',
    blurb:
      'A stylized bullpup pistol-shotgun ("ISSACA / Bolton Dynamics") rebuilt in code from a ' +
      'studio reference sheet: a slate-gray painted receiver with ISSACA / 12-GAUGE stencils, a ' +
      'hatched Bolton Dynamics triangle and a US-flag decal; an amber marbled-bakelite handguard ' +
      'with four vent slots; a fluted satin-steel barrel with a slotted hex muzzle brake, knurled ' +
      'gas knob and angled front hand-stop; a hooded reflex red-dot with a blue-tinted lens and a ' +
      'glowing reticle; and a black polymer pistol grip + oval trigger guard. Live FIRING VFX: an ' +
      'additive muzzle flash + burst light, full-gun recoil kick with muzzle rise, a bolt that ' +
      'cycles, and a brass "RIFLED SLUG" shell that ejects and tumbles to the ground.',
    referenceImage: `${BASE}references/issaca-shotgun.png`,
    sourcePath: 'src/demos/issaca-shotgun/createIssacaShotgunModel.ts',
    sourceUrl: `${REPO}/src/demos/issaca-shotgun/createIssacaShotgunModel.ts`,
    generatedWith: 'img2threejs v1.2',
    author: 'Hoài Nhớ',
    authorUrl: 'https://github.com/hoainho',
    status: 'final',
    cameraPosition: [1.9, 1.35, 3.5],
    cameraTarget: [-0.1, 0.5, 0],
    cameraFov: 32,
    build: (scene) => {
      scene.background = makeIssacaBackground();
      const group = createIssacaShotgunModel({ shadows: true });
      scene.add(group);
      const lights = createIssacaShotgunLookDevLights();
      scene.add(lights);
      return group;
    },
  },
  {
    id: 'gerber-knife',
    title: 'Gerber Paracord Knife',
    subjectClass: 'object',
    blurb:
      'A skeletonized full-tang tactical fixed-blade rebuilt in code from a single studio ' +
      'reference sheet: a modified-tanto blade with a black-oxide / stonewash PVD finish and a ' +
      'bright satin edge bevel, spine jimping, a "GERBER" wordmark + sword/anchor emblem and a ' +
      'vertical "3012863D" serial etch, a skeleton tang (forward lashing slot, ricasso hole) that ' +
      'tapers into a faceted hex pommel, all wrapped in ~13 turns of bright orange kernmantle ' +
      'paracord with a woven herringbone braid, finished by an overhand knot and two melted-tip ' +
      'tails. Live: a slow studio rock so the stonewash + cord weave catch travelling highlights.',
    referenceImage: `${BASE}references/gerber-knife.png`,
    sourcePath: 'src/demos/gerber-knife/createGerberKnifeModel.ts',
    sourceUrl: `${REPO}/src/demos/gerber-knife/createGerberKnifeModel.ts`,
    generatedWith: 'img2threejs v1.2',
    author: 'Hoài Nhớ',
    authorUrl: 'https://github.com/hoainho',
    status: 'final',
    cameraPosition: [0.35, 2.15, 6.7],
    cameraTarget: [-0.15, 0, 0],
    cameraFov: 30,
    build: (scene) => {
      scene.background = makeStudioBackground();
      const group = createGerberKnifeModel({ shadows: true });
      scene.add(group);
      const lights = createGerberKnifeLookDevLights();
      scene.add(lights);
      return group;
    },
  },
  {
    id: 'doraemon-house',
    title: 'Doraemon House (isometric diorama)',
    subjectClass: 'object',
    blurb:
      'An isometric residential-diorama scene rebuilt in code from a single hand-illustrated ' +
      'reference: an interlocking cluster of cream stucco volumes under bright red ribbed gable ' +
      'roofs with cream ridge/eave trim, a rooftop antenna, blue-glass windows, a strawberry ' +
      'plaque, wood front door + purple garage door. Nobita sits on the top ridge and Doraemon ' +
      'lies on a lower slope; a cinder-block perimeter wall with wood slat gates rings a green ' +
      'lawn with rounded trees, two concrete utility poles carry street-lamp heads and a web of ' +
      'overhead wires, and a trash can sits on the yellow-lined asphalt road. Live: swaying ' +
      'canopies, twinkling dusk windows, a gentle bob on the characters.',
    referenceImage: `${BASE}references/doraemon-house.png`,
    sourcePath: 'src/demos/doraemon-house/createDoraemonHouseModel.ts',
    sourceUrl: `${REPO}/src/demos/doraemon-house/createDoraemonHouseModel.ts`,
    generatedWith: 'img2threejs v1.2',
    author: 'Hoài Nhớ',
    authorUrl: 'https://github.com/hoainho',
    status: 'final',
    cameraPosition: [19, 15.5, 19],
    cameraTarget: [-0.2, 1.3, 0],
    cameraFov: 23,
    build: (scene) => {
      scene.background = makeSkyTexture();
      const group = createDoraemonHouseModel({ shadows: true });
      scene.add(group);
      const lights = createDoraemonHouseLookDevLights();
      scene.add(lights);
      return group;
    },
  },
  {
    id: 'warhauler',
    title: 'War-Hauler "SECTOR 07"',
    subjectClass: 'object',
    blurb:
      'A heavy armored 6-wheeled bulldozer-hauler rebuilt in code from a single isometric ' +
      'reference: gold brass cab (star, ACCESS PANEL, hazard lip, LED strip, twin slit ' +
      'headlights, corrugated exhaust), oxidized green-teal engine box, a riveted plow with ' +
      'five polished-steel claw blades, and six tyres with glowing red reactor hubs. ' +
      'Live VFX: exhaust smoke, a travelling glint across the blades, and rolling wheels.',
    referenceImage: `${BASE}references/warhauler.png`,
    sourcePath: 'src/demos/warhauler/createWarHaulerModel.ts',
    sourceUrl: `${REPO}/src/demos/warhauler/createWarHaulerModel.ts`,
    generatedWith: 'img2threejs v1.2',
    author: 'Hoài Nhớ',
    authorUrl: 'https://github.com/hoainho',
    status: 'final',
    cameraPosition: [-4.7, 2.7, -5.2],
    cameraTarget: [0, 0.95, -0.2],
    cameraFov: 33,
    build: (scene) => {
      // dark, cinematic environment to match the concept-sheet shading
      scene.background = new THREE.Color(0x0c0d11);
      scene.fog = new THREE.Fog(0x0c0d11, 11, 26);
      const group = createWarHaulerModel({ shadows: true });
      scene.add(group);
      const lights = createWarHaulerLookDevLights();
      scene.add(lights);
      return group;
    },
  },
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
    author: 'Hoài Nhớ',
    authorUrl: 'https://github.com/hoainho',
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
];

export function getDemo(id: string): DemoEntry | undefined {
  return demos.find((demo) => demo.id === id);
}
