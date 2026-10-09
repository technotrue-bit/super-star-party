/**
 * SUPER STAR PARTY — the reacting crowd (lively board, slice 2).
 *
 * Two bleachers of Fizzlings (little gumdrop spectators with a fizz antenna)
 * beside the south tents. Two draw calls in all: one merged static mesh for
 * both bleachers, one InstancedMesh for every Fizzling. Procedural geometry,
 * vertex colours (instance colour tints the bodies), no shadows.
 *
 * They react to the same bus events the crowd audio voices
 * (audio/music/crowd.ts):
 *   star:buy                  -> big hop cheer
 *   minigame:end (winner)     -> hop cheer;  (no winner) -> slump ("aah")
 *   happening:event           -> lean in ("ooh"); Grumpus ones slump instead
 *   coins:change (gain)       -> small hop
 *
 * Per-spectator stagger, hop height, and idle phase come from a private
 * fxMulberry32 stream. Never writes `match`. update() allocates nothing.
 */
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { bus } from "../../core/events";
import { settings } from "../../config/settings";
import { palette } from "../../config/palette";
import { fxMulberry32 } from "./fxRng";

export interface CrowdHost {
  /** Board-local parent for the two crowd meshes. */
  root: THREE.Object3D;
  /** Bleacher ground positions (board-local x/z). */
  spots: ReadonlyArray<{ x: number; z: number }>;
  /** Point the bleachers face (the board's centre). */
  face: { x: number; z: number };
  /** Toon gradient for the shared look. */
  gradientMap: THREE.Texture | null;
}

export interface Crowd {
  update(dt: number): void;
  dispose(): void;
}

const enum React {
  None = 0,
  Hop = 1, // small coin hop
  Lean = 2,
  Cheer = 3,
  Slump = 4,
}
const RANK = [0, 1, 2, 3, 3];
const REACT_NAMES = ["none", "hop", "lean", "cheer", "slump"] as const;

const L = settings.lively;
const BODY_COLORS = [palette.candy, palette.berry, palette.mint, palette.bubble, palette.sun, palette.lava, palette.heroTusk];

/** Debug counters for probes. Never read by gameplay. */
const stats = { hop: 0, lean: 0, cheer: 0, slump: 0 };
let current: { root: THREE.Object3D; meshes: THREE.Mesh[]; reacting: () => string } | null = null;

function part(geo: THREE.BufferGeometry, color: string, m: THREE.Matrix4): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (g !== geo) geo.dispose();
  g.deleteAttribute("uv");
  g.applyMatrix4(m);
  const c = new THREE.Color(color);
  const n = g.getAttribute("position").count;
  const cols = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    cols[i * 3] = c.r;
    cols[i * 3 + 1] = c.g;
    cols[i * 3 + 2] = c.b;
  }
  g.setAttribute("color", new THREE.BufferAttribute(cols, 3));
  return g;
}

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  if (!merged) throw new Error("crowd: merge failed");
  return merged;
}

/** One Fizzling, feet at the origin, facing +z. White parts take the instance colour. */
function fizzlingGeometry(): THREE.BufferGeometry {
  const m = new THREE.Matrix4();
  const body = part(new THREE.SphereGeometry(0.2, 7, 5), palette.white, m.compose(
    new THREE.Vector3(0, 0.24, 0), new THREE.Quaternion(), new THREE.Vector3(1, 1.2, 1)));
  const eyeGeo = (): THREE.BufferGeometry => new THREE.SphereGeometry(0.05, 4, 3);
  const eyeL = part(eyeGeo(), palette.ink, m.makeTranslation(-0.075, 0.31, 0.17));
  const eyeR = part(eyeGeo(), palette.ink, m.makeTranslation(0.075, 0.31, 0.17));
  const stem = part(new THREE.ConeGeometry(0.03, 0.2, 4, 1), palette.white, m.makeTranslation(0, 0.56, 0));
  const tip = part(new THREE.IcosahedronGeometry(0.065, 0), palette.cream, m.makeTranslation(0, 0.68, 0));
  return merge([body, eyeL, eyeR, stem, tip]);
}

const ROWS = 2;
const SEAT_W = 0.42; // seat spacing along a row
const ROW_D = 0.62; // row depth
const STEP_H = 0.32; // tier rise

/** Both bleachers as one static geometry (board-local). */
function bleacherGeometry(spots: ReadonlyArray<{ x: number; z: number; yaw: number }>, perRow: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const width = perRow * SEAT_W + 0.3;
  const m = new THREE.Matrix4();
  const local = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const one = new THREE.Vector3(1, 1, 1);
  for (const s of spots) {
    const base = new THREE.Matrix4().compose(new THREE.Vector3(s.x, 0, s.z), q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), s.yaw), one);
    const box = (w: number, h: number, d: number, x: number, y: number, z: number, color: string): void => {
      local.makeTranslation(x, y, z);
      parts.push(part(new THREE.BoxGeometry(w, h, d), color, m.multiplyMatrices(base, local)));
    };
    // tiers: front low (cream), back high (tent red), then a sun rail behind
    box(width, STEP_H, ROW_D, 0, STEP_H / 2, ROW_D / 2, palette.tentCream);
    box(width, STEP_H * 2, ROW_D, 0, STEP_H, -ROW_D / 2, palette.tentRed);
    box(width, 0.1, 0.08, 0, STEP_H * 2 + 0.5, -ROW_D + 0.04, palette.sun);
    for (const sx of [-1, 1]) box(0.08, 0.5, 0.08, (sx * (width - 0.08)) / 2, STEP_H * 2 + 0.25, -ROW_D + 0.04, palette.wood);
  }
  return merge(parts);
}

export function createCrowd(host: CrowdHost): Crowd {
  const perBleacher = Math.max(ROWS, Math.round(L.crowdPerBleacher / ROWS) * ROWS);
  const perRow = perBleacher / ROWS;
  const spots = host.spots.map((s) => ({ x: s.x, z: s.z, yaw: Math.atan2(host.face.x - s.x, host.face.z - s.z) }));
  const count = perBleacher * spots.length;

  const benchGeo = bleacherGeometry(spots, perRow);
  const benchMat = new THREE.MeshToonMaterial({ color: palette.white, gradientMap: host.gradientMap, vertexColors: true });
  const benches = new THREE.Mesh(benchGeo, benchMat);
  benches.name = "lively:crowd-bleachers";

  const fizzGeo = fizzlingGeometry();
  const fizzMat = new THREE.MeshToonMaterial({ color: palette.white, gradientMap: host.gradientMap, vertexColors: true });
  const fizz = new THREE.InstancedMesh(fizzGeo, fizzMat, count);
  fizz.name = "lively:crowd-fizzlings";
  fizz.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  for (const mesh of [benches, fizz]) {
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    host.root.add(mesh);
  }

  // ---- per-spectator constants (private cosmetic stream) --------------------------
  const draw = fxMulberry32(0xf122);
  const baseX = new Float32Array(count);
  const baseY = new Float32Array(count);
  const baseZ = new Float32Array(count);
  const yaw = new Float32Array(count);
  const delay = new Float32Array(count);
  const hopMul = new Float32Array(count);
  const phase = new Float32Array(count);
  const rate = new Float32Array(count);
  const color = new THREE.Color();
  for (let b = 0; b < spots.length; b++) {
    const s = spots[b];
    const cos = Math.cos(s.yaw);
    const sin = Math.sin(s.yaw);
    for (let k = 0; k < perBleacher; k++) {
      const i = b * perBleacher + k;
      const row = Math.floor(k / perRow);
      const col = k % perRow;
      const lx = (col - (perRow - 1) / 2) * SEAT_W + (draw() - 0.5) * 0.08;
      const lz = row === 0 ? ROW_D / 2 : -ROW_D / 2;
      baseX[i] = s.x + lx * cos + lz * sin;
      baseZ[i] = s.z - lx * sin + lz * cos;
      baseY[i] = STEP_H * (row + 1);
      yaw[i] = s.yaw + (draw() - 0.5) * 0.4;
      delay[i] = draw() * L.crowdStagger;
      hopMul[i] = 0.7 + draw() * 0.5;
      phase[i] = draw() * Math.PI * 2;
      rate[i] = 1.6 + draw() * 1.4;
      fizz.setColorAt(i, color.set(BODY_COLORS[Math.floor(draw() * BODY_COLORS.length) % BODY_COLORS.length]));
    }
  }

  // ---- reactions -----------------------------------------------------------------
  let kind: React = React.None;
  let kindT = 0;
  let amp = 1;
  let t = 0;
  const react = (k: React, a: number): void => {
    const live = kind !== React.None && kindT < L.crowdSlumpTime + L.crowdStagger;
    if (live && RANK[k] < RANK[kind]) return;
    kind = k;
    kindT = 0;
    amp = a;
    if (k === React.Hop) stats.hop++;
    else if (k === React.Lean) stats.lean++;
    else if (k === React.Cheer) stats.cheer++;
    else if (k === React.Slump) stats.slump++;
  };
  const offs = [
    bus.on("star:buy", () => react(React.Cheer, 1)),
    bus.on("minigame:end", ({ winner }) => (winner >= 0 ? react(React.Cheer, 0.85) : react(React.Slump, 1))),
    bus.on("happening:event", ({ eventId }) => (eventId.startsWith("grumpus") ? react(React.Slump, 0.8) : react(React.Lean, 1))),
    bus.on("coins:change", ({ delta }) => {
      if (delta > 0) react(React.Hop, 0.35);
    }),
  ];

  const dummy = new THREE.Object3D();
  dummy.rotation.order = "YXZ";
  let disposed = false;

  const crowd: Crowd = {
    update(dt: number): void {
      if (disposed) return;
      t += dt;
      if (kind !== React.None) {
        kindT += dt;
        if (kindT > L.crowdSlumpTime + L.crowdStagger) kind = React.None;
      }
      for (let i = 0; i < count; i++) {
        // idle: a slow breathing bob and sway
        const ph = t * rate[i] + phase[i];
        let y = 0.015 * Math.sin(ph);
        let pitch = 0;
        let sy = 1 + 0.03 * Math.sin(ph + 1.3);
        let turn = 0.06 * Math.sin(ph * 0.5);
        const tau = kindT - delay[i];
        if (kind !== React.None && tau >= 0) {
          if (kind === React.Cheer || kind === React.Hop) {
            const dur = kind === React.Cheer ? L.crowdCheerTime : L.crowdCheerTime * 0.5;
            if (tau < dur) {
              const hops = kind === React.Cheer ? 3 : 1;
              const s = Math.abs(Math.sin((tau / dur) * Math.PI * hops));
              y += 0.42 * amp * hopMul[i] * s;
              sy *= 1 + 0.18 * amp * (s - 0.4);
              turn += 0.25 * amp * Math.sin(tau * 14 + phase[i]);
            }
          } else {
            const dur = kind === React.Lean ? L.crowdLeanTime : L.crowdSlumpTime;
            if (tau < dur) {
              const x = tau / dur;
              const env = Math.min(1, x / 0.15) * Math.min(1, (1 - x) / 0.3);
              if (kind === React.Lean) {
                pitch = 0.38 * amp * env;
                y += 0.04 * env;
              } else {
                pitch = 0.5 * amp * env;
                sy *= 1 - 0.22 * amp * env;
                turn *= 1 - env;
              }
            }
          }
        }
        dummy.position.set(baseX[i], baseY[i] + y, baseZ[i]);
        dummy.rotation.set(pitch, yaw[i] + turn, 0);
        const sxz = 1 + (1 - sy) * 0.5;
        dummy.scale.set(sxz, sy, sxz);
        dummy.updateMatrix();
        fizz.setMatrixAt(i, dummy.matrix);
      }
      fizz.instanceMatrix.needsUpdate = true;
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const off of offs) off();
      host.root.remove(benches, fizz);
      benchGeo.dispose();
      benchMat.dispose();
      fizzGeo.dispose();
      fizzMat.dispose();
      fizz.dispose();
      if (current?.root === host.root) current = null;
    },
  };

  crowd.update(0);
  // Bounds once, padded for the hops; instances only move a little.
  fizz.computeBoundingSphere();
  if (fizz.boundingSphere) fizz.boundingSphere.radius += 0.8;
  current = { root: host.root, meshes: [benches, fizz], reacting: () => REACT_NAMES[kind] };
  return crowd;
}

function triangles(geo: THREE.BufferGeometry): number {
  const index = geo.getIndex();
  if (index) return Math.floor(index.count / 3);
  const pos = geo.getAttribute("position");
  return pos ? Math.floor(pos.count / 3) : 0;
}

/** Probe view of the crowd: reaction counts and worst-case cost. */
export function crowdDebug(): {
  active: boolean;
  reacting: string;
  reactions: { hop: number; lean: number; cheer: number; slump: number };
  budget: { drawCalls: number; triangles: number; instances: number } | null;
} {
  let budget: { drawCalls: number; triangles: number; instances: number } | null = null;
  if (current) {
    budget = { drawCalls: 0, triangles: 0, instances: 0 };
    for (const m of current.meshes) {
      const inst = m instanceof THREE.InstancedMesh ? m.count : 1;
      budget.drawCalls++;
      budget.triangles += triangles(m.geometry) * inst;
      if (m instanceof THREE.InstancedMesh) budget.instances += inst;
    }
  }
  return {
    active: current !== null,
    reacting: current ? current.reacting() : "none",
    reactions: { ...stats },
    budget,
  };
}
