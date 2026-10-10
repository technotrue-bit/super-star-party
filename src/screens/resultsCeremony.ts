/**
 * SUPER STAR PARTY — MP7-style results ceremony.
 *
 * Cuts from the minigame to its own results scene (sky, striped curtain,
 * stage floor), moves characters onto a one-row podium, animates the camera,
 * shows a WINNER headline, coin payout FX, confetti, and a rank card. All
 * presentation randomness comes from a fixed-seed mulberry32 (never gameplay
 * rng). The ceremony is skippable-safe: destroy() cleans up everything and
 * puts back what it hid or changed (minigame objects, background, fog, fov,
 * camera pose).
 *
 * Timeline (total ~3.6s):
 *   0.0-0.16s Fade to ink; at the peak the minigame scene is hidden and the
 *             results scene (podium + characters) takes its place
 *   0.16-0.8s Fade back in + camera settles on the podium + podium scale-in
 *   0.8s      WINNER! headline slams in + fanfare
 *   1.05s     Confetti bursts from both sides
 *   1.25-2.45s Coin payout: coins burst from the winner, the "+N" counter
 *             (in its own slot under the headline) counts up
 *   2.5s      Rank card slides up
 *   3.6s      Done — auto-return to board
 *
 * Layout: headline, then the "+N" slot, then the podium, then the rank card,
 * top to bottom. The camera is fitted to the podium row inside the space the
 * DOM leaves free, so nothing overlaps at any phone size.
 */
import * as THREE from "three";
import { world } from "../main";
import { palette, hex } from "../config/palette";
import { match } from "../core/game";
import { audio } from "../audio/audioEngine";
import { characterColor } from "../characters/roster";
import { mulberry32 } from "../core/rng";
import type { Character } from "../characters/characterFactory";
import { box, fitCamera, makeLawnTexture, makeSkyTexture } from "../minigames/framing";
import { viewportSize } from "../ui/viewport";

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

// One row, nobody in front of anyone: 2nd | 1st | 3rd, and 4th on a low
// step at the end of the row. Built for a narrow portrait frame (the camera
// is fitted to the row, see ROW_BOX), still fine on a wide screen.
const STEPS: StepDef[] = [
  // 1st — center, tallest
  { x: 0, y: 0, z: 0, w: 1.9, d: 1.8, h: 1.2, color: palette.sun },
  // 2nd — left
  { x: -2.0, y: 0, z: 0.15, w: 1.8, d: 1.7, h: 0.8, color: palette.bubble },
  // 3rd — right
  { x: 2.0, y: 0, z: 0.15, w: 1.8, d: 1.7, h: 0.55, color: palette.berry },
  // 4th — low step at the end of the row
  { x: 3.85, y: 0, z: 0.3, w: 1.6, d: 1.5, h: 0.22, color: palette.metal },
];

/** What the ceremony camera must show: the whole row with every character on it. */
const ROW_BOX: { min: [number, number, number]; max: [number, number, number] } = {
  min: [-3.1, 0, -1.0],
  max: [4.8, 3.5, 1.3],
};
/** Camera looks at the row from slightly above, straight on. */
const ROW_DIR = new THREE.Vector3(0, 0.38, 1);
const ROW_FOV = 36;

/* ------------------------------------------------------------------ */
/*  Timeline (seconds)                                                 */
/* ------------------------------------------------------------------ */

const CUT_IN = 0.16; // fade to ink, then the results scene replaces the minigame
const CUT_OUT = 0.32; // fade back in on the podium
const CAMERA_SWOOP_T = 0.8;
const BANNER_T = 0.8;
const CONFETTI_T = 1.05;
const COIN_T = 1.25;
const COIN_DUR = 1.2;
const RANKCARD_T = 2.5;
const DONE_T = 3.6;

/* ------------------------------------------------------------------ */
/*  Results backdrop (own scene dressing, built once per ceremony)     */
/* ------------------------------------------------------------------ */

function stripeTexture(a: string, b: string): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 4;
  const c = canvas.getContext("2d")!;
  c.fillStyle = a;
  c.fillRect(0, 0, 32, 4);
  c.fillStyle = b;
  c.fillRect(32, 0, 32, 4);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.repeat.set(14, 1);
  tex.magFilter = THREE.NearestFilter;
  return tex;
}

function buildBackdrop(mats: THREE.Material[], geos: THREE.BufferGeometry[], texs: THREE.Texture[]): THREE.Group {
  const g = new THREE.Group();
  g.name = "results-backdrop";
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material): THREE.Mesh => {
    geos.push(geo);
    mats.push(mat);
    const m = new THREE.Mesh(geo, mat);
    g.add(m);
    return m;
  };
  // Patterned lawn with rings, then a sandy stage disc under the podium.
  const lawnTex = makeLawnTexture(48);
  texs.push(lawnTex);
  const lawn = add(new THREE.CircleGeometry(60, 48), new THREE.MeshBasicMaterial({ map: lawnTex }));
  lawn.rotation.x = -Math.PI / 2;
  lawn.position.y = -0.06;
  const bandMat = new THREE.MeshBasicMaterial({ color: hex(palette.grassMid) });
  for (let r = 9; r < 58; r += 5) {
    const band = add(new THREE.RingGeometry(r, r + 1.7, 48), bandMat);
    band.rotation.x = -Math.PI / 2;
    band.position.y = -0.05;
  }
  const stage = add(new THREE.CircleGeometry(6.2, 40), new THREE.MeshBasicMaterial({ color: hex(palette.path) }));
  stage.rotation.x = -Math.PI / 2;
  stage.position.set(0.85, -0.04, 0.6);
  const ring = add(new THREE.RingGeometry(4.6, 5.0, 40), new THREE.MeshBasicMaterial({ color: hex(palette.pathEdge) }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(0.85, -0.038, 0.6);
  const rim = add(new THREE.RingGeometry(6.2, 6.55, 40), new THREE.MeshBasicMaterial({ color: hex(palette.ink) }));
  rim.rotation.x = -Math.PI / 2;
  rim.position.set(0.85, -0.035, 0.6);
  // Striped carnival curtain: a half cylinder behind the podium.
  const tex = stripeTexture(palette.candy, palette.white);
  texs.push(tex);
  const curtain = add(
    new THREE.CylinderGeometry(9, 9, 6.5, 48, 1, true, Math.PI / 2, Math.PI),
    new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide })
  );
  curtain.position.set(0.85, 3.2, 1.2);
  // Gold valance along the curtain top.
  const valance = add(
    new THREE.CylinderGeometry(9.05, 9.05, 0.5, 48, 1, true, Math.PI / 2, Math.PI),
    new THREE.MeshBasicMaterial({ color: hex(palette.sun), side: THREE.DoubleSide })
  );
  valance.position.set(0.85, 6.4, 1.2);
  return g;
}

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
  /** Everyone who received `coins`. Defaults to the single first-place id. */
  paidIds?: number[];
  minigameName: string;
  /** Minigame objects hidden while the results scene shows (restored on destroy). */
  hide?: THREE.Object3D[];
}): ResultsCeremony {
  const { chars, ranking, winner, coins, minigameName } = opts;
  const paidIds = (opts.paidIds && opts.paidIds.length > 0 ? opts.paidIds : [winner]).filter(
    (id, index, all) => all.indexOf(id) === index,
  );
  const paid = new Set(paidIds);
  const scene: THREE.Scene = world.scene!;
  const camera: THREE.PerspectiveCamera = world.camera!;
  if (!world.scene || !world.camera) {
    return { update: () => {}, isDone: () => true, destroy: () => {} };
  }

  /* ---- capture original state ---- */
  const camPos0 = camera.position.clone();
  const camQuat0 = camera.quaternion.clone();
  const fov0 = camera.fov;
  const bg0 = scene.background;
  const fog0 = scene.fog;
  const hidden: { obj: THREE.Object3D; vis: boolean }[] = [];

  /* ---- results scene: backdrop + podium (hidden until the cut) ---- */
  const podiumMats: THREE.Material[] = [];
  const podiumGeos: THREE.BufferGeometry[] = [];
  const podiumTexs: THREE.Texture[] = [];
  const backdrop = buildBackdrop(podiumMats, podiumGeos, podiumTexs);
  backdrop.visible = false;
  scene.add(backdrop);
  const sky = makeSkyTexture(palette.berry, palette.bubble);
  podiumTexs.push(sky);

  const podium = new THREE.Group();
  podium.name = "results-podium";
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
  podium.scale.setScalar(0.01);
  podium.visible = false;
  scene.add(podium);

  /* ---- characters (moved onto the podium at the cut) ---- */
  interface CharData {
    ch: Character;
    parent: THREE.Group;
    origParent: THREE.Object3D;
    origPos: THREE.Vector3;
    origRot: THREE.Euler;
    origScale: THREE.Vector3;
    moved: boolean;
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
    parent.position.set(step.x, step.h, step.z + 0.1);
    charData.push({
      ch,
      parent,
      origParent: ch.group.parent ?? scene,
      origPos: ch.group.position.clone(),
      origRot: ch.group.rotation.clone(),
      origScale: ch.group.scale.clone(),
      moved: false,
    });
  }

  /* ---- DOM: fade overlay for the cut ---- */
  const fadeEl = document.createElement("div");
  fadeEl.style.cssText = `position: fixed; inset: 0; background: ${palette.ink}; opacity: 0; z-index: 92; pointer-events: none;`;
  document.body.appendChild(fadeEl);

  /* ---- DOM: headline ---- */
  const winnerPlayer = match.players[winner];
  const winnerColor = characterColor(winnerPlayer?.kind ?? "pip");
  const bannerEl = document.createElement("div");
  bannerEl.style.cssText = `
    position: fixed; left: 50%; top: calc(env(safe-area-inset-top, 0px) + max(28px, 6vh));
    transform: translateX(-50%) scale(0); transform-origin: 50% 50%;
    width: max-content; max-width: 92vw; box-sizing: border-box;
    font-size: clamp(30px, 9vw, 72px); font-weight: 700; color: ${winnerColor}; line-height: 1.08;
    text-align: center; white-space: normal; overflow-wrap: anywhere; text-wrap: balance;
    text-shadow: 0 3px 0 ${palette.ink}, 3px 0 0 ${palette.ink}, -3px 0 0 ${palette.ink}, 0 -3px 0 ${palette.ink},
      2px 2px 0 ${palette.ink}, -2px 2px 0 ${palette.ink}, 2px -2px 0 ${palette.ink}, -2px -2px 0 ${palette.ink},
      0 6px 0 ${palette.ink};
    z-index: 95; pointer-events: none;
    transition: transform 0.45s cubic-bezier(.34,1.56,.64,1);
  `;
  bannerEl.textContent = paidIds.length > 1 ? "TEAM WINS!" : `${winnerPlayer?.name ?? "?"} WINS!`;
  bannerEl.dataset.sspHeadline = "results";
  document.body.appendChild(bannerEl);

  /* ---- DOM: "+N" coin counter, in its own slot under the headline ---- */
  const tickerEl = document.createElement("div");
  tickerEl.style.cssText = `
    position: fixed; left: 50%; top: 0; transform: translateX(-50%);
    font-size: clamp(26px, 7vw, 44px); font-weight: 800; color: ${palette.sun}; line-height: 1;
    text-shadow: 0 3px 0 ${palette.ink}, 3px 0 0 ${palette.ink}, -3px 0 0 ${palette.ink}, 0 -3px 0 ${palette.ink},
      2px 2px 0 ${palette.ink}, -2px 2px 0 ${palette.ink}, 2px -2px 0 ${palette.ink}, -2px -2px 0 ${palette.ink};
    z-index: 95; pointer-events: none; opacity: 0; transition: opacity 0.2s ease-out; white-space: nowrap;
  `;
  tickerEl.textContent = `+${coins}`;
  tickerEl.dataset.sspFloat = "coins";
  document.body.appendChild(tickerEl);

  /* ---- DOM: rank card ---- */
  const cardEl = document.createElement("div");
  cardEl.style.cssText = `
    position: fixed; left: 50%; bottom: calc(env(safe-area-inset-bottom, 0px) + 20px);
    transform: translateX(-50%) translateY(80px);
    background: ${palette.cream}; border: 4px solid ${palette.ink}; border-radius: 20px;
    padding: 12px 20px; box-shadow: 0 6px 0 ${palette.ink}; box-sizing: border-box; max-width: 92vw;
    z-index: 94; pointer-events: none; opacity: 0;
    transition: transform 0.4s cubic-bezier(.34,1.56,.64,1), opacity 0.3s ease-out;
    font-size: 15px; font-weight: 600; color: ${palette.ink};
    display: flex; flex-direction: column; gap: 4px; min-width: 200px;
  `;
  const cardHeader = document.createElement("div");
  cardHeader.style.cssText = "text-align:center; font-weight:700; margin-bottom:4px;";
  cardHeader.textContent = `${minigameName} — RESULTS`;
  cardEl.appendChild(cardHeader);
  cardEl.dataset.sspResults = "minigame";

  for (let i = 0; i < ordered.length; i++) {
    const p = match.players[ordered[i]];
    const color = characterColor(p?.kind ?? "pip");
    const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : "4.";
    const row = document.createElement("div");
    row.style.color = color;
    row.style.fontWeight = "700";
    row.style.textShadow = `0 1px 0 ${palette.ink}`;
    row.dataset.sspPlayer = String(ordered[i]);
    let rowText = `${medal} ${p?.name ?? "?"}`;
    if (paid.has(ordered[i])) {
      rowText += ` +${coins}c`;
      row.dataset.sspPaid = String(coins);
    }
    row.textContent = rowText;
    cardEl.appendChild(row);
  }
  document.body.appendChild(cardEl);

  /* ---- layout: headline, +N slot, free band for the podium, card ---- */
  const { h: vh } = viewportSize();
  const tickerTop = bannerEl.offsetTop + bannerEl.offsetHeight + 6;
  tickerEl.style.top = `${tickerTop}px`;
  const topInset = tickerTop + tickerEl.offsetHeight + 10;
  const bottomInset = Math.min(vh * 0.45, cardEl.offsetHeight + 20 + 16);
  const rowSpec = () => ({
    box: box(ROW_BOX.min, ROW_BOX.max),
    dir: ROW_DIR,
    fov: ROW_FOV,
    insets: { top: topInset, bottom: bottomInset, left: 8, right: 8 },
  });
  // Final pose (computed now, applied at the cut); the swoop starts a bit farther back.
  let camPos1 = new THREE.Vector3();
  let look1 = new THREE.Vector3();
  let camPosStart = new THREE.Vector3();

  /* ---- state ---- */
  let t = 0;
  let done = false;
  let destroyed = false;
  let cut = false;
  let bannerShown = false;
  let confettiDone = false;
  let coinDone = false;
  let cardShown = false;
  let coinTick = 0;
  let lastCoinSfx = 0;
  document.body.dataset.mgResults = "cut";

  /* Pre-compute coin burst data (presentation-only) */
  const coinBursts = Array.from({ length: 12 }, () => ({
    angle: presRng() * Math.PI * 2,
    dist: 60 + presRng() * 120,
    size: 14 + presRng() * 14,
    delay: presRng() * 0.3,
  }));

  const coinEls: HTMLDivElement[] = [];

  /* ---- helpers ---- */

  /** The fade's peak: leave the minigame, enter the results scene. */
  function doCut(): void {
    cut = true;
    for (const obj of opts.hide ?? []) {
      hidden.push({ obj, vis: obj.visible });
      obj.visible = false;
    }
    backdrop.visible = true;
    podium.visible = true;
    scene.background = sky;
    scene.fog = null;
    for (const cd of charData) {
      scene.add(cd.parent);
      cd.origParent = cd.ch.group.parent ?? scene;
      cd.ch.group.removeFromParent();
      cd.parent.add(cd.ch.group);
      cd.ch.group.position.set(0, 0, 0);
      cd.ch.group.rotation.set(0, 0, 0);
      cd.ch.group.scale.set(1, 1, 1);
      cd.ch.setFacing(0); // face +Z (camera)
      const pid = ordered[charData.indexOf(cd)];
      if (paid.has(pid)) cd.ch.anim.cheer();
      else cd.ch.anim.sad();
      cd.moved = true;
    }
    const f = fitCamera(camera, rowSpec());
    camPos1 = f.pos;
    look1 = f.look;
    camPosStart = look1.clone().add(camPos1.clone().sub(look1).multiplyScalar(1.3));
    camPosStart.y += 1.2;
    camera.position.copy(camPosStart);
    camera.lookAt(look1);
  }

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
        border: 2px solid ${palette.ink}; z-index: 93; pointer-events: none;
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

    // Fade cut: ink in, swap scenes at the peak, ink out.
    if (t < CUT_IN) {
      fadeEl.style.opacity = String(t / CUT_IN);
    } else {
      if (!cut) doCut();
      fadeEl.style.opacity = String(Math.max(0, 1 - (t - CUT_IN) / CUT_OUT));
    }
    if (!cut) return;

    // Camera settle onto the fitted podium shot
    const camP = clamp01((t - CUT_IN) / (CAMERA_SWOOP_T - CUT_IN));
    const camE = easeInOutCubic(camP);
    camera.position.lerpVectors(camPosStart, camPos1, camE);
    camera.lookAt(look1);

    // Podium scale-in
    const podP = clamp01((t - CUT_IN) / 0.45);
    podium.scale.setScalar(0.01 + 0.99 * easeOutBack(podP));

    // Banner
    if (!bannerShown && t >= BANNER_T) {
      bannerShown = true;
      bannerEl.style.transform = "translateX(-50%) scale(1)";
      document.body.dataset.mgResults = "banner";
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
      tickerEl.textContent = "+0";
      tickerEl.style.opacity = coins !== 0 ? "1" : "0";
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
            [
              { transform: "translateX(-50%) scale(1)" },
              { transform: "translateX(-50%) scale(1.25)" },
              { transform: "translateX(-50%) scale(1)" },
            ],
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
      document.body.dataset.mgResults = "card";
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
    delete document.body.dataset.mgResults;

    // Remove DOM
    fadeEl.remove();
    bannerEl.remove();
    tickerEl.remove();
    cardEl.remove();
    for (const el of coinEls) el.remove();

    // Restore characters
    for (const cd of charData) {
      if (cd.moved) {
        cd.parent.remove(cd.ch.group);
        cd.origParent.add(cd.ch.group);
        cd.ch.group.position.copy(cd.origPos);
        cd.ch.group.rotation.copy(cd.origRot);
        cd.ch.group.scale.copy(cd.origScale);
      }
      scene.remove(cd.parent);
    }

    // Remove the results scene
    scene.remove(podium);
    scene.remove(backdrop);
    for (const m of podiumMats) m.dispose();
    for (const g of podiumGeos) g.dispose();
    for (const x of podiumTexs) x.dispose();

    // Put the minigame scene back as it was
    for (const h of hidden) h.obj.visible = h.vis;
    scene.background = bg0;
    scene.fog = fog0;
    camera.fov = fov0;
    camera.updateProjectionMatrix();
    camera.position.copy(camPos0);
    camera.quaternion.copy(camQuat0);
  }

  return { update, isDone: () => done, destroy };
}
