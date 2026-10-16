/**
 * SUPER STAR PARTY — MEMORY MATCH (memory).
 *
 * Simultaneous memory race. 12 cards (6 pairs) lie flat, 4x3.
 *   PEEK   every card face-up for 3.5 s ("MEMORIZE!"), then all flip down.
 *   ROUNDS 5 of them. One card of an unsolved pair flips up as the target.
 *          Every player picks ONE face-down card (first pick locks). The
 *          reveal comes after 2.6 s, or as soon as all four have picked:
 *          right = +1, the fastest right pick = +2. The pair stays face-up.
 *   RANK   points; tie -> lower mean time of right picks; tie -> ctx.rng.
 *
 * CPUs: each draws a recall in [0.40, 0.70) at setup; at the end of the
 * peek it rolls, per pair, whether it remembers that pair. Remembered ->
 * picks the twin after U[0.75, 2.1] s; otherwise guesses a random face-down
 * card after U[1.4, 2.4] s. Other players' picks stay hidden until the
 * reveal (the HUD chip says PICKED), so nobody can copy a CPU.
 *
 * Determinism: deck, icon choice, CPU recall, target and CPU picks all come
 * from ctx.rng, drawn in a fixed order at fixed sim steps (1/60 s). Human
 * picks land on the next step. Sparkles use a side mulberry32 stream.
 */
import * as THREE from "three";
import {
  automatedSeatIds,
  contactProbeLive,
  cpuSkill,
  isLocalPlayer,
  isPracticeBeat,
  type Minigame,
  type MinigameContext,
} from "../framework";
import { box as frameBox, frameMinigame } from "../framing";
import { palette, hex } from "../../config/palette";
import { isAutoplay } from "../../core/debug";
import { mulberry32 } from "../../core/rng";
import { viewportSize } from "../../ui/viewport";
import {
  CARD_D,
  CARD_T,
  CARD_W,
  CARD_Y,
  FELT,
  GRID_COLS,
  GRID_ROWS,
  ICON_IDS,
  STEP_X,
  STEP_Z,
  TABLE_Y,
  buildTable,
  createCardMesh,
  createStarBurst,
  cursorTexture,
  frameSize,
  frameTexture,
  gridPos,
  type IconId,
} from "./cards";

/* ------------------------------------------------------------------ */
/*  Tunables                                                           */
/* ------------------------------------------------------------------ */

const PAIRS = 6;
const ROUNDS = 5;
const DEAL_T = 0.5; // cards hop, then flip up
const PEEK_T = 3.5; // all face-up
const HIDE_T = 0.45; // all flip down
const TARGET_T = 0.3; // target flips up; picks open after
const PICK_T = 2.6; // pick window
const REVEAL_T = 1.1; // picks shown, scores land
const UNFLIP_AT = 0.8; // wrong picks turn back down here
const END_T = 1.3;
const FLIP_T = 0.26;

const CPU_RECALL_LO = 0.4;
const CPU_RECALL_HI = 0.7;
const CPU_KNOW_LO = 0.75;
const CPU_KNOW_HI = 2.1;
const CPU_GUESS_LO = 1.4;
const CPU_GUESS_HI = 2.4;

const SIM_STEP = 1 / 60;
const MAX_SIM_STEPS = 12;

/** Hit area around a card centre (world units), generous: covers the gaps. */
const HIT_HX = STEP_X / 2 + 0.06;
const HIT_HZ = STEP_Z / 2 + 0.06;

type Phase = "deal" | "peek" | "hide" | "target" | "pick" | "reveal" | "end" | "done";

interface Card {
  index: number;
  pair: number;
  x: number;
  z: number;
  mesh: THREE.Mesh;
  faceMat: THREE.MeshBasicMaterial;
  backMat: THREE.MeshBasicMaterial;
  faceUp: boolean;
  solved: boolean;
  rot: number;
  flipFrom: number;
  flipTo: number;
  flipT: number; // -1 idle
  raise: number; // smoothed lift (target)
  pop: number; // 1 -> 0 scale pulse
  shake: number; // 1 -> 0 invalid-tap wiggle
  hop: number; // deal hop clock (starts negative = stagger)
}

interface Pick {
  card: number;
  t: number; // seconds since the pick window opened
}

interface CpuPlan {
  t: number;
  card: number;
}

interface Token {
  mesh: THREE.Mesh;
  mats: THREE.Material[];
  tex: THREE.CanvasTexture;
  radius: number;
  pop: number;
}

interface Sign {
  mesh: THREE.Mesh;
  canvas: HTMLCanvasElement;
  g: CanvasRenderingContext2D;
  tex: THREE.CanvasTexture;
  text: string;
}

interface St {
  ctx: MinigameContext;
  root: THREE.Group;
  table: ReturnType<typeof buildTable>;
  cards: Card[];
  phase: Phase;
  phaseT: number;
  accum: number;
  finished: boolean;
  round: number; // 0-based
  target: number;
  twin: number;
  picks: (Pick | null)[];
  pickT: number;
  plans: (CpuPlan | null)[];
  scores: number[];
  rightT: number[][];
  automated: number[];
  recall: number[];
  knows: boolean[][];
  /** Local human seat driving the pointer/keys, or -1 (autoplay / none). */
  human: number;
  pending: number | null;
  curR: number;
  curC: number;
  cursorOn: boolean;
  cursor: THREE.Mesh;
  targetFrame: THREE.Mesh;
  youFrame: THREE.Mesh;
  frameMats: THREE.MeshBasicMaterial[];
  frameGeoms: THREE.BufferGeometry[];
  tokens: Token[];
  tokenGeom: THREE.CylinderGeometry;
  sign: Sign;
  burst: ReturnType<typeof createStarBurst>;
  fx: () => number;
  ndc: THREE.Vector2;
  ray: THREE.Raycaster;
  plane: THREE.Plane;
  hitPt: THREE.Vector3;
  clock: number; // cosmetic animation clock (sim time)
}

let S: St | null = null;

/* ------------------------------------------------------------------ */
/*  Small helpers                                                      */
/* ------------------------------------------------------------------ */

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

function uniform(rng: () => number, lo: number, hi: number): number {
  return lo + rng() * (hi - lo);
}

function playerColor(ctx: MinigameContext, id: number): string {
  return ctx.players[id]?.color ?? palette.sun;
}

function makeFrame(
  st: { frameMats: THREE.MeshBasicMaterial[]; frameGeoms: THREE.BufferGeometry[] },
  pad: number,
  color: string,
  order: number,
  map: THREE.Texture = frameTexture,
): THREE.Mesh {
  const { w, d } = frameSize(pad);
  const geom = new THREE.PlaneGeometry(w, d);
  geom.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({
    map,
    color: hex(color),
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.renderOrder = order;
  mesh.visible = false;
  st.frameMats.push(mat);
  st.frameGeoms.push(geom);
  return mesh;
}

function makeTokenTexture(color: string, label: string): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const g = c.getContext("2d")!;
  g.beginPath();
  g.arc(64, 64, 60, 0, Math.PI * 2);
  g.fillStyle = palette.ink;
  g.fill();
  g.beginPath();
  g.arc(64, 64, 53, 0, Math.PI * 2);
  g.fillStyle = palette.white;
  g.fill();
  g.beginPath();
  g.arc(64, 64, 45, 0, Math.PI * 2);
  g.fillStyle = color;
  g.fill();
  g.fillStyle = palette.white;
  g.strokeStyle = palette.ink;
  g.lineWidth = 7;
  g.lineJoin = "round";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.font = `900 ${label.length > 2 ? 34 : 54}px system-ui, sans-serif`;
  g.strokeText(label, 64, 67);
  g.fillText(label, 64, 67);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeSign(): Sign {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 128;
  const g = canvas.getContext("2d")!;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const w = FELT.hx * 2 - 0.2;
  const geom = new THREE.PlaneGeometry(w, w / 8);
  geom.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geom, new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
  mesh.position.set(0, TABLE_Y + 0.006, FELT.z0 + 0.38);
  return { mesh, canvas, g, tex, text: "" };
}

function setSign(sign: Sign, text: string, accent: string = palette.sun): void {
  if (sign.text === text) return;
  sign.text = text;
  const { g, canvas } = sign;
  const W = canvas.width;
  const H = canvas.height;
  g.clearRect(0, 0, W, H);
  g.fillStyle = palette.ink;
  g.beginPath();
  g.roundRect(6, 8, W - 12, H - 16, 52);
  g.fill();
  g.font = "900 76px system-ui, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillStyle = accent;
  g.fillText(text, W / 2, H / 2 + 4, W - 60);
  sign.tex.needsUpdate = true;
}

/* ------------------------------------------------------------------ */
/*  Layout + camera (presentation only)                                */
/* ------------------------------------------------------------------ */

function layout(st: St): THREE.Box3 {
  const { w, h } = viewportSize();
  const portrait = w / h < 1.05;
  const chars = st.ctx.characters;
  if (portrait) {
    // A row behind the far edge, facing the camera.
    for (let i = 0; i < 4; i++) {
      const ch = chars[i];
      if (!ch) continue;
      ch.group.position.set((i - 1.5) * 1.3, 0, FELT.z0 - 0.85);
      ch.setFacing(0);
    }
    return frameBox([-FELT.hx, TABLE_Y, FELT.z0 - 1.75], [FELT.hx, TABLE_Y + 0.05, FELT.z1 + 0.3]);
  }
  // Wide screens: two players on each side of the table, facing in.
  const spots: Array<[number, number, number]> = [
    [-3.45, -1.1, 1.1],
    [-3.45, 0.9, 1.9],
    [3.45, -1.1, -1.1],
    [3.45, 0.9, -1.9],
  ];
  for (let i = 0; i < 4; i++) {
    const ch = chars[i];
    if (!ch) continue;
    const [x, z, yaw] = spots[i];
    ch.group.position.set(x, 0, z);
    ch.setFacing(yaw);
  }
  return frameBox([-4.1, TABLE_Y, FELT.z0 - 0.6], [4.1, TABLE_Y + 0.05, FELT.z1 + 0.3]);
}

/* ------------------------------------------------------------------ */
/*  Card animation                                                     */
/* ------------------------------------------------------------------ */

function flip(card: Card, up: boolean): void {
  if (card.faceUp === up && card.flipT < 0) return;
  card.faceUp = up;
  card.flipFrom = card.rot;
  card.flipTo = up ? Math.PI : 0;
  card.flipT = 0;
}

function animateCards(st: St, dt: number): void {
  for (const c of st.cards) {
    if (c.flipT >= 0) {
      c.flipT += dt;
      const k = Math.min(1, c.flipT / FLIP_T);
      c.rot = c.flipFrom + (c.flipTo - c.flipFrom) * easeInOut(k);
      if (k >= 1) {
        c.rot = c.flipTo;
        c.flipT = -1;
      }
    }
    const flipK = c.flipT >= 0 ? Math.min(1, c.flipT / FLIP_T) : 0;
    const lift = Math.sin(Math.PI * flipK) * 0.32;
    const wantRaise = st.target === c.index && (st.phase === "target" || st.phase === "pick") ? 0.14 : 0;
    c.raise += (wantRaise - c.raise) * Math.min(1, dt * 12);
    if (c.pop > 0) c.pop = Math.max(0, c.pop - dt / 0.3);
    if (c.shake > 0) c.shake = Math.max(0, c.shake - dt / 0.3);
    let hopY = 0;
    if (c.hop < 1) {
      c.hop += dt / 0.3;
      if (c.hop > 0) hopY = Math.sin(Math.PI * Math.min(1, c.hop)) * 0.25;
    }
    c.mesh.position.set(c.x + Math.sin(c.shake * Math.PI * 6) * 0.07 * c.shake, CARD_Y + lift + c.raise + hopY, c.z);
    c.mesh.rotation.x = c.rot;
    c.mesh.scale.setScalar(1 + 0.12 * Math.sin(Math.PI * c.pop));
    const dim = c.solved && st.target !== c.index && st.twin !== c.index ? 0.62 : 1;
    c.faceMat.color.setScalar(dim);
  }
}

/* ------------------------------------------------------------------ */
/*  Rules                                                              */
/* ------------------------------------------------------------------ */

function startPeek(st: St): void {
  st.phase = "peek";
  st.phaseT = 0;
  for (const c of st.cards) flip(c, true);
  st.ctx.playSfx("whoosh", { volume: 0.5, pitch: 1.1 });
}

function startHide(st: St): void {
  // Each automated seat rolls, per pair, whether it remembers it.
  for (const id of st.automated) {
    for (let p = 0; p < PAIRS; p++) st.knows[id][p] = st.ctx.rng() < st.recall[id];
  }
  st.phase = "hide";
  st.phaseT = 0;
  for (const c of st.cards) flip(c, false);
  st.ctx.playSfx("whoosh", { volume: 0.5, pitch: 0.8 });
}

function startRound(st: St): void {
  const ctx = st.ctx;
  // Target: a random card of a random unsolved pair.
  const open = [...new Set(st.cards.filter((c) => !c.solved).map((c) => c.pair))].sort((a, b) => a - b);
  const pair = open[Math.floor(ctx.rng() * open.length)];
  const both = st.cards.filter((c) => c.pair === pair);
  const first = Math.floor(ctx.rng() * 2);
  st.target = both[first].index;
  st.twin = both[1 - first].index;
  st.picks = [null, null, null, null];
  st.plans = [null, null, null, null];
  st.pickT = 0;
  st.pending = null;
  const choices = st.cards.filter((c) => !c.solved && c.index !== st.target).map((c) => c.index);
  for (const id of st.automated) {
    if (st.knows[id][pair]) {
      st.plans[id] = { t: uniform(ctx.rng, CPU_KNOW_LO, CPU_KNOW_HI) / cpuSkill(), card: st.twin };
    } else {
      const t = uniform(ctx.rng, CPU_GUESS_LO, CPU_GUESS_HI) / cpuSkill();
      st.plans[id] = { t, card: choices[Math.floor(ctx.rng() * choices.length)] };
    }
  }
  for (let id = 0; id < 4; id++) ctx.hud.tag(id, null);
  for (const ch of ctx.characters) ch.anim.idle();
  for (const t of st.tokens) t.mesh.visible = false;
  st.youFrame.visible = false;
  flip(st.cards[st.target], true);
  st.phase = "target";
  st.phaseT = 0;
  const label = st.round === ROUNDS - 1 ? "FINAL ROUND!" : st.round === 0 ? "FIND ITS TWIN!" : `ROUND ${st.round + 1}/${ROUNDS}`;
  ctx.announce(label, { durationMs: 1000, sound: null });
  ctx.playSfx("whoosh", { volume: 0.55, pitch: 1.3 });
}

function lockPick(st: St, id: number, card: number): void {
  if (st.picks[id]) return;
  st.picks[id] = { card, t: st.pickT };
  const ctx = st.ctx;
  ctx.hud.tag(id, "PICKED");
  ctx.characters[id]?.anim.jump();
  if (id === st.human) {
    const c = st.cards[card];
    c.pop = 1;
    ctx.playSfx("pop", { volume: 0.7, pitch: 1.1 });
    st.youFrame.visible = true;
    const tok = st.tokens[id];
    tok.mesh.visible = true;
    tok.pop = 0;
    tok.mesh.scale.setScalar(tok.radius * 1.5);
  } else {
    ctx.playSfx("hop", { volume: 0.25, pitch: 2 + id });
  }
}

function startReveal(st: St): void {
  const ctx = st.ctx;
  st.phase = "reveal";
  st.phaseT = 0;
  const right = st.picks.map((p) => p !== null && p.card === st.twin);
  let best = Infinity;
  for (let id = 0; id < 4; id++) if (right[id]) best = Math.min(best, st.picks[id]!.t);
  let anyRight = false;
  for (let id = 0; id < 4; id++) {
    const p = st.picks[id];
    const ch = ctx.characters[id];
    if (!p) {
      ctx.hud.tag(id, "SLOW");
      continue;
    }
    if (right[id]) {
      anyRight = true;
      const fast = p.t <= best + 1e-9;
      st.scores[id] += fast ? 2 : 1;
      st.rightT[id].push(p.t);
      ctx.hud.score(id, st.scores[id]);
      ctx.hud.tag(id, fast ? "+2 FAST" : "+1");
      if (fast) ch?.anim.cheer();
      else ch?.anim.jump();
    } else {
      ctx.hud.tag(id, "MISS");
      ch?.anim.sad();
    }
  }
  // Flip the twin and every wrong pick face-up.
  flip(st.cards[st.twin], true);
  const shown = new Set<number>();
  for (const p of st.picks) if (p && p.card !== st.twin) shown.add(p.card);
  for (const i of shown) flip(st.cards[i], true);
  placeTokens(st);
  if (anyRight) {
    ctx.playSfx("coin.gain", { volume: 0.6, pitch: 1.3 });
    const t = st.cards[st.twin];
    st.burst.spawn([{ x: t.x, y: CARD_Y + 0.3, z: t.z }], {
      colors: [palette.sun, palette.white, palette.candy],
      countPerPoint: 10,
      speed: 1.2,
      life: 0.8,
      upBias: 1.3,
    });
  } else {
    ctx.playSfx("crowd.aah", { volume: 0.45 });
  }
  if (st.human >= 0 && st.picks[st.human]) {
    ctx.playSfx(right[st.human] ? "star.get" : "boing", { volume: 0.5 });
  }
}

/** Every pick as a token in its player's colour along the card's near edge. */
function placeTokens(st: St): void {
  const byCard = new Map<number, number[]>();
  for (let id = 0; id < 4; id++) {
    const p = st.picks[id];
    if (!p) continue;
    const list = byCard.get(p.card) ?? [];
    list.push(id);
    byCard.set(p.card, list);
  }
  for (const [cardIdx, ids] of byCard) {
    const c = st.cards[cardIdx];
    ids.forEach((id, k) => {
      const tok = st.tokens[id];
      tok.mesh.visible = true;
      tok.pop = -1.4 - k * 0.3; // drop in once the flip lands
      tok.mesh.scale.setScalar(0.0001);
      tok.mesh.position.set(c.x + (k - (ids.length - 1) / 2) * 0.36, CARD_Y + 0.07, c.z + CARD_D / 2 - 0.05);
    });
  }
}

function endReveal(st: St): void {
  st.cards[st.target].solved = true;
  st.cards[st.twin].solved = true;
  st.round += 1;
  if (st.round < ROUNDS) {
    startRound(st);
    return;
  }
  startEnd(st);
}

function ranking(st: St): number[] {
  const mean = st.rightT.map((ts) => (ts.length ? ts.reduce((a, b) => a + b, 0) / ts.length : Infinity));
  const tb = [0, 1, 2, 3].map(() => st.ctx.rng());
  return [0, 1, 2, 3].sort((a, b) => st.scores[b] - st.scores[a] || mean[a] - mean[b] || tb[a] - tb[b]);
}

let finalRanking: number[] = [];

function startEnd(st: St): void {
  const ctx = st.ctx;
  st.phase = "end";
  st.phaseT = 0;
  st.target = -1;
  st.twin = -1;
  for (const c of st.cards) if (!c.solved) flip(c, true);
  for (const t of st.tokens) t.mesh.visible = false;
  st.youFrame.visible = false;
  for (let id = 0; id < 4; id++) ctx.hud.tag(id, null);
  finalRanking = ranking(st);
  const win = finalRanking[0];
  ctx.announce(`${ctx.players[win]?.name ?? "?"} WINS!`, { durationMs: 1300, sound: null });
  ctx.playSfx("crowd.cheer", { volume: 0.8 });
  for (const ch of ctx.characters) ch.anim.idle();
  ctx.characters[win]?.anim.cheer();
  const pts: Array<{ x: number; y: number; z: number }> = [];
  for (let i = 0; i < 8; i++) {
    pts.push({ x: (st.fx() * 2 - 1) * 2, y: CARD_Y + 0.3, z: (st.fx() * 2 - 1) * 1.8 });
  }
  st.burst.spawn(pts, {
    colors: [palette.sun, palette.candy, palette.bubble, palette.mint, palette.white],
    countPerPoint: 4,
    speed: 1.5,
    life: 1.2,
    upBias: 2,
  });
}

/* ------------------------------------------------------------------ */
/*  Input                                                              */
/* ------------------------------------------------------------------ */

function cardAt(st: St, nx: number, ny: number): number | null {
  st.ndc.set(nx * 2 - 1, -(ny * 2 - 1));
  st.ctx.camera.updateMatrixWorld();
  st.ray.setFromCamera(st.ndc, st.ctx.camera);
  if (!st.ray.ray.intersectPlane(st.plane, st.hitPt)) return null;
  let best: number | null = null;
  let bestD = Infinity;
  for (const c of st.cards) {
    const dx = Math.abs(st.hitPt.x - c.x);
    const dz = Math.abs(st.hitPt.z - c.z);
    if (dx > HIT_HX || dz > HIT_HZ) continue;
    const d = dx / CARD_W + dz / CARD_D;
    if (d < bestD) {
      bestD = d;
      best = c.index;
    }
  }
  return best;
}

function tryPick(st: St, index: number): void {
  if (st.human < 0) return;
  if (st.phase !== "pick" || st.picks[st.human] || st.pending !== null) return;
  const c = st.cards[index];
  if (!c) return;
  if (c.faceUp || c.solved) {
    c.shake = 1;
    st.ctx.playSfx("ui.click", { volume: 0.35, pitch: -5 });
    return;
  }
  st.pending = index;
}

/* ------------------------------------------------------------------ */
/*  Fixed step                                                         */
/* ------------------------------------------------------------------ */

function step(st: St, dt: number): void {
  const ctx = st.ctx;
  st.phaseT += dt;
  st.clock += dt;

  switch (st.phase) {
    case "deal":
      setSign(st.sign, "GET READY…");
      if (st.phaseT >= DEAL_T) startPeek(st);
      break;
    case "peek": {
      const left = Math.max(0, PEEK_T - st.phaseT);
      ctx.hud.timer(left, PEEK_T);
      setSign(st.sign, `MEMORIZE!  ${Math.max(1, Math.ceil(left))}`);
      if (st.phaseT >= PEEK_T) startHide(st);
      break;
    }
    case "hide":
      ctx.hud.timer(null);
      setSign(st.sign, "GET READY…");
      if (st.phaseT >= HIDE_T) startRound(st);
      break;
    case "target":
      setSign(st.sign, `ROUND ${st.round + 1}/${ROUNDS} · FIND ITS TWIN!`);
      ctx.hud.timer(PICK_T, PICK_T);
      if (st.phaseT >= TARGET_T) {
        st.phase = "pick";
        st.phaseT = 0;
      }
      break;
    case "pick": {
      st.pickT = st.phaseT;
      ctx.hud.timer(Math.max(0, PICK_T - st.phaseT), PICK_T);
      if (st.pending !== null && st.human >= 0) {
        const idx = st.pending;
        st.pending = null;
        const c = st.cards[idx];
        if (c && !c.faceUp && !c.solved) lockPick(st, st.human, idx);
      }
      for (const id of st.automated) {
        const plan = st.plans[id];
        if (plan && !st.picks[id] && st.pickT >= plan.t) lockPick(st, id, plan.card);
      }
      if (st.picks.every((p) => p !== null) || st.phaseT >= PICK_T) {
        ctx.hud.timer(null);
        setSign(st.sign, `ROUND ${st.round + 1}/${ROUNDS}`);
        startReveal(st);
      }
      break;
    }
    case "reveal":
      if (st.phaseT >= UNFLIP_AT && st.phaseT - dt < UNFLIP_AT) {
        for (const p of st.picks) {
          if (p && p.card !== st.twin && p.card !== st.target) flip(st.cards[p.card], false);
        }
      }
      if (st.phaseT >= REVEAL_T) endReveal(st);
      break;
    case "end":
      setSign(st.sign, "FINAL SCORE");
      if (st.phaseT >= END_T) {
        st.phase = "done";
        st.finished = true;
        ctx.finish(finalRanking);
      }
      break;
    default:
      break;
  }

  animateCards(st, dt);
  animateMarkers(st, dt);
  st.burst.update(dt);
}

function animateMarkers(st: St, dt: number): void {
  // Target frame: gold, pulsing, on the lifted target card.
  const tgt = st.target >= 0 ? st.cards[st.target] : null;
  const showTarget = !!tgt && (st.phase === "target" || st.phase === "pick" || st.phase === "reveal");
  st.targetFrame.visible = showTarget;
  if (showTarget && tgt) {
    st.targetFrame.position.set(tgt.x, tgt.mesh.position.y + 0.04, tgt.z);
    st.targetFrame.scale.setScalar(1 + 0.04 * Math.sin(st.clock * 9));
  }
  // The local player's pick: a frame in their colour + their token.
  if (st.human >= 0) {
    const p = st.picks[st.human];
    if (p && st.youFrame.visible) {
      const c = st.cards[p.card];
      st.youFrame.position.set(c.x, c.mesh.position.y + 0.05, c.z);
      if (st.phase === "pick") {
        const tok = st.tokens[st.human];
        tok.mesh.position.set(c.x, c.mesh.position.y + 0.06, c.z);
      }
    }
    // Keyboard cursor (drawn over the cards).
    const cIdx = st.curR * GRID_COLS + st.curC;
    const cc = st.cards[cIdx];
    st.cursor.visible = st.cursorOn && st.phase === "pick" && !st.picks[st.human];
    if (st.cursor.visible && cc) {
      st.cursor.position.set(cc.x, cc.mesh.position.y + 0.06, cc.z);
      st.cursor.scale.setScalar(1 + 0.05 * Math.sin(st.clock * 10));
    }
  } else {
    st.cursor.visible = false;
  }
  for (const tok of st.tokens) {
    if (!tok.mesh.visible || st.phase === "pick" || st.phase === "target") continue;
    if (tok.pop < 1) {
      tok.pop = Math.min(1, tok.pop + dt / 0.18);
      const k = Math.max(0, tok.pop);
      tok.mesh.scale.setScalar(Math.max(0.0001, tok.radius * (k < 1 ? 1 + 0.3 * Math.sin(Math.PI * k) : 1)));
    }
  }
}


/* ------------------------------------------------------------------ */
/*  Dev/CI read probe (window.__SSP_MM__), read-only                   */
/* ------------------------------------------------------------------ */

interface MemoryProbe {
  phase: Phase;
  round: number;
  target: number;
  twin: number;
  scores: number[];
  picks: (Pick | null)[];
  /** Card centres in CSS pixels. */
  cards: Array<{ i: number; x: number; y: number; w: number; faceUp: boolean; solved: boolean }>;
}

function probe(st: St): MemoryProbe {
  const cam = st.ctx.camera;
  cam.updateMatrixWorld();
  const { w, h } = viewportSize();
  const v = new THREE.Vector3();
  const px = (x: number, z: number): [number, number] => {
    v.set(x, CARD_Y, z).project(cam);
    return [((v.x + 1) / 2) * w, ((1 - v.y) / 2) * h];
  };
  return {
    phase: st.phase,
    round: st.round,
    target: st.target,
    twin: st.twin,
    scores: [...st.scores],
    picks: st.picks.map((p) => (p ? { ...p } : null)),
    cards: st.cards.map((c) => {
      const [x, y] = px(c.x, c.z);
      const [lx] = px(c.x - CARD_W / 2, c.z);
      const [rx] = px(c.x + CARD_W / 2, c.z);
      return { i: c.index, x, y, w: rx - lx, faceUp: c.faceUp, solved: c.solved };
    }),
  };
}

function setProbe(st: St | null): void {
  if (typeof window === "undefined" || !contactProbeLive()) return;
  const win = window as unknown as { __SSP_MM__?: () => MemoryProbe | null };
  if (st) win.__SSP_MM__ = () => (S === st ? probe(st) : null);
  else delete win.__SSP_MM__;
}

/* ------------------------------------------------------------------ */
/*  The minigame                                                       */
/* ------------------------------------------------------------------ */

const memoryMatch: Minigame = {
  id: "memory_match",
  name: "Memory Match",
  genre: "memory",
  howTo:
    "Memorize the cards! Then a card flips up: race to tap its twin. Right = +1, fastest right = +2. Most points after 5 rounds wins.",
  goal: "Tap the twin of the shown card",
  tap: "PICK",
  tapOnTouch: false,
  steer: false,
  tapSfx: "pop",
  rules: {
    format: "ffa",
    length: "5 rounds",
    win: "Most points after 5 rounds",
    touch: ["Watch the cards while they're face-up", "Tap the twin of the card that flips up", "Fastest right answer gets +2"],
    keys: ["Arrows: move the cursor", "Space: pick the card", "Or click a card"],
  },

  setup(ctx: MinigameContext) {
    const autoplay = isAutoplay();
    const automated = automatedSeatIds(ctx.players, autoplay);
    let human = -1;
    if (!autoplay) {
      for (const p of ctx.players) {
        if (isLocalPlayer(ctx.players, p.id)) {
          human = p.id;
          break;
        }
      }
    }

    // ---- gameplay rng, fixed order: icons, deck, CPU recall, fx seed ----
    const icons: IconId[] = [...ICON_IDS];
    for (let i = icons.length - 1; i > 0; i--) {
      const j = Math.floor(ctx.rng() * (i + 1));
      [icons[i], icons[j]] = [icons[j], icons[i]];
    }
    const deck: number[] = [];
    for (let p = 0; p < PAIRS; p++) deck.push(p, p);
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(ctx.rng() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    const recall = [0, 0, 0, 0];
    for (const id of automated) recall[id] = uniform(ctx.rng, CPU_RECALL_LO, CPU_RECALL_HI) / cpuSkill();
    const fx = mulberry32(Math.floor(ctx.rng() * 0xffffffff));

    const root = new THREE.Group();
    ctx.scene.add(root);
    const table = buildTable();
    root.add(table.group);

    const cards: Card[] = deck.map((pair, index) => {
      const row = Math.floor(index / GRID_COLS);
      const col = index % GRID_COLS;
      const { x, z } = gridPos(row, col);
      const cm = createCardMesh(icons[pair]);
      cm.mesh.position.set(x, CARD_Y, z);
      root.add(cm.mesh);
      return {
        index,
        pair,
        x,
        z,
        mesh: cm.mesh,
        faceMat: cm.faceMat,
        backMat: cm.backMat,
        faceUp: false,
        solved: false,
        rot: 0,
        flipFrom: 0,
        flipTo: 0,
        flipT: -1,
        raise: 0,
        pop: 0,
        shake: 0,
        hop: 1,
      };
    });

    const frames = { frameMats: [] as THREE.MeshBasicMaterial[], frameGeoms: [] as THREE.BufferGeometry[] };
    const targetFrame = makeFrame(frames, 1.1, palette.white, 10);
    const humanColor = human >= 0 ? playerColor(ctx, human) : palette.white;
    const youFrame = makeFrame(frames, 1.04, humanColor, 11);
    const cursor = makeFrame(frames, 1.18, palette.white, 13, cursorTexture);
    root.add(targetFrame, youFrame, cursor);

    const tokenGeom = new THREE.CylinderGeometry(1, 1, 0.08 / 0.2, 32);
    const tokens: Token[] = [];
    for (let id = 0; id < 4; id++) {
      const you = id === human;
      const color = playerColor(ctx, id);
      const name = ctx.players[id]?.name ?? `P${id + 1}`;
      const tex = makeTokenTexture(color, you ? "YOU" : name.charAt(0).toUpperCase());
      const side = new THREE.MeshBasicMaterial({ color: hex(palette.ink), depthTest: false, transparent: true });
      const top = new THREE.MeshBasicMaterial({ map: tex, depthTest: false, transparent: true });
      const mesh = new THREE.Mesh(tokenGeom, [side, top, side]);
      mesh.renderOrder = 12 + (you ? 1 : 0);
      mesh.visible = false;
      root.add(mesh);
      tokens.push({ mesh, mats: [side, top], tex, radius: you ? 0.24 : 0.19, pop: 1 });
    }

    const sign = makeSign();
    root.add(sign.mesh);

    const st: St = {
      ctx,
      root,
      table,
      cards,
      phase: "deal",
      phaseT: 0,
      accum: 0,
      finished: false,
      round: 0,
      target: -1,
      twin: -1,
      picks: [null, null, null, null],
      pickT: 0,
      plans: [null, null, null, null],
      scores: [0, 0, 0, 0],
      rightT: [[], [], [], []],
      automated,
      recall,
      knows: [0, 1, 2, 3].map(() => new Array<boolean>(PAIRS).fill(false)),
      human,
      pending: null,
      curR: 1,
      curC: 1,
      cursorOn: false,
      cursor,
      targetFrame,
      youFrame,
      frameMats: frames.frameMats,
      frameGeoms: frames.frameGeoms,
      tokens,
      tokenGeom,
      sign,
      burst: createStarBurst(root, 72, fx),
      fx,
      ndc: new THREE.Vector2(),
      ray: new THREE.Raycaster(),
      plane: new THREE.Plane(new THREE.Vector3(0, 1, 0), -(CARD_Y + CARD_T / 2)),
      hitPt: new THREE.Vector3(),
      clock: 0,
    };
    S = st;
    finalRanking = [];
    setProbe(st);
    setSign(sign, "GET READY…");

    for (const ch of ctx.characters) ch.anim.idle();
    frameMinigame(ctx.camera, () => ({ box: layout(st), dir: new THREE.Vector3(0, 10, 3.4), fov: 40 }));

    for (const p of ctx.players) ctx.hud.score(p.id, 0);
    ctx.hud.unit("pts");

    // Deal hop: cards bounce in sequence once play starts.
    cards.forEach((c, i) => (c.hop = -i * 0.04));

    ctx.input.pointer = (x: number, y: number, down: boolean): void => {
      if (!down || st.finished || st.human < 0) return;
      const idx = cardAt(st, x, y);
      if (idx === null) return;
      st.curR = Math.floor(idx / GRID_COLS);
      st.curC = idx % GRID_COLS;
      tryPick(st, idx);
    };
    ctx.input.key = (action: string): void => {
      if (st.finished || st.human < 0) return;
      if (action === "confirm") {
        if (!st.cursorOn) {
          st.cursorOn = true;
          return;
        }
        tryPick(st, st.curR * GRID_COLS + st.curC);
        return;
      }
      const wasOn = st.cursorOn;
      st.cursorOn = true;
      if (!wasOn) return;
      if (action === "left") st.curC = Math.max(0, st.curC - 1);
      else if (action === "right") st.curC = Math.min(GRID_COLS - 1, st.curC + 1);
      else if (action === "up") st.curR = Math.max(0, st.curR - 1);
      else if (action === "down") st.curR = Math.min(GRID_ROWS - 1, st.curR + 1);
      else return;
      ctx.playSfx("ui.click", { volume: 0.3, pitch: 3 });
    };
  },

  update(dt: number) {
    const st = S;
    if (!st || st.finished || isPracticeBeat()) return;
    st.accum += dt;
    let steps = 0;
    while (st.accum + 1e-6 >= SIM_STEP && steps < MAX_SIM_STEPS && !st.finished) {
      st.accum -= SIM_STEP;
      steps += 1;
      step(st, SIM_STEP);
    }
    // A stalled frame drops its leftover instead of banking time.
    if (steps >= MAX_SIM_STEPS && st.accum >= SIM_STEP) st.accum = 0;
  },

  teardown() {
    const st = S;
    if (!st) return;
    const ctx = st.ctx;
    st.root.removeFromParent();
    st.table.dispose();
    for (const c of st.cards) {
      c.faceMat.dispose();
      c.backMat.dispose();
    }
    for (const m of st.frameMats) m.dispose();
    for (const g of st.frameGeoms) g.dispose();
    for (const t of st.tokens) {
      for (const m of t.mats) m.dispose();
      t.tex.dispose();
    }
    st.tokenGeom.dispose();
    st.sign.mesh.geometry.dispose();
    (st.sign.mesh.material as THREE.Material).dispose();
    st.sign.tex.dispose();
    st.burst.clear();
    for (const ch of ctx.characters) ch.anim.idle();
    ctx.hud.timer(null);
    ctx.input.pointer = () => {};
    ctx.input.key = () => {};
    setProbe(null);
    S = null;
  },
};


export function loadMemoryMatch(): Promise<Minigame> {
  return Promise.resolve(memoryMatch);
}

export default memoryMatch;
