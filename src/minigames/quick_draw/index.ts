/**
 * CORK QUICK-DRAW — a 1-vs-1 duel minigame.
 *
 * Two duelists face off on a carnival stage, each holding a cork popgun with
 * a balloon tied above their head. The sign board reads READY… and, at a
 * random moment, flips to FIRE!: the first to tap pops the rival's balloon
 * and scores. Sometimes the board flashes a decoy WAIT! first; tap before
 * FIRE! and the point goes to your rival. First to 3 points wins (24 s cap:
 * then the leader wins, a tie goes to the fastest single draw). The other two
 * players watch from the sidelines and cheer.
 *
 * Duelists: the local seat plus a rival drawn with ctx.rng; with no local
 * seat (all CPU, autoplay) two seats are drawn. 1v1 games are not dealt by
 * the board's 4-player roulette (see registry.ts): they are free-play duels.
 *
 * Contract: ctx.finish([winner, loser, ...watchers], [winner]): only the
 * winner is paid.
 *
 * Determinism: fixed-step sim at 60 Hz with an integer step index; every
 * draw comes from ctx.rng at a fixed point of a round, and a human tap
 * enters the sim only as an edge consumed inside a step. Reactions are
 * measured in steps. Telemetry: window.__QUICKDRAW__.
 */
import * as THREE from "three";
import { cpuSkill, isLocalPlayer, isPracticeBeat, type Minigame, type MinigameContext } from "../framework";
import { registerMinigame } from "../registry";
import { box as frameBox, frameMinigame } from "../framing";
import { palette, hex } from "../../config/palette";
import { isAutoplay } from "../../core/debug";
import { celGradient } from "../../characters/cel";
import { audio } from "../../audio/audioEngine";
import { buildDuelEnvironment, type DuelEnvironment } from "./environment";

const FIXED_DT = 1 / 60;
const MAX_STEPS_PER_FRAME = 12;

const WIN_POINTS = 3;
/** Game clock: past this the leader wins (inside the screen's 30 s limit). */
const MATCH_CAP = 24;
/** READY… lasts this long (s) before FIRE!, drawn evenly. */
const READY_MIN = 1.0;
const READY_MAX = 2.4;
/** Chance a round shows a decoy WAIT! before FIRE!, and how long it shows (s). */
const DECOY_CHANCE = 0.4;
const DECOY_SHOW = 0.45;
/**
 * BALANCE: a CPU draws 0.24–0.50 s after FIRE! (a quick human is ~0.25–0.35 s
 * on a phone), and bites on a decoy 1 time in 6. An attentive player wins
 * most duels; a slow or jumpy one loses them.
 */
const CPU_REACT_MIN = 0.24;
const CPU_REACT_MAX = 0.5;
const CPU_DECOY_BITE = 1 / 6;
/** Celebration after a point (s), and after the match before finish (s). */
const POINT_PAUSE = 1.2;
const POST_GAME_TIME = 1.9;
const CORK_FLIGHT = 0.28;
const DUEL_X = 1.9;

type Phase = "ready" | "fire" | "point" | "over";
type SignState = "ready" | "wait" | "fire" | "pop" | "foul" | "draw" | "win";

interface Duelist {
  id: number;
  /** -1 left, +1 right. */
  side: number;
  cpu: boolean;
  score: number;
  /** Best reaction this match (s), for the tie-break. */
  best: number;
  /** This round: the step a CPU fires at, and the step it false-starts at (or -1). */
  cpuFireStep: number;
  cpuFoulStep: number;
  gun: THREE.Group;
  balloon: THREE.Group;
  balloonMat: THREE.MeshToonMaterial;
  popT: number;
  recoilT: number;
}

interface Cork {
  mesh: THREE.Mesh;
  from: THREE.Vector3;
  to: THREE.Vector3;
  t: number;
  /** Duelist whose balloon this cork pops on arrival. */
  target: Duelist;
}

interface QuickDrawState {
  ctx: MinigameContext;
  root: THREE.Group;
  duel: [Duelist, Duelist];
  watchers: number[];
  local: Duelist | null;
  phase: Phase;
  step: number;
  simTime: number;
  roundStart: number;
  fireStep: number;
  decoyStep: number;
  /** Step the current phase ends (point / over pauses). */
  phaseEnd: number;
  humanTap: boolean;
  round: number;
  winner: Duelist | null;
  finished: boolean;
  postT: number;
  sign: { canvas: HTMLCanvasElement; tex: THREE.CanvasTexture; state: SignState | null; detail: string };
  board: THREE.Group;
  boardKick: number;
  corks: Cork[];
  sparks: { mesh: THREE.Mesh; vel: THREE.Vector3; life: number }[];
  log: string[];
  /** The fairground around the stage (presentation only). */
  env: DuelEnvironment;
}

let round: QuickDrawState | null = null;

/* ------------------------------------------------------------------ */
/*  Art                                                                */
/* ------------------------------------------------------------------ */

function toon(color: string): THREE.MeshToonMaterial {
  return new THREE.MeshToonMaterial({ color: hex(color), gradientMap: celGradient });
}

function inked(geo: THREE.BufferGeometry, color: string, ink = 1.07): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(geo, toon(color));
  body.castShadow = true;
  const shell = new THREE.Mesh(geo.clone().scale(ink, ink, ink), new THREE.MeshBasicMaterial({ color: hex(palette.ink), side: THREE.BackSide }));
  g.add(shell, body);
  return g;
}

function makeArena(root: THREE.Group): void {
  // Stage disk with a candy-striped skirt.
  // The stage top is a carnival sunburst: alternating cream and sand wedges.
  const burst = document.createElement("canvas");
  burst.width = burst.height = 256;
  const bctx = burst.getContext("2d");
  if (bctx) {
    for (let i = 0; i < 20; i++) {
      bctx.beginPath();
      bctx.moveTo(128, 128);
      bctx.arc(128, 128, 182, (i / 20) * Math.PI * 2, ((i + 1) / 20) * Math.PI * 2);
      bctx.closePath();
      bctx.fillStyle = i % 2 === 0 ? palette.tentCream : palette.sand;
      bctx.fill();
    }
    bctx.beginPath();
    bctx.arc(128, 128, 30, 0, Math.PI * 2);
    bctx.fillStyle = palette.sun;
    bctx.fill();
  }
  const burstTex = new THREE.CanvasTexture(burst);
  burstTex.colorSpace = THREE.SRGBColorSpace;
  const stageTop = new THREE.MeshToonMaterial({ map: burstTex, gradientMap: celGradient });
  const stage = new THREE.Mesh(new THREE.CylinderGeometry(4.6, 4.8, 0.3, 48), [toon(palette.woodDark), stageTop, toon(palette.woodDark)]);
  stage.position.y = -0.15;
  stage.receiveShadow = true;
  root.add(stage);
  const segs = 24;
  for (let i = 0; i < segs; i++) {
    const a0 = (i / segs) * Math.PI * 2;
    const skirt = new THREE.Mesh(
      new THREE.CylinderGeometry(4.82, 4.82, 0.32, 3, 1, true, a0, (Math.PI * 2) / segs),
      toon(i % 2 === 0 ? palette.candy : palette.cream),
    );
    skirt.position.y = -0.15;
    root.add(skirt);
  }
  // The duel lane between the two marks.
  const lane = new THREE.Mesh(new THREE.BoxGeometry(DUEL_X * 2 + 1.4, 0.02, 1.0), toon(palette.sand));
  lane.position.set(0, 0.01, 0.25);
  lane.receiveShadow = true;
  root.add(lane);
  // Paces painted on the lane.
  for (let i = -2; i <= 2; i++) {
    if (i === 0) continue;
    const tick = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.02, 0.6), toon(palette.woodDark));
    tick.position.set(i * 0.6, 0.025, 0.25);
    root.add(tick);
  }
  // Each duelist's mark.
  for (const side of [-1, 1]) {
    const mark = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.06, 28), toon(palette.sun));
    mark.position.set(side * DUEL_X, 0.03, 0.25);
    root.add(mark);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.05, 6, 28), toon(palette.ink));
    ring.rotation.x = Math.PI / 2;
    ring.position.set(side * DUEL_X, 0.07, 0.25);
    root.add(ring);
  }
  // Bunting along the back.
  const flags = 13;
  for (let i = 0; i < flags; i++) {
    const x = -5 + (i / (flags - 1)) * 10;
    const sag = 0.35 * Math.sin((i / (flags - 1)) * Math.PI);
    const flag = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.42, 3), toon([palette.candy, palette.sun, palette.bubble, palette.mint][i % 4]));
    flag.rotation.z = Math.PI;
    flag.position.set(x, 3.75 - sag, -2.9);
    root.add(flag);
  }
  for (const x of [-5.1, 5.1]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 4.3, 8), toon(palette.wood));
    pole.position.set(x, 1.85, -2.9);
    root.add(pole);
  }
}

/** The sign board on its post: a canvas the round redraws. */
function makeBoard(root: THREE.Group): { board: THREE.Group; canvas: HTMLCanvasElement; tex: THREE.CanvasTexture } {
  const board = new THREE.Group();
  board.position.set(0, 0, -1.55);
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 2.2, 10), toon(palette.woodDark));
  post.position.y = 1.1;
  board.add(post);
  const frame = inked(new THREE.BoxGeometry(3.2, 1.65, 0.16), palette.wood, 1.04);
  frame.position.y = 2.6;
  board.add(frame);
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 256;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const face = new THREE.Mesh(new THREE.PlaneGeometry(2.96, 1.45), new THREE.MeshBasicMaterial({ map: tex }));
  face.position.set(0, 2.6, 0.085);
  board.add(face);
  // Bulbs round the frame.
  for (let i = 0; i < 10; i++) {
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), new THREE.MeshBasicMaterial({ color: hex(palette.lampHot) }));
    const top = i < 5;
    bulb.position.set(-1.36 + (i % 5) * 0.68, top ? 3.45 : 1.75, 0.1);
    board.add(bulb);
  }
  root.add(board);
  return { board, canvas, tex };
}

const SIGN_LOOK: Record<SignState, { bg: string; fg: string; text: string }> = {
  ready: { bg: palette.cream, fg: palette.ink, text: "READY…" },
  wait: { bg: palette.lava, fg: palette.cream, text: "WAIT!" },
  fire: { bg: palette.sun, fg: palette.ink, text: "FIRE!" },
  pop: { bg: palette.mint, fg: palette.ink, text: "POP!" },
  foul: { bg: palette.lava, fg: palette.cream, text: "TOO SOON!" },
  draw: { bg: palette.bubble, fg: palette.ink, text: "DRAW!" },
  win: { bg: palette.sun, fg: palette.ink, text: "WINNER!" },
};

function drawSign(st: QuickDrawState, state: SignState, detail = ""): void {
  if (st.sign.state === state && st.sign.detail === detail) return;
  st.sign.state = state;
  st.sign.detail = detail;
  const { canvas, tex } = st.sign;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const look = SIGN_LOOK[state];
  ctx.fillStyle = look.bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = palette.ink;
  ctx.lineWidth = 14;
  ctx.strokeRect(7, 7, canvas.width - 14, canvas.height - 14);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  const big = state === "fire" ? 150 : state === "foul" ? 92 : 118;
  ctx.font = `700 ${big}px Fredoka, sans-serif`;
  const y = detail ? 108 : 132;
  ctx.lineWidth = 16;
  ctx.strokeStyle = palette.ink;
  if (look.fg !== palette.ink) ctx.strokeText(look.text, 256, y);
  ctx.fillStyle = look.fg;
  ctx.fillText(look.text, 256, y);
  if (detail) {
    ctx.font = "700 58px Fredoka, sans-serif";
    ctx.fillStyle = look.fg;
    ctx.fillText(detail, 256, 205);
  }
  tex.needsUpdate = true;
  st.boardKick = 1;
}

function makeGun(): THREE.Group {
  const gun = new THREE.Group();
  const barrel = inked(new THREE.CylinderGeometry(0.075, 0.09, 0.62, 12).rotateZ(Math.PI / 2), palette.lava);
  barrel.position.x = 0.31;
  const grip = inked(new THREE.BoxGeometry(0.12, 0.26, 0.1), palette.woodDark);
  grip.position.set(0.04, -0.15, 0);
  grip.rotation.z = -0.35;
  const cork = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.06, 0.1, 10).rotateZ(Math.PI / 2), toon(palette.wood));
  cork.position.x = 0.66;
  cork.name = "cork";
  gun.add(barrel, grip, cork);
  return gun;
}

function makeBalloon(color: string): { group: THREE.Group; mat: THREE.MeshToonMaterial } {
  const group = new THREE.Group();
  const mat = toon(color);
  const geo = new THREE.SphereGeometry(0.32, 18, 14);
  geo.scale(1, 1.18, 1);
  const body = new THREE.Mesh(geo, mat);
  body.castShadow = true;
  const shell = new THREE.Mesh(geo.clone().scale(1.08, 1.08, 1.08), new THREE.MeshBasicMaterial({ color: hex(palette.ink), side: THREE.BackSide }));
  const knot = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.1, 6), mat);
  knot.position.y = -0.4;
  knot.rotation.z = Math.PI;
  const glint = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshBasicMaterial({ color: hex(palette.white) }));
  glint.position.set(-0.11, 0.16, 0.24);
  const string = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.75, 4), new THREE.MeshBasicMaterial({ color: hex(palette.ink) }));
  string.position.y = -0.82;
  group.add(shell, body, knot, glint, string);
  return { group, mat };
}

/* ------------------------------------------------------------------ */
/*  Sim                                                                */
/* ------------------------------------------------------------------ */

const secs = (s: number): number => Math.round(s * 60);

function other(st: QuickDrawState, d: Duelist): Duelist {
  return st.duel[0] === d ? st.duel[1] : st.duel[0];
}

/** Every rng draw for a round, always the same count, at the round's first step. */
function startRound(st: QuickDrawState): void {
  const rng = st.ctx.rng;
  st.round++;
  st.phase = "ready";
  st.roundStart = st.step;
  st.fireStep = st.step + secs(READY_MIN + rng() * (READY_MAX - READY_MIN));
  const decoy = rng() < DECOY_CHANCE;
  const decoyAt = st.roundStart + secs(0.35) + Math.floor(rng() * Math.max(1, st.fireStep - st.roundStart - secs(0.35 + DECOY_SHOW + 0.25)));
  st.decoyStep = decoy && st.fireStep - st.roundStart > secs(DECOY_SHOW + 0.9) ? decoyAt : -1;
  for (const d of st.duel) {
    const skill = cpuSkill();
    d.cpuFireStep = st.fireStep + secs((CPU_REACT_MIN + rng() * (CPU_REACT_MAX - CPU_REACT_MIN)) / skill);
    const bite = rng() < CPU_DECOY_BITE / skill;
    d.cpuFoulStep = d.cpu && bite && st.decoyStep >= 0 ? st.decoyStep + secs(0.12 + rng() * 0.15) : -1;
    if (!d.cpu || !bite || st.decoyStep < 0) rng(); // keep the draw count fixed
    d.balloon.visible = true;
    d.balloon.scale.setScalar(1);
    d.popT = -1;
  }
  st.humanTap = false;
  drawSign(st, "ready");
  st.log.push(`r${st.round} fire@${st.fireStep - st.roundStart} decoy@${st.decoyStep >= 0 ? st.decoyStep - st.roundStart : "-"}`);
}

function fireCork(st: QuickDrawState, shooter: Duelist): void {
  const target = other(st, shooter);
  const from = new THREE.Vector3();
  shooter.gun.getObjectByName("cork")?.getWorldPosition(from);
  const to = new THREE.Vector3();
  target.balloon.getWorldPosition(to);
  const cork = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.06, 0.1, 10).rotateZ(Math.PI / 2), toon(palette.wood));
  cork.position.copy(from);
  st.root.add(cork);
  st.corks.push({ mesh: cork, from, to, t: 0, target });
  shooter.recoilT = 0.25;
  st.ctx.playSfx("pop", { volume: 0.9, pitch: 0.8 });
}

function scorePoint(st: QuickDrawState, winner: Duelist, reactSteps: number | null): void {
  winner.score++;
  const loser = other(st, winner);
  if (reactSteps !== null) {
    const s = reactSteps / 60;
    winner.best = Math.min(winner.best, s);
    fireCork(st, winner);
    drawSign(st, "pop", `${st.ctx.players.find((p) => p.id === winner.id)?.name ?? ""} ${s.toFixed(2)}s`);
  } else {
    // A false start: the rival's cork still flies, for the point.
    fireCork(st, winner);
    drawSign(st, "foul", `${st.ctx.players.find((p) => p.id === loser.id)?.name ?? ""} fired early`);
    st.ctx.playSfx("boing", { pitch: 0.8 });
  }
  st.ctx.characters[winner.id]?.anim.cheer();
  st.ctx.characters[loser.id]?.anim.sad();
  for (const id of st.watchers) st.ctx.characters[id]?.anim.cheer();
  st.env.cheer(winner.score >= WIN_POINTS);
  st.log.push(`r${st.round} point ${winner.id}${reactSteps !== null ? ` in ${reactSteps}` : " (foul)"} -> ${st.duel.map((d) => d.score).join(":")}`);
  if (winner.score >= WIN_POINTS) endMatch(st, winner);
  else {
    st.phase = "point";
    st.phaseEnd = st.step + secs(POINT_PAUSE);
  }
}

function endMatch(st: QuickDrawState, winner: Duelist): void {
  st.phase = "over";
  st.winner = winner;
  st.phaseEnd = st.step + secs(POST_GAME_TIME);
  const name = st.ctx.players.find((p) => p.id === winner.id)?.name ?? "";
  st.ctx.announce(`${name.toUpperCase()} WINS THE DUEL!`, { durationMs: 1800, sound: "cheer" });
  if (st.sign.state !== "pop" && st.sign.state !== "foul") drawSign(st, "win", name);
  audio.music.intensity(1);
}

function stepFixed(st: QuickDrawState): void {
  const tap = st.humanTap;
  st.humanTap = false;
  const local = st.local;

  // Game clock: the leader wins; a tie goes to the faster best draw.
  if (st.phase !== "over" && st.step >= secs(MATCH_CAP)) {
    const [a, b] = st.duel;
    const lead = a.score !== b.score ? (a.score > b.score ? a : b) : a.best <= b.best ? a : b;
    drawSign(st, "win", st.ctx.players.find((p) => p.id === lead.id)?.name ?? "");
    endMatch(st, lead);
    return;
  }

  switch (st.phase) {
    case "ready": {
      const decoyOn = st.decoyStep >= 0 && st.step >= st.decoyStep && st.step < st.decoyStep + secs(DECOY_SHOW);
      drawSign(st, decoyOn ? "wait" : "ready");
      if (st.decoyStep >= 0 && st.step === st.decoyStep) st.ctx.playSfx("whistle", { volume: 0.5, pitch: 1.3 });
      // False starts: the human's tap, or a CPU biting on the decoy.
      if (local && tap) {
        scorePoint(st, other(st, local), null);
        return;
      }
      for (const d of st.duel) {
        if (d.cpu && d.cpuFoulStep >= 0 && st.step >= d.cpuFoulStep) {
          scorePoint(st, other(st, d), null);
          return;
        }
      }
      if (st.step >= st.fireStep) {
        st.phase = "fire";
        drawSign(st, "fire");
        st.ctx.playSfx("whistle", { volume: 1, pitch: 1 });
        audio.music.intensity(0.9);
      }
      return;
    }
    case "fire": {
      const shots: Duelist[] = [];
      for (const d of st.duel) {
        if (d.cpu ? st.step >= d.cpuFireStep : tap && d === local) shots.push(d);
      }
      if (shots.length === 2) {
        // Same step: a draw, the round runs again with no point.
        drawSign(st, "draw", "same instant!");
        for (const d of st.duel) fireCork(st, d);
        st.phase = "point";
        st.phaseEnd = st.step + secs(POINT_PAUSE);
        st.log.push(`r${st.round} draw`);
        return;
      }
      if (shots.length === 1) scorePoint(st, shots[0], st.step - st.fireStep);
      else if (st.step - st.fireStep > secs(3)) {
        // Nobody drew (only possible with two humans away): no point.
        st.phase = "point";
        st.phaseEnd = st.step;
      }
      return;
    }
    case "point":
      if (st.step >= st.phaseEnd) {
        for (const d of st.duel) st.ctx.characters[d.id]?.anim.idle();
        for (const id of st.watchers) st.ctx.characters[id]?.anim.idle();
        audio.music.intensity(0.6);
        startRound(st);
      }
      return;
    case "over":
      return;
  }
}

/* ------------------------------------------------------------------ */
/*  Presentation                                                       */
/* ------------------------------------------------------------------ */

function burst(st: QuickDrawState, at: THREE.Vector3, color: string): void {
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 4), new THREE.MeshBasicMaterial({ color: hex(color) }));
    m.position.copy(at);
    st.root.add(m);
    st.sparks.push({ mesh: m, vel: new THREE.Vector3(Math.cos(a) * 2.2, 1.6 + (i % 3) * 0.6, Math.sin(a) * 2.2), life: 0.6 });
  }
}

function updateVisuals(st: QuickDrawState, dt: number, t: number): void {
  // Board wobble when it flips.
  st.boardKick = Math.max(0, st.boardKick - dt * 3.5);
  st.board.rotation.z = Math.sin(t * 30) * 0.05 * st.boardKick;
  st.board.scale.setScalar(1 + 0.08 * st.boardKick);
  // Duelists: tense crouch while waiting, recoil when firing, balloons bob.
  for (const d of st.duel) {
    const tense = st.phase === "ready" || st.phase === "fire" ? 1 : 0;
    d.gun.rotation.z = -0.25 * Math.max(0, d.recoilT * 4) + 0.04 * Math.sin(t * 2 + d.side);
    d.recoilT = Math.max(0, d.recoilT - dt);
    d.gun.position.y = 0.72 + tense * 0.02 * Math.sin(t * 9 + d.side);
    const ch = st.ctx.characters[d.id];
    if (ch) {
      d.balloon.position.set(ch.group.position.x - d.side * 0.25, 2.25 + Math.sin(t * 1.8 + d.side) * 0.06, ch.group.position.z - 0.3);
    }
    if (d.popT >= 0) {
      d.popT += dt;
      const u = Math.min(1, d.popT / 0.12);
      d.balloon.scale.setScalar(1 + u * 0.5);
      if (u >= 1) d.balloon.visible = false;
    }
  }
  // Corks in flight.
  for (let i = st.corks.length - 1; i >= 0; i--) {
    const c = st.corks[i];
    c.t += dt;
    const u = Math.min(1, c.t / CORK_FLIGHT);
    c.mesh.position.lerpVectors(c.from, c.to, u);
    c.mesh.position.y += Math.sin(Math.PI * u) * 0.35;
    c.mesh.rotation.y += dt * 20;
    if (u >= 1) {
      c.mesh.removeFromParent();
      c.mesh.geometry.dispose();
      (c.mesh.material as THREE.Material).dispose();
      st.corks.splice(i, 1);
      if (c.target.balloon.visible && c.target.popT < 0) {
        c.target.popT = 0;
        const color = st.ctx.players.find((p) => p.id === c.target.id)?.color ?? palette.candy;
        burst(st, c.to, color);
        st.ctx.playSfx("pop", { volume: 1, pitch: 1.3 });
        st.ctx.characters[c.target.id]?.anim.squash();
      }
    }
  }
  for (let i = st.sparks.length - 1; i >= 0; i--) {
    const s = st.sparks[i];
    s.life -= dt;
    s.vel.y -= 6 * dt;
    s.mesh.position.addScaledVector(s.vel, dt);
    if (s.life <= 0) {
      s.mesh.removeFromParent();
      s.mesh.geometry.dispose();
      (s.mesh.material as THREE.Material).dispose();
      st.sparks.splice(i, 1);
    }
  }
}

function publishDebug(st: QuickDrawState): void {
  (window as unknown as { __QUICKDRAW__?: unknown }).__QUICKDRAW__ = {
    phase: st.phase,
    round: st.round,
    step: st.step,
    duel: st.duel.map((d) => ({ id: d.id, cpu: d.cpu, score: d.score, best: d.best })),
    watchers: st.watchers,
    fireIn: st.phase === "ready" ? st.fireStep - st.step : null,
    log: st.log.slice(-12),
  };
}

/* ------------------------------------------------------------------ */
/*  Minigame                                                           */
/* ------------------------------------------------------------------ */

const quickDraw: Minigame = {
  id: "quick_draw",
  name: "Cork Quick-Draw",
  genre: "timing",
  howTo: "1 vs 1 duel! Wait for the sign to say FIRE!, then tap as fast as you can to pop your rival's balloon. Tap too soon (even on a WAIT!) and the point is theirs. First to 3 wins.",
  goal: "Wait for FIRE!, then tap first",
  tap: "FIRE",
  steer: false,
  tapSfx: "pop",
  tapOnTouch: true,
  rules: {
    format: "1v1",
    length: "First to 3",
    win: "Pop your rival's balloon 3 times: tap first after FIRE!",
    touch: ["Tap FIRE (or anywhere) the moment the sign says FIRE!", "Don't fall for WAIT!"],
    keys: ["Space: fire", "Wait for FIRE!, a tap on WAIT! is a foul"],
  },

  setup(ctx: MinigameContext) {
    const root = new THREE.Group();
    ctx.scene.add(root);
    makeArena(root);
    const { board, canvas, tex } = makeBoard(root);

    frameMinigame(ctx.camera, {
      // The duel lane, both balloons, the sign and the watchers; a tight box
      // so a portrait phone still shows big characters.
      box: frameBox([-3.3, -0.2, -1.9], [3.3, 3.45, 1.2]),
      dir: new THREE.Vector3(0, 3.6, 10),
      fov: 44,
    });

    // Duelists: the local seat and a rival, or two drawn seats with no local player.
    const humanCpu = isAutoplay();
    const ids = ctx.players.map((p) => p.id);
    const localId = humanCpu ? -1 : (ctx.players.find((p) => isLocalPlayer(ctx.players, p.id))?.id ?? -1);
    let a: number;
    let b: number;
    if (localId >= 0) {
      const rivals = ids.filter((id) => id !== localId);
      a = localId;
      b = rivals[Math.floor(ctx.rng() * rivals.length)];
    } else {
      a = ids[Math.floor(ctx.rng() * ids.length)];
      const rest = ids.filter((id) => id !== a);
      b = rest[Math.floor(ctx.rng() * rest.length)];
    }
    const makeDuelist = (id: number, side: number): Duelist => {
      const color = ctx.players.find((p) => p.id === id)?.color ?? palette.candy;
      const gun = makeGun();
      const { group: balloon, mat } = makeBalloon(color);
      root.add(balloon);
      const ch = ctx.characters[id];
      if (ch) {
        ch.group.position.set(side * DUEL_X, 0, 0.25);
        ch.setFacing(side < 0 ? Math.PI / 2 : -Math.PI / 2);
        ch.anim.idle();
        // Gun held out in front, pointing at the rival.
        gun.position.set(0, 0.72, 0.45);
        gun.rotation.y = -Math.PI / 2;
        gun.scale.setScalar(1.4);
        ch.group.add(gun);
      }
      return {
        id, side, cpu: !(id === localId), score: 0, best: Infinity,
        cpuFireStep: 0, cpuFoulStep: -1, gun, balloon, balloonMat: mat, popT: -1, recoilT: 0,
      };
    };
    const duel: [Duelist, Duelist] = [makeDuelist(a, -1), makeDuelist(b, 1)];
    const watchers = ids.filter((id) => id !== a && id !== b);
    watchers.forEach((id, i) => {
      const ch = ctx.characters[id];
      if (!ch) return;
      const x = i === 0 ? -2.75 : 2.75;
      ch.group.position.set(x, 0, -1.25);
      ch.group.scale.setScalar(0.85);
      ch.setFacing(Math.atan2(-x, 1.6));
      ch.anim.idle();
    });

    const st: QuickDrawState = {
      ctx, root, duel, watchers,
      local: duel.find((d) => !d.cpu) ?? null,
      phase: "ready", step: 0, simTime: 0, roundStart: 0, fireStep: 0, decoyStep: -1, phaseEnd: 0,
      humanTap: false, round: 0, winner: null, finished: false, postT: 0,
      sign: { canvas, tex, state: null, detail: "" }, board, boardKick: 0,
      corks: [], sparks: [], log: [],
      env: buildDuelEnvironment(root),
    };
    round = st;
    startRound(st);

    ctx.hud.unit("pops");
    for (const p of ctx.players) {
      const d = duel.find((x) => x.id === p.id);
      ctx.hud.score(p.id, d ? 0 : "—");
      ctx.hud.tag(p.id, d ? "DUEL" : "WATCH");
    }
    ctx.hud.timer(null);
    audio.music.intensity(0.6);

    const queueTap = (): void => {
      if (isPracticeBeat() || !st.local || st.phase === "over") return;
      st.humanTap = true;
    };
    ctx.input.pointer = (_x, _y, down) => {
      if (down) queueTap();
    };
    ctx.input.key = (action) => {
      if (action === "confirm") queueTap();
    };
    publishDebug(st);
  },

  update(dt: number) {
    const st = round;
    if (!st || st.finished || isPracticeBeat()) return;
    st.simTime += dt;
    let steps = 0;
    while (st.simTime >= FIXED_DT && steps < MAX_STEPS_PER_FRAME) {
      stepFixed(st);
      st.simTime -= FIXED_DT;
      st.step++;
      steps++;
      if (st.phase === "over" && st.step >= st.phaseEnd && !st.finished) {
        st.finished = true;
        // Guns away before the results podium reuses the avatars.
        for (const d of st.duel) d.gun.removeFromParent();
        for (const id of st.watchers) st.ctx.characters[id]?.group.scale.setScalar(1);
        const w = st.winner ?? st.duel[0];
        const l = other(st, w);
        st.ctx.finish([w.id, l.id, ...st.watchers], [w.id]);
        break;
      }
    }
    if (steps >= MAX_STEPS_PER_FRAME && st.simTime >= FIXED_DT) st.simTime = 0;
    for (const d of st.duel) st.ctx.hud.score(d.id, d.score);
    updateVisuals(st, dt, st.step * FIXED_DT);
    st.env.update(st.step * FIXED_DT, dt);
    publishDebug(st);
  },

  teardown() {
    const st = round;
    if (!st) return;
    for (const d of st.duel) d.gun.removeFromParent();
    st.env.dispose();
    st.root.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry?.dispose();
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) m?.dispose();
    });
    for (const d of st.duel) {
      d.gun.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.geometry?.dispose();
        (mesh.material as THREE.Material)?.dispose();
      });
    }
    st.sign.tex.dispose();
    st.root.removeFromParent();
    round = null;
    (window as unknown as { __QUICKDRAW__?: unknown }).__QUICKDRAW__ = undefined;
  },
};

registerMinigame({ id: quickDraw.id, name: quickDraw.name });

export function loadQuickDraw(): Promise<Minigame> {
  return Promise.resolve(quickDraw);
}

export default quickDraw;
