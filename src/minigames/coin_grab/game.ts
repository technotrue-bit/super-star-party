/**
 * COIN GRAB — collect arena minigame (MP7 Coin Block Blitz spirit).
 *
 * One shared circular park: gold coin piles rain down and four characters
 * dash around hoovering them up. Bumping into a rival at speed has a 25%
 * chance to KNOCK one coin out of their pocket — it flies out with a boing
 * and lands as a fresh pile anyone can grab (mischievous, comeback-friendly
 * theft). 30 seconds, most coins wins, ties go to the lower player id.
 *
 * Determinism: ALL gameplay — movement, steering, pickup tests, CPU
 * decisions/knocks, pile spawns, and therefore every ctx.rng() draw — runs
 * inside a fixed-step simulation (whole 1/60s steps). Character contact is
 * a Rapier step at that same rate when the WASM chunk has loaded; otherwise
 * the hand-rolled circles run. update(dt) only accumulates real dt. Seeded
 * runs replay identically regardless of frame timing.
 *
 * Time budget: the framework force-finishes at settings.minigameTimeLimit
 * (30s); this game calls finish() at TIME_CAP = 30 in the same step the
 * limit is reached, so it always ranks itself before the safety net.
 */
import * as THREE from "three";
import { contactCpuFrozen, isLocalPlayer, localPlayerIndex, stickGround, takeContactPlace, type Minigame, type MinigameContext } from "../framework";
import { ease } from "../../core/rng";
import { ui } from "../../ui/kit";
import { characterColor } from "../../characters/roster";
import { celGradient } from "../../characters/cel";
import { palette, hex } from "../../config/palette";
import { buildCoinField, ARENA_R, type FieldHandle } from "./field";
import { createBallArena, type BallArena, type XzBody } from "../../physics/contact";

/* --------------------- presentation rng (visual only) --------------- */

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------- tuning constants ------------------------- */

const CHAR_R = 0.55; // character collision radius
const HUMAN_SPEED = 5.0; // u/s top speed (CPU runs at 75-95% of this)
const ACCEL = 12; // u/s^2 — snappy but controllable
const FRICTION = 8; // u/s^2 drift decay with no input
const WALL_CLAMP = ARENA_R - CHAR_R - 0.08;
const SPAWN_RADIUS = 4.0; // quarter-point spawn ring (on the path ring)
const SPAWN_ANGLES = [Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (7 * Math.PI) / 4];

const PILE_LIFE = 9.0; // seconds a pile sits before sparkle-fading away
const PILE_FADE = 0.5; // fade-out length at the end of a pile's life
const MAX_PILES = 10; // concurrent rain piles cap
const SPAWN_MIN = 0.8; // seconds between rain drops (min)
const SPAWN_MAX = 1.4; // seconds between rain drops (max)
const PILE_MIN = 2; // coins per fresh pile (min)
const PILE_MAX = 4; // coins per fresh pile (max)
const CHAR_CLEAR = 1.8; // rain piles never land too close to a character
const CENTER_CLEAR = 1.0; // ...or inside the fountain
const PICKUP_R = 0.75; // pickup reach
const KNOCK_P = 0.25; // theft chance per real bump
const KNOCK_MIN_IMPULSE = 1.2; // a bump must hit this hard to roll theft
const KNOCK_SPEED = 4.2; // knocked coin launch speed
const KNOCK_VY = 4.0; // knocked coin upward launch
const COIN_GRAV = 9; // knocked coin flight gravity
const COIN_R = 0.17; // single coin sphere radius
const CPU_PILE_P = 0.7; // CPU chases the nearest pile 70% of the time
const TIME_CAP = 30; // round length (framework limit is exactly 30)
const BOING_GAP = 0.09; // sfx throttle between boings
const POP_GAP = 0.12; // sfx throttle between land pops
const POINTER_AUTO_RELEASE = 0.5; // held pointer with no events => release
const KEY_STALE = 0.35; // keyboard steer drops after this long without keys

/* --------------------- fixed-step simulation ---------------------- */
const FIXED_DT = 1 / 60; // simulation step (s)
const MAX_STEPS_PER_FRAME = 12; // maxDelta 1/20 × speed 4 = 0.2s. Dropping below that lets the 30s screen limit beat the sim.

/* ------------------------------ types ------------------------------- */

interface Body {
  id: number;
  holder: THREE.Group;
  x: number;
  z: number;
  vx: number;
  vz: number;
  coins: number;
  moving: boolean;
  animHoldT: number; // squash/jump hold — don't re-apply move anim during it
  brain: CpuBrain;
  sim?: XzBody;
}

interface CpuBrain {
  pickIn: number; // FIXED-STEP countdown (integer steps) until the next re-pick
  mode: "pile" | "wander";
  speedMul: number; // fraction of the human top speed
  wanderX: number; // wander target point
  wanderZ: number;
}

interface HumanInput {
  held: boolean;
  tx: number;
  ty: number;
  idleT: number;
  keyDir: { x: number; z: number } | null;
  keyIdleT: number;
  stickX: number; // analog stick, screen +x right, +y down
  stickY: number;
  lastHopT: number;
}

interface Pile {
  group: THREE.Group;
  x: number;
  z: number;
  coins: number;
  life: number; // counts down from PILE_LIFE
  phase: number; // visual pulse phase
  glints: { mesh: THREE.Mesh; speed: number; phase: number; radius: number; y: number }[];
}

interface Flyer {
  group: THREE.Group;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
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

interface RingPop {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  life: number;
  maxLife: number;
  flat: boolean; // true = flat expanding ring on the ground
  maxScale: number;
}

interface Chip {
  el: HTMLDivElement;
  num: HTMLSpanElement;
  last: number;
}

interface RadiusIndicator {
  group: THREE.Group;
  ring: THREE.Mesh;
  ringMat: THREE.MeshBasicMaterial;
  disc: THREE.Mesh;
  discMat: THREE.MeshBasicMaterial;
  glow: THREE.Mesh;
  glowMat: THREE.MeshBasicMaterial;
  chevrons: THREE.Mesh[];
  chevronMat: THREE.MeshBasicMaterial;
  flashT: number; // in-range flash timer (~0.18s)
  pulseT: number;
  wasInRange: boolean;
  baseOpacity: number;
  rimOpacity: number;
  prng: () => number; // presentation-only rng
}

/** Floating score sprites ("+N") that pop, float up, and fade. */
interface PlusOne {
  mesh: THREE.Sprite;
  mat: THREE.SpriteMaterial;
  life: number;
  maxLife: number;
  vy: number;
  popT: number; // spawn-pop animation timer (counts down from ~0.12s)
  baseScale: number; // resting world-space width of the sprite
}

interface RoundState {
  ctx: MinigameContext;
  field: FieldHandle | null;
  dyn: THREE.Group; // everything dynamic (piles, flyers, bursts) lives here
  geos: THREE.BufferGeometry[];
  mats: THREE.Material[];
  bodies: Body[];
  piles: Pile[];
  flyers: Flyer[];
  particles: Particle[];
  rings: RingPop[];
  spawnT: number;
  t: number; // fixed-step clock (stepIndex * FIXED_DT)
  ended: boolean;
  hurryAnnounced: boolean;
  boingT: number;
  popT: number;
  shakeT: number;
  shakeStrength: number; // amplitude multiplier for camera shake (decays to base)
  rotShake: number; // rotational shake amplitude (radians, decays)
  rotPhase: number; // phase seed for rotational shake
  hitStopSteps: number; // integer fixed-step countdown for visual hit-stop freeze
  human: HumanInput;
  camBase: THREE.Vector3;
  raycaster: THREE.Raycaster;
  plane: THREE.Plane;
  scratch: THREE.Vector3;
  onPointerUp: () => void;
  hudRoot: HTMLDivElement | null;
  timerEl: HTMLDivElement | null;
  timerLast: number;
  chips: Chip[];
  radiusIndicators: RadiusIndicator[];
  plusOnes: PlusOne[];
  prng: () => number; // presentation-only
  /* Fixed-step simulation: accumulator + integer step counter. All gameplay
     advances in whole 1/60s steps; stepIndex drives every decision so rng
     draw order is identical across runs regardless of frame timing. */
  simTime: number; // accumulated fixed-step time (s)
  stepIndex: number; // current simulation step
  physics: BallArena | null;
}

/* --------------------------- tiny helpers --------------------------- */

function toon(state: RoundState, color: string): THREE.MeshToonMaterial {
  const m = new THREE.MeshToonMaterial({ color: hex(color), gradientMap: celGradient });
  state.mats.push(m);
  return m;
}

function basic(state: RoundState, color: string, opacity = 1): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({
    color: hex(color),
    transparent: opacity < 1,
    opacity,
    depthWrite: opacity >= 1,
  });
  state.mats.push(m);
  return m;
}

function norm(x: number, z: number): { x: number; z: number } {
  const l = Math.hypot(x, z);
  if (l < 1e-6) return { x: 0, z: 0 };
  return { x: x / l, z: z / l };
}

/* --------------------------- HUD (DOM chips) ------------------------ */

let hudStylesInjected = false;

function injectHudStyles(): void {
  if (hudStylesInjected) return;
  hudStylesInjected = true;
  if (document.getElementById("ssp-coin-grab-styles")) return;
  const style = document.createElement("style");
  style.id = "ssp-coin-grab-styles";
  style.textContent = `
.cg-chip-pop { animation: cgChipPop .32s cubic-bezier(.34,1.56,.64,1); }
@keyframes cgChipPop { 0% { transform: scale(1); } 45% { transform: scale(1.28); } 100% { transform: scale(1); } }
.cg-timer--hot { color: ${palette.lava} !important; }
.cg-timer--hot .cg-clock { background: ${palette.lava} !important; }
.cg-clock { display:inline-block; width:10px; height:10px; border-radius:50%; background:${palette.sun}; margin-right:7px; vertical-align:1px; }
`;
  document.head.appendChild(style);
}

const CORNERS = [
  "top:10px;left:10px",
  "top:10px;right:10px",
  "bottom:10px;left:10px",
  "bottom:10px;right:10px",
];

function buildHud(state: RoundState): void {
  injectHudStyles();
  const root = document.createElement("div");
  root.id = "ssp-coin-grab-hud";
  root.style.cssText =
    "position:fixed;inset:0;pointer-events:none;z-index:60;font-family:Fredoka,sans-serif;";
  state.chips = state.ctx.players.map((p, i) => {
    const el = document.createElement("div");
    el.style.cssText =
      `position:absolute;${CORNERS[i] ?? CORNERS[0]};display:flex;align-items:center;gap:7px;` +
      `background:${palette.cream};border:3px solid ${palette.ink};border-radius:999px;` +
      `padding:5px 14px;box-shadow:0 3px 0 ${palette.ink};font-weight:700;font-size:19px;color:${palette.ink};`;
    const dot = document.createElement("span");
    dot.style.cssText =
      `width:14px;height:14px;border-radius:50%;background:${characterColor(p.kind)};` +
      `border:2px solid ${palette.ink};display:inline-block;`;
    const num = document.createElement("span");
    num.textContent = "0";
    num.style.cssText = "min-width:20px;text-align:center;display:inline-block;";
    el.append(dot, num);
    root.appendChild(el);
    return { el, num, last: 0 };
  });
  const timer = document.createElement("div");
  timer.style.cssText =
    `position:absolute;top:12px;left:50%;transform:translateX(-50%);` +
    `background:${palette.ink};color:${palette.cream};border-radius:999px;padding:6px 18px;` +
    `font-weight:700;font-size:18px;letter-spacing:1px;display:flex;align-items:center;`;
  const clock = document.createElement("span");
  clock.className = "cg-clock";
  timer.appendChild(clock);
  timer.appendChild(document.createTextNode("30"));
  root.appendChild(timer);
  document.body.appendChild(root);
  state.hudRoot = root;
  state.timerEl = timer;
  state.timerLast = -1;
}

function popChip(chip: Chip): void {
  chip.el.classList.remove("cg-chip-pop");
  void chip.el.offsetWidth;
  chip.el.classList.add("cg-chip-pop");
}

function updateHud(state: RoundState): void {
  for (let i = 0; i < state.bodies.length; i++) {
    const chip = state.chips[i];
    if (!chip) continue;
    const v = state.bodies[i].coins;
    if (v !== chip.last) {
      chip.last = v;
      chip.num.textContent = String(v);
      popChip(chip);
    }
  }
  const left = Math.max(0, Math.ceil(TIME_CAP - state.t));
  if (left !== state.timerLast && state.timerEl) {
    state.timerLast = left;
    state.timerEl.lastChild!.textContent = String(left);
    state.timerEl.classList.toggle("cg-timer--hot", left <= 5);
  }
}

/* ------------------------- radius indicators ----------------------- */

function createRadiusIndicator(
  state: RoundState,
  color: string,
  x: number,
  z: number,
  prng: () => number
): RadiusIndicator {
  const group = new THREE.Group();
  group.position.set(x, 0, z);

  // Inner dim fill — very subtle so the ring shape doesn't compete
  const discGeo = new THREE.CircleGeometry(PICKUP_R, 32);
  state.geos.push(discGeo);
  const discMat = basic(state, color, 0.10);
  const disc = new THREE.Mesh(discGeo, discMat);
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = 0.042;
  disc.castShadow = false;
  disc.receiveShadow = false;
  group.add(disc);

  // Bright thin rim — the primary player-owned shape language
  const rimW = 0.045;
  const ringGeo = new THREE.RingGeometry(PICKUP_R - rimW, PICKUP_R, 48);
  state.geos.push(ringGeo);
  const ringMat = basic(state, color, 1.0);
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.05;
  ring.castShadow = false;
  ring.receiveShadow = false;
  group.add(ring);

  // Chevron tick marks at 4 compass points — instant "this ring is PLAYER-owned"
  const chevrons: THREE.Mesh[] = [];
  const chevronMat = basic(state, color, 1.0);
  const chevGeo = new THREE.ConeGeometry(0.09, 0.22, 3);
  state.geos.push(chevGeo);
  for (let k = 0; k < 4; k++) {
    const a = k * Math.PI / 2 + Math.PI / 4;
    const chev = new THREE.Mesh(chevGeo, chevronMat);
    chev.position.set(
      Math.cos(a) * (PICKUP_R + 0.12),
      0.05,
      Math.sin(a) * (PICKUP_R + 0.12)
    );
    chev.rotation.x = Math.PI / 2; // point outward
    chev.rotation.z = -a;
    chev.castShadow = false;
    chev.receiveShadow = false;
    group.add(chev);
    chevrons.push(chev);
  }

  state.dyn.add(group);
  group.userData.baseColor = color;

  return {
    group,
    ring,
    ringMat,
    disc,
    discMat,
    glow: ring,
    glowMat: ringMat,
    chevrons,
    chevronMat,
    flashT: 0,
    pulseT: 0,
    wasInRange: false,
    baseOpacity: 0.10,
    rimOpacity: 1.0,
    prng,
  };
}

/* ------------------------- "+N" pickup sprites ----------------------- */

const PLUSONE_MAX_LIFE = 0.9;
const PLUSONE_RISE = 1.1; // world units risen over lifetime
const PLUSONE_BASE_SCALE = 2.4; // world units wide (~50px at 390px portrait)
const PLUSONE_POP_TIME = 0.12; // spawn-pop duration (s)
const PLUSONE_RENDER_ORDER = 999;

function spawnPlusOne(state: RoundState, x: number, z: number, amount: number, prng: () => number): void {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 192;
  const g = canvas.getContext("2d")!;
  const text = `+${amount}`;

  // Dark backing plate (rounded rect) so the glyph separates from the floor
  const padX = 20;
  const padY = 12;
  const plateW = 256 - padX * 2;
  const plateH = 192 - padY * 2;
  const radius = 28;
  g.beginPath();
  g.moveTo(padX + radius, padY);
  g.arcTo(padX + plateW, padY, padX + plateW, padY + plateH, radius);
  g.arcTo(padX + plateW, padY + plateH, padX, padY + plateH, radius);
  g.arcTo(padX, padY + plateH, padX, padY, radius);
  g.arcTo(padX, padY, padX + plateW, padY, radius);
  g.closePath();
  g.fillStyle = palette.ink;
  g.fill();
  g.lineWidth = 6;
  g.strokeStyle = palette.white;
  g.stroke();

  // Glyph
  g.font = "bold 80px Fredoka, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.lineWidth = 10;
  g.strokeStyle = palette.ink;
  g.strokeText(text, 128, 100);
  g.fillStyle = palette.sun;
  g.fillText(text, 128, 100);

  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 4;
  const mat = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.renderOrder = PLUSONE_RENDER_ORDER;
  const jitter = (prng() - 0.5) * 0.25;
  sprite.position.set(x + jitter, 0.9, z);
  // Pop animation: start small, overshoot, settle
  sprite.scale.set(PLUSONE_BASE_SCALE * 0.6, PLUSONE_BASE_SCALE * 0.6 * (192 / 256), 1);
  sprite.castShadow = false;
  state.dyn.add(sprite);
  state.plusOnes.push({
    mesh: sprite,
    mat,
    life: PLUSONE_MAX_LIFE,
    maxLife: PLUSONE_MAX_LIFE,
    vy: PLUSONE_RISE / PLUSONE_MAX_LIFE,
    popT: PLUSONE_POP_TIME,
    baseScale: PLUSONE_BASE_SCALE,
  });
}

function updatePlusOnes(state: RoundState, dt: number): void {
  for (let i = state.plusOnes.length - 1; i >= 0; i--) {
    const p = state.plusOnes[i];
    p.life -= dt;
    if (p.life <= 0) {
      state.dyn.remove(p.mesh);
      p.mat.map?.dispose();
      p.mat.dispose();
      state.plusOnes.splice(i, 1);
      continue;
    }
    // Rise
    p.mesh.position.y += p.vy * dt;
    // Spawn pop: 0.6 -> 1.1 -> 1.0 scale factor over popT
    const aspect = 192 / 256;
    if (p.popT > 0) {
      p.popT = Math.max(0, p.popT - dt);
      const k = 1 - p.popT / PLUSONE_POP_TIME; // 0 -> 1
      // Ease-out back: 0.6 -> 1.1 -> 1.0
      let s: number;
      if (k < 0.5) {
        // 0.6 -> 1.1
        const k2 = k / 0.5;
        s = 0.6 + 0.5 * k2;
      } else {
        // 1.1 -> 1.0
        const k2 = (k - 0.5) / 0.5;
        s = 1.1 - 0.1 * k2;
      }
      p.mesh.scale.set(p.baseScale * s, p.baseScale * s * aspect, 1);
    } else {
      p.mesh.scale.set(p.baseScale, p.baseScale * aspect, 1);
    }
    // Fade out in last 30% of life
    const k = p.life / p.maxLife;
    p.mat.opacity = k < 0.3 ? k / 0.3 : 1;
  }
}

/* ----------------------- radius indicators ------------------------- */

function updateRadiusIndicators(state: RoundState, dt: number): void {
  for (let i = 0; i < state.bodies.length; i++) {
    const b = state.bodies[i];
    const ind = state.radiusIndicators[i];
    if (!ind) continue;

    ind.group.position.x = b.x;
    ind.group.position.z = b.z;

    let inRange = false;
    let nearestPile: Pile | null = null;
    let nearestD = Infinity;
    for (const p of state.piles) {
      const d = Math.hypot(b.x - p.x, b.z - p.z);
      if (d <= PICKUP_R && d < nearestD) {
        inRange = true;
        nearestD = d;
        nearestPile = p;
      }
    }

    // IN-RANGE MOMENT: flash rim to white-gold, scale pulse, ring pop at pile
    if (inRange && !ind.wasInRange) {
      ind.flashT = 0.18;
      if (nearestPile) {
        spawnRingPop(state, nearestPile.x, nearestPile.z, true, 2.0);
      }
    }
    ind.wasInRange = inRange;

    ind.flashT = Math.max(0, ind.flashT - dt);
    ind.pulseT = Math.max(0, ind.pulseT - dt);
    const flashK = ind.flashT > 0 ? ind.flashT / 0.18 : 0;
    const pulseK = ind.pulseT > 0 ? ind.pulseT / 0.35 : 0;

    // Flash: rim → white-gold, scale 1.0→1.12→1.0
    const flashScale = 1 + flashK * 0.12;
    ind.ring.scale.setScalar(flashScale);
    ind.discMat.opacity = ind.baseOpacity + flashK * 0.15;

    // White-gold flash color on rim
    if (flashK > 0) {
      ind.ringMat.color.lerpColors(new THREE.Color(palette.sun), new THREE.Color(palette.white), 0.5);
      ind.chevronMat.color.lerpColors(new THREE.Color(palette.sun), new THREE.Color(palette.white), 0.5);
    } else {
      ind.ringMat.color.setHex(hex(ind.group.userData.baseColor));
      ind.chevronMat.color.setHex(hex(ind.group.userData.baseColor));
    }

    // Chevron flash brightness
    ind.chevronMat.opacity = 0.85 + flashK * 0.15;

    // Disc fill subtle pulse
    ind.discMat.opacity = Math.max(ind.discMat.opacity, ind.baseOpacity + pulseK * 0.08);
  }
}

/* ----------------------------- particles ---------------------------- */

function spawnBurst(
  state: RoundState,
  x: number,
  y: number,
  z: number,
  colors: string[],
  count: number,
  speed: number,
  life: number,
  grav: number,
  base = 0.07,
  rng: (() => number) | null = null
): void {
  const ctx = state.ctx;
  const draw = rng ?? ctx.rng;
  const geo = new THREE.SphereGeometry(1, 8, 6);
  state.geos.push(geo);
  for (let i = 0; i < count; i++) {
    const mat = basic(state, colors[Math.floor(draw() * colors.length)]);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.scale.setScalar(base);
    mesh.castShadow = false;
    state.dyn.add(mesh);
    const th = draw() * Math.PI * 2;
    const ph = draw() * Math.PI - Math.PI / 2;
    const sp = speed * (0.5 + draw() * 0.8);
    state.particles.push({
      mesh,
      vx: Math.cos(th) * Math.cos(ph) * sp,
      vy: Math.sin(ph) * sp + 1.6,
      vz: Math.sin(th) * Math.cos(ph) * sp,
      life,
      maxLife: life,
      grav,
      base: base * (0.7 + draw() * 0.6),
    });
  }
}

function spawnRingPop(
  state: RoundState,
  x: number,
  z: number,
  flat = true,
  maxScale = 3.2
): void {
  const mat = basic(state, palette.sun, 1.0);
  const mesh = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.06, 8, 32), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(x, 0.06, z);
  mesh.scale.setScalar(0.3);
  mesh.castShadow = false;
  state.dyn.add(mesh);
  state.rings.push({ mesh, mat, life: 0.25, maxLife: 0.25, flat, maxScale });
}

function updateParticles(state: RoundState, dt: number): void {
  for (let i = state.particles.length - 1; i >= 0; i--) {
    const p = state.particles[i];
    p.life -= dt;
    if (p.life <= 0) {
      state.dyn.remove(p.mesh);
      state.particles.splice(i, 1);
      continue;
    }
    p.vy -= p.grav * dt;
    p.mesh.position.x += p.vx * dt;
    p.mesh.position.y += p.vy * dt;
    p.mesh.position.z += p.vz * dt;
    p.mesh.scale.setScalar(p.base * Math.max(0, p.life / p.maxLife));
  }
  for (let i = state.rings.length - 1; i >= 0; i--) {
    const r = state.rings[i];
    r.life -= dt;
    if (r.life <= 0) {
      state.dyn.remove(r.mesh);
      state.rings.splice(i, 1);
      continue;
    }
    const k = 1 - r.life / r.maxLife;
    const s = r.flat ? (0.3 + ease.outCubic(k) * r.maxScale) : r.maxScale;
    r.mesh.scale.setScalar(s);
    r.mat.opacity = 1.0 * (1 - k);
  }
}

/* ------------------------------ coin piles -------------------------- */

function buildPile(state: RoundState, x: number, z: number, coins: number, life: number): Pile {
  const ctx = state.ctx;
  const group = new THREE.Group();
  group.position.set(x, 0, z);

  // No ring — the pile reads as a coin cluster, not a circle.
  const coinGeo = new THREE.SphereGeometry(1, 12, 10);
  state.geos.push(coinGeo);
  const coinMat = toon(state, palette.sun);
  for (let i = 0; i < coins; i++) {
    const m = new THREE.Mesh(coinGeo, coinMat);
    m.position.set((ctx.rng() - 0.5) * 0.16, 0.17 + i * 0.15, (ctx.rng() - 0.5) * 0.16);
    m.scale.setScalar(COIN_R);
    m.castShadow = false;
    group.add(m);
  }

  const glintGeo = new THREE.SphereGeometry(1, 8, 6);
  state.geos.push(glintGeo);
  const glintMat = basic(state, palette.sun);
  const glints: Pile["glints"] = [];
  for (let i = 0; i < 2; i++) {
    const g = new THREE.Mesh(glintGeo, glintMat);
    g.scale.setScalar(0.05);
    g.castShadow = false;
    group.add(g);
    glints.push({
      mesh: g,
      speed: (2.2 + ctx.rng() * 1.6) * (i % 2 === 0 ? 1 : -1),
      phase: ctx.rng() * Math.PI * 2,
      radius: 0.52 + ctx.rng() * 0.18,
      y: 0.34 + ctx.rng() * 0.3,
    });
  }

  state.dyn.add(group);
  const pile: Pile = { group, x, z, coins, life, phase: ctx.rng() * Math.PI * 2, glints };
  state.piles.push(pile);
  return pile;
}

function removePileVisual(state: RoundState, pile: Pile): void {
  state.dyn.remove(pile.group);
}

/** Fade/expire piles + glint animation — fixed-step, pure dt math, no rng. */
function updatePiles(state: RoundState, dt: number): void {
  const t = state.t;
  for (let i = state.piles.length - 1; i >= 0; i--) {
    const p = state.piles[i];
    p.life -= dt;
    if (p.life <= 0) {
      // Expire burst is presentation rng only — zero gameplay draws.
      spawnBurst(state, p.x, 0.35, p.z, [palette.sun, palette.sunDeep, palette.cream], 7, 2.4, 0.45, 5, 0.06, state.prng);
      removePileVisual(state, p);
      state.piles.splice(i, 1);
      continue;
    }
    if (p.life < PILE_FADE) {
      const s = Math.max(0.01, p.life / PILE_FADE);
      p.group.scale.setScalar(s);
    }
    for (const gl of p.glints) {
      const a = t * gl.speed + gl.phase;
      gl.mesh.position.set(Math.cos(a) * gl.radius, gl.y + 0.08 * Math.sin(t * 3.2 + gl.phase), Math.sin(a) * gl.radius);
    }
  }
}

/** Spawn a rain pile — runs INSIDE fixed steps only; every ctx.rng draw
 *  (coin count, position search, then buildPile's coin cluster + glint
 *  layout) is gated on the integer step index. */
function spawnPile(state: RoundState): void {
  const ctx = state.ctx;
  const coins = PILE_MIN + Math.floor(ctx.rng() * (PILE_MAX - PILE_MIN + 1));
  let x = 0;
  let z = 0;
  let ok = false;
  for (let i = 0; i < 10; i++) {
    const a = ctx.rng() * Math.PI * 2;
    const r = CENTER_CLEAR + 0.2 + ctx.rng() * (WALL_CLAMP - CENTER_CLEAR - 0.2);
    x = Math.cos(a) * r;
    z = Math.sin(a) * r;
    if (Math.hypot(x, z) < CENTER_CLEAR) continue;
    ok = true;
    for (const b of state.bodies) {
      if (Math.hypot(b.x - x, b.z - z) < CHAR_CLEAR) {
        ok = false;
        break;
      }
    }
    if (ok) break;
  }
  if (!ok) {
    // Fallback (no extra draws): clamp the last candidate into the play ring.
    const d = Math.max(CENTER_CLEAR + 0.15, Math.min(WALL_CLAMP, Math.hypot(x, z)));
    const a = Math.atan2(z, x);
    x = Math.cos(a) * d;
    z = Math.sin(a) * d;
  }
  buildPile(state, x, z, coins, PILE_LIFE);
}

/* ------------------------------ flyers ------------------------------ */

/** Knocked-coin flight — fixed-step, pure physics, no rng. */
function updateFlyers(state: RoundState, dt: number): void {
  for (let i = state.flyers.length - 1; i >= 0; i--) {
    const f = state.flyers[i];
    f.vy -= COIN_GRAV * dt;
    f.x += f.vx * dt;
    f.y += f.vy * dt;
    f.z += f.vz * dt;
    f.group.position.set(f.x, f.y, f.z);
    f.group.rotation.y += dt * 9;
    if (f.y <= COIN_R + 0.02) {
      // Land: clamp into the play ring, drop a fresh 1-coin pile. Runs in a
      // fixed step, so buildPile's layout draws land in deterministic order.
      const d = Math.max(CENTER_CLEAR + 0.15, Math.min(WALL_CLAMP, Math.hypot(f.x, f.z)));
      const a = Math.atan2(f.z, f.x);
      const lx = Math.cos(a) * d;
      const lz = Math.sin(a) * d;
      state.dyn.remove(f.group);
      state.flyers.splice(i, 1);
      buildPile(state, lx, lz, 1, PILE_LIFE);
      // Land burst is presentation rng only — zero gameplay draws.
      spawnBurst(state, lx, 0.3, lz, [palette.sunDeep, palette.cream], 5, 2.0, 0.4, 5, 0.05, state.prng);
      if (state.popT <= 0) {
        state.popT = POP_GAP;
        state.ctx.playSfx("pop", { volume: 0.5, pitch: 1.1 });
      }
    }
  }
}

/* ------------------------------ gameplay ---------------------------- */

/** Collect a pile — runs INSIDE fixed steps only. The grab burst + "+1"
 *  pop use presentation rng (zero ctx.rng draws), so no compensating dummy
 *  draws are needed: gameplay rng is consumed ONLY by genuine gameplay events
 *  (pile spawn, knock, CPU choice). */
function collectPile(state: RoundState, b: Body, pile: Pile): void {
  const ctx = state.ctx;
  b.coins += pile.coins;
  ctx.playSfx("coin.gain", { volume: 0.8, pitch: 0.85 + pile.coins * 0.17 });
  // GRAB MOMENT: tight burst of larger gold shards + "+1" pop.
  // Presentation rng only — the gameplay sequence is untouched.
  spawnBurst(
    state,
    pile.x,
    0.5,
    pile.z,
    [palette.sun, palette.sunDeep, palette.cream],
    6 + pile.coins,
    2.8,
    0.4,
    5,
    0.14,
    state.prng
  );
  spawnPlusOne(state, pile.x, pile.z, pile.coins, state.prng);

  // ----- IMPACT: amount-scaled shake + hit-stop + character squash -----
  // Magnitude: 1 coin = ~0.06 units, each coin adds ~0.022, capped at 0.18.
  const k = pile.coins;
  const amp = Math.min(0.18, 0.06 + k * 0.022);
  state.shakeT = Math.min(0.22, 0.13 + k * 0.018); // time window grows w/ coins
  state.shakeStrength = amp;
  state.rotShake = Math.min(0.06, amp * 0.32); // small rotational bite
  state.rotPhase = state.stepIndex * 1.7 + k * 0.9; // per-event unique phase
  // Hit-stop ONLY on multi-coin piles (>=3 coins): ~60-90ms as integer steps.
  // 60ms = 3.6 steps → 4 steps; 90ms = 5.4 steps → 5 steps. Scale with coins.
  if (k >= 3) {
    state.hitStopSteps = Math.min(5, 3 + (k - 3)); // 3 coins=3 steps (~50ms), 4=4 (~67ms), 5=5 (~83ms)
  } else {
    state.hitStopSteps = 0;
  }

  const ch = ctx.characters[b.id];
  // Existing squash already animates a firm squash-stretch; the new camera
  // shake + hit-stop layers physical weight on top so the moment lands.
  ch?.anim.squash();
  b.animHoldT = Math.max(b.animHoldT, 0.2);
  removePileVisual(state, pile);
}

/** Steal a coin — fixed-step; its 4 ctx.rng draws (side, angle lean,
 *  speed, vy) are gated on the step index. */
function knockCoin(state: RoundState, victim: Body, bumper: Body): void {
  const ctx = state.ctx;
  victim.coins -= 1;
  const dx = victim.x - bumper.x;
  const dz = victim.z - bumper.z;
  const side = ctx.rng() < 0.5 ? -1 : 1;
  // Launch away from the bumper with a lateral lean so thefts scatter.
  const ang = Math.atan2(dz, dx) + side * (0.25 + ctx.rng() * 0.35);
  const sp = KNOCK_SPEED * (0.85 + ctx.rng() * 0.35);
  const group = new THREE.Group();
  const geo = new THREE.SphereGeometry(1, 10, 8);
  state.geos.push(geo);
  const mesh = new THREE.Mesh(geo, toon(state, palette.sun));
  mesh.scale.setScalar(COIN_R);
  mesh.position.set(victim.x, 0.6, victim.z);
  mesh.castShadow = false;
  group.add(mesh);
  state.dyn.add(group);
  state.flyers.push({
    group,
    x: victim.x,
    y: 0.6,
    z: victim.z,
    vx: Math.cos(ang) * sp,
    vy: KNOCK_VY * (0.85 + ctx.rng() * 0.35),
    vz: Math.sin(ang) * sp,
  });
  state.shakeT = Math.min(0.16, state.shakeT + 0.1);
  ctx.playSfx("boing", { volume: 0.7, pitch: 0.8 });
  ctx.playSfx("coin.lose", { volume: 0.35, pitch: 0.75 });
  ctx.characters[victim.id]?.anim.squash();
  victim.animHoldT = Math.max(victim.animHoldT, 0.2);
}

function bumpJuice(state: RoundState, b: Body): void {
  b.animHoldT = Math.max(b.animHoldT, 0.14);
  state.ctx.characters[b.id]?.anim.squash();
  if (state.boingT <= 0) {
    state.boingT = BOING_GAP;
    state.ctx.playSfx("boing", { volume: 0.6, pitch: 0.9 + (b.id % 4) * 0.07 });
  }
}

function applyMoveAnim(state: RoundState, b: Body): void {
  if (b.animHoldT > 0) return;
  const sp = Math.hypot(b.vx, b.vz);
  const moving = sp > 0.35;
  const ch = state.ctx.characters[b.id];
  if (moving !== b.moving) {
    b.moving = moving;
    if (moving) {
      ch?.anim.walk();
      ch?.setFacing(Math.atan2(b.vx, b.vz));
    } else {
      ch?.anim.idle();
    }
  } else if (moving) {
    ch?.setFacing(Math.atan2(b.vx, b.vz));
  }
}

/** Probe park. No-op unless a probe set `__SSP_CONTACT__.placeLocal`. */
function parkLocalSeat(state: RoundState): void {
  const spot = takeContactPlace();
  if (!spot) return;
  state.human.held = false;
  state.human.keyDir = null;
  state.human.stickX = 0;
  state.human.stickY = 0;
  for (const b of state.bodies) {
    if (!isLocalPlayer(state.ctx.players, b.id)) continue;
    b.x = spot.x;
    b.z = spot.z;
    b.vx = 0;
    b.vz = 0;
    b.sim?.place(spot.x, spot.z);
    b.holder.position.x = spot.x;
    b.holder.position.z = spot.z;
  }
}

function pointerDir(state: RoundState, b: Body): { x: number; z: number } | null {
  const cam = state.ctx.camera;
  state.raycaster.setFromCamera(
    new THREE.Vector2(state.human.tx * 2 - 1, -(state.human.ty * 2 - 1)),
    cam
  );
  const hit = state.raycaster.ray.intersectPlane(state.plane, state.scratch);
  if (!hit) return null;
  const dx = hit.x - b.x;
  const dz = hit.z - b.z;
  const l = Math.hypot(dx, dz);
  if (l < 0.35) return null; // arrived — drift
  return { x: dx / l, z: dz / l };
}

/* ------------------------------ CPU brain --------------------------- */

/** Fresh brain — repicks on the first fixed step of play. */
function freshBrain(): CpuBrain {
  return { pickIn: 0, mode: "pile", speedMul: 0.85, wanderX: 0, wanderZ: 0 };
}

/**
 * Full re-pick — runs INSIDE fixed steps only; its 5 ctx.rng draws (mode,
 * speed, timer, wander angle, wander radius) are gated on the step index.
 * The timer is stored in WHOLE FIXED STEPS (integer), so the re-pick fires
 * at a deterministic step index regardless of frame timing.
 */
function repick(brain: CpuBrain, state: RoundState): void {
  const ctx = state.ctx;
  brain.mode = ctx.rng() < CPU_PILE_P ? "pile" : "wander";
  brain.speedMul = 0.75 + ctx.rng() * 0.2;
  brain.pickIn = Math.round((0.5 + ctx.rng() * 0.5) * 60);
  const a = ctx.rng() * Math.PI * 2;
  const r = 1.0 + ctx.rng() * (WALL_CLAMP - 1.0);
  brain.wanderX = Math.cos(a) * r;
  brain.wanderZ = Math.sin(a) * r;
}

/** Per-step steering — pure math over live positions, no rng. */
function cpuDir(state: RoundState, b: Body): { x: number; z: number } | null {
  const brain = b.brain;
  if (brain.mode === "pile") {
    let best: Pile | null = null;
    let bestD = Infinity;
    for (const p of state.piles) {
      const dd = (p.x - b.x) * (p.x - b.x) + (p.z - b.z) * (p.z - b.z);
      if (dd < bestD) {
        bestD = dd;
        best = p;
      }
    }
    if (best) return norm(best.x - b.x, best.z - b.z);
  }
  const dx = brain.wanderX - b.x;
  const dz = brain.wanderZ - b.z;
  const l = Math.hypot(dx, dz);
  if (l < 0.4) return { x: 0, z: 0 }; // arrived — drift until re-pick
  return { x: dx / l, z: dz / l };
}

/* ------------------------------- round ------------------------------ */

function endGame(state: RoundState): void {
  state.ended = true;
  publishDebug(state);
  const ctx = state.ctx;
  const ranking = [...state.bodies]
    .sort((a, b) => b.coins - a.coins || a.id - b.id)
    .map((b) => b.id);
  ctx.finish(ranking);
  const winner = state.bodies.find((b) => b.id === ranking[0]);
  const p = ctx.players[winner?.id ?? ranking[0]];
  ctx.characters[ranking[0]]?.anim.cheer();
  ctx.playSfx("crowd.cheer", { volume: 0.85 });
  ui.confettiBurst(undefined, undefined, { count: 90, sound: null });
  ctx.announce(`${p?.name ?? "?"} GRABS THE MOST COINS!`, { durationMs: 2400, sound: null });
}

function updateCamera(state: RoundState, dt: number): void {
  const cam = state.ctx.camera;
  if (state.shakeT > 0) {
    state.shakeT -= dt;
    const s = Math.max(0, state.shakeT);
    // Decay curve: shakeStrength * (remaining time / base time)^1.5
    const decay = Math.pow(s / 0.13, 1.5);
    const amp = state.shakeStrength * decay;
    // High-frequency positional shake along per-event unique axes
    const px = Math.sin(state.t * 83.7 + state.rotPhase) * amp;
    const py = Math.cos(state.t * 61.3 + state.rotPhase) * amp;
    cam.position.x = state.camBase.x + px;
    cam.position.y = state.camBase.y + py;
    cam.position.z = state.camBase.z;
    // Rotational bite: tiny z-axis roll for "thud" feel
    cam.rotation.z = state.rotShake * decay * Math.sin(state.t * 47.1 + state.rotPhase);
  } else {
    cam.position.copy(state.camBase);
    cam.rotation.z = 0;
  }
  cam.lookAt(0, 0, 0);
}

/* ----------------------- critic telemetry mirror --------------------- */

interface SeatDebug {
  id: number;
  controller: string;
  body: { x: number; y: number; z: number };
  model: { x: number; y: number; z: number };
  alive: boolean;
  screen: { x: number; y: number };
}

interface CGDebug {
  stepIndex: number;
  t: number;
  chips: number[];
  ranking: number[] | null;
  shakeT: number;
  shakeStrength: number;
  hitStopSteps: number;
  seats: SeatDebug[];
}

const seatScratch = new THREE.Vector3();
function seatDebug(state: RoundState): SeatDebug[] {
  const cam = state.ctx.camera;
  cam.updateMatrixWorld();
  const w = window.innerWidth || 1;
  const h = window.innerHeight || 1;
  return state.bodies.map((b) => {
    const ch = state.ctx.characters[b.id];
    if (ch) ch.group.getWorldPosition(seatScratch);
    else seatScratch.set(b.x, 0, b.z);
    const model = {
      x: +seatScratch.x.toFixed(4),
      y: +seatScratch.y.toFixed(4),
      z: +seatScratch.z.toFixed(4),
    };
    seatScratch.project(cam);
    const player = state.ctx.players.find((p) => p.id === b.id);
    return {
      id: b.id,
      controller: player?.controller ?? "cpu",
      body: { x: +b.x.toFixed(4), y: 0, z: +b.z.toFixed(4) },
      model,
      alive: true,
      screen: {
        x: +((seatScratch.x * 0.5 + 0.5) * w).toFixed(2),
        y: +((-seatScratch.y * 0.5 + 0.5) * h).toFixed(2),
      },
    };
  });
}

function cgDebug(): CGDebug {
  const w = window as unknown as { __CG__?: CGDebug };
  if (!w.__CG__) {
    w.__CG__ = { stepIndex: 0, t: 0, chips: [0, 0, 0, 0], ranking: null, shakeT: 0, shakeStrength: 0, hitStopSteps: 0, seats: [] };
  }
  return w.__CG__;
}

function publishDebug(state: RoundState): void {
  const d = cgDebug();
  d.stepIndex = state.stepIndex;
  d.t = +state.t.toFixed(4);
  d.chips = state.bodies.map((b) => b.coins);
  d.shakeT = +state.shakeT.toFixed(4);
  d.shakeStrength = +state.shakeStrength.toFixed(4);
  d.hitStopSteps = state.hitStopSteps;
  d.seats = seatDebug(state);
  if (state.ended && !d.ranking) {
    const ranking = [...state.bodies]
      .sort((a, b) => b.coins - a.coins || a.id - b.id)
      .map((b) => b.id);
    d.ranking = ranking;
  }
}

/* --------------------------- minigame object ------------------------ */

export const coinGrabMinigame: Minigame = {
  id: "coin_grab",
  name: "Coin Grab",
  genre: "collect",
  howTo: "Hold and drag to chase the coins, and tap to hop. Whoever has the most when time runs out wins.",

  setup(ctx: MinigameContext): void {
    const cam = ctx.camera;
    const portrait = window.innerWidth / window.innerHeight < 1;
    cam.fov = portrait ? 72 : 62;
    cam.updateProjectionMatrix();
    const camBase = new THREE.Vector3(0, portrait ? 17.6 : 11, portrait ? 10.3 : 9);

    const state: RoundState = {
      ctx,
      field: null,
      dyn: new THREE.Group(),
      geos: [],
      mats: [],
      bodies: [],
      piles: [],
      flyers: [],
      particles: [],
      rings: [],
      spawnT: 0.6,
      t: 0,
      ended: false,
      hurryAnnounced: false,
      boingT: 0,
      popT: 0,
      shakeT: 0,
      shakeStrength: 0,
      rotShake: 0,
      rotPhase: 0,
      hitStopSteps: 0,
      human: { held: false, tx: 0.5, ty: 0.5, idleT: 0, keyDir: null, keyIdleT: 0, stickX: 0, stickY: 0, lastHopT: -10 },
      camBase,
      raycaster: new THREE.Raycaster(),
      plane: new THREE.Plane(new THREE.Vector3(0, 1, 0), 0),
      scratch: new THREE.Vector3(),
      onPointerUp: () => {
        state.human.held = false;
      },
      hudRoot: null,
      timerEl: null,
      timerLast: -1,
      chips: [],
      radiusIndicators: [],
      plusOnes: [],
      prng: mulberry32(12345),
      simTime: 0,
      stepIndex: 0,
      physics: null,
    };
    ctx.scene.add(state.dyn);

    // ---- characters at the four quarter points (with a touch of jitter) ----
    ctx.players.forEach((p, i) => {
      const a = SPAWN_ANGLES[i] ?? 0;
      const x = Math.cos(a) * SPAWN_RADIUS + (ctx.rng() - 0.5) * 0.5;
      const z = Math.sin(a) * SPAWN_RADIUS + (ctx.rng() - 0.5) * 0.5;

      const holder = new THREE.Group();
      holder.position.set(x, 0, z);
      ctx.scene.add(holder);

      const ch = ctx.characters[i];
      if (ch) {
        ctx.scene.remove(ch.group); // reparent under the holder
        holder.add(ch.group);
        // The lineup parks every avatar at (x, 0, 5.4). That offset would
        // draw the model away from this body, so clear it and keep y.
        ch.group.position.x = 0;
        ch.group.position.z = 0;
        ch.setFacing(Math.atan2(-x, -z)); // face the fountain
        ch.anim.idle();
      }

      state.bodies.push({
        id: p.id,
        holder,
        x,
        z,
        vx: 0,
        vz: 0,
        coins: 0,
        moving: false,
        animHoldT: 0,
        brain: freshBrain(),
      });

      // Create pickup radius indicator for this player
      const indicatorColor = characterColor(p.kind);
      const prng = mulberry32(1000 + i * 777);
      state.radiusIndicators.push(
        createRadiusIndicator(state, indicatorColor, x, z, prng)
      );
    });

    state.physics = createBallArena({
      wallInner: WALL_CLAMP + CHAR_R,
      ballRestitution: 0.8,
      wallRestitution: 0.8,
    });
    if (state.physics) {
      for (const b of state.bodies) {
        b.sim = state.physics.addBall(b.id, b.x, b.z, CHAR_R);
      }
    }

    state.field = buildCoinField(
      ctx.scene,
      ctx.players.map((p) => characterColor(p.kind))
    );

    buildHud(state);

    /* ---- human input (screen routes pointer + keys while playing) ---- */
    ctx.input.pointer = (x, y, down): void => {
      state.human.tx = x;
      state.human.ty = y;
      state.human.idleT = 0;
      if (down) state.human.held = true;
    };
    ctx.input.stick = (x, y): void => {
      state.human.stickX = x;
      state.human.stickY = y;
    };
    ctx.input.key = (action: string): void => {
      if (action === "up") state.human.keyDir = { x: 0, z: -1 };
      else if (action === "down") state.human.keyDir = { x: 0, z: 1 };
      else if (action === "left") state.human.keyDir = { x: -1, z: 0 };
      else if (action === "right") state.human.keyDir = { x: 1, z: 0 };
      else if (action === "confirm") {
        const seat = localPlayerIndex(ctx.players);
        const b = state.bodies[seat];
        if (b && isLocalPlayer(ctx.players, b.id) && ctx.time - state.human.lastHopT > 0.6) {
          state.human.lastHopT = ctx.time;
          b.animHoldT = Math.max(b.animHoldT, 0.4);
          ctx.characters[b.id]?.anim.jump();
          ctx.playSfx("hop", { volume: 0.45, pitch: 1.1 });
        }
        return;
      } else {
        return;
      }
      state.human.keyIdleT = 0;
    };
    window.addEventListener("pointerup", state.onPointerUp);
    round = state;
    // Fresh telemetry mirror per round (critic probes read window.__CG__).
    (window as unknown as { __CG__?: unknown }).__CG__ = undefined;
    publishDebug(state);
  },

  update(dt: number): void {
    const state = round;
    if (!state) return;

    /* ---- fixed-step accumulator: run whole 1/60s steps only ---- */
    state.simTime += dt;
    let steps = 0;
    while (state.simTime >= FIXED_DT && steps < MAX_STEPS_PER_FRAME) {
      stepFixed(state, FIXED_DT);
      state.simTime -= FIXED_DT;
      state.stepIndex++;
      steps++;
      if (state.ended) break;
    }
    // If we hit the step cap, drop the backlog (spiral-of-death guard).
    if (steps >= MAX_STEPS_PER_FRAME && state.simTime >= FIXED_DT) {
      state.simTime = 0;
    }

    /* ---- per-frame visuals (presentation only — no gameplay, no rng) ---- */
    state.t = state.stepIndex * FIXED_DT;
    state.field?.update(state.t);
    updateHud(state);
    // Hit-stop: presentation-only visual freeze — non-gameplay visuals get a
    // micro-SLOW (dt scaled down) so the frozen frames don't jitter, while the
    // fixed step counter keeps advancing on schedule (twins stay byte-identical).
    const vDt = state.hitStopSteps > 0 ? dt * 0.18 : dt;
    if (state.hitStopSteps > 0) state.hitStopSteps--;
    updateCamera(state, vDt);
    updateParticles(state, vDt);
    updatePlusOnes(state, vDt);
    updateRadiusIndicators(state, vDt);
    publishDebug(state);
  },

  teardown(): void {
    const state = round;
    if (!state) return;
    window.removeEventListener("pointerup", state.onPointerUp);
    state.physics?.dispose();
    state.physics = null;
    state.field?.dispose();
    state.field = null;
    for (const b of state.bodies) {
      const ch = state.ctx.characters[b.id];
      if (ch) {
        b.holder.remove(ch.group); // hand the avatar back to the screen
        state.ctx.scene.add(ch.group);
      }
      state.ctx.scene.remove(b.holder);
    }
    state.bodies = [];
    state.ctx.scene.remove(state.dyn);
    for (const g of state.geos) g.dispose();
    for (const m of state.mats) m.dispose();
    state.geos = [];
    state.mats = [];
    state.piles = [];
    state.flyers = [];
    state.particles = [];
    state.rings = [];
    state.plusOnes = [];
    state.radiusIndicators = [];
    state.hudRoot?.remove();
    state.hudRoot = null;
    state.timerEl = null;
    state.chips = [];
    round = null;
  },
};

/**
 * Advance the simulation by exactly one fixed step (1/60s).
 * Every gameplay decision — movement integration, steering, pickup tests,
 * CPU decisions/knocks, pile spawns/respawns, and therefore every ctx.rng()
 * draw — happens here, driven by the integer stepIndex. All rng draws are a
 * pure function of (seeded rng, stepIndex), so the draw order is identical
 * across runs regardless of frame timing.
 */
function stepFixed(state: RoundState, dt: number): void {
  const ctx = state.ctx;
  const t = state.stepIndex * FIXED_DT;
  state.t = t;

  /* ---- sfx throttles (fixed-step countdown) ---- */
  state.boingT = Math.max(0, state.boingT - dt);
  state.popT = Math.max(0, state.popT - dt);

  /* ---- input freshness (fixed-step accumulation) ---- */
  state.human.idleT += dt;
  if (state.human.held && state.human.idleT > POINTER_AUTO_RELEASE) state.human.held = false;
  state.human.keyIdleT += dt;
  if (state.human.keyDir && state.human.keyIdleT > KEY_STALE) state.human.keyDir = null;

  /* ---- coin rain (fixed-step countdown; spawnPile draws ctx.rng) ---- */
  state.spawnT -= dt;
  if (state.spawnT <= 0) {
    state.spawnT = SPAWN_MIN + ctx.rng() * (SPAWN_MAX - SPAWN_MIN);
    if (state.piles.length < MAX_PILES) spawnPile(state);
  }

  /* ---- steer + integrate (id order: 0 human, 1-3 CPU) ---- */
  parkLocalSeat(state);
  const analog = stickGround(ctx.camera, state.human.stickX, state.human.stickY);
  const cpuHold = contactCpuFrozen();
  for (const b of state.bodies) {
    b.animHoldT = Math.max(0, b.animHoldT - dt);

    let dir: { x: number; z: number } | null = null;
    let maxSpeed = HUMAN_SPEED;
    if (isLocalPlayer(ctx.players, b.id)) {
      if (analog) {
        dir = { x: analog.x, z: analog.z };
        maxSpeed = HUMAN_SPEED * analog.mag;
      } else if (state.human.held) dir = pointerDir(state, b);
      else if (state.human.keyDir) dir = state.human.keyDir;
    } else if (cpuHold) {
      b.vx = 0;
      b.vz = 0;
    } else {
      b.brain.pickIn--;
      if (b.brain.pickIn <= 0) repick(b.brain, state);
      dir = cpuDir(state, b);
      maxSpeed = HUMAN_SPEED * b.brain.speedMul;
    }

    if (dir && (dir.x !== 0 || dir.z !== 0)) {
      b.vx += dir.x * ACCEL * dt;
      b.vz += dir.z * ACCEL * dt;
      const sp = Math.hypot(b.vx, b.vz);
      if (sp > maxSpeed) {
        b.vx *= maxSpeed / sp;
        b.vz *= maxSpeed / sp;
      }
    } else {
      const sp = Math.hypot(b.vx, b.vz);
      if (sp > 0) {
        const ns = Math.max(0, sp - FRICTION * dt);
        b.vx *= ns / sp;
        b.vz *= ns / sp;
      }
    }

    if (state.physics && b.sim) {
      b.sim.setVelocity(b.vx, b.vz);
    } else {
      b.x += b.vx * dt;
      b.z += b.vz * dt;

      /* ---- rim wall: clamp + reflect ---- */
      const d = Math.hypot(b.x, b.z);
      if (d > WALL_CLAMP && d > 1e-6) {
        const nx = b.x / d;
        const nz = b.z / d;
        b.x = nx * WALL_CLAMP;
        b.z = nz * WALL_CLAMP;
        const rv = b.vx * nx + b.vz * nz;
        if (rv > 0) {
          b.vx -= 1.8 * rv * nx;
          b.vz -= 1.8 * rv * nz;
          b.vx *= 0.96;
          b.vz *= 0.96;
          bumpJuice(state, b);
        }
      }

      b.holder.position.x = b.x;
      b.holder.position.z = b.z;
      applyMoveAnim(state, b);
    }
  }

  if (state.physics) {
    const hits = state.physics.step();
    for (const b of state.bodies) {
      if (!b.sim) continue;
      const pose = b.sim.pose();
      b.x = pose.x;
      b.z = pose.z;
      b.vx = pose.vx;
      b.vz = pose.vz;
      b.holder.position.x = b.x;
      b.holder.position.z = b.z;
      applyMoveAnim(state, b);
    }
    for (const hit of hits) {
      if (hit.approach <= 0) continue;
      if (hit.b < 0) {
        const body = state.bodies.find((p) => p.id === hit.a);
        if (body) bumpJuice(state, body);
        continue;
      }
      const a = state.bodies.find((p) => p.id === hit.a);
      const b = state.bodies.find((p) => p.id === hit.b);
      if (!a || !b) continue;
      bumpJuice(state, a);
      bumpJuice(state, b);
      if (hit.approach > KNOCK_MIN_IMPULSE) {
        const va = a.vx * hit.nx + a.vz * hit.nz;
        const vb = b.vx * hit.nx + b.vz * hit.nz;
        const victim = vb < va - 0.35 ? b : va < vb - 0.35 ? a : a.coins >= b.coins ? a : b;
        const bumper = victim === a ? b : a;
        if (victim.coins > 0 && ctx.rng() < KNOCK_P) knockCoin(state, victim, bumper);
      }
    }
  }

  /* ---- circle-circle collisions when Rapier is not loaded ---- */
  if (!state.physics) for (let i = 0; i < state.bodies.length; i++) {
    const a = state.bodies[i];
    for (let j = i + 1; j < state.bodies.length; j++) {
      const b = state.bodies[j];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const dist = Math.hypot(dx, dz);
      const min = CHAR_R * 2;
      if (dist >= min || dist < 1e-6) continue;
      const nx = dx / dist;
      const nz = dz / dist;
      const push = (min - dist) / 2 + 0.002;
      a.x -= nx * push;
      a.z -= nz * push;
      b.x += nx * push;
      b.z += nz * push;
      const rv = (b.vx - a.vx) * nx + (b.vz - a.vz) * nz;
      if (rv < 0) {
        const imp = (-(1 + 0.8) * rv) / 2;
        a.vx -= imp * nx;
        a.vz -= imp * nz;
        b.vx += imp * nx;
        b.vz += imp * nz;
        bumpJuice(state, a);
        bumpJuice(state, b);
        if (-rv > KNOCK_MIN_IMPULSE) {
          // The victim is the one moving slower along the impact normal;
          // on a dead tie the richer player loses a coin (leader tax).
          const va = a.vx * nx + a.vz * nz;
          const vb = b.vx * nx + b.vz * nz;
          const victim = vb < va - 0.35 ? b : va < vb - 0.35 ? a : a.coins >= b.coins ? a : b;
          const bumper = victim === a ? b : a;
          if (victim.coins > 0 && ctx.rng() < KNOCK_P) knockCoin(state, victim, bumper);
        }
      }
    }
  }
  for (const b of state.bodies) {
    b.holder.position.x = b.x;
    b.holder.position.z = b.z;
  }

  /* ---- pickup (collectPile: presentation-only visuals, zero ctx.rng) ---- */
  for (const b of state.bodies) {
    for (let i = state.piles.length - 1; i >= 0; i--) {
      const p = state.piles[i];
      if (Math.hypot(b.x - p.x, b.z - p.z) <= PICKUP_R) {
        collectPile(state, b, p);
        state.piles.splice(i, 1);
      }
    }
  }

  /* ---- pile lifecycles + knocked-coin flight (fixed-step) ---- */
  updatePiles(state, dt);
  updateFlyers(state, dt);

  if (!state.hurryAnnounced && t >= 20) {
    state.hurryAnnounced = true;
    ctx.announce("10 SECONDS LEFT!", { durationMs: 1200, sound: "whistle" });
  }
  if (t >= TIME_CAP) {
    endGame(state);
    return;
  }
}

/* Module-level round handle: replaced by setup() each round, nulled on
   teardown. Rounds are strictly sequential (setup -> updates -> teardown). */
let round: RoundState | null = null;
