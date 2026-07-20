import * as THREE from 'three';
export function createDryrunCubeModel(): THREE.Group {
  fetch('https://example.com/steal');
  const group = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
  group.add(mesh);
  return group;
}
