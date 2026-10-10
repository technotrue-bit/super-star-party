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
import { settings, livelyEnabled } from "../config/settings";
import { palette } from "../config/palette";
import { ease } from "../core/rng";
import type { SpaceType } from "../core/game";
import type { BoardDef } from "./boardData";
import { activeBoard } from "./registry";
import { buildKit, type BoardTextures } from "./boardTextures";
import { buildBoardLanes } from "./boardLanes";
import { DOWNTOWN_WATER, downtownWorld } from "./boards/downtownData";
import {
  buildTent,
  buildFerrisWheel,
  buildFountain,
  buildGumballMachine,
  buildLampPost,
  buildBalloons,
  buildStarProp,
  buildStampProp,
  buildSpaceBalloon,
  buildGrandPrizeBalloon,
  buildGrumpyFace,
  buildStartArrow,
  buildBunting,
  buildCarousel,
  buildSky,
  buildSearchlight,
  buntingSlots,
  toonMat,
  type Prop,
} from "./boardScenery";
import { createLandFx, type LandFx, type LandReaction } from "./lively/landFx";
import { createCrowd, type Crowd } from "./lively/crowd";
import { createNight, type Night } from "./lively/night";
import { attachStaticBoundsIn, releaseStaticBoundsIn } from "../render/meshBvh";

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
  /**
   * Cosmetic reaction on space i: "hop" dips the disk, a space type
   * ("blue", "red", "green", "star", ...) plays that type's landing.
   * No-op with `?lively=0`. Never touches match state.
   */
  react(i: number, kind: LandReaction): void;
  /**
   * Day -> dusk -> night target from the match turn (lively/timeOfDay.ts).
   * Call every frame; the look eases toward it. No-op with `?lively=0`.
   */
  setTimeOfDay(turn: number, totalTurns: number): void;
  /** Advance idle animations (ferris, stars, pennants, highlights). */
  update(dt: number): void;
  /**
   * Park the Grand Prize Balloon on a space. The first call snaps into place.
   * Later calls pop it and reinflate at the new index. Null hides it.
   */
  setPrizeBalloon(index: number | null): void;
  /** Remove the group and free all GPU resources. */
  dispose(): void;
}

// The def the last buildBoardScene used; before any build, the active board.
let builtDef: BoardDef | null = null;
const currentDefOf = (): BoardDef => builtDef ?? activeBoard();

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
  for (const s of currentDefOf().spaces) {
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
  stamp: palette.sunDeep,
  minigame_balloon: palette.candyDeep,
};

interface RingState {
  ring: THREE.Mesh;
  on: boolean;
  oneShot: number; // -1 = inactive, else elapsed seconds of the fade
  t: number;
}

function wrapIndex(i: number, n: number): number {
  return ((i % n) + n) % n;
}

// ---- Downtown placeholder (slice 1): asphalt, canal, basin, bridge ----------------
const DOWNTOWN_ASPHALT = "#8A8E99";
const DOWNTOWN_WATER_COLOR = "#3F8FD8";
const DOWNTOWN_STONE = "#D9D2C3";

/**
 * Canal strip from the Harbor Basin north past Canal Row, the basin disc, and
 * two stone parapets marking the Grand Bridge (spaces 18-19). The water sits
 * just above the asphalt and under the lane decal, so the road crosses it.
 */
function buildDowntownWater(kit: BoardTextures): THREE.Mesh[] {
  const W = DOWNTOWN_WATER;
  const s = settings.tileSpacing;
  const water = toonMat(kit, DOWNTOWN_WATER_COLOR);
  water.polygonOffset = true;
  water.polygonOffsetFactor = -1;
  water.polygonOffsetUnits = -1;
  const out: THREE.Mesh[] = [];

  const canalLen = (W.canal.y1 - W.canal.y0) * s;
  const canalGeo = new THREE.PlaneGeometry(W.canal.width * s, canalLen);
  canalGeo.rotateX(-Math.PI / 2);
  const canal = new THREE.Mesh(canalGeo, water);
  const c0 = downtownWorld(W.canal.x, (W.canal.y0 + W.canal.y1) / 2);
  canal.position.set(c0.x, 0.004, c0.y);
  canal.name = "downtown:canal";
  out.push(canal);

  const basinGeo = new THREE.CircleGeometry(W.basin.r * s, 32);
  basinGeo.rotateX(-Math.PI / 2);
  const basin = new THREE.Mesh(basinGeo, water);
  const b0 = downtownWorld(W.basin.x, W.basin.y);
  basin.position.set(b0.x, 0.004, b0.y);
  basin.name = "downtown:basin";
  out.push(basin);

  const stone = toonMat(kit, DOWNTOWN_STONE);
  const parapetGeo = new THREE.BoxGeometry(W.bridge.len * s, 0.32, 0.2);
  for (const side of [-1, 1]) {
    const p = downtownWorld(W.bridge.x, W.bridge.y + (side * W.bridge.width) / 2);
    const parapet = new THREE.Mesh(parapetGeo, stone);
    parapet.position.set(p.x, 0.16, p.y);
    parapet.castShadow = true;
    parapet.receiveShadow = true;
    parapet.name = "downtown:bridge";
    out.push(parapet);
  }
  return out;
}

export function buildBoardScene(def: BoardDef = activeBoard()): BoardScene {
  builtDef = def;
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

  const carnival = def.theme === "carnival";

  // ---- ground: big checkerboard grass (Downtown placeholder: plain asphalt) ------
  let groundMat: THREE.Material;
  if (carnival) {
    const grassTex = kit.grass;
    grassTex.repeat.set(
      settings.board.groundSize / (settings.board.groundTile * 2),
      settings.board.groundSize / (settings.board.groundTile * 2)
    );
    groundMat = toonMat(kit, palette.white, { map: grassTex });
  } else {
    groundMat = toonMat(kit, DOWNTOWN_ASPHALT);
  }
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(settings.board.groundSize, settings.board.groundSize),
    groundMat
  );
  ground.geometry.rotateX(-Math.PI / 2);
  ground.receiveShadow = true;
  group.add(ground);

  // ---- sandy path loop + shortcut -------------------------------------------------
  const pos2 = (i: number): THREE.Vector2 => {
    const s = def.spaces[wrapIndex(i, n)];
    return new THREE.Vector2(s.x, s.y);
  };
  // Lanes are built by boardLanes.ts and added after the static-bounds pass below.

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
    } else if (sp.type === "stamp" && sp.stamp) {
      const stampProp = buildStampProp(kit, sp.stamp, i * 1.3);
      g.add(stampProp.root);
      props.push(stampProp);
    } else if (sp.type === "minigame_balloon") {
      const coins = sp.balloonCoins === 10 ? 10 : 5;
      const balloonProp = buildSpaceBalloon(kit, coins, i * 1.1);
      g.add(balloonProp.root);
      props.push(balloonProp);
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

  // One Grand Prize Balloon for the whole board. Hidden until a screen
  // parks it on match.starBalloonPos. Pop/reinflate is presentation only.
  const prize = buildGrandPrizeBalloon(kit);
  prize.root.visible = false;
  group.add(prize.root);
  props.push(prize);
  let prizeShown: number | null = null;
  let prizeTarget: number | null = null;
  let prizePop = -1;
  const POP_SHRINK = 0.16;
  const POP_INFLATE = 0.42;

  const placePrize = (index: number, scale: number): void => {
    const sp = def.spaces[wrapIndex(index, n)];
    prize.root.position.set(sp.x, 0, sp.y);
    const s = Math.max(0.001, scale);
    prize.root.scale.setScalar(s);
  };

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

  // Tents on the grass strips visible in BOTH aspects: the portrait camera's
  // narrow horizontal fov clips the loop corners (the old 2.9u-out corner
  // spots were off-screen in portrait) and the HUD chip row covers the top
  // of the frame, so all three tents sit on the south grass in a shallow
  // A-row. Positions are tuning data in settings.board.tentSpots.
  // Downtown (slice 1 placeholder): no carnival scenery at all, just the
  // canal, the Harbor Basin and a slab marking the Grand Bridge.
  const tentSpots: [number, number, string, string, number][] = carnival
    ? [
        [settings.board.tentSpots[0].x, settings.board.tentSpots[0].z, palette.tentRed, palette.tentCream, 0],
        [settings.board.tentSpots[1].x, settings.board.tentSpots[1].z, palette.sun, palette.tentCream, 2.1],
        [settings.board.tentSpots[2].x, settings.board.tentSpots[2].z, palette.mint, palette.tentCream, 4.2],
      ]
    : [];
  if (!carnival) {
    for (const m of buildDowntownWater(kit)) group.add(m);
  }
  for (const [tx, tz, ca, cb, ph] of tentSpots) {
    props.push(buildTent(kit, tx, tz, ca, cb, ph));
  }
  if (carnival) {
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
  }
  // lamp posts near three spaced-out spots around the loop
  const lampTops = new Map<number, THREE.Vector3>();
  const lamps: { glow: THREE.Mesh; halo: THREE.Mesh }[] = [];
  for (const i of carnival ? [1, 15, 24] : []) {
    const sp = def.spaces[wrapIndex(i, n)];
    const [lx, lz] = outward(sp.x, sp.y, 2.1);
    const lamp = buildLampPost(kit, lx, lz);
    props.push(lamp);
    lampTops.set(i, new THREE.Vector3(lx, 2.95, lz));
    const glow = lamp.root.getObjectByName("lamp-glow");
    const halo = lamp.root.getObjectByName("lamp-halo");
    if (glow instanceof THREE.Mesh && halo instanceof THREE.Mesh) lamps.push({ glow, halo });
  }
  // balloon clusters near each tent (inset from settings so they clear the
  // loop edge and stay beside the tent on the grass)
  for (const [tx, tz] of tentSpots) {
    const [bx, bz] = outward(tx, tz, -settings.board.tentBalloonInset);
    props.push(buildBalloons(kit, bx, bz, (tx + tz) * 0.31));
  }

  // Attach every free-standing prop to the board. (Space-local props like the
  // star props are already parented to their space group and are skipped.)
  for (const p of props) {
    if (!p.root.parent) group.add(p.root);
  }

  if (world.scene) world.scene.add(group);

  console.log(`[SSP] board built: ${def.id} (${n} spaces)`);
  // Rigid static props only. Under the cutoff this builds no tree and does
  // not load three-mesh-bvh. A dense glTF prop added here would.
  void attachStaticBoundsIn(group);
  // Lanes go in AFTER the static-bounds pass: the merged lane geometry is over
  // the BVH triangle cutoff and would otherwise load three-mesh-bvh on every board.
  for (const m of buildBoardLanes(def, kit)) group.add(m);

  // ---- lively board: ambient loops + landing reactions (cosmetic) -------------------
  // Added after the static-bounds pass: these all move. `?lively=0` skips it all.
  let landFx: LandFx | null = null;
  let crowd: Crowd | null = null;
  let night: Night | null = null;
  if (livelyEnabled()) {
    const lively = new THREE.Group();
    lively.name = "lively";
    // Bunting runs down the west side, lamp 24 to lamp 1. The 15-24 pair sits
    // on a diagonal across the top row of disks, so it gets no strand.
    const strands: Array<[THREE.Vector3, THREE.Vector3]> = [];
    const west = [lampTops.get(24), lampTops.get(1)];
    if (west[0] && west[1]) strands.push([west[0], west[1]]);
    // Searchlight on the south grass east of the tents. The beam sweeps a
    // faint wedge of light back and forth across the loop.
    const sx = bounds.maxX - 4.8;
    const sz = bounds.maxY + 4.2;
    // Downtown: none of the carnival ambient props (landFx and the generic
    // day/night stay; it has no lamps or bunting bulbs yet).
    const ambient: Prop[] = carnival
      ? [
          buildBunting(kit, strands, { x: cx, z: cy }),
          buildCarousel(kit, bounds.minX - 2.4, bounds.maxY + 1.2),
          buildSky(kit, bounds),
          buildSearchlight(sx, sz, Math.atan2(-(cy - sz), cx - sx)),
        ]
      : [];
    for (const p of ambient) {
      lively.add(p.root);
      props.push(p);
    }
    group.add(lively);
    landFx = createLandFx({
      root: lively,
      spaceCount: n,
      spaceGroup: (i) => spaceGroups[wrapIndex(i, n)],
      spacePos: (i) => {
        const sp = def.spaces[wrapIndex(i, n)];
        return new THREE.Vector3(sp.x, 0, sp.y);
      },
      rimColor: (type) => DISK_RIM[type as SpaceType] ?? palette.sun,
    });
    // Crowd bleachers in the two gaps of the south tent row, pulled toward
    // the loop so the tent canopies don't cover them, facing the board.
    // Own group, so slice 1's lively budget stays its own.
    if (settings.lively.crowd && carnival) {
      const crowdRoot = new THREE.Group();
      crowdRoot.name = "lively-crowd";
      group.add(crowdRoot);
      const [mid, west, east] = settings.board.tentSpots;
      const gap = (a: { x: number; z: number }, b: { x: number; z: number }) => ({
        x: (a.x + b.x) / 2,
        z: (a.z + b.z) / 2 - 2.4,
      });
      crowd = createCrowd({
        root: crowdRoot,
        spots: [gap(west, mid), gap(mid, east)],
        face: { x: cx, z: cy },
        gradientMap: kit.grad,
      });
    }
    // Day -> dusk -> night: lamps, string lights, LAST 5 fireworks. Own group,
    // so the slice 1 and 2 budgets stay their own.
    if (world.scene) {
      const nightRoot = new THREE.Group();
      nightRoot.name = "lively-night";
      group.add(nightRoot);
      night = createNight({
        scene: world.scene,
        root: nightRoot,
        lamps,
        bulbs: buntingSlots(strands, { x: cx, z: cy }),
        camera: () => world.camera,
        center: { x: cx, z: cy },
      });
    }
  }

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

    react(i: number, kind: LandReaction): void {
      landFx?.react(i, kind);
    },

    setTimeOfDay(turn: number, totalTurns: number): void {
      night?.setTurn(turn, totalTurns);
    },

    setPrizeBalloon(index: number | null): void {
      if (index === null) {
        prize.root.visible = false;
        prizeTarget = null;
        return;
      }
      prize.root.visible = true;
      prizeTarget = wrapIndex(index, n);
      if (prizeShown === null) {
        prizeShown = prizeTarget;
        prizePop = -1;
        placePrize(prizeShown, 1);
      }
    },

    update(dt: number): void {
      if (disposed) return;
      t += dt;
      for (const p of props) p.update?.(t, dt);
      landFx?.update(dt);
      crowd?.update(dt);
      night?.update(dt);
      if (
        prize.root.visible &&
        prizeShown !== null &&
        prizeTarget !== null &&
        prizeTarget !== prizeShown &&
        prizePop < 0
      ) {
        prizePop = 0;
      }
      if (prizePop >= 0 && prizeShown !== null && prizeTarget !== null) {
        prizePop += dt;
        if (prizePop < POP_SHRINK) {
          placePrize(prizeShown, 1 - prizePop / POP_SHRINK);
        } else if (prizePop < POP_SHRINK + POP_INFLATE) {
          const u = (prizePop - POP_SHRINK) / POP_INFLATE;
          placePrize(prizeTarget, ease.outBack(u));
        } else {
          prizeShown = prizeTarget;
          prizePop = -1;
          placePrize(prizeShown, 1);
        }
      }
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
      landFx?.dispose();
      landFx = null;
      crowd?.dispose();
      crowd = null;
      night?.dispose();
      night = null;
      releaseStaticBoundsIn(group);
      world.scene?.remove(group);
      const geoms = new Set<THREE.BufferGeometry>();
      const mats = new Set<THREE.Material>();
      group.traverse((obj) => {
        if (obj instanceof THREE.InstancedMesh) obj.dispose();
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
