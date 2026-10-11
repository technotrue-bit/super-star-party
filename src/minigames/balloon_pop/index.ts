/**
 * SUPER STAR PARTY — BALLOON POP (genre: target)
 *
 * Four carnival columns, one per player. Balloons float up every column and
 * you pop the ones in YOUR column by tapping (clicking) them:
 *   normal +1, GOLD +3 (smaller, rises faster), BOMB -2 (dark, sparking fuse:
 *   leave it alone). Escaped balloons cost nothing.
 *
 * Fairness: one balloon schedule (when, which type, how big) is drawn once
 * per round and every column gets exactly the same balloons. The pace ramps
 * up (spawn gap 1.0s -> 0.55s, rise 1.3 -> 2.2 u/s) over the 28s round.
 *
 * CPU model: each CPU draws an accuracy (0.74 +/- 0.12). Per balloon it
 * commits with p = accuracy (gold: accuracy - 0.22) and pops it at a random
 * height; it mis-taps a bomb 10% of the time.
 *
 * Ranking: points, then fewer bombs popped, then a per-round coin flip.
 *
 * Determinism: all gameplay (schedule, rise, CPU choices, human pops,
 * scoring) runs in fixed 1/60s steps; human taps are queued and resolved in
 * the next step. ctx.rng only.
 */
import * as THREE from "three";
import { automatedSeatIds, isPracticeBeat, localPlayerIndex, type Minigame, type MinigameContext } from "../framework";
import { isAutoplay } from "../../core/debug";
import { registerMinigame } from "../registry";
import { box as frameBox, frameMinigame } from "../framing";
import { palette, hex } from "../../config/palette";
import { celGradient } from "../../characters/cel";

/* ------------------------------ tuning --------------------------------- */

const BALLOON_Z = -5.5; // balloon plane (in front of the wall at z=-6.4)
const BOTTOM_Y = 0.7; // spawn height
const TOP_Y = 6.9; // despawn height (missed)
/** Rise speed ramps from RISE_START to RISE_END (u/s) over the round. */
const RISE_START = 1.3;
const RISE_END = 2.2;
/** Gap between balloons ramps from GAP_START to GAP_END (s), +/- jitter. */
const GAP_START = 1.0;
const GAP_END = 0.55;
const GAP_JITTER = 0.15;
const GOLD_P = 0.08;
const BOMB_P = 0.12;
const GOLD_RISE = 1.5; // gold balloons rise this much faster
const PTS = { normal: 1, gold: 3, bomb: -2 } as const;
const TIME_CAP = 28.0; // round length — framework force-finishes at 30s
const TAP_GRACE = 0.38; // extra tap radius beyond the balloon
const CPU_ACCURACY = 0.74; // per-balloon commit chance (center of the model)
const CPU_ACCURACY_SPREAD = 0.24; // +/- 0.12
const CPU_GOLD_MALUS = 0.22;
const CPU_BOMB_MISTAP = 0.1;
const CPU_POP_MIN_Y = 1.8; // CPUs pop somewhere in this height band
const CPU_POP_MAX_Y = 5.8;

type BalloonKind = "normal" | "gold" | "bomb";

/** Normal balloons skip gold (that's the +3 balloon) and ink (that's the bomb). */
const BALLOON_COLORS_NORMAL = [palette.candy, palette.mint, palette.bubble, palette.berry];
const SHARD_WHITES = [palette.white, palette.cream, palette.sunDeep];
const AWNING_COLORS = [palette.candy, palette.sun, palette.mint, palette.bubble, palette.berry];
const SPARKLE_COLORS = [palette.sun, palette.mint, palette.bubble, palette.candy];

/* --------------------- fixed-step simulation ---------------------- */
const FIXED_DT = 1 / 60; // simulation step (s)
const MAX_STEPS_PER_FRAME = 12; // maxDelta 1/20 × speed 4 = 0.2s. Dropping below that lets the 30s screen limit beat the sim.

// Landscape / portrait arena + camera layouts (portrait compacts the spread
// so all four columns stay on screen).
const LAYOUTS = {
  landscape: {
    colX: [-5.7, -1.9, 1.9, 5.7],
    panelW: 3.3,
    wallW: 16.8,
    cam: [0, 4.6, 11.8] as [number, number, number],
    fov: 55,
    rMin: 0.42,
    rMax: 0.6,
    scallops: 7,
  },
  portrait: {
    colX: [-3.0, -1.0, 1.0, 3.0],
    panelW: 1.84,
    wallW: 8.4,
    cam: [0, 5.8, 8.0] as [number, number, number],
    fov: 62,
    rMin: 0.38,
    rMax: 0.54,
    scallops: 5,
  },
};

/* ------------------------------ state ----------------------------------- */

interface Shard {
  mesh: THREE.Mesh;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
  grav: number;
  base: number;
  spin: number;
}

interface RingFx {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  life: number;
  maxLife: number;
  base: number;
}

interface Popup {
  sprite: THREE.Sprite;
  mat: THREE.SpriteMaterial;
  tex: THREE.CanvasTexture;
  born: number;
  baseY: number;
}

interface Balloon {
  group: THREE.Group;
  kind: BalloonKind;
  rise: number; // u/s
  col: number; // player id = column index
  x: number;
  y: number;
  r: number;
  color: number; // balloon color hex
  phase: number;
  /** CPU plan: pop once the balloon reaches this height; null = leave it. */
  cpuPopY: number | null;
}

/** One entry of the shared schedule: every column gets this balloon. */
interface Spawn {
  step: number;
  kind: BalloonKind;
  r: number;
  color: number;
  phase: number;
  rise: number;
}

interface PlayerSt {
  id: number;
  x: number; // column x
  color: number; // player color hex
  score: number;
  pops: number;
  bombs: number;
  missed: number;
  tieBreak: number;
  accuracy: number; // CPU commit chance (human: unused)
  cheerT: number; // cheer anim timer -> idle
  chip: HTMLDivElement | null;
  wrapper: THREE.Group | null;
  char: THREE.Group | null;
}

interface State {
  ctx: MinigameContext;
  root: THREE.Group;
  layout: (typeof LAYOUTS)["landscape"];
  players: PlayerSt[];
  balloons: Balloon[];
  shards: Shard[];
  rings: RingFx[];
  popups: Popup[];
  schedule: Spawn[];
  nextSpawn: number;
  /** Human taps (balloon-plane hit points) waiting for the next fixed step. */
  taps: { x: number; y: number }[];
  t: number; // fixed-step clock (stepIndex * FIXED_DT)
  shake: number;
  announcedGo: boolean;
  finished: boolean;
  camBase: [number, number, number];
  camLook: [number, number, number];
  toons: Map<number, THREE.MeshToonMaterial>;
  geos: THREE.BufferGeometry[];
  mats: THREE.Material[];
  sparkles: THREE.Mesh[];
  /* Fixed-step simulation: accumulator + integer step counter. All gameplay
     advances in whole 1/60s steps; stepIndex drives every decision so rng
     draw order is identical across runs regardless of frame timing. */
  /** Column ids driven by the CPU model (every column under autoplay). */
  cpu: number[];
  simTime: number; // accumulated fixed-step time (s)
  stepIndex: number; // current simulation step
}

let state: State | null = null;

/* --------------------------- tiny helpers ------------------------------- */

function toon(st: State, color: number): THREE.MeshToonMaterial {
  let m = st.toons.get(color);
  if (!m) {
    m = new THREE.MeshToonMaterial({ gradientMap: celGradient, color });
    st.toons.set(color, m);
    st.mats.push(m);
  }
  return m;
}

function basic(st: State, color: number): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({ color });
  st.mats.push(m);
  return m;
}

function addMesh(
  st: State,
  parent: THREE.Object3D,
  geo: THREE.BufferGeometry,
  mat: THREE.Material,
  pos: [number, number, number],
  rot?: [number, number, number]
): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(pos[0], pos[1], pos[2]);
  if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
  m.castShadow = false;
  m.receiveShadow = false;
  parent.add(m);
  return m;
}

function newGeo(st: State, g: THREE.BufferGeometry): THREE.BufferGeometry {
  st.geos.push(g);
  return g;
}

/**
 * Ink outline for a mesh: a back-face shell that sits exactly where the mesh
 * is. (The shell used to keep only the geometry, so it landed at the origin
 * as a solid ink slab in front of the camera.)
 */
function outlineShell(st: State, src: THREE.Mesh, scale = 1.06): THREE.Mesh {
  const g = src.geometry.clone();
  g.scale(scale, scale, scale);
  const mat = basic(st, hex(palette.ink));
  mat.side = THREE.BackSide;
  const shell = new THREE.Mesh(g, mat);
  shell.position.copy(src.position);
  shell.quaternion.copy(src.quaternion);
  shell.scale.copy(src.scale);
  shell.castShadow = false;
  return shell;
}

/** Dispose only geometries under a root (materials are shared/round-scoped). */
function disposeGeos(root: THREE.Object3D): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.isMesh) mesh.geometry.dispose();
  });
}

/** Dispose geometries + materials under a root (full teardown). */
function disposeObj(root: THREE.Object3D): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.dispose();
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) m.dispose();
  });
}

/** Colored shards flying outward with gravity + fade (pops, confetti).
 *  ALL ctx.rng() draws here are gated on the step index — this function is
 *  only ever called from stepFixed(), so the draw order is deterministic. */
function spawnShards(
  st: State,
  pos: [number, number, number],
  color: number,
  count: number,
  speed: number,
  life: number,
  grav: number,
  base: number,
  vyBias = 1.5
): void {
  const geo = newGeo(st, new THREE.SphereGeometry(1, 7, 5));
  const mat = basic(st, color);
  for (let i = 0; i < count; i++) {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(pos[0], pos[1], pos[2]);
    mesh.scale.setScalar(base);
    st.root.add(mesh);
    const th = st.ctx.rng() * Math.PI * 2;
    const ph = st.ctx.rng() * Math.PI - Math.PI / 2;
    const sp = speed * (0.5 + st.ctx.rng() * 0.8);
    st.shards.push({
      mesh,
      vx: Math.cos(th) * Math.cos(ph) * sp,
      vy: Math.sin(ph) * sp + vyBias,
      vz: Math.sin(th) * Math.cos(ph) * sp * 0.5,
      life,
      maxLife: life,
      grav,
      base: base * (0.7 + st.ctx.rng() * 0.6),
      spin: (st.ctx.rng() - 0.5) * 14,
    });
  }
}

/** Expanding pop ring (flattened torus, fades out). */
function spawnRing(st: State, pos: [number, number, number], base: number): void {
  const mat = basic(st, hex(palette.cream));
  mat.transparent = true;
  const mesh = new THREE.Mesh(newGeo(st, new THREE.TorusGeometry(1, 0.09, 8, 22)), mat);
  mesh.position.set(pos[0], pos[1], pos[2]);
  mesh.rotation.x = Math.PI / 2; // ring lies in the wall plane (vertical)
  mesh.scale.setScalar(base * 0.2);
  st.root.add(mesh);
  st.rings.push({ mesh, mat, life: 0.3, maxLife: 0.3, base });
}

/* ------------------------- floating score popups ------------------------ */
/* Canvas-texture sprites (Fredoka + ink outline) that rise ~0.75 world    */
/* units and fade over 0.7s at the pop point. No ctx.rng here: fully        */
/* deterministic (texture dims + text fixed at module init).                 */

const POPUP_RISE = 0.75; // world units
const POPUP_LIFE = 0.7; // seconds
const POPUP_SCALE = 0.66; // world width — legible ~20-28px at 390px portrait

function makePopupTexture(text: string, fill: string): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 128;
  const c = canvas.getContext("2d");
  if (!c) throw new Error("2D canvas context unavailable");
  c.font = "700 84px Fredoka, sans-serif";
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.lineJoin = "round";
  c.lineWidth = 14;
  c.strokeStyle = palette.ink;
  c.strokeText(text, 128, 70);
  c.fillStyle = fill;
  c.fillText(text, 128, 70);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  return tex;
}

/** Bonus (+2 tall target) pops show gold; regular +1 pops use the scoring
 * player's character color. */
const POPUP_GOLD = makePopupTexture("+3", palette.sun);
const POPUP_BOMB = makePopupTexture("-2", palette.lava);
const POPUP_PLUS1: { tex: THREE.CanvasTexture }[] = [];

function playerPopupTex(st: State, color: number): THREE.CanvasTexture {
  for (const e of POPUP_PLUS1) if ((e.tex as unknown as { __c?: number }).__c === color) return e.tex;
  const tex = makePopupTexture("+1", "#" + color.toString(16).padStart(6, "0"));
  (tex as unknown as { __c?: number }).__c = color;
  POPUP_PLUS1.push({ tex });
  return tex;
}

/** Spawn the floating score popup at the pop position. */
function spawnPopup(st: State, pos: [number, number, number], pts: number, color: number): void {
  const tex = pts >= 3 ? POPUP_GOLD : pts < 0 ? POPUP_BOMB : playerPopupTex(st, color);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(POPUP_SCALE, POPUP_SCALE * 0.5, 1);
  sprite.position.set(pos[0], pos[1], pos[2] + 0.25);
  sprite.renderOrder = 4;
  st.root.add(sprite);
  st.popups.push({ sprite, mat, tex, born: st.t, baseY: pos[1] });
}

/** Per-frame visual: popup rise/fade (NOT gameplay — no rng). */
function updatePopups(st: State, dt: number): void {
  for (let i = st.popups.length - 1; i >= 0; i--) {
    const pu = st.popups[i];
    const k = Math.min(1, (st.t - pu.born) / POPUP_LIFE);
    pu.sprite.position.y = pu.baseY + POPUP_RISE * k;
    pu.mat.opacity = 1 - k;
    if (k >= 1) {
      st.root.remove(pu.sprite);
      pu.mat.dispose();
      st.popups.splice(i, 1);
    }
  }
}

/** Win confetti rain — runs INSIDE fixed steps only (governed by stepIndex).
 * All ctx.rng draws here happen at a deterministic step. */
function spawnConfetti(st: State): void {
  const colors = [palette.sun, palette.candy, palette.mint, palette.bubble, palette.berry];
  for (let i = 0; i < 42; i++) {
    const color = hex(colors[Math.floor(st.ctx.rng() * colors.length)]);
    const x = (st.ctx.rng() * 2 - 1) * (st.layout.wallW * 0.5 + 1.2);
    const y = 8.4 + st.ctx.rng() * 1.2;
    const z = -5.8 + st.ctx.rng() * 2.6;
    spawnShards(st, [x, y, z], color, 1, 2.2 + st.ctx.rng() * 2.4, 2.6, 2.6, 0.09, -0.8);
  }
}

/** Per-frame visual: shard/ring/sparkle animation (NOT gameplay — no rng). */
function updateFx(st: State, dt: number): void {
  for (let i = st.shards.length - 1; i >= 0; i--) {
    const p = st.shards[i];
    p.life -= dt;
    if (p.life <= 0) {
      st.root.remove(p.mesh);
      st.shards.splice(i, 1);
      continue;
    }
    p.vy -= p.grav * dt;
    p.mesh.position.x += p.vx * dt;
    p.mesh.position.y += p.vy * dt;
    p.mesh.position.z += p.vz * dt;
    p.mesh.rotation.x += p.spin * dt;
    p.mesh.rotation.y += p.spin * 0.7 * dt;
    p.mesh.scale.setScalar(p.base * Math.max(0, p.life / p.maxLife));
  }
  for (let i = st.rings.length - 1; i >= 0; i--) {
    const r = st.rings[i];
    r.life -= dt;
    if (r.life <= 0) {
      st.root.remove(r.mesh);
      st.rings.splice(i, 1);
      continue;
    }
    const prog = 1 - r.life / r.maxLife;
    r.mesh.scale.setScalar(r.base * (0.2 + 1.5 * prog));
    r.mat.opacity = 1 - prog;
  }
  for (const s of st.sparkles) {
    s.rotation.y += dt * 1.6;
    s.rotation.z += dt * 0.9;
  }
}

/* ------------------------------ DOM UI ---------------------------------- */

function updateChip(st: State, pid: number): void {
  st.ctx.hud.score(pid, st.players[pid].score);
}

/* ---------------------------- arena build ------------------------------- */

function buildArena(st: State): void {
  const { ctx } = st;
  const L = st.layout;
  const cream = hex(palette.cream);
  const ink = hex(palette.ink);
  const wallZ = -6.4;

  // ---- back wall: horizontal candy stripes (cream + candy/sun bands) ----
  const wall = addMesh(st, st.root, newGeo(st, new THREE.BoxGeometry(L.wallW + 1.6, 7.6, 0.3)), toon(st, cream), [0, 3.9, wallZ]);
  st.root.add(outlineShell(st, wall, 1.02));
  const stripeColors = [hex(palette.candy), cream, hex(palette.sun), cream, hex(palette.candy), cream];
  const stripeH = 7.6 / stripeColors.length;
  for (let i = 0; i < stripeColors.length; i++) {
    addMesh(
      st, st.root, newGeo(st, new THREE.BoxGeometry(L.wallW + 1.76, stripeH - 0.12, 0.36)),
      toon(st, stripeColors[i]), [0, 3.9 - 3.8 + stripeH * (i + 0.5), wallZ - 0.02], undefined
    );
  }

  // ---- scalloped awning along the top edge ----
  const scallopR = (L.wallW + 1.2) / L.scallops / 2;
  for (let i = 0; i < L.scallops; i++) {
    const sx = -(L.wallW + 1.2) / 2 + scallopR + i * scallopR * 2;
    const col = hex(AWNING_COLORS[i % AWNING_COLORS.length]);
    const s = addMesh(st, st.root, newGeo(st, new THREE.SphereGeometry(1, 10, 8)), toon(st, col), [sx, 7.58, wallZ - 0.1]);
    s.scale.set(scallopR * 2, scallopR * 1.35, 0.3);
  }

  // ---- per-player column panels (cream, ink frame, player-color top bar) ----
  for (let i = 0; i < 4; i++) {
    const P = st.players[i];
    const px = L.colX[i];
    // Each column is washed in its player's colour so "your column" reads at a glance.
    const tint = new THREE.Color(cream).lerp(new THREE.Color(P.color), 0.28).getHex();
    const panel = addMesh(st, st.root, newGeo(st, new THREE.BoxGeometry(L.panelW, 7.6, 0.4)), toon(st, tint), [px, 3.9, wallZ + 0.22]);
    st.root.add(outlineShell(st, panel, 1.05));
    addMesh(st, st.root, newGeo(st, new THREE.BoxGeometry(L.panelW, 0.36, 0.44)), toon(st, P.color), [px, 7.8, wallZ + 0.18]);
    // soft inner shading strip at the bottom so balloons read against the panel
    addMesh(st, st.root, newGeo(st, new THREE.BoxGeometry(L.panelW - 0.3, 0.5, 0.42)), toon(st, hex(palette.creamShadow)), [px, 0.7, wallZ + 0.2]);
    void P;
  }

  // ---- sparkle stars sprinkled between panels (visual only, outside step loop) ----
  const starGeo = newGeo(st, new THREE.OctahedronGeometry(1));
  for (let i = 0; i < 12; i++) {
    const x = (st.ctx.rng() * 2 - 1) * (L.wallW * 0.5 - 0.5);
    // keep sparkles off the panels: only x in the gaps between column spans
    const onPanel = L.colX.some((cx) => Math.abs(x - cx) < L.panelW * 0.62);
    if (onPanel) continue;
    const y = 1.4 + st.ctx.rng() * 5.4;
    const s = addMesh(st, st.root, starGeo, toon(st, hex(SPARKLE_COLORS[Math.floor(st.ctx.rng() * SPARKLE_COLORS.length)])), [x, y, wallZ + 0.24]);
    const sc = 0.1 + st.ctx.rng() * 0.08;
    s.scale.set(sc, sc, 0.18);
    st.sparkles.push(s);
  }

  // ---- stage strip + player pads (characters stand here, front +Z) ----
  const stage = addMesh(st, st.root, newGeo(st, new THREE.BoxGeometry(L.wallW + 0.8, 0.42, 2.9)), toon(st, cream), [0, 0.21, 0.35]);
  st.root.add(outlineShell(st, stage));
  // booth floor boards from the wall to past the stage, so the gap under the
  // balloons reads as the booth, not as open ground
  const floor = addMesh(
    st, st.root, newGeo(st, new THREE.PlaneGeometry(L.wallW + 1.6, 9.4)),
    toon(st, hex(palette.wood)), [0, 0.005, -2.0], [-Math.PI / 2, 0, 0]
  );
  floor.castShadow = false;
  for (let i = 0; i < 6; i++) {
    const seam = addMesh(
      st, st.root, newGeo(st, new THREE.PlaneGeometry(L.wallW + 1.6, 0.07)),
      toon(st, hex(palette.woodDark)), [0, 0.01, -6.1 + i * 1.5], [-Math.PI / 2, 0, 0]
    );
    seam.castShadow = false;
  }
  const padGeo = newGeo(st, new THREE.CylinderGeometry(0.82, 0.94, 0.16, 16));
  for (let i = 0; i < 4; i++) {
    const px = L.colX[i];
    const pad = addMesh(st, st.root, padGeo, toon(st, st.players[i].color), [px, 0.5, 0.35]);
    st.root.add(outlineShell(st, pad, 1.12));
    void pad;
    // character on the pad, facing +Z (toward the camera)
    const ch = ctx.characters[i] ?? null;
    if (ch) {
      const wrapper = new THREE.Group();
      wrapper.position.set(px, 0.58, 0.85);
      wrapper.add(ch.group);
      // The screen lined the avatars up at (x, 0, 5.4); inside the wrapper
      // that offset pushed Pip and Tusk off the pads (and off screen).
      ch.group.position.set(0, 0, 0);
      st.root.add(wrapper);
      st.players[i].wrapper = wrapper;
      st.players[i].char = ch.group;
      ch.setFacing(0);
      ch.anim.idle();
    }
  }

  // ---- flat cel fill so the arena reads bright from the front ----
  const fill = new THREE.DirectionalLight(0xffffff, 1.1);
  fill.position.set(0, 9, 12);
  st.root.add(fill);
  const fillBack = new THREE.DirectionalLight(0xffffff, 0.75);
  fillBack.position.set(0, 10, -14);
  st.root.add(fillBack);
  void ink;
}

/* --------------------------- gameplay bits ------------------------------ */
/* All gameplay functions below run INSIDE stepFixed() only — every ctx.rng()
 * draw is gated on the integer stepIndex, making the draw order identical
 * across runs regardless of frame timing. */

/** Spawn a balloon in column col. Runs INSIDE stepFixed only. */
function spawnBalloon(st: State, col: number, sp: Spawn): void {
  const L = st.layout;
  const { r, color, phase, kind } = sp;
  const x = L.colX[col];
  const group = new THREE.Group();
  group.position.set(x, BOTTOM_Y, BALLOON_Z);

  // balloon body (cel) + ink outline shell (backside-only so it doesn't occlude)
  const body = addMesh(st, group, newGeo(st, new THREE.SphereGeometry(1, 12, 9)), toon(st, color), [0, 0, 0]);
  body.scale.setScalar(r);
  const shellGeo = newGeo(st, new THREE.SphereGeometry(1, 12, 9));
  const shellMat = basic(st, hex(palette.ink));
  shellMat.side = THREE.BackSide;
  const shell = new THREE.Mesh(shellGeo, shellMat);
  shell.scale.setScalar(r * 1.09);
  shell.castShadow = false;
  group.add(shell);
  // glossy highlight spot (upper-left)
  const hlGeo = newGeo(st, new THREE.SphereGeometry(1, 8, 6));
  const hlMat = basic(st, hex(palette.white));
  hlMat.transparent = true;
  hlMat.opacity = 0.55;
  const hl = new THREE.Mesh(hlGeo, hlMat);
  hl.position.set(-r * 0.35, r * 0.35, r * 0.82);
  hl.scale.set(r * 0.22, r * 0.22, r * 0.08);
  hl.castShadow = false;
  group.add(hl);
  // knot + string
  const knot = addMesh(st, group, newGeo(st, new THREE.ConeGeometry(1, 1, 8)), toon(st, hex(palette.ink)), [0, -r - 0.04, 0], [Math.PI, 0, 0]);
  knot.scale.set(r * 0.16, r * 0.3, r * 0.16);
  const len = r * 1.5;
  const string = addMesh(st, group, newGeo(st, new THREE.CylinderGeometry(1, 1, 1, 5)), toon(st, hex(palette.ink)), [0, -(r + len / 2), 0]);
  string.scale.set(0.024, len, 0.024);
  if (kind === "bomb") {
    // A lit fuse on top and a white skull-ish "X" face: clearly not a target.
    const fuse = addMesh(st, group, newGeo(st, new THREE.CylinderGeometry(1, 1, 1, 5)), toon(st, hex(palette.creamShadow)), [r * 0.25, r + 0.12, 0], [0, 0, -0.5]);
    fuse.scale.set(0.035, 0.26, 0.035);
    const spark = addMesh(st, group, newGeo(st, new THREE.OctahedronGeometry(1)), basic(st, hex(palette.sun)), [r * 0.38, r + 0.26, 0]);
    spark.scale.setScalar(0.09);
    spark.name = "spark";
    for (const sgn of [-1, 1]) {
      const bar = addMesh(st, group, newGeo(st, new THREE.BoxGeometry(1, 1, 1)), basic(st, hex(palette.white)), [0, 0, r * 0.95], [0, 0, sgn * 0.785]);
      bar.scale.set(r * 0.9, r * 0.2, 0.02);
    }
  } else if (kind === "gold") {
    const star = addMesh(st, group, newGeo(st, new THREE.OctahedronGeometry(1)), basic(st, hex(palette.white)), [0, 0, r * 0.95]);
    star.scale.set(r * 0.42, r * 0.42, 0.05);
    star.rotation.z = 0.785;
  }

  st.root.add(group);
  // CPU plan for this balloon (drawn here, in the fixed step, column order).
  let cpuPopY: number | null = null;
  const P = st.players[col];
  if (P && st.cpu.includes(col)) {
    const rng = st.ctx.rng;
    const want =
      kind === "bomb" ? rng() < CPU_BOMB_MISTAP : rng() < (kind === "gold" ? P.accuracy - CPU_GOLD_MALUS : P.accuracy);
    const y = CPU_POP_MIN_Y + rng() * (CPU_POP_MAX_Y - CPU_POP_MIN_Y);
    if (want) cpuPopY = y;
  }
  st.balloons.push({ group, kind, rise: sp.rise, col, x, y: BOTTOM_Y, r, color, phase, cpuPopY });
}

/** Pop a balloon: scoring + visuals. Runs INSIDE stepFixed only. */
function popBalloon(st: State, pid: number, b: Balloon, byHuman: boolean): void {
  const P = st.players[pid];
  st.root.remove(b.group);
  disposeGeos(b.group);
  const idx = st.balloons.indexOf(b);
  if (idx >= 0) st.balloons.splice(idx, 1);

  const L = st.layout;
  const frac = (b.r - L.rMin) / (L.rMax - L.rMin);
  const pts = PTS[b.kind];
  P.score = Math.max(0, P.score + pts);
  if (b.kind === "bomb") P.bombs += 1;
  else P.pops += 1;

  // pop sfx: pitch drops with size (bigger = lower), louder for the human
  const pitch = 1.5 - 0.8 * frac;
  st.ctx.playSfx(b.kind === "bomb" ? "boing" : "pop", { volume: byHuman ? 0.9 : 0.5, pitch: b.kind === "bomb" ? -3 : pitch });
  if (b.kind === "gold") st.ctx.playSfx("coin.gain", { volume: 0.9, pitch: 1.35 });

  // juice: shards in balloon color + white, pop ring, small shake
  const pos: [number, number, number] = [b.x, b.y, BALLOON_Z];
  spawnShards(st, pos, b.color, 9, 3.2, 0.5, 7, 0.09);
  spawnShards(st, pos, hex(SHARD_WHITES[Math.floor(st.ctx.rng() * SHARD_WHITES.length)]), 4, 2.6, 0.45, 6, 0.06);
  spawnRing(st, pos, b.r * 1.2);
  spawnPopup(st, pos, pts, P.color);
  st.shake = Math.min(0.28, st.shake + (b.kind === "normal" ? 0.045 : 0.1));

  // character reaction: human always cheer-hops; CPUs cheer sometimes
  const ch = st.ctx.characters[pid] ?? null;
  if (ch) {
    if (b.kind === "bomb") {
      ch.anim.sad();
      P.cheerT = 0.8;
    } else if (byHuman || st.ctx.rng() < 0.35) {
      ch.anim.cheer();
      P.cheerT = byHuman ? 0.95 : 0.7;
      if (byHuman && b.kind === "gold") st.ctx.playSfx("cheer", { volume: 0.45 });
    }
  }
  updateChip(st, pid);
}

/** Missed balloon floats off. Runs INSIDE stepFixed only. */
function missBalloon(st: State, b: Balloon): void {
  const P = st.players[b.col];
  st.root.remove(b.group);
  disposeGeos(b.group);
  const idx = st.balloons.indexOf(b);
  if (idx >= 0) st.balloons.splice(idx, 1);
  P.missed += 1;
  // sad little puff at the top; no penalty, just a missed opportunity
  spawnShards(st, [b.x, TOP_Y - 0.15, BALLOON_Z], hex(palette.creamShadow), 5, 1.3, 0.45, 1.6, 0.05, 0.2);
}

function rankPlayers(st: State): number[] {
  return [...st.players]
    .sort((a, b) => b.score - a.score || a.bombs - b.bombs || a.tieBreak - b.tieBreak)
    .map((p) => p.id);
}

function endRound(st: State): void {
  if (st.finished) return;
  st.finished = true;
  const ranking = rankPlayers(st);
  const scores = st.players.map((p) => `${p.id}:${p.score}`).join(",");
  const pops = st.players.map((p) => `p${p.id}:${p.pops}/${p.missed}`).join(",");
  console.log(`[balloon_pop] finish ranking=${ranking.join(",")} scores=${scores} pops=${pops}`);
  const winnerName = st.ctx.players[ranking[0]]?.name ?? "?";
  st.ctx.announce(`${winnerName} POPS THE MOST!`, { durationMs: 1600, sound: null });
  st.ctx.playSfx("crowd.cheer", { volume: 0.9 });
  spawnConfetti(st);
  st.shake = 0.3;
  const winCh = st.ctx.characters[ranking[0]] ?? null;
  if (winCh) winCh.anim.cheer();
  st.ctx.finish(ranking);
}

/** Pointer -> hit point on the balloon plane (camera basis math, no
 * renderer state — deterministic and frame-rate independent). */
function pickAt(st: State, nx: number, ny: number): { x: number; y: number } {
  const cam = st.ctx.camera;
  const pos = cam.position;
  const look = st.camLook;
  const fwd = new THREE.Vector3(look[0] - pos.x, look[1] - pos.y, look[2] - pos.z).normalize();
  const up = new THREE.Vector3(0, 1, 0);
  const right = new THREE.Vector3().crossVectors(fwd, up).normalize();
  const upv = new THREE.Vector3().crossVectors(right, fwd);
  const tanF = Math.tan((cam.fov * Math.PI) / 360);
  const aspect = window.innerWidth / Math.max(1, window.innerHeight);
  const ndcX = nx * 2 - 1;
  const ndcY = 1 - ny * 2;
  const dir = new THREE.Vector3()
    .addScaledVector(fwd, 1)
    .addScaledVector(right, ndcX * tanF * aspect)
    .addScaledVector(upv, ndcY * tanF)
    .normalize();
  const t = (BALLOON_Z - pos.z) / dir.z;
  return { x: pos.x + dir.x * t, y: pos.y + dir.y * t };
}

/** Nearest balloon in a column within tap reach of (hx, hy); null if none. */
function hitTest(st: State, col: number, hx: number, hy: number): Balloon | null {
  let best: Balloon | null = null;
  let bestD = Infinity;
  for (const b of st.balloons) {
    if (b.col !== col) continue;
    const rad = b.r + TAP_GRACE;
    const dx = b.x - hx;
    const dy = b.y - hy;
    const d2 = dx * dx + dy * dy;
    if (d2 <= rad * rad && d2 < bestD) {
      bestD = d2;
      best = b;
    }
  }
  return best;
}

/* ----------------------- critic telemetry mirror --------------------- */

interface BPDebug {
  stepIndex: number;
  t: number;
  scores: number[];
  ranking: number[] | null;
}

function bpDebug(): BPDebug {
  const w = window as unknown as { __BP__?: BPDebug };
  if (!w.__BP__) {
    w.__BP__ = { stepIndex: 0, t: 0, scores: [0, 0, 0, 0], ranking: null };
  }
  return w.__BP__;
}

function publishDebug(st: State): void {
  const d = bpDebug();
  d.stepIndex = st.stepIndex;
  d.t = +st.t.toFixed(4);
  d.scores = st.players.map((p) => p.score);
  if (st.finished && !d.ranking) {
    d.ranking = rankPlayers(st);
  }
}

/**
 * Advance the simulation by exactly one fixed step (1/60s).
 * Every gameplay decision — spawning, balloon rise, sweet-zone detection,
 * CPU commits, pops, misses, scoring, and round end — happens here, driven
 * by the integer stepIndex. All ctx.rng() draws are a pure function of
 * (seeded rng, stepIndex), so the draw order is identical across runs
 * regardless of frame timing.
 */
function stepFixed(st: State, dt: number): void {
  const ctx = st.ctx;
  st.t = st.stepIndex * FIXED_DT;
  const t = st.t;

  // ---- shared schedule: the same balloon appears in every column ----
  while (st.nextSpawn < st.schedule.length && st.schedule[st.nextSpawn].step <= st.stepIndex) {
    const sp = st.schedule[st.nextSpawn++];
    for (let col = 0; col < 4; col++) spawnBalloon(st, col, sp);
  }

  // ---- human taps queued since the last step ----
  const humanCol = localPlayerIndex(ctx.players);
  for (const tap of st.taps) {
    const b = hitTest(st, humanCol, tap.x, tap.y);
    if (b) popBalloon(st, humanCol, b, true);
  }
  st.taps.length = 0;

  // ---- balloons rise; CPUs pop at their planned height; escapes float off ----
  for (let i = st.balloons.length - 1; i >= 0; i--) {
    const b = st.balloons[i];
    b.y += b.rise * dt;
    b.group.position.y = b.y;
    // wobble uses fixed t for determinism
    b.group.rotation.z = Math.sin(t * 2.1 + b.phase) * 0.07;
    if (b.cpuPopY !== null && b.y >= b.cpuPopY) {
      popBalloon(st, b.col, b, false);
      continue;
    }
    if (b.y >= TOP_Y) {
      missBalloon(st, b);
    }
  }

  // ---- character timers -> idle ----
  for (const P of st.players) {
    if (P.cheerT > 0) {
      P.cheerT -= dt;
      if (P.cheerT <= 0) {
        const ch = ctx.characters[P.id] ?? null;
        if (ch) ch.anim.idle();
      }
    }
  }

  // ---- end: TIME_CAP ----
  if (t >= TIME_CAP) {
    endRound(st);
    return;
  }

  publishDebug(st);
}

/* ------------------------------ minigame --------------------------------- */

const balloonPop: Minigame = {
  id: "balloon_pop",
  name: "Balloon Pop",
  genre: "target",
  howTo: "Tap the balloons in YOUR column (your colour) before they float away. Gold balloons are worth +3. Dark bomb balloons cost 2, so leave them alone! Most points wins.",
  goal: "Pop your balloons. Skip the bombs!",
  tap: null,
  steer: false,
  tapSfx: "pop",
  rules: {
    format: "ffa",
    length: "28 seconds",
    win: "Most points: balloon +1, gold +3, bomb -2",
    touch: ["Tap a balloon in your column to pop it", "Don't tap the dark bombs!"],
    keys: ["Click a balloon in your column to pop it", "Don't click the dark bombs!"],
  },

  setup(ctx: MinigameContext): void {
    const portrait = window.innerWidth / window.innerHeight < 1;
    const L = portrait ? LAYOUTS.portrait : LAYOUTS.landscape;
    const st: State = {
      ctx,
      root: new THREE.Group(),
      layout: L,
      players: [],
      balloons: [],
      shards: [],
      rings: [],
      popups: [],
      schedule: [],
      nextSpawn: 0,
      taps: [],
      cpu: [],
      t: 0,
      shake: 0,
      announcedGo: false,
      finished: false,
      camBase: L.cam,
      camLook: [0, 3.5, -6],
      toons: new Map(),
      geos: [],
      mats: [],
      sparkles: [],
      simTime: 0,
      stepIndex: 0,
    };
    state = st;

    // ---- per-player state (id = playerId = column index) ----
    ctx.players.forEach((p, i) => {
      // CPU accuracy drawn once per player at setup (deterministic order)
      const accuracy = CPU_ACCURACY + (ctx.rng() - 0.5) * CPU_ACCURACY_SPREAD;
      st.players.push({
        id: p.id,
        x: L.colX[i],
        color: hex(p.color),
        score: 0,
        pops: 0,
        bombs: 0,
        missed: 0,
        tieBreak: ctx.rng(),
        accuracy,
        cheerT: 0,
        chip: null,
        wrapper: null,
        char: null,
      });
    });

    // ---- camera: front view of the carnival wall, fitted to the screen ----
    // The whole booth (wall, awning, pads and the characters on them) stays
    // between the score chips and the POP button at any aspect.
    const halfW = (L.wallW + 1.6) / 2;
    frameMinigame(
      ctx.camera,
      {
        box: frameBox([-halfW, 0, -6.6], [halfW, 8.3, 1.9]),
        dir: new THREE.Vector3(0, 2.3, 14),
        fov: 50,
        // chips + time bar + the announce line under them
        insets: { top: 104 },
      },
      (f) => {
        st.camBase = [f.pos.x, f.pos.y, f.pos.z];
        st.camLook = [f.look.x, f.look.y, f.look.z];
      }
    );

    buildArena(st);
    ctx.scene.add(st.root);

    // ---- who the CPU model drives: CPU seats, plus yours under autoplay ----
    st.cpu = automatedSeatIds(ctx.players, isAutoplay());

    // ---- the shared balloon schedule (drawn once, used by every column) ----
    let at = 0.45;
    while (at < TIME_CAP - 1.2) {
      const u = at / TIME_CAP;
      const roll = ctx.rng();
      const kind: BalloonKind = roll < GOLD_P ? "gold" : roll < GOLD_P + BOMB_P ? "bomb" : "normal";
      const baseRise = RISE_START + (RISE_END - RISE_START) * u;
      const r =
        kind === "gold" ? L.rMin * 0.95 : L.rMin + ctx.rng() * (L.rMax - L.rMin);
      const color =
        kind === "gold"
          ? hex(palette.sun)
          : kind === "bomb"
            ? hex(palette.ink)
            : hex(BALLOON_COLORS_NORMAL[Math.floor(ctx.rng() * BALLOON_COLORS_NORMAL.length)]);
      st.schedule.push({
        step: Math.round(at / FIXED_DT),
        kind,
        r,
        color,
        phase: ctx.rng() * Math.PI * 2,
        rise: kind === "gold" ? baseRise * GOLD_RISE : baseRise,
      });
      at += GAP_START + (GAP_END - GAP_START) * u + (ctx.rng() - 0.5) * 2 * GAP_JITTER;
    }

    ctx.hud.unit("pts");
    for (const P of st.players) ctx.hud.score(P.id, 0);
    ctx.hud.timer(TIME_CAP, TIME_CAP);

    // ---- input: tap/click a balloon in your column (resolved next step) ----
    ctx.input.pointer = (x: number, y: number, down: boolean): void => {
      if (!down || st.finished || isPracticeBeat() || st.cpu.includes(localPlayerIndex(ctx.players))) return;
      st.taps.push(pickAt(st, x, y));
    };
    ctx.input.key = (): void => {};

    // Fresh telemetry mirror per round (critic probes read window.__BP__).
    (window as unknown as { __BP__?: unknown }).__BP__ = undefined;
    publishDebug(st);
  },

  update(dt: number): void {
    const st = state;
    if (!st || st.finished || isPracticeBeat()) return;

    /* ---- fixed-step accumulator: run whole 1/60s steps only ---- */
    st.simTime += dt;
    let steps = 0;
    while (st.simTime >= FIXED_DT && steps < MAX_STEPS_PER_FRAME) {
      stepFixed(st, FIXED_DT);
      st.simTime -= FIXED_DT;
      st.stepIndex++;
      steps++;
      if (st.finished) break;
    }
    // If we hit the step cap, drop the backlog (spiral-of-death guard).
    if (steps >= MAX_STEPS_PER_FRAME && st.simTime >= FIXED_DT) {
      st.simTime = 0;
    }

    /* ---- per-frame visuals (NOT gameplay — no ctx.rng draws) ---- */
    // sync t for visuals that read st.t (popups)
    st.t = st.stepIndex * FIXED_DT;
    st.shake = Math.max(0, st.shake - dt * 0.9);
    if (st.shake > 0) {
      st.ctx.camera.position.set(
        st.camBase[0] + Math.sin(st.t * 57) * st.shake,
        st.camBase[1] + Math.cos(st.t * 43) * st.shake,
        st.camBase[2] + Math.sin(st.t * 61) * st.shake
      );
      st.ctx.camera.lookAt(st.camLook[0], st.camLook[1], st.camLook[2]);
    }
    updateFx(st, dt);
    updatePopups(st, dt);
    st.ctx.hud.timer(Math.max(0, TIME_CAP - st.t), TIME_CAP);
    // Bomb fuses flicker (visual only).
    for (const b of st.balloons) {
      if (b.kind !== "bomb") continue;
      const spark = b.group.getObjectByName("spark");
      if (spark) spark.scale.setScalar(0.07 + 0.05 * Math.abs(Math.sin(st.t * 22 + b.phase)));
    }

    publishDebug(st);
  },

  teardown(): void {
    const st = state;
    if (!st) return;
    // hand the characters back to the framework (direct scene children again)
    for (const P of st.players) {
      if (P.char && P.wrapper) {
        P.wrapper.remove(P.char);
        st.ctx.scene.add(P.char);
      }
    }
    st.ctx.input.pointer = (): void => {};
    st.ctx.input.key = (): void => {};
    st.ctx.scene.remove(st.root);
    disposeObj(st.root);
    // popup textures are cached for the round's lifetime; drop the refs
    POPUP_PLUS1.length = 0;
    state = null;
  },
};

export function loadBalloonPop(): Promise<Minigame> {
  return Promise.resolve(balloonPop);
}

export default balloonPop;

// Self-register once the module is importable (registry dedupes by id).
void registerMinigame({ id: balloonPop.id, name: balloonPop.name });
