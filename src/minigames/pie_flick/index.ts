/**
 * PIE FLICK — a free-for-all target minigame on the SWIPE control.
 *
 * Four wedge-shaped diner counters, one per player. At the far end of each,
 * three customers sit on stools, each holding up an order: cherry, blueberry,
 * lemon or key lime. You hold one pie at a time. SWIPE up the counter: the
 * angle of the swipe aims the pie (left stool, middle, right stool) and the
 * speed of the swipe sets how far it slides before it stops. A pie that stops
 * in front of the customer who ordered it scores +1 and the customer orders
 * again after a bite; one in front of the wrong customer is -1; one that
 * stops short, or on a customer who is still eating, is nothing; one that
 * slides off the far end falls to the floor. 50 seconds, most served wins.
 *
 * Fairness: every counter reads the same order streams (drawn once per round),
 * and the pie in your hand is always baked for a customer who is waiting, so
 * nobody gets an easier counter or an impossible pie.
 *
 * CPU seats (and your own seat under autoplay) plan with planCpuThrow(): pick
 * a customer who wants the pie in hand, aim cpuSwipe() at their plate, and
 * throw every CPU_PERIOD / skill seconds. Always 7 rng draws per throw, at
 * every skill. A swipe from a CPU goes through the same swipeToThrow() as a
 * thumb.
 *
 * Determinism: the game runs in fixed 1/60 s steps with an integer step index.
 * A human's swipe is queued and applied at the start of the next step;
 * everything else (CPU plans, slides, serving, orders) is a function of the
 * step clock and ctx.rng. Presentation (particles, popups, squash, the
 * customers' faces, the camera framing) never feeds back into the sim. The
 * camera never moves: no shake. Telemetry: window.__PIEFLICK__.
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
import type { Character } from "../../characters/characterFactory";
import { createArt, FLAVORS, type Art, type Customer, type PieMesh } from "./art";
import { buildDinerEnvironment, COUNTER_Y, LANE_GAP, WALL_Z, type DinerEnvironment } from "./environment";
import {
  CPU_PERIOD,
  EAT_SECONDS,
  FRICTION,
  GRUMP_SECONDS,
  RELOAD,
  ROUND_SECONDS,
  SEATS,
  bakeFlavor,
  fateOf,
  judge,
  makeStreams,
  pathAt,
  planCpuThrow,
  pointAlong,
  rankPlayers,
  seatAt,
  slideDistance,
  slidePosition,
  slideTime,
  swipeToThrow,
  timeAtDistance,
  STREAM_LENGTH,
  type Fate,
  type RoundStreams,
} from "./rules";

const FIXED_DT = 1 / 60;
const MAX_STEPS_PER_FRAME = 12;

/** The framework force-finishes a round still running at this game time (s). */
const TIME_LIMIT = 58;
/** After the buzzer the last pies come to rest (at most this long), then the result shows. */
const POST_BUZZER_MAX = 2.4;
const RESULT_PAUSE = 1.3;
/** A swipe that comes in while the next pie is loading is kept this long (s). */
const SWIPE_BUFFER = 0.3;
/** Where things stand along the lane (z). */
const CHAR_Z = 2.15;
const CHAR_SCALE = 1.2;
/** Customers are a little bigger than life so their faces read on a phone. */
const CUSTOMER_SCALE = 1.2;
/** Customers sit this far behind their plate. */
const CUSTOMER_BEHIND = 1.05;
/** The pad where the pie waits to be thrown, and the pie's height above the counter. */
const PAD_Z = 0.1;
const PIE_LIFT = 0.04;
/** How high a customer's order bubble floats above the counter. */
const BUBBLE_Y = COUNTER_Y + 2.05;
/** The gravity of a pie that has gone off the end. */
const FALL_G = 16;
/** Pool sizes for the effects with their own materials. */
const RING_POOL = 10;
const POPUP_POOL = 12;
/** Cap on live puffs (they share one geometry and a few materials). */
const MAX_PUFFS = 220;

/* ------------------------------------------------------------------ */
/*  State                                                              */
/* ------------------------------------------------------------------ */

type Outcome = "served" | "wrong" | "plop" | "busy" | "fell";

interface SeatState {
  idx: number;
  /** Orders taken so far at this stool (index into the round's stream). */
  k: number;
  /** The flavor this customer wants, null while they eat. */
  order: number | null;
  eatUntil: number;
  // presentation
  view: Customer;
  bubble: THREE.Sprite;
  mark: THREE.Mesh;
  /** Bubble size 0..1 (springs), its velocity, and the flavor it is showing. */
  show: number;
  showV: number;
  shownFlavor: number;
  grumpUntil: number;
  happyUntil: number;
  /** Counts up from 0 when a mood starts; drives the shake and the bounce. */
  moodT: number;
}

interface Lane {
  idx: number;
  id: number;
  name: string;
  color: string;
  x: number;
  cpu: boolean;
  coin: number;
  score: number;
  served: number;
  wrong: number;
  thrown: number;
  fell: number;
  seats: SeatState[];
  /** Pies baked so far: index into the round's pick stream. */
  pieN: number;
  /** The flavor in hand, or -1 while the next pie is being baked. */
  held: number;
  readyAt: number;
  /** A swipe that came in while reloading, thrown when the pie is ready. */
  pending: { dx: number; dy: number; power: number; until: number } | null;
  nextCpuAt: number;
  // presentation
  heldPie: PieMesh;
  /** 0..1: the pie in hand popping in. */
  loadT: number;
  kick: number;
  char: Character | null;
  celebrateUntil: number;
}

interface Flight {
  lane: Lane;
  flavor: number;
  t0: number;
  T: number;
  dist: number;
  angle: number;
  fate: Fate;
  /** Sim time the slide ends (at rest or over the edge). */
  resolveAt: number;
  resolved: boolean;
  outcome: Outcome | null;
  seat: number;
  /** The seat this pie is bound for if it will be served (to keep the next pie off it). */
  reserved: number;
  pie: PieMesh;
  shadow: THREE.Mesh;
  trailT: number;
  /** Presentation seconds since it was resolved. */
  post: number;
  restX: number;
  restZ: number;
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
  active: boolean;
}

interface State {
  ctx: MinigameContext;
  root: THREE.Group;
  env: DinerEnvironment;
  art: Art;
  streams: RoundStreams;
  lanes: Lane[];
  human: Lane | null;
  step: number;
  simTime: number;
  presT: number;
  closing: boolean;
  closedAt: number;
  resultAt: number;
  finished: boolean;
  /** Swipes from the human, applied at the start of the next step. */
  events: { dx: number; dy: number; power: number }[];
  flights: Flight[];
  puffs: Puff[];
  rings: RingFx[];
  popups: Popup[];
  shadowMat: THREE.MeshBasicMaterial;
  log: string[];
}

let round: State | null = null;

/* ------------------------------------------------------------------ */
/*  Effects                                                            */
/* ------------------------------------------------------------------ */

function puff(st: State, at: THREE.Vector3, color: string, vel: THREE.Vector3, life: number, size: number, grav = 7): void {
  if (st.puffs.length >= MAX_PUFFS) return;
  const m = new THREE.Mesh(st.art.geo.puff, st.art.basic(color));
  m.position.copy(at);
  m.scale.setScalar(size);
  st.root.add(m);
  st.puffs.push({ mesh: m, vel, life, maxLife: life, grav, base: size });
}

function ringPulse(st: State, at: THREE.Vector3, color: string, size: number, life: number): void {
  const fx = st.rings.find((r) => r.life <= 0);
  if (!fx) return;
  fx.mat.color.set(hex(color));
  fx.mat.opacity = 0.9;
  fx.mesh.visible = true;
  fx.mesh.position.set(at.x, at.y + 0.03, at.z);
  fx.base = size * 0.5;
  fx.grow = size * 1.6;
  fx.life = life;
  fx.maxLife = life;
  fx.mesh.scale.setScalar(fx.base);
}

function popup(st: State, at: THREE.Vector3, good: boolean): void {
  const p = st.popups.find((q) => !q.active);
  if (!p) return;
  p.mat.map = good ? st.art.popup.plus : st.art.popup.minus;
  p.mat.needsUpdate = true;
  p.mat.opacity = 1;
  p.sprite.visible = true;
  p.sprite.position.set(at.x, at.y + 1.15, at.z);
  p.sprite.scale.set(0.01, 0.01, 1);
  p.baseY = p.sprite.position.y;
  p.life = 0;
  p.active = true;
}

/** A burst of crumbs and sparkles in the pie's colors. */
function crumbs(st: State, at: THREE.Vector3, flavor: number, count: number, power: number, gold = false): void {
  const colors = gold
    ? [FLAVORS[flavor].color, palette.sun, palette.white, palette.sunDeep]
    : [FLAVORS[flavor].color, palette.sand, palette.sunDeep, palette.cream];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + at.x * 3.1;
    const sp = power * (0.6 + (0.4 * ((i * 7) % 5)) / 4);
    puff(
      st,
      at,
      colors[i % colors.length],
      new THREE.Vector3(Math.cos(a) * sp, 1.6 + ((i * 3) % 4) * 0.45 * power * 0.4, Math.sin(a) * sp),
      0.55 + (i % 3) * 0.1,
      0.9 + (i % 2) * 0.5,
    );
  }
}

/* ------------------------------------------------------------------ */
/*  Building the counters                                              */
/* ------------------------------------------------------------------ */

function buildLane(st: State, lane: Lane): void {
  const art = st.art;
  // The pad the pie waits on: a chrome saucer ringed in the player's color.
  const pad = new THREE.Mesh(st.art.geo.plate, art.toon(palette.metal));
  pad.position.set(lane.x, COUNTER_Y + 0.02, PAD_Z);
  pad.scale.setScalar(1.18);
  const ring = new THREE.Mesh(st.art.geo.placemat, art.basic(lane.color));
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(lane.x, COUNTER_Y + 0.045, PAD_Z);
  ring.scale.setScalar(0.98);
  st.root.add(pad, ring);

  lane.heldPie.group.position.set(lane.x, COUNTER_Y + PIE_LIFT + 0.04, PAD_Z);
  st.root.add(lane.heldPie.group);

  SEATS.forEach((seat, i) => {
    const cx = lane.x + seat.x;
    const plate = new THREE.Mesh(art.geo.plate, art.toon(palette.white));
    plate.position.set(cx, COUNTER_Y + 0.02, seat.z);
    const mark = new THREE.Mesh(art.geo.placemat, art.placemat(0));
    mark.rotation.x = -Math.PI / 2;
    mark.position.set(cx, COUNTER_Y + 0.045, seat.z);
    st.root.add(plate, mark);

    const view = art.makeCustomer(lane.idx * SEATS.length + i);
    view.group.position.set(cx, COUNTER_Y, seat.z - CUSTOMER_BEHIND);
    view.group.scale.setScalar(CUSTOMER_SCALE);
    st.root.add(view.group);

    const bubble = new THREE.Sprite(art.bubble(0));
    bubble.center.set(0.5, 0);
    bubble.position.set(cx, BUBBLE_Y, seat.z - CUSTOMER_BEHIND + 0.1);
    bubble.scale.set(0.001, 0.001, 1);
    bubble.renderOrder = 8;
    st.root.add(bubble);

    const s = lane.seats[i];
    s.view = view;
    s.bubble = bubble;
    s.mark = mark;
  });
}

/* ------------------------------------------------------------------ */
/*  Sim                                                                */
/* ------------------------------------------------------------------ */

/** Seat orders as the next pie should see them: seats a pie in flight is already bound to count as eating. */
function openOrders(st: State, lane: Lane): (number | null)[] {
  return lane.seats.map((s) => {
    if (s.order === null) return null;
    for (const f of st.flights) if (!f.resolved && f.lane === lane && f.reserved === s.idx) return null;
    return s.order;
  });
}

function bake(st: State, lane: Lane): void {
  const flavor = bakeFlavor(openOrders(st, lane), st.streams.picks[lane.pieN % STREAM_LENGTH]);
  lane.held = flavor;
  if (flavor >= 0) {
    st.art.setPieFlavor(lane.heldPie, flavor);
    lane.loadT = 0;
  }
}

function throwPie(st: State, lane: Lane, dx: number, dy: number, power: number, t: number): boolean {
  const th = swipeToThrow(dx, dy, power);
  if (!th || lane.held < 0) return false;
  const dist = slideDistance(th.power);
  const fate = fateOf(th.angle, dist);
  const T = slideTime(dist);
  const stopAt = fate.kind === "off" ? timeAtDistance(dist, fate.at) : T;
  // Will this pie be served? Then the next one is baked for somebody else.
  let reserved = -1;
  if (fate.kind === "rest") {
    const seat = seatAt(fate.x, fate.z);
    if (seat >= 0 && lane.seats[seat].order === lane.held) reserved = seat;
  }
  const pie = st.art.makePie(lane.held);
  const rest = fate.kind === "rest" ? fate : { x: fate.x, z: fate.z };
  pie.group.position.set(lane.x, COUNTER_Y + PIE_LIFT, PAD_Z);
  st.root.add(pie.group);
  const shadow = new THREE.Mesh(st.art.geo.shadow, st.shadowMat);
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.set(lane.x, COUNTER_Y + 0.025, PAD_Z);
  shadow.scale.set(1.05, 1.05, 1);
  st.root.add(shadow);
  st.flights.push({
    lane, flavor: lane.held, t0: t, T, dist, angle: th.angle, fate, resolveAt: t + stopAt, resolved: false, outcome: null,
    seat: -1, reserved, pie, shadow, trailT: 0, post: 0, restX: rest.x, restZ: rest.z, done: false,
  });
  lane.thrown++;
  lane.pieN++;
  lane.held = -1;
  lane.readyAt = t + RELOAD;
  lane.kick = 1;
  const mine = lane === st.human;
  st.ctx.playSfx("whoosh", { volume: mine ? 0.7 : 0.2, pitch: 2 + th.power * 5 });
  const from = new THREE.Vector3(lane.x, COUNTER_Y + 0.2, PAD_Z);
  for (let i = 0; i < 4; i++) puff(st, from, i % 2 === 0 ? palette.white : palette.cream, new THREE.Vector3((i - 1.5) * 0.7, 0.8, 0.5), 0.3, 1.1, 2);
  st.log.push(`${t.toFixed(2)} L${lane.idx} throw a=${th.angle.toFixed(3)} p=${th.power.toFixed(2)} d=${dist.toFixed(2)} f=${lane.thrown}`);
  return true;
}

function resolveFlight(st: State, f: Flight, t: number): void {
  const lane = f.lane;
  const mine = lane === st.human;
  f.resolved = true;
  f.post = 0;
  if (f.fate.kind === "off") {
    f.outcome = "fell";
    lane.fell++;
    st.log.push(`${t.toFixed(2)} L${lane.idx} fell`);
    return;
  }
  const seatIdx = seatAt(f.fate.x, f.fate.z);
  const at = new THREE.Vector3(lane.x + f.fate.x, COUNTER_Y + 0.15, f.fate.z);
  if (seatIdx < 0) {
    f.outcome = "plop";
    st.ctx.playSfx("land", { volume: mine ? 0.45 : 0.1, pitch: -1 });
    st.log.push(`${t.toFixed(2)} L${lane.idx} plop`);
    return;
  }
  const seat = lane.seats[seatIdx];
  f.seat = seatIdx;
  const verdict = judge(f.flavor, seat.order);
  if (verdict === 1) {
    f.outcome = "served";
    lane.score++;
    lane.served++;
    seat.order = null;
    seat.eatUntil = t + EAT_SECONDS;
    seat.happyUntil = st.presT + EAT_SECONDS * 0.55;
    seat.moodT = 0;
    st.log.push(`${t.toFixed(2)} L${lane.idx} served s${seatIdx} -> ${lane.score}`);
    popup(st, at, true);
    ringPulse(st, at, FLAVORS[f.flavor].color, 1.0, 0.5);
    crumbs(st, at, f.flavor, 12, 3.0, true);
    st.ctx.playSfx("coin.gain", { volume: mine ? 0.9 : 0.28, pitch: 3 + seatIdx });
    if (mine) st.ctx.playSfx("crowd.ooh", { volume: 0.35 });
    st.env.flare();
    st.env.beat();
    if (lane.char) {
      lane.char.anim.cheer();
      lane.char.setFacing(0);
      lane.celebrateUntil = st.presT + 0.8;
    }
  } else if (verdict === -1) {
    f.outcome = "wrong";
    lane.score--;
    lane.wrong++;
    seat.grumpUntil = st.presT + GRUMP_SECONDS;
    seat.moodT = 0;
    st.log.push(`${t.toFixed(2)} L${lane.idx} wrong s${seatIdx} -> ${lane.score}`);
    popup(st, at, false);
    ringPulse(st, at, palette.lava, 0.9, 0.45);
    crumbs(st, at, f.flavor, 9, 2.4);
    st.ctx.playSfx("coin.lose", { volume: mine ? 0.8 : 0.22 });
    st.ctx.playSfx("boing", { volume: mine ? 0.5 : 0.12, pitch: -3 });
    if (lane.char) {
      lane.char.anim.sad();
      lane.char.setFacing(0);
      lane.celebrateUntil = st.presT + 0.7;
    }
  } else {
    f.outcome = "busy";
    st.log.push(`${t.toFixed(2)} L${lane.idx} busy s${seatIdx}`);
    st.ctx.playSfx("land", { volume: mine ? 0.45 : 0.1, pitch: -1 });
  }
}

function stepFixed(st: State): void {
  const t = st.step * FIXED_DT;
  const ctx = st.ctx;

  // The buzzer.
  if (!st.closing && t >= ROUND_SECONDS) {
    st.closing = true;
    st.closedAt = t;
    for (const lane of st.lanes) lane.pending = null;
    st.events.length = 0;
    ctx.announce("TIME!", { durationMs: 1000, sound: "whistle" });
  }

  // Customers who finished their pie order again.
  for (const lane of st.lanes) {
    for (const seat of lane.seats) {
      if (seat.order === null && t >= seat.eatUntil - 1e-9) {
        seat.k++;
        seat.order = st.streams.orders[seat.idx][seat.k % STREAM_LENGTH];
        seat.moodT = 0;
      }
    }
  }

  if (!st.closing) {
    // A human swipe, now or as soon as the next pie is ready.
    const human = st.human;
    if (human) {
      for (const e of st.events) human.pending = { ...e, until: t + SWIPE_BUFFER };
      st.events.length = 0;
      const p = human.pending;
      if (p) {
        if (human.held >= 0 && t >= human.readyAt - 1e-9) {
          throwPie(st, human, p.dx, p.dy, p.power, t);
          human.pending = null;
        } else if (t > p.until) human.pending = null;
      }
    }

    // CPU seats.
    const skill = cpuSkill();
    for (const lane of st.lanes) {
      if (!lane.cpu || lane.held < 0 || t < lane.readyAt - 1e-9 || t < lane.nextCpuAt - 1e-9) continue;
      const plan = planCpuThrow(ctx.rng, skill, lane.held, openOrders(st, lane));
      throwPie(st, lane, plan.swipe.dx, plan.swipe.dy, plan.swipe.power, t);
      lane.nextCpuAt = t + CPU_PERIOD / skill;
    }
  }

  // Pies that come to rest (or go over the end) this step.
  for (const f of st.flights) {
    if (!f.resolved && t >= f.resolveAt - 1e-9) resolveFlight(st, f, f.resolveAt);
  }

  // Bake the next pie, and swap one nobody wants any more.
  for (const lane of st.lanes) {
    if (st.closing) break;
    if (lane.held < 0) {
      if (t >= lane.readyAt - 1e-9) bake(st, lane);
    } else if (!openOrders(st, lane).includes(lane.held)) {
      bake(st, lane);
    }
  }

  // Close out.
  if (st.closing && st.resultAt < 0) {
    const inFlight = st.flights.some((f) => !f.resolved);
    if ((!inFlight && t >= st.closedAt + 0.6) || t >= st.closedAt + POST_BUZZER_MAX) {
      st.resultAt = t + RESULT_PAUSE;
      const order = rankOf(st);
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

function rankOf(st: State): number[] {
  return rankPlayers(st.lanes.map((l) => ({ id: l.id, score: l.score, served: l.served, wrong: l.wrong, coin: l.coin })));
}

/* ------------------------------------------------------------------ */
/*  Presentation                                                       */
/* ------------------------------------------------------------------ */

const easeOut = (u: number): number => 1 - (1 - u) * (1 - u);

function updateFlight(st: State, f: Flight, dt: number, tVis: number): void {
  const lane = f.lane;
  const g = f.pie.group;
  const y0 = COUNTER_Y + PIE_LIFT;
  if (!f.resolved) {
    const tau = Math.max(0, tVis - f.t0);
    const s = slidePosition(f.dist, Math.min(tau, f.T));
    let x: number;
    let z: number;
    let y = y0;
    const offAt = f.fate.kind === "off" ? timeAtDistance(f.dist, f.fate.at) : Infinity;
    if (tau <= offAt) {
      const p = pathAt(f.angle, s);
      x = p.x;
      z = p.z;
    } else {
      // Over the end: it keeps its speed and drops.
      const tf = tau - offAt;
      const v = FRICTION * Math.max(0, f.T - offAt);
      const p = pointAlong(f.angle, (f.fate.kind === "off" ? f.fate.at : 0) + v * tf);
      x = p.x;
      z = p.z;
      y = y0 - 0.5 * FALL_G * tf * tf;
    }
    g.position.set(lane.x + x, y, z);
    // Stretch along the slide while it is quick, a gentle tilt as it slows.
    const speed = FRICTION * Math.max(0, f.T - tau);
    const heading = Math.atan2(Math.sin(f.angle), Math.cos(f.angle));
    g.rotation.set(0, -heading, Math.sin(tau * 14) * 0.05 * Math.min(1, speed / 8));
    g.scale.set(1 - 0.08 * Math.min(1, speed / 10), 1, 1 + 0.2 * Math.min(1, speed / 10));
    f.shadow.position.set(lane.x + x, COUNTER_Y + 0.025, z);
    f.shadow.visible = y > COUNTER_Y - 0.1;
    // A flavored trail.
    f.trailT -= dt;
    if (f.trailT <= 0 && speed > 1.2) {
      f.trailT = 0.04;
      puff(st, new THREE.Vector3(lane.x + x, COUNTER_Y + 0.12, z + 0.1), f.shadow.visible ? FLAVORS[f.flavor].color : palette.white, new THREE.Vector3(0, 0.3, 0.2), 0.3, 1.0 + 0.5 * Math.min(1, speed / 10), 0);
    }
    return;
  }

  // After the slide.
  f.post += dt;
  const u = f.post;
  f.shadow.visible = false;
  g.rotation.set(0, g.rotation.y, 0);
  switch (f.outcome) {
    case "served": {
      const seat = SEATS[f.seat];
      const k = easeOut(Math.min(1, u / 0.14));
      const x = lane.x + f.restX + (seat.x - f.restX) * k;
      const z = f.restZ + (seat.z - f.restZ) * k;
      g.position.set(x, y0 + 0.2 * Math.sin(k * Math.PI), z);
      const shrink = u < 0.28 ? 1 : Math.max(0, 1 - (u - 0.28) / 0.34);
      g.scale.setScalar(shrink);
      if (u > 0.62) f.done = true;
      break;
    }
    case "wrong": {
      const k = easeOut(Math.min(1, u / 0.14));
      g.position.set(lane.x + f.restX, y0 - 0.02, f.restZ);
      g.scale.set(1 + 0.5 * k, 1 - 0.78 * k, 1 + 0.5 * k);
      if (u > 0.9) g.scale.multiplyScalar(Math.max(0, 1 - (u - 0.9) / 0.3));
      if (u > 1.2) f.done = true;
      break;
    }
    case "fell": {
      const offAt = f.fate.kind === "off" ? timeAtDistance(f.dist, f.fate.at) : 0;
      const tf = Math.max(0, tVis - f.t0 - offAt);
      const v = FRICTION * Math.max(0, f.T - offAt);
      const p = pointAlong(f.angle, (f.fate.kind === "off" ? f.fate.at : 0) + v * tf);
      const y = y0 - 0.5 * FALL_G * tf * tf;
      const floorY = 0.06;
      if (y > floorY) {
        g.position.set(lane.x + p.x, y, p.z);
        g.rotation.set(tf * 5, g.rotation.y, tf * 3);
        f.restX = p.x;
        f.restZ = p.z;
        f.post = 0;
        break;
      }
      // Splat on the floor.
      if (f.post === dt) {
        const at = new THREE.Vector3(lane.x + p.x, floorY + 0.1, p.z);
        crumbs(st, at, f.flavor, 10, 2.2);
        st.ctx.playSfx("land", { volume: lane === st.human ? 0.5 : 0.1, pitch: -4 });
      }
      g.position.set(lane.x + f.restX, floorY, f.restZ);
      g.rotation.set(0, g.rotation.y, 0);
      const k = easeOut(Math.min(1, u / 0.12));
      g.scale.set(1 + 0.5 * k, 1 - 0.7 * k, 1 + 0.5 * k);
      if (u > 0.9) g.scale.multiplyScalar(Math.max(0, 1 - (u - 0.9) / 0.3));
      if (u > 1.2) f.done = true;
      break;
    }
    default: {
      // plop / busy: a pie sitting on the counter, a little wobble, then it is cleared away.
      g.position.set(lane.x + f.restX, y0, f.restZ);
      g.rotation.z = Math.sin(u * 22) * 0.07 * Math.max(0, 1 - u * 2);
      g.scale.set(1, 1, 1);
      if (u > 0.9) g.scale.setScalar(Math.max(0, 1 - (u - 0.9) / 0.3));
      if (u > 1.2) f.done = true;
    }
  }
}

function updateSeat(st: State, lane: Lane, seat: SeatState, dt: number): void {
  const pres = st.presT;
  const mine = lane === st.human;
  const view = seat.view;
  seat.moodT += dt;

  // The bubble springs open when there is an order, shut while they eat.
  const want = seat.order !== null ? 1 : 0;
  if (seat.order !== null && seat.shownFlavor !== seat.order) {
    seat.shownFlavor = seat.order;
    seat.bubble.material = st.art.bubble(seat.order);
    seat.mark.material = st.art.placemat(seat.order);
    seat.show = Math.min(seat.show, 0.2);
    st.ctx.playSfx("pop", { volume: mine ? 0.3 : 0.05, pitch: 5 + seat.idx * 2 });
  }
  seat.showV += (want - seat.show) * 180 * dt;
  seat.showV *= Math.exp(-14 * dt);
  seat.show = Math.max(0, seat.show + seat.showV * dt);
  const wanted = mine && seat.order !== null && seat.order === lane.held;
  const pulse = wanted ? 1 + 0.12 * Math.sin(pres * 9) : 1;
  const dim = mine && lane.held >= 0 && !wanted && seat.order !== null ? 0.88 : 1;
  const s = seat.show * pulse * dim;
  seat.bubble.scale.set(1.0 * s, 1.08 * s, 1);
  seat.bubble.position.y = BUBBLE_Y + (wanted ? 0.06 * Math.abs(Math.sin(pres * 7)) : 0.025 * Math.sin(pres * 2 + seat.idx));
  seat.mark.visible = seat.order !== null;
  seat.mark.scale.setScalar(wanted ? 1.06 + 0.1 * Math.sin(pres * 9) : 1);

  // Mood: eating, delighted, glaring, or waiting hopefully.
  const eating = seat.order === null;
  const grump = pres < seat.grumpUntil;
  const happy = pres < seat.happyUntil;
  view.setFace(grump ? "grump" : happy ? "happy" : eating ? "eat" : "wait");
  let lean = 0;
  let shake = 0;
  let bounce = 0;
  if (grump) {
    const k = Math.max(0, 1 - seat.moodT / GRUMP_SECONDS);
    shake = Math.sin(seat.moodT * 46) * 0.13 * k;
    lean = -0.12 * k;
  } else if (happy) {
    bounce = Math.abs(Math.sin(seat.moodT * 12)) * 0.12 * Math.max(0, 1 - seat.moodT / 0.6);
  } else if (eating) {
    view.head.scale.y = 1 + 0.06 * Math.sin(pres * 20);
  } else {
    bounce = 0.018 * Math.sin(pres * 3 + seat.idx * 1.7 + lane.idx);
    lean = wanted ? 0.1 * Math.sin(pres * 6) : 0;
  }
  if (!eating) view.head.scale.y = 1;
  view.body.position.y = 0.45 + bounce;
  view.body.rotation.z = shake;
  view.body.rotation.x = lean;
  view.head.rotation.z = Math.sin(pres * 1.4 + seat.idx * 2.3 + lane.idx) * 0.05 + shake * 0.6;
  // Hands drum on the counter while they wait.
  view.arms[0].rotation.x = Math.PI / 2 - 0.4 + (eating ? 0 : Math.max(0, Math.sin(pres * 7 + seat.idx)) * 0.14);
  view.arms[1].rotation.x = Math.PI / 2 - 0.4 + (eating ? 0 : Math.max(0, Math.sin(pres * 7 + seat.idx + 2)) * 0.14);
}

function updateVisuals(st: State, dt: number): void {
  const tVis = st.step * FIXED_DT + st.simTime;
  st.presT += dt;
  const pres = st.presT;

  for (const lane of st.lanes) {
    for (const seat of lane.seats) updateSeat(st, lane, seat, dt);

    // The pie in hand pops in on its saucer.
    lane.loadT = Math.min(1, lane.loadT + dt * 5);
    const k = lane.loadT;
    const pop = k < 1 ? 1 + 0.25 * Math.sin(k * Math.PI) - (1 - k) * 0.8 : 1;
    lane.heldPie.group.visible = lane.held >= 0;
    lane.heldPie.group.scale.setScalar(Math.max(0.05, pop));
    lane.heldPie.group.position.y = COUNTER_Y + PIE_LIFT + 0.04 + 0.025 * Math.sin(pres * 3 + lane.idx);
    lane.heldPie.group.rotation.y = pres * 0.8 + lane.idx;

    // The shooter leans into the throw, then back; a serve turns them to the camera.
    lane.kick = Math.max(0, lane.kick - dt * 5);
    const ch = lane.char;
    if (ch) {
      if (pres > lane.celebrateUntil) {
        lane.celebrateUntil = 0;
        ch.anim.idle();
        ch.setFacing(Math.PI);
      }
      ch.group.rotation.x = -0.3 * Math.sin(lane.kick * Math.PI * 0.5) * lane.kick;
    }
  }

  for (let i = st.flights.length - 1; i >= 0; i--) {
    const f = st.flights[i];
    updateFlight(st, f, dt, tVis);
    if (f.done) {
      f.pie.group.removeFromParent();
      f.shadow.removeFromParent();
      st.flights.splice(i, 1);
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
  for (const r of st.rings) {
    if (r.life <= 0) {
      r.mesh.visible = false;
      continue;
    }
    r.life -= dt;
    const u = 1 - Math.max(0, r.life) / r.maxLife;
    r.mesh.scale.setScalar(r.base + r.grow * u);
    r.mat.opacity = 0.9 * (1 - u);
  }
  for (const p of st.popups) {
    if (!p.active) continue;
    p.life += dt;
    const u = p.life / 1.0;
    const pop = u < 0.18 ? u / 0.18 : 1;
    const s = (0.55 + 0.75 * Math.sin(Math.min(1, pop) * Math.PI * 0.5) * (1 + 0.18 * Math.sin(pop * Math.PI))) * 1.1;
    p.sprite.scale.set(s * 1.1, s * 0.64, 1);
    p.sprite.position.y = p.baseY + 1.0 * Math.min(1, u * 1.3);
    p.mat.opacity = u > 0.7 ? Math.max(0, 1 - (u - 0.7) / 0.3) : 1;
    if (u >= 1) {
      p.active = false;
      p.sprite.visible = false;
    }
  }

  st.env.update(pres, dt);
}

function publish(st: State): void {
  const w = window as unknown as { __PIEFLICK__?: unknown };
  w.__PIEFLICK__ = {
    t: st.step * FIXED_DT,
    step: st.step,
    closing: st.closing,
    finished: st.finished,
    tFinish: st.finished ? st.resultAt : null,
    scores: st.lanes.map((l) => l.score),
    served: st.lanes.map((l) => l.served),
    wrong: st.lanes.map((l) => l.wrong),
    thrown: st.lanes.map((l) => l.thrown),
    fell: st.lanes.map((l) => l.fell),
    held: st.lanes.map((l) => l.held),
    orders: st.lanes.map((l) => l.seats.map((s) => s.order)),
    log: st.log.slice(-48),
  };
}

/* ------------------------------------------------------------------ */
/*  Minigame                                                           */
/* ------------------------------------------------------------------ */

const pieFlick: Minigame = {
  id: "pie_flick",
  name: "Pie Flick",
  genre: "target",
  pad: "swipe",
  timeLimit: TIME_LIMIT,
  howTo: "Swipe pies up the counter. Aim for the customer whose order matches.",
  goal: "Serve the most pies.",
  tap: null,
  steer: false,
  rules: {
    format: "ffa",
    length: "50 seconds",
    win: "Most pies served: +1 for the customer's order, -1 for the wrong pie",
    touch: ["Swipe up the counter to slide a pie", "The swipe angle aims, the speed sets the distance"],
    keys: ["Arrows aim, hold Space to wind up", "Let go of Space to throw"],
  },

  setup(ctx: MinigameContext) {
    const root = new THREE.Group();
    root.name = "pieflick:root";
    ctx.scene.add(root);

    const n = ctx.players.length;
    const laneInfos = ctx.players.map((p, i) => ({ x: (i - (n - 1) / 2) * LANE_GAP, color: p.color }));
    const env = buildDinerEnvironment(root, laneInfos);
    const art = createArt();

    // A fixed camera over the counters, behind the players. A tall phone gets a steeper look.
    const halfW = ((n - 1) / 2) * LANE_GAP + 1.6;
    frameMinigame(ctx.camera, () => ({
      box: frameBox([-halfW, 0, WALL_Z + 0.6], [halfW, COUNTER_Y + 2.5, CHAR_Z + 0.5]),
      dir: window.innerWidth / window.innerHeight < 1 ? new THREE.Vector3(0, 9.5, 5.2) : new THREE.Vector3(0, 6.8, 7.4),
      fov: 46,
      insets: { top: 92, bottom: 24 },
    }));

    const st: State = {
      ctx, root, env, art,
      streams: { orders: [], picks: [] },
      lanes: [], human: null,
      step: 0, simTime: 0, presT: 0,
      closing: false, closedAt: 0, resultAt: -1, finished: false,
      events: [], flights: [], puffs: [], rings: [], popups: [],
      shadowMat: new THREE.MeshBasicMaterial({ color: hex(palette.ink), transparent: true, opacity: 0.3, depthWrite: false }),
      log: [],
    };
    round = st;

    for (let i = 0; i < RING_POOL; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: hex(palette.white), transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false });
      const mesh = new THREE.Mesh(art.geo.ring, mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.visible = false;
      root.add(mesh);
      st.rings.push({ mesh, mat, life: 0, maxLife: 1, base: 1, grow: 1 });
    }
    for (let i = 0; i < POPUP_POOL; i++) {
      const mat = new THREE.SpriteMaterial({ map: art.popup.plus, transparent: true, depthTest: false });
      const sprite = new THREE.Sprite(mat);
      sprite.renderOrder = 10;
      sprite.visible = false;
      root.add(sprite);
      st.popups.push({ sprite, mat, life: 0, baseY: 0, active: false });
    }

    // Every draw below happens once, here, in a fixed order.
    st.streams = makeStreams(ctx.rng);
    const localId = isAutoplay() ? -1 : (ctx.players.find((p) => isLocalPlayer(ctx.players, p.id))?.id ?? -1);
    const automated = new Set(automatedSeatIds(ctx.players, isAutoplay()));
    ctx.players.forEach((p, i) => {
      const coin = ctx.rng();
      const stagger = 0.5 + ctx.rng() * 1.0;
      const lane: Lane = {
        idx: i, id: p.id, name: p.name, color: p.color, x: laneInfos[i].x,
        cpu: p.id !== localId || automated.has(p.id),
        coin, score: 0, served: 0, wrong: 0, thrown: 0, fell: 0,
        seats: SEATS.map((_, s) => ({
          idx: s, k: 0, order: st.streams.orders[s][0], eatUntil: 0,
          view: null as unknown as Customer, bubble: null as unknown as THREE.Sprite, mark: null as unknown as THREE.Mesh,
          show: 0, showV: 0, shownFlavor: -1, grumpUntil: 0, happyUntil: 0, moodT: 0,
        })),
        pieN: 0, held: -1, readyAt: 0, pending: null, nextCpuAt: stagger,
        heldPie: art.makePie(0), loadT: 0, kick: 0,
        char: ctx.characters[p.id] ?? null, celebrateUntil: 0,
      };
      buildLane(st, lane);
      if (!lane.cpu) st.human = lane;
      const ch = lane.char;
      if (ch) {
        ch.group.position.set(lane.x, 0, CHAR_Z);
        ch.group.rotation.x = 0;
        ch.group.scale.setScalar(CHAR_SCALE);
        ch.setFacing(Math.PI);
        ch.anim.idle();
      }
      st.lanes.push(lane);
      bake(st, lane);
    });

    ctx.hud.unit("pies");
    for (const lane of st.lanes) ctx.hud.score(lane.id, 0);
    ctx.hud.timer(ROUND_SECONDS, ROUND_SECONDS);

    // ---- input: a swipe on the pad (or an arrow plus Space on a keyboard) ----
    ctx.input.swipe = (dx, dy, power) => {
      if (isPracticeBeat() || !st.human || st.closing) return;
      st.events.push({ dx, dy, power });
    };
    ctx.input.pointer = () => {};
    ctx.input.key = () => {};

    publish(st);
  },

  update(dt: number) {
    const st = round;
    if (!st) return;
    if (isPracticeBeat()) {
      updateVisuals(st, dt);
      return;
    }
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
          const order = rankOf(st);
          st.log.push(`finish ${order.join(",")}`);
          st.ctx.finish(order);
          break;
        }
      }
      if (steps >= MAX_STEPS_PER_FRAME && st.simTime >= FIXED_DT) st.simTime = 0;
    }
    for (const lane of st.lanes) st.ctx.hud.score(lane.id, lane.score);
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
    st.shadowMat.dispose();
    st.art.dispose();
    st.root.removeFromParent();
    round = null;
    (window as unknown as { __PIEFLICK__?: unknown }).__PIEFLICK__ = undefined;
  },
};

registerMinigame({ id: pieFlick.id, name: pieFlick.name });

export function loadPieFlick(): Promise<Minigame> {
  return Promise.resolve(pieFlick);
}

export default pieFlick;
