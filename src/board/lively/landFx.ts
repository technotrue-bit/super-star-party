/**
 * SUPER STAR PARTY — landing reactions (lively board, slice 1).
 *
 * Listens to the bus only: `player:move` dips the disk a player pushes off
 * from (and the one they arrive on), `player:land` squashes the final disk
 * with an elastic spring, flashes a ring in the disk's rim colour, throws a
 * burst from a pooled instanced particle mesh (coins on blue, puffs on red,
 * sparkles on green/star), and plays `land.blue|red|green`.
 *
 * Cosmetic only. Never writes `match`, never draws from the gameplay
 * generator (cosmetic jitter comes from ./fxRng). Pools are allocated once
 * in createLandFx(); update() allocates nothing.
 */
import * as THREE from "three";
import { bus } from "../../core/events";
import { audio } from "../../audio/audioEngine";
import { settings } from "../../config/settings";
import { palette } from "../../config/palette";
import { fxRand, fxRange, fxElasticOut } from "./fxRng";

/** "hop" dips a disk; any space type plays the full landing for that type. */
export type LandReaction = "hop" | string;

export interface LandFxHost {
  /** Board-local parent for the ring and the particle mesh. */
  root: THREE.Object3D;
  spaceCount: number;
  /** The space's root object; its y and scale are borrowed while animating. */
  spaceGroup(i: number): THREE.Object3D;
  /** Board-local ground position of space i. */
  spacePos(i: number): THREE.Vector3;
  /** Rim colour for a space type (the disk's DISK_RIM entry). */
  rimColor(type: string): string;
}

export interface LandFx {
  react(i: number, kind: LandReaction): void;
  update(dt: number): void;
  dispose(): void;
}

/** Debug counters for probes. Never read by gameplay. */
const stats = {
  hops: 0,
  lands: 0,
  busLands: 0,
  lastLand: null as null | { space: number; kind: string },
};
let current: { fx: LandFx; root: THREE.Object3D; activeParticles: () => number } | null = null;

const L = settings.lively;
const POOL = L.particles;

const KIND_COIN = 1;
const KIND_PUFF = 2;
const KIND_SPARK = 3;

const SOUND: Record<string, string> = {
  blue: "land.blue",
  red: "land.red",
  green: "land.green",
};

function wrapIndex(i: number, n: number): number {
  return ((i % n) + n) % n;
}

export function createLandFx(host: LandFxHost): LandFx {
  const n = host.spaceCount;
  const posX = new Float32Array(n);
  const posZ = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const p = host.spacePos(i);
    posX[i] = p.x;
    posZ[i] = p.z;
  }

  // ---- per-disk springs ---------------------------------------------------------
  const dipT = new Float32Array(n).fill(-1);
  const dipAmp = new Float32Array(n);
  const squashT = new Float32Array(n).fill(-1);
  const arriveIn = new Float32Array(n).fill(-1);
  const dirty = new Uint8Array(n);

  // ---- rim ring (one mesh, recoloured per landing) --------------------------------
  const ringGeo = new THREE.TorusGeometry(settings.tileRadius * 1.08, 0.075, 6, 28);
  ringGeo.rotateX(Math.PI / 2);
  const ringMat = new THREE.MeshBasicMaterial({ color: palette.white, transparent: true, opacity: 0, depthWrite: false });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.name = "lively:land-ring";
  ring.visible = false;
  ring.castShadow = false;
  ring.receiveShadow = false;
  host.root.add(ring);
  let ringT = -1;

  // ---- particle pool (one instanced draw) -----------------------------------------
  const partGeo = new THREE.IcosahedronGeometry(0.16, 0);
  const partMat = new THREE.MeshBasicMaterial({ color: palette.white });
  const parts = new THREE.InstancedMesh(partGeo, partMat, POOL);
  parts.name = "lively:land-particles";
  parts.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  parts.frustumCulled = false; // instances move; the cached bounds would go stale
  parts.castShadow = false;
  parts.receiveShadow = false;
  parts.visible = false;
  host.root.add(parts);

  const px = new Float32Array(POOL);
  const py = new Float32Array(POOL);
  const pz = new Float32Array(POOL);
  const vx = new Float32Array(POOL);
  const vy = new Float32Array(POOL);
  const vz = new Float32Array(POOL);
  const life = new Float32Array(POOL);
  const maxLife = new Float32Array(POOL);
  const spin = new Float32Array(POOL);
  const kind = new Uint8Array(POOL);
  let cursor = 0;
  let alive = 0;

  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  for (let k = 0; k < POOL; k++) {
    parts.setMatrixAt(k, hidden);
    parts.setColorAt(k, color.set(palette.white));
  }
  parts.instanceMatrix.needsUpdate = true;
  if (parts.instanceColor) parts.instanceColor.setUsage(THREE.DynamicDrawUsage);

  const coinColors = [palette.sun, palette.sun, palette.sunDeep];
  const puffColors = [palette.cream, palette.creamShadow, palette.metal];
  const greenSparks = [palette.mint, palette.white, palette.berry];
  const starSparks = [palette.sun, palette.white, palette.sunDeep];

  const spawn = (i: number, k: number, colors: readonly string[]): void => {
    const cx = posX[i];
    const cz = posZ[i];
    for (let b = 0; b < L.burst; b++) {
      const s = cursor;
      cursor = (cursor + 1) % POOL;
      if (life[s] <= 0) alive++;
      const a = (b / L.burst) * Math.PI * 2 + fxRange(-0.25, 0.25);
      const r = settings.tileRadius * fxRange(0.15, 0.5);
      px[s] = cx + Math.cos(a) * r;
      pz[s] = cz + Math.sin(a) * r;
      py[s] = 0.2;
      kind[s] = k;
      spin[s] = fxRange(-9, 9);
      let out: number;
      if (k === KIND_COIN) {
        out = fxRange(0.9, 1.9);
        vy[s] = fxRange(4.2, 6.2);
        maxLife[s] = fxRange(0.75, 0.95);
      } else if (k === KIND_PUFF) {
        out = fxRange(0.9, 1.7);
        vy[s] = fxRange(0.6, 1.4);
        maxLife[s] = fxRange(0.55, 0.75);
      } else {
        out = fxRange(1.8, 3.4);
        vy[s] = fxRange(2.2, 4.2);
        maxLife[s] = fxRange(0.5, 0.7);
      }
      vx[s] = Math.cos(a) * out;
      vz[s] = Math.sin(a) * out;
      life[s] = maxLife[s];
      parts.setColorAt(s, color.set(colors[Math.floor(fxRand() * colors.length) % colors.length]));
    }
    if (parts.instanceColor) parts.instanceColor.needsUpdate = true;
    parts.visible = true;
  };

  const startRing = (i: number, type: string): void => {
    ring.position.set(posX[i], 0.16, posZ[i]);
    ringMat.color.set(host.rimColor(type));
    ringMat.opacity = 0.95;
    ring.scale.setScalar(1);
    ring.visible = true;
    ringT = 0;
  };

  const dip = (i: number, amp: number): void => {
    if (squashT[i] >= 0) return; // a landing spring already owns this disk
    dipT[i] = 0;
    dipAmp[i] = amp;
    dirty[i] = 1;
  };

  const onMove = ({ from, to }: { player: number; from: number; to: number }): void => {
    fx.react(from, "hop");
    const j = wrapIndex(to, n);
    arriveIn[j] = settings.hopDuration;
  };
  const onLand = ({ space, type }: { player: number; space: number; type: string }): void => {
    stats.busLands++;
    arriveIn[wrapIndex(space, n)] = -1;
    fx.react(space, type);
  };
  const offMove = bus.on("player:move", onMove);
  const offLand = bus.on("player:land", onLand);
  let disposed = false;

  const fx: LandFx = {
    react(index: number, k: LandReaction): void {
      if (disposed) return;
      const i = wrapIndex(index, n);
      if (k === "hop") {
        stats.hops++;
        dip(i, L.hopDip);
        return;
      }
      stats.lands++;
      stats.lastLand = { space: i, kind: k };
      dipT[i] = -1;
      squashT[i] = 0;
      dirty[i] = 1;
      startRing(i, k);
      if (k === "blue") spawn(i, KIND_COIN, coinColors);
      else if (k === "red") spawn(i, KIND_PUFF, puffColors);
      else if (k === "green") spawn(i, KIND_SPARK, greenSparks);
      else if (k === "star") spawn(i, KIND_SPARK, starSparks);
      const sfx = SOUND[k];
      if (sfx) audio.sfx.play(sfx, { volume: 0.8 });
    },

    update(dt: number): void {
      if (disposed) return;

      // disks: arrival dips, push-off dips, landing springs
      for (let i = 0; i < n; i++) {
        if (arriveIn[i] >= 0) {
          arriveIn[i] -= dt;
          if (arriveIn[i] < 0) dip(i, L.hopDip * 0.7);
        }
        if (!dirty[i]) continue;
        const g = host.spaceGroup(i);
        let y = 0;
        let sy = 1;
        let sxz = 1;
        let busy = false;
        if (squashT[i] >= 0) {
          squashT[i] += dt;
          const u = squashT[i] / L.landSquashTime;
          if (u >= 1) {
            squashT[i] = -1;
          } else {
            const e = fxElasticOut(u);
            sy = 1 - L.landSquash * (1 - e);
            sxz = 1 + (1 - sy) * 0.45;
            y = -0.06 * (1 - e);
            busy = true;
          }
        } else if (dipT[i] >= 0) {
          dipT[i] += dt;
          const u = dipT[i] / L.hopDipTime;
          if (u >= 1) {
            dipT[i] = -1;
          } else {
            y = -dipAmp[i] * Math.sin(u * Math.PI);
            busy = true;
          }
        }
        g.position.y = y;
        g.scale.set(sxz, sy, sxz);
        if (!busy) dirty[i] = 0;
      }

      // ring
      if (ringT >= 0) {
        ringT += dt;
        const u = ringT / L.ringTime;
        if (u >= 1) {
          ringT = -1;
          ring.visible = false;
        } else {
          const e = 1 - (1 - u) * (1 - u);
          ring.scale.setScalar(1 + L.ringGrow * e);
          ring.position.y = 0.16 + 0.25 * e;
          ringMat.opacity = 0.95 * (1 - u);
        }
      }

      // particles
      if (alive > 0) {
        for (let s = 0; s < POOL; s++) {
          if (life[s] <= 0) continue;
          life[s] -= dt;
          if (life[s] <= 0) {
            alive--;
            parts.setMatrixAt(s, hidden);
            continue;
          }
          const k = kind[s];
          const age = 1 - life[s] / maxLife[s];
          if (k === KIND_PUFF) {
            const drag = Math.exp(-3 * dt);
            vx[s] *= drag;
            vz[s] *= drag;
          } else {
            vy[s] -= L.gravity * (k === KIND_SPARK ? 0.45 : 1) * dt;
          }
          px[s] += vx[s] * dt;
          py[s] += vy[s] * dt;
          pz[s] += vz[s] * dt;
          if (py[s] < 0.12 && vy[s] < 0) {
            py[s] = 0.12;
            vy[s] *= -0.35;
          }
          const fade = age > 0.7 ? 1 - (age - 0.7) / 0.3 : 1;
          dummy.position.set(px[s], py[s], pz[s]);
          if (k === KIND_COIN) {
            dummy.rotation.set(spin[s] * age, 0, Math.PI / 2);
            dummy.scale.set(0.38 * fade, 1.35 * fade, 1.35 * fade);
          } else if (k === KIND_PUFF) {
            const g = (1 + 1.6 * age) * fade;
            dummy.rotation.set(0, spin[s] * age * 0.3, 0);
            dummy.scale.set(1.5 * g, 1.3 * g, 1.5 * g);
          } else {
            const tw = 0.75 + 0.25 * Math.sin(age * 30 + spin[s]);
            dummy.rotation.set(0, spin[s] * age, 0.4);
            dummy.scale.set(0.45 * fade * tw, 1.7 * fade * tw, 0.45 * fade * tw);
          }
          dummy.updateMatrix();
          parts.setMatrixAt(s, dummy.matrix);
        }
        parts.instanceMatrix.needsUpdate = true;
        if (alive <= 0) {
          alive = 0;
          parts.visible = false;
        }
      }
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      offMove();
      offLand();
      for (let i = 0; i < n; i++) {
        const g = host.spaceGroup(i);
        g.position.y = 0;
        g.scale.set(1, 1, 1);
      }
      host.root.remove(ring, parts);
      ringGeo.dispose();
      ringMat.dispose();
      partGeo.dispose();
      partMat.dispose();
      parts.dispose();
      if (current?.fx === fx) current = null;
    },
  };

  current = { fx, root: host.root, activeParticles: () => alive };
  return fx;
}

function triangles(geo: THREE.BufferGeometry): number {
  const index = geo.getIndex();
  if (index) return Math.floor(index.count / 3);
  const pos = geo.getAttribute("position");
  return pos ? Math.floor(pos.count / 3) : 0;
}

/**
 * Worst-case cost of everything lively on the live board: one draw per
 * mesh (per material group), triangles times instance count, as if every
 * object were on screen at once.
 */
function worstCaseBudget(root: THREE.Object3D): { drawCalls: number; triangles: number; meshes: string[] } {
  let drawCalls = 0;
  let tris = 0;
  const meshes: string[] = [];
  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    const inst = obj instanceof THREE.InstancedMesh ? obj.count : 1;
    drawCalls += Array.isArray(obj.material) ? Math.max(1, obj.geometry.groups.length) : 1;
    tris += triangles(obj.geometry) * inst;
    meshes.push(obj.name || obj.type);
  });
  return { drawCalls, triangles: tris, meshes };
}

/** Probe view of the lively board. */
export function livelyDebug(): {
  active: boolean;
  hops: number;
  lands: number;
  busLands: number;
  lastLand: { space: number; kind: string } | null;
  activeParticles: number;
  budget: { drawCalls: number; triangles: number; meshes: string[] } | null;
} {
  return {
    active: current !== null,
    hops: stats.hops,
    lands: stats.lands,
    busLands: stats.busLands,
    lastLand: stats.lastLand ? { ...stats.lastLand } : null,
    activeParticles: current ? current.activeParticles() : 0,
    budget: current ? worstCaseBudget(current.root) : null,
  };
}

/** Fire a reaction on the live board (probe aid). False when lively is off. */
export function livelyReact(i: number, kind: LandReaction): boolean {
  if (!current) return false;
  current.fx.react(i, kind);
  return true;
}
