/**
 * SUPER STAR PARTY — DRUM SOLO (rhythm).
 *
 * Four candy lanes, one drummer at the foot of each. Everyone plays the SAME
 * 16-beat chart at 120bpm (quarters, eighth-note pairs and rests — see
 * patterns.ts). A ring slides down each lane for one second and lands on the
 * mint target exactly on its note; tap as it lands.
 *
 * Judging (same windows for humans and CPUs):
 *   |err| <= 0.06s PERFECT +3, <= 0.12s GOOD +2, <= 0.18s OK +1, else MISS.
 * A human tap is judged 30ms earlier than it arrived (touch latency).
 *
 * CPU model: each CPU draws a timing spread (sd 0.05–0.12s) and a lapse
 * rate (2–8%) for the round; each note lands at arrive + 15ms + sd·N(0,1)
 * (Box-Muller on ctx.rng), or not at all on a lapse.
 *
 * Ranking: points, then PERFECT count, then lower mean timing error, then a
 * per-round coin flip (never seat order).
 *
 * Determinism: chart (3 draws), CPU timing, tie-break and particles use
 * ctx.rng only. Ring motion and judging are pure functions of ctx.time.
 */
import * as THREE from "three";
import { automatedSeatIds, isPracticeBeat, localPlayerIndex, type Minigame, type MinigameContext } from "../framework";
import { registerMinigame } from "../registry";
import { box as frameBox, frameMinigame } from "../framing";
import { viewportSize } from "../../ui/viewport";
import { palette, hex } from "../../config/palette";
import { isAutoplay } from "../../core/debug";
import { buildChart } from "./patterns";

/* ------------------------------------------------------------------ */
/*  Tunables                                                           */
/* ------------------------------------------------------------------ */

const BEAT = 0.5; // seconds per beat (120bpm)
const BEATS = 16; // song length
/** The chart starts after two count-in beats, so the first ring is visible for its whole approach. */
const LEAD_BEATS = 2;
/** Seconds a ring takes to slide from the top of the lane to the target. */
const TRAVEL = 1.0;
const PERFECT_WINDOW = 0.06;
const GOOD_WINDOW = 0.12;
const OK_WINDOW = 0.18; // absolute miss boundary
/** Touch/click latency: a human tap is judged this much earlier than it arrived. */
const INPUT_LATENCY = 0.03;
/** Two human taps closer than this are one tap (no double strikes). */
const TAP_DEBOUNCE = 0.09;
const CPU_SD: [number, number] = [0.05, 0.12];
const CPU_LAPSE: [number, number] = [0.02, 0.08];
const CPU_BIAS = 0.015;
const LANE_X = [-3, -1, 1, 3]; // lane world x (lane 0 = human, leftmost)
const SPAWN_Z = -1.8; // rings spawn here (top of lane)
const TARGET_Z = 3.0; // target ring position (bottom of lane)
const CHAR_Z = 4.15; // characters stand here, facing the camera
const STAGE_TOP = 0.4;
const TARGET_Y = STAGE_TOP + 0.085; // target ring mesh y
const RING_Y = STAGE_TOP + 0.1; // approach ring mesh y (sits just above target)
const RING_SCALE_SPAWN = 1.35; // ring scale at spawn
const RING_SCALE_ARRIVE = 1.0; // ring scale exactly on the beat (matches target)
const SONG_END = (LEAD_BEATS + BEATS) * BEAT; // 9.0s
const END_AT = SONG_END + 0.6; // final ring long resolved, announce winner
const FINISH_AT = END_AT + 1.4; // call ctx.finish once
const MAX_DOT_PARTICLES = 120;
const MAX_STAR_PARTICLES = 64;

type Tier = "perfect" | "good" | "ok" | "miss";
type RingState = "incoming" | "wait" | "flash" | "shatter";

interface RingGhost {
  mesh: THREE.Mesh;
  mat: THREE.MeshToonMaterial;
  base: number;
}

interface Ring {
  /** Note index in the chart (same for every lane). */
  beat: number;
  lane: number;
  playerId: number;
  spawnT: number;
  arriveT: number;
  state: RingState;
  stateT: number; // ctx.time when state last changed
  tier: Tier | null; // pre-rolled for CPU lanes (and lane 0 under autoplay)
  cpuStrikeT: number | null;
  mesh: THREE.Mesh;
  mat: THREE.MeshToonMaterial;
  ghosts: RingGhost[];
}

interface Particle {
  active: boolean;
  sprite: THREE.Sprite;
  mat: THREE.SpriteMaterial;
  vx: number;
  vy: number;
  vz: number;
  gravity: number;
  spin: number;
  life: number;
  t: number;
}

interface Popup {
  sprite: THREE.Sprite;
  mat: THREE.SpriteMaterial;
  born: number;
}

interface ScoreEntry {
  sprite: THREE.Sprite;
  mat: THREE.SpriteMaterial;
  tex: THREE.CanvasTexture | null;
}

interface DrumSoloState {
  ctx: MinigameContext;
  root: THREE.Group;
  rings: Ring[];
  dotPool: Particle[];
  starPool: Particle[];
  scores: number[];
  perfects: number[];
  errSum: number[];
  hits: number[];
  tieBreak: number[];
  lastHumanTap: number;
  humanCpu: boolean;
  scoreSprites: ScoreEntry[];
  scorePop: number[];
  popups: Popup[];
  targetRings: THREE.Mesh[];
  spotlightRings: THREE.Mesh[];
  starSprites: THREE.Sprite[];
  lastMetro: number; // beats clicked so far (0..16)
  ended: boolean;
  finished: boolean;
  winner: number;
}

/* ------------------------------------------------------------------ */
/*  Shared procedural assets (module-level, NEVER disposed — same      */
/*  convention as characters/cel.ts; three.js re-uploads on next use)  */
/* ------------------------------------------------------------------ */

const ringGeo = new THREE.TorusGeometry(0.4, 0.075, 10, 28);

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const c = canvas.getContext("2d");
  if (!c) throw new Error("2D canvas context unavailable");
  return [canvas, c];
}

function toTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  return tex;
}

function starPath(c: CanvasRenderingContext2D, cx: number, cy: number, R: number, points = 5): void {
  c.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const rad = i % 2 === 0 ? R : R * 0.42;
    const a = -Math.PI / 2 + (i * Math.PI) / points;
    const px = cx + Math.cos(a) * rad;
    const py = cy + Math.sin(a) * rad;
    if (i === 0) c.moveTo(px, py);
    else c.lineTo(px, py);
  }
  c.closePath();
}

/** Bold Fredoka text with a thick ink outline, on a transparent bg. */
function makeTextTexture(text: string, fill: string, outline: string, fontPx: number): THREE.CanvasTexture {
  const [canvas, c] = makeCanvas(256, 128);
  c.font = `700 ${fontPx}px Fredoka, sans-serif`;
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.lineJoin = "round";
  c.lineWidth = 14;
  c.strokeStyle = outline;
  c.strokeText(text, 128, 68);
  c.fillStyle = fill;
  c.fillText(text, 128, 68);
  return toTexture(canvas);
}

/** Soft white dot (particles get tinted via material color). */
function makeDotTexture(): THREE.CanvasTexture {
  const [canvas, c] = makeCanvas(64, 64);
  const g = c.createRadialGradient(32, 32, 2, 32, 32, 30);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.55, "rgba(255,255,255,0.85)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  c.fillStyle = g;
  c.fillRect(0, 0, 64, 64);
  return toTexture(canvas);
}

/** Gold 5-point star with ink outline (wall deco + confetti). */
function makeStarTexture(): THREE.CanvasTexture {
  const [canvas, c] = makeCanvas(64, 64);
  starPath(c, 32, 32, 28);
  c.lineWidth = 4;
  c.strokeStyle = palette.ink;
  c.stroke();
  c.fillStyle = palette.sun;
  c.fill();
  return toTexture(canvas);
}

/**
 * Marquee banner: ink "DRUM SOLO" on a gold board, flanked by gold stars.
 * The board is painted (not left transparent): the marquee material is
 * opaque, so a transparent canvas rendered black and the ink lettering
 * vanished into it.
 */
function makeMarqueeTexture(): THREE.CanvasTexture {
  const [canvas, c] = makeCanvas(1024, 160);
  c.fillStyle = palette.sun;
  c.fillRect(0, 0, 1024, 160);
  c.fillStyle = palette.sunDeep;
  c.fillRect(0, 0, 1024, 10);
  c.fillRect(0, 150, 1024, 10);
  c.font = "700 110px Fredoka, sans-serif";
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.lineJoin = "round";
  c.lineWidth = 14;
  c.strokeStyle = palette.cream;
  c.strokeText("DRUM SOLO", 512, 86);
  c.fillStyle = palette.ink;
  c.fillText("DRUM SOLO", 512, 86);
  for (const sx of [132, 892]) {
    starPath(c, sx, 86, 46);
    c.lineWidth = 9;
    c.strokeStyle = palette.ink;
    c.stroke();
    c.fillStyle = palette.sun;
    c.fill();
  }
  return toTexture(canvas);
}

const starTex = makeStarTexture();
const dotTex = makeDotTexture();
const marqueeTex = makeMarqueeTexture();
const POPUP_TEX: Record<Exclude<Tier, "miss">, THREE.CanvasTexture> = {
  perfect: makeTextTexture("+3", palette.sun, palette.ink, 88),
  good: makeTextTexture("+2", palette.mint, palette.ink, 88),
  ok: makeTextTexture("+1", palette.cream, palette.ink, 88),
};

function toon(
  color: number,
  opts?: { transparent?: boolean; opacity?: number; emissive?: number; emissiveIntensity?: number }
): THREE.MeshToonMaterial {
  return new THREE.MeshToonMaterial({ color, ...opts });
}

/* ------------------------------------------------------------------ */
/*  Stage                                                              */
/* ------------------------------------------------------------------ */

function buildStage(st: DrumSoloState): void {
  const root = st.root;
  const ctx = st.ctx;
  // ink base lip under the cream platform (printed-cartoon weight)
  const lip = new THREE.Mesh(new THREE.BoxGeometry(12.8, 0.18, 8.8), toon(hex(palette.ink)));
  lip.position.set(0, 0.09, 0.6);
  root.add(lip);
  const plat = new THREE.Mesh(new THREE.BoxGeometry(12.2, 0.4, 8.2), toon(hex(palette.cream)));
  plat.position.set(0, 0.2, 0.6);
  root.add(plat);

  for (let lane = 0; lane < 4; lane++) {
    const c = hex(ctx.players[lane]?.color ?? palette.sun);
    // candy lane strip
    const strip = new THREE.Mesh(
      new THREE.BoxGeometry(1.5, 0.02, 7.4),
      toon(c, { transparent: true, opacity: 0.4 })
    );
    strip.position.set(LANE_X[lane] ?? 0, STAGE_TOP + 0.02, 0.6);
    root.add(strip);
    // spotlight circle under the character's feet
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.55, 0.8, 32),
      toon(c, { transparent: true, opacity: 0.85 })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(LANE_X[lane] ?? 0, STAGE_TOP + 0.03, CHAR_Z);
    root.add(ring);
    st.spotlightRings.push(ring);
    // mint target ring
    const tr = new THREE.Mesh(ringGeo, toon(hex(palette.mint)));
    tr.rotation.x = -Math.PI / 2;
    tr.position.set(LANE_X[lane] ?? 0, TARGET_Y, TARGET_Z);
    root.add(tr);
    st.targetRings.push(tr);
  }

  // glowing rails between the lanes
  for (const rx of [-3.75, -1.25, 1.25, 3.75]) {
    const rail = new THREE.Mesh(
      new THREE.BoxGeometry(0.07, 0.05, 7.4),
      toon(hex(palette.sun), { emissive: hex(palette.sun), emissiveIntensity: 0.55 })
    );
    rail.position.set(rx, STAGE_TOP + 0.05, 0.6);
    root.add(rail);
  }

  // backdrop wall: ink shell + berry face + sun marquee
  const wallInk = new THREE.Mesh(new THREE.BoxGeometry(12.9, 4.7, 0.26), toon(hex(palette.ink)));
  wallInk.position.set(0, 2.35, -3.5);
  root.add(wallInk);
  const wall = new THREE.Mesh(new THREE.BoxGeometry(12.3, 4.1, 0.22), toon(hex(palette.berry)));
  wall.position.set(0, 2.25, -3.45);
  root.add(wall);
  const marquee = new THREE.Mesh(
    new THREE.BoxGeometry(11.6, 0.8, 0.2),
    new THREE.MeshBasicMaterial({ map: marqueeTex })
  );
  marquee.position.set(0, 4.75, -3.4);
  root.add(marquee);

  // gold stars on the wall
  for (let i = 0; i < 3; i++) {
    const sm = new THREE.SpriteMaterial({ map: starTex, transparent: true, depthWrite: false });
    const sp = new THREE.Sprite(sm);
    sp.scale.setScalar(0.85);
    sp.position.set(-3.6 + i * 3.6, 3.35 + (i === 1 ? 0.45 : 0), -3.32);
    sp.renderOrder = 2;
    root.add(sp);
    st.starSprites.push(sp);
  }
}

/* ------------------------------------------------------------------ */
/*  Particles + popups                                                 */
/* ------------------------------------------------------------------ */

function makeParticlePool(st: DrumSoloState, count: number, tex: THREE.CanvasTexture): Particle[] {
  const pool: Particle[] = [];
  for (let i = 0; i < count; i++) {
    const mat = new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.visible = false;
    sprite.renderOrder = 2;
    st.root.add(sprite);
    pool.push({ active: false, sprite, mat, vx: 0, vy: 0, vz: 0, gravity: 5.5, spin: 0, life: 0.7, t: 0 });
  }
  return pool;
}

function spawnBurst(
  st: DrumSoloState,
  kind: "dot" | "star",
  x: number,
  y: number,
  z: number,
  count: number,
  colors: number[],
  opts?: { speed?: number; life?: number }
): void {
  const pool = kind === "dot" ? st.dotPool : st.starPool;
  const speed = opts?.speed ?? 1.6;
  const life = opts?.life ?? 0.7;
  const rng = st.ctx.rng;
  for (let i = 0; i < count; i++) {
    const p = pool.find((q) => !q.active);
    if (!p) return;
    const a = rng() * Math.PI * 2;
    const v = speed * (0.35 + rng() * 0.65);
    p.active = true;
    p.t = 0;
    p.life = life * (0.7 + rng() * 0.6);
    p.vx = Math.cos(a) * v;
    p.vz = Math.sin(a) * v;
    p.vy = 1.0 + rng() * 2.4;
    p.spin = (rng() - 0.5) * 8;
    p.gravity = kind === "dot" ? 5.5 : 2.2;
    p.mat.color.setHex(colors[Math.floor(rng() * colors.length)] ?? hex(palette.sun));
    p.mat.opacity = 1;
    p.mat.rotation = 0;
    p.sprite.position.set(x, y, z);
    p.sprite.scale.setScalar(kind === "dot" ? 0.14 + rng() * 0.16 : 0.2 + rng() * 0.22);
    p.sprite.visible = true;
  }
}

function updateParticles(st: DrumSoloState, dt: number): void {
  for (const pool of [st.dotPool, st.starPool]) {
    for (const p of pool) {
      if (!p.active) continue;
      p.t += dt;
      if (p.t >= p.life) {
        p.active = false;
        p.sprite.visible = false;
        continue;
      }
      p.vy -= p.gravity * dt;
      p.sprite.position.x += p.vx * dt;
      p.sprite.position.y += p.vy * dt;
      p.sprite.position.z += p.vz * dt;
      if (p.sprite.position.y < STAGE_TOP + 0.02) {
        p.sprite.position.y = STAGE_TOP + 0.02;
        p.vy = -p.vy * 0.45;
        p.vx *= 0.7;
        p.vz *= 0.7;
      }
      p.mat.opacity = Math.max(0, 1 - p.t / p.life);
      p.mat.rotation += p.spin * dt;
    }
  }
}

function spawnPopup(st: DrumSoloState, lane: number, tier: Exclude<Tier, "miss">, t: number): void {
  const tex = POPUP_TEX[tier];
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(0.62, 0.31, 1);
  sprite.position.set(LANE_X[lane] ?? 0, 1.05, TARGET_Z);
  sprite.renderOrder = 3;
  st.root.add(sprite);
  st.popups.push({ sprite, mat, born: t });
}

/* ------------------------------------------------------------------ */
/*  Scoring                                                            */
/* ------------------------------------------------------------------ */

function computeRanking(st: DrumSoloState): number[] {
  const meanErr = (p: number): number => (st.hits[p] > 0 ? st.errSum[p] / st.hits[p] : 9);
  return [0, 1, 2, 3].sort(
    (a, b) =>
      (st.scores[b] ?? 0) - (st.scores[a] ?? 0) ||
      (st.perfects[b] ?? 0) - (st.perfects[a] ?? 0) ||
      meanErr(a) - meanErr(b) ||
      (st.tieBreak[a] ?? 0) - (st.tieBreak[b] ?? 0),
  );
}

function refreshScore(st: DrumSoloState, p: number): void {
  st.ctx.hud.score(p, st.scores[p] ?? 0);
}

function tierFor(err: number): Tier {
  const e = Math.abs(err);
  return e <= PERFECT_WINDOW ? "perfect" : e <= GOOD_WINDOW ? "good" : e <= OK_WINDOW ? "ok" : "miss";
}

/** Standard normal from two ctx.rng draws (Box-Muller). */
function gauss(rng: () => number): number {
  const u = Math.max(1e-9, rng());
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/* ------------------------------------------------------------------ */
/*  Rings                                                              */
/* ------------------------------------------------------------------ */

function createRing(st: DrumSoloState, beat: number, lane: number, arriveT: number): Ring {
  const ctx = st.ctx;
  const color = hex(ctx.players[lane]?.color ?? palette.sun);
  const mat = new THREE.MeshToonMaterial({ color, transparent: true, opacity: 1 });
  const mesh = new THREE.Mesh(ringGeo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(LANE_X[lane] ?? 0, RING_Y, SPAWN_Z);
  mesh.renderOrder = 1;
  mesh.visible = false; // shown when its approach starts
  st.root.add(mesh);
  const ghosts: RingGhost[] = [];
  for (let g = 1; g <= 2; g++) {
    const base = g === 1 ? 0.22 : 0.1;
    const gmat = new THREE.MeshToonMaterial({ color, transparent: true, opacity: base });
    const gmesh = new THREE.Mesh(ringGeo, gmat);
    gmesh.rotation.x = -Math.PI / 2;
    gmesh.position.set(LANE_X[lane] ?? 0, RING_Y, SPAWN_Z - g * 0.55);
    gmesh.renderOrder = 1;
    gmesh.visible = false;
    st.root.add(gmesh);
    ghosts.push({ mesh: gmesh, mat: gmat, base });
  }
  return {
    beat,
    lane,
    playerId: lane,
    spawnT: arriveT - TRAVEL,
    arriveT,
    state: "incoming",
    stateT: 0,
    tier: null,
    cpuStrikeT: null,
    mesh,
    mat,
    ghosts,
  };
}

function removeRing(st: DrumSoloState, ring: Ring): void {
  ring.mesh.removeFromParent();
  ring.mat.dispose();
  for (const gh of ring.ghosts) {
    gh.mesh.removeFromParent();
    gh.mat.dispose();
  }
}

function strikeRing(st: DrumSoloState, ring: Ring, tier: Tier, t: number, err: number): void {
  const ctx = st.ctx;
  if (tier === "miss") {
    missRing(st, ring, t);
    return;
  }
  const pts = tier === "perfect" ? 3 : tier === "good" ? 2 : 1;
  st.scores[ring.playerId] = (st.scores[ring.playerId] ?? 0) + pts;
  if (tier === "perfect") st.perfects[ring.playerId] += 1;
  st.errSum[ring.playerId] += Math.abs(err);
  st.hits[ring.playerId] += 1;
  refreshScore(st, ring.playerId);
  ring.state = "flash";
  ring.stateT = t;
  for (const gh of ring.ghosts) gh.mat.opacity = 0;
  const x = ring.mesh.position.x;
  const z = ring.mesh.position.z;
  if (tier === "perfect") {
    ring.mat.color.setHex(hex(palette.sun));
    ctx.playSfx("cheer", { volume: 0.4, pitch: 4 });
    spawnBurst(st, "dot", x, 1.0, z, 10, [hex(palette.sun), hex(palette.white)]);
    spawnPopup(st, ring.lane, "perfect", t);
    ctx.characters[ring.playerId]?.anim.cheer();
  } else if (tier === "good") {
    ring.mat.color.setHex(hex(palette.mint));
    ctx.playSfx("pop", { volume: 0.5, pitch: 3 });
    spawnBurst(st, "dot", x, 0.95, z, 8, [hex(palette.mint), hex(palette.white)]);
    spawnPopup(st, ring.lane, "good", t);
    ctx.characters[ring.playerId]?.anim.jump();
  } else {
    ring.mat.color.setHex(hex(palette.cream));
    ctx.playSfx("ui.click", { volume: 0.4, pitch: 2 });
    spawnBurst(st, "dot", x, 0.9, z, 6, [hex(palette.cream)]);
    spawnPopup(st, ring.lane, "ok", t);
    ctx.characters[ring.playerId]?.anim.squash();
  }
}

function missRing(st: DrumSoloState, ring: Ring, t: number): void {
  ring.state = "shatter";
  ring.stateT = t;
  for (const gh of ring.ghosts) gh.mat.opacity = 0;
  ring.mat.color.setHex(hex(palette.inkSoft));
  st.ctx.playSfx("boing", { volume: 0.45, pitch: -4 });
  spawnBurst(st, "dot", ring.mesh.position.x, 0.8, ring.mesh.position.z, 6, [
    hex(palette.inkSoft),
    hex(palette.cream),
  ]);
  st.ctx.characters[ring.playerId]?.anim.sad();
}

/** Human: strike your lane's ring closest to its target within the window. */
function humanStrike(st: DrumSoloState): void {
  const ctx = st.ctx;
  const t = ctx.time;
  if (st.ended || t - st.lastHumanTap < TAP_DEBOUNCE) return;
  st.lastHumanTap = t;
  const judged = t - INPUT_LATENCY;
  let best: Ring | null = null;
  let bestErr = Infinity;
  const lane = localPlayerIndex(st.ctx.players);
  for (const ring of st.rings) {
    if (ring.lane !== lane) continue;
    if (ring.state !== "incoming" && ring.state !== "wait") continue;
    const err = judged - ring.arriveT;
    if (Math.abs(err) <= OK_WINDOW && Math.abs(err) < Math.abs(bestErr)) {
      bestErr = err;
      best = ring;
    }
  }
  if (!best) {
    // A stray tap with no ring near: a dull thud, no penalty.
    ctx.playSfx("ui.click", { volume: 0.3, pitch: -5 });
    return;
  }
  strikeRing(st, best, tierFor(bestErr), t, bestErr);
}

/* ------------------------------------------------------------------ */
/*  End                                                                */
/* ------------------------------------------------------------------ */

function endGame(st: DrumSoloState, t: number): void {
  st.ended = true;
  const ctx = st.ctx;
  const ranking = computeRanking(st);
  st.winner = ranking[0] ?? 0;
  const name = ctx.players[st.winner]?.name ?? "?";
  ctx.announce(`${name} NAILS DRUM SOLO!`);
  ctx.playSfx("crowd.cheer", { volume: 0.9 });
  ctx.playSfx("whistle", { volume: 0.55, pitch: 2 });
  const colors = [
    hex(palette.sun),
    hex(palette.candy),
    hex(palette.bubble),
    hex(palette.mint),
    hex(palette.white),
  ];
  for (let lane = 0; lane < 4; lane++) {
    spawnBurst(st, "star", LANE_X[lane] ?? 0, 2.4, 0.6, 10, colors, { speed: 2.2, life: 1.8 });
  }
  spawnBurst(st, "star", LANE_X[st.winner] ?? 0, 2.6, 1.0, 16, colors, {
    speed: 2.6,
    life: 2.0,
  });
  for (const ch of ctx.characters) ch.anim.idle();
  ctx.characters[st.winner]?.anim.cheer();
}

/* ------------------------------------------------------------------ */
/*  The minigame                                                       */
/* ------------------------------------------------------------------ */

const drumSolo: Minigame = {
  id: "drum_solo",
  name: "Drum Solo",
  genre: "rhythm",
  howTo: "You drum in the lane marked YOU. Tap the moment each ring lands on your target. Everyone plays the same song, and the best timing wins.",
  goal: "Tap as your ring hits the target!",
  tap: "HIT",
  steer: false,
  tapSfx: "pop",
  rules: {
    format: "ffa",
    length: "One song",
    win: "Most points: PERFECT +3, GOOD +2, OK +1",
    touch: ["Tap HIT (or anywhere) as a ring lands on your target", "Rings come in pairs sometimes, so tap twice"],
    keys: ["Space: hit", "Or click anywhere"],
  },

  setup(ctx: MinigameContext) {
    const st: DrumSoloState = {
      ctx,
      root: new THREE.Group(),
      rings: [],
      dotPool: [],
      starPool: [],
      scores: [0, 0, 0, 0],
      perfects: [0, 0, 0, 0],
      errSum: [0, 0, 0, 0],
      hits: [0, 0, 0, 0],
      tieBreak: [0, 0, 0, 0],
      lastHumanTap: -1,
      humanCpu: isAutoplay(),
      scoreSprites: [],
      scorePop: [0, 0, 0, 0],
      popups: [],
      targetRings: [],
      spotlightRings: [],
      starSprites: [],
      lastMetro: 0,
      ended: false,
      finished: false,
      winner: 0,
    };
    (drumSolo as unknown as { _st?: DrumSoloState })._st = st;
    ctx.scene.add(st.root);

    buildStage(st);

    /* ---- one chart for everyone (3 rng draws), a ring per lane per note ---- */
    const chart = buildChart(ctx.rng);
    chart.forEach((beat, n) => {
      const arriveT = (LEAD_BEATS + beat) * BEAT;
      for (let lane = 0; lane < 4; lane++) st.rings.push(createRing(st, n, lane, arriveT));
    });

    /* ---- CPU drummers: a timing spread and lapse rate per CPU, then one
       strike time per note (fixed order: lanes asc, notes asc) ---- */
    const cpuLanes = automatedSeatIds(ctx.players, st.humanCpu);
    for (const lane of cpuLanes) {
      const sd = CPU_SD[0] + ctx.rng() * (CPU_SD[1] - CPU_SD[0]);
      const lapse = CPU_LAPSE[0] + ctx.rng() * (CPU_LAPSE[1] - CPU_LAPSE[0]);
      for (const ring of st.rings) {
        if (ring.lane !== lane) continue;
        if (ctx.rng() < lapse) continue; // zones out: no strike, a miss
        const err = CPU_BIAS + sd * gauss(ctx.rng);
        if (Math.abs(err) > OK_WINDOW) continue; // too far off to count: a miss
        ring.cpuStrikeT = ring.arriveT + err;
        ring.tier = tierFor(err);
      }
    }
    for (let p = 0; p < 4; p++) st.tieBreak[p] = ctx.rng();

    /* ---- characters at the bottom of their lanes, facing the camera ---- */
    for (let i = 0; i < 4; i++) {
      const ch = ctx.characters[i];
      if (!ch) continue;
      ch.group.position.set(LANE_X[i] ?? 0, 0, CHAR_Z);
      ch.setFacing(0); // front is +Z -> faces the camera
      ch.anim.idle();
    }

    /* ---- shared scoreboard ---- */
    ctx.hud.unit("pts");
    for (let p = 0; p < 4; p++) ctx.hud.score(p, 0);
    ctx.hud.timer(SONG_END, SONG_END);

    /* ---- particle pools ---- */
    st.dotPool = makeParticlePool(st, MAX_DOT_PARTICLES, dotTex);
    st.starPool = makeParticlePool(st, MAX_STAR_PARTICLES, starTex);

    /* ---- fixed front camera, fitted to the screen: the four lanes with
       their drummers, the wall and its marquee always on screen ---- */
    frameMinigame(ctx.camera, () => {
      const { w, h } = viewportSize();
      const halfX = w / h >= 1 ? 6.45 : 4.15;
      return {
        box: frameBox([-halfX, 0, -3.65], [halfX, 5.2, 4.95]),
        dir: new THREE.Vector3(0, 5.3, 11.3),
        fov: 50,
      };
    });

    /* ---- input: tap anywhere or confirm = strike lane 0 ---- */
    ctx.input.pointer = (_x: number, _y: number, down: boolean): void => {
      if (!down || st.humanCpu) return;
      humanStrike(st);
    };
    ctx.input.key = (action: string): void => {
      if (action !== "confirm" || st.humanCpu) return;
      humanStrike(st);
    };

  },

  update(dt: number) {
    const st = (drumSolo as unknown as { _st?: DrumSoloState })._st;
    if (!st || st.finished || isPracticeBeat()) return;
    const ctx = st.ctx;
    const t = ctx.time;

    /* ---- beat metronome: one click per beat, accented downbeats ---- */
    while (st.lastMetro < LEAD_BEATS + BEATS && st.lastMetro * BEAT <= t) {
      st.lastMetro += 1;
      const down = (st.lastMetro - 1 - LEAD_BEATS) % 4 === 0;
      ctx.playSfx("minigame.count", down ? { volume: 0.3, pitch: 5 } : { volume: 0.2, pitch: 0 });
    }

    /* ---- rings ---- */
    for (const ring of st.rings) {
      if (ring.state === "incoming") {
        const visible = t >= ring.spawnT;
        ring.mesh.visible = visible;
        for (const gh of ring.ghosts) gh.mesh.visible = visible;
        const p = Math.max(0, Math.min(1, (t - ring.spawnT) / TRAVEL));
        const z = SPAWN_Z + (TARGET_Z - SPAWN_Z) * p;
        const s =
          (RING_SCALE_SPAWN + (RING_SCALE_ARRIVE - RING_SCALE_SPAWN) * p) *
          (1 + 0.04 * Math.sin(t * 13 + ring.beat));
        ring.mesh.position.z = z;
        ring.mesh.scale.setScalar(s);
        for (let g = 0; g < ring.ghosts.length; g++) {
          const gh = ring.ghosts[g];
          gh.mesh.position.z = z - 0.55 * (g + 1);
          gh.mesh.scale.setScalar(s);
          gh.mat.opacity = gh.base * (1 - 0.5 * p);
        }
        if (ring.cpuStrikeT !== null && t >= ring.cpuStrikeT) {
          strikeRing(st, ring, ring.tier ?? "ok", t, ring.cpuStrikeT - ring.arriveT);
        } else if (t >= ring.arriveT) {
          ring.state = "wait";
          ring.stateT = t;
          for (const gh of ring.ghosts) gh.mat.opacity = 0;
        }
      } else if (ring.state === "wait") {
        ring.mesh.scale.setScalar(RING_SCALE_ARRIVE * (1 + 0.05 * Math.sin(t * 10)));
        if (ring.cpuStrikeT !== null && t >= ring.cpuStrikeT) {
          strikeRing(st, ring, ring.tier ?? "ok", t, ring.cpuStrikeT - ring.arriveT);
        } else if (t >= ring.arriveT + OK_WINDOW) {
          missRing(st, ring, t);
        }
      } else if (ring.state === "flash") {
        const k = Math.min(1, (t - ring.stateT) / 0.26);
        ring.mesh.scale.setScalar(Math.max(0.001, 1.45 - k * 1.35));
        ring.mesh.position.y = RING_Y + 0.18 * Math.sin(k * Math.PI);
        ring.mat.opacity = 1 - k;
        if (k >= 1) removeRing(st, ring);
      } else {
        const k = Math.min(1, (t - ring.stateT) / 0.36);
        ring.mesh.scale.setScalar(Math.max(0.001, (1 + 0.5 * Math.sin(k * Math.PI)) * (1 - k)));
        ring.mesh.position.y = RING_Y + 0.16 * Math.sin(k * Math.PI);
        ring.mat.opacity = 1 - k;
        if (k >= 1) removeRing(st, ring);
      }
    }

    /* ---- particles + popups ---- */
    updateParticles(st, dt);
    for (let i = st.popups.length - 1; i >= 0; i--) {
      const pu = st.popups[i];
      const k = Math.min(1, (t - pu.born) / 0.75);
      pu.sprite.position.y = 1.05 + k * 0.7;
      pu.mat.opacity = 1 - k;
      if (k >= 1) {
        pu.sprite.removeFromParent();
        pu.mat.dispose();
        st.popups.splice(i, 1);
      }
    }

    /* ---- stage juice ---- */
    const beatK = Math.exp(-((t % BEAT) / BEAT) * 5);
    for (let lane = 0; lane < 4; lane++) {
      const tr = st.targetRings[lane];
      if (tr) tr.scale.setScalar(1 + 0.22 * beatK);
      const sr = st.spotlightRings[lane];
      if (sr) sr.scale.setScalar(1 + 0.07 * Math.sin(t * 3.1 + lane * 1.7));
    }
    for (let i = 0; i < st.starSprites.length; i++) {
      const sp = st.starSprites[i];
      if (!sp) continue;
      sp.position.y = 3.35 + (i === 1 ? 0.45 : 0) + 0.12 * Math.sin(t * 2.2 + i * 2.1);
      (sp.material as THREE.SpriteMaterial).rotation = t * 0.5 + i;
    }

    ctx.hud.timer(Math.max(0, SONG_END - t), SONG_END);

    /* ---- end: announce winner, then finish exactly once ---- */
    if (!st.ended && t >= END_AT) endGame(st, t);
    if (st.ended && t >= FINISH_AT) {
      st.finished = true;
      ctx.finish(computeRanking(st));
    }
  },

  teardown() {
    const st = (drumSolo as unknown as { _st?: DrumSoloState })._st;
    if (!st) return;
    const ctx = st.ctx;
    // dispose every per-instance geometry/material under the root
    // (shared module assets are left alone; three.js re-uploads on reuse)
    st.root.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      if ((obj as THREE.Sprite).isSprite) return; // shared sprite geometry
      mesh.geometry.dispose();
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) m.dispose();
    });
    st.root.removeFromParent();
    for (const entry of st.scoreSprites) {
      entry?.tex?.dispose();
      entry?.mat.dispose();
    }
    for (const pu of st.popups) pu.mat.dispose();
    for (const ch of ctx.characters) ch.anim.idle();
    ctx.input.pointer = () => {};
    ctx.input.key = () => {};
    (drumSolo as unknown as { _st?: DrumSoloState })._st = undefined;
  },
};

/* ------------------------------------------------------------------ */
/*  Registration                                                       */
/* ------------------------------------------------------------------ */

export function loadDrumSolo(): Promise<Minigame> {
  return Promise.resolve(drumSolo);
}

export default drumSolo;

// Self-registration (framework-documented pattern): playable the moment it
// is loaded, independent of index.ts wiring (deduped by id).
registerMinigame({ id: drumSolo.id, name: drumSolo.name });
