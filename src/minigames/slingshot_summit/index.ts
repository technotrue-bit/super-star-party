/**
 * SLINGSHOT SUMMIT — a free-for-all target minigame on the HOLD control.
 *
 * Four players share a treetop deck, one slingshot each, side by side. Down
 * your lane, three ringed targets slide from side to side: a near one (small,
 * quick), a middle one and a far one (big, lazy). HOLD to pull the sling back
 * (the longer you pull, the farther the acorn flies, up to 1.2 s), steer the
 * MOVE stick (or the arrow keys) to swing the aim, and LET GO to fire. The
 * acorn lands where you aimed; if it lands in a ring it scores that ring:
 * outer 1, middle 3, bullseye 5. After 30 s the wind picks up and everything
 * sways faster. 45 s on the clock; most points wins, a tie goes to the most
 * 5s, then the most 3s.
 *
 * Fairness: every lane has the same three targets swaying in step (their
 * phases are drawn once per round), so no seat has an easier lane.
 *
 * CPU seats (and your own seat under autoplay) use planCpuShot(): pick a ring
 * and a target, lead its sway, pull for cpuChargeTime(...) and release every
 * 1.4 / skill seconds, with a little aim wobble. Always 7 rng draws per
 * shot, at every skill.
 *
 * Ranking: points, then 5s, then 3s, then a per-round coin drawn at setup.
 *
 * Determinism: the game runs in fixed 1/60 s steps with an integer step
 * index. A human's press and release are queued and applied at the start of
 * the next step; everything else (CPU plans, flight, landing, scoring) is a
 * function of the step clock and ctx.rng. Presentation (particles, popups,
 * squash, the camera framing) never feeds back into the sim. The camera never
 * moves: no shake. Telemetry: window.__SLINGSHOT__.
 */
import * as THREE from "three";
import {
  automatedSeatIds,
  cpuSkill,
  isLocalPlayer,
  isPracticeBeat,
  type Minigame,
  type MinigameContext,
} from "../framework";
import { registerMinigame } from "../registry";
import { box as frameBox, frameMinigame } from "../framing";
import { palette, hex } from "../../config/palette";
import { isAutoplay } from "../../core/debug";
import { celGradient } from "../../characters/cel";
import type { Character } from "../../characters/characterFactory";
import { buildCanopyEnvironment, DECK_Y, type CanopyEnvironment } from "./environment";
import {
  HOLD_MAX,
  RELOAD,
  ROUND_SECONDS,
  TARGETS,
  WIND_AT,
  aimAngle,
  apexHeight,
  chargeOf,
  flightTime,
  landPoint,
  planCpuShot,
  rankPlayers,
  scoreLanding,
  targetOffset,
  targetSpeed,
  windLevel,
  CPU_PERIOD,
  type CpuShotPlan,
} from "./rules";

const FIXED_DT = 1 / 60;
const MAX_STEPS_PER_FRAME = 12;

/** The framework force-finishes a round still running at this game time (s). */
const TIME_LIMIT = 55;
/** After the buzzer the last acorns land, then the result shows for this long (s). */
const POST_BUZZER = 1.0;
const RESULT_PAUSE = 1.3;
/** Lane spacing, and where things stand along the lane (z). */
const LANE_GAP = 2.8;
const SLING_Z = 0;
const CHAR_Z = 2.05;
/** Size of the slingshot and of the avatars on the deck. */
const SLING_SCALE = 1.35;
const CHAR_SCALE = 1.25;
/** Height of the fork tips above the deck. */
const FORK_H = 1.05;
/** Pull-back of the pouch at no charge and the extra at full charge. */
const POUCH_BACK = 0.14;
const POUCH_PULL = 0.95;
/** How fast the aim swings toward the stick (per second, exponential). */
const AIM_RATE = 14;
/** Stick below this deflection is no aim; the rest is remapped onto 0..1. */
const STICK_DEAD = 0.12;
/** One arrow-key press (or key repeat) swings the aim this much. */
const KEY_STEP = 0.12;

/* ------------------------------------------------------------------ */
/*  State                                                              */
/* ------------------------------------------------------------------ */

interface TargetView {
  group: THREE.Group;
  kick: number;
  flag: THREE.Object3D;
}

interface Lane {
  idx: number;
  id: number;
  name: string;
  color: string;
  x: number;
  cpu: boolean;
  /** The aim the sling points at, -1..1. */
  aim: number;
  aimStick: number;
  aimKey: number;
  holding: boolean;
  holdT: number;
  /** A release that came before the reload finished fires when it does. */
  queued: number | null;
  reloadUntil: number;
  plan: CpuShotPlan | null;
  planAimFrom: number;
  /** Time the CPU's last shot left, the base for the next plan. */
  lastRelease: number;
  coin: number;
  points: number;
  fives: number;
  threes: number;
  ones: number;
  shots: number;
  hits: number;
  // presentation
  pull: number;
  recoil: number;
  sling: THREE.Group;
  bands: [THREE.Mesh, THREE.Mesh];
  pouch: THREE.Group;
  loadedAcorn: THREE.Object3D;
  /** Fork tip positions in the sling's own space. */
  tips: THREE.Vector3[];
  targets: TargetView[];
  reticle: THREE.Mesh | null;
  reticleRing: THREE.Mesh | null;
  aimDots: THREE.Mesh[];
  char: Character | null;
  celebrateUntil: number;
  leanBase: number;
}

interface Shot {
  lane: Lane;
  t0: number;
  T: number;
  charge: number;
  from: THREE.Vector3;
  /** Landing point in world coordinates. */
  to: THREE.Vector3;
  /** Landing point in lane coordinates (the slingshot at the origin). */
  land: { x: number; z: number };
  mesh: THREE.Group;
  shadow: THREE.Mesh;
  trailT: number;
  /** Set once it has landed: how long it stays stuck/fading, and where on the target. */
  stuck: { target: number; dx: number; dz: number; life: number } | null;
  fade: number;
  done: boolean;
}

interface Puff {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
  grav: number;
  base: number;
}

interface RingFx {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  life: number;
  maxLife: number;
  base: number;
  grow: number;
}

interface Popup {
  sprite: THREE.Sprite;
  mat: THREE.SpriteMaterial;
  life: number;
  baseY: number;
}

interface State {
  ctx: MinigameContext;
  root: THREE.Group;
  env: CanopyEnvironment;
  lanes: Lane[];
  human: Lane | null;
  phases: number[];
  step: number;
  simTime: number;
  presT: number;
  closing: boolean;
  closedAt: number;
  resultAt: number;
  finished: boolean;
  winds: boolean;
  events: { down: boolean; held: number }[];
  shots: Shot[];
  puffs: Puff[];
  rings: RingFx[];
  popups: Popup[];
  mats: Map<string, THREE.MeshBasicMaterial>;
  toons: Map<string, THREE.MeshToonMaterial>;
  popupTex: Record<1 | 3 | 5, THREE.CanvasTexture>;
  faceTex: THREE.CanvasTexture;
  geos: THREE.BufferGeometry[];
  acornBody: THREE.MeshToonMaterial;
  acornCap: THREE.MeshToonMaterial;
  outlineMat: THREE.MeshBasicMaterial;
  shadowMat: THREE.MeshBasicMaterial;
  log: string[];
}

let round: State | null = null;

/* ------------------------------------------------------------------ */
/*  Art                                                                */
/* ------------------------------------------------------------------ */

function toonOf(st: State, color: string): THREE.MeshToonMaterial {
  let m = st.toons.get(color);
  if (!m) {
    m = new THREE.MeshToonMaterial({ color: hex(color), gradientMap: celGradient });
    st.toons.set(color, m);
  }
  return m;
}

function basicOf(st: State, color: string): THREE.MeshBasicMaterial {
  let m = st.mats.get(color);
  if (!m) {
    m = new THREE.MeshBasicMaterial({ color: hex(color) });
    st.mats.set(color, m);
  }
  return m;
}

function geo<T extends THREE.BufferGeometry>(st: State, g: T): T {
  st.geos.push(g);
  return g;
}

/** Stretch a unit-height cylinder between two points (in its parent's space). */
function stretch(m: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3, r: number): void {
  const d = new THREE.Vector3().subVectors(b, a);
  const len = Math.max(0.001, d.length());
  m.position.copy(a).addScaledVector(d, 0.5);
  m.scale.set(r, len, r);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.divideScalar(len));
}

/** The acorn: a nut with a cross-hatched cap. */
function makeAcorn(st: State, scale = 1): THREE.Group {
  const g = new THREE.Group();
  const nutGeo = geo(st, new THREE.SphereGeometry(0.15, 12, 9));
  nutGeo.scale(1, 1.2, 1);
  const nut = new THREE.Mesh(nutGeo, st.acornBody);
  const capGeo = geo(st, new THREE.SphereGeometry(0.165, 12, 7, 0, Math.PI * 2, 0, Math.PI / 2));
  const cap = new THREE.Mesh(capGeo, st.acornCap);
  cap.position.y = 0.06;
  const stem = new THREE.Mesh(geo(st, new THREE.CylinderGeometry(0.018, 0.026, 0.09, 5)), st.acornCap);
  stem.position.y = 0.2;
  const outlineGeo = geo(st, nutGeo.clone().scale(1.1, 1.06, 1.1));
  const outline = new THREE.Mesh(outlineGeo, st.outlineMat);
  g.add(outline, nut, cap, stem);
  g.scale.setScalar(scale);
  return g;
}

/** The painted face of a target: cream, red, gold, with the ring values on it. */
function makeFaceTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d");
  if (g) {
    const R = 124;
    const edges = [1, 0.62, 0.3];
    const fills = [palette.cream, palette.lava, palette.sun];
    g.lineWidth = 5;
    g.strokeStyle = palette.ink;
    edges.forEach((e, i) => {
      g.beginPath();
      g.arc(128, 128, R * e, 0, Math.PI * 2);
      g.fillStyle = fills[i];
      g.fill();
      g.stroke();
    });
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.lineJoin = "round";
    const label = (text: string, y: number, size: number, fill: string, stroke = true): void => {
      g.font = `700 ${size}px Fredoka, sans-serif`;
      if (stroke) {
        g.lineWidth = 7;
        g.strokeStyle = palette.ink;
        g.strokeText(text, 128, y);
      }
      g.fillStyle = fill;
      g.fillText(text, 128, y);
    };
    label("1", 128 - R * 0.81, 38, palette.ink, false);
    label("3", 128 - R * 0.46, 34, palette.cream);
    label("5", 128, 46, palette.ink, false);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function makePopupTexture(text: string, fill: string): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 192;
  c.height = 112;
  const g = c.getContext("2d");
  if (g) {
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.lineJoin = "round";
    g.font = "700 88px Fredoka, sans-serif";
    g.lineWidth = 16;
    g.strokeStyle = palette.ink;
    g.strokeText(text, 96, 58);
    g.fillStyle = fill;
    g.fillText(text, 96, 58);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function buildSling(st: State, lane: Lane): void {
  const g = new THREE.Group();
  g.position.set(lane.x, DECK_Y, SLING_Z);
  const wood = toonOf(st, palette.wood);
  const dark = toonOf(st, palette.woodDark);
  const own = toonOf(st, lane.color);
  // A stump to stand on, the post, and the two prongs of the fork.
  const stump = new THREE.Mesh(geo(st, new THREE.CylinderGeometry(0.2, 0.26, 0.14, 10)), dark);
  stump.position.y = 0.07;
  const post = new THREE.Mesh(geo(st, new THREE.CylinderGeometry(0.07, 0.1, 0.72, 8)), wood);
  post.position.y = 0.45;
  g.add(stump, post);
  const tips: THREE.Vector3[] = [];
  for (const s of [-1, 1]) {
    const arm = new THREE.Mesh(geo(st, new THREE.CylinderGeometry(1, 1, 1, 6)), wood);
    const a = new THREE.Vector3(0, 0.7, 0);
    const b = new THREE.Vector3(s * 0.25, FORK_H, 0);
    stretch(arm, a, b, 0.055);
    const knob = new THREE.Mesh(geo(st, new THREE.SphereGeometry(0.08, 8, 6)), own);
    knob.position.copy(b);
    g.add(arm, knob);
    tips.push(b);
  }
  const bandGeo = geo(st, new THREE.CylinderGeometry(1, 1, 1, 5));
  const bandMat = toonOf(st, palette.lava);
  const bands: [THREE.Mesh, THREE.Mesh] = [new THREE.Mesh(bandGeo, bandMat), new THREE.Mesh(bandGeo, bandMat)];
  g.add(bands[0], bands[1]);
  // The pouch: a leather patch holding the acorn.
  const pouch = new THREE.Group();
  const patch = new THREE.Mesh(geo(st, new THREE.BoxGeometry(0.2, 0.05, 0.14)), dark);
  const acorn = makeAcorn(st, 0.9);
  acorn.position.set(0, 0.13, 0);
  pouch.add(patch, acorn);
  g.add(pouch);
  g.scale.setScalar(SLING_SCALE);
  st.root.add(g);
  lane.sling = g;
  lane.bands = bands;
  lane.pouch = pouch;
  lane.loadedAcorn = acorn;
  lane.tips = tips;
}

function buildTargets(st: State, lane: Lane): void {
  const dark = toonOf(st, palette.woodDark);
  const own = toonOf(st, lane.color);
  const faceMat = new THREE.MeshBasicMaterial({ map: st.faceTex });
  st.mats.set(`face${lane.idx}`, faceMat);
  const railMat = toonOf(st, palette.wood);
  TARGETS.forEach((spec, i) => {
    // The track the target slides on.
    const half = spec.amp + 0.25;
    const rail = new THREE.Mesh(geo(st, new THREE.BoxGeometry(half * 2, 0.06, 0.16)), railMat);
    rail.position.set(lane.x, DECK_Y + 0.03, -spec.dist);
    st.root.add(rail);
    for (const s of [-1, 1]) {
      const stop = new THREE.Mesh(geo(st, new THREE.CylinderGeometry(0.1, 0.12, 0.2, 8)), own);
      stop.position.set(lane.x + s * half, DECK_Y + 0.1, -spec.dist);
      st.root.add(stop);
    }
    const g = new THREE.Group();
    const base = new THREE.Mesh(geo(st, new THREE.CylinderGeometry(spec.radius + 0.07, spec.radius + 0.12, 0.2, 36)), dark);
    base.position.y = 0.12;
    const rim = new THREE.Mesh(geo(st, new THREE.TorusGeometry(spec.radius + 0.05, 0.075, 6, 36)), own);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.225;
    const face = new THREE.Mesh(geo(st, new THREE.CircleGeometry(spec.radius, 40)), faceMat);
    face.rotation.x = -Math.PI / 2;
    face.position.y = 0.232;
    // A pennant on a pole behind the disc says whose it is from a distance.
    const flag = new THREE.Group();
    const pole = new THREE.Mesh(geo(st, new THREE.CylinderGeometry(0.025, 0.03, 1.0, 5)), dark);
    pole.position.y = 0.5;
    const cloth = new THREE.Mesh(geo(st, new THREE.ConeGeometry(0.17, 0.42, 3)), own);
    cloth.rotation.z = -Math.PI / 2;
    cloth.position.set(0.21, 0.88, 0);
    flag.add(pole, cloth);
    flag.position.set(0, 0.1, -spec.radius - 0.22);
    g.add(base, rim, face, flag);
    g.position.set(lane.x, DECK_Y, -spec.dist);
    st.root.add(g);
    lane.targets.push({ group: g, kick: 0, flag });
  });
}

function buildAimAids(st: State, lane: Lane): void {
  const ringGeo = geo(st, new THREE.RingGeometry(0.2, 0.3, 28));
  const reticle = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: hex(lane.color), transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthTest: false }));
  reticle.rotation.x = -Math.PI / 2;
  reticle.renderOrder = 5;
  reticle.visible = false;
  const outerGeo = geo(st, new THREE.RingGeometry(0.34, 0.4, 28));
  const outer = new THREE.Mesh(outerGeo, new THREE.MeshBasicMaterial({ color: hex(palette.white), transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthTest: false }));
  outer.renderOrder = 5;
  reticle.add(outer);
  st.root.add(reticle);
  st.mats.set(`reticle${lane.idx}`, reticle.material as THREE.MeshBasicMaterial);
  st.mats.set(`reticleO${lane.idx}`, outer.material as THREE.MeshBasicMaterial);
  lane.reticle = reticle;
  lane.reticleRing = outer;
  const dotGeo = geo(st, new THREE.CircleGeometry(0.06, 8));
  const dotMat = new THREE.MeshBasicMaterial({ color: hex(palette.white), transparent: true, opacity: 0.7, depthTest: false });
  st.mats.set(`dot${lane.idx}`, dotMat);
  for (let i = 0; i < 12; i++) {
    const d = new THREE.Mesh(dotGeo, dotMat);
    d.rotation.x = -Math.PI / 2;
    d.renderOrder = 4;
    d.visible = false;
    st.root.add(d);
    lane.aimDots.push(d);
  }
}

/* ------------------------------------------------------------------ */
/*  Effects                                                            */
/* ------------------------------------------------------------------ */

function puff(st: State, at: THREE.Vector3, color: string, vel: THREE.Vector3, life: number, size: number, grav = 7): void {
  const m = new THREE.Mesh(st.geos[0], basicOf(st, color));
  m.position.copy(at);
  m.scale.setScalar(size);
  st.root.add(m);
  st.puffs.push({ mesh: m, vel, life, maxLife: life, grav, base: size });
}

function ringPulse(st: State, at: THREE.Vector3, color: string, size: number, life: number): void {
  const mat = new THREE.MeshBasicMaterial({ color: hex(color), transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false });
  const m = new THREE.Mesh(st.geos[1], mat);
  m.rotation.x = -Math.PI / 2;
  m.position.copy(at);
  m.position.y += 0.03;
  m.scale.setScalar(size * 0.5);
  st.root.add(m);
  st.rings.push({ mesh: m, mat, life, maxLife: life, base: size * 0.5, grow: size * 1.6 });
}

function popup(st: State, at: THREE.Vector3, value: 1 | 3 | 5): void {
  const mat = new THREE.SpriteMaterial({ map: st.popupTex[value], transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  sprite.position.copy(at);
  sprite.position.y += 0.5;
  sprite.scale.set(0.01, 0.01, 1);
  sprite.renderOrder = 10;
  st.root.add(sprite);
  st.popups.push({ sprite, mat, life: 0, baseY: sprite.position.y });
}

const LEAF_BITS = [palette.leaf, palette.mint, palette.leafDeep, palette.sun];

function leafBurst(st: State, at: THREE.Vector3, count: number, power: number, colors: string[] = LEAF_BITS): void {
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + at.x * 3.1;
    const sp = power * (0.6 + 0.4 * ((i * 7) % 5) / 4);
    puff(st, at, colors[i % colors.length], new THREE.Vector3(Math.cos(a) * sp, 1.4 + ((i * 3) % 4) * 0.5 * power * 0.4, Math.sin(a) * sp), 0.6 + (i % 3) * 0.1, 0.8 + (i % 2) * 0.4);
  }
}

/* ------------------------------------------------------------------ */
/*  Sim                                                                */
/* ------------------------------------------------------------------ */

/** Pouch position in world coordinates for the current aim and a pull share. */
function pouchWorld(lane: Lane, pull: number, out: THREE.Vector3): THREE.Vector3 {
  const a = aimAngle(lane.aim);
  const back = (POUCH_BACK + POUCH_PULL * pull) * SLING_SCALE;
  return out.set(lane.x - Math.sin(a) * back, DECK_Y + (FORK_H - 0.02) * SLING_SCALE, SLING_Z + Math.cos(a) * back);
}

function fireShot(st: State, lane: Lane, heldSec: number, t: number): void {
  const c = chargeOf(heldSec);
  const land = landPoint(lane.aim, c);
  const from = pouchWorld(lane, c, new THREE.Vector3());
  const to = new THREE.Vector3(lane.x + land.x, DECK_Y + 0.22, land.z);
  const mesh = makeAcorn(st, 1);
  mesh.position.copy(from);
  st.root.add(mesh);
  const shadow = new THREE.Mesh(st.geos[2], st.shadowMat);
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.set(from.x, DECK_Y + 0.03, from.z);
  st.root.add(shadow);
  st.shots.push({ lane, t0: t, T: flightTime(c), charge: c, from, to, land, mesh, shadow, trailT: 0, stuck: null, fade: 0, done: false });
  lane.shots++;
  lane.holding = false;
  lane.holdT = 0;
  lane.reloadUntil = t + RELOAD;
  lane.recoil = 1;
  const mine = lane === st.human;
  st.ctx.playSfx("whoosh", { volume: mine ? 0.7 : 0.22, pitch: 3 + c * 4 });
  st.log.push(`${t.toFixed(2)} L${lane.idx} fire c=${c.toFixed(2)} aim=${lane.aim.toFixed(2)}`);
}

function landShot(st: State, shot: Shot, t: number): void {
  const lane = shot.lane;
  const { ring, target } = scoreLanding(shot.land.x, shot.land.z, st.phases, t);
  const mine = lane === st.human;
  const at = shot.to.clone();
  if (ring !== 0) {
    lane.points += ring;
    lane.hits++;
    if (ring === 5) lane.fives++;
    else if (ring === 3) lane.threes++;
    else lane.ones++;
    const tv = lane.targets[target];
    tv.kick = ring === 5 ? 1 : ring === 3 ? 0.75 : 0.5;
    const spec = TARGETS[target];
    const cx = lane.x + targetOffset(spec, st.phases[target], t);
    shot.stuck = { target, dx: shot.to.x - cx, dz: shot.to.z + spec.dist, life: 1.4 };
    popup(st, at, ring);
    ringPulse(st, at, ring === 5 ? palette.sun : ring === 3 ? palette.lava : palette.white, ring === 5 ? 1.2 : 0.8, 0.5);
    leafBurst(st, at, ring === 5 ? 14 : ring === 3 ? 9 : 5, ring === 5 ? 3.4 : 2.4, ring === 5 ? [palette.sun, palette.sunDeep, palette.white, palette.mint] : LEAF_BITS);
    st.ctx.playSfx(ring === 5 ? "coin.gain" : "pop", { volume: mine ? 1 : 0.35, pitch: ring === 5 ? 7 : ring === 3 ? 4 : 0 });
    if (ring === 5) {
      st.env.flare();
      if (mine) st.ctx.playSfx("crowd.ooh", { volume: 0.5 });
    }
    if (ring >= 3 && lane.char) {
      lane.char.anim.cheer();
      lane.char.setFacing(0);
      lane.celebrateUntil = st.presT + (ring === 5 ? 1.1 : 0.7);
    }
    st.log.push(`${t.toFixed(2)} L${lane.idx} +${ring} t${target} -> ${lane.points}`);
  } else {
    shot.fade = 0.7;
    leafBurst(st, at, 4, 1.3, [palette.leaf, palette.leafDeep]);
    st.ctx.playSfx("land", { volume: mine ? 0.4 : 0.1, pitch: -2 });
    st.log.push(`${t.toFixed(2)} L${lane.idx} miss`);
  }
}

function stepFixed(st: State): void {
  const t = st.step * FIXED_DT;
  const ctx = st.ctx;

  // The buzzer.
  if (!st.closing && t >= ROUND_SECONDS) {
    st.closing = true;
    st.closedAt = t;
    for (const lane of st.lanes) {
      lane.holding = false;
      lane.holdT = 0;
      lane.plan = null;
      lane.queued = null;
    }
    st.events.length = 0;
    ctx.announce("TIME!", { durationMs: 1000, sound: "whistle" });
  }

  // Wind picks up.
  if (!st.winds && t >= WIND_AT) {
    st.winds = true;
    ctx.announce("THE WIND PICKS UP!", { durationMs: 1100, sound: null });
  }

  if (!st.closing) {
    // Human press and release.
    const human = st.human;
    if (human) {
      for (const e of st.events) {
        if (e.down) {
          if (!human.holding) {
            human.holding = true;
            human.holdT = 0;
          }
        } else if (human.holding) {
          if (t >= human.reloadUntil) fireShot(st, human, e.held, t);
          else {
            human.queued = e.held;
            human.holding = false;
            human.holdT = 0;
          }
        }
      }
      st.events.length = 0;
      if (human.queued !== null && t >= human.reloadUntil) {
        fireShot(st, human, human.queued, t);
        human.queued = null;
      }
      const want = human.aimStick !== 0 ? human.aimStick : human.aimKey;
      human.aim += (want - human.aim) * Math.min(1, AIM_RATE * FIXED_DT);
      if (human.holding) human.holdT = Math.min(HOLD_MAX, human.holdT + FIXED_DT);
    }

    // CPU seats.
    const skill = cpuSkill();
    for (const lane of st.lanes) {
      if (!lane.cpu) continue;
      if (!lane.plan) {
        lane.plan = planCpuShot(ctx.rng, skill, st.phases, lane.lastRelease);
        lane.planAimFrom = lane.aim;
      }
      const plan = lane.plan;
      if (!lane.holding && t >= plan.pullStart) {
        lane.holding = true;
        lane.holdT = 0;
        lane.planAimFrom = lane.aim;
      }
      if (lane.holding) {
        lane.holdT = Math.min(HOLD_MAX, lane.holdT + FIXED_DT);
        const u = Math.min(1, lane.holdT / Math.max(0.05, plan.holdSec));
        const s = u * u * (3 - 2 * u);
        lane.aim = lane.planAimFrom + (plan.aim - lane.planAimFrom) * s;
        if (t >= plan.releaseAt - 1e-9) {
          lane.aim = plan.aim;
          fireShot(st, lane, plan.holdSec, t);
          lane.lastRelease = plan.releaseAt;
          lane.plan = null;
        }
      }
    }
  }

  // Acorns that land this step.
  for (const shot of st.shots) {
    if (shot.done || shot.stuck || shot.fade > 0) continue;
    if (t >= shot.t0 + shot.T - 1e-9) landShot(st, shot, shot.t0 + shot.T);
  }

  // Close out.
  if (st.closing && st.resultAt < 0) {
    const inAir = st.shots.some((s) => !s.stuck && s.fade === 0 && !s.done);
    if (!inAir && t >= st.closedAt + POST_BUZZER) {
      st.resultAt = t + RESULT_PAUSE;
      const order = rankPlayers(st.lanes.map((l) => ({ id: l.id, points: l.points, fives: l.fives, threes: l.threes, coin: l.coin })));
      const best = st.lanes.find((l) => l.id === order[0]);
      for (const lane of st.lanes) {
        if (!lane.char) continue;
        lane.celebrateUntil = Infinity;
        lane.char.setFacing(0);
        if (lane === best) lane.char.anim.cheer();
        else lane.char.anim.sad();
      }
      st.env.flare();
      ctx.playSfx("crowd.cheer", { volume: 0.7 });
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Presentation                                                       */
/* ------------------------------------------------------------------ */

function updateVisuals(st: State, dt: number): void {
  const tVis = st.step * FIXED_DT + st.simTime;
  st.presT += dt;
  const pres = st.presT;

  for (const lane of st.lanes) {
    // Targets slide on the sway clock.
    lane.targets.forEach((tv, i) => {
      const spec = TARGETS[i];
      const off = targetOffset(spec, st.phases[i], tVis);
      const vx = targetSpeed(spec, st.phases[i], tVis);
      tv.kick = Math.max(0, tv.kick - dt * 2.6);
      const k = tv.kick;
      tv.group.position.x = lane.x + off;
      tv.group.rotation.z = -vx * 0.09 + Math.sin(pres * 28) * 0.06 * k;
      const squash = 1 - 0.16 * k * Math.abs(Math.cos(pres * 14));
      tv.group.scale.set(1 + 0.05 * k, squash, 1 + 0.05 * k);
      tv.flag.rotation.y = Math.sin(pres * 4 + i + lane.idx) * 0.25 - vx * 0.25;
    });

    // Sling: pull back while holding, snap forward on release.
    const target = lane.holding ? Math.min(1, lane.holdT / HOLD_MAX) : 0;
    lane.recoil = Math.max(0, lane.recoil - dt * 4.5);
    const shown = lane.holding ? target : -0.3 * lane.recoil * Math.sin(lane.recoil * 9);
    lane.pull += (shown - lane.pull) * Math.min(1, dt * (lane.holding ? 24 : 40));
    const a = aimAngle(lane.aim);
    lane.sling.rotation.y = -a;
    const back = POUCH_BACK + POUCH_PULL * lane.pull;
    lane.pouch.position.set(0, FORK_H - 0.02, back);
    const tips = lane.tips;
    stretch(lane.bands[0], tips[0], lane.pouch.position, 0.022);
    stretch(lane.bands[1], tips[1], lane.pouch.position, 0.022);
    lane.loadedAcorn.visible = st.step * FIXED_DT >= lane.reloadUntil && !st.closing;
    lane.loadedAcorn.rotation.z = Math.sin(pres * 3 + lane.idx) * 0.1;

    // The shooter leans back with the pull; a hit turns them to the camera.
    const ch = lane.char;
    if (ch) {
      if (pres > lane.celebrateUntil) {
        lane.celebrateUntil = 0;
        ch.anim.idle();
        ch.setFacing(Math.PI);
      }
      ch.group.position.z = CHAR_Z + 0.2 * lane.pull;
      ch.group.rotation.x = 0.16 * lane.pull;
    }

    // The human's aim aids: a dotted line down the lane, and where the acorn would land.
    if (lane.reticle) {
      const holding = lane.holding;
      const c = holding ? Math.min(1, lane.holdT / HOLD_MAX) : 0;
      const p = landPoint(lane.aim, c);
      lane.reticle.visible = holding && !st.closing;
      lane.reticle.position.set(lane.x + p.x, DECK_Y + 0.07, p.z);
      lane.reticle.scale.setScalar(1 + 0.12 * Math.sin(pres * 9));
      lane.reticle.rotation.z = pres * 1.6;
      const maxD = holding ? Math.hypot(p.x, p.z) : 9.2;
      lane.aimDots.forEach((d, i) => {
        const dist = 1.0 + i * 0.75;
        d.visible = !st.closing && dist < maxD - (holding ? 0.35 : 0);
        d.position.set(lane.x + Math.sin(a) * dist, DECK_Y + 0.06, -Math.cos(a) * dist);
      });
    }
  }

  // Acorns in flight, and acorns stuck on a target.
  for (let i = st.shots.length - 1; i >= 0; i--) {
    const s = st.shots[i];
    if (!s.stuck && s.fade === 0) {
      const u = Math.min(1, Math.max(0, (tVis - s.t0) / s.T));
      s.mesh.position.lerpVectors(s.from, s.to, u);
      const apex = apexHeight(s.charge);
      s.mesh.position.y = s.from.y + (s.to.y - s.from.y) * u + apex * 4 * u * (1 - u);
      s.mesh.rotation.set(u * 9, u * 5, u * 3);
      const h = Math.max(0, s.mesh.position.y - DECK_Y);
      s.shadow.position.set(s.mesh.position.x, DECK_Y + 0.035, s.mesh.position.z);
      s.shadow.scale.setScalar(Math.max(0.25, 1 - h * 0.22));
      s.trailT -= dt;
      if (s.trailT <= 0) {
        s.trailT = 0.035;
        puff(st, s.mesh.position, s.lane.color, new THREE.Vector3((i % 3 - 1) * 0.1, 0.15, 0), 0.32, 1.1, 0);
      }
    } else {
      s.shadow.visible = false;
      if (s.stuck) {
        const tv = s.lane.targets[s.stuck.target];
        s.mesh.position.set(tv.group.position.x + s.stuck.dx, DECK_Y + 0.26, tv.group.position.z + s.stuck.dz);
        s.mesh.rotation.set(0.3, 0, tv.group.rotation.z);
        s.stuck.life -= dt;
        const k = Math.min(1, Math.max(0, s.stuck.life / 0.4));
        s.mesh.scale.setScalar(k);
        if (s.stuck.life <= 0) s.done = true;
      } else {
        s.fade -= dt;
        s.mesh.position.y = DECK_Y + 0.2 + Math.max(0, Math.sin(Math.min(1, (0.7 - s.fade) / 0.35) * Math.PI)) * 0.25;
        s.mesh.scale.setScalar(Math.min(1, Math.max(0, s.fade / 0.25)));
        if (s.fade <= 0) s.done = true;
      }
    }
    if (s.done) {
      s.mesh.removeFromParent();
      s.shadow.removeFromParent();
      st.shots.splice(i, 1);
    }
  }

  for (let i = st.puffs.length - 1; i >= 0; i--) {
    const p = st.puffs[i];
    p.life -= dt;
    p.vel.y -= p.grav * dt;
    p.mesh.position.addScaledVector(p.vel, dt);
    p.mesh.scale.setScalar(Math.max(0.001, p.base * (p.life / p.maxLife)));
    if (p.life <= 0) {
      p.mesh.removeFromParent();
      st.puffs.splice(i, 1);
    }
  }
  for (let i = st.rings.length - 1; i >= 0; i--) {
    const r = st.rings[i];
    r.life -= dt;
    const u = 1 - Math.max(0, r.life) / r.maxLife;
    r.mesh.scale.setScalar(r.base + r.grow * u);
    r.mat.opacity = 0.9 * (1 - u);
    if (r.life <= 0) {
      r.mesh.removeFromParent();
      r.mat.dispose();
      st.rings.splice(i, 1);
    }
  }
  for (let i = st.popups.length - 1; i >= 0; i--) {
    const p = st.popups[i];
    p.life += dt;
    const u = p.life / 1.0;
    const pop = u < 0.18 ? u / 0.18 : 1;
    const s = (0.55 + 0.75 * Math.sin(Math.min(1, pop) * Math.PI * 0.5) * (1 + 0.18 * Math.sin(pop * Math.PI))) * 1.25;
    p.sprite.scale.set(s * 1.1, s * 0.64, 1);
    p.sprite.position.y = p.baseY + 1.1 * Math.min(1, u * 1.3);
    p.mat.opacity = u > 0.7 ? Math.max(0, 1 - (u - 0.7) / 0.3) : 1;
    if (u >= 1) {
      p.sprite.removeFromParent();
      p.mat.dispose();
      st.popups.splice(i, 1);
    }
  }

  st.env.setWind(windLevel(tVis));
  st.env.update(pres, dt);
}

function publish(st: State): void {
  const w = window as unknown as { __SLINGSHOT__?: unknown };
  w.__SLINGSHOT__ = {
    t: st.step * FIXED_DT,
    step: st.step,
    closing: st.closing,
    finished: st.finished,
    tFinish: st.finished ? st.resultAt : null,
    scores: st.lanes.map((l) => l.points),
    aims: st.lanes.map((l) => Math.round(l.aim * 1000) / 1000),
    fives: st.lanes.map((l) => l.fives),
    threes: st.lanes.map((l) => l.threes),
    ones: st.lanes.map((l) => l.ones),
    shots: st.lanes.map((l) => l.shots),
    log: st.log.slice(-12),
  };
}

/* ------------------------------------------------------------------ */
/*  Minigame                                                           */
/* ------------------------------------------------------------------ */

const slingshotSummit: Minigame = {
  id: "slingshot_summit",
  name: "Slingshot Summit",
  genre: "target",
  pad: "hold",
  holdMax: HOLD_MAX,
  timeLimit: TIME_LIMIT,
  howTo: "Hold to pull your slingshot, let go to fire. Land acorns in the rings.",
  goal: "Most points in 45 seconds.",
  tap: null,
  steer: true,
  rules: {
    format: "ffa",
    length: "45 seconds",
    win: "Most points: land acorns in the rings (1, 3 or 5). A tie goes to the most 5s",
    touch: ["Hold the button to pull back, let go to fire", "Slide the stick to aim left or right"],
    keys: ["Hold Space to pull back, release to fire", "Left / Right (or A / D) to aim"],
  },

  setup(ctx: MinigameContext) {
    const root = new THREE.Group();
    root.name = "slingshot:root";
    ctx.scene.add(root);

    const n = ctx.players.length;
    const laneInfos = ctx.players.map((p, i) => ({ x: (i - (n - 1) / 2) * LANE_GAP, color: p.color }));
    const env = buildCanopyEnvironment(root, laneInfos);

    // A fixed camera over the deck, high enough to read the distance down each lane.
    // A tall phone gets a steeper look so the lanes fill more of the screen.
    frameMinigame(ctx.camera, () => ({
      box: frameBox([-6.5, 0.2, -10.7], [6.5, DECK_Y + 2.6, 3.1]),
      dir: window.innerWidth / window.innerHeight < 1 ? new THREE.Vector3(0, 9, 5.5) : new THREE.Vector3(0, 7.2, 7.4),
      fov: 46,
      insets: { top: 92 },
    }));

    const st: State = {
      ctx, root, env,
      lanes: [], human: null, phases: [],
      step: 0, simTime: 0, presT: 0,
      closing: false, closedAt: 0, resultAt: -1, finished: false, winds: false,
      events: [], shots: [], puffs: [], rings: [], popups: [],
      mats: new Map(), toons: new Map(),
      popupTex: { 1: makePopupTexture("+1", palette.cream), 3: makePopupTexture("+3", palette.mint), 5: makePopupTexture("+5", palette.sun) },
      faceTex: makeFaceTexture(),
      geos: [],
      acornBody: new THREE.MeshToonMaterial({ color: hex(palette.cliffDirt), gradientMap: celGradient }),
      acornCap: new THREE.MeshToonMaterial({ color: hex(palette.cliffDirtDark), gradientMap: celGradient }),
      outlineMat: new THREE.MeshBasicMaterial({ color: hex(palette.ink), side: THREE.BackSide }),
      shadowMat: new THREE.MeshBasicMaterial({ color: hex(palette.ink), transparent: true, opacity: 0.3, depthWrite: false }),
      log: [],
    };
    // geos[0..2] are the shared puff, ring and shadow shapes.
    geo(st, new THREE.SphereGeometry(0.07, 6, 5));
    geo(st, new THREE.RingGeometry(0.8, 1, 32));
    geo(st, new THREE.CircleGeometry(0.2, 14));
    round = st;

    // Every draw below happens once, here, in a fixed order.
    st.phases = TARGETS.map(() => ctx.rng() * Math.PI * 2);
    const localId = isAutoplay() ? -1 : (ctx.players.find((p) => isLocalPlayer(ctx.players, p.id))?.id ?? -1);
    const automated = new Set(automatedSeatIds(ctx.players, isAutoplay()));
    ctx.players.forEach((p, i) => {
      const coin = ctx.rng();
      const stagger = 0.1 + ctx.rng() * 0.9;
      const lane: Lane = {
        idx: i, id: p.id, name: p.name, color: p.color, x: laneInfos[i].x,
        cpu: p.id !== localId || automated.has(p.id),
        aim: 0, aimStick: 0, aimKey: 0, holding: false, holdT: 0, queued: null, reloadUntil: 0,
        plan: null, planAimFrom: 0, lastRelease: stagger - CPU_PERIOD * 0.5,
        coin, points: 0, fives: 0, threes: 0, ones: 0, shots: 0, hits: 0,
        pull: 0, recoil: 0,
        sling: new THREE.Group(), bands: [null as unknown as THREE.Mesh, null as unknown as THREE.Mesh],
        pouch: new THREE.Group(), loadedAcorn: new THREE.Group(), tips: [],
        targets: [], reticle: null, reticleRing: null, aimDots: [],
        char: ctx.characters[p.id] ?? null, celebrateUntil: 0, leanBase: 0,
      };
      buildSling(st, lane);
      buildTargets(st, lane);
      if (!lane.cpu) {
        buildAimAids(st, lane);
        st.human = lane;
      }
      const ch = lane.char;
      if (ch) {
        ch.group.position.set(lane.x, DECK_Y, CHAR_Z);
        ch.group.rotation.x = 0;
        ch.group.scale.setScalar(CHAR_SCALE);
        ch.setFacing(Math.PI);
        ch.anim.idle();
      }
      st.lanes.push(lane);
    });

    ctx.hud.unit("pts");
    for (const lane of st.lanes) ctx.hud.score(lane.id, 0);
    ctx.hud.timer(ROUND_SECONDS, ROUND_SECONDS);

    // ---- input: a pull on the hold pad, the stick or arrows to aim ----
    ctx.input.hold = (down, heldSec) => {
      if (isPracticeBeat() || !st.human || st.closing) return;
      st.events.push({ down, held: heldSec });
    };
    ctx.input.stick = (x) => {
      const human = st.human;
      if (!human) return;
      // The phone stick also sends left/right key() calls every frame it is pushed. Those are
      // not arrow presses: once the stick is live it owns the aim, and the key fallback resets.
      human.aimKey = 0;
      const m = Math.abs(x);
      human.aimStick = m < STICK_DEAD ? 0 : Math.sign(x) * Math.min(1, (m - STICK_DEAD) / (1 - STICK_DEAD));
    };
    ctx.input.key = (action) => {
      const human = st.human;
      if (!human) return;
      if (action === "left") human.aimKey = Math.max(-1, human.aimKey - KEY_STEP);
      else if (action === "right") human.aimKey = Math.min(1, human.aimKey + KEY_STEP);
    };
    ctx.input.pointer = () => {};

    publish(st);
  },

  update(dt: number) {
    const st = round;
    if (!st || isPracticeBeat()) return;
    if (!st.finished) {
      st.simTime += dt;
      let steps = 0;
      while (st.simTime >= FIXED_DT && steps < MAX_STEPS_PER_FRAME) {
        stepFixed(st);
        st.simTime -= FIXED_DT;
        st.step++;
        steps++;
        if (st.resultAt >= 0 && st.step * FIXED_DT >= st.resultAt) {
          st.finished = true;
          for (const lane of st.lanes) {
            if (!lane.char) continue;
            lane.char.group.rotation.x = 0;
            lane.char.group.scale.setScalar(1);
          }
          const order = rankPlayers(st.lanes.map((l) => ({ id: l.id, points: l.points, fives: l.fives, threes: l.threes, coin: l.coin })));
          st.log.push(`finish ${order.join(",")}`);
          st.ctx.finish(order);
          break;
        }
      }
      if (steps >= MAX_STEPS_PER_FRAME && st.simTime >= FIXED_DT) st.simTime = 0;
    }
    for (const lane of st.lanes) st.ctx.hud.score(lane.id, lane.points);
    st.ctx.hud.timer(Math.max(0, ROUND_SECONDS - st.step * FIXED_DT), ROUND_SECONDS);
    updateVisuals(st, dt);
    publish(st);
  },

  teardown() {
    const st = round;
    if (!st) return;
    st.env.dispose();
    for (const lane of st.lanes) {
      if (lane.char) {
        lane.char.group.rotation.x = 0;
        lane.char.group.scale.setScalar(1);
      }
    }
    for (const r of st.rings) r.mat.dispose();
    for (const p of st.popups) p.mat.dispose();
    for (const g of st.geos) g.dispose();
    for (const m of st.mats.values()) m.dispose();
    for (const m of st.toons.values()) m.dispose();
    st.acornBody.dispose();
    st.acornCap.dispose();
    st.shadowMat.dispose();
    st.outlineMat.dispose();
    st.faceTex.dispose();
    for (const tex of Object.values(st.popupTex)) tex.dispose();
    st.root.removeFromParent();
    round = null;
    (window as unknown as { __SLINGSHOT__?: unknown }).__SLINGSHOT__ = undefined;
  },
};

registerMinigame({ id: slingshotSummit.id, name: slingshotSummit.name });

export function loadSlingshotSummit(): Promise<Minigame> {
  return Promise.resolve(slingshotSummit);
}

export default slingshotSummit;
