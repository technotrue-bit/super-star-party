/**
 * CHALK TRAILS — a free-for-all gem hunt on the DRAW control.
 *
 * A sidewalk park after school, chalked into four corner quadrants. Each player owns a
 * snail and the quadrant it sits in. Draw a path with a finger (or the mouse, or Space and
 * the arrows): the snail follows your latest path at a fixed speed and picks up every gem
 * it passes. Every 10 s a rain cloud sweeps across, washes every chalk path away and holds
 * the snails until a new path is drawn. Gems come back after a second. 45 s, most gems wins.
 *
 * Every quadrant reads the same gem stream, mirrored into its own corner, so nobody has a
 * luckier corner. A stroke is clamped into your own quadrant: a finger anywhere draws.
 *
 * CPU seats (and your own seat under autoplay) plan a nearest-gem tour of up to four gems and
 * draw it with cpuDrawPath on a fixed clock (a plan every 2.4 s of every dry stretch), after
 * a reaction time that shrinks with skill. Always 8 rng draws a plan, at every skill.
 *
 * Determinism: the game runs in fixed 1/60 s steps. The human's pen events are turned into
 * ground points when they arrive and applied at the start of the next step; the CPU and the
 * rules are functions of the step clock and ctx.rng. Presentation (snail wiggle, gem spin,
 * chalk, rain, particles) never feeds back into the sim. The camera never moves. Telemetry:
 * window.__CHALKTRAILS__ (one object, updated in place).
 */
import * as THREE from "three";
import { automatedSeatIds, cpuSkill, isLocalPlayer, isPracticeBeat, type Minigame, type MinigameContext } from "../framework";
import { registerMinigame } from "../registry";
import { box as frameBox, frameMinigame } from "../framing";
import { palette, hex } from "../../config/palette";
import { isAutoplay } from "../../core/debug";
import type { Character } from "../../characters/characterFactory";
import {
  GEM_COLORS,
  buildGem,
  buildSnail,
  createChalkLayer,
  createFx,
  createKit,
  seatColors,
  type ChalkLayer,
  type Fx,
  type GemView,
  type Kit,
  type SnailView,
} from "./art";
import { SLAB_HALF_D, SLAB_HALF_W, STAND_X, STAND_Z, buildPark, cloudX, rainPhase, type ParkEnvironment } from "./environment";
import { mountChalkHud, type ChalkHud, type HintMode } from "./hud";
import {
  GEMS_ACTIVE,
  ROUND_SECONDS,
  cpuStep,
  makeCoins,
  makeSpawnTemplate,
  newCpuBrain,
  newWorld,
  penDown,
  pathLeft,
  penMove,
  rainIn,
  raining,
  rankSnails,
  roundOver,
  stepWorld,
  type CpuBrain,
  type Snail,
  type World,
  type WorldEvent,
} from "./rules";

const FIXED_DT = 1 / 60;
const MAX_STEPS_PER_FRAME = 12;

/** The framework force-finishes a round still running at this game time (s). */
const TIME_LIMIT = 58;
/** After the buzzer, the winner cheers this long before the result shows (s). */
const POST_FINISH = 2.4;
/** Size of the players standing at the edge of the park. */
const CHAR_SCALE = 1.15;
/** Pen events waiting for the next step, at most. */
const MAX_QUEUE = 240;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/* ------------------------------------------------------------------ */
/*  State                                                              */
/* ------------------------------------------------------------------ */

type Mood = "idle" | "cheer" | "sad";

interface Seat {
  idx: number;
  id: number;
  name: string;
  color: string;
  cpu: boolean;
  brain: CpuBrain | null;
  char: Character | null;
  view: SnailView;
  gems: GemView[];
  // presentation only
  gemSpawn: number[];
  heading: number;
  wiggle: number;
  cheerT: number;
  mood: Mood;
  shown: number;
}

interface PenEvent {
  phase: "start" | "move" | "end";
  x: number;
  z: number;
}

interface State {
  ctx: MinigameContext;
  root: THREE.Group;
  kit: Kit;
  fx: Fx;
  env: ParkEnvironment;
  chalk: ChalkLayer;
  /** Your prompt; there is none when no human plays (autoplay, spectators). */
  hud: ChalkHud | null;
  world: World;
  seats: Seat[];
  human: Seat | null;
  coins: number[];
  colors: string[];
  nib: THREE.Group;
  queue: PenEvent[];
  /** The human's pen is held down. */
  penOn: boolean;
  /** Where the pen last was on the screen (0..1), for the nib and the telemetry. */
  penScreen: [number, number] | null;
  /** Where the pen is on the ground (not clamped: a keyboard cursor can wander out of your corner). */
  penGround: { x: number; z: number } | null;
  step: number;
  simTime: number;
  presT: number;
  over: boolean;
  overT: number;
  winner: Seat | null;
  ranking: number[] | null;
  finished: boolean;
  chalkAt: number;
  chalkDirty: boolean;
  /** The sweep in progress started at this game time, else -1. */
  washing: number;
  sweepWalked: number;
  timerShown: number;
  tel: Telemetry;
}

interface Telemetry {
  t: number;
  step: number;
  finished: boolean;
  tFinish: number | null;
  winner: number;
  human: number;
  gems: number[];
  walked: number[];
  pathPts: number[];
  pathLeft: number[];
  moving: boolean[];
  x: number[];
  z: number[];
  strokes: number;
  penDown: boolean;
  sweeping: boolean;
  rains: number[];
  erased: number[];
  sweepWalked: number;
  /** Normalized screen points for the human: their snail, the gems standing in their corner, the pen. */
  screen: { snail: [number, number] | null; gems: Array<[number, number]>; pen: [number, number] | null };
  ranking: number[] | null;
  log: string[];
}

let round: State | null = null;

const scratch = new THREE.Vector3();
const ndc = new THREE.Vector3();
const tmpDir = new THREE.Vector3();

function note(st: State, line: string): void {
  const log = st.tel.log;
  log.push(line);
  if (log.length > 12) log.shift();
}

/** The ground point under a screen point (0..1, y down), or null when the ray misses the ground. */
function groundAt(camera: THREE.PerspectiveCamera, nx: number, ny: number): { x: number; z: number } | null {
  camera.updateMatrixWorld();
  ndc.set(nx * 2 - 1, 1 - ny * 2, 0.5).unproject(camera);
  tmpDir.copy(ndc).sub(camera.position);
  if (tmpDir.y >= -1e-6) return null;
  const k = -camera.position.y / tmpDir.y;
  return { x: camera.position.x + tmpDir.x * k, z: camera.position.z + tmpDir.z * k };
}

/** Normalized screen point (0..1, y down) of a ground point lifted by y. */
function screenOf(camera: THREE.PerspectiveCamera, x: number, y: number, z: number, out: [number, number]): [number, number] {
  scratch.set(x, y, z).project(camera);
  out[0] = Math.round(((scratch.x + 1) / 2) * 1e4) / 1e4;
  out[1] = Math.round(((1 - scratch.y) / 2) * 1e4) / 1e4;
  return out;
}

/* ------------------------------------------------------------------ */
/*  The sim                                                            */
/* ------------------------------------------------------------------ */

function applyPen(st: State): void {
  const me = st.human;
  const q = st.queue;
  if (!me) {
    q.length = 0;
    return;
  }
  for (const ev of q) {
    if (ev.phase === "start") {
      st.penOn = true;
      penDown(st.world, me.idx, ev.x, ev.z);
    } else if (ev.phase === "move") {
      if (st.penOn) penMove(st.world, me.idx, ev.x, ev.z);
    } else {
      st.penOn = false;
    }
    st.penGround = { x: ev.x, z: ev.z };
  }
  q.length = 0;
}

function onEvent(st: State, e: WorldEvent, t: number): void {
  const ctx = st.ctx;
  if (e.type === "gem") {
    const seat = st.seats[e.seat];
    const view = seat.gems[e.slot];
    view.root.visible = false;
    const gemColor = GEM_COLORS[e.slot % GEM_COLORS.length];
    st.fx.burst(e.x, e.z, gemColor);
    st.fx.ring(e.x, e.z, seat.color, 0.9);
    st.fx.pop(e.x, e.z);
    seat.cheerT = 0.55;
    if (seat.mood !== "cheer") {
      seat.mood = "cheer";
      seat.char?.anim.cheer();
    }
    if (seat === st.human) ctx.playSfx("coin.gain", { volume: 0.5, rate: 1.1 });
  } else if (e.type === "respawn") {
    const seat = st.seats[e.seat];
    const view = seat.gems[e.slot];
    view.root.position.set(e.x, 0, e.z);
    view.root.visible = true;
    seat.gemSpawn[e.slot] = 0;
  } else if (e.type === "rain") {
    st.chalk.startWash();
    st.washing = e.k;
    st.chalkDirty = false;
    note(st, `rain ${e.k} t=${t.toFixed(2)} erased=${e.erased}`);
    st.tel.rains.push(Math.round(t * 100) / 100);
    st.tel.erased.push(e.erased);
    ctx.playSfx("whoosh", { volume: 0.55, rate: 0.7 });
  } else {
    st.washing = -1;
    st.chalk.clear();
    st.chalkDirty = true;
    note(st, `dry ${e.k} t=${t.toFixed(2)}`);
  }
}

function stepFixed(st: State): void {
  if (st.over) return;
  const w = st.world;
  const skill = cpuSkill();
  applyPen(st);
  for (const seat of st.seats) if (seat.brain) cpuStep(seat.brain, w, seat.idx, skill, st.ctx.rng);

  const before = w.snails.map((s) => s.walked);
  const t = w.t;
  const events = stepWorld(w, FIXED_DT);
  if (raining(w)) w.snails.forEach((s, i) => (st.sweepWalked += s.walked - before[i]));
  for (const e of events) onEvent(st, e, t);
  st.chalkDirty = true;

  if (roundOver(w)) callRound(st);
}

function callRound(st: State): void {
  const ctx = st.ctx;
  st.over = true;
  st.overT = st.world.t;
  const ranking = rankSnails(st.seats.map((s) => ({ id: s.id, gems: st.world.snails[s.idx].gems, lastGemT: st.world.snails[s.idx].lastGemT, coin: st.coins[s.idx] })));
  st.ranking = ranking;
  const win = st.seats.find((s) => s.id === ranking[0]) ?? st.seats[0];
  st.winner = win;
  st.tel.winner = win.id;
  st.tel.ranking = ranking.slice();
  note(st, `time winner ${win.id} gems=${st.world.snails[win.idx].gems}`);
  const mine = st.human === win;
  ctx.announce(mine ? "YOU WIN THE CHALK!" : `${win.name.toUpperCase()} WINS THE CHALK!`, { durationMs: 1900, sound: null });
  ctx.playSfx(mine ? "fanfare.win" : "crowd.cheer", { volume: 0.7 });
  st.env.celebrate();
  const sn = st.world.snails[win.idx];
  st.fx.burst(sn.x, sn.z, palette.sun);
  st.fx.burst(sn.x, sn.z, win.color);
  st.fx.ring(sn.x, sn.z, palette.sun, 1.6);
  for (const seat of st.seats) {
    seat.mood = seat === win ? "cheer" : "sad";
    seat.cheerT = 0;
    if (seat.char) {
      if (seat === win) seat.char.anim.cheer();
      else seat.char.anim.sad();
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Presentation                                                       */
/* ------------------------------------------------------------------ */

const angleLerp = (a: number, b: number, k: number): number => {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return a + d * k;
};

function placeSeat(st: State, seat: Seat, dt: number, t: number): void {
  const sn: Snail = st.world.snails[seat.idx];
  const v = seat.view;
  v.root.position.x += (sn.x - v.root.position.x) * Math.min(1, dt * 40);
  v.root.position.z += (sn.z - v.root.position.z) * Math.min(1, dt * 40);
  seat.heading = angleLerp(seat.heading, sn.heading, Math.min(1, dt * 12));
  v.root.rotation.y = seat.heading;

  // A moving snail rocks and stretches; a resting one breathes, stalks swaying.
  seat.wiggle += dt * (sn.moving ? 9 : 2);
  const w = Math.sin(seat.wiggle);
  v.body.rotation.z = sn.moving ? w * 0.06 : 0;
  v.body.scale.set(1, 1 + (sn.moving ? Math.sin(seat.wiggle * 2) * 0.04 : w * 0.02), 1 + (sn.moving ? w * 0.05 : 0));
  v.stalks.forEach((s, i) => {
    s.rotation.x = (sn.moving ? -0.1 : 0.12) + Math.sin(t * 2.4 + i * 1.7 + seat.idx) * (sn.moving ? 0.08 : 0.16);
    s.rotation.z = Math.sin(t * 1.9 + i * 2.1) * 0.12;
  });
  v.haloMat.opacity = seat === st.human && !st.over ? 0.55 + Math.sin(t * 5) * 0.2 : seat === st.winner ? 0.7 : 0;

  // Gems turn and bob, and pop in when they come back.
  for (let slot = 0; slot < GEMS_ACTIVE; slot++) {
    const gv = seat.gems[slot];
    if (!gv.root.visible) continue;
    seat.gemSpawn[slot] = Math.min(1, seat.gemSpawn[slot] + dt * 4);
    const u = seat.gemSpawn[slot];
    const pop = u < 1 ? 1 + Math.sin(u * Math.PI) * 0.35 : 1;
    gv.root.scale.setScalar(Math.max(0.05, u) * pop);
    gv.gem.rotation.y = t * 1.8 + slot;
    gv.gem.position.y = 0.7 + Math.sin(t * 2.6 + slot * 1.3) * 0.08;
  }

  // The player at the edge cheers after a pick-up, then settles.
  if (seat.cheerT > 0) {
    seat.cheerT -= dt;
    if (seat.cheerT <= 0 && st.winner === null) {
      seat.mood = "idle";
      seat.char?.anim.idle();
    }
  }
}

function updateVisuals(st: State, dt: number): void {
  st.presT += dt;
  const t = st.presT;
  const w = st.world;
  for (const seat of st.seats) placeSeat(st, seat, dt, t);
  st.env.update(t, dt, w.t);
  st.fx.update(dt);

  // The chalk: repaint while paths are being walked or drawn, wash it while the rain sweeps.
  const ph = rainPhase(w.t);
  if (st.washing >= 0 && ph) {
    st.chalk.wash(cloudX(ph.s) + 1.6);
  } else if (st.chalkDirty && t - st.chalkAt > 0.09) {
    st.chalkAt = t;
    st.chalkDirty = false;
    st.chalk.paint(w.snails, st.colors);
  }

  // The nib at the end of your chalk while the pen is down.
  const me = st.human;
  st.nib.visible = !!me && st.penOn && !!st.penGround && !st.over;
  if (st.nib.visible && st.penGround) {
    st.nib.position.set(clamp(st.penGround.x, -SLAB_HALF_W, SLAB_HALF_W), 0.06, clamp(st.penGround.z, -SLAB_HALF_D, SLAB_HALF_D));
    st.nib.rotation.y = t * 2;
  }

  // HUD: scores, the clock, your prompt.
  for (const seat of st.seats) {
    const g = w.snails[seat.idx].gems;
    if (g !== seat.shown) {
      seat.shown = g;
      st.ctx.hud.score(seat.id, g);
    }
  }
  const left = Math.max(0, Math.ceil(ROUND_SECONDS - w.t - 1e-6));
  if (left !== st.timerShown) {
    st.timerShown = left;
    st.ctx.hud.timer(left, ROUND_SECONDS);
  }
  if (me) {
    const sn = w.snails[me.idx];
    const next = rainIn(w.t);
    const mode: HintMode = st.over ? "dry" : raining(w) ? "rain" : sn.next >= sn.path.length ? "draw" : next <= 3 ? "soon" : "ok";
    st.hud?.update(mode, next);
  }
}

/** Write the telemetry object in place (no allocation beyond the screen points). */
function publish(st: State): void {
  const tel = st.tel;
  const w = st.world;
  tel.t = Math.round(w.t * 1e4) / 1e4;
  tel.step = st.step;
  tel.finished = st.finished;
  tel.tFinish = st.over ? st.overT + POST_FINISH : null;
  tel.strokes = st.human ? w.snails[st.human.idx].strokes : 0;
  tel.penDown = st.penOn;
  tel.sweeping = raining(w);
  tel.sweepWalked = Math.round(st.sweepWalked * 1e6) / 1e6;
  for (const seat of st.seats) {
    const sn = w.snails[seat.idx];
    const i = seat.id;
    tel.gems[i] = sn.gems;
    tel.walked[i] = Math.round(sn.walked * 1e4) / 1e4;
    tel.pathPts[i] = sn.path.length;
    tel.pathLeft[i] = Math.round(pathLeft(sn) * 1e3) / 1e3;
    tel.moving[i] = sn.moving;
    tel.x[i] = Math.round(sn.x * 1e3) / 1e3;
    tel.z[i] = Math.round(sn.z * 1e3) / 1e3;
  }
  const me = st.human;
  if (me) {
    const cam = st.ctx.camera;
    const sn = w.snails[me.idx];
    const sc = tel.screen;
    sc.snail = screenOf(cam, sn.x, 0.4, sn.z, sc.snail ?? [0, 0]);
    sc.gems.length = 0;
    for (const g of w.gems[me.idx]) if (g.alive) sc.gems.push(screenOf(cam, g.x, 0.5, g.z, [0, 0]));
    sc.pen = st.penScreen && st.penOn ? [st.penScreen[0], st.penScreen[1]] : null;
  }
}

/* ------------------------------------------------------------------ */
/*  Minigame                                                           */
/* ------------------------------------------------------------------ */

const chalkTrails: Minigame = {
  id: "chalk_trails",
  name: "Chalk Trails",
  genre: "collect",
  pad: "draw",
  timeLimit: TIME_LIMIT,
  howTo: "Draw a path with your finger. Your snail follows it to the gems.",
  goal: "Collect the most gems before the rain.",
  tap: null,
  steer: false,
  rules: {
    format: "ffa",
    length: "45 seconds",
    win: "Collect the most gems; every 10 seconds rain washes all the chalk away",
    touch: ["Drag a finger to draw a chalk path: your snail follows it and picks up gems", "Draw again after each rain, the snails wait for you"],
    keys: ["Mouse: drag to draw", "Space (hold) + arrows: draw with a cursor that starts where you last stopped"],
  },

  setup(ctx: MinigameContext) {
    const root = new THREE.Group();
    root.name = "chalk_trails:root";
    ctx.scene.add(root);
    const kit = createKit();
    const fx = createFx(kit, root);
    const colors = seatColors(ctx.players);
    const env = buildPark(ctx.scene, root, kit, colors);
    const chalk = createChalkLayer(root);

    // The spawn stream and the heat-breaking coins, drawn first and in a fixed order.
    const template = makeSpawnTemplate(ctx.rng);
    const coins = makeCoins(ctx.rng, ctx.players.length);
    const world = newWorld(template, ctx.players.length);

    const humanInfo = isAutoplay() ? undefined : ctx.players.find((p) => isLocalPlayer(ctx.players, p.id));
    const localId = humanInfo ? humanInfo.id : -1;
    const automated = new Set(automatedSeatIds(ctx.players, isAutoplay()));

    const seats: Seat[] = ctx.players.map((info, idx) => {
      const cpu = automated.has(info.id) || info.id !== localId;
      const color = colors[idx];
      const sn = world.snails[idx];
      const view = buildSnail(kit, color);
      view.root.position.set(sn.x, 0, sn.z);
      root.add(view.root);
      const gems = world.gems[idx].map((g, slot) => {
        const gv = buildGem(kit, slot);
        gv.root.position.set(g.x, 0, g.z);
        root.add(gv.root);
        return gv;
      });
      const ch = ctx.characters[info.id] ?? null;
      if (ch) {
        ch.group.scale.setScalar(CHAR_SCALE);
        ch.group.position.set(sn.q.sx * STAND_X, 0, sn.q.sz * STAND_Z);
        ch.group.rotation.set(0, 0, 0);
        ch.setFacing(0);
        ch.anim.idle();
      }
      return {
        idx,
        id: info.id,
        name: info.name,
        color,
        cpu,
        brain: cpu ? newCpuBrain() : null,
        char: ch,
        view,
        gems,
        gemSpawn: gems.map(() => 1),
        heading: 0,
        wiggle: idx * 1.3,
        cheerT: 0,
        mood: "idle",
        shown: -1,
      } satisfies Seat;
    });
    const human = seats.find((s) => !s.cpu) ?? null;

    // The nib: a ring and a stick of chalk where your pen is.
    const nib = new THREE.Group();
    const nibRing = new THREE.Mesh(kit.geo(new THREE.RingGeometry(0.26, 0.4, 20)), kit.mat(new THREE.MeshBasicMaterial({ color: hex(human?.color ?? palette.sun), side: THREE.DoubleSide, transparent: true, opacity: 0.9, depthWrite: false })));
    nibRing.rotation.x = -Math.PI / 2;
    const nibStick = new THREE.Mesh(kit.geo(new THREE.CylinderGeometry(0.07, 0.07, 0.8, 8)), kit.toon(palette.white));
    nibStick.position.set(0.18, 0.4, 0.18);
    nibStick.rotation.set(0.35, 0, -0.35);
    nib.add(nibRing, nibStick);
    nib.visible = false;
    root.add(nib);

    // The camera: the whole park, framed once. It never moves.
    frameMinigame(ctx.camera, () => ({
      box: frameBox([-SLAB_HALF_W, 0, -SLAB_HALF_D - 0.3], [SLAB_HALF_W, 2.3, SLAB_HALF_D + 0.3]),
      dir: window.innerWidth / window.innerHeight < 1 ? new THREE.Vector3(0, 12, 2.6) : new THREE.Vector3(0, 12, 4),
      fov: 46,
      // Room for the prompt under the park.
      insets: { top: 84, bottom: window.innerWidth / window.innerHeight < 1 ? 78 : 100 },
    }));

    const hud = human ? mountChalkHud() : null;
    const maxId = Math.max(...ctx.players.map((p) => p.id), 3) + 1;
    const arr = (): number[] => new Array<number>(maxId).fill(0);
    const tel: Telemetry = {
      t: 0, step: 0, finished: false, tFinish: null, winner: -1, human: localId,
      gems: arr(), walked: arr(), pathPts: arr(), pathLeft: arr(), moving: new Array<boolean>(maxId).fill(false), x: arr(), z: arr(),
      strokes: 0, penDown: false, sweeping: false, rains: [], erased: [], sweepWalked: 0,
      screen: { snail: null, gems: [], pen: null },
      ranking: null, log: [],
    };
    const st: State = {
      ctx, root, kit, fx, env, chalk, hud, world, seats, human, coins, colors, nib,
      queue: [], penOn: false, penScreen: null, penGround: null,
      step: 0, simTime: 0, presT: 0,
      over: false, overT: 0, winner: null, ranking: null, finished: false,
      chalkAt: -1, chalkDirty: false, washing: -1, sweepWalked: 0, timerShown: -1,
      tel,
    };
    round = st;
    (window as unknown as { __CHALKTRAILS__?: Telemetry }).__CHALKTRAILS__ = tel;

    ctx.hud.unit("gems");
    for (const s of seats) ctx.hud.score(s.id, 0);
    ctx.hud.timer(null);

    // ---- input: the pen. Screen points become ground points now; the sim takes them next step. ----
    ctx.input.draw = (phase, nx, ny) => {
      if (!st.human || st.over || isPracticeBeat()) return;
      if (!Number.isFinite(nx) || !Number.isFinite(ny)) return;
      const g = groundAt(ctx.camera, nx, ny);
      if (!g) return;
      st.penScreen = [nx, ny];
      if (st.queue.length < MAX_QUEUE || phase !== "move") st.queue.push({ phase, x: g.x, z: g.z });
    };
    ctx.input.pointer = () => {};
    ctx.input.key = () => {};

    for (const s of seats) placeSeat(st, s, 1 / 60, 0);
    st.hud?.update("draw", 10);
    publish(st);
  },

  update(dt: number) {
    const st = round;
    if (!st) return;
    // Practice: the park stands still; the sim, the clock and the rng wait.
    if (isPracticeBeat()) {
      st.queue.length = 0;
      st.penOn = false;
    }
    if (!isPracticeBeat() && !st.finished) {
      st.simTime += dt;
      let steps = 0;
      while (st.simTime >= FIXED_DT && steps < MAX_STEPS_PER_FRAME) {
        stepFixed(st);
        st.simTime -= FIXED_DT;
        st.step++;
        steps++;
        if (st.over && st.ranking && st.step * FIXED_DT >= st.overT + POST_FINISH) {
          st.finished = true;
          for (const s of st.seats) {
            if (!s.char) continue;
            s.char.group.rotation.set(0, 0, 0);
            s.char.group.scale.setScalar(1);
          }
          note(st, `finish ${st.ranking.join(",")}`);
          st.ctx.finish(st.ranking);
          break;
        }
      }
      if (steps >= MAX_STEPS_PER_FRAME && st.simTime >= FIXED_DT) st.simTime = 0;
    }
    if (!st.finished) updateVisuals(st, dt);
    publish(st);
  },

  teardown() {
    const st = round;
    if (!st) return;
    st.hud?.destroy();
    st.env.dispose();
    st.fx.dispose();
    st.chalk.dispose();
    for (const s of st.seats) {
      if (!s.char) continue;
      s.char.group.rotation.set(0, 0, 0);
      s.char.group.scale.setScalar(1);
    }
    st.kit.dispose();
    st.root.removeFromParent();
    round = null;
    (window as unknown as { __CHALKTRAILS__?: unknown }).__CHALKTRAILS__ = undefined;
  },
};

registerMinigame({ id: chalkTrails.id, name: chalkTrails.name });

export function loadChalkTrails(): Promise<Minigame> {
  return Promise.resolve(chalkTrails);
}

export default chalkTrails;
