/**
 * PUSH OF WAR — 1-vs-3 tug-of-war minigame (MP7 reference).
 *
 * Three players on one side, ONE on the other. Both sides mash to push a
 * crate/rope toward the opponent's line; cross it to win. The solo side
 * gets a POWER SURGE burst so it is genuinely winnable.
 *
 * Contract: ctx.finish(ranking) gets exactly ONE winner:
 *   - SOLO wins -> ranking[0] = solo, trio sorted by contribution after.
 *   - TRIO wins -> ranking[0] = top trio contributor, rest by contribution.
 *
 * Determinism: fixed-step sim exactly like bumper_balls — FIXED_DT 1/60,
 * integer stepIndex; all sim inside stepFixed(); rng gated on integer step
 * index; human taps enter sim only as input edges consumed inside a fixed
 * step. Telemetry mirror: window.__POW__.
 */
import * as THREE from "three";
import type { Minigame, MinigameContext } from "../framework";
import { MINIGAME_MODULES } from "../index";
import { registerMinigame } from "../registry";
import { palette, hex } from "../../config/palette";
import { isAutoplay } from "../../core/debug";
import { celGradient } from "../../characters/cel";
import { audio } from "../../audio/audioEngine";

const FIXED_DT = 1 / 60;
const MAX_STEPS_PER_FRAME = 5;

const MATCH_DURATION = 8;
const SOLO_PUSH_PER_TAP = 0.705; /* re-centred for the 2.2x surge: at 0.94 the solo's mean ran ahead of the trio's and it won 16/16 */
// A human tap is worth more than a CPU teammate's mash so that real mashing matters
// (a keen phone masher lands ~6-9 taps/s; an idle CPU teammate averages 0.185/step).
const HUMAN_TAP_PUSH = 2.2;
const TRIO_PUSH_PER_TAP = 0.44;
const CPU_SOLO_MASH_P = 0.46;
const CPU_TRIO_MASH_P = 0.42;
/* TENSION RETUNE
 * The original VELOCITY_GAIN = 0.00035 peaked at ~0.24 offset — a quarter
 * of the ±0.5 goal. That made every match a tiny buzzer-margin photo-finish
 * with no visual drama. Scaling travel up multiplies every match's final
 * offset while preserving the sign distribution (outcome = sign of drift),
 * so the 38/44/19 balance stays intact while the crate actually reaches
 * and crosses the goal line.
 */
const VELOCITY_GAIN = 0.00125; /* ~4× — crate reaches/crosses the goal line */
const FRICTION = 0.948; /* marginally less damping: surges carry momentum */
const WIN_THRESHOLD = 0.5;
const CRANE_RANGE = 1.5;
/* Surges tuned to feel like real events — more frequent + longer */
const SURGE_TAPS = 28; /* charges faster → surge bursts arrive ~1.3s apart */
const SURGE_STEPS = 30; /* ~0.43s — long enough to read "POWER SURGE!" + feel it */
const SURGE_MULT = 2.6; /* stronger burst → the push-of-war climax */
const MAX_DUST_PARTICLES = 48;
const MAX_CONFETTI_PARTICLES = 64;

/* Audio escalation — music intensity + crowd reacts to the fight */
const BASE_INTENSITY = 0.6; /* calm build during normal play */
const SURGE_INTENSITY = 1.0; /* full layer stack when surging */
const CROWD_PUSH_THRESHOLD = 1.5; /* pushes/step avg to trigger crowd swell */
const CROWD_COOLDOWN = 0.35; /* min seconds between crowd SFX */

/* Finish staging */
const POST_GAME_TIME = 0.6; /* camera push-in duration (s) */
const CAMERA_PUSH_X = 3.2; /* lateral push toward winning side */
const VIGNETTE_DARKNESS = 0.42;

type Side = "solo" | "trio";

interface PlayerState {
  id: number;
  side: Side;
  contribution: number;
  mashCount: number;
  lurchT: number;
  squashT: number;
}

interface PushOfWarState {
  ctx: MinigameContext;
  root: THREE.Group;
  cratePos: number;
  soloMeter: number;
  surgeTimer: number;
  surgeActive: boolean;
  players: PlayerState[];
  soloId: number;
  trioIds: number[];
  stepIndex: number;
  simTime: number;
  ended: boolean;
  finished: boolean;
  endPath: "solo-win" | "trio-win" | "timeout" | null;
  ranking: number[];
  shakeT: number;
  shakeMag: number;
  lurchVelocity: number;
  humanTaps: number;
  humanCpu: boolean;
  crate: THREE.Mesh;
  rope: THREE.Mesh;
  indicator: THREE.Mesh;
  dustPool: THREE.Sprite[];
  confettiPool: THREE.Sprite[];
  prng: () => number;
  camBase: THREE.Vector3;
  /* Tension retune + staging state */
  maxAbsCrate: number;
  postGameT: number;
  camPushDir: number;
  lastIntensity: number;
  recentPushes: number;
  lastCrowdT: number;
  audioLog: { step: number; t: number; event: string; value: number }[];
  soloAuraRing: THREE.Mesh;
  soloTAG: THREE.Sprite;
  vignetteEl: HTMLDivElement;
}

function toon(color: number): THREE.MeshToonMaterial {
  return new THREE.MeshToonMaterial({ color, gradientMap: celGradient });
}

function makeArena(root: THREE.Group): void {
  const stage = new THREE.Mesh(new THREE.BoxGeometry(8.8, 0.3, 7), toon(hex(palette.wood)));
  stage.position.y = -0.15;
  root.add(stage);
  for (let i = 0; i < 5; i++) {
    const x = -3.2 + i * 1.6;
    const stripe = new THREE.Mesh(
      new THREE.BoxGeometry(1.5, 0.01, 7),
      toon(i < 2 ? hex(palette.woodDark) : hex(palette.wood))
    );
    stripe.position.set(x, 0.01, 0);
    root.add(stripe);
  }
  const center = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.05, 7), toon(hex(palette.cream)));
  center.position.y = 0.02;
  root.add(center);
  for (const x of [-3.3, 3.3]) {
    const goal = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.6, 7.2), toon(hex(palette.lava)));
    goal.position.set(x, 0.3, 0);
    root.add(goal);
  }
  const border = new THREE.Mesh(new THREE.BoxGeometry(9.1, 0.06, 7.4), toon(hex(palette.ink)));
  border.position.y = -0.32;
  root.add(border);
  const rope = new THREE.Mesh(new THREE.BoxGeometry(6.2, 0.08, 0.18), toon(hex(palette.cream)));
  rope.position.set(0, 0.12, 0);
  root.add(rope);
}

function findRope(root: THREE.Group): THREE.Mesh {
  let rope: THREE.Mesh | undefined;
  root.children.forEach((c) => {
    if (rope || !(c instanceof THREE.Mesh)) return;
    if (!(c.geometry instanceof THREE.BoxGeometry)) return;
    if (Math.abs(c.geometry.parameters.width - 6.2) < 0.1) rope = c;
  });
  if (!rope) throw new Error("push_of_war: rope mesh not found");
  return rope;
}

function makeCrate(root: THREE.Group): THREE.Mesh {
  const crate = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.2, 1.2), toon(hex(palette.sunDeep)));
  crate.position.set(0, 0.7, 0);
  root.add(crate);
  const strapMat = toon(hex(palette.ink));
  for (const r of [-0.62, 0.62]) {
    const strap = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.25, 1.25), strapMat);
    strap.position.set(r, 0, 0);
    crate.add(strap);
  }
  const boltGeo = new THREE.SphereGeometry(0.1, 8, 8);
  for (const sx of [-0.5, 0.5]) {
    for (const sz of [-0.5, 0.5]) {
      const bolt = new THREE.Mesh(boltGeo, toon(hex(palette.ink)));
      bolt.position.set(sx, 0.55, sz);
      crate.add(bolt);
    }
  }
  return crate;
}

function makeIndicator(root: THREE.Group): THREE.Mesh {
  const bg = new THREE.Mesh(new THREE.BoxGeometry(7.0, 0.5, 0.2), toon(hex(palette.inkSoft)));
  bg.position.set(0, 3.2, -3);
  root.add(bg);
  const fill = new THREE.Mesh(new THREE.BoxGeometry(7.0, 0.35, 0.25), toon(hex(palette.mint)));
  fill.position.set(0, 3.2, -2.9);
  root.add(fill);
  const tick = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.6, 0.3), toon(hex(palette.cream)));
  tick.position.set(0, 3.2, -2.85);
  root.add(tick);
  const soloTex = makeLabelMesh("SOLO", palette.candy);
  soloTex.position.set(3.2, 3.2, -2.8);
  root.add(soloTex);
  const trioTex = makeLabelMesh("TRIO", palette.bubble);
  trioTex.position.set(-3.2, 3.2, -2.8);
  root.add(trioTex);
  return fill;
}

function makeLabelMesh(text: string, color: string): THREE.Mesh {
  const canvas = document.createElement("canvas");
  canvas.width = 128; canvas.height = 64;
  const c = canvas.getContext("2d")!;
  c.font = "700 42px Fredoka, sans-serif";
  c.textAlign = "center"; c.textBaseline = "middle";
  c.lineJoin = "round"; c.lineWidth = 6;
  c.strokeStyle = palette.ink; c.strokeText(text, 64, 34);
  c.fillStyle = color; c.fillText(text, 64, 34);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true });
  return new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.6), mat);
}

function makeDustSprite(): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 32; canvas.height = 32;
  const c = canvas.getContext("2d")!;
  const g = c.createRadialGradient(16, 16, 1, 16, 16, 14);
  g.addColorStop(0, "rgba(255,240,200,1)");
  g.addColorStop(0.6, "rgba(255,220,160,0.6)");
  g.addColorStop(1, "rgba(255,200,120,0)");
  c.fillStyle = g; c.fillRect(0, 0, 32, 32);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0, depthWrite: false });
  const sprite = new THREE.Sprite(mat);
  sprite.visible = false;
  return sprite;
}

function makeConfettiSprite(): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 16; canvas.height = 16;
  const c = canvas.getContext("2d")!;
  c.fillStyle = "#fff"; c.fillRect(0, 0, 16, 16);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0, depthWrite: false, color: 0xffffff });
  const sprite = new THREE.Sprite(mat);
  sprite.visible = false;
  return sprite;
}

/* ------------------------------------------------------------------ */
/*  Solo identity marking (1-vs-3)                                    */
/* ------------------------------------------------------------------ */

/** Golden ground ring at the solo champion's feet — pulses with their push. */
function makeSoloAuraRing(): THREE.Mesh {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.85, 1.15, 32),
    new THREE.MeshBasicMaterial({
      color: hex(palette.sun),
      opacity: 0.85,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.02;
  ring.userData = { phase: 0 };
  return ring;
}

/** Floating "SOLO" tag above the solo champion. */
function makeSoloTag(text: string, color: string): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 128; canvas.height = 64;
  const c = canvas.getContext("2d")!;
  c.font = "700 40px Fredoka, sans-serif";
  c.textAlign = "center"; c.textBaseline = "middle";
  c.strokeStyle = palette.ink; c.lineWidth = 5;
  c.strokeText(text, 64, 32);
  c.fillStyle = color; c.fillText(text, 64, 32);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(1.6, 0.8, 1);
  return sprite;
}

/** Fullscreen radial-gradient vignette that darkens corners. */
function makeVignette(): HTMLDivElement {
  const el = document.createElement("div");
  el.style.cssText = `
    position:fixed; inset:0; pointer-events:none; z-index:78;
    background:radial-gradient(ellipse at center, transparent 30%, ${palette.ink} 90%);
    opacity:0; transition:opacity 0.6s ease-out;
  `;
  document.body.appendChild(el);
  return el;
}

function stepFixed(st: PushOfWarState): void {
  const t = st.stepIndex * FIXED_DT;
  const ctx = st.ctx;

  const soloPlayer = st.players.find((p) => p.side === "solo")!;
  let soloPush = 0;
  const soloMashed = soloMashPush(st, soloPlayer);
  if (soloMashed > 0) {
    st.soloMeter = Math.min(SURGE_TAPS, st.soloMeter + 1);
    soloPush = soloMashed;
    soloPlayer.mashCount++;
    soloPlayer.lurchT = 0.08;
  }

  let trioPush = 0;
  for (const p of st.players) {
    if (p.side !== "trio") continue;
    const push = trioMashPush(st, p);
    if (push > 0) {
      trioPush += push;
      p.mashCount++;
      p.lurchT = 0.08;
    }
  }

  if (!st.surgeActive && st.soloMeter >= SURGE_TAPS) {
    st.surgeActive = true;
    st.surgeTimer = SURGE_STEPS;
    st.soloMeter = 0;
    st.ctx.announce("POWER SURGE!", { durationMs: 900, sound: "whoosh" });
    ctx.playSfx("whoosh", { volume: 0.5, pitch: 2 });
    ctx.playSfx("crowd.ooh", { volume: 0.5 });
    ctx.playSfx("pop", { volume: 0.35, pitch: 3 });
    st.audioLog.push({ step: st.stepIndex, t: +t.toFixed(3), event: "surge-start", value: 1 });
  }
  if (st.surgeActive) {
    soloPush *= SURGE_MULT;
    st.surgeTimer--;
    if (st.surgeTimer <= 0) {
      st.surgeActive = false;
      ctx.playSfx("pop", { volume: 0.3, pitch: -2 });
      st.audioLog.push({ step: st.stepIndex, t: +t.toFixed(3), event: "surge-end", value: 0 });
    }
  }

  const netForce = soloPush - trioPush;
  st.lurchVelocity += netForce * VELOCITY_GAIN;
  st.lurchVelocity *= FRICTION;
  st.cratePos += st.lurchVelocity;
  st.cratePos = Math.max(-CRANE_RANGE, Math.min(CRANE_RANGE, st.cratePos));

  /* Track widest excursion for tension-curve telemetry */
  if (Math.abs(st.cratePos) > st.maxAbsCrate) st.maxAbsCrate = Math.abs(st.cratePos);

  /* Accumulate push volume for crowd-swelling (presentation only) */
  const totalPush = soloPush + trioPush;
  st.recentPushes += totalPush;

  soloPlayer.contribution += soloPush;
  if (trioPush > 0) {
    for (const p of st.players) {
      if (p.side === "trio") p.contribution += TRIO_PUSH_PER_TAP;
    }
  }

  if (st.cratePos >= WIN_THRESHOLD) { endGame(st, "solo-win"); return; }
  if (st.cratePos <= -WIN_THRESHOLD) { endGame(st, "trio-win"); return; }

  if (t >= MATCH_DURATION) {
    if (st.cratePos > 0.01) endGame(st, "solo-win");
    else if (st.cratePos < -0.01) endGame(st, "trio-win");
    else endGame(st, "timeout");
  }

  if (totalPush > 1.5) {
    spawnDust(st);
    if (Math.abs(st.lurchVelocity) > 0.0006) {
      st.shakeT = Math.max(st.shakeT, 0.06);
      st.shakeMag = Math.max(st.shakeMag, 0.015);
    }
  }
  if (st.surgeActive) st.shakeT = Math.max(st.shakeT, 0.04);
}

/** Push the solo produces this step (0 = no push). Human taps are worth more. */
function soloMashPush(st: PushOfWarState, p: PlayerState): number {
  if (st.humanCpu) return st.prng() < CPU_SOLO_MASH_P ? SOLO_PUSH_PER_TAP : 0;
  if (p.id === 0) {
    if (st.humanTaps > 0) { st.humanTaps--; return HUMAN_TAP_PUSH; }
    return 0;
  }
  return st.prng() < CPU_SOLO_MASH_P ? SOLO_PUSH_PER_TAP : 0;
}

/** Push one trio member produces this step (0 = no push). Human taps are worth more. */
function trioMashPush(st: PushOfWarState, p: PlayerState): number {
  if (p.id === 0 && !st.humanCpu) {
    if (st.humanTaps > 0) { st.humanTaps--; return HUMAN_TAP_PUSH; }
    return 0;
  }
  return st.prng() < CPU_TRIO_MASH_P ? TRIO_PUSH_PER_TAP : 0;
}

function endGame(st: PushOfWarState, path: "solo-win" | "trio-win" | "timeout"): void {
  st.ended = true;
  st.endPath = path;
  const ctx = st.ctx;

  let ranking: number[];
  if (path === "solo-win") {
    ranking = [st.soloId, ...st.trioIds.sort((a, b) => st.players[b].contribution - st.players[a].contribution || a - b)];
  } else if (path === "trio-win") {
    ranking = [...st.trioIds.sort((a, b) => st.players[b].contribution - st.players[a].contribution || a - b), st.soloId];
  } else {
    // Genuine dead heat (crate within 0.01 of center): the side that pushed hardest
    // overall takes it — never hand the solo a free win.
    const soloContrib = st.players[st.soloId].contribution;
    const trioContrib = st.trioIds.reduce((n, id) => n + st.players[id].contribution, 0);
    const trioSorted = st.trioIds.sort((a, b) => st.players[b].contribution - st.players[a].contribution || a - b);
    ranking = soloContrib > trioContrib ? [st.soloId, ...trioSorted] : [...trioSorted, st.soloId];
  }
  st.ranking = ranking;
  /* Don't set finished=true yet — allow the post-game camera push-in to
   * play out in update() before ctx.finish fires (the 900ms setTimeout waits). */
  st.ended = true;

  /* Camera push-in toward the winning side */
  st.camPushDir = path === "solo-win" ? 1 : path === "trio-win" ? -1 : 0;
  st.postGameT = 0;

  /* Music + crowd climax on the finish */
  st.lastIntensity = SURGE_INTENSITY;
  audio.music.intensity(SURGE_INTENSITY);
  st.audioLog.push({ step: st.stepIndex, t: +(st.stepIndex * FIXED_DT).toFixed(3), event: "finish-climax", value: SURGE_INTENSITY });

  const winner = ranking[0];
  const winnerPlayer = ctx.players[winner];
  ctx.announce(`${winnerPlayer.name} WINS PUSH OF WAR!`, { durationMs: 2200, sound: "crowd.cheer" });
  ctx.playSfx("fanfare.win", { volume: 0.8 });
  ctx.playSfx("crowd.cheer", { volume: 0.9 });
  ctx.characters[winner]?.anim.cheer();
  for (const p of st.players) { if (p.id !== winner) ctx.characters[p.id]?.anim.sad(); }

  st.shakeT = 0.4; st.shakeMag = 0.12;
  spawnConfetti(st);

  setTimeout(() => { if (st.finished && st.ranking) ctx.finish(st.ranking); }, 900);
}

function spawnDust(st: PushOfWarState): void {
  const crateX = st.cratePos * 8;
  const sprite = st.dustPool.find((s) => !s.visible);
  if (!sprite) return;
  sprite.visible = true;
  sprite.position.set(crateX * 0.4 + (st.prng() - 0.5) * 0.8, 0.6 + st.prng() * 0.3, (st.prng() - 0.5) * 1.2);
  sprite.scale.setScalar(0.3 + st.prng() * 0.3);
  (sprite.material as THREE.SpriteMaterial).opacity = 0.9;
  const ud = sprite as unknown as { _vx: number; _vy: number; _life: number; _t: number };
  ud._vx = (st.prng() - 0.5) * 2;
  ud._vy = 0.5 + st.prng() * 1.5;
  ud._life = 0.6; ud._t = 0;
}

function updateDust(st: PushOfWarState, dt: number): void {
  for (const sprite of st.dustPool) {
    if (!sprite.visible) continue;
    const ud = sprite as unknown as { _vx: number; _vy: number; _life: number; _t: number };
    ud._t += dt;
    if (ud._t >= ud._life) { sprite.visible = false; continue; }
    sprite.position.x += ud._vx * dt; sprite.position.y += ud._vy * dt;
    ud._vy -= 3 * dt;
    (sprite.material as THREE.SpriteMaterial).opacity = 0.9 * (1 - ud._t / ud._life);
  }
}

function spawnConfetti(st: PushOfWarState): void {
  const colors = [hex(palette.sun), hex(palette.candy), hex(palette.bubble), hex(palette.mint), hex(palette.berry)];
  for (let i = 0; i < 30; i++) {
    const sprite = st.confettiPool.find((s) => !s.visible);
    if (!sprite) return;
    sprite.visible = true;
    sprite.position.set((st.prng() - 0.5) * 12, 3 + st.prng() * 2, (st.prng() - 0.5) * 4);
    sprite.scale.setScalar(0.15 + st.prng() * 0.15);
    (sprite.material as THREE.SpriteMaterial).opacity = 1;
    (sprite.material as THREE.SpriteMaterial).color.setHex(colors[Math.floor(st.prng() * colors.length)]);
    const ud = sprite as unknown as { _vx: number; _vy: number; _life: number; _t: number; _spin: number };
    ud._vx = (st.prng() - 0.5) * 4; ud._vy = 2 + st.prng() * 3;
    ud._life = 1.8; ud._t = 0; ud._spin = (st.prng() - 0.5) * 8;
  }
}

function updateConfetti(st: PushOfWarState, dt: number): void {
  for (const sprite of st.confettiPool) {
    if (!sprite.visible) continue;
    const ud = sprite as unknown as { _vx: number; _vy: number; _life: number; _t: number; _spin: number };
    ud._t += dt;
    if (ud._t >= ud._life) { sprite.visible = false; continue; }
    sprite.position.x += ud._vx * dt; sprite.position.y += ud._vy * dt;
    ud._vy -= 4.5 * dt;
    if (sprite.position.y < 0) { sprite.position.y = 0; ud._vy = -ud._vy * 0.4; ud._vx *= 0.7; }
    (sprite.material as THREE.SpriteMaterial).opacity = Math.max(0, 1 - ud._t / ud._life);
    (sprite.material as THREE.SpriteMaterial).rotation += ud._spin * dt;
  }
}

function updateVisuals(st: PushOfWarState, dt: number): void {
  const t = st.stepIndex * FIXED_DT;

  // The race is decided by a narrow lead, so the crate's on-screen travel is EASED
  // (|pos|^0.45): a small but real advantage still reads as visible movement, while a
  // blowout (|pos| = 0.5) lands the crate exactly on the goal line (4.5 * 0.5^0.45 = 3.3).
  const eased = Math.sign(st.cratePos) * Math.pow(Math.abs(st.cratePos), 0.45);
  const crateX = eased * 4.5;
  st.crate.position.x = crateX;

  const v = Math.abs(st.lurchVelocity);
  // Visual lurch is intentionally decoupled from the (small) simulated velocity:
  // the tuned VELOCITY_GAIN keeps the race in the 5-8s band, so the squash uses
  // its own gain to keep the push feeling punchy.
  const vVisual = Math.min(0.3, v * 100);
  st.crate.scale.set(1 + vVisual, 1 - vVisual, 1 - vVisual);

  if (st.surgeActive) st.crate.rotation.z = Math.sin(t * 25) * 0.08;
  else st.crate.rotation.z *= 0.9;

  const ropeStretch = 1 + Math.abs(eased) * 0.14;
  st.rope.scale.x = ropeStretch;
  st.rope.position.x = crateX * 0.45;
  const ropeMat = st.rope.material as THREE.MeshToonMaterial;
  ropeMat.color.lerpColors(new THREE.Color(hex(palette.cream)), new THREE.Color(hex(palette.sun)), Math.abs(st.cratePos));

  // Tug needle: slides toward whichever side is winning (same eased value as the crate).
  st.indicator.position.x = eased * 3.2;
  st.indicator.scale.x = 0.22;
  const indColor = st.cratePos > 0.1 ? palette.candy : st.cratePos < -0.1 ? palette.bubble : palette.mint;
  (st.indicator.material as THREE.MeshToonMaterial).color.setHex(hex(indColor));

  for (const p of st.players) {
    if (p.lurchT > 0) p.lurchT = Math.max(0, p.lurchT - dt);
    if (p.squashT > 0) p.squashT = Math.max(0, p.squashT - dt);
  }

  const cam = st.ctx.camera;

  /* Post-game camera push-in toward the winning side */
  let pushEased = 0;
  if (st.ended) {
    const p = Math.min(1, st.postGameT / POST_GAME_TIME);
    pushEased = 1 - Math.pow(1 - p, 3); // easeOutCubic
  }

  if (st.shakeT > 0) {
    st.shakeT -= dt;
    const s = Math.max(0, st.shakeT) * st.shakeMag * 60;
    cam.position.x = st.camBase.x + Math.sin(t * 83.7) * s + st.camPushDir * CAMERA_PUSH_X * pushEased;
    cam.position.y = st.camBase.y + Math.cos(t * 61.3) * s + pushEased;
    cam.position.z = st.camBase.z - 2.5 * pushEased;
    cam.lookAt(st.camPushDir * 4, 0.4, 0);
  } else {
    cam.position.x = st.camBase.x + st.camPushDir * CAMERA_PUSH_X * pushEased;
    cam.position.y = st.camBase.y + pushEased;
    cam.position.z = st.camBase.z - 2.5 * pushEased;
    if (pushEased > 0) cam.lookAt(st.camPushDir * 4, 0.4, 0);
  }

  // Solo aura ring — pulses warm during surges, steady soft-glow otherwise
  if (st.soloAuraRing) {
    const auraMat = st.soloAuraRing.material as THREE.MeshBasicMaterial;
    if (st.surgeActive) {
      auraMat.color = new THREE.Color(hex(palette.sun));
      auraMat.opacity = 0.35 + 0.15 * Math.sin(t * 8);
    } else if (st.ended) {
      auraMat.color = new THREE.Color(hex(palette.candy));
      auraMat.opacity = 0.4;
    } else {
      auraMat.color = new THREE.Color(hex(palette.mint));
      auraMat.opacity = 0.22;
    }
    st.soloAuraRing.scale.setScalar(1 + 0.02 * Math.sin(t * 3));
  }

  // Floating SOLO tag — gentle bob + rotation
  if (st.soloTAG) {
    st.soloTAG.position.y = 0.95 + 0.015 * Math.sin(t * 2.5);
    st.soloTAG.rotation.y = t * 0.4;
    const tagMat = st.soloTAG.material as THREE.SpriteMaterial;
    if (st.surgeActive) tagMat.color.setHex(hex(palette.sun));
    else tagMat.color.setHex(hex(palette.candy));
  }

  // Vignette darkens during play, intensifies on surge + post-game climax
  if (st.vignetteEl) {
    let v = VIGNETTE_DARKNESS * 0.4;
    if (st.surgeActive) v = VIGNETTE_DARKNESS * (0.4 + 0.35 * Math.sin(t * 8));
    else if (st.ended) v = VIGNETTE_DARKNESS * (0.4 + 0.3 * pushEased);
    st.vignetteEl.style.opacity = String(Math.min(0.65, v));
  }

  updateDust(st, dt);
  updateConfetti(st, dt);

  const crateMat = st.crate.material as THREE.MeshToonMaterial;
  if (st.surgeActive) {
    crateMat.emissive = new THREE.Color(hex(palette.sun));
    crateMat.emissiveIntensity = 0.5 + 0.3 * Math.sin(t * 20);
  } else {
    crateMat.emissiveIntensity *= 0.9;
  }
}

let round: PushOfWarState | null = null;

/* ------------------------------------------------------------------ */
/*  Audio escalation — music intensity + crowd reacts to the fight     */
/* ------------------------------------------------------------------ */

function updateAudio(st: PushOfWarState, dt: number): void {
  const t = st.stepIndex * FIXED_DT;

  // --- Music intensity: base build, surge spike, post-game climax ---
  let target = BASE_INTENSITY;
  if (st.surgeActive) {
    target = SURGE_INTENSITY;
  } else if (st.ended) {
    target = SURGE_INTENSITY; // hold the climax
  } else if (st.surgeTimer > 0 && st.surgeTimer < 10) {
    // ramp down smoothly as surge winds down
    target = BASE_INTENSITY + (SURGE_INTENSITY - BASE_INTENSITY) * (st.surgeTimer / 10);
  }

  // Push-rate boost: a hot tug raises the intensity toward surge peak
  const pushRate = st.recentPushes * 60; // normalise to per-second-ish
  st.recentPushes *= 0.85; // decay for next frame
  if (!st.ended && pushRate > CROWD_PUSH_THRESHOLD) {
    target = Math.min(SURGE_INTENSITY, target + 0.1 * Math.min(1, pushRate / 4));
  }

  if (Math.abs(target - st.lastIntensity) > 0.01) {
    audio.music.intensity(target);
    st.audioLog.push({ step: st.stepIndex, t: +t.toFixed(3), event: "intensity", value: +target.toFixed(3) });
    st.lastIntensity = target;
  }

  // --- Crowd SFX: swells with the push rate ---
  st.lastCrowdT += dt;
  if (st.lastCrowdT < CROWD_COOLDOWN) return;

  if (st.surgeActive && pushRate > 0.3) {
    st.ctx.playSfx("crowd.cheer", { volume: 0.5 });
    st.audioLog.push({ step: st.stepIndex, t: +t.toFixed(3), event: "crowd.cheer", value: +pushRate.toFixed(2) });
    st.lastCrowdT = 0;
  } else if (pushRate > CROWD_PUSH_THRESHOLD) {
    st.ctx.playSfx("crowd.ooh", { volume: 0.4 });
    st.audioLog.push({ step: st.stepIndex, t: +t.toFixed(3), event: "crowd.ooh", value: +pushRate.toFixed(2) });
    st.lastCrowdT = 0;
  }
}

function publishDebug(st: PushOfWarState): void {
  (window as unknown as { __POW__?: unknown }).__POW__ = {
    stepIndex: st.stepIndex,
    t: +(st.stepIndex * FIXED_DT).toFixed(3),
    crate: +st.cratePos.toFixed(4),
    maxAbsCrate: +st.maxAbsCrate.toFixed(4),
    solo: st.soloId,
    sideSizes: [1, 3],
    contributions: st.players.map((p) => +p.contribution.toFixed(2)),
    endPath: st.endPath,
    ranking: st.ranking ? [...st.ranking] : null,
    surge: st.surgeActive,
    intensity: +st.lastIntensity.toFixed(3),
    audioLog: st.audioLog,
  };
}

function makePrng(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pushOfWar: Minigame = {
  id: "push_of_war",
  name: "Push of War",
  genre: "survival",

  setup(ctx: MinigameContext) {
    const root = new THREE.Group();
    ctx.scene.add(root);

    const cam = ctx.camera;
    cam.fov = 55;
    cam.updateProjectionMatrix();
    const camBase = new THREE.Vector3(0, 14, 12);
    cam.position.copy(camBase);
    cam.lookAt(0, 0.4, 0);

    makeArena(root);
    const crate = makeCrate(root);
    const indicator = makeIndicator(root);
    const rope = findRope(root);

    const dustPool: THREE.Sprite[] = [];
    for (let i = 0; i < MAX_DUST_PARTICLES; i++) { const s = makeDustSprite(); root.add(s); dustPool.push(s); }
    const confettiPool: THREE.Sprite[] = [];
    for (let i = 0; i < MAX_CONFETTI_PARTICLES; i++) { const s = makeConfettiSprite(); root.add(s); confettiPool.push(s); }

    const soloIdx = Math.floor(ctx.rng() * 4);
    const soloId = ctx.players[soloIdx].id;
    const trioIds = ctx.players.filter((_, i) => i !== soloIdx).map((p) => p.id);
    const humanCpu = isAutoplay();

    const players: PlayerState[] = ctx.players.map((p) => ({
      id: p.id, side: p.id === soloId ? "solo" : "trio",
      contribution: 0, mashCount: 0, lurchT: 0, squashT: 0,
    }));

    for (const p of players) {
      const ch = ctx.characters[p.id];
      if (!ch) continue;
      if (p.side === "trio") {
        const trioIdx = trioIds.indexOf(p.id);
        ch.group.position.set(-3.9, 0, -2.2 + trioIdx * 2.2);
        ch.setFacing(0);
      } else {
        ch.group.position.set(3.9, 0, 0);
        ch.setFacing(Math.PI);
      }
      ch.anim.idle();
    }

    /* --- Solo identity: ground ring + floating SOLO tag (1-vs-3) --- */
    const soloAuraRing = makeSoloAuraRing();
    root.add(soloAuraRing);
    soloAuraRing.position.set(3.9, 0.02, 0);
    const soloTag = makeSoloTag("SOLO", ctx.players[soloIdx].color || palette.candy);
    root.add(soloTag);
    soloTag.position.set(3.9, 0.95, 0);

    /* Vignette overlay — darkens the arena for staging */
    const vignetteEl = makeVignette();
    vignetteEl.style.opacity = String(VIGNETTE_DARKNESS * 0.4);

    /* Re-mark the VS splash: highlight the SOLO player, not P0 */
    setTimeout(() => {
      const pips = document.querySelectorAll(".ssp-vs-player");
      if (pips.length === 4) {
        (pips[0] as HTMLElement).classList.remove("ssp-vs-player--highlight");
        const soloPip = pips[soloIdx] as HTMLElement;
        if (soloPip) {
          soloPip.classList.add("ssp-vs-player--highlight");
          const badge = soloPip.querySelector(".ssp-vs-badge");
          if (badge) badge.textContent = "SOLO";
        }
      }
    }, 0);

    /* Drop music to base intensity — the screen starts at 1.0 */
    audio.music.intensity(BASE_INTENSITY);

    const prngSeed = Math.floor(ctx.rng() * 100000);
    const prng = makePrng(prngSeed);

    const st: PushOfWarState = {
      ctx, root, cratePos: 0, soloMeter: 0, surgeTimer: 0, surgeActive: false,
      players, soloId, trioIds, stepIndex: 0, simTime: 0, ended: false, finished: false,
      endPath: null, ranking: [], shakeT: 0, shakeMag: 0, lurchVelocity: 0,
      humanTaps: 0, humanCpu, crate, rope, indicator, dustPool, confettiPool,
      prng, camBase,
      maxAbsCrate: 0, postGameT: 0, camPushDir: 1, lastIntensity: BASE_INTENSITY,
      recentPushes: 0, lastCrowdT: 0, audioLog: [],
      soloAuraRing, soloTAG: soloTag, vignetteEl,
    };
    round = st;

    ctx.input.pointer = (_x, _y, down) => { if (down && st.humanTaps < 3) st.humanTaps++; };
    ctx.input.key = (action) => { if (action === "confirm" && st.humanTaps < 3) st.humanTaps++; };

    const soloName = ctx.players[soloIdx].name;
    ctx.announce(`1 VS 3! ${soloName} vs the Trio!`, { durationMs: 1800, sound: "whoosh" });
    publishDebug(st);
  },

  update(dt: number) {
    const st = round;
    if (!st || st.finished) return;

    if (!st.ended) {
      st.simTime += dt;
      let steps = 0;
      while (st.simTime >= FIXED_DT && steps < MAX_STEPS_PER_FRAME) {
        stepFixed(st);
        st.simTime -= FIXED_DT;
        st.stepIndex++;
        steps++;
        if (st.ended) break;
      }
      if (steps >= MAX_STEPS_PER_FRAME && st.simTime >= FIXED_DT) st.simTime = 0;
    } else {
      /* Post-game: camera push-in toward the winning side */
      st.postGameT += dt;
      if (st.postGameT >= POST_GAME_TIME) st.finished = true;
    }

    updateAudio(st, dt);
    updateVisuals(st, dt);
    publishDebug(st);
  },

  teardown() {
    const st = round;
    if (!st) return;
    st.root.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh || (obj as THREE.Sprite).isSprite) {
        mesh.geometry?.dispose();
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const m of mats) m?.dispose();
      }
    });
    st.root.removeFromParent();
    if (st.vignetteEl?.parentElement) st.vignetteEl.parentElement.removeChild(st.vignetteEl);
    round = null;
    (window as unknown as { __POW__?: unknown }).__POW__ = undefined;
  },
};

registerMinigame({ id: pushOfWar.id, name: pushOfWar.name });
if (!MINIGAME_MODULES.some((l) => false)) {
  MINIGAME_MODULES.push(loadPushOfWar);
}

export function loadPushOfWar(): Promise<Minigame> {
  return Promise.resolve(pushOfWar);
}

export default pushOfWar;
