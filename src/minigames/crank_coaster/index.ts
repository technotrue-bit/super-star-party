/**
 * CRANK COASTER — a free-for-all lift-hill race on the DIAL control.
 *
 * Four carts sit at the foot of four steep chain lifts in an abandoned gold mine.
 * Each seat has a crank: turn the wheel CLOCKWISE and your cart climbs the chain, a
 * straight line from the bottom to the summit hoop over 62 turns. Turn back and the
 * pawl just clicks. Crank faster than 2.2 turns a second and the crank heats up (the
 * thermometer by every winch); at full heat the chain JAMS for 1.5 s. The first cart
 * through the golden hoop wins; at 50 s the highest cart wins.
 *
 * CPU seats (and your own seat under autoplay) crank in stretches of 0.6 s at
 * cpuDialRate (about 1.5 turns/s at Normal, 1.3 Relaxed, 1.75 Challenge: all under the
 * heat line, and Normal is the keyboard dial's own pace), now and then greedy, and ease
 * off once the gauge has been past 80% for a moment. Always 3 rng draws a stretch, at every skill.
 *
 * Determinism: the game runs in fixed 1/60 s steps with an integer step index. The
 * human's turn since the last frame is split evenly over the steps that frame runs;
 * the CPU and the rules are functions of the step clock and ctx.rng. Presentation
 * (wheels, chain scroll, steam, sparks, popups, the cart bob) never feeds back into the
 * sim. The camera never moves. Telemetry: window.__CRANKCOASTER__ (one object, updated
 * in place).
 */
import * as THREE from "three";
import { automatedSeatIds, cpuSkill, isLocalPlayer, isPracticeBeat, type Minigame, type MinigameContext } from "../framework";
import { registerMinigame } from "../registry";
import { box as frameBox, frameMinigame } from "../framing";
import { palette, hex } from "../../config/palette";
import { isAutoplay } from "../../core/debug";
import type { Character } from "../../characters/characterFactory";
import {
  CART_HANG,
  buildCart,
  buildChainStrip,
  buildHoop,
  buildRailGeometry,
  buildSleeperGeometry,
  buildTrestleGeometry,
  buildWinch,
  createFx,
  createKit,
  makeGlowTexture,
  makeWordTexture,
  type CartView,
  type Fx,
  type HoopView,
  type Kit,
  type WinchView,
} from "./art";
import { buildMine, type MineEnvironment } from "./environment";
import { mountCrankHud, type CrankHud } from "./hud";
import { BASE, HILL_ANGLE, HILL_LEN, TOP, TRACK_TILT, WINCH, laneX, trackAt } from "./layout";
import {
  TIME_CAP,
  TURN,
  atTop,
  climbOf,
  cpuCrank,
  heatBand,
  makeCoins,
  newCart,
  newCpuBrain,
  rankCarts,
  stepCart,
  turnsPerSec,
  type Cart,
  type CpuBrain,
} from "./rules";

const FIXED_DT = 1 / 60;
const MAX_STEPS_PER_FRAME = 12;

/** The framework force-finishes a round still running at this game time (s). */
const TIME_LIMIT = 58;
/** After the call, the winner cheers this long before the result shows (s). */
const POST_FINISH = 2.6;
/** Size of the riders in the carts. */
const CHAR_SCALE = 1.04;
/** The cart body is drawn this much bigger than its truck. */
const BODY_SCALE = 1.2;
/** No hand turns a wheel faster than this (turns per second): a glitch cannot jam you in one step. */
const HUMAN_MAX_TURNS = 6;
/** The most turn that may wait to be taken by the sim (rad), so a stall cannot bank a spin. */
const MAX_PENDING = 2 * TURN;
/** Half a turn of the crank is one click of the pawl. */
const CLICK_ANGLE = Math.PI;

const HEX_LAVA = hex(palette.lava);
const HEX_SUN_DEEP = hex(palette.sunDeep);
const HEX_INK_SOFT = hex(palette.inkSoft);

const COLOR_OF_HEAT = {
  cool: new THREE.Color(hex(palette.bubble)),
  warm: new THREE.Color(hex(palette.sun)),
  hot: new THREE.Color(hex(palette.lava)),
  white: new THREE.Color(hex(palette.cream)),
};

/* ------------------------------------------------------------------ */
/*  State                                                              */
/* ------------------------------------------------------------------ */

type Mood = "idle" | "push" | "cheer" | "sad";

interface Lane {
  idx: number;
  id: number;
  name: string;
  color: string;
  x: number;
  cpu: boolean;
  cart: Cart;
  brain: CpuBrain | null;
  coin: number;
  char: Character | null;
  view: CartView;
  winch: WinchView;
  tilt: THREE.Group;
  chainTex: THREE.Texture;
  hoop: HoopView;
  jamTag: THREE.Sprite;
  jamMat: THREE.SpriteMaterial;
  // presentation only
  climb: number;
  wheelAng: number;
  spin: number;
  jolt: number;
  steamT: number;
  jamPop: number;
  hoopFlash: number;
  mood: Mood;
  lastBand: number;
  clickAt: number;
  bob: number;
}

interface State {
  ctx: MinigameContext;
  root: THREE.Group;
  kit: Kit;
  fx: Fx;
  env: MineEnvironment;
  hud: CrankHud;
  lanes: Lane[];
  human: Lane | null;
  instanced: THREE.InstancedMesh[];
  /** The human's turn since the last sim step that has not been taken yet (rad). */
  pending: number;
  /** Turn made during the practice beat: spins the wheel only. */
  spinPending: number;
  step: number;
  simTime: number;
  presT: number;
  over: boolean;
  overT: number;
  topped: boolean;
  winner: Lane | null;
  ranking: number[] | null;
  finished: boolean;
  dials: number;
  tel: Telemetry;
  scoreShown: number[];
  timerShown: number;
}

interface Telemetry {
  t: number;
  step: number;
  finished: boolean;
  tFinish: number | null;
  winner: number;
  topped: boolean;
  human: number;
  dials: number;
  angle: number[];
  turns: number[];
  heat: number[];
  jam: number[];
  jams: number[];
  peak: number[];
  back: number[];
  wasted: number[];
  rate: number[];
  pace: number[];
  ranking: number[] | null;
  log: string[];
}

let round: State | null = null;

const scratch = new THREE.Vector3();
const tmpColor = new THREE.Color();

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const smooth = (u: number): number => {
  const c = clamp(u, 0, 1);
  return c * c * (3 - 2 * c);
};

function note(st: State, line: string): void {
  const log = st.tel.log;
  log.push(line);
  if (log.length > 12) log.shift();
}

/* ------------------------------------------------------------------ */
/*  The sim                                                            */
/* ------------------------------------------------------------------ */

function onJam(st: State, lane: Lane): void {
  lane.jolt = 1;
  lane.jamPop = 1.3;
  lane.mood = "idle";
  const w = lane.winch;
  scratch.copy(w.wheelAt);
  w.root.localToWorld(scratch);
  st.fx.sparks(scratch.x, scratch.y + 0.2, scratch.z + 0.4, 16);
  st.fx.soot(scratch.x + 0.9, scratch.y + 1.2, scratch.z, 4);
  lane.char?.anim.squash();
  note(st, `jam lane ${lane.idx} t=${(st.step * FIXED_DT).toFixed(2)}`);
  if (lane === st.human) {
    st.ctx.playSfx("land", { volume: 0.75, pitch: 0.6 });
    st.ctx.playSfx("crowd.ooh", { volume: 0.45 });
  }
}

function onFree(st: State, lane: Lane): void {
  const w = lane.winch;
  scratch.copy(w.wheelAt);
  w.root.localToWorld(scratch);
  st.fx.sparks(scratch.x, scratch.y + 0.6, scratch.z + 0.4, 8);
  st.fx.ring(scratch.x, scratch.y, scratch.z + 0.5, 0.9, palette.mint);
  if (lane === st.human) st.ctx.playSfx("pop", { volume: 0.5, pitch: 1.2 });
}

function stepFixed(st: State, humanShare: number): void {
  const t = st.step * FIXED_DT;
  const skill = cpuSkill();
  if (st.over) return;

  for (const lane of st.lanes) {
    const delta = lane.brain ? cpuCrank(lane.brain, lane.cart, t, skill, st.ctx.rng) * FIXED_DT : lane === st.human ? humanShare : 0;
    const ev = stepCart(lane.cart, delta, FIXED_DT);
    if (ev === "jam") onJam(st, lane);
    else if (ev === "free") onFree(st, lane);
  }

  // The call: the first cart through the hoop, or the highest cart at the cap.
  const tops = st.lanes.some((l) => atTop(l.cart));
  if (tops) callRace(st, t, false);
  else if (t + FIXED_DT >= TIME_CAP) callRace(st, t + FIXED_DT, true);
}

function callRace(st: State, t: number, timeUp: boolean): void {
  const ctx = st.ctx;
  st.over = true;
  st.overT = t;
  st.topped = !timeUp;
  const ranking = rankCarts(st.lanes.map((l) => ({ id: l.id, angle: l.cart.angle, jams: l.cart.jams, coin: l.coin })));
  st.ranking = ranking;
  const win = st.lanes.find((l) => l.id === ranking[0]) ?? st.lanes[0];
  st.winner = win;
  st.tel.winner = win.id;
  st.tel.topped = st.topped;
  st.tel.ranking = ranking.slice();
  note(st, `${timeUp ? "time" : "top"} winner ${win.id} t=${t.toFixed(2)}`);
  const mine = st.human === win;
  ctx.announce(timeUp ? "TIME!" : mine ? "YOU TOPPED THE HILL!" : `${win.name.toUpperCase()} TOPS THE HILL!`, { durationMs: 1900, sound: null });
  ctx.playSfx(mine ? "fanfare.win" : "crowd.cheer", { volume: 0.7 });
  ctx.playSfx("coin.gain", { volume: 0.5, pitch: 1.1 });
  st.env.celebrate();
  win.hoopFlash = 1;
  scratch.set(win.x, TOP.y + 1.2, TOP.z + 0.8);
  st.fx.nuggets(scratch.x, scratch.y, scratch.z, 44);
  st.fx.ring(scratch.x, scratch.y, scratch.z, 1.4, palette.sun);
  for (const lane of st.lanes) {
    lane.mood = lane === win ? "cheer" : "sad";
    if (lane.char) {
      if (lane === win) lane.char.anim.cheer();
      else lane.char.anim.sad();
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Presentation                                                       */
/* ------------------------------------------------------------------ */

function setMood(lane: Lane, mood: Mood): void {
  if (lane.mood === mood) return;
  lane.mood = mood;
  const a = lane.char?.anim;
  if (!a) return;
  if (mood === "push") a.walk();
  else if (mood === "idle") a.idle();
  else if (mood === "cheer") a.cheer();
  else a.sad();
}

function placeLane(st: State, lane: Lane, dt: number, t: number): void {
  const c = lane.cart;
  const u = climbOf(c.angle);
  lane.climb += (u - lane.climb) * Math.min(1, dt * 20);
  const s = lane.climb * HILL_LEN;
  const p = trackAt(s);
  const cosA = Math.cos(HILL_ANGLE);
  const sinA = Math.sin(HILL_ANGLE);

  // The truck rides the rails; the level body hangs from it.
  lane.view.bogie.position.set(0, s, 0.1);
  for (const w of lane.view.wheels) w.rotation.x = -s * 6;
  lane.chainTex.offset.y = -s / 0.8;

  lane.jolt = Math.max(0, lane.jolt - dt * 1.6);
  lane.bob += dt * (3 + turnsPerSec(c.rate) * 2.4);
  const climbing = c.jam <= 0 && c.rate > 1 && !st.over;
  const bobY = climbing ? Math.sin(lane.bob * 2) * 0.03 : 0;
  const body = lane.view.body;
  const jolt = Math.sin(t * 52 + lane.idx) * lane.jolt * 0.06;
  body.position.set(lane.x + jolt, p.y + 0.1 * cosA + CART_HANG.y * BODY_SCALE + bobY, p.z + 0.1 * sinA + CART_HANG.z * BODY_SCALE);
  body.rotation.z = Math.sin(t * 46 + lane.idx) * lane.jolt * 0.05 + (climbing ? Math.sin(lane.bob) * 0.012 : 0);

  const ch = lane.char;
  if (ch) {
    ch.group.position.set(body.position.x, body.position.y + lane.view.seat.y * BODY_SCALE, body.position.z + lane.view.seat.z * BODY_SCALE);
    ch.group.rotation.z = body.rotation.z;
    if (st.winner === null) setMood(lane, climbing ? "push" : "idle");
  }

  // The wheel turns with the crank (clockwise on screen is negative about +Z).
  const wheelGoal = c.angle + lane.spin;
  lane.wheelAng += (wheelGoal - lane.wheelAng) * Math.min(1, dt * 28);
  lane.winch.wheel.rotation.z = -lane.wheelAng;

  // The thermometer, its warning lamp and the glow behind the wheel.
  const w = lane.winch;
  const band = heatBand(c);
  const h = c.heat;
  w.liquid.scale.y = Math.max(0.04, h);
  const warm = smooth((h - 0.38) / 0.2);
  const hot = smooth((h - 0.68) / 0.18);
  tmpColor.copy(COLOR_OF_HEAT.cool).lerp(COLOR_OF_HEAT.warm, warm).lerp(COLOR_OF_HEAT.hot, hot);
  if (band === 3 && Math.sin(t * 24) > 0) tmpColor.lerp(COLOR_OF_HEAT.white, 0.55);
  w.liquidMat.color.copy(tmpColor);
  const blink = band === 3 ? Math.sin(t * 26) > 0 : band === 2 ? Math.sin(t * 12) > 0 : false;
  w.lampMat.color.setHex(blink ? HEX_LAVA : band >= 2 ? HEX_SUN_DEEP : HEX_INK_SOFT);
  w.haloMat.opacity = band === 3 ? 0.5 + Math.sin(t * 22) * 0.2 : smooth((h - 0.5) / 0.4) * 0.55;
  w.halo.scale.setScalar(1 + (band === 3 ? 0.1 : 0));

  // Steam off the crank when it runs hot, soot when it is seized.
  lane.steamT -= dt;
  if (band >= 2 && lane.steamT <= 0) {
    lane.steamT = band === 3 ? 0.12 : 0.1;
    scratch.copy(w.lampAt);
    w.root.localToWorld(scratch);
    st.fx.steam(scratch.x, scratch.y + 0.2, scratch.z, 0.26 + (band === 3 ? 0.1 : 0));
    if (band === 3) st.fx.soot(scratch.x, scratch.y, scratch.z, 1);
  }
  if (band !== lane.lastBand) {
    if (lane === st.human && band === 2 && lane.lastBand < 2) st.ctx.playSfx("whistle", { volume: 0.3, pitch: 1.4 });
    lane.lastBand = band;
  }

  // The "JAM!" tag pops over the winch and fades.
  lane.jamPop = Math.max(0, lane.jamPop - dt);
  if (lane.jamPop > 0) {
    const k = lane.jamPop / 1.3;
    lane.jamTag.visible = true;
    lane.jamMat.opacity = Math.min(1, k * 2.6);
    const pop = 1 + Math.max(0, k - 0.85) * 5;
    lane.jamTag.scale.set(2.4 * pop, 1.4 * pop, 1);
    lane.jamTag.position.set(lane.x, WINCH.y + 2.9 + (1 - k) * 0.6, WINCH.z + 0.3);
  } else {
    lane.jamTag.visible = false;
  }

  // The summit hoop flashes for whoever topped it.
  lane.hoopFlash = Math.max(0, lane.hoopFlash - dt * 0.8);
  lane.hoop.mat.emissiveIntensity = 0.25 + lane.hoopFlash * 1.2 + (st.winner === lane ? Math.sin(t * 9) * 0.2 + 0.2 : 0);
  lane.hoop.ring.rotation.z = t * 0.5 * (st.winner === lane ? 3 : 1);
}

function updateVisuals(st: State, dt: number): void {
  st.presT += dt;
  const t = st.presT;
  for (const lane of st.lanes) placeLane(st, lane, dt, t);
  st.env.update(t, dt);
  st.fx.update(dt);

  // The pawl clicks twice a turn under your own hand.
  const me = st.human;
  if (me && !st.over && !isPracticeBeat()) {
    const a = me.cart.angle;
    if (a - me.clickAt >= CLICK_ANGLE) {
      me.clickAt = a;
      st.ctx.playSfx("ui.click", { volume: 0.16, pitch: 0.9 + clamp(turnsPerSec(me.cart.rate) / 3, 0, 1) * 0.5 });
    }
    me.clickAt = Math.max(me.clickAt, a - 2 * CLICK_ANGLE);
  }

  // HUD: your gauge, the scoreboard (only when a number changes) and the clock.
  if (me) st.hud.update(me.cart.heat, heatBand(me.cart), turnsPerSec(me.cart.rate), me.cart.jam, climbOf(me.cart.angle));
  for (const lane of st.lanes) {
    const pct = Math.floor(climbOf(lane.cart.angle) * 100);
    if (pct !== st.scoreShown[lane.idx]) {
      st.scoreShown[lane.idx] = pct;
      st.ctx.hud.score(lane.id, `${pct}%`);
    }
  }
  const left = Math.max(0, Math.ceil(TIME_CAP - st.step * FIXED_DT));
  if (left !== st.timerShown) {
    st.timerShown = left;
    st.ctx.hud.timer(left, TIME_CAP);
  }
}

/** Write the telemetry object in place (no allocation). */
function publish(st: State): void {
  const tel = st.tel;
  tel.t = st.step * FIXED_DT;
  tel.step = st.step;
  tel.finished = st.finished;
  tel.tFinish = st.finished ? st.overT + POST_FINISH : null;
  tel.dials = st.dials;
  const span = Math.max(0.1, st.over ? st.overT : st.step * FIXED_DT);
  for (const lane of st.lanes) {
    const c = lane.cart;
    const i = lane.id;
    tel.angle[i] = Math.round(c.angle * 1e4) / 1e4;
    tel.turns[i] = Math.round((c.angle / TURN) * 1e3) / 1e3;
    tel.heat[i] = Math.round(c.heat * 1e4) / 1e4;
    tel.jam[i] = Math.round(c.jam * 1e3) / 1e3;
    tel.jams[i] = c.jams;
    tel.peak[i] = Math.round(c.peak * 1e3) / 1e3;
    tel.back[i] = Math.round(c.back * 1e3) / 1e3;
    tel.wasted[i] = Math.round(c.wasted * 1e3) / 1e3;
    tel.rate[i] = Math.round(turnsPerSec(c.rate) * 1e3) / 1e3;
    tel.pace[i] = Math.round((c.angle / TURN / span) * 1e3) / 1e3;
  }
}

/* ------------------------------------------------------------------ */
/*  Minigame                                                           */
/* ------------------------------------------------------------------ */

const crankCoaster: Minigame = {
  id: "crank_coaster",
  name: "Crank Coaster",
  genre: "race",
  pad: "dial",
  timeLimit: TIME_LIMIT,
  howTo: "Spin the wheel to crank your cart up. Too fast and the chain jams!",
  goal: "First cart to the top.",
  tap: null,
  steer: false,
  rules: {
    format: "ffa",
    length: "About 40 seconds",
    win: "The first cart through the golden hoop wins; at 50 seconds the highest cart does",
    touch: ["Circle your finger round the wheel, clockwise, to haul your cart up", "Turn faster than about 2.2 turns a second and the crank overheats and jams"],
    keys: ["E or Right arrow: crank forward (steady, it never overheats)", "Q or Left arrow: turn back, which does nothing"],
  },

  setup(ctx: MinigameContext) {
    const root = new THREE.Group();
    root.name = "crank_coaster:root";
    ctx.scene.add(root);
    const kit = createKit();
    const fx = createFx(kit, root);
    const glowTex = kit.tex(makeGlowTexture());
    const env = buildMine(ctx.scene, root, kit, glowTex);

    // One coin per seat, drawn first and in a fixed order: it breaks a dead heat.
    const coins = makeCoins(ctx.rng, ctx.players.length);

    const humanInfo = isAutoplay() ? undefined : ctx.players.find((p) => isLocalPlayer(ctx.players, p.id));
    const localId = humanInfo ? humanInfo.id : -1;
    const automated = new Set(automatedSeatIds(ctx.players, isAutoplay()));

    // Shared geometry: one trestle, one rail set, one sleeper, reused by every lane.
    const trestleGeo = kit.geo(buildTrestleGeometry());
    const railGeo = kit.geo(buildRailGeometry());
    const sleeperGeo = kit.geo(buildSleeperGeometry());
    const sleepers = Math.floor(HILL_LEN / 0.7);
    const jamTex = kit.tex(makeWordTexture("JAM!", palette.lava));
    const instanced: THREE.InstancedMesh[] = [];
    const dummy = new THREE.Object3D();

    const lanes: Lane[] = ctx.players.map((info, idx) => {
      const x = laneX(idx);
      const cpu = automated.has(info.id) || info.id !== localId;
      const color = info.color || palette.sun;

      // Trestle, rails, sleepers, chain, truck: the track frame is tilted onto the hill.
      const trestle = new THREE.Mesh(trestleGeo, kit.vertex());
      trestle.position.x = x;
      root.add(trestle);
      const tilt = new THREE.Group();
      tilt.position.set(x, BASE.y, BASE.z);
      tilt.rotation.x = TRACK_TILT;
      root.add(tilt);
      tilt.add(new THREE.Mesh(railGeo, kit.vertex()));
      const sl = new THREE.InstancedMesh(sleeperGeo, kit.toon(palette.woodDark), sleepers);
      for (let i = 0; i < sleepers; i++) {
        dummy.position.set(0, 0.2 + i * 0.7, 0);
        dummy.updateMatrix();
        sl.setMatrixAt(i, dummy.matrix);
      }
      sl.frustumCulled = false;
      tilt.add(sl);
      instanced.push(sl);
      const chain = buildChainStrip(kit);
      tilt.add(chain.mesh);
      const view = buildCart(kit, color);
      tilt.add(view.bogie);
      view.bogie.position.set(0, 0, 0.1);
      view.body.scale.setScalar(BODY_SCALE);
      root.add(view.body);

      // The crank winch and thermometer in front of the foot.
      const winch = buildWinch(kit, color, glowTex);
      winch.root.position.set(x, 0, WINCH.z);
      root.add(winch.root);

      // The summit hoop.
      const hoop = buildHoop(kit);
      hoop.root.position.set(x, TOP.y + 1.5, TOP.z + 0.9);
      hoop.root.scale.setScalar(1.18);
      root.add(hoop.root);

      const jamMat = kit.mat(new THREE.SpriteMaterial({ map: jamTex, transparent: true, depthWrite: false, depthTest: false }));
      const jamTag = new THREE.Sprite(jamMat);
      jamTag.visible = false;
      jamTag.renderOrder = 8;
      root.add(jamTag);

      const ch = ctx.characters[info.id] ?? null;
      if (ch) {
        ch.group.scale.setScalar(CHAR_SCALE);
        ch.setFacing(0);
        ch.anim.idle();
      }
      return {
        idx,
        id: info.id,
        name: info.name,
        color,
        x,
        cpu,
        cart: newCart(),
        brain: cpu ? newCpuBrain() : null,
        coin: coins[idx],
        char: ch,
        view,
        winch,
        tilt,
        chainTex: chain.tex,
        hoop,
        jamTag,
        jamMat,
        climb: 0,
        wheelAng: 0,
        spin: 0,
        jolt: 0,
        steamT: 0,
        jamPop: 0,
        hoopFlash: 0,
        mood: "idle",
        lastBand: 0,
        clickAt: 0,
        bob: idx * 1.7,
      } satisfies Lane;
    });

    // The camera: the whole hill, summit hoops to winches, framed once. It never moves.
    frameMinigame(ctx.camera, () => ({
      box: frameBox([-5.6, 0, -5.4], [5.6, TOP.y + 2.9, 6.2]),
      dir: window.innerWidth / window.innerHeight < 1 ? new THREE.Vector3(0, 3.2, 22) : new THREE.Vector3(0, 2.6, 16),
      fov: 50,
      insets: { top: 84 },
    }));

    const hud = mountCrankHud();
    const maxId = Math.max(...ctx.players.map((p) => p.id), 3) + 1;
    const arr = (): number[] => new Array<number>(maxId).fill(0);
    const tel: Telemetry = {
      t: 0, step: 0, finished: false, tFinish: null, winner: -1, topped: false,
      human: localId, dials: 0,
      angle: arr(), turns: arr(), heat: arr(), jam: arr(), jams: arr(), peak: arr(), back: arr(), wasted: arr(), rate: arr(), pace: arr(),
      ranking: null, log: [],
    };
    const st: State = {
      ctx, root, kit, fx, env, hud, lanes,
      human: lanes.find((l) => !l.cpu) ?? null,
      instanced,
      pending: 0, spinPending: 0,
      step: 0, simTime: 0, presT: 0,
      over: false, overT: 0, topped: false, winner: null, ranking: null, finished: false,
      dials: 0, tel,
      scoreShown: lanes.map(() => -1),
      timerShown: -1,
    };
    round = st;
    (window as unknown as { __CRANKCOASTER__?: Telemetry }).__CRANKCOASTER__ = tel;

    ctx.hud.unit("climbed");
    for (const l of lanes) ctx.hud.score(l.id, "0%");
    ctx.hud.timer(null);

    // ---- input: the dial. A turn since the last call, clockwise positive. ----
    ctx.input.dial = (deltaRad: number) => {
      if (!st.human || !Number.isFinite(deltaRad)) return;
      st.dials++;
      if (isPracticeBeat()) st.spinPending += deltaRad;
      else if (!st.over) st.pending = clamp(st.pending + deltaRad, -MAX_PENDING, MAX_PENDING);
    };
    ctx.input.pointer = () => {};
    ctx.input.key = () => {};

    for (const l of lanes) placeLane(st, l, 1 / 60, 0);
    publish(st);
  },

  update(dt: number) {
    const st = round;
    if (!st) return;
    // Practice: the wheel turns under your hand but the sim, the clock and the rng stand still.
    if (isPracticeBeat()) {
      if (st.human) st.human.spin += st.spinPending;
      st.spinPending = 0;
      st.pending = 0;
    }
    if (!isPracticeBeat() && !st.finished) {
      st.simTime += dt;
      // The turn made since the last frame is split evenly over the steps this frame runs.
      const n = Math.min(MAX_STEPS_PER_FRAME, Math.floor(st.simTime / FIXED_DT));
      // Never faster than a hand can turn: the rest waits for the next frames.
      const cap = HUMAN_MAX_TURNS * TURN * FIXED_DT;
      const share = n > 0 ? clamp(st.pending / n, -cap, cap) : 0;
      st.pending -= share * n;
      let steps = 0;
      while (st.simTime >= FIXED_DT && steps < MAX_STEPS_PER_FRAME) {
        stepFixed(st, share);
        st.simTime -= FIXED_DT;
        st.step++;
        steps++;
        if (st.over && st.ranking && st.step * FIXED_DT >= st.overT + POST_FINISH) {
          st.finished = true;
          for (const l of st.lanes) {
            if (!l.char) continue;
            l.char.group.rotation.set(0, 0, 0);
            l.char.group.scale.setScalar(1);
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
    st.hud.destroy();
    st.env.dispose();
    st.fx.dispose();
    for (const l of st.lanes) {
      if (!l.char) continue;
      l.char.group.rotation.set(0, 0, 0);
      l.char.group.scale.setScalar(1);
    }
    for (const m of st.instanced) m.dispose();
    st.kit.dispose();
    st.root.removeFromParent();
    round = null;
    (window as unknown as { __CRANKCOASTER__?: unknown }).__CRANKCOASTER__ = undefined;
  },
};

registerMinigame({ id: crankCoaster.id, name: crankCoaster.name });

export function loadCrankCoaster(): Promise<Minigame> {
  return Promise.resolve(crankCoaster);
}

export default crankCoaster;
