/**
 * BUMPER BALLS — survival arena minigame (MP7 reference).
 *
 * Four characters bump each other around a circular stage while the sun
 * ring closes in. Push rivals past the ring to eliminate them; last one
 * standing wins. Physics-lite (velocity + circle collisions), fully
 * deterministic (ctx.rng only), palette-only cel look.
 *
 * Time budget: the framework screen force-finishes at
 * settings.minigameTimeLimit (30s). The sun ring closes with an
 * ACCELERATING ease (outQuad) from RING_START down to RING_END = 0.45u —
 * smaller than a player footprint (CHAR_R 0.55) — by 26s, so the endgame
 * is GEOMETRICALLY FORCED: from ~22s on, at most one player can physically
 * fit inside the ring, and eliminations walk 4->3->2->1 (one per frame,
 * lowest player id first). TIME_CAP = 28s is only a safety net with a
 * deterministic id-order fallback (never float-distance tiebreaks).
 */
import * as THREE from "three";
import type { Minigame, MinigameContext } from "../framework";
import { ui } from "../../ui/kit";
import { characterColor } from "../../characters/roster";
import { buildArena, ARENA_R, type ArenaHandle } from "./arena";
import { freshBrain, repick, cpuDesiredDir, type CpuBrain, type CpuRival } from "./ai";

/* ------------------------- tuning constants ------------------------- */

const CHAR_R = 0.55; // character collision radius
const HUMAN_SPEED = 4.5; // u/s top speed (CPU runs at 65-95% of this)
const ACCEL = 16; // u/s^2 — snappy but controllable
const FRICTION = 9; // u/s^2 drift decay with no input
const BUMP_REST = 0.8; // restitution on character bump (bouncy!)
const WALL_REST = 0.55; // restitution on the rim wall
const RING_START = 5.6; // ring begins just inside the wall (6.0)
const RING_END = 0.45; // ring final radius — SMALLER than a player footprint
// (CHAR_R = 0.55): at most one player can physically fit inside, so the
// finale is a forced knockout, never a timer tiebreak.
const RING_DURATION = 26; // seconds for the ring to fully close
const TIME_CAP = 28; // safety net only — the closed ring forces the
// knockout by ~22.5s; never float-distance tiebreaks (see endGameByCap)
const ELIM_FALL_TIME = 0.6; // eliminated fall+sink animation length
const SPAWN_RADIUS = 3.5; // quarter-point spawn ring
const BOING_GAP = 0.09; // sfx throttle between boings
const POINTER_AUTO_RELEASE = 0.5; // held pointer with no events => release
const KEY_STALE = 0.35; // keyboard steer drops after this long without keys
const WALL_CLAMP = ARENA_R - CHAR_R - 0.05;

const SPAWN_ANGLES = [Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (7 * Math.PI) / 4];

/* ------------------------------ types ------------------------------- */

interface Body {
  id: number;
  holder: THREE.Group;
  x: number;
  z: number;
  vx: number;
  vz: number;
  alive: boolean;
  fallT: number;
  moving: boolean; // last move-anim state (walk vs idle)
  animHoldT: number; // squash/jump hold — don't re-apply move anim during it
  brain: CpuBrain;
}

interface HumanInput {
  held: boolean;
  tx: number; // pointer target, normalized 0..1 screen coords
  ty: number;
  idleT: number; // seconds since the last routed pointer event
  keyDir: { x: number; z: number } | null;
  keyIdleT: number;
  lastJumpT: number;
}

interface RoundState {
  ctx: MinigameContext;
  arena: ArenaHandle | null;
  bodies: Body[];
  aliveCount: number;
  elimOrder: number[];
  ended: boolean;
  boingT: number;
  shakeT: number;
  ringClosedAnnounced: boolean;
  human: HumanInput;
  camBase: THREE.Vector3;
  lookX: number;
  lookZ: number;
  raycaster: THREE.Raycaster;
  plane: THREE.Plane;
  scratch: THREE.Vector3;
  onPointerUp: () => void;
}

/** Shrinking ring radius at play time t. ACCELERATING ease (outQuad: slow
 * open, fast close) so the squeeze gathers speed — the ring passes below
 * the player footprint radius (~0.55) at ~22.4s and holds at 0.45 from 26s,
 * geometrically forcing the final knockouts well before TIME_CAP. */
function ringRadiusAt(t: number): number {
  const u = Math.min(1, t / RING_DURATION);
  const e = 2 * u - u * u; // outQuad — deterministic pure function of t
  return RING_START - (RING_START - RING_END) * e;
}

/* --------------------------- implementation -------------------------- */

export const bumperBallsMinigame: Minigame = {
  id: "bumper_balls",
  name: "Bumper Balls",
  genre: "survival",

  setup(ctx: MinigameContext): void {
    /* ---- camera: party top-down on the stage ---- */
    /* Round lifecycle is strictly sequential (setup -> updates -> teardown
       -> setup again), so a module-level round handle is safe and keeps
       per-round state out of the cached instance object. */
    const cam = ctx.camera;
    const portrait = window.innerWidth / window.innerHeight < 1;
    cam.fov = portrait ? 55 : 60;
    cam.updateProjectionMatrix();
    const camBase = new THREE.Vector3(0, portrait ? 23.5 : 9.6, portrait ? 8.2 : 5.2);
    cam.position.copy(camBase);
    cam.lookAt(0, 0, portrait ? 0.5 : 1.0);

    const state: RoundState = {
      ctx,
      arena: null,
      bodies: [],
      aliveCount: 4,
      elimOrder: [],
      ended: false,
      boingT: 0,
      shakeT: 0,
      ringClosedAnnounced: false,
      human: { held: false, tx: 0.5, ty: 0.5, idleT: 0, keyDir: null, keyIdleT: 0, lastJumpT: -10 },
      camBase,
      lookX: 0,
      lookZ: portrait ? 0.5 : 1.0,
      raycaster: new THREE.Raycaster(),
      plane: new THREE.Plane(new THREE.Vector3(0, 1, 0), 0),
      scratch: new THREE.Vector3(),
      onPointerUp: () => {
        state.human.held = false;
      },
    };

    /* ---- bodies + holders (holder owns the fall/sink so the anim
       controller's group transforms never fight us) ---- */
    const spawnPoints: { x: number; z: number }[] = [];
    ctx.players.forEach((p, i) => {
      const a = SPAWN_ANGLES[i] ?? 0;
      const x = Math.cos(a) * SPAWN_RADIUS + (ctx.rng() - 0.5) * 0.6;
      const z = Math.sin(a) * SPAWN_RADIUS + (ctx.rng() - 0.5) * 0.6;
      spawnPoints.push({ x, z });

      const holder = new THREE.Group();
      holder.position.set(x, 0, z);
      ctx.scene.add(holder);

      const ch = ctx.characters[i];
      ctx.scene.remove(ch.group); // reparent under the holder
      holder.add(ch.group);
      ch.setFacing(Math.atan2(-x, -z)); // face the centre
      ch.anim.idle();

      state.bodies.push({
        id: p.id,
        holder,
        x,
        z,
        vx: 0,
        vz: 0,
        alive: true,
        fallT: 0,
        moving: false,
        animHoldT: 0,
        brain: freshBrain(),
      });
    });

    state.arena = buildArena(
      ctx.scene,
      spawnPoints,
      ctx.players.map((p) => characterColor(p.kind))
    );

    /* ---- human input (screen routes pointer + keys while playing) ---- */
    ctx.input.pointer = (x, y, down): void => {
      state.human.tx = x;
      state.human.ty = y;
      state.human.idleT = 0;
      if (down) state.human.held = true;
    };
    ctx.input.key = (action: string): void => {
      if (action === "up") state.human.keyDir = { x: 0, z: -1 };
      else if (action === "down") state.human.keyDir = { x: 0, z: 1 };
      else if (action === "left") state.human.keyDir = { x: -1, z: 0 };
      else if (action === "right") state.human.keyDir = { x: 1, z: 0 };
      else if (action === "confirm") {
        const b = state.bodies[0];
        if (b && b.alive && ctx.time - state.human.lastJumpT > 0.5) {
          state.human.lastJumpT = ctx.time;
          b.animHoldT = Math.max(b.animHoldT, 0.45);
          ctx.characters[0]?.anim.jump();
          ctx.playSfx("jump", { volume: 0.45, pitch: 1.15 });
        }
        return;
      } else {
        return;
      }
      state.human.keyIdleT = 0;
    };
    window.addEventListener("pointerup", state.onPointerUp);
    round = state;
    // Fresh telemetry mirror per round (critic probes read window.__BB__).
    (window as unknown as { __BB__?: unknown }).__BB__ = undefined;
    publishDebug(state, 0, ringRadiusAt(0));
  },

  update(dt: number): void {
    const state = round;
    if (!state) return;
    const ctx = state.ctx;
    const t = ctx.time;

    for (const b of state.bodies) if (!b.alive) updateFall(state, b, dt);
    updateCamera(state, dt);

    if (state.ended) return;

    /* ---- input freshness ---- */
    state.human.idleT += dt;
    if (state.human.held && state.human.idleT > POINTER_AUTO_RELEASE) state.human.held = false;
    state.human.keyIdleT += dt;
    if (state.human.keyDir && state.human.keyIdleT > KEY_STALE) state.human.keyDir = null;

    const ringR = ringRadiusAt(t);

    /* ---- steer + integrate (id order: 0 human, 1-3 CPU) ---- */
    for (const b of state.bodies) {
      if (!b.alive) continue;
      b.animHoldT = Math.max(0, b.animHoldT - dt);

      let dir: { x: number; z: number } | null = null;
      let maxSpeed = HUMAN_SPEED;
      if (b.id === 0) {
        if (state.human.held) dir = pointerDir(state, b);
        else if (state.human.keyDir) dir = state.human.keyDir;
      } else {
        b.brain.pickT -= dt;
        if (b.brain.pickT <= 0) repick(b.brain, ctx);
        const rivals: CpuRival[] = [];
        for (const o of state.bodies) {
          if (o.alive && o.id !== b.id) rivals.push({ id: o.id, x: o.x, z: o.z });
        }
        dir = cpuDesiredDir(b, rivals, ringR, b.brain);
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

      b.x += b.vx * dt;
      b.z += b.vz * dt;

      /* ---- rim wall: clamp + reflect + squash ---- */
      const d = Math.hypot(b.x, b.z);
      if (d > WALL_CLAMP && d > 1e-6) {
        const nx = b.x / d;
        const nz = b.z / d;
        b.x = nx * WALL_CLAMP;
        b.z = nz * WALL_CLAMP;
        const rv = b.vx * nx + b.vz * nz;
        if (rv > 0) {
          b.vx -= (1 + WALL_REST) * rv * nx;
          b.vz -= (1 + WALL_REST) * rv * nz;
          b.vx *= 0.96;
          b.vz *= 0.96;
          bumpJuice(state, b, rv > 2.5);
        }
      }

      b.holder.position.x = b.x;
      b.holder.position.z = b.z;
      applyMoveAnim(state, b);
    }

    /* ---- circle-circle collisions (equal mass, elastic-ish) ---- */
    for (let i = 0; i < state.bodies.length; i++) {
      const a = state.bodies[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < state.bodies.length; j++) {
        const b = state.bodies[j];
        if (!b.alive) continue;
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
          const imp = (-(1 + BUMP_REST) * rv) / 2;
          a.vx -= imp * nx;
          a.vz -= imp * nz;
          b.vx += imp * nx;
          b.vz += imp * nz;
        }
        bumpJuice(state, a, -rv > 3.2);
        bumpJuice(state, b, -rv > 3.2);
      }
    }
    for (const b of state.bodies) {
      if (!b.alive) continue;
      b.holder.position.x = b.x;
      b.holder.position.z = b.z;
    }

    /* ---- the ring: anyone pushed beyond it is out. ONE elimination per
       frame, lowest player id first — the round walks 4->3->2->1 in distinct
       deterministic steps, and once the ring is below the footprint radius
       (r < CHAR_R) at most one player can fit inside, so the finale is a
       forced knockout, never a frame-timing tiebreak. ---- */
    let outBody: Body | null = null;
    for (const b of state.bodies) {
      if (!b.alive) continue;
      if (Math.hypot(b.x, b.z) > ringR && (outBody === null || b.id < outBody.id)) {
        outBody = b;
      }
    }
    if (outBody) eliminate(state, outBody);

    if (state.ended) return;
    if (state.aliveCount === 1) {
      const winner = state.bodies.find((b) => b.alive);
      // Only crown a survivor who is actually inside the ring; a sole
      // survivor still outside it gets popped by the ring next frame.
      if (winner && Math.hypot(winner.x, winner.z) <= ringR) {
        endGame(state, winner.id);
        return;
      }
    }
    if (state.aliveCount === 0) {
      // Unreachable with the geometric ring, but never rank an empty board:
      // the last player out is the survivor.
      endGame(state, state.elimOrder[state.elimOrder.length - 1]);
      return;
    }
    if (t >= TIME_CAP) {
      endGameByCap(state);
      return;
    }

    /* ---- danger tint + ring-close callout ---- */
    let danger = 0;
    for (const b of state.bodies) {
      if (!b.alive) continue;
      const margin = ringR - Math.hypot(b.x, b.z);
      danger = Math.max(danger, THREE.MathUtils.clamp(1 - margin / 1.1, 0, 1));
    }
    danger = Math.min(1, danger * 0.75 + (Math.min(1, t / RING_DURATION)) * 0.35);

    if (!state.ringClosedAnnounced && t >= 13) {
      state.ringClosedAnnounced = true;
      ctx.announce("RING CLOSES!", { durationMs: 1300, sound: "whoosh" });
    }

    state.arena?.update(t, ringR, danger);
    publishDebug(state, t, ringR);
  },

  teardown(): void {
    const state = round;
    if (!state) return;
    window.removeEventListener("pointerup", state.onPointerUp);
    state.arena?.dispose();
    state.arena = null;
    for (const b of state.bodies) {
      const ch = state.ctx.characters[b.id];
      b.holder.remove(ch.group); // hand the avatar back to the screen
      state.ctx.scene.add(ch.group);
      state.ctx.scene.remove(b.holder);
    }
    state.bodies = [];
    round = null;
  },
};

/* ----------------------------- helpers ------------------------------ */

// Module-level round handle: replaced by setup() each round, nulled on
// teardown. Rounds are strictly sequential (setup -> updates -> teardown).
let round: RoundState | null = null;

function applyMoveAnim(state: RoundState, b: Body): void {
  if (!b.alive || b.animHoldT > 0) return;
  const sp = Math.hypot(b.vx, b.vz);
  const moving = sp > 0.35;
  if (moving !== b.moving) {
    b.moving = moving;
    const ch = state.ctx.characters[b.id];
    if (moving) {
      ch?.anim.walk();
      ch?.setFacing(Math.atan2(b.vx, b.vz));
    } else {
      ch?.anim.idle();
    }
  } else if (moving) {
    state.ctx.characters[b.id]?.setFacing(Math.atan2(b.vx, b.vz));
  }
}

function bumpJuice(state: RoundState, b: Body, hard: boolean): void {
  b.animHoldT = Math.max(b.animHoldT, 0.14);
  state.ctx.characters[b.id]?.anim.squash();
  if (state.boingT <= 0) {
    state.boingT = BOING_GAP;
    state.ctx.playSfx("boing", { volume: 0.7, pitch: 0.9 + (b.id % 4) * 0.07 });
  }
  if (hard) state.shakeT = Math.min(0.14, state.shakeT + 0.1);
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

function updateFall(state: RoundState, b: Body, dt: number): void {
  b.fallT += dt;
  const k = Math.min(1, b.fallT / ELIM_FALL_TIME);
  const e = k * k; // accelerate into the fall
  b.holder.rotation.x = -1.35 * e; // tip forward
  b.holder.rotation.z = 0.16 * e; // little roll
  b.holder.position.y = -0.5 * e; // sink through the floor
}

function eliminate(state: RoundState, b: Body): void {
  b.alive = false;
  b.vx = 0;
  b.vz = 0;
  state.aliveCount--;
  state.elimOrder.push(b.id);
  state.ctx.characters[b.id]?.anim.sad();
  state.ctx.playSfx("pop", { volume: 0.85, pitch: 0.85 + b.id * 0.06 });
  if (state.aliveCount >= 2) {
    const p = state.ctx.players[b.id];
    state.ctx.announce(`${p.name} is OUT!`, { durationMs: 1100, sound: "crowd.aah" });
  }
}

/**
 * Critic telemetry: mirrors the live round onto window.__BB__ so a probe can
 * trace the ring schedule, the elimination order and which end path fired
 * without inferring it from banner text. Write-only mirror — the game never
 * reads it back, so it cannot affect determinism.
 */
interface BBDebug {
  t: number;
  ringR: number;
  alive: number[];
  elimOrder: number[];
  ended: boolean;
  endPath: "knockout" | "cap" | null;
  ranking: number[] | null;
}
function bbDebug(): BBDebug {
  const w = window as unknown as { __BB__?: BBDebug };
  if (!w.__BB__) {
    w.__BB__ = { t: 0, ringR: 0, alive: [], elimOrder: [], ended: false, endPath: null, ranking: null };
  }
  return w.__BB__;
}
function publishDebug(state: RoundState, t: number, ringR: number): void {
  const d = bbDebug();
  d.t = +t.toFixed(3);
  d.ringR = +ringR.toFixed(4);
  d.alive = state.bodies.filter((b) => b.alive).map((b) => b.id);
  d.elimOrder = [...state.elimOrder];
  d.ended = state.ended;
}
function recordEnd(path: "knockout" | "cap", state: RoundState, ranking: number[]): void {
  const d = bbDebug();
  d.ended = true;
  d.endPath = path;
  d.ranking = [...ranking];
  d.elimOrder = [...state.elimOrder];
  d.alive = state.bodies.filter((b) => b.alive).map((b) => b.id);
}

function endGame(state: RoundState, winnerId: number): void {
  state.ended = true;
  const ranking = [winnerId, ...state.elimOrder.slice().reverse()];
  recordEnd("knockout", state, ranking);
  state.ctx.finish(ranking);
  const p = state.ctx.players[winnerId];
  state.ctx.characters[winnerId]?.anim.cheer();
  state.ctx.playSfx("crowd.cheer", { volume: 0.85 });
  ui.confettiBurst(undefined, undefined, { count: 90, sound: null });
  state.ctx.announce(`${p.name} WINS BUMPER BALLS!`, { durationMs: 2400, sound: null });
}

/**
 * Time-cap end — safety net ONLY. The ring closes below the player
 * footprint (RING_END 0.45 < CHAR_R 0.55) by 26s, geometrically forcing the
 * knockout by ~22.5s, so this should never rank live survivors. If it ever
 * fires, rank deterministically by player id — never by floating-point
 * distances, which vary with frame timing between replays.
 */
function endGameByCap(state: RoundState): void {
  state.ended = true;
  const survivors = state.bodies
    .filter((b) => b.alive)
    .sort((a, b) => a.id - b.id);
  const ranking = [...survivors.map((b) => b.id), ...state.elimOrder.slice().reverse()];
  recordEnd("cap", state, ranking);
  state.ctx.finish(ranking);
  const winnerId = ranking[0];
  const p = state.ctx.players[winnerId];
  state.ctx.characters[winnerId]?.anim.cheer();
  state.ctx.playSfx("crowd.cheer", { volume: 0.85 });
  ui.confettiBurst(undefined, undefined, { count: 90, sound: null });
  state.ctx.announce(`${p.name} WINS BUMPER BALLS!`, { durationMs: 2400, sound: null });
}

function updateCamera(state: RoundState, dt: number): void {
  const cam = state.ctx.camera;
  if (state.shakeT > 0) {
    state.shakeT -= dt;
    const s = Math.max(0, state.shakeT) * 1.8;
    cam.position.x = state.camBase.x + Math.sin(state.ctx.time * 83.7) * s * 0.35;
    cam.position.y = state.camBase.y + Math.cos(state.ctx.time * 61.3) * s * 0.35;
    cam.position.z = state.camBase.z;
  } else {
    cam.position.copy(state.camBase);
  }
  cam.lookAt(state.lookX, 0, state.lookZ);
}
