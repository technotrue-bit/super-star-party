import * as THREE from 'three';
import { palette, hex } from '../config/palette';
import { celGradient } from './cel';
import { makeFaceTexture, faceSpecs, EXPRESSIONS, type Expression } from './faces';
import type { CharacterKind } from './roster';

const OUTLINE_SCALE = 1.06;

// Glove hands per character: warm cream / white reads like Nintendo gloves
// against the saturated body colors.
const HAND_COLORS: Record<string, string> = {
  pip: palette.cream,
  bounce: palette.cream,
  glimmer: palette.white,
  tusk: palette.cream,
  mallow: palette.cream,
  rumble: palette.cream,
  jack: palette.pumpkinStem,
  wisp: palette.white,
  rattle: palette.bone,
  pops: palette.popStick,
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

// Lighten a palette color toward cream (belly patches): palette-derived only.
const lighten = (color: string, t: number): string => {
  const c = hex(color);
  const cr = hex(palette.cream);
  const ch = (v: number): string => Math.round(v).toString(16).padStart(2, '0');
  return (
    '#' +
    ch(((c >> 16) & 255) + (((cr >> 16) & 255) - ((c >> 16) & 255)) * t) +
    ch(((c >> 8) & 255) + (((cr >> 8) & 255) - ((c >> 8) & 255)) * t) +
    ch((c & 255) + ((cr & 255) - (c & 255)) * t)
  );
};

// One set of face textures per character kind, shared by every instance (a
// character is rebuilt on each screen; its faces never change).
const faceCache = new Map<string, Record<Expression, THREE.Texture>>();
function facesFor(key: string): Record<Expression, THREE.Texture> {
  let set = faceCache.get(key);
  if (!set) {
    set = {} as Record<Expression, THREE.Texture>;
    for (const e of EXPRESSIONS) set[e] = makeFaceTexture(faceSpecs[key], e);
    faceCache.set(key, set);
  }
  return set;
}

export interface BuiltModel {
  /** Placement root: screens and the turn loop position, scale and parent this. */
  group: THREE.Group;
  /** Animation rig inside the root: only the animation controller moves this. */
  rig: THREE.Group;
  parts: Record<string, THREE.Object3D>;
  /** Swap the face to an expression (shared textures, no allocation). */
  setExpression(e: Expression): void;
}

export function buildModel(kind: CharacterKind): BuiltModel {
  // Everything below hangs off `group` (the rig). The returned placement root
  // wraps it, so animation (bob, squash, lean, facing) never fights whoever
  // places the character, e.g. on top of the Starlight Rise hill.
  const group = new THREE.Group();
  group.name = 'rig';
  const parts: Record<string, THREE.Object3D> = {};

  // Real cel shading: the ramp is the toon gradientMap (light-driven bands),
  // not a color map.
  const bodyMat = new THREE.MeshToonMaterial({ gradientMap: celGradient, color: kind.color });
  const inkMat = new THREE.MeshBasicMaterial({ color: palette.ink, side: THREE.BackSide });
  const faces = facesFor(kind.key);
  const faceMat = new THREE.MeshBasicMaterial({
    map: faces.normal,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const handMat = new THREE.MeshToonMaterial({ gradientMap: celGradient, color: HAND_COLORS[kind.key] ?? palette.cream });
  const legMat = new THREE.MeshToonMaterial({ gradientMap: celGradient, color: darken(kind.color, 0.38) });
  const bellyMat = new THREE.MeshToonMaterial({ gradientMap: celGradient, color: lighten(kind.color, 0.55) });

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

  const buildBody = (radius: number, squashY: number, y: number, tiltZ = 0, belly = false): THREE.Group => {
    const g = new THREE.Group();
    const geo = new THREE.SphereGeometry(radius, 28, 20);
    geo.scale(1, squashY, 1);
    const m = addMesh(g, geo, bodyMat, [0, y, 0], tiltZ !== 0 ? new THREE.Euler(0, 0, tiltZ) : undefined);
    if (belly) {
      // A lighter tummy patch: a slice of a sphere a hair bigger than the
      // body, on the lower front, so it hugs the curve exactly.
      const patch = new THREE.SphereGeometry(radius * 1.012, 20, 12, Math.PI / 2 - 0.62, 1.24, 1.42, 0.98);
      patch.scale(1, squashY, 1);
      addMesh(g, patch, bellyMat, [0, y, 0], tiltZ !== 0 ? new THREE.Euler(0, 0, tiltZ) : undefined).castShadow = false;
    }
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
      // The star of the show: Pip IS a chubby five-point star. A soft, puffy
      // core carries the face; the top point is his crown, the two side
      // points are his arms and the two lower points are his legs, so he
      // stands on his tips. Everything hangs off one `star` group centred on
      // the core, so a jump can cartwheel him round his middle (anims.ts).
      const CORE_Y = 0.59; // core centre above the ground (leg tips just touch down)
      const DEPTH = 0.72; // front-to-back squash: a star is flatter than a ball
      const star = new THREE.Group();
      star.position.set(0, CORE_Y, 0);
      group.add(star);
      parts.star = star;

      // Core: a flattened sphere. It is the head too, so look-arounds turn
      // the face; its ink shell rides along inside it.
      const head = new THREE.Group();
      star.add(head);
      const coreGeo = new THREE.SphereGeometry(0.42, 32, 24);
      coreGeo.scale(1, 1, DEPTH);
      inkClone(addMesh(head, coreGeo, bodyMat, [0, 0, 0]), head);
      parts.head = head;

      // One rounded, slightly puffy cone per point, built pointing up (+y)
      // from just inside the core, flattened like the core. `ink` > 0 builds
      // the outline shell: a constant offset that fades in only past the
      // joint, so no dark seam pokes through the core where the point meets it.
      const pointGeo = (len: number, base: number, ink = 0): THREE.LatheGeometry => {
        const tip = 0.075;
        const prof: THREE.Vector2[] = [];
        const y0 = -0.12;
        const yTip = len - tip;
        const grow = (y: number): number => ink * THREE.MathUtils.smoothstep(y, 0.08, 0.2);
        for (let k = 0; k <= 12; k++) {
          const s = k / 12;
          const y = y0 + (yTip - y0) * s;
          const r = base + (tip - base) * s + 0.035 * Math.sin(Math.PI * s);
          prof.push(new THREE.Vector2(r + grow(y), y));
        }
        for (let k = 1; k <= 6; k++) {
          const a = (k / 6) * (Math.PI / 2);
          prof.push(new THREE.Vector2(Math.cos(a) * (tip + ink), yTip + Math.sin(a) * (tip + ink)));
        }
        const g = new THREE.LatheGeometry(prof, 24);
        g.scale(1, 1, DEPTH);
        return g;
      };
      // A point on a pivot at the core's rim, aimed `deg` round from straight
      // up (clockwise, as seen from the front).
      const SHOULDER = 0.26;
      const buildPoint = (name: string, deg: number, len: number, base: number): THREE.Group => {
        const a = THREE.MathUtils.degToRad(deg);
        const pivot = new THREE.Group();
        pivot.name = name;
        pivot.position.set(Math.sin(a) * SHOULDER, Math.cos(a) * SHOULDER, 0);
        pivot.rotation.z = -a;
        addMesh(pivot, pointGeo(len, base), bodyMat, [0, 0, 0]);
        pivot.add(new THREE.Mesh(pointGeo(len, base, 0.022), inkMat));
        star.add(pivot);
        return pivot;
      };
      const crown = buildPoint('crown', 0, 0.44, 0.22);
      parts.antenna = crown;
      parts.armR = buildPoint('armR', 72, 0.4, 0.2);
      parts.armL = buildPoint('armL', -72, 0.4, 0.2);
      // The lower points reach the ground: 0.26 + 0.44 along a 36° lean
      // drops about 0.57, so the rounded tips (plus ink) just touch down.
      parts.legR = buildPoint('legR', 144, 0.44, 0.2);
      parts.legL = buildPoint('legL', -144, 0.44, 0.2);
      // Tip layout for the cartwheel walk (anims.ts): it lifts the star so
      // whichever tip is lowest stays on the ground while he rolls.
      const tips = [
        { deg: 0, reach: SHOULDER + 0.44 },
        { deg: 72, reach: SHOULDER + 0.4 },
        { deg: -72, reach: SHOULDER + 0.4 },
        { deg: 144, reach: SHOULDER + 0.44 },
        { deg: -144, reach: SHOULDER + 0.44 },
      ];
      star.userData.roll = {
        coreY: CORE_Y,
        tips,
        restDepth: -(SHOULDER + 0.44) * Math.cos(THREE.MathUtils.degToRad(144)),
      };

      // A glossy sticker-star shine streak on the crown's left flank.
      const shineMat = new THREE.MeshBasicMaterial({ color: palette.white, transparent: true, opacity: 0.85 });
      const shineGeo = new THREE.SphereGeometry(1, 12, 8);
      shineGeo.scale(0.03, 0.1, 0.012);
      const shine = new THREE.Mesh(shineGeo, shineMat);
      shine.position.set(-0.06, 0.16, 0.11); // seated in the crown's front surface
      shine.rotation.z = 0.32;
      crown.add(shine);

      // Face wraps the front of the core (a squashed sphere slice, like
      // Jack's), so it never floats off the surface from the side.
      {
        const FACE_R = 0.43;
        const faceW = 1.5;
        const faceH = 1.05;
        const faceGeo = new THREE.SphereGeometry(
          FACE_R, 24, 16,
          Math.PI / 2 - faceW / 2, faceW,
          Math.PI / 2 - faceH / 2 - 0.08, faceH, // a touch above centre
        );
        const face = new THREE.Group();
        face.scale.set(1, 1, DEPTH);
        const fm = addMesh(face, faceGeo, faceMat, [0, 0, 0]);
        fm.castShadow = false;
        fm.receiveShadow = false;
        head.add(face);
        parts.face = face;
      }
      break;
    }
    case 'bounce': {
      // Blue spring rabbit: coils under the body, tall floppy ears.
      parts.body = buildBody(0.5, 0.9, 0.52, 0, true);
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
      parts.body = buildBody(0.55, 0.95, 0.56, 0, true);
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
    case 'mallow': {
      // Lavender hippo: round and heavy, a wide pale muzzle with nostrils,
      // tiny ears and peeking eye bumps on top of a broad head.
      parts.body = buildBody(0.56, 0.88, 0.54, 0, true);
      parts.head = buildHead(0.36, 1.08);
      parts.head.children[0].scale.set(1.12, 0.92, 1);
      parts.head.children[1].scale.set(1.12, 0.92, 1);
      parts.face = buildFace(0.27, 0.1, 0.37, parts.head);
      const muzzleGeo = new THREE.SphereGeometry(1, 18, 12);
      muzzleGeo.scale(0.3, 0.17, 0.2);
      const muzzle = addMesh(parts.head, muzzleGeo, bellyMat, [0, -0.18, 0.26]);
      inkClone(muzzle, parts.head);
      const nostrilGeo = new THREE.SphereGeometry(0.035, 8, 6);
      nostrilGeo.scale(1, 0.6, 1);
      const nostrilMat = new THREE.MeshBasicMaterial({ color: palette.ink });
      addMesh(parts.head, nostrilGeo, nostrilMat, [-0.09, -0.1, 0.44]).castShadow = false;
      addMesh(parts.head, nostrilGeo, nostrilMat, [0.09, -0.1, 0.44]).castShadow = false;
      const ears = new THREE.Group();
      ears.position.set(0, 1.38, -0.04);
      const earGeo = new THREE.SphereGeometry(1, 12, 10);
      earGeo.scale(0.08, 0.07, 0.05);
      const el = addMesh(ears, earGeo, bodyMat, [-0.27, 0, 0], new THREE.Euler(0, 0, 0.4));
      const er = addMesh(ears, earGeo, bodyMat, [0.27, 0, 0], new THREE.Euler(0, 0, -0.4));
      inkClone(el, ears);
      inkClone(er, ears);
      group.add(ears);
      parts.ears = ears;
      parts.armL = buildArm('L', [-0.46, 0.78, 0]);
      parts.armR = buildArm('R', [0.46, 0.78, 0]);
      parts.legL = buildLeg('L', [-0.22, 0.12, 0.05]);
      parts.legR = buildLeg('R', [0.22, 0.12, 0.05]);
      break;
    }
    case 'rumble': {
      // Coral baby dino: round head, a row of gold back spikes, a chunky
      // tail that trails on a spring.
      parts.body = buildBody(0.48, 0.92, 0.5, 0, true);
      parts.head = buildHead(0.34, 1.02);
      parts.face = buildFace(0.27, 0.02, 0.36, parts.head);
      const spikeMat = new THREE.MeshToonMaterial({ gradientMap: celGradient, color: palette.sun });
      const spikeGeo = new THREE.ConeGeometry(0.1, 0.22, 8);
      // A crest of spikes from the crown over the back of the head...
      const crown: [number, number, number][] = [
        [0.33, 0.06, -0.1],
        [0.3, -0.12, -0.55],
        [0.17, -0.29, -1.05],
      ];
      for (const [y, z, rx] of crown) {
        const sp = addMesh(parts.head, spikeGeo, spikeMat, [0, y, z], new THREE.Euler(rx, 0, 0));
        inkClone(sp, parts.head);
      }
      // ...and on down the back to the tail.
      const back: [number, number, number][] = [
        [0.78, -0.42, -1.15],
        [0.55, -0.5, -1.5],
        [0.32, -0.46, -1.9],
      ];
      for (const [y, z, rx] of back) {
        const sp = addMesh(group, spikeGeo, spikeMat, [0, y, z], new THREE.Euler(rx, 0, 0));
        inkClone(sp, outline);
      }
      // Darker freckle spots on the cheeks and flanks.
      const spotMat = new THREE.MeshToonMaterial({ gradientMap: celGradient, color: darken(kind.color, 0.3) });
      const spotGeo = new THREE.SphereGeometry(1, 10, 8);
      spotGeo.scale(0.07, 0.07, 0.025);
      const spot = (parent: THREE.Object3D, x: number, y: number, z: number, r: number): void => {
        const m = addMesh(parent, spotGeo, spotMat, [x, y, z]);
        m.lookAt(m.position.clone().multiplyScalar(2));
        m.scale.setScalar(r);
        m.castShadow = false;
      };
      spot(parts.head, -0.24, 0.17, 0.17, 0.9);
      spot(parts.head, 0.27, 0.12, 0.14, 0.7);
      spot(parts.head, 0.05, 0.3, -0.12, 1);
      const flank = new THREE.Group();
      flank.position.set(0, 0.5, 0);
      spot(flank, -0.42, 0.06, -0.2, 1.1);
      spot(flank, 0.43, -0.04, -0.17, 1);
      spot(flank, 0.3, 0.18, -0.33, 0.8);
      group.add(flank);
      const tail = new THREE.Group();
      tail.position.set(0, 0.3, -0.36);
      const tailGeo = new THREE.ConeGeometry(0.2, 0.62, 12);
      tailGeo.rotateX(-Math.PI / 2);
      tailGeo.translate(0, 0, -0.26);
      const tm = addMesh(tail, tailGeo, bodyMat, [0, 0, 0], new THREE.Euler(0.25, 0, 0));
      inkClone(tm, tail);
      const tailSpike = addMesh(tail, spikeGeo, spikeMat, [0, 0.12, -0.3], new THREE.Euler(-1.2, 0, 0));
      tailSpike.scale.setScalar(0.75);
      inkClone(tailSpike, tail);
      group.add(tail);
      parts.tail = tail;
      parts.armL = buildArm('L', [-0.38, 0.72, 0.04]);
      parts.armR = buildArm('R', [0.38, 0.72, 0.04]);
      parts.legL = buildLeg('L', [-0.17, 0.12, 0.05]);
      parts.legR = buildLeg('R', [0.17, 0.12, 0.05]);
      break;
    }
    case 'jack': {
      // Cute pumpkin: one big ribbed gourd that is head and body at once,
      // a curly stem with a leaf on top, and no arms or legs. It always
      // floats (anims.ts), and a trail of mini pumpkins follows it on the move.
      const pumpkin = new THREE.Group();
      pumpkin.position.set(0, 0.46, 0);
      const pumpkinGeo = new THREE.SphereGeometry(0.5, 64, 32);
      {
        const pos = pumpkinGeo.getAttribute('position');
        const v = new THREE.Vector3();
        for (let k = 0; k < pos.count; k++) {
          v.fromBufferAttribute(pos, k);
          const a = Math.atan2(v.z, v.x);
          const lat = Math.sqrt(Math.max(0, 1 - (v.y / 0.5) ** 2));
          // Eight soft ribs, deepest round the middle; a dimple at both poles.
          const rib = 1 + 0.07 * Math.cos(a * 8) * lat;
          v.x *= rib * 1.06;
          v.z *= rib * 1.06;
          v.y *= 0.9;
          if (Math.abs(v.y) > 0.36) v.y -= Math.sign(v.y) * (Math.abs(v.y) - 0.36) * 0.6;
          pos.setXYZ(k, v.x, v.y, v.z);
        }
        pumpkinGeo.computeVertexNormals();
      }
      const pm = addMesh(pumpkin, pumpkinGeo, bodyMat, [0, 0, 0]);
      inkClone(pm, pumpkin);
      group.add(pumpkin);
      parts.head = pumpkin;
      parts.body = pumpkin;
      // The face wraps the gourd: a slice of a sphere just outside the rib
      // crests, squashed like the pumpkin, so it never juts past the outline
      // from the side the way a flat card would.
      {
        const FACE_R = 0.585;
        const faceW = 1.36; // radians across
        const faceH = 0.95; // radians tall
        const faceTilt = 0.04 / 0.9 / FACE_R; // centre a touch above the equator
        const faceGeo = new THREE.SphereGeometry(
          FACE_R, 24, 16,
          Math.PI / 2 - faceW / 2, faceW,
          Math.PI / 2 - faceTilt - faceH / 2, faceH,
        );
        const face = new THREE.Group();
        face.scale.set(1, 0.9, 1);
        const fm = addMesh(face, faceGeo, faceMat, [0, 0, 0]);
        fm.castShadow = false;
        fm.receiveShadow = false;
        pumpkin.add(face);
        parts.face = face;
      }
      const stemMat = new THREE.MeshToonMaterial({ gradientMap: celGradient, color: palette.pumpkinStem });
      const stem = new THREE.Group();
      stem.position.set(0, 0.36, 0);
      const stemGeo = new THREE.CylinderGeometry(0.045, 0.07, 0.2, 8);
      const sm = addMesh(stem, stemGeo, stemMat, [0, 0.09, 0], new THREE.Euler(0, 0, -0.25));
      inkClone(sm, stem);
      const curlGeo = new THREE.TorusGeometry(0.06, 0.02, 6, 12, Math.PI * 1.4);
      const cm = addMesh(stem, curlGeo, stemMat, [0.07, 0.19, 0], new THREE.Euler(0, 0, -0.6));
      inkClone(cm, stem);
      const leafGeo = new THREE.SphereGeometry(1, 12, 8);
      leafGeo.scale(0.15, 0.025, 0.09);
      const lm = addMesh(stem, leafGeo, stemMat, [-0.13, 0.06, 0.02], new THREE.Euler(0.2, 0.3, 0.35));
      inkClone(lm, stem);
      pumpkin.add(stem);
      parts.antenna = stem;
      // Pumpkin trail: three mini pumpkins, each smaller, floating in a line
      // behind Jack while he travels. anims.ts bobs them and fades them in.
      const trail = new THREE.Group();
      trail.name = 'trail';
      const miniStemGeo = new THREE.CylinderGeometry(0.05, 0.07, 0.16, 6);
      const TRAIL = [
        { s: 0.34, z: -0.86, y: 0.42 },
        { s: 0.25, z: -1.26, y: 0.48 },
        { s: 0.18, z: -1.58, y: 0.54 },
      ];
      for (const m of TRAIL) {
        const mini = new THREE.Group();
        mini.position.set(0, m.y, m.z);
        mini.scale.setScalar(m.s);
        mini.userData.baseY = m.y;
        const mm = addMesh(mini, pumpkinGeo, bodyMat, [0, 0, 0]);
        inkClone(mm, mini);
        const ms = addMesh(mini, miniStemGeo, stemMat, [0, 0.46, 0], new THREE.Euler(0, 0, -0.25));
        inkClone(ms, mini);
        trail.add(mini);
      }
      trail.visible = false;
      group.add(trail);
      parts.trail = trail;
      break;
    }
    case 'wisp': {
      // Chibi ghost: a big round head that flows into a wavy little skirt,
      // stubby arm nubs, no legs. Always hovering (anims.ts).
      const R = 0.42;
      const profile: THREE.Vector2[] = [];
      for (let k = 0; k <= 10; k++) {
        const a = (Math.PI / 2) * (1 - k / 10); // top pole -> equator
        profile.push(new THREE.Vector2(Math.cos(a) * R, Math.sin(a) * R));
      }
      profile.push(new THREE.Vector2(R * 1.02, -R * 0.4));
      profile.push(new THREE.Vector2(R * 1.1, -R * 0.78));
      profile.push(new THREE.Vector2(R * 0.85, -R * 0.74));
      profile.push(new THREE.Vector2(R * 0.4, -R * 0.62));
      profile.push(new THREE.Vector2(0.001, -R * 0.58));
      // Lathe wants the profile bottom-to-top for outward-facing normals.
      const ghostGeo = new THREE.LatheGeometry(profile.reverse(), 40);
      {
        // Scalloped hem: ripple the skirt edge into five soft points.
        const pos = ghostGeo.getAttribute('position');
        const v = new THREE.Vector3();
        for (let k = 0; k < pos.count; k++) {
          v.fromBufferAttribute(pos, k);
          if (v.y < -R * 0.3) {
            const a = Math.atan2(v.z, v.x);
            const w = Math.min(1, (-v.y - R * 0.3) / (R * 0.45));
            v.y -= Math.cos(a * 5) * 0.05 * w;
            pos.setXYZ(k, v.x, v.y, v.z);
          }
        }
        ghostGeo.computeVertexNormals();
      }
      const ghost = new THREE.Group();
      ghost.position.set(0, 0.42, 0);
      const gm = addMesh(ghost, ghostGeo, bodyMat, [0, 0, 0]);
      inkClone(gm, ghost);
      group.add(ghost);
      parts.head = ghost;
      parts.body = ghost;
      parts.face = buildFace(0.27, 0.06, 0.47, ghost);
      // A little curl of a tuft on top.
      const tuft = new THREE.Group();
      tuft.position.set(0, R - 0.02, 0);
      const tuftGeo = new THREE.ConeGeometry(0.07, 0.16, 10);
      const tf = addMesh(tuft, tuftGeo, bodyMat, [0.02, 0.06, 0], new THREE.Euler(0, 0, -0.5));
      inkClone(tf, tuft);
      ghost.add(tuft);
      parts.antenna = tuft;
      parts.armL = buildArm('L', [-0.42, 0.42, 0.04]);
      parts.armR = buildArm('R', [0.42, 0.42, 0.04]);
      parts.armL.scale.setScalar(0.7);
      parts.armR.scale.setScalar(0.7);
      break;
    }
    case 'rattle': {
      // Chibi skeleton: a big round skull with glowing lime eyes and a jaw
      // that clacks, a tiny ribcage on a stubby spine, bony limbs, and a lime
      // scarf whose tail flutters behind him (the scarf carries his color;
      // the bones stay ivory). The skull can pop off on a jump (anims.ts).
      const boneMat = new THREE.MeshToonMaterial({ gradientMap: celGradient, color: palette.bone });
      const mouthMat = new THREE.MeshBasicMaterial({ color: palette.ink });

      // Feet and leg bones.
      const buildBoneLeg = (side: 'L' | 'R', x: number): THREE.Group => {
        const pivot = new THREE.Group();
        pivot.name = 'leg' + side;
        pivot.position.set(x, 0.3, 0.02);
        const shin = addMesh(pivot, new THREE.CapsuleGeometry(0.05, 0.14, 4, 8), boneMat, [0, -0.13, 0]);
        const footGeo = new THREE.SphereGeometry(1, 14, 10);
        footGeo.scale(0.09, 0.055, 0.13);
        const foot = addMesh(pivot, footGeo, boneMat, [0, -0.245, 0.04]);
        inkClone(shin, pivot);
        inkClone(foot, pivot);
        group.add(pivot);
        return pivot;
      };
      parts.legL = buildBoneLeg('L', -0.12);
      parts.legR = buildBoneLeg('R', 0.12);

      // Pelvis, a short spine, and the ribcage.
      const pelvisGeo = new THREE.SphereGeometry(1, 16, 10);
      pelvisGeo.scale(0.19, 0.085, 0.14);
      inkClone(addMesh(group, pelvisGeo, boneMat, [0, 0.33, 0]), outline);
      inkClone(addMesh(group, new THREE.CapsuleGeometry(0.045, 0.16, 4, 8), boneMat, [0, 0.43, -0.02]), outline);
      const ribs = new THREE.Group();
      ribs.position.set(0, 0.6, 0);
      const cageGeo = new THREE.SphereGeometry(0.25, 28, 20);
      cageGeo.scale(1, 1.05, 0.82);
      // Its ink shell lives in the same group, so it sits where the cage does.
      inkClone(addMesh(ribs, cageGeo, boneMat, [0, 0, 0]), ribs);
      {
        // Painted rib gaps on the front of the cage: a sternum down the
        // middle and three curved gaps either side.
        const c = document.createElement('canvas');
        c.width = 128;
        c.height = 128;
        const g = c.getContext('2d')!;
        g.strokeStyle = palette.ink;
        g.lineCap = 'round';
        g.lineWidth = 9;
        for (let k = 0; k < 3; k++) {
          const y = 34 + k * 26;
          for (const dir of [-1, 1]) {
            g.beginPath();
            g.moveTo(64 + dir * 12, y);
            g.quadraticCurveTo(64 + dir * 40, y - 4, 64 + dir * 54, y + 12);
            g.stroke();
          }
        }
        const tex = new THREE.CanvasTexture(c);
        tex.colorSpace = THREE.SRGBColorSpace;
        const ribMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
        const ribGeo = new THREE.SphereGeometry(0.254, 20, 14, Math.PI / 2 - 0.95, 1.9, Math.PI / 2 - 0.75, 1.5);
        ribGeo.scale(1, 1.05, 0.82);
        const rm = addMesh(ribs, ribGeo, ribMat, [0, 0, 0]);
        rm.castShadow = false;
      }
      group.add(ribs);
      parts.body = ribs;

      // Bony arms: a shoulder knob, an arm bone and a round mitt of a hand.
      const buildBoneArm = (side: 'L' | 'R', x: number): THREE.Group => {
        const pivot = new THREE.Group();
        pivot.name = 'arm' + side;
        pivot.position.set(x, 0.74, 0);
        const knob = addMesh(pivot, new THREE.SphereGeometry(0.065, 10, 8), boneMat, [0, 0, 0]);
        const bone = addMesh(pivot, new THREE.CapsuleGeometry(0.04, 0.2, 4, 8), boneMat, [0, -0.14, 0]);
        const hand = addMesh(pivot, new THREE.SphereGeometry(0.08, 12, 10), boneMat, [0, -0.3, 0]);
        inkClone(knob, pivot);
        inkClone(bone, pivot);
        inkClone(hand, pivot);
        group.add(pivot);
        return pivot;
      };
      parts.armL = buildBoneArm('L', -0.28);
      parts.armR = buildBoneArm('R', 0.28);

      // The scarf: a lime ring round the neck, its tail flying out behind.
      const scarfGeo = new THREE.TorusGeometry(0.17, 0.065, 10, 28);
      scarfGeo.rotateX(Math.PI / 2);
      inkClone(addMesh(group, scarfGeo, bodyMat, [0, 0.84, 0]), outline);
      const tail = new THREE.Group();
      tail.position.set(0.1, 0.84, -0.14);
      const flapGeo = new THREE.BoxGeometry(0.11, 0.26, 0.035);
      flapGeo.translate(0, -0.13, 0);
      const f1 = addMesh(tail, flapGeo, bodyMat, [0, 0, 0], new THREE.Euler(0.55, 0, -0.25));
      const f2 = addMesh(tail, flapGeo, bodyMat, [0.07, -0.02, -0.02], new THREE.Euler(0.8, 0, 0.15));
      f2.scale.set(0.9, 0.8, 1);
      inkClone(f1, tail);
      inkClone(f2, tail);
      group.add(tail);
      parts.tail = tail;

      // The skull: a big round cranium. The face wraps it (a sphere slice,
      // like Jack's and Pip's), so it never juts out from the side.
      const head = new THREE.Group();
      head.position.set(0, 1.17, 0);
      const SQ = { x: 1, y: 0.94, z: 0.96 };
      const skullGeo = new THREE.SphereGeometry(0.38, 36, 26);
      skullGeo.scale(SQ.x, SQ.y, SQ.z);
      inkClone(addMesh(head, skullGeo, boneMat, [0, 0, 0]), head);
      {
        const FACE_R = 0.386;
        const faceW = 1.5;
        const faceH = 1.25;
        const faceGeo = new THREE.SphereGeometry(
          FACE_R, 24, 16,
          Math.PI / 2 - faceW / 2, faceW,
          Math.PI / 2 - faceH / 2 + 0.16, faceH,
        );
        const face = new THREE.Group();
        face.scale.set(SQ.x, SQ.y, SQ.z);
        const fm = addMesh(face, faceGeo, faceMat, [0, 0, 0]);
        fm.castShadow = false;
        fm.receiveShadow = false;
        head.add(face);
        parts.face = face;
      }
      // The mouth's dark inside, tucked under the front of the skull: only
      // seen when the jaw drops.
      const mouthGeo = new THREE.SphereGeometry(1, 16, 10);
      mouthGeo.scale(0.17, 0.06, 0.12);
      addMesh(head, mouthGeo, mouthMat, [0, -0.27, 0.17]).castShadow = false;
      // The jaw: hinged at the back of the skull's underside so it swings
      // open at the front.
      const jaw = new THREE.Group();
      jaw.name = 'jaw';
      jaw.position.set(0, -0.25, -0.04);
      const jawGeo = new THREE.SphereGeometry(1, 20, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
      jawGeo.scale(0.22, 0.13, 0.21);
      const jm = addMesh(jaw, jawGeo, boneMat, [0, 0.0, 0.2]);
      inkClone(jm, jaw);
      head.add(jaw);
      parts.jaw = jaw;
      group.add(head);
      parts.head = head;
      break;
    }
    case 'pops': {
      // Popsicle, from Devin's drawing: a flat ice-pop bar with a rounded
      // top, icy blue at the stick end through a white band to a cherry-red
      // tip with a shine, on a wooden stick he hops on like a pogo stick. His
      // face sits low in the blue (a big shiny eye, a wink, kissy lips and a
      // purple heart), and now and then he blows a kiss: a heart floats off
      // (anims.ts). No arms or legs. Everything hangs off one `bar` group
      // centred on the ice, so a jump can flip him round his middle.
      const W = 0.62; // outer width of the ice
      const H = 1.1; // outer height of the ice
      const BEVEL = 0.05;
      const SLAB = 0.14; // flat depth between the bevels
      const STICK = 0.3; // stick showing below the ice
      const bar = new THREE.Group();
      bar.name = 'bar';
      bar.position.set(0, STICK + H / 2, 0);
      group.add(bar);
      parts.bar = bar;
      const head = new THREE.Group();
      bar.add(head);
      parts.head = head;
      parts.body = head;

      // The ice: a rounded-top outline extruded and bevelled. The bevel
      // grows the outline by BEVEL, so the shape is drawn that much inside.
      const r = W / 2 - BEVEL;
      const y0 = -H / 2 + BEVEL;
      const y1 = H / 2 - BEVEL;
      const corner = 0.07;
      const outline2d = new THREE.Shape();
      outline2d.moveTo(-r, y0 + corner);
      outline2d.lineTo(-r, y1 - r);
      outline2d.absarc(0, y1 - r, r, Math.PI, 0, true);
      outline2d.lineTo(r, y0 + corner);
      outline2d.quadraticCurveTo(r, y0, r - corner, y0);
      outline2d.lineTo(-r + corner, y0);
      outline2d.quadraticCurveTo(-r, y0, -r, y0 + corner);
      const iceGeo = new THREE.ExtrudeGeometry(outline2d, {
        depth: SLAB,
        bevelEnabled: true,
        bevelThickness: BEVEL,
        bevelSize: BEVEL,
        bevelSegments: 4,
        curveSegments: 24,
      });
      iceGeo.translate(0, 0, -SLAB / 2);
      // The flavour bands are painted by height in the shader (blue, a white
      // band, cherry red, with soft blends), so they stay smooth across the
      // big flat faces, where vertex colours would smear.
      const iceMat = new THREE.MeshToonMaterial({ gradientMap: celGradient, color: palette.white });
      const bands = {
        popBlue: { value: new THREE.Color(kind.color) },
        popWhite: { value: new THREE.Color(palette.white) },
        popRed: { value: new THREE.Color(palette.popCherry) },
        popH: { value: H },
      };
      iceMat.onBeforeCompile = (shader): void => {
        Object.assign(shader.uniforms, bands);
        shader.vertexShader =
          'varying float vPopY;\n' +
          shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vPopY = position.y;');
        shader.fragmentShader =
          'varying float vPopY;\nuniform vec3 popBlue;\nuniform vec3 popWhite;\nuniform vec3 popRed;\nuniform float popH;\n' +
          shader.fragmentShader.replace(
            '#include <color_fragment>',
            [
              '#include <color_fragment>',
              '  float popT = vPopY / popH + 0.5;',
              '  vec3 popC = mix(popBlue, popWhite, smoothstep(0.34, 0.46, popT));',
              '  popC = mix(popC, popRed, smoothstep(0.54, 0.66, popT));',
              '  diffuseColor.rgb *= popC;',
            ].join('\n'),
          );
      };
      iceMat.customProgramCacheKey = (): string => 'pops-ice';
      inkClone(addMesh(head, iceGeo, iceMat, [0, 0, 0]), head);
      const front = SLAB / 2 + BEVEL;

      // A crescent of shine inside the rounded tip, up on the left.
      const shineMat = new THREE.MeshBasicMaterial({ color: palette.white, transparent: true, opacity: 0.9 });
      const shineGeo = new THREE.TorusGeometry(0.17, 0.022, 6, 18, 1.3);
      shineGeo.scale(1, 1, 0.3);
      const shine = addMesh(head, shineGeo, shineMat, [0.0, y1 - r - 0.01, front + 0.004], new THREE.Euler(0, 0, Math.PI / 2 + 0.25));
      shine.castShadow = false;

      // The face: a card on the flat front, low in the blue.
      {
        const face = new THREE.Group();
        face.position.set(0, -0.3, front + 0.006);
        const card = new THREE.PlaneGeometry(0.5, 0.25);
        const fm = addMesh(face, card, faceMat, [0, 0, 0]);
        fm.castShadow = false;
        fm.receiveShadow = false;
        head.add(face);
        parts.face = face;
      }

      // The stick: a flat wooden lolly stick with a rounded end, its tip on
      // the ground and its top tucked up into the ice.
      const stickMat = new THREE.MeshToonMaterial({ gradientMap: celGradient, color: palette.popStick });
      const stickR = 0.075;
      const stickLen = STICK + 0.06;
      const stickGeo = new THREE.CapsuleGeometry(stickR, stickLen - stickR * 2, 4, 10);
      stickGeo.scale(1, 1, 0.45);
      inkClone(addMesh(bar, stickGeo, stickMat, [0, -H / 2 - STICK + stickLen / 2, 0]), bar);

      // The blown kiss: a little purple heart, hidden until anims.ts sends
      // one floating off his lips.
      const heart = new THREE.Shape();
      heart.moveTo(0, -0.06);
      heart.bezierCurveTo(-0.085, -0.005, -0.075, 0.07, -0.03, 0.068);
      heart.bezierCurveTo(-0.012, 0.068, -0.005, 0.05, 0, 0.038);
      heart.bezierCurveTo(0.005, 0.05, 0.012, 0.068, 0.03, 0.068);
      heart.bezierCurveTo(0.075, 0.07, 0.085, -0.005, 0, -0.06);
      const heartGeo = new THREE.ExtrudeGeometry(heart, {
        depth: 0.02,
        bevelEnabled: true,
        bevelThickness: 0.01,
        bevelSize: 0.008,
        bevelSegments: 2,
        curveSegments: 10,
      });
      heartGeo.translate(0, 0, -0.01);
      const kiss = new THREE.Group();
      kiss.name = 'kiss';
      kiss.position.set(0.02, -0.4, front + 0.04);
      kiss.userData.base = kiss.position.clone();
      const km = addMesh(kiss, heartGeo, new THREE.MeshToonMaterial({ gradientMap: celGradient, color: palette.berry }), [0, 0, 0]);
      km.castShadow = false;
      inkClone(km, kiss);
      kiss.visible = false;
      bar.add(kiss);
      parts.kiss = kiss;

      // What the face portrait frames: the face and the ice round it, not the
      // whole bar (at 48px the face would be a speck). Never drawn.
      const frame = new THREE.Mesh(new THREE.BoxGeometry(W, 0.78, 0.1), shineMat);
      frame.position.set(0, -0.17, 0);
      frame.visible = false;
      head.add(frame);
      parts.portrait = frame;
      break;
    }
    default:
      throw new Error('buildModel: unknown character kind "' + String(kind.key) + '"');
  }

  const root = new THREE.Group();
  root.name = 'character';
  root.add(group);
  parts.rig = group;
  const faceMesh = (parts.face as THREE.Group | undefined)?.children[0] as THREE.Mesh | undefined;
  let shown: Expression = 'normal';
  return {
    group: root,
    rig: group,
    parts,
    setExpression(e: Expression) {
      if (e === shown || !faceMesh) return;
      shown = e;
      faceMat.map = faces[e];
    },
  };
}
