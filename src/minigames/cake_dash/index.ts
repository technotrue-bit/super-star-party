/**
 * CAKE DASH — a 4-lane side-view race to a giant cake.
 *
 * Everyone auto-runs rightward at 6 u/s down their lane; the whole course's
 * obstacles are pre-generated at setup (cake towers, puddings, forks — jump
 * them; confetti puddles — jump or slip). Human jumps on pointer press / up
 * / confirm (0.15s buffer, generous hitboxes). CPUs react with per-obstacle
 * plans drawn at setup (skill-gated attempt + mis-time rolls) so they win
 * sometimes and trip sometimes — never psychic.
 *
 * Determinism: the ONLY randomness is ctx.rng (skills + spawn cursors at
 * setup; kind/gap/CPU plan per spawn; confetti velocities at the win).
 * Animation advances purely by dt. The character's own jump anim owns the
 * visible arc; a holder group adds the remaining arc lift so the gameplay
 * apex is 1.3 (visual = anim arc + holder, always in sync since both run
 * on the same dt).
 *
 * Finish: first across x=52 wins — announce + crowd cheer + confetti at the
 * cake, 0.9s victory beat, then ctx.finish(ranking). 25s cap ranks by
 * distance (tie → smaller playerId).
 */
import * as THREE from "three";
import type { Minigame, MinigameContext } from "../framework";
import type { Character } from "../../characters/characterFactory";
import { palette, hex } from "../../config/palette";
import { Course, FINISH_X, START_X, LANE_Z } from "./course";
import {
  buildObstacle,
  cpuPlanFor,
  rollKind,
  OBSTACLE_H,
  OBSTACLE_W,
  type Obstacle,
} from "./obstacles";

/* ------------------------------------------------------------------ */
/*  Tuning                                                             */
/* ------------------------------------------------------------------ */

const SPEED = 6; // run speed (u/s)
const TIME_CAP = 25; // rank by distance if nobody finishes
const STUN_TIME = 0.6; // obstacle hit stun (s)
const SLOW_TIME = 1.0; // confetti puddle slip (s)
const SLOW_FACTOR = 0.6; // slip speed multiplier
const FLAIL_TIME = 0.55; // slip flail wobble (s)
const PULSE_WINDOW = 6.0; // warning pulse reach ahead of the leader (u)
const PULSE_AMOUNT = 0.08; // 1.0..1.08 gentle warning pulse
const JUMP_BUFFER = 0.15; // input buffer before landing (s)
const JUMP_CROUCH = 0.12; // matches anims.ts crouch
const JUMP_AIR = 0.5; // matches anims.ts air
const JUMP_TOTAL = JUMP_CROUCH + JUMP_AIR; // grounded again at 0.62
const JUMP_APEX = 1.3; // gameplay apex (visual arc + holder lift)
const ANIM_APEX = 0.9; // the character anim's own arc apex
const HIT_SLACK = 0.25; // generous hitbox: h >= obs.h - HIT_SLACK clears
const WIN_BEAT = 0.9; // celebration beat before finish()
const LAST_SPAWN_X = FINISH_X - 3; // no obstacles in the final stretch

/* ------------------------------------------------------------------ */
/*  In-race position indicator (HUD)                                   */
/* ------------------------------------------------------------------ */

/**
 * Place is derived from runner x EVERY FRAME with the exact comparator the
 * finish logic uses (b.x - a.x || a.id - b.id) — the badge can never disagree
 * with the eventual ranking. It is pure display: no gameplay reads it, so the
 * seeded outcome (coins / wins / obstacle stream) is untouched.
 *
 * Two layers, both always visible during "play":
 *  1. A floating badge above each runner's head: 1st/2nd/3rd/4th in
 *     gold/silver/bronze/plain, scale-popping on a place change.
 *  2. A progress rail fixed at the top-left: one colour-coded segment per
 *     runner showing its fraction of the course covered, ordered top = 1st.
 *
 * Cheap: no per-frame allocation — badge sprites are created once in setup
 * and only mutated (scale / texture / material opacity); the rail meshes are
 * pre-created box+marker pairs scaled in place. Textures are cached by the
 * string that describes them, so repeat updates draw zero canvases.
 */

type BadgeTier = 0 | 1 | 2 | 3; // 1st..4th

const PLACE_WORDS = ["1st", "2nd", "3rd", "4th"] as const;
/** Badge fill colours by place — palette-derived, warm → neutral. */
const PLACE_COLORS = [palette.sun, palette.cream, "#E8A35C", palette.white] as const;
/** Badge ring colours — strong contrast on any course colour. */
const PLACE_RING = ["#B8860B", "#9A9A9A", "#A05A2C", palette.inkSoft] as const;
const BADGE_FLASH_TIME = 0.45; // s — scale-pop + colour blink on a place change

const PROGRESS_H = 0.38; // runner segment height
const PROGRESS_GAP = 0.14;
const PROGRESS_DEPTH = 0.22;
const PROGRESS_TRACK_W = 4.2; // visible rail length (world units)
/** Rail offset from the camera's look target — keeps the strip on-screen. */
const PROGRESS_LOOK_DX = -1.5; // left of the look target
const PROGRESS_LOOK_DY = 2.8; // above the look target, in the upper screen
const PROGRESS_LOOK_DZ = 0; // at the course plane

interface Badge {
  sprite: THREE.Sprite;
  tier: BadgeTier;
  flashT: number; // remaining flash time; 0 = idle
}

interface RunnerHud {
  badge: Badge;
  /** Progress rail segment (runner colour). */
  seg: THREE.Mesh;
  /** Chevron marker on the rail showing this runner's place. */
  mark: THREE.Mesh;
  /** Player accent (pip/bounce/...) — drives the rail colour. */
  color: string;
}

// The HUD reads the module-level S declared in the state section below
// (forward reference — fine because all HUD functions run after module eval).
// Position-indicator state (pure display — never read by gameplay) is kept in
// S.hud alongside the race state.

/** Cached canvas textures keyed by their exact content string. */
const badgeTexCache = new Map<string, THREE.CanvasTexture>();

function badgeTexture(text: string, fill: string, ring: string): THREE.CanvasTexture {
  const key = `${text}|${fill}|${ring}`;
  const hit = badgeTexCache.get(key);
  if (hit) return hit;

  const size = 128;
  const cv = document.createElement("canvas");
  cv.width = size;
  cv.height = size;
  const g = cv.getContext("2d")!;
  const c = size / 2;
  const r = 44;

  // Soft drop shadow so the badge reads against the sky AND the grass.
  g.clearRect(0, 0, size, size);
  g.beginPath();
  g.arc(c + 2, c + 4, r, 0, Math.PI * 2);
  g.fillStyle = "rgba(43, 29, 78, 0.35)";
  g.fill();

  // Ring + fill.
  g.beginPath();
  g.arc(c, c, r, 0, Math.PI * 2);
  g.fillStyle = fill;
  g.fill();
  g.lineWidth = 10;
  g.strokeStyle = ring;
  g.stroke();

  // Ordinal text.
  g.fillStyle = ring;
  g.font = "bold 44px system-ui, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, c, c + 2);

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  badgeTexCache.set(key, tex);
  return tex;
}

/** World position of a runner's head, given its group + holder offset. */
function headPos(r: Runner, out: THREE.Vector3): THREE.Vector3 {
  out.copy(r.char.group.position);
  out.y += 2.1; // comfortably above the character
  return out;
}

const _hv = new THREE.Vector3();
const _hv2 = new THREE.Vector3();

/** Sort runners into current places with the finish-logic comparator. */
function computePlaces(): Runner[] {
  return [...S.runners].sort((a, b) => b.x - a.x || a.id - b.id);
}

/** Distance a runner has covered, 0 at the start line, 1 at the cake. */
function courseProgress(r: Runner): number {
  return clamp((r.x - START_X) / (FINISH_X - START_X), 0, 1);
}

function ensureHud(): void {
  const scene = S.scene;
  const ctx = S.ctx;
  if (!scene || !ctx || S.hud.group) return;

  const group = new THREE.Group();
  S.hud.group = group;
  scene.add(group);

  // --- progress rail: a dim track with per-runner segments.
  // The rail's WORLD position is recomputed each frame from the camera
  // (updateHud) so the strip stays on-screen in portrait as the camera
  // tracks the leader down the course. Built once here at origin.
  const railMat = new THREE.MeshBasicMaterial({
    color: hex(palette.ink),
    transparent: true,
    opacity: 0.6,
    depthWrite: false,
  });
  const rail = new THREE.Mesh(new THREE.BoxGeometry(PROGRESS_TRACK_W + 0.5, PROGRESS_H * 4 + PROGRESS_GAP * 3 + 0.3, PROGRESS_DEPTH), railMat);
  rail.renderOrder = 17;
  group.add(rail);
  S.hud.rail = rail;

  // --- per-runner badge + rail segment ---
  const badges: RunnerHud[] = S.runners.map((r) => {
    const color = ctx.players[r.id]?.color ?? palette.white;

    // Floating badge sprite above the head.
    const mat = new THREE.SpriteMaterial({
      map: badgeTexture(PLACE_WORDS[0], PLACE_COLORS[0], PLACE_RING[0]),
      transparent: true,
      depthTest: false,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(1.3, 1.3, 1);
    sprite.renderOrder = 20;
    headPos(r, _hv);
    sprite.position.copy(_hv);
    group.add(sprite);

    // Rail segment (runner colour).
    const segMat = new THREE.MeshBasicMaterial({
      color: hex(color),
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
    });
    const seg = new THREE.Mesh(new THREE.BoxGeometry(1, PROGRESS_H, PROGRESS_DEPTH + 0.06), segMat);
    seg.renderOrder = 18;
    group.add(seg);

    // Place chevron marker on the rail.
    const markMat = new THREE.MeshBasicMaterial({
      color: hex(color),
      transparent: true,
      opacity: 1,
      depthWrite: false,
    });
    const mark = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.36, 4), markMat);
    mark.rotation.z = -Math.PI / 2; // point right, reads as a position arrow
    mark.renderOrder = 19;
    group.add(mark);

    return {
      badge: { sprite, tier: 0 as BadgeTier, flashT: 0 },
      seg,
      mark,
      color,
    };
  });

  S.hud.runners = badges;
}

/** Update badges + rail. Call AFTER runner positions are final for the frame. */
function updateHud(): void {
  const hud = S.hud;
  if (!hud.group || S.phase !== "play") return;

  const places = computePlaces();
  const n = S.runners.length;

  // --- progress rail: anchor to the camera's look target so it stays on-screen ---
  const cam = S.ctx?.camera;
  if (cam && hud.rail) {
    // The camera looks at S.camLook; position the rail relative to that
    // point so it stays in the upper-left of the screen.
    hud.rail.position.set(
      S.camLook.x + PROGRESS_LOOK_DX,
      S.camLook.y + PROGRESS_LOOK_DY,
      S.camLook.z + PROGRESS_LOOK_DZ
    );
  }
  const railX = hud.rail ? hud.rail.position.x : 0;
  const railY = hud.rail ? hud.rail.position.y : 0;
  const railZ = hud.rail ? hud.rail.position.z : 0;

  for (let i = 0; i < n; i++) {
    const r = S.runners[i];
    const h = hud.runners[i];
    const place = places.indexOf(r); // 0..3
    const tier = place as BadgeTier;

    // Badge texture + flash on place change.
    if (tier !== h.badge.tier) {
      h.badge.tier = tier;
      h.badge.flashT = BADGE_FLASH_TIME;
      (h.badge.sprite.material as THREE.SpriteMaterial).map = badgeTexture(
        PLACE_WORDS[tier],
        PLACE_COLORS[tier],
        PLACE_RING[tier]
      );
    }

    // Flash: scale pop + material opacity blink, decaying to idle.
    let scale = 1.3;
    let opacity = 1;
    if (h.badge.flashT > 0) {
      h.badge.flashT -= 1 / 60;
      const p = Math.max(0, h.badge.flashT) / BADGE_FLASH_TIME;
      scale = 1.3 + 0.55 * Math.sin(Math.min(1, 1 - p) * Math.PI); // pop up then settle
      opacity = 0.55 + 0.45 * Math.sin(p * Math.PI * 3); // blink while it lasts
    }
    h.badge.sprite.scale.set(scale, scale, 1);
    (h.badge.sprite.material as THREE.SpriteMaterial).opacity = opacity;

    // Position the badge above the runner's head.
    headPos(r, _hv);
    h.badge.sprite.position.copy(_hv);

    // Rail segment: width ∝ course progress, stacked by place (1st on top).
    const prog = courseProgress(r);
    const segW = Math.max(0.02, prog * PROGRESS_TRACK_W);
    h.seg.scale.x = segW;
    h.seg.position.set(
      railX + segW / 2,
      railY + ((n - 1) / 2 - place) * (PROGRESS_H + PROGRESS_GAP),
      railZ
    );

    // Chevron marker: slides to the segment's leading edge, stacked by place.
    h.mark.position.set(
      railX + segW,
      railY + ((n - 1) / 2 - place) * (PROGRESS_H + PROGRESS_GAP),
      railZ
    );
    h.mark.rotation.y = (place * Math.PI) / 2; // rotate per place so the stack reads
  }
}

function teardownHud(): void {
  const scene = S.scene;
  if (scene && S.hud.group) {
    scene.remove(S.hud.group);
  }
  S.hud.group = null;
  S.hud.rail = null;
  S.hud.runners = [];
}

type AnimName = "idle" | "walk" | "jump" | "cheer" | "sad" | "squash";

interface Runner {
  id: number;
  char: Character;
  holder: THREE.Group;
  lane: number;
  x: number;
  jumpT: number;
  grounded: boolean;
  buffer: number;
  landT: number;
  stunT: number;
  slowT: number;
  flailT: number;
  anim: AnimName;
  skill: number; // CPU only
}

/** One shard of a penalty burst (confetti splash / cake crumbs). */
interface BurstShard {
  mesh: THREE.Mesh;
  vx: number;
  vy: number;
  vz: number;
  rx: number;
  ry: number;
  rz: number;
  t: number;
  life: number;
}

type Phase = "play" | "win" | "idle";

const S = {
  ctx: null as MinigameContext | null,
  scene: null as THREE.Scene | null,
  course: null as Course | null,
  runners: [] as Runner[],
  obstacles: [] as Obstacle[],
  nextSpawn: [0, 0, 0, 0],
  phase: "idle" as Phase,
  winT: 0,
  t: 0, // animation clock (dt-driven only — never gameplay decisions)
  ranking: [] as number[],
  announced: false,
  shakeT: 0,
  bursts: [] as BurstShard[],
  camLook: new THREE.Vector3(),
  /** Position indicator (pure display — never read by gameplay). */
  hud: {
    group: null as THREE.Group | null,
    rail: null as THREE.Mesh | null,
    runners: [] as RunnerHud[],
  },
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function animTo(r: Runner, name: AnimName): void {
  if (r.anim === name) return;
  r.anim = name;
  r.char.anim[name]();
}

/** Gameplay jump height (mirrors the anim arc, with holder lift added). */
function jumpH(r: Runner): number {
  const t = r.jumpT;
  if (t < JUMP_CROUCH || t >= JUMP_TOTAL) return 0;
  const p = (t - JUMP_CROUCH) / JUMP_AIR;
  return Math.sin(Math.PI * Math.min(p, 1)) * JUMP_APEX;
}

/** The holder lift: gameplay arc minus the anim's own arc. */
function holderLift(r: Runner): number {
  const t = r.jumpT;
  if (t < JUMP_CROUCH || t >= JUMP_TOTAL) return 0;
  const p = (t - JUMP_CROUCH) / JUMP_AIR;
  const s = Math.sin(Math.PI * Math.min(p, 1));
  return s * (JUMP_APEX - ANIM_APEX);
}

function startJump(r: Runner): void {
  r.grounded = false;
  r.jumpT = 0;
  r.landT = 0;
  animTo(r, "jump");
  S.ctx?.playSfx("jump", { pitch: 1.05 });
}

function pressJump(pid: number): void {
  if (S.phase !== "play") return;
  const r = S.runners[pid];
  if (!r) return;
  if (r.grounded) startJump(r);
  else r.buffer = JUMP_BUFFER;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/* ------------------------------------------------------------------ */
/*  Penalty bursts (slip splash + hit crumbs)                          */
/* ------------------------------------------------------------------ */

const BURST_COLORS = [palette.candy, palette.sun, palette.mint, palette.bubble, palette.berry, palette.cream];
const CRUMB_COLORS = [palette.cream, palette.sun, palette.berry, palette.candy, palette.mint];

/** Deterministic 32-bit hash → 0..1. NO ctx.rng here: collisions are
 *  frame-timed, so drawing from the seeded stream in collide() would make
 *  the rng position frame-dependent (breaks seeded replays). This integer
 *  hash stream is byte-stable for the same event sequence. */
let burstSeq = 0;
function hash01(n: number): number {
  let x = (n * 2654435761) >>> 0;
  x ^= x >>> 13;
  x = (x * 2246822519) >>> 0;
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

/** Small colored-shard burst at (x, z) so penalty causes read on screen. */
function burstAt(x: number, z: number, colors: string[], count: number, power: number): void {
  const ctx = S.ctx;
  const assets = S.course?.assets;
  if (!ctx || !assets || !S.scene) return;
  const geo = assets.geo(new THREE.BoxGeometry(0.07, 0.07, 0.07));
  for (let i = 0; i < count; i++) {
    const c = colors[Math.floor(hash01(burstSeq * 13 + i * 7) * colors.length)];
    const mesh = new THREE.Mesh(geo, assets.flat(c));
    const a = hash01(burstSeq * 31 + i * 3) * Math.PI * 2;
    const sp = 1.2 + hash01(burstSeq * 17 + i * 11) * 1.6;
    mesh.position.set(x, 0.3, z);
    S.scene.add(mesh);
    S.bursts.push({
      mesh,
      vx: Math.cos(a) * sp * power,
      vy: 2.6 + hash01(burstSeq * 5 + i) * 2.2,
      vz: Math.sin(a) * sp * power,
      rx: (hash01(burstSeq * 23 + i * 5) - 0.5) * 16,
      ry: (hash01(burstSeq * 29 + i * 9) - 0.5) * 16,
      rz: (hash01(burstSeq * 37 + i * 13) - 0.5) * 16,
      t: 0,
      life: 0.45 + hash01(burstSeq * 41 + i * 17) * 0.35,
    });
    burstSeq++;
  }
}

function updateBursts(dt: number): void {
  const scene = S.scene;
  if (!scene || S.bursts.length === 0) return;
  for (let i = S.bursts.length - 1; i >= 0; i--) {
    const b = S.bursts[i];
    b.t += dt;
    b.vy -= 9.5 * dt;
    b.mesh.position.x += b.vx * dt;
    b.mesh.position.y += b.vy * dt;
    b.mesh.position.z += b.vz * dt;
    b.mesh.rotation.x += b.rx * dt;
    b.mesh.rotation.y += b.ry * dt;
    b.mesh.rotation.z += b.rz * dt;
    if (b.t >= b.life) {
      scene.remove(b.mesh);
      S.bursts.splice(i, 1);
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Setup                                                              */
/* ------------------------------------------------------------------ */

function setup(ctx: MinigameContext): void {
  S.ctx = ctx;
  S.scene = ctx.scene;
  S.phase = "play";
  S.winT = 0;
  S.ranking = [];
  S.announced = false;
  S.shakeT = 0;
  S.t = 0;
  S.bursts = [];
  S.obstacles = [];
  S.runners = [];
  S.course = new Course(ctx.scene);

  // Runners: lane = 3 - playerId so the human (id 0) runs the lane nearest
  // the camera. Characters live in a holder group that carries the extra
  // jump arc lift; the screen still finds char.group for its own cleanup.
  S.runners = ctx.players.map((p, i) => {
    const char = ctx.characters[i];
    const holder = new THREE.Group();
    holder.add(char.group);
    ctx.scene.add(holder);
    const runner: Runner = {
      id: p.id,
      char,
      holder,
      lane: 3 - i,
      x: START_X,
      jumpT: 0,
      grounded: true,
      buffer: 0,
      landT: 0,
      stunT: 0,
      slowT: 0,
      flailT: 0,
      anim: "idle",
      skill: 0,
    };
    char.group.position.set(START_X, 0, LANE_Z[runner.lane]);
    char.setFacing(Math.PI / 2); // front is +Z → +X faces the cake
    char.anim.idle();
    return runner;
  });

  // CPU skill (players 1..3) + per-lane spawn cursors — fixed rng order.
  for (let i = 1; i < 4; i++) S.runners[i].skill = 0.84 + ctx.rng() * 0.16;
  for (let l = 0; l < 4; l++) S.nextSpawn[l] = 11 + ctx.rng() * 5;
  pregenerateObstacles();

  // Camera frames the start line during the countdown.
  const cam = ctx.camera;
  cam.position.set(START_X + 7.2, 4.4, 9.6);
  S.camLook.set(START_X + 3.2, 1.5, 0);
  cam.lookAt(S.camLook);

  // Human input: any press jumps (buffered 0.15s if pressed mid-air).
  ctx.input.pointer = (x, y, down) => {
    if (down) pressJump(0);
  };
  ctx.input.key = (action) => {
    if (action === "up" || action === "confirm") pressJump(0);
  };

  // Build the position indicator AFTER runners exist (badge above each head).
  ensureHud();
  updateHud(); // place everyone correctly on frame 1
}

/* ------------------------------------------------------------------ */
/*  Per-frame systems                                                  */
/* ------------------------------------------------------------------ */

function pregenerateObstacles(): void {
  const ctx = S.ctx;
  if (!ctx) return;
  // Everything is drawn here, once, in fixed lane order — the seeded rng
  // stream position is therefore identical for every frame of the race
  // (per-frame spawning would make the global draw order frame-dependent).
  for (let lane = 0; lane < 4; lane++) {
    while (S.nextSpawn[lane] < LAST_SPAWN_X) {
      const x = S.nextSpawn[lane];
      const kind = rollKind(ctx.rng());
      const group = buildObstacle(kind, S.course!.assets);
      group.position.set(x, 0, LANE_Z[lane]);
      ctx.scene.add(group);
      S.obstacles.push({
        kind,
        lane,
        x,
        h: OBSTACLE_H[kind],
        w: OBSTACLE_W[kind],
        group,
        plan: cpuPlanFor(lane, S.runners[3 - lane].skill, ctx.rng),
        planUsed: false,
        consumed: false,
      });
      const gap = 5.8 + ctx.rng() * 3.6 - Math.min(2.4, x * 0.045);
      S.nextSpawn[lane] = x + gap;
    }
  }
}

function cpuThink(r: Runner): void {
  if (!r.grounded || r.stunT > 0) return;
  for (const o of S.obstacles) {
    if (o.lane !== r.lane || !o.plan || o.planUsed || o.consumed) continue;
    const d = o.x - o.w / 2 - (r.x + 0.35);
    if (d <= 0) {
      o.planUsed = true; // passed it without jumping
      continue;
    }
    if (!o.plan.attempt) continue; // didn't see it in time — runs into it
    const jd = o.plan.mistimed ? Math.max(0.15, 2.5 - o.plan.lateBy * 6) : o.plan.triggerDist;
    if (d <= jd) {
      o.planUsed = true;
      startJump(r);
      return;
    }
  }
}

function collide(r: Runner): void {
  const h = jumpH(r);
  for (const o of S.obstacles) {
    if (o.lane !== r.lane || o.consumed) continue;
    if (Math.abs(r.x - o.x) > 0.35 + o.w / 2) continue;
    o.consumed = true;
    if (o.kind === "puddle") {
      if (h < 0.05) {
        // SLIP — read the cause: flail, confetti splash, whoosh+pop, toast.
        r.slowT = SLOW_TIME;
        r.flailT = FLAIL_TIME;
        animTo(r, "sad");
        burstAt(o.x, LANE_Z[o.lane], BURST_COLORS, 7, 1);
        S.ctx?.playSfx("whoosh", { pitch: 0.7, volume: 0.8 });
        S.ctx?.playSfx("pop", { pitch: 0.5, volume: 0.5 });
        const nm = S.ctx?.players[r.id]?.name ?? "?";
        S.ctx?.announce(`${nm} slipped!`, { durationMs: 900, sound: null });
        S.shakeT = 0.25;
      }
    } else if (h < o.h - HIT_SLACK) {
      r.stunT = STUN_TIME;
      r.buffer = 0;
      r.jumpT = JUMP_TOTAL;
      r.grounded = true;
      r.landT = 0;
      animTo(r, "sad");
      burstAt(o.x, LANE_Z[o.lane], CRUMB_COLORS, 6, 0.85); // crumb burst — cause reads
      S.ctx?.playSfx("pop", { pitch: 0.75 });
      S.ctx?.playSfx("crowd.aah", { volume: 0.6 });
      S.shakeT = 0.3;
    }
  }
}

function enterWin(crossed: Runner[]): void {
  const ctx = S.ctx;
  if (!ctx) return;
  S.phase = "win";
  S.winT = WIN_BEAT;

  crossed.sort((a, b) => b.x - a.x || a.id - b.id);
  const winner = crossed[0];
  const rest = [...S.runners].filter((r) => r !== winner).sort((a, b) => b.x - a.x || a.id - b.id);
  S.ranking = [winner.id, ...rest.map((r) => r.id)];

  // Stop everyone: winner steps onto the cake plate and cheers.
  for (const r of S.runners) {
    r.x = Math.min(r.x, FINISH_X + 1.3);
    r.char.group.position.x = r.x;
    r.holder.position.y = 0;
    animTo(r, r === winner ? "cheer" : "idle");
  }

  const wname = ctx.players[winner.id]?.name ?? "?";
  ctx.announce(`${wname} TAKES THE CAKE!`);
  ctx.playSfx("crowd.cheer");
  S.course?.confettiBurst(FINISH_X + 3, 0, ctx.rng);
}

function finishByDistance(timeUp: boolean): void {
  const ctx = S.ctx;
  if (!ctx) return;
  S.ranking = [...S.runners]
    .sort((a, b) => b.x - a.x || a.id - b.id)
    .map((r) => r.id);
  if (timeUp) ctx.announce("TIME'S UP!");
  ctx.finish(S.ranking);
  S.phase = "idle";
}

function updateCamera(dt: number): void {
  const ctx = S.ctx;
  if (!ctx) return;
  const cam = ctx.camera;
  let leaderX = START_X;
  for (const r of S.runners) if (r.x > leaderX) leaderX = r.x;

  const k = 1 - Math.exp(-5 * dt);
  const tx = clamp(leaderX + 7.2, START_X + 7.2, 64);
  cam.position.x += (tx - cam.position.x) * k;
  cam.position.y += (4.4 - cam.position.y) * k;
  cam.position.z += (9.6 - cam.position.z) * k;
  const lx = clamp(leaderX + 3.2, START_X + 3.2, 58);
  S.camLook.x += (lx - S.camLook.x) * k;
  S.camLook.y += (1.5 - S.camLook.y) * k;
  S.camLook.z += (0 - S.camLook.z) * k;

  let sx = 0;
  let sy = 0;
  if (S.shakeT > 0) {
    S.shakeT -= dt;
    const a = Math.max(0, S.shakeT / 0.3);
    sx = Math.sin(S.shakeT * 60) * 0.16 * a;
    sy = Math.cos(S.shakeT * 47) * 0.1 * a;
  }
  cam.position.x += sx;
  cam.position.y += sy;
  cam.lookAt(S.camLook);
}

/* ------------------------------------------------------------------ */
/*  Update                                                             */
/* ------------------------------------------------------------------ */

function update(dt: number): void {
  const ctx = S.ctx;
  if (!ctx || !S.course || S.phase === "idle") return;

  S.t += dt; // animation clock (cosmetic only)

  if (!S.announced) {
    S.announced = true;
    ctx.announce("TAP / SPACE TO JUMP!", { durationMs: 1600 });
  }

  if (S.phase === "win") {
    S.winT -= dt;
    S.course.updateConfetti(dt);
    updateBursts(dt);
    updateCamera(dt);
    if (S.winT <= 0) {
      ctx.finish(S.ranking);
      S.phase = "idle";
    }
    return;
  }

  // Obstacles were pre-generated at setup; just track the leader for
  // scenery parallax and camera.
  let leaderX = START_X;
  for (const r of S.runners) if (r.x > leaderX) leaderX = r.x;
  S.course.updateScenery(leaderX);

  // Obstacle readability at speed: everything within ~6u ahead of the
  // leader gets a gentle 1.0..1.08 warning pulse; forks idle-wiggle.
  for (const o of S.obstacles) {
    const d = o.x - leaderX;
    if (d >= 0 && d <= PULSE_WINDOW) {
      const p = 1 + PULSE_AMOUNT * (0.5 + 0.5 * Math.sin(S.t * 6 + o.x * 1.7 + o.lane * 2.1));
      o.group.scale.setScalar(p);
    } else if (o.group.scale.x !== 1) {
      o.group.scale.setScalar(1);
    }
    if (o.kind === "fork") {
      o.group.rotation.z = Math.sin(S.t * 2.3 + o.x * 0.9) * 0.035;
    }
  }

  // Runners: jump state, movement, CPU thoughts, collisions.
  for (const r of S.runners) {
    if (!r.grounded) {
      r.jumpT += dt;
      if (r.jumpT >= JUMP_TOTAL) {
        r.grounded = true;
        r.jumpT = 0;
        r.landT = 0.3;
        animTo(r, "squash");
        ctx.playSfx("land", { pitch: 0.9 });
      }
    } else if (r.stunT <= 0) {
      if (r.buffer > 0) {
        r.buffer -= dt;
        if (r.buffer <= 0) r.buffer = 0;
        else {
          startJump(r);
          r.buffer = 0;
        }
      } else if (r.landT > 0) {
        r.landT -= dt;
        if (r.landT <= 0) animTo(r, "walk");
      } else {
        animTo(r, "walk");
      }
    }

    const spd = r.stunT > 0 ? 0 : SPEED * (r.slowT > 0 ? SLOW_FACTOR : 1);
    r.x += spd * dt;
    if (r.stunT > 0) {
      r.stunT -= dt;
      if (r.stunT <= 0) animTo(r, "walk");
    }
    if (r.slowT > 0) r.slowT -= dt;

    // Slip flail: wobble the holder while the runner shakes it off.
    if (r.flailT > 0) {
      r.flailT -= dt;
      const amp = Math.max(0, r.flailT / FLAIL_TIME);
      r.holder.rotation.z = Math.sin(r.flailT * 34) * 0.38 * amp;
      if (r.flailT <= 0) {
        r.holder.rotation.z = 0;
        if (r.stunT <= 0) animTo(r, "walk");
      }
    }

    r.char.group.position.x = r.x;
    r.holder.position.y = holderLift(r);

    if (r.id > 0) cpuThink(r);
    collide(r);
  }

  S.course.updateConfetti(dt);
  updateBursts(dt);
  updateCamera(dt);
  updateHud(); // badges + rail follow the final positions of this frame

  // Win / cap checks.
  const crossed = S.runners.filter((r) => r.x >= FINISH_X);
  if (crossed.length > 0) {
    enterWin(crossed);
  } else if (ctx.time >= TIME_CAP) {
    finishByDistance(true);
  }
}

/* ------------------------------------------------------------------ */
/*  Teardown                                                           */
/* ------------------------------------------------------------------ */

function teardown(): void {
  if (S.course) S.course.teardown();
  teardownHud();
  if (S.scene) {
    for (const o of S.obstacles) S.scene.remove(o.group);
    for (const b of S.bursts) S.scene.remove(b.mesh);
    for (const r of S.runners) {
      // The holder owns char.group; detach it back out so the framework's
      // own character cleanup keeps working, then drop the holder.
      if (r.holder.parent === S.scene) S.scene.remove(r.holder);
    }
  }
  S.bursts = [];
  S.obstacles = [];
  S.runners = [];
  if (S.ctx) {
    S.ctx.input.pointer = () => {};
    S.ctx.input.key = () => {};
  }
  S.ctx = null;
  S.scene = null;
  S.course = null;
  S.phase = "idle";
}

/* ------------------------------------------------------------------ */
/*  Module export                                                      */
/* ------------------------------------------------------------------ */

export function loadCakeDash(): Promise<Minigame> {
  return Promise.resolve({
    id: "cake_dash",
    name: "Cake Dash",
    genre: "race",
    setup,
    update,
    teardown,
  });
}
