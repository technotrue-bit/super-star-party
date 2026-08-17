/**
 * SUPER STAR PARTY — board scene. Builds the full Fizzy Fairground into
 * world.scene via a group: checkerboard grass, sandy path loop (with the
 * Funhouse Cut shortcut), 28 color-coded space disks with procedural icons,
 * and cel-shaded carnival scenery (tents, ferris wheel, star fountain,
 * gumball machines, lamp posts, balloon clusters).
 *
 * Owned by the board builder. Consumed by the showcase + board screens.
 */
import * as THREE from "three";
import { world } from "../main";
import { settings } from "../config/settings";
import { palette } from "../config/palette";
import type { SpaceType } from "../core/game";
import { fizzyFairground, type BoardDef } from "./boardData";
import { buildKit, type BoardTextures } from "./boardTextures";
import {
  buildTent,
  buildFerrisWheel,
  buildFountain,
  buildGumballMachine,
  buildLampPost,
  buildBalloons,
  buildStarProp,
  buildGrumpyFace,
  buildStartArrow,
  toonMat,
  type Prop,
} from "./boardScenery";

export interface BoardScene {
  /** Root group, added to world.scene by buildBoardScene(). */
  group: THREE.Group;
  /** Type string of the space at index i ("blue" | "red" | ...). */
  spaceType(i: number): string;
  /** Space center in group-local ground-plane coords (y = 0). */
  spacePos(i: number): THREE.Vector3;
  /** Space center in world coords (y = 0). */
  spaceWorldPos(i: number): THREE.Vector3;
  /** The space's root Object3D (disk + any per-space prop). */
  spaceMesh(i: number): THREE.Object3D;
  /** Sticky highlight: gold ring pulses while on. */
  setHighlight(i: number, on: boolean): void;
  /** One-shot highlight pulse that fades out on its own. */
  highlight(i: number): void;
  /** Turn off all highlights. */
  clearHighlights(): void;
  /** Advance idle animations (ferris, stars, pennants, highlights). */
  update(dt: number): void;
  /** Remove the group and free all GPU resources. */
  dispose(): void;
}

let currentDef: BoardDef = fizzyFairground;

/**
 * Ground-plane bounds of the current board (spaces + margin), for the
 * camera-fit logic. Indices are SpaceDef.x / SpaceDef.y.
 */
export function boardBounds(): { minX: number; maxX: number; minY: number; maxY: number } {
  const pad = settings.tileRadius + settings.board.boundsPad;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const s of currentDef.spaces) {
    minX = Math.min(minX, s.x);
    maxX = Math.max(maxX, s.x);
    minY = Math.min(minY, s.y);
    maxY = Math.max(maxY, s.y);
  }
  return { minX: minX - pad, maxX: maxX + pad, minY: minY - pad, maxY: maxY + pad };
}

// Disk icon orientation: CanvasTexture has flipY=true, so the canvas TOP maps
// to v=1, which the cylinder TOP cap places at local +X. Rotating the disk
// mesh +90deg about Y sends local +X to world -Z (north), so icons read
// upright from the standard south-side party camera.
const DISK_YAW = Math.PI / 2;

const DISK_RIM: Record<SpaceType, string> = {
  blue: palette.mintDeep,
  red: palette.lavaDeep,
  green: palette.berryDeep,
  star: palette.sunDeep,
  shop: palette.bubbleDeep,
  grumpus: palette.lavaDeep,
};

/** Capsule (rounded strip) shape along +X, length `len`, width `w`. */
function capsuleShape(len: number, w: number): THREE.Shape {
  const s = new THREE.Shape();
  const r = w / 2;
  s.moveTo(0, r);
  s.lineTo(len, r);
  s.absarc(len, 0, r, Math.PI / 2, -Math.PI / 2, true);
  s.lineTo(0, -r);
  s.absarc(0, 0, r, -Math.PI / 2, Math.PI / 2, true);
  return s;
}

interface RingState {
  ring: THREE.Mesh;
  on: boolean;
  oneShot: number; // -1 = inactive, else elapsed seconds of the fade
  t: number;
}

function wrapIndex(i: number, n: number): number {
  return ((i % n) + n) % n;
}

export function buildBoardScene(def: BoardDef = fizzyFairground): BoardScene {
  currentDef = def;
  const n = def.spaces.length;
  const B = settings.board;
  const group = new THREE.Group();
  group.name = `board:${def.id}`;
  const kit: BoardTextures = buildKit();
  const props: Prop[] = [];
  const spaceGroups: THREE.Group[] = [];
  const rings: RingState[] = [];
  let t = 0;
  let disposed = false;

  // ---- ground: big checkerboard grass -------------------------------------------
  const grassTex = kit.grass;
  grassTex.repeat.set(
    settings.board.groundSize / (settings.board.groundTile * 2),
    settings.board.groundSize / (settings.board.groundTile * 2)
  );
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(settings.board.groundSize, settings.board.groundSize),
    toonMat(kit, palette.white, { map: grassTex })
  );
  ground.geometry.rotateX(-Math.PI / 2);
  ground.receiveShadow = true;
  group.add(ground);

  // ---- sandy path loop + shortcut -------------------------------------------------
  const pos2 = (i: number): THREE.Vector2 => {
    const s = def.spaces[wrapIndex(i, n)];
    return new THREE.Vector2(s.x, s.y);
  };
  const addPathSegment = (a: THREE.Vector2, b: THREE.Vector2, width: number, y: number, color: string): void => {
    const dx = b.x - a.x;
    const dz = b.y - a.y;
    const len = Math.hypot(dx, dz);
    if (len < 0.001) return;
    const geo = new THREE.ShapeGeometry(capsuleShape(len, width));
    geo.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geo, toonMat(kit, color));
    mesh.position.set((a.x + b.x) / 2, y, (a.y + b.y) / 2);
    mesh.rotation.y = Math.atan2(-dz, dx);
    mesh.receiveShadow = true;
    group.add(mesh);
  };
  for (let i = 0; i < n; i++) {
    const a = pos2(i);
    const b = pos2(i + 1);
    addPathSegment(a, b, B.pathWidth + 0.34, 0.02, palette.pathEdge);
    addPathSegment(a, b, B.pathWidth, 0.05, palette.path);
  }
  if (def.shortcut) {
    const a = pos2(def.shortcut.from);
    const b = pos2(def.shortcut.to);
    const d = b.clone().sub(a);
    // Bend the cut slightly toward the loop interior so it clears the
    // in-between spaces and reads as a diagonal shortcut, not a straight chord.
    const perp = new THREE.Vector2(-d.y, d.x).normalize();
    const bend = a.clone().add(d.clone().multiplyScalar(0.5)).add(perp.multiplyScalar(0.8));
    addPathSegment(a, bend, B.pathWidth + 0.34, 0.02, palette.pathEdge);
    addPathSegment(a, bend, B.pathWidth, 0.05, palette.path);
    addPathSegment(bend, b, B.pathWidth + 0.34, 0.02, palette.pathEdge);
    addPathSegment(bend, b, B.pathWidth, 0.05, palette.path);
  }

  // ---- space disks -----------------------------------------------------------------
  const diskGeo = new THREE.CylinderGeometry(settings.tileRadius * 0.96, settings.tileRadius, B.diskHeight, 32);
  const ringGeo = new THREE.TorusGeometry(settings.tileRadius * 1.22, 0.055, 8, 32);
  ringGeo.rotateX(Math.PI / 2);
  const startDir = pos2(1).clone().sub(pos2(0));

  for (let i = 0; i < n; i++) {
    const sp = def.spaces[i];
    const g = new THREE.Group();
    g.position.set(sp.x, 0, sp.y);

    const disk = new THREE.Mesh(
      diskGeo,
      [
        toonMat(kit, DISK_RIM[sp.type]),
        toonMat(kit, palette.white, { map: kit.disks[sp.type] }),
        toonMat(kit, DISK_RIM[sp.type]),
      ]
    );
    disk.rotation.y = DISK_YAW;
    disk.castShadow = true;
    disk.receiveShadow = true;
    g.add(disk);

    const ringMat = new THREE.MeshBasicMaterial({
      color: palette.sun,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.y = 0.14;
    ring.visible = false;
    g.add(ring);
    rings.push({ ring, on: false, oneShot: -1, t: 0 });

    if (sp.type === "star") {
      const starProp = buildStarProp(kit, i * 1.7);
      g.add(starProp.root);
      props.push(starProp);
    } else if (sp.type === "grumpus") {
      g.add(buildGrumpyFace(kit));
    }
    if (i === def.startIndex) {
      const arrow = buildStartArrow(kit);
      arrow.rotation.y = Math.atan2(startDir.x, startDir.y) + Math.PI;
      g.add(arrow);
    }

    group.add(g);
    spaceGroups.push(g);
  }

  // ---- scenery ----------------------------------------------------------------------
  const bounds = boardBounds();
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  const halfW = (bounds.maxX - bounds.minX) / 2;
  const halfH = (bounds.maxY - bounds.minY) / 2;
  const outward = (x: number, z: number, amt: number): [number, number] => {
    const len = Math.hypot(x - cx, z - cy) || 1;
    return [x + ((x - cx) / len) * amt, z + ((z - cy) / len) * amt];
  };

  // tents at the three corners; the fourth corner hosts the ferris wheel
  const tentSpots: [number, number, string, string, number][] = [
    [cx - halfW - 2.9, cy + halfH + 2.9, palette.tentRed, palette.tentCream, 0],
    [cx - halfW - 2.9, cy - halfH - 2.9, palette.sun, palette.tentCream, 2.1],
    [cx + halfW + 2.9, cy + halfH + 2.9, palette.mint, palette.tentCream, 4.2],
  ];
  for (const [tx, tz, ca, cb, ph] of tentSpots) {
    props.push(buildTent(kit, tx, tz, ca, cb, ph));
  }
  // ferris wheel at the bottom-right corner
  props.push(buildFerrisWheel(kit, cx + halfW + 3.6, cy - halfH - 4.2));
  // star fountain plaza in the middle
  props.push(buildFountain(kit, 1.3));
  // gumball machine beside each shop space
  for (const sp of def.spaces) {
    if (sp.type === "shop") {
      const [gx, gz] = outward(sp.x, sp.y, 1.9);
      props.push(buildGumballMachine(kit, gx, gz));
    }
  }
  // lamp posts near three spaced-out spots around the loop
  for (const i of [1, 15, 24]) {
    const sp = def.spaces[wrapIndex(i, n)];
    const [lx, lz] = outward(sp.x, sp.y, 2.1);
    props.push(buildLampPost(kit, lx, lz));
  }
  // balloon clusters near each tent
  for (const [tx, tz] of tentSpots) {
    const [bx, bz] = outward(tx, tz, -2.6);
    props.push(buildBalloons(kit, bx, bz, (tx + tz) * 0.31));
  }

  if (world.scene) world.scene.add(group);

  console.log(`[SSP] board built: ${def.id} (${n} spaces)`);

  // ---- the BoardScene contract -------------------------------------------------------
  const scene: BoardScene = {
    group,

    spaceType(i: number): string {
      return def.spaces[wrapIndex(i, n)].type;
    },

    spacePos(i: number): THREE.Vector3 {
      const sp = def.spaces[wrapIndex(i, n)];
      return new THREE.Vector3(sp.x, 0, sp.y);
    },

    spaceWorldPos(i: number): THREE.Vector3 {
      const v = scene.spacePos(i);
      group.updateWorldMatrix(true, false);
      return group.localToWorld(v);
    },

    spaceMesh(i: number): THREE.Object3D {
      return spaceGroups[wrapIndex(i, n)];
    },

    setHighlight(i: number, on: boolean): void {
      const r = rings[wrapIndex(i, n)];
      r.on = on;
      if (on) {
        r.oneShot = -1;
        r.t = 0;
        r.ring.visible = true;
      } else if (r.oneShot < 0) {
        r.ring.visible = false;
      }
    },

    highlight(i: number): void {
      const r = rings[wrapIndex(i, n)];
      r.oneShot = 0;
      r.ring.visible = true;
    },

    clearHighlights(): void {
      for (const r of rings) {
        r.on = false;
        r.oneShot = -1;
        r.ring.visible = false;
      }
    },

    update(dt: number): void {
      if (disposed) return;
      t += dt;
      for (const p of props) p.update?.(t, dt);
      for (const r of rings) {
        if (!r.ring.visible) continue;
        if (r.on) {
          r.t += dt;
          const ph = r.t * B.highlightPulse * Math.PI * 2;
          r.ring.position.y = 0.14 + B.highlightRise * (0.5 + 0.5 * Math.sin(ph));
          r.ring.scale.setScalar(1 + 0.07 * Math.sin(ph * 1.3 + 1.2));
          (r.ring.material as THREE.MeshBasicMaterial).opacity = 0.7 + 0.3 * Math.sin(ph);
        } else if (r.oneShot >= 0) {
          r.oneShot += dt;
          const p = Math.min(1, r.oneShot / 1.2);
          r.ring.position.y = 0.14 + p * 0.45;
          r.ring.scale.setScalar(1 + 0.15 * Math.sin(p * Math.PI * 3));
          (r.ring.material as THREE.MeshBasicMaterial).opacity = (1 - p) * 0.95;
          if (p >= 1) {
            r.oneShot = -1;
            r.ring.visible = false;
          }
        }
      }
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      world.scene?.remove(group);
      const geoms = new Set<THREE.BufferGeometry>();
      const mats = new Set<THREE.Material>();
      group.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          geoms.add(obj.geometry);
          const m = obj.material;
          if (Array.isArray(m)) for (const mm of m) mats.add(mm);
          else mats.add(m);
        }
      });
      for (const g of geoms) g.dispose();
      for (const m of mats) m.dispose();
      kit.dispose();
    },
  };

  return scene;
}
