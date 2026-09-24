/**
 * SUPER STAR PARTY — MP7-style results ceremony.
 *
 * Builds a podium, moves characters to their ranked positions, animates
 * the camera, shows a WINNER banner, coin payout FX, confetti, and a rank
 * card. All presentation randomness comes from a fixed-seed mulberry32
 * (never gameplay rng). The ceremony is skippable-safe: destroy() cleans
 * up everything without exceptions.
 *
 * Timeline (total ~3.6s):
 *   0.0-0.8s  Camera swoop + podium scale-in + characters walk to steps
 *   0.8s      WINNER! banner slams in + fanfare
 *   1.05s     Confetti bursts from both sides
 *   1.25-2.45s Coin payout: coins burst from winner + ticker counts up
 *   2.5s      Rank card slides up
 *   3.6s      Done — auto-return to board
 */
import * as THREE from "three";
import { world } from "../main";
import { palette, hex } from "../config/palette";
import { settings } from "../config/settings";
import { match } from "../core/game";
import { audio } from "../audio/audioEngine";
import { characterColor } from "../characters/roster";
import { mulberry32 } from "../core/rng";
import type { Character } from "../characters/characterFactory";

/* ------------------------------------------------------------------ */
/*  Presentation-only RNG (fixed seed — never touches gameplay rng)    */
/* ------------------------------------------------------------------ */

const presRng = mulberry32(0xc0ffee42);

/* ------------------------------------------------------------------ */
/*  Easing                                                           */
/* ------------------------------------------------------------------ */

const easeInOutCubic = (p: number): number =>
  p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
const easeOutBack = (p: number): number => {
  const c = 1.70158;
  return 1 + (c + 1) * Math.pow(p - 1, 3) + c * Math.pow(p - 1, 2);
};
const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/* ------------------------------------------------------------------ */
/*  Podium layout                                                      */
/* ------------------------------------------------------------------ */

interface StepDef {
  x: number;
  y: number;
  z: number;
  w: number;
  d: number;
  h: number;
  color: string;
}

const STEPS: StepDef[] = [
  // 1st — center, tallest
  { x: 0, y: 0, z: 0, w: 2.4, d: 2.0, h: 1.2, color: palette.sun },
  // 2nd — left, medium
  { x: -2.4, y: 0, z: 0.4, w: 2.0, d: 1.8, h: 0.8, color: palette.bubble },
  // 3rd — right, medium
  { x: 2.4, y: 0, z: 0.4, w: 2.0, d: 1.8, h: 0.8, color: palette.berry },
  // 4th — front, floor
  { x: 0, y: 0, z: 2.8, w: 2.0, d: 1.6, h: 0.15, color: palette.cream },
];

/* ------------------------------------------------------------------ */
/*  Timeline (seconds)                                                 */
/* ------------------------------------------------------------------ */

const CAMERA_SWOOP_T = 0.8;
const BANNER_T = 0.8;
const CONFETTI_T = 1.05;
const COIN_T = 1.25;
const COIN_DUR = 1.2;
const RANKCARD_T = 2.5;
const DONE_T = 3.6;

/* ------------------------------------------------------------------ */
/*  Public interface                                                   */
/* ------------------------------------------------------------------ */

export interface ResultsCeremony {
  update(dt: number): void;
  isDone(): boolean;
  destroy(): void;
}

export function startResultsCeremony(opts: {
  chars: Character[];
  ranking: number[];
  winner: number;
  coins: number;
  minigameName: string;
}): ResultsCeremony {
  const { chars, ranking, winner, coins, minigameName } = opts;
  const scene: THREE.Scene = world.scene!;
  const camera: THREE.PerspectiveCamera = world.camera!;
  if (!world.scene || !world.camera) {
    return { update: () => {}, isDone: () => true, destroy: () => {} };
  }

  /* ---- capture original state ---- */
  const camPos0 = camera.position.clone();
  const camQuat0 = camera.quaternion.clone();
  const look0 = new THREE.Vector3(0, 0, -1).applyQuaternion(camQuat0).add(camPos0);

  /* ---- build podium ---- */
  const podium = new THREE.Group();
  const podiumMats: THREE.Material[] = [];
  const podiumGeos: THREE.BufferGeometry[] = [];

  for (const step of STEPS) {
    const geo = new THREE.BoxGeometry(step.w, step.h, step.d);
    const mat = new THREE.MeshBasicMaterial({ color: hex(step.color) });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(step.x, step.h / 2, step.z);
    podium.add(mesh);
    podiumMats.push(mat);
    podiumGeos.push(geo);
    // ink outline
    const oGeo = new THREE.BoxGeometry(step.w + 0.12, step.h + 0.12, step.d + 0.12);
    const oMat = new THREE.MeshBasicMaterial({
      color: hex(palette.ink),
      side: THREE.BackSide,
    });
    const oMesh = new THREE.Mesh(oGeo, oMat);
    oMesh.position.copy(mesh.position);
    podium.add(oMesh);
    podiumMats.push(oMat);
    podiumGeos.push(oGeo);
  }
  // base platform
  const baseGeo = new THREE.BoxGeometry(7.5, 0.18, 5.5);
  const baseMat = new THREE.MeshBasicMaterial({ color: hex(palette.cream) });
  const baseMesh = new THREE.Mesh(baseGeo, baseMat);
  baseMesh.position.set(0, -0.09, 1.0);
  podium.add(baseMesh);
  podiumMats.push(baseMat);
  podiumGeos.push(baseGeo);
  const baseOGeo = new THREE.BoxGeometry(7.62, 0.3, 5.62);
  const baseOMat = new THREE.MeshBasicMaterial({
    color: hex(palette.ink),
    side: THREE.BackSide,
  });
  const baseOMesh = new THREE.Mesh(baseOGeo, baseOMat);
  baseOMesh.position.copy(baseMesh.position);
  podium.add(baseOMesh);
  podiumMats.push(baseOMat);
  podiumGeos.push(baseOGeo);

  podium.scale.setScalar(0.01);
  scene.add(podium);

  /* ---- move characters to podium ---- */
  interface CharData {
    ch: Character;
    parent: THREE.Group;
    origParent: THREE.Object3D;
    origPos: THREE.Vector3;
    origRot: THREE.Euler;
    origScale: THREE.Vector3;
  }
  const charData: CharData[] = [];

  const ordered = [...ranking];
  for (const p of match.players) if (!ordered.includes(p.id)) ordered.push(p.id);

  for (let i = 0; i < ordered.length; i++) {
    const pid = ordered[i];
    const ch = chars[pid];
    if (!ch) continue;
    const step = STEPS[Math.min(i, STEPS.length - 1)];
    const parent = new THREE.Group();
    parent.position.set(step.x, step.h, step.z + 0.3);
    scene.add(parent);

    const origParent = ch.group.parent ?? scene;
    const origPos = ch.group.position.clone();
    const origRot = ch.group.rotation.clone();
    const origScale = ch.group.scale.clone();

    scene.remove(ch.group);
    parent.add(ch.group);
    ch.group.position.set(0, 0, 0);
    ch.group.rotation.set(0, 0, 0);
    ch.group.scale.set(1, 1, 1);
    ch.setFacing(0); // face +Z (camera)

    if (pid === winner) ch.anim.cheer();
    else ch.anim.sad();

    charData.push({ ch, parent, origParent, origPos, origRot, origScale });
  }

  /* ---- ceremony view camera ---- */
  const camPos1 = new THREE.Vector3(0, 5.5, 10.5);
  const look1 = new THREE.Vector3(0, 1.2, 0.8);

  /* ---- DOM: banner ---- */
  const winnerPlayer = match.players[winner];
  const winnerColor = characterColor(winnerPlayer?.kind ?? "pip");
  const bannerEl = document.createElement("div");
  bannerEl.style.cssText = `
    position: fixed; left: 50%; top: 28%; transform: translate(-50%,-50%) scale(0);
    font-size: clamp(36px, 8vw, 80px); font-weight: 700; color: ${winnerColor};
    text-shadow: 0 3px 0 ${palette.ink}, 3px 0 0 ${palette.ink}, -3px 0 0 ${palette.ink}, 0 -3px 0 ${palette.ink},
      2px 2px 0 ${palette.ink}, -2px 2px 0 ${palette.ink}, 2px -2px 0 ${palette.ink}, -2px -2px 0 ${palette.ink},
      0 6px 0 ${palette.ink};
    z-index: 95; pointer-events: none; white-space: nowrap;
    transition: transform 0.45s cubic-bezier(.34,1.56,.64,1);
  `;
  bannerEl.textContent = `${winnerPlayer?.name ?? "?"} WINS!`;
  document.body.appendChild(bannerEl);

  /* ---- DOM: coin ticker ---- */
  const tickerEl = document.createElement("div");
  tickerEl.style.cssText = `
    position: fixed; font-size: clamp(24px, 5vw, 44px); font-weight: 700; color: ${palette.sun};
    text-shadow: 0 2px 0 ${palette.ink}, 2px 0 0 ${palette.ink}, -2px 0 0 ${palette.ink}, 0 -2px 0 ${palette.ink};
    z-index: 95; pointer-events: none; opacity: 0; transition: opacity 0.2s ease-out;
  `;
  document.body.appendChild(tickerEl);

  /* ---- DOM: rank card ---- */
  const cardEl = document.createElement("div");
  cardEl.style.cssText = `
    position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%) translateY(80px);
    background: ${palette.cream}; border: 4px solid ${palette.ink}; border-radius: 20px;
    padding: 14px 20px; box-shadow: 0 6px 0 ${palette.ink};
    z-index: 94; pointer-events: none; opacity: 0;
    transition: transform 0.4s cubic-bezier(.34,1.56,.64,1), opacity 0.3s ease-out;
    font-size: 15px; font-weight: 600; color: ${palette.ink};
    display: flex; flex-direction: column; gap: 4px; min-width: 200px;
  `;
  const cardRows: string[] = [];
  for (let i = 0; i < ordered.length; i++) {
    const p = match.players[ordered[i]];
    const color = characterColor(p?.kind ?? "pip");
    const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : "4.";
    const payout = i === 0 ? ` +${coins}c` : "";
    cardRows.push(
      `<div style="color:${color};font-weight:700;">${medal} ${p?.name ?? "?"}${payout}</div>`
    );
  }
  cardEl.innerHTML =
    `<div style="text-align:center;font-weight:700;margin-bottom:4px;">${minigameName} — RESULTS</div>` +
    cardRows.join("");
  document.body.appendChild(cardEl);

  /* ---- state ---- */
  let t = 0;
  let done = false;
  let destroyed = false;
  let bannerShown = false;
  let confettiDone = false;
  let coinDone = false;
  let cardShown = false;
  let coinTick = 0;
  let lastCoinSfx = 0;

  /* Pre-compute coin burst data (presentation-only) */
  const coinBursts = Array.from({ length: 12 }, () => ({
    angle: presRng() * Math.PI * 2,
    dist: 60 + presRng() * 120,
    size: 14 + presRng() * 14,
    delay: presRng() * 0.3,
  }));

  const coinEls: HTMLDivElement[] = [];

  /* ---- helpers ---- */

  function spawnCoins(): void {
    const winnerData = charData.find((c) => c.ch === chars[winner]);
    if (!winnerData) return;
    const worldPos = new THREE.Vector3();
    winnerData.parent.getWorldPosition(worldPos);
    worldPos.y += 1.5;
    const v = worldPos.project(camera);
    const cx = (v.x * 0.5 + 0.5) * window.innerWidth;
    const cy = (-v.y * 0.5 + 0.5) * window.innerHeight;

    for (const b of coinBursts) {
      const el = document.createElement("div");
      el.style.cssText = `
        position: fixed; left: ${cx}px; top: ${cy}px; width: ${b.size}px; height: ${b.size}px;
        border-radius: 50%; background: radial-gradient(circle at 35% 30%, rgba(255,255,255,.9) 0%, rgba(255,255,255,0) 42%),
          linear-gradient(180deg, ${palette.sun} 0%, ${palette.sunDeep} 100%);
        border: 2px solid ${palette.ink}; z-index: 95; pointer-events: none;
      `;
      document.body.appendChild(el);
      coinEls.push(el);

      const vx = Math.cos(b.angle) * b.dist;
      const vy = Math.sin(b.angle) * b.dist - 80;
      try {
        el.animate(
          [
            { transform: "translate(0,0) scale(1)", opacity: 1 },
            { transform: `translate(${vx}px, ${vy}px) scale(0.6)`, opacity: 0 },
          ],
          {
            duration: 700 + presRng() * 300,
            delay: b.delay * 1000,
            easing: "cubic-bezier(.2,.55,.35,1)",
            fill: "both",
          }
        );
      } catch {
        /* WAAPI unavailable */
      }
    }

    tickerEl.style.left = `${cx - 30}px`;
    tickerEl.style.top = `${cy - 60}px`;
  }

  function spawnConfetti(x: number, y: number): void {
    const count = 40;
    const colors = [
      palette.sun,
      palette.candy,
      palette.mint,
      palette.bubble,
      palette.berry,
      palette.lava,
    ];
    for (let i = 0; i < count; i++) {
      const el = document.createElement("div");
      const w = 5 + presRng() * 7;
      const h = 5 + presRng() * 7;
      el.style.cssText = `
        position: fixed; left: ${x}px; top: ${y}px; width: ${w}px; height: ${h}px;
        background: ${colors[i % colors.length]}; border-radius: ${presRng() < 0.3 ? "50%" : "3px"};
        z-index: 93; pointer-events: none;
      `;
      document.body.appendChild(el);
      const angle = presRng() * Math.PI * 2;
      const dist = 80 + presRng() * 200;
      const vx = Math.cos(angle) * dist;
      const vy = Math.sin(angle) * dist - 150;
      const rot = (presRng() - 0.5) * 720;
      try {
        el.animate(
          [
            { transform: "translate(0,0) rotate(0deg)", opacity: 1 },
            {
              transform: `translate(${vx}px, ${vy + 200}px) rotate(${rot}deg)`,
              opacity: 1,
              offset: 0.7,
            },
            {
              transform: `translate(${vx * 1.1}px, ${vy + 350}px) rotate(${rot * 1.2}deg)`,
              opacity: 0,
            },
          ],
          {
            duration: 800 + presRng() * 500,
            easing: "cubic-bezier(.2,.55,.35,1)",
            fill: "both",
          }
        ).onfinish = () => el.remove();
      } catch {
        window.setTimeout(() => el.remove(), 1300);
      }
    }
  }

  /* ---- update ---- */

  function update(dt: number): void {
    if (done || destroyed) return;
    t += dt;

    // Camera swoop
    const camP = clamp01(t / CAMERA_SWOOP_T);
    const camE = easeInOutCubic(camP);
    camera.position.lerpVectors(camPos0, camPos1, camE);
    const look = new THREE.Vector3().lerpVectors(look0, look1, camE);
    camera.lookAt(look);

    // Podium scale-in
    const podP = clamp01(t / 0.5);
    podium.scale.setScalar(0.01 + 0.99 * easeOutBack(podP));

    // Banner
    if (!bannerShown && t >= BANNER_T) {
      bannerShown = true;
      bannerEl.style.transform = "translate(-50%,-50%) scale(1)";
      audio.sfx.play("fanfare.win");
    }

    // Confetti
    if (!confettiDone && t >= CONFETTI_T) {
      confettiDone = true;
      spawnConfetti(window.innerWidth * 0.15, window.innerHeight * 0.3);
      spawnConfetti(window.innerWidth * 0.85, window.innerHeight * 0.3);
    }

    // Coin payout
    if (!coinDone && t >= COIN_T) {
      coinDone = true;
      spawnCoins();
      tickerEl.style.opacity = "1";
    }
    if (coinDone && coinTick < coins) {
      const tickP = clamp01((t - COIN_T) / COIN_DUR);
      const target = Math.round(tickP * coins);
      if (target > coinTick) {
        coinTick = target;
        tickerEl.textContent = `+${coinTick}`;
        if (t - lastCoinSfx > 0.08) {
          audio.sfx.play("coin.gain", { volume: 0.7 });
          lastCoinSfx = t;
        }
        try {
          tickerEl.animate(
            [{ transform: "scale(1)" }, { transform: "scale(1.3)" }, { transform: "scale(1)" }],
            { duration: 150, easing: "ease-out" }
          );
        } catch {
          /* */
        }
      }
    }

    // Rank card
    if (!cardShown && t >= RANKCARD_T) {
      cardShown = true;
      cardEl.style.opacity = "1";
      cardEl.style.transform = "translateX(-50%) translateY(0)";
    }

    // Done
    if (t >= DONE_T) {
      done = true;
    }
  }

  /* ---- destroy ---- */

  function destroy(): void {
    if (destroyed) return;
    destroyed = true;

    // Remove DOM
    bannerEl.remove();
    tickerEl.remove();
    cardEl.remove();
    for (const el of coinEls) el.remove();

    // Remove podium
    scene.remove(podium);
    for (const m of podiumMats) m.dispose();
    for (const g of podiumGeos) g.dispose();

    // Restore characters
    for (const cd of charData) {
      cd.parent.remove(cd.ch.group);
      cd.origParent.add(cd.ch.group);
      cd.ch.group.position.copy(cd.origPos);
      cd.ch.group.rotation.copy(cd.origRot);
      cd.ch.group.scale.copy(cd.origScale);
      scene.remove(cd.parent);
    }

    // Restore camera
    camera.position.copy(camPos0);
    camera.quaternion.copy(camQuat0);
  }

  return { update, isDone: () => done, destroy };
}
