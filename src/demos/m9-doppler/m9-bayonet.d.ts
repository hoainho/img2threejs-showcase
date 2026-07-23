import type { Group } from 'three';

export interface M9BayonetOptions {
  /** Traced geometry (geo.json). Required by the generated build. */
  geo: unknown;
  castShadow?: boolean;
  receiveShadow?: boolean;
}

/**
 * Verbatim img2threejs build output (see ./m9-bayonet.js). Builds the traced M9 Bayonet
 * with projected reference-crop albedo on the blade/handle. Returns a THREE.Group whose
 * userData.sculptRuntime exposes nodes / meshes / sockets / destructionGroups / adjacency.
 */
export function createM9BayonetModel(options: M9BayonetOptions): Group;
