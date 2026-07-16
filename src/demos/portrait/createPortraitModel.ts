import * as THREE from 'three';

export type ProceduralModelOptions = {
  wireframe?: boolean;
  castShadow?: boolean;
  receiveShadow?: boolean;
  textureSize?: number;
  textureAnisotropy?: number;
  qualityPriority?: 'reference-fidelity' | 'balanced';
};

export type ProceduralModelRuntime = {
  nodes: Record<string, THREE.Object3D>;
  meshes: Record<string, THREE.Mesh>;
  sockets: Record<string, THREE.Object3D>;
  colliders: Record<string, unknown>;
  destructionGroups: Record<string, THREE.Object3D[]>;
};

type SculptMaterialSpec = Record<string, any>;

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function readLayerNumber(value: unknown, keys: string[], fallback: number): number {
  if (typeof value === 'number') return value;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of keys) {
      if (typeof record[key] === 'number') return record[key] as number;
    }
  }
  return fallback;
}

function hexToRgb(hex: string): [number, number, number] {
  const normalized = /^#[0-9a-f]{3}$/i.test(hex)
    ? '#' + hex.slice(1).split('').map((part) => part + part).join('')
    : hex;
  const value = /^#[0-9a-f]{6}$/i.test(normalized) ? Number.parseInt(normalized.slice(1), 16) : 0x8a7a5f;
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function materialPalette(spec: SculptMaterialSpec): string[] {
  const palette = spec.colorVariation?.palette;
  if (Array.isArray(palette) && palette.length > 0) return palette.filter((value) => typeof value === 'string');
  const secondary = spec.albedo?.secondary;
  const colors = [spec.baseColor ?? spec.color ?? spec.albedo?.dominant, ...(Array.isArray(secondary) ? secondary : [])];
  return colors.filter((value): value is string => typeof value === 'string' && value.startsWith('#'));
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function smoothCurve(value: number): number {
  return value * value * (3 - 2 * value);
}

function periodicHash(x: number, y: number, seed: number, periodX: number, periodY: number): number {
  const wrappedX = ((x % periodX) + periodX) % periodX;
  const wrappedY = ((y % periodY) + periodY) % periodY;
  let value = Math.imul(wrappedX + seed * 17, 374761393) ^ Math.imul(wrappedY + seed * 31, 668265263);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

function periodicValueNoise(u: number, v: number, seed: number, periodX: number, periodY: number): number {
  const x = u * periodX;
  const y = v * periodY;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = smoothCurve(x - x0);
  const ty = smoothCurve(y - y0);
  const a = periodicHash(x0, y0, seed, periodX, periodY);
  const b = periodicHash(x0 + 1, y0, seed, periodX, periodY);
  const c = periodicHash(x0, y0 + 1, seed, periodX, periodY);
  const d = periodicHash(x0 + 1, y0 + 1, seed, periodX, periodY);
  return THREE.MathUtils.lerp(THREE.MathUtils.lerp(a, b, tx), THREE.MathUtils.lerp(c, d, tx), ty);
}

type SurfaceBand = {
  frequency: number;
  amplitude: number;
  stretchX: number;
  stretchY: number;
  ridge: boolean;
};

function surfaceBands(spec: SculptMaterialSpec): SurfaceBand[] {
  const source = Array.isArray(spec.surfaceFrequencyBands) ? spec.surfaceFrequencyBands : [];
  const parsed = source.flatMap((item: unknown) => {
    if (!item || typeof item !== 'object') return [];
    const band = item as Record<string, unknown>;
    const frequency = typeof band.frequency === 'number' ? band.frequency : 0;
    const amplitude = typeof band.amplitude === 'number' ? band.amplitude : 0;
    if (frequency <= 0 || amplitude <= 0) return [];
    const stretch = Array.isArray(band.stretch) ? band.stretch : [1, 1];
    const description = `${String(band.pattern ?? '')} ${String(band.role ?? '')}`.toLowerCase();
    return [{
      frequency,
      amplitude,
      stretchX: typeof stretch[0] === 'number' ? Math.max(0.1, stretch[0]) : 1,
      stretchY: typeof stretch[1] === 'number' ? Math.max(0.1, stretch[1]) : 1,
      ridge: /(ridge|groove|grain|fiber|striated|crack)/.test(description),
    }];
  });
  return parsed.length > 0 ? parsed : [
    { frequency: 2, amplitude: 0.42, stretchX: 1, stretchY: 1, ridge: false },
    { frequency: 12, amplitude: 0.22, stretchX: 1, stretchY: 1, ridge: false },
    { frequency: 56, amplitude: 0.08, stretchX: 1, stretchY: 1, ridge: false },
  ];
}

function sampleSurface(u: number, v: number, bands: SurfaceBand[], seed: number): number {
  let value = 0;
  let weight = 0;
  for (let index = 0; index < bands.length; index += 1) {
    const band = bands[index];
    const periodX = Math.max(1, Math.round(band.frequency * band.stretchX));
    const periodY = Math.max(1, Math.round(band.frequency * band.stretchY));
    let sample = periodicValueNoise(u, v, seed + index * 1013, periodX, periodY);
    if (band.ridge) sample = 1 - Math.abs(sample * 2 - 1);
    value += sample * band.amplitude;
    weight += band.amplitude;
  }
  return weight > 0 ? clamp01(value / weight) : 0.5;
}

function mixPalette(colors: [number, number, number][], value: number): [number, number, number] {
  if (colors.length === 1) return colors[0];
  const scaled = clamp01(value) * (colors.length - 1);
  const index = Math.min(colors.length - 2, Math.floor(scaled));
  const mix = scaled - index;
  const a = colors[index];
  const b = colors[index + 1];
  return [
    Math.round(THREE.MathUtils.lerp(a[0], b[0], mix)),
    Math.round(THREE.MathUtils.lerp(a[1], b[1], mix)),
    Math.round(THREE.MathUtils.lerp(a[2], b[2], mix)),
  ];
}

function writePixel(data: Uint8ClampedArray, offset: number, red: number, green: number, blue: number): void {
  data[offset] = Math.max(0, Math.min(255, Math.round(red)));
  data[offset + 1] = Math.max(0, Math.min(255, Math.round(green)));
  data[offset + 2] = Math.max(0, Math.min(255, Math.round(blue)));
  data[offset + 3] = 255;
}

function makeCanvas(size: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  return canvas;
}

function createMapTexture(
  canvas: HTMLCanvasElement,
  colorSpace: THREE.ColorSpace,
  spec: SculptMaterialSpec,
  options: ProceduralModelOptions,
): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  const projection = spec.textureProjection && typeof spec.textureProjection === 'object' ? spec.textureProjection : {};
  const repeat = Array.isArray(projection.repeat) ? projection.repeat : [2, 2];
  texture.colorSpace = colorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(
    typeof repeat[0] === 'number' ? repeat[0] : 2,
    typeof repeat[1] === 'number' ? repeat[1] : 2,
  );
  texture.anisotropy = Math.max(1, Math.round(options.textureAnisotropy ?? projection.anisotropy ?? 8));
  texture.needsUpdate = true;
  return texture;
}

type ProceduralTextureSet = {
  albedo: THREE.Texture;
  roughness: THREE.Texture;
  height: THREE.Texture;
  normal: THREE.Texture;
  ao: THREE.Texture;
  source: 'reference-pixel-extraction' | 'procedural';
};

function referenceMapUrl(spec: SculptMaterialSpec, channel: string): string | null {
  const reference = spec.referencePbr;
  if (!reference || typeof reference !== 'object') return null;
  if (reference.usable === false) return null;
  const confidence = typeof reference.confidence === 'number'
    ? reference.confidence
    : (typeof reference.estimatedFidelity === 'number' ? reference.estimatedFidelity : 0);
  const threshold = typeof reference.targetThreshold === 'number' ? reference.targetThreshold : 0.7;
  if (confidence < threshold) return null;
  const maps = reference.maps;
  if (!maps || typeof maps !== 'object') return null;
  const map = (maps as Record<string, unknown>)[channel];
  if (!map || typeof map !== 'object') return null;
  const record = map as Record<string, unknown>;
  const url = typeof record.url === 'string' && record.url.trim() ? record.url : record.path;
  return typeof url === 'string' && url.trim() ? url : null;
}

function createLoadedMapTexture(
  url: string,
  colorSpace: THREE.ColorSpace,
  spec: SculptMaterialSpec,
  options: ProceduralModelOptions,
): THREE.Texture {
  const texture = new THREE.TextureLoader().load(url);
  const projection = spec.textureProjection && typeof spec.textureProjection === 'object' ? spec.textureProjection : {};
  const repeat = Array.isArray(projection.repeat) ? projection.repeat : [1, 1];
  texture.colorSpace = colorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(
    typeof repeat[0] === 'number' ? repeat[0] : 1,
    typeof repeat[1] === 'number' ? repeat[1] : 1,
  );
  texture.anisotropy = Math.max(1, Math.round(options.textureAnisotropy ?? projection.anisotropy ?? 8));
  texture.needsUpdate = true;
  return texture;
}

function makeReferenceTextureSet(spec: SculptMaterialSpec, options: ProceduralModelOptions): ProceduralTextureSet | null {
  const albedo = referenceMapUrl(spec, 'albedo');
  const roughness = referenceMapUrl(spec, 'roughness');
  const height = referenceMapUrl(spec, 'height');
  const normal = referenceMapUrl(spec, 'normal');
  const ao = referenceMapUrl(spec, 'ao');
  if (!albedo || !roughness || !height || !normal || !ao) return null;
  return {
    albedo: createLoadedMapTexture(albedo, THREE.SRGBColorSpace, spec, options),
    roughness: createLoadedMapTexture(roughness, THREE.NoColorSpace, spec, options),
    height: createLoadedMapTexture(height, THREE.NoColorSpace, spec, options),
    normal: createLoadedMapTexture(normal, THREE.NoColorSpace, spec, options),
    ao: createLoadedMapTexture(ao, THREE.NoColorSpace, spec, options),
    source: 'reference-pixel-extraction',
  };
}

function makeProceduralTextureSet(
  id: string,
  spec: SculptMaterialSpec,
  options: ProceduralModelOptions,
): ProceduralTextureSet | null {
  if (typeof document === 'undefined') return null;
  const qualityFirst = (options.qualityPriority ?? 'reference-fidelity') === 'reference-fidelity';
  const requested = options.textureSize ?? spec.textureResolution;
  const requestedSize = typeof requested === 'number' && Number.isFinite(requested)
    ? requested
    : (qualityFirst ? 1024 : 512);
  const size = Math.max(256, Math.min(2048, 2 ** Math.round(Math.log2(requestedSize))));
  const canvases = {
    albedo: makeCanvas(size),
    roughness: makeCanvas(size),
    height: makeCanvas(size),
    normal: makeCanvas(size),
    ao: makeCanvas(size),
  };
  const contexts = {
    albedo: canvases.albedo.getContext('2d'),
    roughness: canvases.roughness.getContext('2d'),
    height: canvases.height.getContext('2d'),
    normal: canvases.normal.getContext('2d'),
    ao: canvases.ao.getContext('2d'),
  };
  if (!contexts.albedo || !contexts.roughness || !contexts.height || !contexts.normal || !contexts.ao) return null;
  const images = {
    albedo: contexts.albedo.createImageData(size, size),
    roughness: contexts.roughness.createImageData(size, size),
    height: contexts.height.createImageData(size, size),
    normal: contexts.normal.createImageData(size, size),
    ao: contexts.ao.createImageData(size, size),
  };
  const seed = hashString(id);
  const bands = surfaceBands(spec);
  const heightField = new Float32Array(size * size);
  const roughnessField = new Float32Array(size * size);
  const palette = materialPalette(spec);
  const fallback = typeof spec.baseColor === 'string' ? spec.baseColor : '#8A7A5F';
  const colors = (palette.length >= 2 ? palette : [fallback, '#6E614B', '#A08F70']).map(hexToRgb);
  const baseRoughness = clamp01(readLayerNumber(spec.roughness, ['base'], 0.76));
  const roughnessVariation = clamp01(readLayerNumber(spec.roughness, ['variation'], 0.18));
  const colorAmplitude = clamp01(readLayerNumber(spec.colorVariation, ['amplitude', 'variation'], 0.18));
  const heightCorrelation = clamp01(readLayerNumber(spec.colorVariation, ['heightCorrelation'], 0.3));
  for (let y = 0; y < size; y += 1) {
    const v = y / size;
    for (let x = 0; x < size; x += 1) {
      const u = x / size;
      const index = y * size + x;
      const height = sampleSurface(u, v, bands, seed + 101);
      const roughNoise = sampleSurface(u, v, bands, seed + 7001);
      const colorNoise = sampleSurface(u, v, bands, seed + 15013);
      heightField[index] = height;
      roughnessField[index] = clamp01(baseRoughness + (roughNoise - 0.5) * roughnessVariation * 2);
      const paletteValue = clamp01(
        0.5 + (colorNoise - 0.5) * colorAmplitude * 2 + (height - 0.5) * heightCorrelation
      );
      const color = mixPalette(colors, paletteValue);
      writePixel(images.albedo.data, index * 4, color[0], color[1], color[2]);
    }
  }
  const normalStrength = Math.max(0.05, readLayerNumber(spec.normal, ['strength', 'amplitude'], 0.35));
  const aoStrength = clamp01(readLayerNumber(spec.ambientOcclusion, ['cavityStrength', 'strength'], 0.35));
  for (let y = 0; y < size; y += 1) {
    const up = ((y - 1 + size) % size) * size;
    const down = ((y + 1) % size) * size;
    for (let x = 0; x < size; x += 1) {
      const left = (x - 1 + size) % size;
      const right = (x + 1) % size;
      const index = y * size + x;
      const center = heightField[index];
      const dx = (heightField[y * size + right] - heightField[y * size + left]) * normalStrength * 6;
      const dy = (heightField[down + x] - heightField[up + x]) * normalStrength * 6;
      const inverseLength = 1 / Math.sqrt(dx * dx + dy * dy + 1);
      const normalX = -dx * inverseLength;
      const normalY = -dy * inverseLength;
      const normalZ = inverseLength;
      const neighborAverage = (
        heightField[y * size + left] + heightField[y * size + right]
        + heightField[up + x] + heightField[down + x]
      ) * 0.25;
      const cavity = Math.max(0, neighborAverage - center);
      const ao = clamp01(1 - aoStrength * (cavity * 12 + (1 - center) * 0.16));
      const offset = index * 4;
      const heightByte = center * 255;
      const roughnessByte = roughnessField[index] * 255;
      writePixel(images.height.data, offset, heightByte, heightByte, heightByte);
      writePixel(images.roughness.data, offset, roughnessByte, roughnessByte, roughnessByte);
      writePixel(
        images.normal.data, offset,
        (normalX * 0.5 + 0.5) * 255,
        (normalY * 0.5 + 0.5) * 255,
        (normalZ * 0.5 + 0.5) * 255,
      );
      writePixel(images.ao.data, offset, ao * 255, ao * 255, ao * 255);
    }
  }
  contexts.albedo.putImageData(images.albedo, 0, 0);
  contexts.roughness.putImageData(images.roughness, 0, 0);
  contexts.height.putImageData(images.height, 0, 0);
  contexts.normal.putImageData(images.normal, 0, 0);
  contexts.ao.putImageData(images.ao, 0, 0);
  return {
    albedo: createMapTexture(canvases.albedo, THREE.SRGBColorSpace, spec, options),
    roughness: createMapTexture(canvases.roughness, THREE.NoColorSpace, spec, options),
    height: createMapTexture(canvases.height, THREE.NoColorSpace, spec, options),
    normal: createMapTexture(canvases.normal, THREE.NoColorSpace, spec, options),
    ao: createMapTexture(canvases.ao, THREE.NoColorSpace, spec, options),
    source: 'procedural',
  };
}

function createSculptMaterial(id: string, spec: SculptMaterialSpec, options: ProceduralModelOptions): THREE.MeshPhysicalMaterial {
  const textures = makeReferenceTextureSet(spec, options) ?? makeProceduralTextureSet(id, spec, options);
  const material = new THREE.MeshPhysicalMaterial({
    color: textures ? 0xffffff : new THREE.Color(typeof spec.baseColor === 'string' ? spec.baseColor : '#8A7A5F'),
    roughness: textures ? 1 : clamp01(readLayerNumber(spec.roughness, ['base'], 0.76)),
    metalness: clamp01(readLayerNumber(spec.metalness, ['base'], 0.0)),
    clearcoat: clamp01(readLayerNumber(spec.clearcoat, ['base', 'amount'], 0)),
    clearcoatRoughness: clamp01(readLayerNumber(spec.clearcoatRoughness, ['base'], 0.25)),
    transmission: clamp01(readLayerNumber(spec.transmission, ['base', 'amount'], 0)),
    opacity: clamp01(readLayerNumber(spec.opacity, ['base'], 1)),
    transparent: readLayerNumber(spec.transmission, ['base', 'amount'], 0) > 0 || readLayerNumber(spec.opacity, ['base'], 1) < 1,
    alphaTest: Math.max(0, readLayerNumber(spec.alpha, ['cutoff', 'alphaTest'], 0)),
    wireframe: options.wireframe ?? false,
    side: spec.doubleSided === true ? THREE.DoubleSide : THREE.FrontSide,
  });
  if (textures) {
    material.map = textures.albedo;
    material.roughnessMap = textures.roughness;
    material.normalMap = textures.normal;
    material.normalScale.setScalar(Math.max(0.05, readLayerNumber(spec.normal, ['strength', 'amplitude'], 0.35)));
    material.aoMap = textures.ao;
    material.aoMap.channel = 0;
    material.aoMapIntensity = readLayerNumber(spec.ambientOcclusion, ['cavityStrength', 'strength'], 0.35);
    const bumpScale = Math.max(0, readLayerNumber(spec.bump, ['amplitude', 'strength'], 0));
    if (bumpScale > 0) {
      material.bumpMap = textures.height;
      material.bumpScale = bumpScale;
    }
    const displacementScale = Math.max(0, readLayerNumber(spec.displacement, ['amplitude', 'strength'], 0));
    if (displacementScale > 0) {
      material.displacementMap = textures.height;
      material.displacementScale = displacementScale;
      material.displacementBias = -displacementScale * 0.5;
    }
  }
  material.envMapIntensity = readLayerNumber(spec, ['envMapIntensity'], 0.8);
  material.userData.sculptMaterial = spec;
  material.userData.proceduralMapsIndependent = true;
  material.userData.pbrTextureSource = textures?.source ?? 'flat-fallback';
  material.userData.referencePbr = spec.referencePbr ?? null;
  material.needsUpdate = true;
  return material;
}

type AttachmentEndpoint = {
  start: THREE.Vector3;
  midpoint: THREE.Vector3;
  quaternion: THREE.Quaternion;
  length: number;
  baseRadius: number;
  endRadius: number;
};

function readVector3(value: unknown, fallback: [number, number, number]): THREE.Vector3 {
  if (Array.isArray(value) && value.length === 3 && value.every((item) => typeof item === 'number')) {
    return new THREE.Vector3(value[0], value[1], value[2]);
  }
  return new THREE.Vector3(fallback[0], fallback[1], fallback[2]);
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function makeAttachmentEndpoint(attachment: unknown): AttachmentEndpoint | null {
  if (!attachment || typeof attachment !== 'object') return null;
  const record = attachment as Record<string, unknown>;
  const start = readVector3(record.localStart, [0, 0, 0]);
  const end = readVector3(record.localEnd, [0, 1, 0]);
  const delta = end.clone().sub(start);
  const length = delta.length();
  if (length <= 0.0001) return null;
  const direction = delta.clone().normalize();
  const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
  const baseRadius = Math.max(0.005, readNumber(record.baseRadius, 0.06));
  const endRadius = Math.max(0.003, readNumber(record.endRadius, baseRadius * 0.55));
  return {
    start,
    midpoint: delta.multiplyScalar(0.5),
    quaternion,
    length,
    baseRadius,
    endRadius,
  };
}

// Generated from ObjectSculptSpec target: Portrait Bust
// Sculpt build pass: blockout
// This factory is intentionally pass-gated. Finish browser screenshot review before unlocking deeper passes.
export function createPortraitBustModel(options: ProceduralModelOptions = {}): THREE.Group {
  const root = new THREE.Group();
  root.name = "Portrait Bust";

  const materialMap: Record<string, THREE.Material> = {};
  materialMap["base"] = createSculptMaterial(
    "base",
    {"id": "base", "name": "Base material", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#8A7A5F", "color": "#8A7A5F", "albedo": {"dominant": "#8A7A5F", "secondary": ["#6E614B", "#A08F70"], "samplingNotes": "Use image-observed local color zones, not a single averaged color."}, "colorVariation": {"palette": ["#8A7A5F", "#6E614B", "#A08F70"], "pattern": "mottled", "amplitude": 0.15, "heightCorrelation": 0.3}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [2.0, 2.0], "anisotropy": 8, "texelDensityIntent": "Preserve stable world/object-scale detail; do not stretch micro detail with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.42, "role": "broad color and height breakup"}, {"id": "meso", "frequency": 12.0, "amplitude": 0.22, "role": "ridges, pores, grain, dents, or equivalent visible relief"}, {"id": "micro", "frequency": 56.0, "amplitude": 0.08, "role": "highlight breakup visible under grazing light"}], "roughness": {"base": 0.75, "variation": 0.15, "map": "independent-procedural-field", "localResponse": "higher roughness in cavities, lower roughness on worn edges"}, "metalness": {"base": 0.0, "variation": 0.0}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.35, "scale": 24.0, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes."},
    options
  );
  materialMap["hidden"] = createSculptMaterial(
    "hidden",
    {"id": "hidden", "name": "Base material", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#000000", "color": "#000000", "albedo": {"dominant": "#000000", "secondary": ["#000000"]}, "colorVariation": {"palette": ["#000000", "#000000"], "pattern": "flat", "amplitude": 0.05, "heightCorrelation": 0.0}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [2.0, 2.0], "anisotropy": 8, "texelDensityIntent": "Preserve stable world/object-scale detail; do not stretch micro detail with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.42, "role": "broad color and height breakup"}, {"id": "meso", "frequency": 12.0, "amplitude": 0.22, "role": "ridges, pores, grain, dents, or equivalent visible relief"}, {"id": "micro", "frequency": 56.0, "amplitude": 0.08, "role": "highlight breakup visible under grazing light"}], "roughness": {"base": 1.0, "variation": 0.0}, "metalness": {"base": 0.0, "variation": 0.0}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.35, "scale": 24.0, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes.", "opacity": {"base": 0.0}},
    options
  );
  materialMap["skin"] = createSculptMaterial(
    "skin",
    {"id": "skin", "name": "Base material", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#e8b98f", "color": "#e8b98f", "albedo": {"dominant": "#e8b98f", "secondary": ["#be9875"]}, "colorVariation": {"palette": ["#e8b98f", "#be9875"], "pattern": "flat", "amplitude": 0.05, "heightCorrelation": 0.0}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [2.0, 2.0], "anisotropy": 8, "texelDensityIntent": "Preserve stable world/object-scale detail; do not stretch micro detail with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.42, "role": "broad color and height breakup"}, {"id": "meso", "frequency": 12.0, "amplitude": 0.22, "role": "ridges, pores, grain, dents, or equivalent visible relief"}, {"id": "micro", "frequency": 56.0, "amplitude": 0.08, "role": "highlight breakup visible under grazing light"}], "roughness": {"base": 0.55, "variation": 0.08}, "metalness": {"base": 0.0, "variation": 0.0}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.35, "scale": 24.0, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes."},
    options
  );
  materialMap["hair"] = createSculptMaterial(
    "hair",
    {"id": "hair", "name": "Base material", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#171310", "color": "#171310", "albedo": {"dominant": "#171310", "secondary": ["#13100d"]}, "colorVariation": {"palette": ["#171310", "#13100d"], "pattern": "flat", "amplitude": 0.05, "heightCorrelation": 0.0}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [2.0, 2.0], "anisotropy": 8, "texelDensityIntent": "Preserve stable world/object-scale detail; do not stretch micro detail with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.42, "role": "broad color and height breakup"}, {"id": "meso", "frequency": 12.0, "amplitude": 0.22, "role": "ridges, pores, grain, dents, or equivalent visible relief"}, {"id": "micro", "frequency": 56.0, "amplitude": 0.08, "role": "highlight breakup visible under grazing light"}], "roughness": {"base": 0.42, "variation": 0.1}, "metalness": {"base": 0.0, "variation": 0.0}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.35, "scale": 24.0, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes."},
    options
  );
  materialMap["shirt"] = createSculptMaterial(
    "shirt",
    {"id": "shirt", "name": "Base material", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#20202a", "color": "#20202a", "albedo": {"dominant": "#20202a", "secondary": ["#1a1a22"]}, "colorVariation": {"palette": ["#20202a", "#1a1a22"], "pattern": "flat", "amplitude": 0.05, "heightCorrelation": 0.0}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [2.0, 2.0], "anisotropy": 8, "texelDensityIntent": "Preserve stable world/object-scale detail; do not stretch micro detail with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.42, "role": "broad color and height breakup"}, {"id": "meso", "frequency": 12.0, "amplitude": 0.22, "role": "ridges, pores, grain, dents, or equivalent visible relief"}, {"id": "micro", "frequency": 56.0, "amplitude": 0.08, "role": "highlight breakup visible under grazing light"}], "roughness": {"base": 0.85, "variation": 0.12}, "metalness": {"base": 0.0, "variation": 0.0}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.35, "scale": 24.0, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes."},
    options
  );
  materialMap["shirt-decal"] = createSculptMaterial(
    "shirt-decal",
    {"id": "shirt-decal", "name": "Base material", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#d24a20", "color": "#d24a20", "albedo": {"dominant": "#d24a20", "secondary": ["#ac3d1a"]}, "colorVariation": {"palette": ["#d24a20", "#ac3d1a"], "pattern": "flat", "amplitude": 0.05, "heightCorrelation": 0.0}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [2.0, 2.0], "anisotropy": 8, "texelDensityIntent": "Preserve stable world/object-scale detail; do not stretch micro detail with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.42, "role": "broad color and height breakup"}, {"id": "meso", "frequency": 12.0, "amplitude": 0.22, "role": "ridges, pores, grain, dents, or equivalent visible relief"}, {"id": "micro", "frequency": 56.0, "amplitude": 0.08, "role": "highlight breakup visible under grazing light"}], "roughness": {"base": 0.7, "variation": 0.05}, "metalness": {"base": 0.0, "variation": 0.0}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.35, "scale": 24.0, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes."},
    options
  );
  materialMap["glasses-frame"] = createSculptMaterial(
    "glasses-frame",
    {"id": "glasses-frame", "name": "Base material", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#111114", "color": "#111114", "albedo": {"dominant": "#111114", "secondary": ["#0e0e10"]}, "colorVariation": {"palette": ["#111114", "#0e0e10"], "pattern": "flat", "amplitude": 0.05, "heightCorrelation": 0.0}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [2.0, 2.0], "anisotropy": 8, "texelDensityIntent": "Preserve stable world/object-scale detail; do not stretch micro detail with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.42, "role": "broad color and height breakup"}, {"id": "meso", "frequency": 12.0, "amplitude": 0.22, "role": "ridges, pores, grain, dents, or equivalent visible relief"}, {"id": "micro", "frequency": 56.0, "amplitude": 0.08, "role": "highlight breakup visible under grazing light"}], "roughness": {"base": 0.35, "variation": 0.05}, "metalness": {"base": 0.0, "variation": 0.0}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.35, "scale": 24.0, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes."},
    options
  );
  materialMap["glasses-lens"] = createSculptMaterial(
    "glasses-lens",
    {"id": "glasses-lens", "name": "Base material", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#a9c6d8", "color": "#a9c6d8", "albedo": {"dominant": "#a9c6d8", "secondary": ["#8ba2b1"]}, "colorVariation": {"palette": ["#a9c6d8", "#8ba2b1"], "pattern": "flat", "amplitude": 0.05, "heightCorrelation": 0.0}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [2.0, 2.0], "anisotropy": 8, "texelDensityIntent": "Preserve stable world/object-scale detail; do not stretch micro detail with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.42, "role": "broad color and height breakup"}, {"id": "meso", "frequency": 12.0, "amplitude": 0.22, "role": "ridges, pores, grain, dents, or equivalent visible relief"}, {"id": "micro", "frequency": 56.0, "amplitude": 0.08, "role": "highlight breakup visible under grazing light"}], "roughness": {"base": 0.08, "variation": 0.02}, "metalness": {"base": 0.0, "variation": 0.0}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.35, "scale": 24.0, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes."},
    options
  );
  materialMap["headphone"] = createSculptMaterial(
    "headphone",
    {"id": "headphone", "name": "Base material", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#0e0e10", "color": "#0e0e10", "albedo": {"dominant": "#0e0e10", "secondary": ["#0b0b0d"]}, "colorVariation": {"palette": ["#0e0e10", "#0b0b0d"], "pattern": "flat", "amplitude": 0.05, "heightCorrelation": 0.0}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [2.0, 2.0], "anisotropy": 8, "texelDensityIntent": "Preserve stable world/object-scale detail; do not stretch micro detail with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.42, "role": "broad color and height breakup"}, {"id": "meso", "frequency": 12.0, "amplitude": 0.22, "role": "ridges, pores, grain, dents, or equivalent visible relief"}, {"id": "micro", "frequency": 56.0, "amplitude": 0.08, "role": "highlight breakup visible under grazing light"}], "roughness": {"base": 0.5, "variation": 0.08}, "metalness": {"base": 0.0, "variation": 0.0}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.35, "scale": 24.0, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes."},
    options
  );
  materialMap["lips"] = createSculptMaterial(
    "lips",
    {"id": "lips", "name": "Base material", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#c98070", "color": "#c98070", "albedo": {"dominant": "#c98070", "secondary": ["#a5695c"]}, "colorVariation": {"palette": ["#c98070", "#a5695c"], "pattern": "flat", "amplitude": 0.05, "heightCorrelation": 0.0}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [2.0, 2.0], "anisotropy": 8, "texelDensityIntent": "Preserve stable world/object-scale detail; do not stretch micro detail with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.42, "role": "broad color and height breakup"}, {"id": "meso", "frequency": 12.0, "amplitude": 0.22, "role": "ridges, pores, grain, dents, or equivalent visible relief"}, {"id": "micro", "frequency": 56.0, "amplitude": 0.08, "role": "highlight breakup visible under grazing light"}], "roughness": {"base": 0.5, "variation": 0.05}, "metalness": {"base": 0.0, "variation": 0.0}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.35, "scale": 24.0, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes."},
    options
  );

  const nodes: Record<string, THREE.Object3D> = { root };
  const meshes: Record<string, THREE.Mesh> = {};
  const sockets: Record<string, THREE.Object3D> = {};
  const colliders: Record<string, unknown> = {};
  const destructionGroups: Record<string, THREE.Object3D[]> = {};

  const attachment_root_0 = null;
  const endpoint_root_0 = makeAttachmentEndpoint(attachment_root_0);
  const node_root_0 = new THREE.Group();
  node_root_0.name = "Character (root)__pivot";
  if (endpoint_root_0) {
    node_root_0.position.copy(endpoint_root_0.start);
    node_root_0.rotation.set(0, 0, 0);
    node_root_0.scale.set(1, 1, 1);
  } else {
    node_root_0.position.set(0.0, 0.0, 0.0);
    node_root_0.rotation.set(0.0, 0.0, 0.0);
    node_root_0.scale.set(1.0, 1.0, 1.0);
  }
  node_root_0.userData.sculptComponent = {"id": "root", "name": "Character (root)", "level": "macro", "role": "body", "importance": 1.0, "confidence": 0.8, "primitive": "box", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.8}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "hidden", "materialLayers": ["hidden"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_root_0.userData.actionProfile = {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_root_0);
  nodes["root"] = node_root_0;
  const mesh_root_0Geometry = endpoint_root_0
    ? new THREE.CylinderGeometry(endpoint_root_0.endRadius, endpoint_root_0.baseRadius, endpoint_root_0.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  const mesh_root_0 = new THREE.Mesh(
    mesh_root_0Geometry,
    materialMap["hidden"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_root_0.name = "Character (root)";
  if (endpoint_root_0) {
    mesh_root_0.position.copy(endpoint_root_0.midpoint);
    mesh_root_0.quaternion.copy(endpoint_root_0.quaternion);
  }
  mesh_root_0.castShadow = options.castShadow ?? true;
  mesh_root_0.receiveShadow = options.receiveShadow ?? true;
  mesh_root_0.userData.sculptComponent = {"id": "root", "name": "Character (root)", "level": "macro", "role": "body", "importance": 1.0, "confidence": 0.8, "primitive": "box", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.8}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "hidden", "materialLayers": ["hidden"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_root_0.add(mesh_root_0);
  meshes["root"] = mesh_root_0;
  colliders["root"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_root_0);

  const attachment_torso_1 = null;
  const endpoint_torso_1 = makeAttachmentEndpoint(attachment_torso_1);
  const node_torso_1 = new THREE.Group();
  node_torso_1.name = "Torso (shirt)__pivot";
  if (endpoint_torso_1) {
    node_torso_1.position.copy(endpoint_torso_1.start);
    node_torso_1.rotation.set(0, 0, 0);
    node_torso_1.scale.set(1, 1, 1);
  } else {
    node_torso_1.position.set(0.0, 0.15400000000000003, 0.0);
    node_torso_1.rotation.set(0.0, 0.0, 0.0);
    node_torso_1.scale.set(0.672, 0.6160000000000001, 0.42000000000000004);
  }
  node_torso_1.userData.sculptComponent = {"id": "torso", "name": "Torso (shirt)", "level": "macro", "role": "shell", "importance": 1.0, "confidence": 0.8, "primitive": "capsule", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.672, "height": 0.6160000000000001, "depth": 0.42000000000000004, "units": "relative", "confidence": 0.8}, "transform": {"position": [0, 0.15400000000000003, 0], "rotation": [0, 0, 0], "scale": [0.672, 0.6160000000000001, 0.42000000000000004]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "torso", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "shirt"}}, "material": "shirt", "materialLayers": ["shirt"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_torso_1.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "torso", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "shirt"}};
  (nodes["root"] ?? root).add(node_torso_1);
  nodes["torso"] = node_torso_1;
  const mesh_torso_1Geometry = endpoint_torso_1
    ? new THREE.CylinderGeometry(endpoint_torso_1.endRadius, endpoint_torso_1.baseRadius, endpoint_torso_1.length, 32, 12)
    : new THREE.CapsuleGeometry(0.35, 0.7, 16, 32);
  const mesh_torso_1 = new THREE.Mesh(
    mesh_torso_1Geometry,
    materialMap["shirt"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_torso_1.name = "Torso (shirt)";
  if (endpoint_torso_1) {
    mesh_torso_1.position.copy(endpoint_torso_1.midpoint);
    mesh_torso_1.quaternion.copy(endpoint_torso_1.quaternion);
  }
  mesh_torso_1.castShadow = options.castShadow ?? true;
  mesh_torso_1.receiveShadow = options.receiveShadow ?? true;
  mesh_torso_1.userData.sculptComponent = {"id": "torso", "name": "Torso (shirt)", "level": "macro", "role": "shell", "importance": 1.0, "confidence": 0.8, "primitive": "capsule", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.672, "height": 0.6160000000000001, "depth": 0.42000000000000004, "units": "relative", "confidence": 0.8}, "transform": {"position": [0, 0.15400000000000003, 0], "rotation": [0, 0, 0], "scale": [0.672, 0.6160000000000001, 0.42000000000000004]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "torso", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "shirt"}}, "material": "shirt", "materialLayers": ["shirt"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_torso_1.add(mesh_torso_1);
  meshes["torso"] = mesh_torso_1;
  colliders["torso"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["torso"] ??= [];
  destructionGroups["torso"].push(node_torso_1);

  const attachment_shirt_decal_2 = null;
  const endpoint_shirt_decal_2 = makeAttachmentEndpoint(attachment_shirt_decal_2);
  const node_shirt_decal_2 = new THREE.Group();
  node_shirt_decal_2.name = "Chest graphic (Orioles)__pivot";
  if (endpoint_shirt_decal_2) {
    node_shirt_decal_2.position.copy(endpoint_shirt_decal_2.start);
    node_shirt_decal_2.rotation.set(0, 0, 0);
    node_shirt_decal_2.scale.set(1, 1, 1);
  } else {
    node_shirt_decal_2.position.set(0.0, 0.18200000000000002, 0.21840000000000004);
    node_shirt_decal_2.rotation.set(0.0, 0.0, 0.0);
    node_shirt_decal_2.scale.set(0.42000000000000004, 0.25200000000000006, 1.0);
  }
  node_shirt_decal_2.userData.sculptComponent = {"id": "shirt-decal", "name": "Chest graphic (Orioles)", "level": "micro", "role": "decal", "importance": 0.7, "confidence": 0.8, "primitive": "plane-card", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.42000000000000004, "height": 0.25200000000000006, "depth": 1.0, "units": "relative", "confidence": 0.8}, "transform": {"position": [0, 0.18200000000000002, 0.21840000000000004], "rotation": [0, 0, 0], "scale": [0.42000000000000004, 0.25200000000000006, 1.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "shirt-decal", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "shirt-decal"}}, "material": "shirt-decal", "materialLayers": ["shirt-decal"], "deformations": [], "joints": [], "seams": [], "localFeatures": ["cursive orange team wordmark with white outline"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_shirt_decal_2.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "shirt-decal", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "shirt-decal"}};
  (nodes["root"] ?? root).add(node_shirt_decal_2);
  nodes["shirt-decal"] = node_shirt_decal_2;
  const mesh_shirt_decal_2Geometry = endpoint_shirt_decal_2
    ? new THREE.CylinderGeometry(endpoint_shirt_decal_2.endRadius, endpoint_shirt_decal_2.baseRadius, endpoint_shirt_decal_2.length, 32, 12)
    : new THREE.PlaneGeometry(1, 1, 24, 24);
  const mesh_shirt_decal_2 = new THREE.Mesh(
    mesh_shirt_decal_2Geometry,
    materialMap["shirt-decal"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_shirt_decal_2.name = "Chest graphic (Orioles)";
  if (endpoint_shirt_decal_2) {
    mesh_shirt_decal_2.position.copy(endpoint_shirt_decal_2.midpoint);
    mesh_shirt_decal_2.quaternion.copy(endpoint_shirt_decal_2.quaternion);
  }
  mesh_shirt_decal_2.castShadow = options.castShadow ?? true;
  mesh_shirt_decal_2.receiveShadow = options.receiveShadow ?? true;
  mesh_shirt_decal_2.userData.sculptComponent = {"id": "shirt-decal", "name": "Chest graphic (Orioles)", "level": "micro", "role": "decal", "importance": 0.7, "confidence": 0.8, "primitive": "plane-card", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.42000000000000004, "height": 0.25200000000000006, "depth": 1.0, "units": "relative", "confidence": 0.8}, "transform": {"position": [0, 0.18200000000000002, 0.21840000000000004], "rotation": [0, 0, 0], "scale": [0.42000000000000004, 0.25200000000000006, 1.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "shirt-decal", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "shirt-decal"}}, "material": "shirt-decal", "materialLayers": ["shirt-decal"], "deformations": [], "joints": [], "seams": [], "localFeatures": ["cursive orange team wordmark with white outline"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_shirt_decal_2.add(mesh_shirt_decal_2);
  meshes["shirt-decal"] = mesh_shirt_decal_2;
  colliders["shirt-decal"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["shirt-decal"] ??= [];
  destructionGroups["shirt-decal"].push(node_shirt_decal_2);

  const attachment_neck_3 = null;
  const endpoint_neck_3 = makeAttachmentEndpoint(attachment_neck_3);
  const node_neck_3 = new THREE.Group();
  node_neck_3.name = "Neck__pivot";
  if (endpoint_neck_3) {
    node_neck_3.position.copy(endpoint_neck_3.start);
    node_neck_3.rotation.set(0, 0, 0);
    node_neck_3.scale.set(1, 1, 1);
  } else {
    node_neck_3.position.set(0.0, 0.462, 0.0);
    node_neck_3.rotation.set(0.0, 0.0, 0.0);
    node_neck_3.scale.set(0.15400000000000003, 0.196, 0.15400000000000003);
  }
  node_neck_3.userData.sculptComponent = {"id": "neck", "name": "Neck", "level": "meso", "role": "support", "importance": 0.6, "confidence": 0.8, "primitive": "cylinder", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.15400000000000003, "height": 0.196, "depth": 0.15400000000000003, "units": "relative", "confidence": 0.8}, "transform": {"position": [0, 0.462, 0], "rotation": [0, 0, 0], "scale": [0.15400000000000003, 0.196, 0.15400000000000003]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "neck", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "skin", "materialLayers": ["skin"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_neck_3.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "neck", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}};
  (nodes["root"] ?? root).add(node_neck_3);
  nodes["neck"] = node_neck_3;
  const mesh_neck_3Geometry = endpoint_neck_3
    ? new THREE.CylinderGeometry(endpoint_neck_3.endRadius, endpoint_neck_3.baseRadius, endpoint_neck_3.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  const mesh_neck_3 = new THREE.Mesh(
    mesh_neck_3Geometry,
    materialMap["skin"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_neck_3.name = "Neck";
  if (endpoint_neck_3) {
    mesh_neck_3.position.copy(endpoint_neck_3.midpoint);
    mesh_neck_3.quaternion.copy(endpoint_neck_3.quaternion);
  }
  mesh_neck_3.castShadow = options.castShadow ?? true;
  mesh_neck_3.receiveShadow = options.receiveShadow ?? true;
  mesh_neck_3.userData.sculptComponent = {"id": "neck", "name": "Neck", "level": "meso", "role": "support", "importance": 0.6, "confidence": 0.8, "primitive": "cylinder", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.15400000000000003, "height": 0.196, "depth": 0.15400000000000003, "units": "relative", "confidence": 0.8}, "transform": {"position": [0, 0.462, 0], "rotation": [0, 0, 0], "scale": [0.15400000000000003, 0.196, 0.15400000000000003]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "neck", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "skin", "materialLayers": ["skin"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_neck_3.add(mesh_neck_3);
  meshes["neck"] = mesh_neck_3;
  colliders["neck"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["neck"] ??= [];
  destructionGroups["neck"].push(node_neck_3);

  const attachment_head_4 = null;
  const endpoint_head_4 = makeAttachmentEndpoint(attachment_head_4);
  const node_head_4 = new THREE.Group();
  node_head_4.name = "Head__pivot";
  if (endpoint_head_4) {
    node_head_4.position.copy(endpoint_head_4.start);
    node_head_4.rotation.set(0, 0, 0);
    node_head_4.scale.set(1, 1, 1);
  } else {
    node_head_4.position.set(0.0, 0.7000000000000001, 0.005600000000000001);
    node_head_4.rotation.set(0.0, 0.0, 0.0);
    node_head_4.scale.set(0.25760000000000005, 0.31360000000000005, 0.27440000000000003);
  }
  node_head_4.userData.sculptComponent = {"id": "head", "name": "Head", "level": "macro", "role": "body", "importance": 1.0, "confidence": 0.8, "primitive": "ellipsoid", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.25760000000000005, "height": 0.31360000000000005, "depth": 0.27440000000000003, "units": "relative", "confidence": 0.8}, "transform": {"position": [0, 0.7000000000000001, 0.005600000000000001], "rotation": [0, 0, 0], "scale": [0.25760000000000005, 0.31360000000000005, 0.27440000000000003]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "head", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "skin", "materialLayers": ["skin"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_head_4.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "head", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}};
  (nodes["root"] ?? root).add(node_head_4);
  nodes["head"] = node_head_4;
  const mesh_head_4Geometry = endpoint_head_4
    ? new THREE.CylinderGeometry(endpoint_head_4.endRadius, endpoint_head_4.baseRadius, endpoint_head_4.length, 32, 12)
    : new THREE.SphereGeometry(0.5, 64, 40);
  const mesh_head_4 = new THREE.Mesh(
    mesh_head_4Geometry,
    materialMap["skin"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_head_4.name = "Head";
  if (endpoint_head_4) {
    mesh_head_4.position.copy(endpoint_head_4.midpoint);
    mesh_head_4.quaternion.copy(endpoint_head_4.quaternion);
  }
  mesh_head_4.castShadow = options.castShadow ?? true;
  mesh_head_4.receiveShadow = options.receiveShadow ?? true;
  mesh_head_4.userData.sculptComponent = {"id": "head", "name": "Head", "level": "macro", "role": "body", "importance": 1.0, "confidence": 0.8, "primitive": "ellipsoid", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.25760000000000005, "height": 0.31360000000000005, "depth": 0.27440000000000003, "units": "relative", "confidence": 0.8}, "transform": {"position": [0, 0.7000000000000001, 0.005600000000000001], "rotation": [0, 0, 0], "scale": [0.25760000000000005, 0.31360000000000005, 0.27440000000000003]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "head", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "skin", "materialLayers": ["skin"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_head_4.add(mesh_head_4);
  meshes["head"] = mesh_head_4;
  colliders["head"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["head"] ??= [];
  destructionGroups["head"].push(node_head_4);

  const attachment_hair_5 = null;
  const endpoint_hair_5 = makeAttachmentEndpoint(attachment_hair_5);
  const node_hair_5 = new THREE.Group();
  node_hair_5.name = "Hair (side-swept)__pivot";
  if (endpoint_hair_5) {
    node_hair_5.position.copy(endpoint_hair_5.start);
    node_hair_5.rotation.set(0, 0, 0);
    node_hair_5.scale.set(1, 1, 1);
  } else {
    node_hair_5.position.set(0.0, 0.7784000000000001, -0.005600000000000001);
    node_hair_5.rotation.set(0.0, 0.0, 0.0);
    node_hair_5.scale.set(0.29680000000000006, 0.2296, 0.30240000000000006);
  }
  node_hair_5.userData.sculptComponent = {"id": "hair", "name": "Hair (side-swept)", "level": "meso", "role": "hair", "importance": 0.9, "confidence": 0.8, "primitive": "ellipsoid", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.29680000000000006, "height": 0.2296, "depth": 0.30240000000000006, "units": "relative", "confidence": 0.8}, "transform": {"position": [0, 0.7784000000000001, -0.005600000000000001], "rotation": [0, 0, 0], "scale": [0.29680000000000006, 0.2296, 0.30240000000000006]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "hair", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hair"}}, "material": "hair", "materialLayers": ["hair"], "deformations": [], "joints": [], "seams": [], "localFeatures": ["short sides, longer swept-back top"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_hair_5.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "hair", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hair"}};
  (nodes["root"] ?? root).add(node_hair_5);
  nodes["hair"] = node_hair_5;
  const mesh_hair_5Geometry = endpoint_hair_5
    ? new THREE.CylinderGeometry(endpoint_hair_5.endRadius, endpoint_hair_5.baseRadius, endpoint_hair_5.length, 32, 12)
    : new THREE.SphereGeometry(0.5, 64, 40);
  const mesh_hair_5 = new THREE.Mesh(
    mesh_hair_5Geometry,
    materialMap["hair"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_hair_5.name = "Hair (side-swept)";
  if (endpoint_hair_5) {
    mesh_hair_5.position.copy(endpoint_hair_5.midpoint);
    mesh_hair_5.quaternion.copy(endpoint_hair_5.quaternion);
  }
  mesh_hair_5.castShadow = options.castShadow ?? true;
  mesh_hair_5.receiveShadow = options.receiveShadow ?? true;
  mesh_hair_5.userData.sculptComponent = {"id": "hair", "name": "Hair (side-swept)", "level": "meso", "role": "hair", "importance": 0.9, "confidence": 0.8, "primitive": "ellipsoid", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.29680000000000006, "height": 0.2296, "depth": 0.30240000000000006, "units": "relative", "confidence": 0.8}, "transform": {"position": [0, 0.7784000000000001, -0.005600000000000001], "rotation": [0, 0, 0], "scale": [0.29680000000000006, 0.2296, 0.30240000000000006]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "hair", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hair"}}, "material": "hair", "materialLayers": ["hair"], "deformations": [], "joints": [], "seams": [], "localFeatures": ["short sides, longer swept-back top"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_hair_5.add(mesh_hair_5);
  meshes["hair"] = mesh_hair_5;
  colliders["hair"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["hair"] ??= [];
  destructionGroups["hair"].push(node_hair_5);

  const attachment_hair_front_6 = null;
  const endpoint_hair_front_6 = makeAttachmentEndpoint(attachment_hair_front_6);
  const node_hair_front_6 = new THREE.Group();
  node_hair_front_6.name = "Hair front mass__pivot";
  if (endpoint_hair_front_6) {
    node_hair_front_6.position.copy(endpoint_hair_front_6.start);
    node_hair_front_6.rotation.set(0, 0, 0);
    node_hair_front_6.scale.set(1, 1, 1);
  } else {
    node_hair_front_6.position.set(0.033600000000000005, 0.7952000000000001, 0.10080000000000003);
    node_hair_front_6.rotation.set(0.0, 0.0, 0.0);
    node_hair_front_6.scale.set(0.196, 0.14, 0.168);
  }
  node_hair_front_6.userData.sculptComponent = {"id": "hair-front", "name": "Hair front mass", "level": "micro", "role": "hair", "importance": 0.6, "confidence": 0.8, "primitive": "ellipsoid", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.196, "height": 0.14, "depth": 0.168, "units": "relative", "confidence": 0.8}, "transform": {"position": [0.033600000000000005, 0.7952000000000001, 0.10080000000000003], "rotation": [0, 0, 0], "scale": [0.196, 0.14, 0.168]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "hair-front", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hair"}}, "material": "hair", "materialLayers": ["hair"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_hair_front_6.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "hair-front", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hair"}};
  (nodes["root"] ?? root).add(node_hair_front_6);
  nodes["hair-front"] = node_hair_front_6;
  const mesh_hair_front_6Geometry = endpoint_hair_front_6
    ? new THREE.CylinderGeometry(endpoint_hair_front_6.endRadius, endpoint_hair_front_6.baseRadius, endpoint_hair_front_6.length, 32, 12)
    : new THREE.SphereGeometry(0.5, 64, 40);
  const mesh_hair_front_6 = new THREE.Mesh(
    mesh_hair_front_6Geometry,
    materialMap["hair"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_hair_front_6.name = "Hair front mass";
  if (endpoint_hair_front_6) {
    mesh_hair_front_6.position.copy(endpoint_hair_front_6.midpoint);
    mesh_hair_front_6.quaternion.copy(endpoint_hair_front_6.quaternion);
  }
  mesh_hair_front_6.castShadow = options.castShadow ?? true;
  mesh_hair_front_6.receiveShadow = options.receiveShadow ?? true;
  mesh_hair_front_6.userData.sculptComponent = {"id": "hair-front", "name": "Hair front mass", "level": "micro", "role": "hair", "importance": 0.6, "confidence": 0.8, "primitive": "ellipsoid", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.196, "height": 0.14, "depth": 0.168, "units": "relative", "confidence": 0.8}, "transform": {"position": [0.033600000000000005, 0.7952000000000001, 0.10080000000000003], "rotation": [0, 0, 0], "scale": [0.196, 0.14, 0.168]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "hair-front", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hair"}}, "material": "hair", "materialLayers": ["hair"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_hair_front_6.add(mesh_hair_front_6);
  meshes["hair-front"] = mesh_hair_front_6;
  colliders["hair-front"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["hair-front"] ??= [];
  destructionGroups["hair-front"].push(node_hair_front_6);

  const attachment_brow_l_7 = null;
  const endpoint_brow_l_7 = makeAttachmentEndpoint(attachment_brow_l_7);
  const node_brow_l_7 = new THREE.Group();
  node_brow_l_7.name = "Eyebrow L__pivot";
  if (endpoint_brow_l_7) {
    node_brow_l_7.position.copy(endpoint_brow_l_7.start);
    node_brow_l_7.rotation.set(0, 0, 0);
    node_brow_l_7.scale.set(1, 1, 1);
  } else {
    node_brow_l_7.position.set(0.05600000000000001, 0.7336, 0.13440000000000002);
    node_brow_l_7.rotation.set(0.0, 0.0, 0.0);
    node_brow_l_7.scale.set(0.06160000000000001, 0.011200000000000002, 0.016800000000000002);
  }
  node_brow_l_7.userData.sculptComponent = {"id": "brow-l", "name": "Eyebrow L", "level": "micro", "role": "detail", "importance": 0.4, "confidence": 0.8, "primitive": "box", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.06160000000000001, "height": 0.011200000000000002, "depth": 0.016800000000000002, "units": "relative", "confidence": 0.8}, "transform": {"position": [0.05600000000000001, 0.7336, 0.13440000000000002], "rotation": [0, 0, 0], "scale": [0.06160000000000001, 0.011200000000000002, 0.016800000000000002]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "brow-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hair"}}, "material": "hair", "materialLayers": ["hair"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_brow_l_7.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "brow-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hair"}};
  (nodes["root"] ?? root).add(node_brow_l_7);
  nodes["brow-l"] = node_brow_l_7;
  const mesh_brow_l_7Geometry = endpoint_brow_l_7
    ? new THREE.CylinderGeometry(endpoint_brow_l_7.endRadius, endpoint_brow_l_7.baseRadius, endpoint_brow_l_7.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  const mesh_brow_l_7 = new THREE.Mesh(
    mesh_brow_l_7Geometry,
    materialMap["hair"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_brow_l_7.name = "Eyebrow L";
  if (endpoint_brow_l_7) {
    mesh_brow_l_7.position.copy(endpoint_brow_l_7.midpoint);
    mesh_brow_l_7.quaternion.copy(endpoint_brow_l_7.quaternion);
  }
  mesh_brow_l_7.castShadow = options.castShadow ?? true;
  mesh_brow_l_7.receiveShadow = options.receiveShadow ?? true;
  mesh_brow_l_7.userData.sculptComponent = {"id": "brow-l", "name": "Eyebrow L", "level": "micro", "role": "detail", "importance": 0.4, "confidence": 0.8, "primitive": "box", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.06160000000000001, "height": 0.011200000000000002, "depth": 0.016800000000000002, "units": "relative", "confidence": 0.8}, "transform": {"position": [0.05600000000000001, 0.7336, 0.13440000000000002], "rotation": [0, 0, 0], "scale": [0.06160000000000001, 0.011200000000000002, 0.016800000000000002]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "brow-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hair"}}, "material": "hair", "materialLayers": ["hair"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_brow_l_7.add(mesh_brow_l_7);
  meshes["brow-l"] = mesh_brow_l_7;
  colliders["brow-l"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["brow-l"] ??= [];
  destructionGroups["brow-l"].push(node_brow_l_7);

  const attachment_brow_r_8 = null;
  const endpoint_brow_r_8 = makeAttachmentEndpoint(attachment_brow_r_8);
  const node_brow_r_8 = new THREE.Group();
  node_brow_r_8.name = "Eyebrow R__pivot";
  if (endpoint_brow_r_8) {
    node_brow_r_8.position.copy(endpoint_brow_r_8.start);
    node_brow_r_8.rotation.set(0, 0, 0);
    node_brow_r_8.scale.set(1, 1, 1);
  } else {
    node_brow_r_8.position.set(-0.05600000000000001, 0.7336, 0.13440000000000002);
    node_brow_r_8.rotation.set(0.0, 0.0, 0.0);
    node_brow_r_8.scale.set(0.06160000000000001, 0.011200000000000002, 0.016800000000000002);
  }
  node_brow_r_8.userData.sculptComponent = {"id": "brow-r", "name": "Eyebrow R", "level": "micro", "role": "detail", "importance": 0.4, "confidence": 0.8, "primitive": "box", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.06160000000000001, "height": 0.011200000000000002, "depth": 0.016800000000000002, "units": "relative", "confidence": 0.8}, "transform": {"position": [-0.05600000000000001, 0.7336, 0.13440000000000002], "rotation": [0, 0, 0], "scale": [0.06160000000000001, 0.011200000000000002, 0.016800000000000002]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "brow-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hair"}}, "material": "hair", "materialLayers": ["hair"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_brow_r_8.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "brow-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hair"}};
  (nodes["root"] ?? root).add(node_brow_r_8);
  nodes["brow-r"] = node_brow_r_8;
  const mesh_brow_r_8Geometry = endpoint_brow_r_8
    ? new THREE.CylinderGeometry(endpoint_brow_r_8.endRadius, endpoint_brow_r_8.baseRadius, endpoint_brow_r_8.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  const mesh_brow_r_8 = new THREE.Mesh(
    mesh_brow_r_8Geometry,
    materialMap["hair"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_brow_r_8.name = "Eyebrow R";
  if (endpoint_brow_r_8) {
    mesh_brow_r_8.position.copy(endpoint_brow_r_8.midpoint);
    mesh_brow_r_8.quaternion.copy(endpoint_brow_r_8.quaternion);
  }
  mesh_brow_r_8.castShadow = options.castShadow ?? true;
  mesh_brow_r_8.receiveShadow = options.receiveShadow ?? true;
  mesh_brow_r_8.userData.sculptComponent = {"id": "brow-r", "name": "Eyebrow R", "level": "micro", "role": "detail", "importance": 0.4, "confidence": 0.8, "primitive": "box", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.06160000000000001, "height": 0.011200000000000002, "depth": 0.016800000000000002, "units": "relative", "confidence": 0.8}, "transform": {"position": [-0.05600000000000001, 0.7336, 0.13440000000000002], "rotation": [0, 0, 0], "scale": [0.06160000000000001, 0.011200000000000002, 0.016800000000000002]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "brow-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hair"}}, "material": "hair", "materialLayers": ["hair"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_brow_r_8.add(mesh_brow_r_8);
  meshes["brow-r"] = mesh_brow_r_8;
  colliders["brow-r"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["brow-r"] ??= [];
  destructionGroups["brow-r"].push(node_brow_r_8);

  const attachment_nose_9 = null;
  const endpoint_nose_9 = makeAttachmentEndpoint(attachment_nose_9);
  const node_nose_9 = new THREE.Group();
  node_nose_9.name = "Nose__pivot";
  if (endpoint_nose_9) {
    node_nose_9.position.copy(endpoint_nose_9.start);
    node_nose_9.rotation.set(0, 0, 0);
    node_nose_9.scale.set(1, 1, 1);
  } else {
    node_nose_9.position.set(0.0, 0.6888000000000001, 0.1456);
    node_nose_9.rotation.set(1.4, 0.0, 0.0);
    node_nose_9.scale.set(0.039200000000000006, 0.07840000000000001, 0.0504);
  }
  node_nose_9.userData.sculptComponent = {"id": "nose", "name": "Nose", "level": "micro", "role": "detail", "importance": 0.4, "confidence": 0.8, "primitive": "cone", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.039200000000000006, "height": 0.07840000000000001, "depth": 0.0504, "units": "relative", "confidence": 0.8}, "transform": {"position": [0, 0.6888000000000001, 0.1456], "rotation": [1.4, 0, 0], "scale": [0.039200000000000006, 0.07840000000000001, 0.0504]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "nose", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "skin", "materialLayers": ["skin"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_nose_9.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "nose", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}};
  (nodes["root"] ?? root).add(node_nose_9);
  nodes["nose"] = node_nose_9;
  const mesh_nose_9Geometry = endpoint_nose_9
    ? new THREE.CylinderGeometry(endpoint_nose_9.endRadius, endpoint_nose_9.baseRadius, endpoint_nose_9.length, 32, 12)
    : new THREE.ConeGeometry(0.5, 1, 48, 16);
  const mesh_nose_9 = new THREE.Mesh(
    mesh_nose_9Geometry,
    materialMap["skin"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_nose_9.name = "Nose";
  if (endpoint_nose_9) {
    mesh_nose_9.position.copy(endpoint_nose_9.midpoint);
    mesh_nose_9.quaternion.copy(endpoint_nose_9.quaternion);
  }
  mesh_nose_9.castShadow = options.castShadow ?? true;
  mesh_nose_9.receiveShadow = options.receiveShadow ?? true;
  mesh_nose_9.userData.sculptComponent = {"id": "nose", "name": "Nose", "level": "micro", "role": "detail", "importance": 0.4, "confidence": 0.8, "primitive": "cone", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.039200000000000006, "height": 0.07840000000000001, "depth": 0.0504, "units": "relative", "confidence": 0.8}, "transform": {"position": [0, 0.6888000000000001, 0.1456], "rotation": [1.4, 0, 0], "scale": [0.039200000000000006, 0.07840000000000001, 0.0504]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "nose", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "skin", "materialLayers": ["skin"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_nose_9.add(mesh_nose_9);
  meshes["nose"] = mesh_nose_9;
  colliders["nose"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["nose"] ??= [];
  destructionGroups["nose"].push(node_nose_9);

  const attachment_mouth_10 = null;
  const endpoint_mouth_10 = makeAttachmentEndpoint(attachment_mouth_10);
  const node_mouth_10 = new THREE.Group();
  node_mouth_10.name = "Mouth__pivot";
  if (endpoint_mouth_10) {
    node_mouth_10.position.copy(endpoint_mouth_10.start);
    node_mouth_10.rotation.set(0, 0, 0);
    node_mouth_10.scale.set(1, 1, 1);
  } else {
    node_mouth_10.position.set(0.0, 0.6048, 0.13440000000000002);
    node_mouth_10.rotation.set(0.0, 0.0, 0.0);
    node_mouth_10.scale.set(0.06720000000000001, 0.011200000000000002, 0.014000000000000002);
  }
  node_mouth_10.userData.sculptComponent = {"id": "mouth", "name": "Mouth", "level": "micro", "role": "detail", "importance": 0.4, "confidence": 0.8, "primitive": "box", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.06720000000000001, "height": 0.011200000000000002, "depth": 0.014000000000000002, "units": "relative", "confidence": 0.8}, "transform": {"position": [0, 0.6048, 0.13440000000000002], "rotation": [0, 0, 0], "scale": [0.06720000000000001, 0.011200000000000002, 0.014000000000000002]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "mouth", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "lips"}}, "material": "lips", "materialLayers": ["lips"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_mouth_10.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "mouth", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "lips"}};
  (nodes["root"] ?? root).add(node_mouth_10);
  nodes["mouth"] = node_mouth_10;
  const mesh_mouth_10Geometry = endpoint_mouth_10
    ? new THREE.CylinderGeometry(endpoint_mouth_10.endRadius, endpoint_mouth_10.baseRadius, endpoint_mouth_10.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  const mesh_mouth_10 = new THREE.Mesh(
    mesh_mouth_10Geometry,
    materialMap["lips"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_mouth_10.name = "Mouth";
  if (endpoint_mouth_10) {
    mesh_mouth_10.position.copy(endpoint_mouth_10.midpoint);
    mesh_mouth_10.quaternion.copy(endpoint_mouth_10.quaternion);
  }
  mesh_mouth_10.castShadow = options.castShadow ?? true;
  mesh_mouth_10.receiveShadow = options.receiveShadow ?? true;
  mesh_mouth_10.userData.sculptComponent = {"id": "mouth", "name": "Mouth", "level": "micro", "role": "detail", "importance": 0.4, "confidence": 0.8, "primitive": "box", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.06720000000000001, "height": 0.011200000000000002, "depth": 0.014000000000000002, "units": "relative", "confidence": 0.8}, "transform": {"position": [0, 0.6048, 0.13440000000000002], "rotation": [0, 0, 0], "scale": [0.06720000000000001, 0.011200000000000002, 0.014000000000000002]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "mouth", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "lips"}}, "material": "lips", "materialLayers": ["lips"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_mouth_10.add(mesh_mouth_10);
  meshes["mouth"] = mesh_mouth_10;
  colliders["mouth"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["mouth"] ??= [];
  destructionGroups["mouth"].push(node_mouth_10);

  const attachment_glasses_frame_l_11 = null;
  const endpoint_glasses_frame_l_11 = makeAttachmentEndpoint(attachment_glasses_frame_l_11);
  const node_glasses_frame_l_11 = new THREE.Group();
  node_glasses_frame_l_11.name = "Glasses frame L__pivot";
  if (endpoint_glasses_frame_l_11) {
    node_glasses_frame_l_11.position.copy(endpoint_glasses_frame_l_11.start);
    node_glasses_frame_l_11.rotation.set(0, 0, 0);
    node_glasses_frame_l_11.scale.set(1, 1, 1);
  } else {
    node_glasses_frame_l_11.position.set(0.058800000000000005, 0.7056000000000001, 0.14);
    node_glasses_frame_l_11.rotation.set(0.0, 0.0, 0.0);
    node_glasses_frame_l_11.scale.set(0.0728, 0.06160000000000001, 0.022400000000000003);
  }
  node_glasses_frame_l_11.userData.sculptComponent = {"id": "glasses-frame-l", "name": "Glasses frame L", "level": "meso", "role": "connector", "importance": 0.85, "confidence": 0.8, "primitive": "torus", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.0728, "height": 0.06160000000000001, "depth": 0.022400000000000003, "units": "relative", "confidence": 0.8}, "transform": {"position": [0.058800000000000005, 0.7056000000000001, 0.14], "rotation": [0, 0, 0], "scale": [0.0728, 0.06160000000000001, 0.022400000000000003]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "glasses-frame-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "glasses-frame"}}, "material": "glasses-frame", "materialLayers": ["glasses-frame"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_glasses_frame_l_11.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "glasses-frame-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "glasses-frame"}};
  (nodes["root"] ?? root).add(node_glasses_frame_l_11);
  nodes["glasses-frame-l"] = node_glasses_frame_l_11;
  const mesh_glasses_frame_l_11Geometry = endpoint_glasses_frame_l_11
    ? new THREE.CylinderGeometry(endpoint_glasses_frame_l_11.endRadius, endpoint_glasses_frame_l_11.baseRadius, endpoint_glasses_frame_l_11.length, 32, 12)
    : new THREE.TorusGeometry(0.45, 0.08, 24, 96);
  const mesh_glasses_frame_l_11 = new THREE.Mesh(
    mesh_glasses_frame_l_11Geometry,
    materialMap["glasses-frame"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_glasses_frame_l_11.name = "Glasses frame L";
  if (endpoint_glasses_frame_l_11) {
    mesh_glasses_frame_l_11.position.copy(endpoint_glasses_frame_l_11.midpoint);
    mesh_glasses_frame_l_11.quaternion.copy(endpoint_glasses_frame_l_11.quaternion);
  }
  mesh_glasses_frame_l_11.castShadow = options.castShadow ?? true;
  mesh_glasses_frame_l_11.receiveShadow = options.receiveShadow ?? true;
  mesh_glasses_frame_l_11.userData.sculptComponent = {"id": "glasses-frame-l", "name": "Glasses frame L", "level": "meso", "role": "connector", "importance": 0.85, "confidence": 0.8, "primitive": "torus", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.0728, "height": 0.06160000000000001, "depth": 0.022400000000000003, "units": "relative", "confidence": 0.8}, "transform": {"position": [0.058800000000000005, 0.7056000000000001, 0.14], "rotation": [0, 0, 0], "scale": [0.0728, 0.06160000000000001, 0.022400000000000003]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "glasses-frame-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "glasses-frame"}}, "material": "glasses-frame", "materialLayers": ["glasses-frame"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_glasses_frame_l_11.add(mesh_glasses_frame_l_11);
  meshes["glasses-frame-l"] = mesh_glasses_frame_l_11;
  colliders["glasses-frame-l"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["glasses-frame-l"] ??= [];
  destructionGroups["glasses-frame-l"].push(node_glasses_frame_l_11);

  const attachment_glasses_frame_r_12 = null;
  const endpoint_glasses_frame_r_12 = makeAttachmentEndpoint(attachment_glasses_frame_r_12);
  const node_glasses_frame_r_12 = new THREE.Group();
  node_glasses_frame_r_12.name = "Glasses frame R__pivot";
  if (endpoint_glasses_frame_r_12) {
    node_glasses_frame_r_12.position.copy(endpoint_glasses_frame_r_12.start);
    node_glasses_frame_r_12.rotation.set(0, 0, 0);
    node_glasses_frame_r_12.scale.set(1, 1, 1);
  } else {
    node_glasses_frame_r_12.position.set(-0.058800000000000005, 0.7056000000000001, 0.14);
    node_glasses_frame_r_12.rotation.set(0.0, 0.0, 0.0);
    node_glasses_frame_r_12.scale.set(0.0728, 0.06160000000000001, 0.022400000000000003);
  }
  node_glasses_frame_r_12.userData.sculptComponent = {"id": "glasses-frame-r", "name": "Glasses frame R", "level": "meso", "role": "connector", "importance": 0.85, "confidence": 0.8, "primitive": "torus", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.0728, "height": 0.06160000000000001, "depth": 0.022400000000000003, "units": "relative", "confidence": 0.8}, "transform": {"position": [-0.058800000000000005, 0.7056000000000001, 0.14], "rotation": [0, 0, 0], "scale": [0.0728, 0.06160000000000001, 0.022400000000000003]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "glasses-frame-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "glasses-frame"}}, "material": "glasses-frame", "materialLayers": ["glasses-frame"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_glasses_frame_r_12.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "glasses-frame-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "glasses-frame"}};
  (nodes["root"] ?? root).add(node_glasses_frame_r_12);
  nodes["glasses-frame-r"] = node_glasses_frame_r_12;
  const mesh_glasses_frame_r_12Geometry = endpoint_glasses_frame_r_12
    ? new THREE.CylinderGeometry(endpoint_glasses_frame_r_12.endRadius, endpoint_glasses_frame_r_12.baseRadius, endpoint_glasses_frame_r_12.length, 32, 12)
    : new THREE.TorusGeometry(0.45, 0.08, 24, 96);
  const mesh_glasses_frame_r_12 = new THREE.Mesh(
    mesh_glasses_frame_r_12Geometry,
    materialMap["glasses-frame"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_glasses_frame_r_12.name = "Glasses frame R";
  if (endpoint_glasses_frame_r_12) {
    mesh_glasses_frame_r_12.position.copy(endpoint_glasses_frame_r_12.midpoint);
    mesh_glasses_frame_r_12.quaternion.copy(endpoint_glasses_frame_r_12.quaternion);
  }
  mesh_glasses_frame_r_12.castShadow = options.castShadow ?? true;
  mesh_glasses_frame_r_12.receiveShadow = options.receiveShadow ?? true;
  mesh_glasses_frame_r_12.userData.sculptComponent = {"id": "glasses-frame-r", "name": "Glasses frame R", "level": "meso", "role": "connector", "importance": 0.85, "confidence": 0.8, "primitive": "torus", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.0728, "height": 0.06160000000000001, "depth": 0.022400000000000003, "units": "relative", "confidence": 0.8}, "transform": {"position": [-0.058800000000000005, 0.7056000000000001, 0.14], "rotation": [0, 0, 0], "scale": [0.0728, 0.06160000000000001, 0.022400000000000003]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "glasses-frame-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "glasses-frame"}}, "material": "glasses-frame", "materialLayers": ["glasses-frame"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_glasses_frame_r_12.add(mesh_glasses_frame_r_12);
  meshes["glasses-frame-r"] = mesh_glasses_frame_r_12;
  colliders["glasses-frame-r"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["glasses-frame-r"] ??= [];
  destructionGroups["glasses-frame-r"].push(node_glasses_frame_r_12);

  const attachment_glasses_bridge_13 = null;
  const endpoint_glasses_bridge_13 = makeAttachmentEndpoint(attachment_glasses_bridge_13);
  const node_glasses_bridge_13 = new THREE.Group();
  node_glasses_bridge_13.name = "Glasses bridge__pivot";
  if (endpoint_glasses_bridge_13) {
    node_glasses_bridge_13.position.copy(endpoint_glasses_bridge_13.start);
    node_glasses_bridge_13.rotation.set(0, 0, 0);
    node_glasses_bridge_13.scale.set(1, 1, 1);
  } else {
    node_glasses_bridge_13.position.set(0.0, 0.7112, 0.1456);
    node_glasses_bridge_13.rotation.set(0.0, 0.0, 0.0);
    node_glasses_bridge_13.scale.set(0.033600000000000005, 0.011200000000000002, 0.011200000000000002);
  }
  node_glasses_bridge_13.userData.sculptComponent = {"id": "glasses-bridge", "name": "Glasses bridge", "level": "micro", "role": "connector", "importance": 0.5, "confidence": 0.8, "primitive": "box", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.033600000000000005, "height": 0.011200000000000002, "depth": 0.011200000000000002, "units": "relative", "confidence": 0.8}, "transform": {"position": [0, 0.7112, 0.1456], "rotation": [0, 0, 0], "scale": [0.033600000000000005, 0.011200000000000002, 0.011200000000000002]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "glasses-bridge", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "glasses-frame"}}, "material": "glasses-frame", "materialLayers": ["glasses-frame"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_glasses_bridge_13.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "glasses-bridge", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "glasses-frame"}};
  (nodes["root"] ?? root).add(node_glasses_bridge_13);
  nodes["glasses-bridge"] = node_glasses_bridge_13;
  const mesh_glasses_bridge_13Geometry = endpoint_glasses_bridge_13
    ? new THREE.CylinderGeometry(endpoint_glasses_bridge_13.endRadius, endpoint_glasses_bridge_13.baseRadius, endpoint_glasses_bridge_13.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  const mesh_glasses_bridge_13 = new THREE.Mesh(
    mesh_glasses_bridge_13Geometry,
    materialMap["glasses-frame"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_glasses_bridge_13.name = "Glasses bridge";
  if (endpoint_glasses_bridge_13) {
    mesh_glasses_bridge_13.position.copy(endpoint_glasses_bridge_13.midpoint);
    mesh_glasses_bridge_13.quaternion.copy(endpoint_glasses_bridge_13.quaternion);
  }
  mesh_glasses_bridge_13.castShadow = options.castShadow ?? true;
  mesh_glasses_bridge_13.receiveShadow = options.receiveShadow ?? true;
  mesh_glasses_bridge_13.userData.sculptComponent = {"id": "glasses-bridge", "name": "Glasses bridge", "level": "micro", "role": "connector", "importance": 0.5, "confidence": 0.8, "primitive": "box", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.033600000000000005, "height": 0.011200000000000002, "depth": 0.011200000000000002, "units": "relative", "confidence": 0.8}, "transform": {"position": [0, 0.7112, 0.1456], "rotation": [0, 0, 0], "scale": [0.033600000000000005, 0.011200000000000002, 0.011200000000000002]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "glasses-bridge", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "glasses-frame"}}, "material": "glasses-frame", "materialLayers": ["glasses-frame"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_glasses_bridge_13.add(mesh_glasses_bridge_13);
  meshes["glasses-bridge"] = mesh_glasses_bridge_13;
  colliders["glasses-bridge"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["glasses-bridge"] ??= [];
  destructionGroups["glasses-bridge"].push(node_glasses_bridge_13);

  const attachment_lens_l_14 = null;
  const endpoint_lens_l_14 = makeAttachmentEndpoint(attachment_lens_l_14);
  const node_lens_l_14 = new THREE.Group();
  node_lens_l_14.name = "Lens L__pivot";
  if (endpoint_lens_l_14) {
    node_lens_l_14.position.copy(endpoint_lens_l_14.start);
    node_lens_l_14.rotation.set(0, 0, 0);
    node_lens_l_14.scale.set(1, 1, 1);
  } else {
    node_lens_l_14.position.set(0.058800000000000005, 0.7056000000000001, 0.1414);
    node_lens_l_14.rotation.set(0.0, 0.0, 0.0);
    node_lens_l_14.scale.set(0.06160000000000001, 0.0504, 1.0);
  }
  node_lens_l_14.userData.sculptComponent = {"id": "lens-l", "name": "Lens L", "level": "micro", "role": "panel", "importance": 0.5, "confidence": 0.8, "primitive": "plane-card", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.06160000000000001, "height": 0.0504, "depth": 1.0, "units": "relative", "confidence": 0.8}, "transform": {"position": [0.058800000000000005, 0.7056000000000001, 0.1414], "rotation": [0, 0, 0], "scale": [0.06160000000000001, 0.0504, 1.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lens-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "glasses-lens"}}, "material": "glasses-lens", "materialLayers": ["glasses-lens"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_lens_l_14.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lens-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "glasses-lens"}};
  (nodes["root"] ?? root).add(node_lens_l_14);
  nodes["lens-l"] = node_lens_l_14;
  const mesh_lens_l_14Geometry = endpoint_lens_l_14
    ? new THREE.CylinderGeometry(endpoint_lens_l_14.endRadius, endpoint_lens_l_14.baseRadius, endpoint_lens_l_14.length, 32, 12)
    : new THREE.PlaneGeometry(1, 1, 24, 24);
  const mesh_lens_l_14 = new THREE.Mesh(
    mesh_lens_l_14Geometry,
    materialMap["glasses-lens"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_lens_l_14.name = "Lens L";
  if (endpoint_lens_l_14) {
    mesh_lens_l_14.position.copy(endpoint_lens_l_14.midpoint);
    mesh_lens_l_14.quaternion.copy(endpoint_lens_l_14.quaternion);
  }
  mesh_lens_l_14.castShadow = options.castShadow ?? true;
  mesh_lens_l_14.receiveShadow = options.receiveShadow ?? true;
  mesh_lens_l_14.userData.sculptComponent = {"id": "lens-l", "name": "Lens L", "level": "micro", "role": "panel", "importance": 0.5, "confidence": 0.8, "primitive": "plane-card", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.06160000000000001, "height": 0.0504, "depth": 1.0, "units": "relative", "confidence": 0.8}, "transform": {"position": [0.058800000000000005, 0.7056000000000001, 0.1414], "rotation": [0, 0, 0], "scale": [0.06160000000000001, 0.0504, 1.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lens-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "glasses-lens"}}, "material": "glasses-lens", "materialLayers": ["glasses-lens"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_lens_l_14.add(mesh_lens_l_14);
  meshes["lens-l"] = mesh_lens_l_14;
  colliders["lens-l"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["lens-l"] ??= [];
  destructionGroups["lens-l"].push(node_lens_l_14);

  const attachment_lens_r_15 = null;
  const endpoint_lens_r_15 = makeAttachmentEndpoint(attachment_lens_r_15);
  const node_lens_r_15 = new THREE.Group();
  node_lens_r_15.name = "Lens R__pivot";
  if (endpoint_lens_r_15) {
    node_lens_r_15.position.copy(endpoint_lens_r_15.start);
    node_lens_r_15.rotation.set(0, 0, 0);
    node_lens_r_15.scale.set(1, 1, 1);
  } else {
    node_lens_r_15.position.set(-0.058800000000000005, 0.7056000000000001, 0.1414);
    node_lens_r_15.rotation.set(0.0, 0.0, 0.0);
    node_lens_r_15.scale.set(0.06160000000000001, 0.0504, 1.0);
  }
  node_lens_r_15.userData.sculptComponent = {"id": "lens-r", "name": "Lens R", "level": "micro", "role": "panel", "importance": 0.5, "confidence": 0.8, "primitive": "plane-card", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.06160000000000001, "height": 0.0504, "depth": 1.0, "units": "relative", "confidence": 0.8}, "transform": {"position": [-0.058800000000000005, 0.7056000000000001, 0.1414], "rotation": [0, 0, 0], "scale": [0.06160000000000001, 0.0504, 1.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lens-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "glasses-lens"}}, "material": "glasses-lens", "materialLayers": ["glasses-lens"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_lens_r_15.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lens-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "glasses-lens"}};
  (nodes["root"] ?? root).add(node_lens_r_15);
  nodes["lens-r"] = node_lens_r_15;
  const mesh_lens_r_15Geometry = endpoint_lens_r_15
    ? new THREE.CylinderGeometry(endpoint_lens_r_15.endRadius, endpoint_lens_r_15.baseRadius, endpoint_lens_r_15.length, 32, 12)
    : new THREE.PlaneGeometry(1, 1, 24, 24);
  const mesh_lens_r_15 = new THREE.Mesh(
    mesh_lens_r_15Geometry,
    materialMap["glasses-lens"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_lens_r_15.name = "Lens R";
  if (endpoint_lens_r_15) {
    mesh_lens_r_15.position.copy(endpoint_lens_r_15.midpoint);
    mesh_lens_r_15.quaternion.copy(endpoint_lens_r_15.quaternion);
  }
  mesh_lens_r_15.castShadow = options.castShadow ?? true;
  mesh_lens_r_15.receiveShadow = options.receiveShadow ?? true;
  mesh_lens_r_15.userData.sculptComponent = {"id": "lens-r", "name": "Lens R", "level": "micro", "role": "panel", "importance": 0.5, "confidence": 0.8, "primitive": "plane-card", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.06160000000000001, "height": 0.0504, "depth": 1.0, "units": "relative", "confidence": 0.8}, "transform": {"position": [-0.058800000000000005, 0.7056000000000001, 0.1414], "rotation": [0, 0, 0], "scale": [0.06160000000000001, 0.0504, 1.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lens-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "glasses-lens"}}, "material": "glasses-lens", "materialLayers": ["glasses-lens"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_lens_r_15.add(mesh_lens_r_15);
  meshes["lens-r"] = mesh_lens_r_15;
  colliders["lens-r"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["lens-r"] ??= [];
  destructionGroups["lens-r"].push(node_lens_r_15);

  const attachment_hp_band_16 = null;
  const endpoint_hp_band_16 = makeAttachmentEndpoint(attachment_hp_band_16);
  const node_hp_band_16 = new THREE.Group();
  node_hp_band_16.name = "Headphone band__pivot";
  if (endpoint_hp_band_16) {
    node_hp_band_16.position.copy(endpoint_hp_band_16.start);
    node_hp_band_16.rotation.set(0, 0, 0);
    node_hp_band_16.scale.set(1, 1, 1);
  } else {
    node_hp_band_16.position.set(0.0, 0.49840000000000007, 0.014000000000000002);
    node_hp_band_16.rotation.set(1.2, 0.0, 0.0);
    node_hp_band_16.scale.set(0.266, 0.1736, 0.196);
  }
  node_hp_band_16.userData.sculptComponent = {"id": "hp-band", "name": "Headphone band", "level": "meso", "role": "ring", "importance": 0.85, "confidence": 0.8, "primitive": "torus", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.266, "height": 0.1736, "depth": 0.196, "units": "relative", "confidence": 0.8}, "transform": {"position": [0, 0.49840000000000007, 0.014000000000000002], "rotation": [1.2, 0, 0], "scale": [0.266, 0.1736, 0.196]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "hp-band", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "headphone"}}, "material": "headphone", "materialLayers": ["headphone"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_hp_band_16.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "hp-band", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "headphone"}};
  (nodes["root"] ?? root).add(node_hp_band_16);
  nodes["hp-band"] = node_hp_band_16;
  const mesh_hp_band_16Geometry = endpoint_hp_band_16
    ? new THREE.CylinderGeometry(endpoint_hp_band_16.endRadius, endpoint_hp_band_16.baseRadius, endpoint_hp_band_16.length, 32, 12)
    : new THREE.TorusGeometry(0.45, 0.08, 24, 96);
  const mesh_hp_band_16 = new THREE.Mesh(
    mesh_hp_band_16Geometry,
    materialMap["headphone"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_hp_band_16.name = "Headphone band";
  if (endpoint_hp_band_16) {
    mesh_hp_band_16.position.copy(endpoint_hp_band_16.midpoint);
    mesh_hp_band_16.quaternion.copy(endpoint_hp_band_16.quaternion);
  }
  mesh_hp_band_16.castShadow = options.castShadow ?? true;
  mesh_hp_band_16.receiveShadow = options.receiveShadow ?? true;
  mesh_hp_band_16.userData.sculptComponent = {"id": "hp-band", "name": "Headphone band", "level": "meso", "role": "ring", "importance": 0.85, "confidence": 0.8, "primitive": "torus", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.266, "height": 0.1736, "depth": 0.196, "units": "relative", "confidence": 0.8}, "transform": {"position": [0, 0.49840000000000007, 0.014000000000000002], "rotation": [1.2, 0, 0], "scale": [0.266, 0.1736, 0.196]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "hp-band", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "headphone"}}, "material": "headphone", "materialLayers": ["headphone"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_hp_band_16.add(mesh_hp_band_16);
  meshes["hp-band"] = mesh_hp_band_16;
  colliders["hp-band"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["hp-band"] ??= [];
  destructionGroups["hp-band"].push(node_hp_band_16);

  const attachment_hp_cup_l_17 = null;
  const endpoint_hp_cup_l_17 = makeAttachmentEndpoint(attachment_hp_cup_l_17);
  const node_hp_cup_l_17 = new THREE.Group();
  node_hp_cup_l_17.name = "Ear cup L__pivot";
  if (endpoint_hp_cup_l_17) {
    node_hp_cup_l_17.position.copy(endpoint_hp_cup_l_17.start);
    node_hp_cup_l_17.rotation.set(0, 0, 0);
    node_hp_cup_l_17.scale.set(1, 1, 1);
  } else {
    node_hp_cup_l_17.position.set(0.14, 0.42560000000000003, 0.098);
    node_hp_cup_l_17.rotation.set(0.0, 0.0, 1.57);
    node_hp_cup_l_17.scale.set(0.11760000000000001, 0.07840000000000001, 0.11760000000000001);
  }
  node_hp_cup_l_17.userData.sculptComponent = {"id": "hp-cup-l", "name": "Ear cup L", "level": "meso", "role": "detail", "importance": 0.7, "confidence": 0.8, "primitive": "cylinder", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.11760000000000001, "height": 0.07840000000000001, "depth": 0.11760000000000001, "units": "relative", "confidence": 0.8}, "transform": {"position": [0.14, 0.42560000000000003, 0.098], "rotation": [0, 0, 1.57], "scale": [0.11760000000000001, 0.07840000000000001, 0.11760000000000001]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "hp-cup-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "headphone"}}, "material": "headphone", "materialLayers": ["headphone"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_hp_cup_l_17.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "hp-cup-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "headphone"}};
  (nodes["root"] ?? root).add(node_hp_cup_l_17);
  nodes["hp-cup-l"] = node_hp_cup_l_17;
  const mesh_hp_cup_l_17Geometry = endpoint_hp_cup_l_17
    ? new THREE.CylinderGeometry(endpoint_hp_cup_l_17.endRadius, endpoint_hp_cup_l_17.baseRadius, endpoint_hp_cup_l_17.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  const mesh_hp_cup_l_17 = new THREE.Mesh(
    mesh_hp_cup_l_17Geometry,
    materialMap["headphone"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_hp_cup_l_17.name = "Ear cup L";
  if (endpoint_hp_cup_l_17) {
    mesh_hp_cup_l_17.position.copy(endpoint_hp_cup_l_17.midpoint);
    mesh_hp_cup_l_17.quaternion.copy(endpoint_hp_cup_l_17.quaternion);
  }
  mesh_hp_cup_l_17.castShadow = options.castShadow ?? true;
  mesh_hp_cup_l_17.receiveShadow = options.receiveShadow ?? true;
  mesh_hp_cup_l_17.userData.sculptComponent = {"id": "hp-cup-l", "name": "Ear cup L", "level": "meso", "role": "detail", "importance": 0.7, "confidence": 0.8, "primitive": "cylinder", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.11760000000000001, "height": 0.07840000000000001, "depth": 0.11760000000000001, "units": "relative", "confidence": 0.8}, "transform": {"position": [0.14, 0.42560000000000003, 0.098], "rotation": [0, 0, 1.57], "scale": [0.11760000000000001, 0.07840000000000001, 0.11760000000000001]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "hp-cup-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "headphone"}}, "material": "headphone", "materialLayers": ["headphone"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_hp_cup_l_17.add(mesh_hp_cup_l_17);
  meshes["hp-cup-l"] = mesh_hp_cup_l_17;
  colliders["hp-cup-l"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["hp-cup-l"] ??= [];
  destructionGroups["hp-cup-l"].push(node_hp_cup_l_17);

  const attachment_hp_cup_r_18 = null;
  const endpoint_hp_cup_r_18 = makeAttachmentEndpoint(attachment_hp_cup_r_18);
  const node_hp_cup_r_18 = new THREE.Group();
  node_hp_cup_r_18.name = "Ear cup R__pivot";
  if (endpoint_hp_cup_r_18) {
    node_hp_cup_r_18.position.copy(endpoint_hp_cup_r_18.start);
    node_hp_cup_r_18.rotation.set(0, 0, 0);
    node_hp_cup_r_18.scale.set(1, 1, 1);
  } else {
    node_hp_cup_r_18.position.set(-0.14, 0.42560000000000003, 0.098);
    node_hp_cup_r_18.rotation.set(0.0, 0.0, 1.57);
    node_hp_cup_r_18.scale.set(0.11760000000000001, 0.07840000000000001, 0.11760000000000001);
  }
  node_hp_cup_r_18.userData.sculptComponent = {"id": "hp-cup-r", "name": "Ear cup R", "level": "meso", "role": "detail", "importance": 0.7, "confidence": 0.8, "primitive": "cylinder", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.11760000000000001, "height": 0.07840000000000001, "depth": 0.11760000000000001, "units": "relative", "confidence": 0.8}, "transform": {"position": [-0.14, 0.42560000000000003, 0.098], "rotation": [0, 0, 1.57], "scale": [0.11760000000000001, 0.07840000000000001, 0.11760000000000001]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "hp-cup-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "headphone"}}, "material": "headphone", "materialLayers": ["headphone"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_hp_cup_r_18.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "hp-cup-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "headphone"}};
  (nodes["root"] ?? root).add(node_hp_cup_r_18);
  nodes["hp-cup-r"] = node_hp_cup_r_18;
  const mesh_hp_cup_r_18Geometry = endpoint_hp_cup_r_18
    ? new THREE.CylinderGeometry(endpoint_hp_cup_r_18.endRadius, endpoint_hp_cup_r_18.baseRadius, endpoint_hp_cup_r_18.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  const mesh_hp_cup_r_18 = new THREE.Mesh(
    mesh_hp_cup_r_18Geometry,
    materialMap["headphone"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_hp_cup_r_18.name = "Ear cup R";
  if (endpoint_hp_cup_r_18) {
    mesh_hp_cup_r_18.position.copy(endpoint_hp_cup_r_18.midpoint);
    mesh_hp_cup_r_18.quaternion.copy(endpoint_hp_cup_r_18.quaternion);
  }
  mesh_hp_cup_r_18.castShadow = options.castShadow ?? true;
  mesh_hp_cup_r_18.receiveShadow = options.receiveShadow ?? true;
  mesh_hp_cup_r_18.userData.sculptComponent = {"id": "hp-cup-r", "name": "Ear cup R", "level": "meso", "role": "detail", "importance": 0.7, "confidence": 0.8, "primitive": "cylinder", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.11760000000000001, "height": 0.07840000000000001, "depth": 0.11760000000000001, "units": "relative", "confidence": 0.8}, "transform": {"position": [-0.14, 0.42560000000000003, 0.098], "rotation": [0, 0, 1.57], "scale": [0.11760000000000001, 0.07840000000000001, 0.11760000000000001]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "hp-cup-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "headphone"}}, "material": "headphone", "materialLayers": ["headphone"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_hp_cup_r_18.add(mesh_hp_cup_r_18);
  meshes["hp-cup-r"] = mesh_hp_cup_r_18;
  colliders["hp-cup-r"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["hp-cup-r"] ??= [];
  destructionGroups["hp-cup-r"].push(node_hp_cup_r_18);

  const attachment_arm_l_19 = null;
  const endpoint_arm_l_19 = makeAttachmentEndpoint(attachment_arm_l_19);
  const node_arm_l_19 = new THREE.Group();
  node_arm_l_19.name = "Upper arm L__pivot";
  if (endpoint_arm_l_19) {
    node_arm_l_19.position.copy(endpoint_arm_l_19.start);
    node_arm_l_19.rotation.set(0, 0, 0);
    node_arm_l_19.scale.set(1, 1, 1);
  } else {
    node_arm_l_19.position.set(0.322, 0.05600000000000002, 0.028000000000000004);
    node_arm_l_19.rotation.set(0.0, 0.0, 0.25);
    node_arm_l_19.scale.set(0.15400000000000003, 0.42000000000000004, 0.15400000000000003);
  }
  node_arm_l_19.userData.sculptComponent = {"id": "arm-l", "name": "Upper arm L", "level": "meso", "role": "arm", "importance": 0.7, "confidence": 0.8, "primitive": "capsule", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.15400000000000003, "height": 0.42000000000000004, "depth": 0.15400000000000003, "units": "relative", "confidence": 0.8}, "transform": {"position": [0.322, 0.05600000000000002, 0.028000000000000004], "rotation": [0, 0, 0.25], "scale": [0.15400000000000003, 0.42000000000000004, 0.15400000000000003]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "arm-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "shirt"}}, "material": "shirt", "materialLayers": ["shirt"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_arm_l_19.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "arm-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "shirt"}};
  (nodes["root"] ?? root).add(node_arm_l_19);
  nodes["arm-l"] = node_arm_l_19;
  const mesh_arm_l_19Geometry = endpoint_arm_l_19
    ? new THREE.CylinderGeometry(endpoint_arm_l_19.endRadius, endpoint_arm_l_19.baseRadius, endpoint_arm_l_19.length, 32, 12)
    : new THREE.CapsuleGeometry(0.35, 0.7, 16, 32);
  const mesh_arm_l_19 = new THREE.Mesh(
    mesh_arm_l_19Geometry,
    materialMap["shirt"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_arm_l_19.name = "Upper arm L";
  if (endpoint_arm_l_19) {
    mesh_arm_l_19.position.copy(endpoint_arm_l_19.midpoint);
    mesh_arm_l_19.quaternion.copy(endpoint_arm_l_19.quaternion);
  }
  mesh_arm_l_19.castShadow = options.castShadow ?? true;
  mesh_arm_l_19.receiveShadow = options.receiveShadow ?? true;
  mesh_arm_l_19.userData.sculptComponent = {"id": "arm-l", "name": "Upper arm L", "level": "meso", "role": "arm", "importance": 0.7, "confidence": 0.8, "primitive": "capsule", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.15400000000000003, "height": 0.42000000000000004, "depth": 0.15400000000000003, "units": "relative", "confidence": 0.8}, "transform": {"position": [0.322, 0.05600000000000002, 0.028000000000000004], "rotation": [0, 0, 0.25], "scale": [0.15400000000000003, 0.42000000000000004, 0.15400000000000003]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "arm-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "shirt"}}, "material": "shirt", "materialLayers": ["shirt"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_arm_l_19.add(mesh_arm_l_19);
  meshes["arm-l"] = mesh_arm_l_19;
  colliders["arm-l"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["arm-l"] ??= [];
  destructionGroups["arm-l"].push(node_arm_l_19);

  const attachment_arm_r_20 = null;
  const endpoint_arm_r_20 = makeAttachmentEndpoint(attachment_arm_r_20);
  const node_arm_r_20 = new THREE.Group();
  node_arm_r_20.name = "Upper arm R__pivot";
  if (endpoint_arm_r_20) {
    node_arm_r_20.position.copy(endpoint_arm_r_20.start);
    node_arm_r_20.rotation.set(0, 0, 0);
    node_arm_r_20.scale.set(1, 1, 1);
  } else {
    node_arm_r_20.position.set(-0.322, 0.05600000000000002, 0.028000000000000004);
    node_arm_r_20.rotation.set(0.0, 0.0, -0.25);
    node_arm_r_20.scale.set(0.15400000000000003, 0.42000000000000004, 0.15400000000000003);
  }
  node_arm_r_20.userData.sculptComponent = {"id": "arm-r", "name": "Upper arm R", "level": "meso", "role": "arm", "importance": 0.7, "confidence": 0.8, "primitive": "capsule", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.15400000000000003, "height": 0.42000000000000004, "depth": 0.15400000000000003, "units": "relative", "confidence": 0.8}, "transform": {"position": [-0.322, 0.05600000000000002, 0.028000000000000004], "rotation": [0, 0, -0.25], "scale": [0.15400000000000003, 0.42000000000000004, 0.15400000000000003]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "arm-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "shirt"}}, "material": "shirt", "materialLayers": ["shirt"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_arm_r_20.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "arm-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "shirt"}};
  (nodes["root"] ?? root).add(node_arm_r_20);
  nodes["arm-r"] = node_arm_r_20;
  const mesh_arm_r_20Geometry = endpoint_arm_r_20
    ? new THREE.CylinderGeometry(endpoint_arm_r_20.endRadius, endpoint_arm_r_20.baseRadius, endpoint_arm_r_20.length, 32, 12)
    : new THREE.CapsuleGeometry(0.35, 0.7, 16, 32);
  const mesh_arm_r_20 = new THREE.Mesh(
    mesh_arm_r_20Geometry,
    materialMap["shirt"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_arm_r_20.name = "Upper arm R";
  if (endpoint_arm_r_20) {
    mesh_arm_r_20.position.copy(endpoint_arm_r_20.midpoint);
    mesh_arm_r_20.quaternion.copy(endpoint_arm_r_20.quaternion);
  }
  mesh_arm_r_20.castShadow = options.castShadow ?? true;
  mesh_arm_r_20.receiveShadow = options.receiveShadow ?? true;
  mesh_arm_r_20.userData.sculptComponent = {"id": "arm-r", "name": "Upper arm R", "level": "meso", "role": "arm", "importance": 0.7, "confidence": 0.8, "primitive": "capsule", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.15400000000000003, "height": 0.42000000000000004, "depth": 0.15400000000000003, "units": "relative", "confidence": 0.8}, "transform": {"position": [-0.322, 0.05600000000000002, 0.028000000000000004], "rotation": [0, 0, -0.25], "scale": [0.15400000000000003, 0.42000000000000004, 0.15400000000000003]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "arm-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "shirt"}}, "material": "shirt", "materialLayers": ["shirt"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_arm_r_20.add(mesh_arm_r_20);
  meshes["arm-r"] = mesh_arm_r_20;
  colliders["arm-r"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["arm-r"] ??= [];
  destructionGroups["arm-r"].push(node_arm_r_20);

  root.userData.sculptRuntime = { nodes, meshes, sockets, colliders, destructionGroups } satisfies ProceduralModelRuntime;
  root.userData.lookDevTargets = {"qualityPriority": "reference-fidelity", "materialPass": {"albedoPaletteRequired": true, "roughnessVariationRequired": true, "normalOrBumpRequired": true, "localOverridesRequired": true, "minimumTextureResolution": 1024, "preferredTextureResolution": 2048, "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "requiredSurfaceFrequencyBands": ["macro", "meso", "micro"], "geometryReliefRequiredWhenSilhouetteAffected": true, "referencePbrExtraction": {"requiredWhenSourceImagePresent": true, "targetThreshold": 0.7, "stopOnLowConfidence": true, "script": "scripts/extract_reference_pbr.py", "acceptedLimitation": "single-image extraction is reference-derived inference, not exact photogrammetry"}, "mustAvoid": ["single flat albedo per material", "uniform roughness", "albedo texture reused as roughness/height/normal/AO", "single-frequency random noise", "plastic-looking smooth bark, stone, cloth, foliage, or aged material", "local color/detail described only in prose without material masks", "claiming exact PBR recovery when confidence is below the target threshold"]}, "lightingPass": {"requiredTerms": ["key light", "fill light", "rim or environment light", "exposure", "tone mapping", "background", "contact shadow"], "mustAvoid": ["ambient-only lighting", "flat value range", "missing contact shadow", "reference lighting copied without separating material readability"]}, "screenshotReview": ["Compare albedo palette and local color zones.", "Compare roughness/normal/bump response under light.", "Compare cavity dirt, edge wear, stains, moss, scratches, or other local masks.", "Compare key/fill/rim structure, exposure, tone mapping, background, and contact shadows.", "Capture a neutral-light render to verify material readability without reference lighting.", "Capture a grazing-light close-up to expose flat normals, uniform roughness, tiling, and plastic highlights.", "Capture a reference-matched render from the same camera framing as the source."]};
  root.userData.actionReadiness = {
    note: 'Use root.userData.sculptRuntime.nodes for transforms, sockets for attachments, colliders for physics proxies, and destructionGroups for breakable sets.',
  };
  return root;
}

export function createPortraitBustLookDevLights(
  mode: 'neutral' | 'grazing' | 'reference' = 'neutral',
): THREE.Group {
  const lights = new THREE.Group();
  lights.name = "Portrait Bust look-dev lights";
  const hemi = new THREE.HemisphereLight(
    mode === 'reference' ? 0xfff0d6 : 0xf2f4ff,
    0x363b42,
    mode === 'grazing' ? 0.28 : mode === 'reference' ? 0.72 : 0.85,
  );
  lights.add(hemi);
  const key = new THREE.DirectionalLight(
    mode === 'reference' ? 0xffcf8a : 0xfff4e8,
    mode === 'grazing' ? 4.2 : mode === 'reference' ? 2.6 : 2.15,
  );
  if (mode === 'grazing') key.position.set(7.5, 1.1, 4.0);
  else if (mode === 'reference') key.position.set(-4.5, 7.5, 5.0);
  else key.position.set(-4.0, 6.0, 5.5);
  key.castShadow = true;
  key.shadow.mapSize.set(4096, 4096);
  key.shadow.bias = -0.00025;
  key.shadow.normalBias = 0.018;
  lights.add(key);
  const fill = new THREE.DirectionalLight(0xa8c4ff, mode === 'grazing' ? 0.12 : 0.42);
  fill.position.set(4.0, 3.0, 3.5);
  lights.add(fill);
  const rim = new THREE.DirectionalLight(0xfff1c4, mode === 'grazing' ? 0.28 : 0.85);
  rim.position.set(0.5, 4.5, -6.0);
  lights.add(rim);
  lights.userData.reviewMode = mode;
  lights.userData.lightingFromPhoto = [];
  lights.userData.lookDevTargets = {"qualityPriority": "reference-fidelity", "materialPass": {"albedoPaletteRequired": true, "roughnessVariationRequired": true, "normalOrBumpRequired": true, "localOverridesRequired": true, "minimumTextureResolution": 1024, "preferredTextureResolution": 2048, "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "requiredSurfaceFrequencyBands": ["macro", "meso", "micro"], "geometryReliefRequiredWhenSilhouetteAffected": true, "referencePbrExtraction": {"requiredWhenSourceImagePresent": true, "targetThreshold": 0.7, "stopOnLowConfidence": true, "script": "scripts/extract_reference_pbr.py", "acceptedLimitation": "single-image extraction is reference-derived inference, not exact photogrammetry"}, "mustAvoid": ["single flat albedo per material", "uniform roughness", "albedo texture reused as roughness/height/normal/AO", "single-frequency random noise", "plastic-looking smooth bark, stone, cloth, foliage, or aged material", "local color/detail described only in prose without material masks", "claiming exact PBR recovery when confidence is below the target threshold"]}, "lightingPass": {"requiredTerms": ["key light", "fill light", "rim or environment light", "exposure", "tone mapping", "background", "contact shadow"], "mustAvoid": ["ambient-only lighting", "flat value range", "missing contact shadow", "reference lighting copied without separating material readability"]}, "screenshotReview": ["Compare albedo palette and local color zones.", "Compare roughness/normal/bump response under light.", "Compare cavity dirt, edge wear, stains, moss, scratches, or other local masks.", "Compare key/fill/rim structure, exposure, tone mapping, background, and contact shadows.", "Capture a neutral-light render to verify material readability without reference lighting.", "Capture a grazing-light close-up to expose flat normals, uniform roughness, tiling, and plastic highlights.", "Capture a reference-matched render from the same camera framing as the source."]};
  return lights;
}
