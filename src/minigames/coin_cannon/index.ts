/**
 * SUPER STAR PARTY — COIN CANNON (genre: timing, pack: midway)
 *
 * Four conveyor belts, one per player, each tinted in its player's colour.
 * Every cannon hangs directly above the target ring on its own belt. TAP
 * fires a coin at once; it always takes FLIGHT (0.60 s) to drop straight
 * down onto the ring. A basket that is on the ring when the coin lands
 * catches it: +1 inside CATCH_R, +2 inside BULL_R. Each basket takes one
 * coin, then lights up and closes.
 *
 * The lead is drawn on every belt: the FIRE! line sits speed x FLIGHT
 * before the ring, so "basket crosses the line" is exactly "fire now".
 *
 * Fairness: ONE basket schedule (arrival times + speeds) is drawn from
 * ctx.rng at setup and used on all four belts, so every player gets the
 * same baskets. 12 coins each; the round ends once every coin has landed
 * (or nothing is left to catch, or TIME_CAP).
 *
 * Determinism: fixed 1/60 s sim step. Every gameplay draw (schedule, CPU
 * plans, tie-breaks) happens in setup from ctx.rng in a fixed order that
 * does not depend on who is CPU. Particles use a separate cosmetic rng
 * seeded from one ctx.rng draw. Rendering interpolates between steps, so
 * baskets and coins move smoothly at any frame rate.
 */
import * as THREE from "three";
import {
  automatedSeatIds,
  cpuSkill,
  isPracticeBeat,
  localPlayerIndex,
  type Minigame,
  type MinigameContext,
} from "../framework";
import { registerMinigame } from "../registry";
import { box as frameBox, frameMinigame } from "../framing";
import { viewportSize } from "../../ui/viewport";
import { palette, hex } from "../../config/palette";
import { celGradient } from "../../characters/cel";
import { isAutoplay } from "../../core/debug";

/* ------------------------------ tuning --------------------------------- */

const DT = 1 / 60; // fixed sim step
const MAX_STEPS = 12; // per frame: maxDelta 1/20 x speed 4 = 0.2 s
const COINS = 12; // coins per player
const N_BASKETS = 16; // baskets per belt (same schedule on every belt)
const FLIGHT = 0.6; // tap -> coin at basket rim, always
const CATCH_R = 0.6; // |basket centre| at landing for +1
const BULL_R = 0.2; // ... for +2
const TIME_CAP = 28; // hard round length (s)
const SETTLE = 0.12; // pause after the last coin lands before finishing

// Basket schedule: speeds 2.6–3.5 u/s plus a ramp of +0.8 over the round.
const SPEED_MIN = 2.6;
const SPEED_JIT = 0.9;
const SPEED_RAMP = 0.8;
const FIRST_ARRIVAL = 3.4; // first basket reaches the ring
const GAP_MIN = 1.15; // seconds between ring arrivals
const GAP_JIT = 0.4;
const MIN_SEP = 1.7; // world units between baskets anywhere on the belt

// CPU: fire at the ideal time + N(0, CPU_SD * m), m per CPU per round.
const CPU_SD = 0.118;
const CPU_M_MIN = 0.7;
const CPU_M_MAX = 1.3;
const CPU_SKIP = 0.05;

// Layout (world units). Ring at x = 0; baskets move right -> left.
const LANE_Z = [4.8, 1.4, -2.0, -5.4]; // lane 0 = front = the local player
const SPAWN_X = 9.4; // baskets appear at the right end of the belt
const EXIT_X = -3.2; // and drop off the left end
const BELT_L = -3.7;
const BELT_R = 9.8;
const FLAG_X = -4.3; // name flag over the belt's left end
const RIM_Y = 0.66; // basket rim height (coin is caught here)
const BELT_Y = 0.16; // belt surface (baskets sit here; a missed coin bounces here)
const MUZZLE_Y = 2.3; // coins drop from rest at the muzzle
const GRAV = (2 * (MUZZLE_Y - RIM_Y)) / (FLIGHT * FLIGHT);
const POST_DZ = -1.05; // cannon post sits behind its own belt
const CHAR_X = -1.3;
const CHAR_DZ = -1.35;

/* ------------------------------ types ----------------------------------- */

interface BasketPlan {
  arrive: number; // sim time the basket centre crosses the ring (x = 0)
  speed: number;
}

interface BasketView {
  group: THREE.Group;
  rim: THREE.Mesh;
  lid: THREE.Mesh;
  glow: THREE.Mesh;
  closed: boolean;
  lit: number; // 1 -> 0 catch flash
}

interface Coin {
  lane: number;
  fireT: number;
  landT: number;
  resolved: boolean;
  caught: boolean;
  group: THREE.Group;
  popped: boolean;
}

interface Particle {
  mesh: THREE.Mesh;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
  grav: number;
  base: number;
}

interface Popup {
  sprite: THREE.Sprite;
  life: number;
}

interface PlayerSt {
  id: number;
  lane: number;
  name: string;
  color: number;
  colorCss: string;
  ammo: number;
  score: number;
  bulls: number;
  tieBreak: number;
  cpu: boolean;
  /** Planned fire time per basket (null = skip). Drawn for every seat. */
  plan: (number | null)[];
  nextPlan: number;
  barrel: THREE.Group;
  recoil: number;
  cheerT: number;
  baskets: BasketView[];
  arrow: THREE.Group;
  arrowX: number;
  arrowMat: THREE.MeshBasicMaterial;
  shadow: THREE.Mesh;
  shadowMat: THREE.MeshBasicMaterial;
}

interface State {
  ctx: MinigameContext;
  root: THREE.Group;
  players: PlayerSt[]; // by lane
  byId: Map<number, PlayerSt>;
  schedule: BasketPlan[];
  coins: Coin[];
  particles: Particle[];
  popups: Popup[];
  rollers: THREE.Mesh[];
  youFrame: THREE.MeshBasicMaterial | null;
  humanId: number; // -1 when no seat takes local input
  pendingFire: number;
  reload: number;
  simT: number;
  acc: number;
  t: number;
  endAt: number; // sim time to finish at (-1 = not yet)
  finished: boolean;
  camBase: [number, number, number];
  camLook: [number, number, number];
  cosRng: () => number;
  toons: Map<number, THREE.MeshToonMaterial>;
  ink: THREE.MeshBasicMaterial | null;
  shells: Map<THREE.BufferGeometry, THREE.BufferGeometry>;
  geos: THREE.BufferGeometry[];
  mats: THREE.Material[];
  texs: THREE.Texture[];
  g: {
    sphere: THREE.BufferGeometry;
    coin: THREE.BufferGeometry;
    popup1: THREE.Texture;
    popup2: THREE.Texture;
  };
}

let state: State | null = null;

/* --------------------------- pure helpers -------------------------------- */

function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal from two rng draws (Box–Muller). */
function normal(rng: () => number): number {
  const u = Math.max(1e-9, rng());
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Basket x on its belt at time t (ring at 0, moving toward -x). */
function basketX(b: BasketPlan, t: number): number {
  return (b.arrive - t) * b.speed;
}

/** b (behind) never closer than MIN_SEP to a (ahead) while both are on the belt. */
function spaced(a: BasketPlan, b: BasketPlan): boolean {
  const t0 = b.arrive - SPAWN_X / b.speed; // b appears
  const t1 = a.arrive - EXIT_X / a.speed; // a leaves
  if (t0 >= t1) return true;
  // The gap is linear in t, so checking both ends covers the whole overlap.
  return basketX(b, t0) - basketX(a, t0) >= MIN_SEP && basketX(b, t1) - basketX(a, t1) >= MIN_SEP;
}

/** The one shared basket schedule (2 draws per basket). */
function makeSchedule(rng: () => number): BasketPlan[] {
  const out: BasketPlan[] = [];
  let arrive = FIRST_ARRIVAL;
  for (let i = 0; i < N_BASKETS; i++) {
    const speed = SPEED_MIN + rng() * SPEED_JIT + (SPEED_RAMP * i) / (N_BASKETS - 1);
    const gap = GAP_MIN + rng() * GAP_JIT;
    if (i > 0) {
      arrive += gap;
      const plan = { arrive, speed };
      for (let k = 0; k < 100 && !spaced(out[i - 1], plan); k++) plan.arrive += 0.05;
      arrive = plan.arrive;
    }
    out.push({ arrive, speed });
  }
  return out;
}

/* --------------------------- render helpers ------------------------------ */

function toon(st: State, color: number): THREE.MeshToonMaterial {
  let m = st.toons.get(color);
  if (!m) {
    m = new THREE.MeshToonMaterial({ gradientMap: celGradient, color });
    st.toons.set(color, m);
    st.mats.push(m);
  }
  return m;
}

function basic(st: State, color: number, opacity = 1): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity });
  st.mats.push(m);
  return m;
}

function geo<G extends THREE.BufferGeometry>(st: State, g: G): G {
  st.geos.push(g);
  return g;
}

function mesh(
  parent: THREE.Object3D,
  g: THREE.BufferGeometry,
  m: THREE.Material,
  pos: [number, number, number],
  rot?: [number, number, number],
): THREE.Mesh {
  const out = new THREE.Mesh(g, m);
  out.position.set(pos[0], pos[1], pos[2]);
  if (rot) out.rotation.set(rot[0], rot[1], rot[2]);
  parent.add(out);
  return out;
}

const OUTLINE_SCALE = 1.06;

/** Ink back-face shell placed exactly on `src` (shell geometry shared per source). */
function outline(st: State, src: THREE.Mesh): THREE.Mesh {
  let g = st.shells.get(src.geometry);
  if (!g) {
    g = geo(st, src.geometry.clone());
    g.scale(OUTLINE_SCALE, OUTLINE_SCALE, OUTLINE_SCALE);
    st.shells.set(src.geometry, g);
  }
  if (!st.ink) {
    st.ink = basic(st, hex(palette.ink));
    st.ink.side = THREE.BackSide;
  }
  const shell = new THREE.Mesh(g, st.ink);
  shell.position.copy(src.position);
  shell.quaternion.copy(src.quaternion);
  shell.scale.copy(src.scale);
  src.parent?.add(shell);
  return shell;
}

const mixA = new THREE.Color();
const mixB = new THREE.Color();
function mix(a: number, b: number, k: number): number {
  return mixA.setHex(a).lerp(mixB.setHex(b), k).getHex();
}

/** A rounded label drawn once into a canvas texture. */
function labelTexture(st: State, text: string, bg: string, fg: string, w = 256, h = 80): THREE.CanvasTexture {
  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = h;
  const g = cv.getContext("2d")!;
  const r = h * 0.42;
  const pad = 5;
  g.beginPath();
  g.moveTo(pad + r, pad);
  g.lineTo(w - pad - r, pad);
  g.arc(w - pad - r, h / 2, h / 2 - pad, -Math.PI / 2, Math.PI / 2);
  g.lineTo(pad + r, h - pad);
  g.arc(pad + r, h / 2, h / 2 - pad, Math.PI / 2, (Math.PI * 3) / 2);
  g.closePath();
  g.fillStyle = bg;
  g.fill();
  g.lineWidth = 7;
  g.strokeStyle = palette.ink;
  g.stroke();
  let size = Math.floor(h * 0.56);
  g.font = `700 ${size}px Fredoka, system-ui, sans-serif`;
  while (g.measureText(text).width > w - 2 * r && size > 14) {
    size -= 2;
    g.font = `700 ${size}px Fredoka, system-ui, sans-serif`;
  }
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.lineWidth = 6;
  g.strokeStyle = palette.ink;
  g.strokeText(text, w / 2, h / 2 + 2);
  g.fillStyle = fg;
  g.fillText(text, w / 2, h / 2 + 2);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  st.texs.push(tex);
  return tex;
}

function sprite(st: State, tex: THREE.Texture, w: number, h: number): THREE.Sprite {
  const m = new THREE.SpriteMaterial({ map: tex, depthWrite: false });
  st.mats.push(m);
  const s = new THREE.Sprite(m);
  s.scale.set(w, h, 1);
  return s;
}

/* ----------------------------- particles -------------------------------- */

function burst(
  st: State,
  pos: [number, number, number],
  color: number,
  count: number,
  speed: number,
  life: number,
  grav: number,
  base = 0.07,
): void {
  const r = st.cosRng;
  const mat = toon(st, color);
  for (let i = 0; i < count; i++) {
    const m = new THREE.Mesh(st.g.sphere, mat);
    m.position.set(pos[0], pos[1], pos[2]);
    m.scale.setScalar(base);
    st.root.add(m);
    const th = r() * Math.PI * 2;
    const ph = r() * Math.PI - Math.PI / 2;
    const sp = speed * (0.5 + r() * 0.8);
    st.particles.push({
      mesh: m,
      vx: Math.cos(th) * Math.cos(ph) * sp,
      vy: Math.sin(ph) * sp + 1.5,
      vz: Math.sin(th) * Math.cos(ph) * sp,
      life,
      maxLife: life,
      grav,
      base: base * (0.7 + r() * 0.6),
    });
  }
}

function updateParticles(st: State, dt: number): void {
  for (let i = st.particles.length - 1; i >= 0; i--) {
    const p = st.particles[i];
    p.life -= dt;
    if (p.life <= 0) {
      st.root.remove(p.mesh);
      st.particles.splice(i, 1);
      continue;
    }
    p.vy -= p.grav * dt;
    p.mesh.position.x += p.vx * dt;
    p.mesh.position.y += p.vy * dt;
    p.mesh.position.z += p.vz * dt;
    p.mesh.scale.setScalar(p.base * Math.max(0, p.life / p.maxLife));
  }
  for (let i = st.popups.length - 1; i >= 0; i--) {
    const p = st.popups[i];
    p.life -= dt;
    p.sprite.position.y += dt * 1.1;
    const mat = p.sprite.material as THREE.SpriteMaterial;
    mat.opacity = Math.min(1, p.life / 0.3);
    if (p.life <= 0) {
      st.root.remove(p.sprite);
      mat.dispose();
      st.popups.splice(i, 1);
    }
  }
}

/* ---------------------------- arena build ------------------------------- */

/** Sky backdrop: bubble gradient to cream, sun disc and three clouds. */
function makeSkyTexture(st: State): THREE.CanvasTexture {
  const W = 512;
  const H = 256;
  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const g = cv.getContext("2d")!;
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, palette.bubble);
  grad.addColorStop(0.6, palette.bubble);
  grad.addColorStop(1, palette.cream);
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  const sunX = W * 0.75;
  const sunY = H * 0.22;
  const sunR = 28;
  g.beginPath();
  g.arc(sunX, sunY, sunR, 0, Math.PI * 2);
  g.fillStyle = palette.sun;
  g.fill();
  g.strokeStyle = palette.sun;
  g.lineWidth = 3;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    g.beginPath();
    g.moveTo(sunX + Math.cos(a) * (sunR + 4), sunY + Math.sin(a) * (sunR + 4));
    g.lineTo(sunX + Math.cos(a) * (sunR + 12), sunY + Math.sin(a) * (sunR + 12));
    g.stroke();
  }
  for (const c of [
    { x: 0.18, y: 0.28, s: 0.7, a: 0.85 },
    { x: 0.55, y: 0.18, s: 0.55, a: 0.7 },
    { x: 0.85, y: 0.4, s: 0.45, a: 0.6 },
  ]) {
    const cx = c.x * W;
    const cy = c.y * H;
    g.globalAlpha = c.a;
    g.fillStyle = palette.white;
    g.beginPath();
    g.arc(cx - 18 * c.s, cy, 14 * c.s, 0, Math.PI * 2);
    g.arc(cx, cy - 8 * c.s, 18 * c.s, 0, Math.PI * 2);
    g.arc(cx + 18 * c.s, cy, 14 * c.s, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  st.texs.push(tex);
  return tex;
}

function buildBackdrop(st: State): void {
  const root = st.root;
  const sky = mesh(root, geo(st, new THREE.PlaneGeometry(30, 12)), new THREE.MeshBasicMaterial({ map: makeSkyTexture(st) }), [0, 6.5, -11.5]);
  st.mats.push(sky.material as THREE.Material);

  // grass checker floor
  const tile = geo(st, new THREE.BoxGeometry(5.5, 0.2, 4.2));
  for (let gx = 0; gx < 4; gx++) {
    for (let gz = 0; gz < 5; gz++) {
      const col = (gx + gz) % 2 === 0 ? hex(palette.grassA) : hex(palette.grassB);
      mesh(root, tile, toon(st, col), [gx * 5.5 - 8.25, -0.1, gz * 4.2 - 8.8]);
    }
  }
  const mint = toon(st, hex(palette.mint));
  const longB = geo(st, new THREE.BoxGeometry(22, 0.26, 0.3));
  const sideB = geo(st, new THREE.BoxGeometry(0.3, 0.26, 21));
  for (const b of [
    mesh(root, longB, mint, [0, 0.03, -10.8]),
    mesh(root, longB, mint, [0, 0.03, 10.0]),
    mesh(root, sideB, mint, [-11.15, 0.03, -0.4]),
    mesh(root, sideB, mint, [11.15, 0.03, -0.4]),
  ]) {
    outline(st, b);
  }

  // carnival wall with candy stripes, a star and two big coins
  mesh(root, geo(st, new THREE.BoxGeometry(24, 8.2, 0.3)), toon(st, hex(palette.cream)), [0, 4.1, -9.9]);
  const stripe = geo(st, new THREE.BoxGeometry(3.0, 8.2, 0.34));
  const stripeColors = [palette.candy, palette.sun, palette.mint, palette.bubble];
  for (let i = 0; i < 8; i++) {
    mesh(root, stripe, toon(st, hex(stripeColors[i % 4])), [-10.5 + i * 3, 4.1, -9.74]);
  }
  const star = mesh(root, geo(st, new THREE.OctahedronGeometry(1)), toon(st, hex(palette.sun)), [0, 6.15, -9.7]);
  star.scale.set(1.15, 1.55, 0.5);
  outline(st, star);
  const discG = geo(st, new THREE.CylinderGeometry(0.62, 0.62, 0.1, 20));
  const innerG = geo(st, new THREE.CylinderGeometry(0.38, 0.38, 0.14, 16));
  for (const cx of [-4.4, 4.4]) {
    const disc = mesh(root, discG, toon(st, hex(palette.sun)), [cx, 2.5, -9.72], [Math.PI / 2, 0, 0]);
    mesh(root, innerG, toon(st, hex(palette.sunDeep)), [cx, 2.5, -9.64], [Math.PI / 2, 0, 0]);
    outline(st, disc);
  }

  // Multi-directional fills keep every surface in the lit cel band.
  const fill = new THREE.DirectionalLight(0xffffff, 1.15);
  fill.position.set(2, 10, 16);
  root.add(fill);
  const fillBack = new THREE.DirectionalLight(0xffffff, 0.9);
  fillBack.position.set(0, 12, -16);
  root.add(fillBack);
  const fillSide = new THREE.DirectionalLight(0xffffff, 0.55);
  fillSide.position.set(-12, 7, 2);
  root.add(fillSide);
}

function buildLanes(st: State): void {
  const root = st.root;
  const ink = hex(palette.ink);
  const beltLen = BELT_R - BELT_L;
  const beltCx = (BELT_R + BELT_L) / 2;
  const beltG = geo(st, new THREE.BoxGeometry(beltLen, 0.16, 1.3));
  const wallG = geo(st, new THREE.BoxGeometry(beltLen, 0.36, 0.14));
  const capG = geo(st, new THREE.BoxGeometry(0.14, 0.36, 1.74));
  const rollerG = geo(st, new THREE.CylinderGeometry(0.16, 0.16, 1.44, 10));
  const ringG = geo(st, new THREE.TorusGeometry(CATCH_R, 0.05, 8, 28));
  const bullG = geo(st, new THREE.TorusGeometry(BULL_R, 0.045, 8, 18));
  const shadowG = geo(st, new THREE.CircleGeometry(0.34, 20));
  const lineG = geo(st, new THREE.BoxGeometry(0.2, 0.03, 1.28));
  const chevG = geo(st, new THREE.BoxGeometry(0.46, 0.03, 0.13));
  const stemG = geo(st, new THREE.CylinderGeometry(0.035, 0.035, 0.8, 6));
  const postG = geo(st, new THREE.CylinderGeometry(0.16, 0.22, 2.7, 12));
  const armG = geo(st, new THREE.BoxGeometry(0.26, 0.22, 1.25));
  const bodyG = geo(st, new THREE.BoxGeometry(0.62, 0.42, 0.62));
  const barrelG = geo(st, new THREE.CylinderGeometry(0.2, 0.17, 0.62, 14));
  const muzzleG = geo(st, new THREE.TorusGeometry(0.2, 0.055, 8, 16));
  const poleG = geo(st, new THREE.CylinderGeometry(0.06, 0.07, 1.3, 8));
  const basketBodyG = geo(st, new THREE.CylinderGeometry(0.55, 0.42, 0.5, 14));
  const basketRimG = geo(st, new THREE.TorusGeometry(0.58, 0.07, 8, 18));
  const lidG = geo(st, new THREE.CylinderGeometry(0.56, 0.56, 0.06, 18));
  const glowG = geo(st, new THREE.TorusGeometry(0.72, 0.06, 6, 24));
  const frameLong = geo(st, new THREE.BoxGeometry(beltLen + 0.5, 0.06, 0.12));
  const frameEnd = geo(st, new THREE.BoxGeometry(0.12, 0.06, 2.14));
  const fireTex = labelTexture(st, "FIRE!", palette.sun, palette.ink, 192, 72);

  for (const P of st.players) {
    const lz = LANE_Z[P.lane];
    const you = P.lane === 0; // the front belt is always this device's seat
    const beltCol = mix(P.color, hex(palette.cream), 0.35);

    // belt, rollers, player-coloured side walls and end caps
    mesh(root, beltG, toon(st, beltCol), [beltCx, 0.08, lz]);
    for (let x = BELT_L + 0.45; x <= BELT_R - 0.4; x += 1.5) {
      if (Math.abs(x) < CATCH_R + 0.3) continue; // keep the ring clear
      const roll = mesh(root, rollerG, toon(st, hex(palette.woodDark)), [x, 0.1, lz], [Math.PI / 2, 0, 0]);
      st.rollers.push(roll);
    }
    for (const side of [-0.8, 0.8]) outline(st, mesh(root, wallG, toon(st, P.color), [beltCx, 0.18, lz + side]));
    for (const ex of [BELT_L, BELT_R]) outline(st, mesh(root, capG, toon(st, P.color), [ex, 0.18, lz]));

    // target ring + bullseye + landing shadow
    outline(st, mesh(root, ringG, toon(st, hex(palette.cream)), [0, BELT_Y + 0.02, lz], [Math.PI / 2, 0, 0]));
    mesh(root, bullG, toon(st, hex(palette.sun)), [0, BELT_Y + 0.02, lz], [Math.PI / 2, 0, 0]);
    P.shadowMat = basic(st, ink, 0.25);
    P.shadowMat.depthWrite = false;
    P.shadow = mesh(root, shadowG, P.shadowMat, [0, BELT_Y + 0.01, lz], [-Math.PI / 2, 0, 0]);

    // FIRE! marker: a gold line across the belt, chevrons, and a label
    const arrow = new THREE.Group();
    arrow.position.set(SPEED_MIN * FLIGHT * 1.15, 0, lz);
    P.arrowMat = basic(st, hex(palette.ink));
    mesh(arrow, lineG, P.arrowMat, [0, BELT_Y + 0.02, 0]);
    // a "<" pointing at the ring (the way the baskets travel)
    for (const sz of [-1, 1]) {
      mesh(arrow, chevG, P.arrowMat, [-0.4, BELT_Y + 0.02, 0.15 * sz], [0, (-sz * Math.PI) / 4, 0]);
    }
    mesh(arrow, stemG, P.arrowMat, [0, 0.56, -0.82]);
    const tag = sprite(st, fireTex, you ? 1.7 : 1.2, you ? 0.64 : 0.45);
    tag.position.set(0, you ? 1.22 : 1.05, -0.82);
    arrow.add(tag);
    root.add(arrow);
    P.arrow = arrow;
    P.arrowX = arrow.position.x;

    // name flag at the left end
    mesh(root, poleG, toon(st, hex(palette.woodDark)), [FLAG_X, 0.65, lz - 0.55]);
    const flag = sprite(st, labelTexture(st, P.name, P.colorCss, palette.white), 1.9, 0.6);
    flag.position.set(FLAG_X, 1.35, lz - 0.45);
    root.add(flag);

    // cannon: post behind the belt, arm over the ring, barrel straight down
    const post = mesh(root, postG, toon(st, P.color), [0, 1.35, lz + POST_DZ]);
    outline(st, post);
    const arm = mesh(root, armG, toon(st, hex(palette.metal)), [0, 2.75, lz + POST_DZ / 2 + 0.05]);
    outline(st, arm);
    const body = mesh(root, bodyG, toon(st, P.color), [0, 2.78, lz]);
    outline(st, body);
    const barrel = new THREE.Group();
    barrel.position.set(0, 2.62, lz);
    root.add(barrel);
    outline(st, mesh(barrel, barrelG, toon(st, hex(palette.metal)), [0, -0.12, 0]));
    mesh(barrel, muzzleG, toon(st, hex(palette.candy)), [0, -0.42, 0], [Math.PI / 2, 0, 0]);
    P.barrel = barrel;

    // the player's avatar stands beside its cannon, facing the camera
    const ch = st.ctx.characters[P.id];
    if (ch) {
      ch.group.position.set(CHAR_X, 0, lz + CHAR_DZ);
      ch.setFacing(0);
      ch.anim.idle();
    }

    // pulsing outline around YOUR belt
    if (you) {
      const m = basic(st, hex(palette.sun), 0.9);
      m.depthWrite = false;
      st.youFrame = m;
      for (const dz of [-1.07, 1.07]) mesh(root, frameLong, m, [beltCx, 0.4, lz + dz]);
      for (const ex of [BELT_L - 0.25, BELT_R + 0.25]) mesh(root, frameEnd, m, [ex, 0.4, lz]);
    }

    // this lane's copy of the shared basket schedule
    for (let i = 0; i < st.schedule.length; i++) {
      const group = new THREE.Group();
      group.visible = false;
      const bodyM = mesh(group, basketBodyG, toon(st, hex(palette.wood)), [0, 0.41, 0]);
      outline(st, bodyM);
      const rim = mesh(group, basketRimG, toon(st, hex(palette.cream)), [0, RIM_Y, 0], [Math.PI / 2, 0, 0]);
      outline(st, rim);
      const lid = mesh(group, lidG, toon(st, hex(palette.sun)), [0, RIM_Y + 0.02, 0]);
      lid.visible = false;
      const glow = mesh(group, glowG, basic(st, hex(palette.sun), 0.9), [0, RIM_Y, 0], [Math.PI / 2, 0, 0]);
      glow.visible = false;
      group.position.set(SPAWN_X, 0, lz);
      root.add(group);
      P.baskets.push({ group, rim, lid, glow, closed: false, lit: 0 });
    }
  }
}

/* --------------------------- gameplay bits ------------------------------ */

function hudAmmo(st: State, P: PlayerSt): void {
  st.ctx.hud.tag(P.id, P.ammo > 0 ? `🪙 ${P.ammo}` : "DONE");
}

function fireCoin(st: State, P: PlayerSt): void {
  P.ammo -= 1;
  hudAmmo(st, P);
  const group = new THREE.Group();
  const coin = new THREE.Mesh(st.g.coin, toon(st, hex(palette.sun)));
  coin.rotation.x = Math.PI / 2;
  group.add(coin);
  outline(st, coin);
  for (let i = 0; i < 2; i++) {
    const t = new THREE.Mesh(st.g.sphere, toon(st, hex(palette.sunDeep)));
    t.scale.setScalar(0.07 - i * 0.02);
    t.position.y = 0.22 + i * 0.2;
    group.add(t);
  }
  group.position.set(0, MUZZLE_Y, LANE_Z[P.lane]);
  st.root.add(group);
  st.coins.push({ lane: P.lane, fireT: st.simT, landT: st.simT + FLIGHT, resolved: false, caught: false, group, popped: false });
  P.recoil = 1;
  if (P.cheerT <= 0) st.ctx.characters[P.id]?.anim.squash();
  st.ctx.playSfx("whoosh", { volume: P.id === st.humanId ? 0.6 : 0.25, rate: 1.2 });
}

/** Coin reaches the rim plane: the nearest open basket within CATCH_R takes it. */
function resolveCoin(st: State, c: Coin): void {
  c.resolved = true;
  const P = st.players[c.lane];
  let best = Infinity;
  let bi = -1;
  for (let i = 0; i < st.schedule.length; i++) {
    if (P.baskets[i].closed) continue;
    const d = Math.abs(basketX(st.schedule[i], c.landT));
    if (d < best) {
      best = d;
      bi = i;
    }
  }
  const lz = LANE_Z[c.lane];
  if (bi < 0 || best > CATCH_R) return; // keeps falling to the belt (render side)
  c.caught = true;
  const b = P.baskets[bi];
  b.closed = true;
  b.lit = 1;
  const pts = best <= BULL_R ? 2 : 1;
  P.score += pts;
  if (pts === 2) P.bulls += 1;
  st.ctx.hud.score(P.id, P.score);
  const at: [number, number, number] = [basketX(st.schedule[bi], c.landT), 0.9, lz];
  const mine = P.id === st.humanId;
  // own material (fades out, disposed with the popup)
  const pop = new THREE.Sprite(new THREE.SpriteMaterial({ map: pts === 2 ? st.g.popup2 : st.g.popup1, depthWrite: false }));
  pop.scale.set(pts === 2 ? 1.2 : 0.9, pts === 2 ? 0.45 : 0.34, 1);
  pop.position.set(at[0], 1.25, lz);
  st.root.add(pop);
  st.popups.push({ sprite: pop, life: 0.8 });
  if (pts === 2) {
    st.ctx.playSfx("coin.gain", { volume: mine ? 0.9 : 0.35, rate: 1.3 });
    if (mine) st.ctx.playSfx("crowd.ooh", { volume: 0.5 });
    burst(st, at, hex(palette.sun), 10, 3.2, 0.5, 7, 0.08);
    burst(st, at, hex(palette.white), 6, 2.6, 0.45, 6, 0.06);
  } else {
    st.ctx.playSfx("coin.gain", { volume: mine ? 0.75 : 0.3 });
    burst(st, at, hex(palette.sun), 7, 2.6, 0.45, 7, 0.07);
  }
  const ch = st.ctx.characters[P.id];
  if (ch) {
    ch.anim.cheer();
    P.cheerT = 0.9;
  }
}

/** Points, then bullseyes, then the tie-break drawn from ctx.rng at setup. */
function ranking(st: State): number[] {
  return [...st.players]
    .sort((a, b) => b.score - a.score || b.bulls - a.bulls || b.tieBreak - a.tieBreak)
    .map((p) => p.id);
}

function endRound(st: State): void {
  if (st.finished) return;
  st.finished = true;
  const order = ranking(st);
  st.ctx.hud.timer(null);
  const winner = st.byId.get(order[0]);
  st.ctx.announce(`${winner?.name ?? "?"} WINS!`, { durationMs: 1600, sound: null });
  st.ctx.playSfx("crowd.cheer", { volume: 0.9 });
  for (const P of st.players) P.cheerT = 0;
  st.ctx.characters[order[0]]?.anim.cheer();
  for (const id of order.slice(1)) st.ctx.characters[id]?.anim.idle();
  st.ctx.finish(order);
}

/** One fixed 1/60 s step. Gameplay decisions only; no rng draws. */
function step(st: State): void {
  st.simT += DT;
  const t = st.simT;
  if (st.reload > 0) st.reload = Math.max(0, st.reload - DT);

  // local fire (tap is taken on the next step: at most 1/60 s late)
  if (st.pendingFire > 0) {
    st.pendingFire -= 1;
    const H = st.byId.get(st.humanId);
    if (H && H.ammo > 0 && st.reload <= 0) {
      fireCoin(st, H);
      st.reload = 0.15;
    }
  }

  // CPUs: one planned shot per basket, at the ideal time + their error
  for (const P of st.players) {
    if (!P.cpu) continue;
    while (P.nextPlan < P.plan.length && P.ammo > 0) {
      const at = P.plan[P.nextPlan];
      if (at === null) {
        P.nextPlan += 1;
        continue;
      }
      if (t < at) break;
      P.nextPlan += 1;
      fireCoin(st, P);
    }
  }

  // coins land
  let inFlight = 0;
  for (const c of st.coins) {
    if (c.resolved) continue;
    if (t >= c.landT) resolveCoin(st, c);
    else inFlight += 1;
  }

  // end: everyone out of coins (or nothing left to catch), all coins landed
  if (st.endAt < 0) {
    const last = st.schedule[st.schedule.length - 1];
    const noneLeft = t > last.arrive + CATCH_R / last.speed;
    if ((noneLeft || st.players.every((p) => p.ammo <= 0)) && inFlight === 0) st.endAt = t + SETTLE;
  }
  if ((st.endAt >= 0 && t >= st.endAt) || t >= TIME_CAP) endRound(st);
}

/* ------------------------------ per frame -------------------------------- */

function render(st: State, dt: number): void {
  const rt = st.simT + st.acc; // smooth render time
  const pulse = 0.5 + 0.5 * Math.sin(st.t * 6);

  for (const P of st.players) {
    // baskets
    let target: BasketPlan | null = null;
    for (let i = 0; i < st.schedule.length; i++) {
      const plan = st.schedule[i];
      const b = P.baskets[i];
      const x = basketX(plan, rt);
      const on = x <= SPAWN_X && x >= EXIT_X - 0.6;
      b.group.visible = on;
      if (!target && !b.closed && rt < plan.arrive - FLIGHT + 0.25) target = plan;
      if (!on) continue;
      // pop in at the right end, sink off the left end
      const sIn = Math.min(1, (SPAWN_X - x) / 0.6);
      const sOut = Math.min(1, Math.max(0, (x - (EXIT_X - 0.6)) / 0.6));
      const s = Math.max(0.01, Math.min(sIn, sOut));
      b.lit = Math.max(0, b.lit - dt * 1.6);
      const bounce = b.lit * b.lit;
      b.group.position.set(x, 0.15 * bounce, LANE_Z[P.lane]);
      b.group.scale.set(s * (1 + 0.1 * bounce), s * (1 - 0.15 * bounce), s * (1 + 0.1 * bounce));
      b.lid.visible = b.closed;
      b.glow.visible = b.closed;
      if (b.closed) b.glow.scale.setScalar(1 + 0.35 * bounce);
      b.rim.material = toon(st, hex(b.closed ? palette.sun : palette.cream));
    }

    // FIRE! line slides to the next open basket's lead (speed x FLIGHT)
    if (target) {
      const want = target.speed * FLIGHT;
      P.arrowX += (want - P.arrowX) * Math.min(1, dt * 6);
      P.arrow.position.x = P.arrowX;
      const until = target.arrive - FLIGHT - rt;
      const near = Math.max(0, 1 - Math.abs(until) / 0.35);
      P.arrowMat.color.setHex(mix(hex(palette.ink), hex(palette.candy), near));
      P.arrow.visible = P.ammo > 0;
    } else {
      P.arrow.visible = false;
    }

    // landing shadow: grows and darkens while this lane's coin falls
    let k = 0;
    for (const c of st.coins) {
      if (c.lane !== P.lane || c.resolved) continue;
      k = Math.max(k, Math.min(1, (rt - c.fireT) / FLIGHT));
    }
    P.shadow.scale.setScalar(0.55 + 0.6 * k);
    P.shadowMat.opacity = 0.18 + 0.4 * k;

    // cannon recoil + character idle return
    P.recoil = Math.max(0, P.recoil - dt * 4);
    P.barrel.position.y = 2.62 + 0.12 * P.recoil;
    P.barrel.scale.set(1 + 0.15 * P.recoil, 1 - 0.12 * P.recoil, 1 + 0.15 * P.recoil);
    if (P.cheerT > 0) {
      P.cheerT -= dt;
      if (P.cheerT <= 0) st.ctx.characters[P.id]?.anim.idle();
    }
  }

  // coins: analytic fall from the muzzle; misses bounce off the belt
  for (let i = st.coins.length - 1; i >= 0; i--) {
    const c = st.coins[i];
    const lz = LANE_Z[c.lane];
    if (c.resolved && c.caught) {
      st.root.remove(c.group);
      st.coins.splice(i, 1);
      continue;
    }
    const tau = Math.max(0, rt - c.fireT);
    const y = MUZZLE_Y - 0.5 * GRAV * tau * tau;
    if (c.resolved && y <= BELT_Y + 0.05) {
      if (!c.popped) {
        c.popped = true;
        burst(st, [0, BELT_Y + 0.05, lz], hex(palette.creamShadow), 6, 1.6, 0.4, 3, 0.06);
        if (c.lane === 0) st.ctx.playSfx("pop", { volume: 0.35 });
      }
      st.root.remove(c.group);
      st.coins.splice(i, 1);
      continue;
    }
    c.group.position.set(0, Math.max(BELT_Y, y), lz);
    c.group.rotation.y += dt * 12;
  }

  for (const r of st.rollers) r.rotation.y += dt * 4;
  if (st.youFrame) st.youFrame.opacity = 0.35 + 0.6 * pulse;

  // The camera stays on its framed pose: no shake, no input-driven motion.
  const cam = st.ctx.camera;
  cam.position.set(st.camBase[0], st.camBase[1], st.camBase[2]);
  cam.lookAt(st.camLook[0], st.camLook[1], st.camLook[2]);
  updateParticles(st, dt);
}

/* ------------------------------ minigame --------------------------------- */

const coinCannon: Minigame = {
  id: "coin_cannon",
  name: "Coin Cannon",
  genre: "timing",
  howTo:
    "Your cannon is on the FRONT belt, glowing. Coins take a moment to drop, so tap when a basket reaches the arrow. +1 per catch, +2 dead-centre. Most points wins!",
  goal: "Fire when the basket hits the arrow!",
  tap: "FIRE",
  steer: false,
  tapSfx: "whoosh",
  rules: {
    format: "ffa",
    length: "12 coins",
    win: "Most points after 12 coins",
    touch: ["Tap anywhere (or FIRE) to drop a coin", "Fire as a basket reaches the arrow", "Dead-centre catches score +2"],
    keys: ["Space: fire a coin", "Or click anywhere"],
  },

  setup(ctx: MinigameContext): void {
    // ---- every gameplay draw, in a fixed order ----
    const schedule = makeSchedule(ctx.rng);
    const skill = cpuSkill();
    const plans = ctx.players.map(() => {
      const m = CPU_M_MIN + ctx.rng() * (CPU_M_MAX - CPU_M_MIN);
      return schedule.map((b) => {
        const skip = ctx.rng() < CPU_SKIP / skill;
        const err = (normal(ctx.rng) * CPU_SD * m) / skill;
        return skip ? null : b.arrive - FLIGHT + err;
      });
    });
    const tieBreaks = ctx.players.map(() => ctx.rng());
    const cosRng = mulberry32(Math.floor(ctx.rng() * 0x7fffffff));

    const automated = new Set(automatedSeatIds(ctx.players, isAutoplay()));
    const localIdx = localPlayerIndex(ctx.players);
    const localId = ctx.players[localIdx]?.id ?? 0;
    // Lanes: the local seat at the front, the rest behind in seat order.
    const order = [localIdx, ...ctx.players.map((_, i) => i).filter((i) => i !== localIdx)];

    const st: State = {
      ctx,
      root: new THREE.Group(),
      players: [],
      byId: new Map(),
      schedule,
      coins: [],
      particles: [],
      popups: [],
      rollers: [],
      youFrame: null,
      humanId: automated.has(localId) ? -1 : localId,
      pendingFire: 0,
      reload: 0,
      simT: 0,
      acc: 0,
      t: 0,
      endAt: -1,
      finished: false,
      camBase: [0, 12, 12],
      camLook: [0, 0, 0],
      cosRng,
      toons: new Map(),
      ink: null,
      shells: new Map(),
      geos: [],
      mats: [],
      texs: [],
      g: null as unknown as State["g"],
    };
    state = st;
    st.g = {
      sphere: geo(st, new THREE.SphereGeometry(1, 8, 6)),
      coin: geo(st, new THREE.CylinderGeometry(0.17, 0.17, 0.06, 16)),
      popup1: labelTexture(st, "+1", palette.mint, palette.white, 128, 64),
      popup2: labelTexture(st, "+2!", palette.sun, palette.candy, 160, 64),
    };

    order.forEach((idx, lane) => {
      const p = ctx.players[idx];
      const P: PlayerSt = {
        id: p.id,
        lane,
        name: p.name,
        color: hex(p.color),
        colorCss: p.color,
        ammo: COINS,
        score: 0,
        bulls: 0,
        tieBreak: tieBreaks[idx],
        cpu: automated.has(p.id),
        plan: plans[idx],
        nextPlan: 0,
        barrel: new THREE.Group(),
        recoil: 0,
        cheerT: 0,
        baskets: [],
        arrow: new THREE.Group(),
        arrowX: 0,
        arrowMat: new THREE.MeshBasicMaterial(),
        shadow: new THREE.Mesh(),
        shadowMat: new THREE.MeshBasicMaterial(),
      };
      st.players.push(P);
      st.byId.set(P.id, P);
    });

    buildBackdrop(st);
    buildLanes(st);
    ctx.scene.add(st.root);

    // Camera: all four belts, rings, cannons and name flags; on a wide
    // screen also the right end of the belts where baskets appear.
    frameMinigame(
      ctx.camera,
      () => {
        const { w, h } = viewportSize();
        const wide = w / h >= 1;
        return {
          box: frameBox([FLAG_X - 1.0, 0, -7.1], [wide ? 10.2 : 6.4, 3.0, 6.0]),
          // Steeper on a phone: the belts spread down the tall screen.
          dir: wide ? new THREE.Vector3(0, 1.15, 1) : new THREE.Vector3(0, 2.1, 1),
          fov: wide ? 45 : 50,
        };
      },
      (f) => {
        st.camBase = [f.pos.x, f.pos.y, f.pos.z];
        st.camLook = [f.look.x, f.look.y, f.look.z];
      },
    );

    // ---- HUD ----
    ctx.hud.unit("pts");
    for (const P of st.players) {
      ctx.hud.score(P.id, 0);
      hudAmmo(st, P);
    }
    ctx.hud.timer(TIME_CAP, TIME_CAP);

    // ---- input: any press or confirm fires now ----
    const fire = (): void => {
      if (st.finished || st.humanId < 0 || isPracticeBeat()) return;
      const H = st.byId.get(st.humanId);
      if (!H || H.ammo <= 0) return;
      st.pendingFire = Math.min(2, st.pendingFire + 1);
    };
    ctx.input.pointer = (_x: number, _y: number, down: boolean): void => {
      if (down) fire();
    };
    ctx.input.key = (action: string): void => {
      if (action === "confirm") fire();
    };
  },

  update(dt: number): void {
    const st = state;
    if (!st) return;
    st.t += dt;
    // The practice beat and the results only animate; the sim stands still.
    if (!st.finished && !isPracticeBeat()) {
      st.acc += dt;
      let n = 0;
      while (st.acc >= DT && n < MAX_STEPS && !st.finished) {
        st.acc -= DT;
        step(st);
        n += 1;
      }
      if (n >= MAX_STEPS) st.acc = Math.min(st.acc, DT);
      if (st.finished) st.acc = 0;
      else st.ctx.hud.timer(Math.max(0, TIME_CAP - st.simT), TIME_CAP);
    }
    render(st, dt);
  },

  teardown(): void {
    const st = state;
    if (!st) return;
    st.ctx.input.pointer = (): void => {};
    st.ctx.input.key = (): void => {};
    st.ctx.scene.remove(st.root);
    for (const p of st.popups) (p.sprite.material as THREE.Material).dispose();
    for (const g of st.geos) g.dispose();
    for (const m of st.mats) m.dispose();
    for (const t of st.texs) t.dispose();
    state = null;
  },
};

export function loadCoinCannon(): Promise<Minigame> {
  return Promise.resolve(coinCannon);
}

export default coinCannon;

// Self-register once the module is importable (registry dedupes by id).
void registerMinigame({ id: coinCannon.id, name: coinCannon.name });
