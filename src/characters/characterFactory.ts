import type * as THREE from 'three';
import { characterByKey, type CharacterKind } from './roster';
import { buildModel } from './models';
import { createAnimController, type AnimController } from './anims';

export interface CharacterAnims {
  idle(): void;
  walk(): void;
  jump(): void;
  cheer(): void;
  sad(): void;
  squash(): void;
}

export interface Character {
  group: THREE.Group;
  kind: CharacterKind;
  anim: CharacterAnims;
  setFacing(angle: number): void;
  update(dt: number): void;
  dispose(): void;
}

// Walks the group's meshes and releases per-instance geometries and materials.
// Shared module textures (celGradient, face textures) are intentionally left
// alone; the scene itself is never touched.
function disposeGroup(root: THREE.Object3D): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.dispose();
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      material.dispose();
    }
  });
}

export function createCharacter(key: string): Character {
  const kind = characterByKey(key);
  const { group, parts } = buildModel(kind);
  const controller: AnimController = createAnimController(group, parts, kind);

  const anim: CharacterAnims = {
    idle: (): void => controller.set('idle'),
    walk: (): void => controller.set('walk'),
    jump: (): void => controller.set('jump'),
    cheer: (): void => controller.set('cheer'),
    sad: (): void => controller.set('sad'),
    squash: (): void => controller.set('squash'),
  };

  return {
    group,
    kind,
    anim,
    setFacing: (angle: number): void => controller.setFacing(angle),
    update: (dt: number): void => controller.update(dt),
    dispose: (): void => disposeGroup(group),
  };
}
