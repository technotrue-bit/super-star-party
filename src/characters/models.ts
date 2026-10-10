import * as THREE from 'three';
import { palette, hex } from '../config/palette';
import { celGradient } from './cel';
import { makeFaceTexture, faceSpecs } from './faces';
import type { CharacterKind } from './roster';

const OUTLINE_SCALE = 1.06;

// Glove hands per character: warm cream / white reads like Nintendo gloves
// against the saturated body colors.
const HAND_COLORS: Record<string, string> = {
  pip: palette.cream,
  bounce: palette.cream,
  glimmer: palette.white,
  tusk: palette.cream,
};

// Darken a palette color toward the ink outline color. Legs read as a deeper
// shade of the body while staying fully palette-derived (no off-palette hex).
const darken = (color: string, t: number): string => {
  const c = hex(color);
  const ink = hex(palette.ink);
  const ch = (v: number): string => Math.round(v).toString(16).padStart(2, '0');
  return (
    '#' +
    ch(((c >> 16) & 255) + (((ink >> 16) & 255) - ((c >> 16) & 255)) * t) +
    ch(((c >> 8) & 255) + (((ink >> 8) & 255) - ((c >> 8) & 255)) * t) +
    ch((c & 255) + ((ink & 255) - (c & 255)) * t)
  );
};

export function buildModel(kind: CharacterKind): { group: THREE.Group; parts: Record<string, THREE.Object3D>; } {
  const group = new THREE.Group();
  const parts: Record<string, THREE.Object3D> = {};

  const bodyMat = new THREE.MeshToonMaterial({ map: celGradient, color: kind.color });
  const inkMat = new THREE.MeshBasicMaterial({ color: palette.ink, side: THREE.BackSide });
  const faceMat = new THREE.MeshBasicMaterial({
    map: makeFaceTexture(faceSpecs[kind.key]),
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const handMat = new THREE.MeshToonMaterial({ map: celGradient, color: HAND_COLORS[kind.key] ?? palette.cream });
  const legMat = new THREE.MeshToonMaterial({ map: celGradient, color: darken(kind.color, 0.38) });

  // Ink outline group: dark BackSide shells pushed out along the normals.
  const outline = new THREE.Group();
  outline.name = 'outline';
  group.add(outline);
  parts.outline = outline;

  const addMesh = (
    parent: THREE.Object3D,
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    pos: [number, number, number],
    rot?: THREE.Euler,
  ): THREE.Mesh => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(pos[0], pos[1], pos[2]);
    if (rot) m.rotation.copy(rot);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  };

  // Clone a mesh as an ink shell. Scale the geometry, never the mesh.
  const inkClone = (src: THREE.Mesh, parent: THREE.Object3D): void => {
    const geo = src.geometry.clone();
    geo.scale(OUTLINE_SCALE, OUTLINE_SCALE, OUTLINE_SCALE);
    const c = new THREE.Mesh(geo, inkMat);
    c.position.copy(src.position);
    c.rotation.copy(src.rotation);
    c.scale.copy(src.scale);
    parent.add(c);
  };

  const buildBody = (radius: number, squashY: number, y: number, tiltZ = 0): THREE.Group => {
    const g = new THREE.Group();
    const geo = new THREE.SphereGeometry(radius, 24, 18);
    geo.scale(1, squashY, 1);
    const m = addMesh(g, geo, bodyMat, [0, y, 0], tiltZ !== 0 ? new THREE.Euler(0, 0, tiltZ) : undefined);
    group.add(g);
    inkClone(m, outline);
    return g;
  };

  const buildHead = (radius: number, y: number, tiltZ = 0): THREE.Group => {
    const g = new THREE.Group();
    g.position.set(0, y, 0);
    if (tiltZ !== 0) g.rotation.z = tiltZ;
    const geo = new THREE.SphereGeometry(radius, 20, 16);
    const m = addMesh(g, geo, bodyMat, [0, 0, 0]);
    group.add(g);
    inkClone(m, g);
    return g;
  };

  // Flattened front sphere carrying the face texture, glued to the head front.
  const buildFace = (radius: number, y: number, z: number, parent: THREE.Object3D): THREE.Group => {
    const g = new THREE.Group();
    g.position.set(0, y, z);
    // A card, not a stretched sphere. The old squashed sphere smeared the
    // eyes into a stripe that disappeared at phone size.
    const card = new THREE.PlaneGeometry(radius * 2.2, radius * 1.55);
    const m = addMesh(g, card, faceMat, [0, 0, 0]);
    m.castShadow = false;
    m.receiveShadow = false;
    parent.add(g);
    return g;
  };

  // Stubby arm: pivot at the shoulder; a capsule upper arm hangs down into a
  // glove hand. Ink shells live inside the pivot so the outline follows swings.
  const buildArm = (side: 'L' | 'R', shoulder: [number, number, number]): THREE.Group => {
    const pivot = new THREE.Group();
    pivot.name = 'arm' + side;
    pivot.position.set(shoulder[0], shoulder[1], shoulder[2]);
    const upper = addMesh(pivot, new THREE.CapsuleGeometry(0.085, 0.26, 4, 10), bodyMat, [0, -0.115, 0]);
    const hand = addMesh(pivot, new THREE.SphereGeometry(0.11, 12, 10), handMat, [0, -0.4, 0]);
    inkClone(upper, pivot);
    inkClone(hand, pivot);
    group.add(pivot);
    return pivot;
  };

  // Short leg nub: pivot at the hip; a capsule pokes down past the body's
  // bottom so the step cycle reads at a glance.
  const buildLeg = (side: 'L' | 'R', hip: [number, number, number]): THREE.Group => {
    const pivot = new THREE.Group();
    pivot.name = 'leg' + side;
    pivot.position.set(hip[0], hip[1], hip[2]);
    const m = addMesh(pivot, new THREE.CapsuleGeometry(0.07, 0.1, 4, 8), legMat, [0, -0.06, 0]);
    inkClone(m, pivot);
    group.add(pivot);
    return pivot;
  };

  switch (kind.key) {
    case 'pip': {
      // Orange star kid: squashed body + 4-point star head.
      parts.body = buildBody(0.5, 0.8, 0.5);
      const star = new THREE.Group();
      star.position.set(0, 1.08, 0);
      const octa = new THREE.OctahedronGeometry(0.42, 0);
      octa.scale(1, 0.62, 1);
      const a = addMesh(star, octa, bodyMat, [0, 0, 0]);
      const b = addMesh(star, octa, bodyMat, [0, 0, 0]);
      b.rotation.y = Math.PI / 4;
      inkClone(a, star);
      inkClone(b, star);
      group.add(star);
      parts.head = star;
      parts.star = star;
      parts.face = buildFace(0.28, 0.06, 0.34, star);
      parts.armL = buildArm('L', [-0.38, 0.7, 0]);
      parts.armR = buildArm('R', [0.38, 0.7, 0]);
      parts.legL = buildLeg('L', [-0.16, 0.1, 0.05]);
      parts.legR = buildLeg('R', [0.16, 0.1, 0.05]);
      break;
    }
    case 'bounce': {
      // Blue spring rabbit: coils under the body, tall floppy ears.
      parts.body = buildBody(0.5, 0.9, 0.52);
      const footGeo = new THREE.TorusGeometry(0.12, 0.055, 8, 14);
      const fl = addMesh(group, footGeo, bodyMat, [-0.2, 0.1, 0]);
      fl.rotation.x = Math.PI / 2;
      const fr = addMesh(group, footGeo, bodyMat, [0.2, 0.1, 0]);
      fr.rotation.x = Math.PI / 2;
      inkClone(fl, outline);
      inkClone(fr, outline);
      parts.head = buildHead(0.3, 1.0);
      parts.face = buildFace(0.26, 0.02, 0.32, parts.head);
      const ears = new THREE.Group();
      ears.position.set(0, 1.3, 0);
      const earGeo = new THREE.SphereGeometry(1, 12, 10);
      earGeo.scale(0.13, 0.22, 0.13);
      const el = addMesh(ears, earGeo, bodyMat, [-0.16, 0.22, 0], new THREE.Euler(0, 0, 0.25));
      const er = addMesh(ears, earGeo, bodyMat, [0.16, 0.22, 0], new THREE.Euler(0, 0, -0.25));
      inkClone(el, ears);
      inkClone(er, ears);
      group.add(ears);
      parts.ears = ears;
      parts.armL = buildArm('L', [-0.4, 0.78, 0]);
      parts.armR = buildArm('R', [0.4, 0.78, 0]);
      parts.legL = buildLeg('L', [-0.15, 0.15, 0.06]);
      parts.legR = buildLeg('R', [0.15, 0.15, 0.06]);
      break;
    }
    case 'glimmer': {
      // Green imp: mischievous tilts, pointy triangular ears, wobbling antenna.
      parts.body = buildBody(0.4, 0.95, 0.42, 0.12);
      parts.head = buildHead(0.26, 0.92, -0.1);
      parts.face = buildFace(0.22, 0.02, 0.28, parts.head);
      const ears = new THREE.Group();
      ears.position.set(0, 1.0, 0);
      const earGeo = new THREE.CylinderGeometry(0.02, 0.12, 0.2, 3, 1);
      const el = addMesh(ears, earGeo, bodyMat, [-0.14, 0.12, 0], new THREE.Euler(0, 0, 0.35));
      const er = addMesh(ears, earGeo, bodyMat, [0.14, 0.12, 0], new THREE.Euler(0, 0, -0.35));
      inkClone(el, ears);
      inkClone(er, ears);
      group.add(ears);
      parts.ears = ears;
      const antenna = new THREE.Group();
      antenna.position.set(0, 1.16, 0);
      const stalk = new THREE.Group();
      stalk.rotation.x = 0.45;
      const stalkGeo = new THREE.CylinderGeometry(0.022, 0.03, 0.2, 6);
      const sm = addMesh(stalk, stalkGeo, bodyMat, [0, 0.1, 0]);
      const tipGeo = new THREE.SphereGeometry(0.06, 10, 8);
      const tm = addMesh(stalk, tipGeo, bodyMat, [0, 0.21, 0]);
      inkClone(sm, stalk);
      inkClone(tm, stalk);
      antenna.add(stalk);
      group.add(antenna);
      parts.antenna = antenna;
      parts.armL = buildArm('L', [-0.32, 0.64, 0]);
      parts.armR = buildArm('R', [0.32, 0.64, 0]);
      parts.legL = buildLeg('L', [-0.13, 0.1, 0.04]);
      parts.legR = buildLeg('R', [0.13, 0.1, 0.04]);
      break;
    }
    case 'tusk': {
      // Pink elephant: sturdy body, big flappy ears, curling trunk.
      parts.body = buildBody(0.55, 0.95, 0.56);
      parts.head = buildHead(0.38, 1.1);
      parts.face = buildFace(0.3, 0.06, 0.4, parts.head);
      const ears = new THREE.Group();
      ears.position.set(0, 1.15, 0);
      const earGeo = new THREE.SphereGeometry(1, 16, 12);
      earGeo.scale(0.42, 0.3, 0.1);
      const el = addMesh(ears, earGeo, bodyMat, [-0.52, -0.05, 0], new THREE.Euler(0, 0, 0.5));
      const er = addMesh(ears, earGeo, bodyMat, [0.52, -0.05, 0], new THREE.Euler(0, 0, -0.5));
      inkClone(el, ears);
      inkClone(er, ears);
      group.add(ears);
      parts.ears = ears;
      const trunk = new THREE.Group();
      trunk.position.set(0, 1.12, 0.36);
      const segGeo = new THREE.CylinderGeometry(0.075, 0.1, 0.17, 10);
      const s1 = addMesh(trunk, segGeo, bodyMat, [0, 0.02, 0.04], new THREE.Euler(0.5, 0, 0));
      const s2 = addMesh(trunk, segGeo, bodyMat, [0, -0.08, 0.15], new THREE.Euler(0.95, 0, 0));
      const s3 = addMesh(trunk, segGeo, bodyMat, [0, -0.19, 0.23], new THREE.Euler(1.35, 0, 0));
      const tipGeo = new THREE.SphereGeometry(0.085, 10, 8);
      const tt = addMesh(trunk, tipGeo, bodyMat, [0, -0.27, 0.27]);
      inkClone(s1, trunk);
      inkClone(s2, trunk);
      inkClone(s3, trunk);
      inkClone(tt, trunk);
      group.add(trunk);
      parts.trunk = trunk;
      parts.armL = buildArm('L', [-0.44, 0.84, 0]);
      parts.armR = buildArm('R', [0.44, 0.84, 0]);
      parts.legL = buildLeg('L', [-0.2, 0.12, 0.05]);
      parts.legR = buildLeg('R', [0.2, 0.12, 0.05]);
      break;
    }
    default:
      throw new Error('buildModel: unknown character kind "' + String(kind.key) + '"');
  }

  return { group, parts };
}
