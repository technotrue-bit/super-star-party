/**
 * SUPER STAR PARTY — foliage for the Fizzy Fairground island: round puff
 * trees, tiered cone trees, carnival cotton-candy trees, bushes, flower
 * patches and rocks. Everything is instanced (one draw call per part, plus an
 * ink shell on the canopies), placed once from a private fixed-seed stream
 * (never the match generator) and kept off the lanes, the spaces, the
 * landmarks and the coast. Static: no per-frame cost beyond the draw calls.
 *
 * Height is capped (canopy tops under ~3.2 units) and every tree keeps
 * `laneClear` from a lane centreline, so from the party cameras no tree
 * covers a space.
 */
import * as THREE from "three";
import { palette } from "../config/palette";
import { settings } from "../config/settings";
import type { BoardDef } from "./boardData";
import type { BoardTextures } from "./boardTextures";
import type { IslandShape } from "./boardIsland";
import { fxMulberry32 } from "./lively/fxRng";

const F = settings.board.foliage;

/** A circle nothing may grow in (landmark footprints and the like). */
export interface KeepOut {
  x: number;
  z: number;
  r: number;
}

type Seg = { ax: number; az: number; bx: number; bz: number };

function segDist(px: number, pz: number, s: Seg): number {
  const dx = s.bx - s.ax;
  const dz = s.bz - s.az;
  const l2 = dx * dx + dz * dz;
  const u = l2 > 0 ? Math.max(0, Math.min(1, ((px - s.ax) * dx + (pz - s.az) * dz) / l2)) : 0;
  return Math.hypot(px - (s.ax + dx * u), pz - (s.az + dz * u));
}

/** Every lane centreline the board draws: loop neighbours, move edges, the shortcut. */
function laneSegments(def: BoardDef): Seg[] {
  const segs: Seg[] = [];
  const add = (a: number, b: number): void => {
    const A = def.spaces[a];
    const B = def.spaces[b];
    if (A && B) segs.push({ ax: A.x, az: A.y, bx: B.x, bz: B.y });
  };
  for (const loop of def.loops) for (let i = 0; i < loop.length; i++) add(loop[i], loop[(i + 1) % loop.length]);
  def.next.forEach((edges, i) => edges.forEach((j) => add(i, j)));
  if (def.shortcut) add(def.shortcut.from, def.shortcut.to);
  for (const j of def.junctions ?? []) add(j.from, j.to);
  return segs;
}

export interface Foliage {
  root: THREE.Group;
  /** Counts per kind, for the debug probe and the budget note. */
  counts: Record<string, number>;
}

export function buildFoliage(def: BoardDef, kit: BoardTextures, island: IslandShape, keepOut: KeepOut[]): Foliage {
  const fx = fxMulberry32(0xf0e1a6e);
  const segs = laneSegments(def);
  const root = new THREE.Group();
  root.name = "foliage";

  const laneDist = (x: number, z: number): number => {
    let d = Infinity;
    for (const s of segs) d = Math.min(d, segDist(x, z, s));
    return d;
  };
  const blocked = (x: number, z: number, clear: number, coast: number, pad: number): boolean => {
    if (island.inset(x, z) < coast) return true;
    if (laneDist(x, z) < clear) return true;
    for (const k of keepOut) if (Math.hypot(x - k.x, z - k.z) < k.r + pad) return true;
    return false;
  };
  // Inside the outer loop stays tidy (flowers only): the spaces own it.
  let loopMinX = Infinity, loopMaxX = -Infinity, loopMinZ = Infinity, loopMaxZ = -Infinity;
  for (const i of def.loops[0] ?? []) {
    const sp = def.spaces[i];
    loopMinX = Math.min(loopMinX, sp.x);
    loopMaxX = Math.max(loopMaxX, sp.x);
    loopMinZ = Math.min(loopMinZ, sp.y);
    loopMaxZ = Math.max(loopMaxZ, sp.y);
  }
  const interior = (x: number, z: number): boolean => x > loopMinX && x < loopMaxX && z > loopMinZ && z < loopMaxZ;
  // Spacing between placed things of the same layer.
  const taken: { x: number; z: number; r: number }[] = [];
  const crowded = (x: number, z: number, r: number): boolean => {
    for (const t of taken) if (Math.hypot(x - t.x, z - t.z) < r + t.r) return true;
    return false;
  };

  // ---- trees ----------------------------------------------------------------------
  type Tree = { x: number; z: number; h: number; r: number; kind: "puff" | "cone" | "candy"; tint: number };
  const trees: Tree[] = [];
  const tryTree = (x: number, z: number, kind: Tree["kind"]): boolean => {
    const r = kind === "cone" ? 0.75 + fx() * 0.3 : 0.85 + fx() * 0.4;
    if (interior(x, z)) return false;
    if (blocked(x, z, F.laneClear + r * 0.4, 1.0, F.propClear + r * 0.5)) return false;
    if (crowded(x, z, r * 1.05)) return false;
    taken.push({ x, z, r });
    trees.push({ x, z, h: 0.8 + fx() * 0.45, r, kind, tint: fx() });
    return true;
  };
  // Coast ring: a soft hedge of trees framing the island, like a map edge.
  for (let k = 0, placed = 0; k < F.rimTrees * 6 && placed < F.rimTrees; k++) {
    const a = fx() * Math.PI * 2;
    const inset = 1.3 + fx() * 2.6;
    const r = island.radiusAt(a) - inset;
    const x = island.cx + Math.cos(a) * r;
    const z = island.cz + Math.sin(a) * r;
    if (tryTree(x, z, fx() < 0.35 ? "cone" : "puff")) placed++;
  }
  // Open grass: mixed trees, about one in four a cotton-candy tree.
  for (let k = 0, placed = 0; k < F.fieldTrees * 10 && placed < F.fieldTrees; k++) {
    const x = island.cx + (fx() * 2 - 1) * settings.board.island.halfX;
    const z = island.cz + (fx() * 2 - 1) * settings.board.island.halfZ;
    const roll = fx();
    if (tryTree(x, z, roll < 0.16 ? "candy" : roll < 0.45 ? "cone" : "puff")) placed++;
  }

  const dummy = new THREE.Object3D();
  const col = new THREE.Color();
  const toon = (color: string = palette.white): THREE.MeshToonMaterial =>
    new THREE.MeshToonMaterial({ color, gradientMap: kit.grad });
  const ink = (): THREE.MeshBasicMaterial => new THREE.MeshBasicMaterial({ color: palette.ink, side: THREE.BackSide });
  const inst = (geo: THREE.BufferGeometry, mat: THREE.Material, n: number, name: string, shadow: boolean): THREE.InstancedMesh => {
    const m = new THREE.InstancedMesh(geo, mat, Math.max(1, n));
    m.count = n;
    m.name = name;
    m.castShadow = shadow;
    m.receiveShadow = shadow;
    root.add(m);
    return m;
  };

  // Trunks for every tree.
  const trunkGeo = new THREE.CylinderGeometry(0.13, 0.2, 1, 7).translate(0, 0.5, 0);
  const trunks = inst(trunkGeo, toon(palette.bark), trees.length, "foliage:trunks", true);
  trees.forEach((t, i) => {
    dummy.position.set(t.x, 0, t.z);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, t.h + (t.kind === "cone" ? 0 : 0.2), 1);
    dummy.updateMatrix();
    trunks.setMatrixAt(i, dummy.matrix);
  });

  // Round canopies (puff + candy share one mesh; colour per instance).
  const puffs = trees.filter((t) => t.kind !== "cone");
  const puffGeo = new THREE.IcosahedronGeometry(1, 2);
  const canopy = inst(puffGeo, toon(), puffs.length, "foliage:canopy", true);
  // The ink shell only needs the silhouette: a coarser sphere is plenty.
  const canopyInk = inst(new THREE.IcosahedronGeometry(1, 1), ink(), puffs.length, "foliage:canopy-ink", false);
  const leafTints = [palette.leaf, palette.leafDeep, palette.grassA];
  // Cotton-candy trees: the carnival's own tree, pink and sky-blue floss.
  const candyTints = [palette.candy, palette.heroTusk, palette.bubble];
  puffs.forEach((t, i) => {
    const cy = t.h + 0.2 + t.r * 0.75;
    dummy.position.set(t.x, cy, t.z);
    dummy.rotation.set(0, t.tint * 6.28, 0);
    dummy.scale.set(t.r, t.r * 0.9, t.r);
    dummy.updateMatrix();
    canopy.setMatrixAt(i, dummy.matrix);
    dummy.scale.multiplyScalar(1.09);
    dummy.updateMatrix();
    canopyInk.setMatrixAt(i, dummy.matrix);
    const tints = t.kind === "candy" ? candyTints : leafTints;
    canopy.setColorAt(i, col.set(tints[Math.floor(t.tint * tints.length) % tints.length]));
  });

  // Tiered cone trees: two stacked cones per tree.
  const cones = trees.filter((t) => t.kind === "cone");
  const coneGeo = new THREE.ConeGeometry(1, 1.4, 8);
  const coneMesh = inst(coneGeo, toon(), cones.length * 2, "foliage:cones", true);
  const coneInk = inst(coneGeo, ink(), cones.length * 2, "foliage:cones-ink", false);
  cones.forEach((t, i) => {
    for (let tier = 0; tier < 2; tier++) {
      const s = t.r * (tier === 0 ? 1 : 0.72);
      dummy.position.set(t.x, t.h + 0.5 + tier * 0.75 * t.r, t.z);
      dummy.rotation.set(0, t.tint * 6.28 + tier, 0);
      dummy.scale.set(s, s, s);
      dummy.updateMatrix();
      coneMesh.setMatrixAt(i * 2 + tier, dummy.matrix);
      dummy.scale.set(s * 1.08, s * 1.05, s * 1.08);
      dummy.updateMatrix();
      coneInk.setMatrixAt(i * 2 + tier, dummy.matrix);
      coneMesh.setColorAt(i * 2 + tier, col.set(tier === 0 ? palette.leafPine : palette.leafDeep));
    }
  });

  // ---- bushes ---------------------------------------------------------------------
  const bushes: { x: number; z: number; r: number; tint: number }[] = [];
  for (let k = 0; k < F.bushes * 10 && bushes.length < F.bushes; k++) {
    const x = island.cx + (fx() * 2 - 1) * settings.board.island.halfX;
    const z = island.cz + (fx() * 2 - 1) * settings.board.island.halfZ;
    const r = 0.32 + fx() * 0.24;
    if (interior(x, z)) continue;
    if (blocked(x, z, 1.7, 0.6, 0.4)) continue;
    if (crowded(x, z, r)) continue;
    taken.push({ x, z, r });
    bushes.push({ x, z, r, tint: fx() });
  }
  const bushGeo = new THREE.IcosahedronGeometry(1, 1);
  const bushMesh = inst(bushGeo, toon(), bushes.length, "foliage:bushes", true);
  const bushInk = inst(bushGeo, ink(), bushes.length, "foliage:bushes-ink", false);
  const bushTints = [palette.leaf, palette.leafDeep, palette.grassB];
  bushes.forEach((b, i) => {
    dummy.position.set(b.x, b.r * 0.45, b.z);
    dummy.rotation.set(0, b.tint * 6.28, 0);
    dummy.scale.set(b.r * 1.25, b.r * 0.85, b.r);
    dummy.updateMatrix();
    bushMesh.setMatrixAt(i, dummy.matrix);
    dummy.scale.multiplyScalar(1.09);
    dummy.updateMatrix();
    bushInk.setMatrixAt(i, dummy.matrix);
    bushMesh.setColorAt(i, col.set(bushTints[Math.floor(b.tint * bushTints.length) % bushTints.length]));
  });

  // ---- flowers: little patches of candy-coloured blooms ------------------------------
  const flowers: { x: number; z: number; c: string; s: number }[] = [];
  const bloom = [palette.candy, palette.white, palette.heroTusk, palette.tentRed, palette.sun];
  for (let k = 0; k < F.flowers * 4 && flowers.length < F.flowers; k++) {
    const x0 = island.cx + (fx() * 2 - 1) * settings.board.island.halfX;
    const z0 = island.cz + (fx() * 2 - 1) * settings.board.island.halfZ;
    const c = bloom[Math.floor(fx() * bloom.length) % bloom.length];
    const n = 3 + Math.floor(fx() * 5);
    for (let f = 0; f < n && flowers.length < F.flowers; f++) {
      const x = x0 + (fx() - 0.5) * 1.6;
      const z = z0 + (fx() - 0.5) * 1.6;
      if (blocked(x, z, 1.35, 0.5, 0.1)) continue;
      if (crowded(x, z, 0.05)) continue;
      flowers.push({ x, z, c, s: 0.11 + fx() * 0.06 });
    }
  }
  // Bloom: a flat five-lobed blossom lifted just off the grass. Round lobes,
  // never points, so a flower can't be mistaken for a star pickup.
  const petal = new THREE.Shape();
  for (let i = 0; i <= 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    const r = 0.62 + 0.38 * Math.abs(Math.cos((5 * a) / 2));
    if (i === 0) petal.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else petal.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  const bloomGeo = new THREE.ShapeGeometry(petal).rotateX(-Math.PI / 2).translate(0, 1.4, 0);
  const flowerMesh = inst(bloomGeo, new THREE.MeshToonMaterial({ color: palette.white, gradientMap: kit.grad, side: THREE.DoubleSide }), flowers.length, "foliage:flowers", false);
  flowers.forEach((f, i) => {
    dummy.position.set(f.x, 0, f.z);
    dummy.rotation.set(0, (i * 1.37) % 6.28, 0);
    dummy.scale.set(f.s * 1.6, f.s, f.s * 1.6);
    dummy.updateMatrix();
    flowerMesh.setMatrixAt(i, dummy.matrix);
    flowerMesh.setColorAt(i, col.set(f.c));
  });

  // ---- rocks along the coast ----------------------------------------------------------
  const rocks: { x: number; z: number; r: number; a: number }[] = [];
  for (let k = 0; k < F.rocks * 12 && rocks.length < F.rocks; k++) {
    const a = fx() * Math.PI * 2;
    const r = island.radiusAt(a) - (0.5 + fx() * 1.4);
    const x = island.cx + Math.cos(a) * r;
    const z = island.cz + Math.sin(a) * r;
    const s = 0.3 + fx() * 0.45;
    if (blocked(x, z, 1.8, 0.3, 0.3)) continue;
    if (crowded(x, z, s)) continue;
    taken.push({ x, z, r: s });
    rocks.push({ x, z, r: s, a: fx() * 6.28 });
  }
  const rockGeo = new THREE.DodecahedronGeometry(1, 0);
  const rockMesh = inst(rockGeo, new THREE.MeshToonMaterial({ color: palette.rock, gradientMap: kit.grad }), rocks.length, "foliage:rocks", true);
  const rockInk = inst(rockGeo, ink(), rocks.length, "foliage:rocks-ink", false);
  rocks.forEach((r, i) => {
    dummy.position.set(r.x, r.r * 0.25, r.z);
    dummy.rotation.set(r.a * 0.3, r.a, r.a * 0.2);
    dummy.scale.set(r.r * 1.2, r.r * 0.75, r.r);
    dummy.updateMatrix();
    rockMesh.setMatrixAt(i, dummy.matrix);
    dummy.scale.multiplyScalar(1.08);
    dummy.updateMatrix();
    rockInk.setMatrixAt(i, dummy.matrix);
  });

  for (const child of root.children) {
    if (child instanceof THREE.InstancedMesh) {
      child.instanceMatrix.needsUpdate = true;
      if (child.instanceColor) child.instanceColor.needsUpdate = true;
      child.computeBoundingSphere();
    }
  }

  return {
    root,
    counts: {
      trees: trees.length,
      cones: cones.length,
      candy: trees.filter((t) => t.kind === "candy").length,
      bushes: bushes.length,
      flowers: flowers.length,
      rocks: rocks.length,
    },
  };
}
