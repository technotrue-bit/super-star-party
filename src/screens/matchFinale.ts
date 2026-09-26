/**
 * SUPER STAR PARTY — match finale screen (Wave 4).
 *
 * The end-of-match awards ceremony: the game's biggest MP7 moment. A full
 * podium celebration with standings count-up, one-at-a-time bonus star reveals
 * (drumroll, banner, star flying into the winner's count), winner podium with
 * sustained confetti + sparkles, and PLAY AGAIN / BACK TO TITLE controls.
 *
 * Determinism: presentation randomness comes from its own mulberry32 stream
 * (seed 0xf100a1) — never Math.random(), never the gameplay rng. exit() removes
 * every DOM node, 3D object, listener, and timer it created; re-entering works.
 *
 * Timeline (~5.2s before controls):
 *   0.0-0.8s   Camera swoop to podium view + standings banner drops in
 *   0.8-1.6s   Standings count-up: stars + coins animate from 0 to final
 *   1.6-2.8s   Mini star reveal: drumroll, banner, star flies to winner
 *   2.8-4.0s   Coin star reveal: drumroll, banner, star flies to winner
 *   4.0-5.2s   Winner banner + podium poses + sustained confetti/sparkles
 *   5.2s+      Controls appear (PLAY AGAIN / BACK TO TITLE)
 */
import * as THREE from "three";
import { world } from "../main";
import { palette, hex } from "../config/palette";
import { match, startMatch } from "../core/game";
import { audio } from "../audio/audioEngine";
import { ui } from "../ui/kit";
import { mulberry32 } from "../core/rng";
import { characterColor } from "../characters/roster";
import { finalRanking, computeBonusStars } from "../game/economy";
import { screens } from "./screenManager";
import { createCharacter, type Character } from "../characters/characterFactory";
import type { Screen } from "./screenManager";
import type { FinalRankEntry, BonusStarAward } from "../game/economy";

/* ------------------------------------------------------------------ */
/*  Presentation-only RNG (fixed seed — never touches gameplay rng)    */
/* ------------------------------------------------------------------ */

const presRng = mulberry32(0xf100a1);

/* ------------------------------------------------------------------ */
/*  Easing                                                             */
/* ------------------------------------------------------------------ */

const easeInOutCubic = (p: number): number =>
  p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
const easeOutBack = (p: number): number => {
  const c = 1.70158;
  return 1 + (c + 1) * Math.pow(p - 1, 3) + c * Math.pow(p - 1, 2);
};
const easeOutCubic = (p: number): number => 1 - Math.pow(1 - p, 3);
const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/* ------------------------------------------------------------------ */
/*  Timeline (seconds)                                                 */
/* ------------------------------------------------------------------ */

const SWOOP_T = 1.2;
const STANDINGS_DUR = 1.2; /* the coin/star tally is a beat of its own — 0.8s read as a jump */
const BONUS1_T = 2.8;
const BONUS1_DUR = 1.2;
const BONUS2_T = 5.4;
const WINNER_T = 8.2;
const CONTROLS_T = 12.4;

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

const PODIUM_STEPS: StepDef[] = [
  { x: 0, y: 0, z: 0, w: 2.6, d: 2.2, h: 1.4, color: palette.sun },
  { x: -2.6, y: 0, z: 0.4, w: 2.2, d: 2.0, h: 0.9, color: palette.bubble },
  { x: 2.6, y: 0, z: 0.4, w: 2.2, d: 2.0, h: 0.9, color: palette.berry },
  { x: 0, y: 0, z: 3.0, w: 2.2, d: 1.8, h: 0.2, color: palette.cream },
];

/* ------------------------------------------------------------------ */
/*  Mutable state (class-based to keep types non-optional)              */
/* ------------------------------------------------------------------ */

class FinaleScreen implements Screen {
  readonly id = "finale";

  // lifecycle
  private _t = 0;
  private _phase = "init";
  private _transitioning = false;

  // data
  private _chars: Character[] = [];
  private _charData: Array<{ ch: Character; parent: THREE.Group }> = [];
  private _podium: THREE.Group | null = null;
  private _podiumMats: THREE.Material[] = [];
  private _podiumGeos: THREE.BufferGeometry[] = [];
  private _domEls: HTMLElement[] = [];
  private _bannerEl: HTMLElement | null = null;
  private _winnerBannerEl: HTMLElement | null = null;
  private _standingsEl: HTMLElement | null = null;
  private _controlsEl: HTMLElement | null = null;
  private _confettiTimer: number | null = null;
  private _sparkleTimer: number | null = null;
  private _onKeyDown: ((e: KeyboardEvent) => void) | null = null;
  private _playAgainBtn: ReturnType<typeof ui.button> | null = null;
  private _titleBtn: ReturnType<typeof ui.button> | null = null;
  private _podiumParents: THREE.Group[] = [];
  private _highlighted = 0;
  private _rankings: FinalRankEntry[] = [];
  private _bonuses: BonusStarAward[] = [];
  private _kinds: string[] = [];
  private _names: string[] = [];
  private _starDisplays: number[] = [];
  private _coinDisplays: number[] = [];
  private _camPos0: THREE.Vector3 | null = null;
  private _camQuat0: THREE.Quaternion | null = null;
  private _look0: THREE.Vector3 | null = null;
  private _bonusRevealed = [false, false];

  /* ---------------------------------------------------------------- */
  /*  Enter                                                            */
  /* ---------------------------------------------------------------- */

  enter(): void {
    this._t = 0;
    this._phase = "init";
    this._transitioning = false;
    this._chars = [];
    this._charData = [];
    this._podium = null;
    this._podiumMats = [];
    this._podiumGeos = [];
    this._domEls = [];
    this._bannerEl = null;
    this._winnerBannerEl = null;
    this._standingsEl = null;
    this._controlsEl = null;
    this._confettiTimer = null;
    this._sparkleTimer = null;
    this._onKeyDown = null;
    this._playAgainBtn = null;
    this._titleBtn = null;
    this._podiumParents = [];
    this._highlighted = 0;
    this._rankings = [];
    this._bonuses = [];
    this._kinds = [];
    this._names = [];
    this._starDisplays = [];
    this._coinDisplays = [];
    this._camPos0 = null;
    this._camQuat0 = null;
    this._look0 = null;
    this._bonusRevealed = [false, false];

    const scene = world.scene;
    const camera = world.camera;
    if (!scene || !camera) return;

    // roster
    this._kinds = match.players.map((p) => p.kind);
    this._names = match.players.map((p) => p.name);
    if (this._kinds.length === 0) {
      this._kinds = ["pip", "bounce", "glimmer", "tusk"];
      this._names = ["Pip", "Bounce", "Glimmer", "Tusk"];
    }

    // economy
    this._rankings = finalRanking();
    this._bonuses = computeBonusStars();
    this._starDisplays = this._rankings.map(() => 0);
    this._coinDisplays = this._rankings.map(() => 0);

    // camera
    this._camPos0 = camera.position.clone();
    this._camQuat0 = camera.quaternion.clone();
    this._look0 = new THREE.Vector3(0, 0, -1).applyQuaternion(this._camQuat0).add(this._camPos0);

    // podium
    const podium = new THREE.Group();
    for (const step of PODIUM_STEPS) {
      const geo = new THREE.BoxGeometry(step.w, step.h, step.d);
      const mat = new THREE.MeshBasicMaterial({ color: hex(step.color) });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(step.x, step.h / 2, step.z);
      podium.add(mesh);
      this._podiumMats.push(mat);
      this._podiumGeos.push(geo);
      const oGeo = new THREE.BoxGeometry(step.w + 0.14, step.h + 0.14, step.d + 0.14);
      const oMat = new THREE.MeshBasicMaterial({ color: hex(palette.ink), side: THREE.BackSide });
      const oMesh = new THREE.Mesh(oGeo, oMat);
      oMesh.position.copy(mesh.position);
      podium.add(oMesh);
      this._podiumMats.push(oMat);
      this._podiumGeos.push(oGeo);
    }
    const baseGeo = new THREE.BoxGeometry(8.0, 0.2, 6.0);
    const baseMat = new THREE.MeshBasicMaterial({ color: hex(palette.cream) });
    const baseMesh = new THREE.Mesh(baseGeo, baseMat);
    baseMesh.position.set(0, -0.1, 1.2);
    podium.add(baseMesh);
    this._podiumMats.push(baseMat);
    this._podiumGeos.push(baseGeo);
    const baseOGeo = new THREE.BoxGeometry(8.14, 0.32, 6.14);
    const baseOMat = new THREE.MeshBasicMaterial({ color: hex(palette.ink), side: THREE.BackSide });
    const baseOMesh = new THREE.Mesh(baseOGeo, baseOMat);
    baseOMesh.position.copy(baseMesh.position);
    podium.add(baseOMesh);
    this._podiumMats.push(baseOMat);
    this._podiumGeos.push(baseOGeo);

    podium.scale.setScalar(0.01);
    scene.add(podium);
    this._podium = podium;

    // characters on floor
    for (let i = 0; i < this._rankings.length; i++) {
      const pid = this._rankings[i].playerId;
      const ch = createCharacter(match.players[pid]?.kind ?? "pip");
      ch.group.position.set(-3 + i * 2, 0, 6);
      ch.group.scale.setScalar(0.92);
      ch.setFacing(0);
      ch.anim.idle();
      scene.add(ch.group);
      this._chars.push(ch);
      this._charData.push({ ch, parent: new THREE.Group() });
    }

    // standings banner
    const standingsRows: string[] = [];
    for (let i = 0; i < this._rankings.length; i++) {
      const r = this._rankings[i];
      const p = match.players[r.playerId];
      const color = characterColor(p?.kind ?? "pip");
      const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : "4.";
      standingsRows.push(
        `<div id="finale-row-${i}" style="display:flex;justify-content:space-between;align-items:center;gap:12px;padding:4px 0;color:${color};font-weight:700;font-size:16px;">
          <span>${medal} ${p?.name ?? "?"}</span>
          <span>★<span id="finale-stars-${i}">0</span> · <span id="finale-coins-${i}">0</span>c</span>
        </div>`
      );
    }
    const standings = document.createElement("div");
    standings.style.cssText = `
      position:fixed;left:50%;top:18px;transform:translateX(-50%) translateY(-120px);
      background:${palette.cream};border:5px solid ${palette.ink};border-radius:22px;
      padding:14px 22px;box-shadow:0 7px 0 ${palette.ink};z-index:92;pointer-events:none;
      font-family:'Fredoka',sans-serif;min-width:260px;
      transition:transform 0.5s cubic-bezier(.34,1.56,.64,1);
    `;
    standings.innerHTML = `<div style="text-align:center;font-weight:700;font-size:18px;color:${palette.ink};margin-bottom:8px;">FINAL STANDINGS</div>${standingsRows.join("")}`;
    document.body.appendChild(standings);
    this._standingsEl = standings;
    this._domEls.push(standings);

    // center banner (bonus reveals)
    const banner = document.createElement("div");
    banner.style.cssText = `
      position:fixed;left:50%;top:50%;transform:translate(-50%,-50%) scale(0);
      font-size:clamp(28px,6vw,56px);font-weight:700;color:${palette.cream};
      text-shadow:0 3px 0 ${palette.ink},3px 0 0 ${palette.ink},-3px 0 0 ${palette.ink},0 -3px 0 ${palette.ink},0 6px 0 ${palette.ink};
      z-index:95;pointer-events:none;white-space:nowrap;text-align:center;
      transition:transform 0.45s cubic-bezier(.34,1.56,.64,1);
    `;
    document.body.appendChild(banner);
    this._bannerEl = banner;
    this._domEls.push(banner);

    // winner banner
    const winnerBanner = document.createElement("div");
    winnerBanner.style.cssText = `
      position:fixed;left:50%;top:38%;transform:translate(-50%,-50%) scale(0);
      font-size:clamp(36px,9vw,80px);font-weight:700;color:${palette.sun};
      text-shadow:0 3px 0 ${palette.ink},3px 0 0 ${palette.ink},-3px 0 0 ${palette.ink},0 -3px 0 ${palette.ink},
        2px 2px 0 ${palette.ink},-2px 2px 0 ${palette.ink},2px -2px 0 ${palette.ink},-2px -2px 0 ${palette.ink},0 7px 0 ${palette.ink};
      z-index:96;pointer-events:none;white-space:nowrap;
      transition:transform 0.5s cubic-bezier(.34,1.56,.64,1);
    `;
    document.body.appendChild(winnerBanner);
    this._winnerBannerEl = winnerBanner;
    this._domEls.push(winnerBanner);

    // controls container
    const controls = document.createElement("div");
    controls.style.cssText = `
      position:fixed;left:50%;bottom:40px;transform:translateX(-50%);z-index:97;
      display:flex;gap:16px;opacity:0;transition:opacity 0.4s ease-out;
    `;
    document.body.appendChild(controls);
    this._controlsEl = controls;
    this._domEls.push(controls);

    // keyboard
    this._onKeyDown = (e: KeyboardEvent) => {
      if (this._transitioning) return;
      if (this._phase !== "controls") {
        if (e.key === "Escape") this._goTitle();
        return;
      }
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        this._highlighted = this._highlighted === 0 ? 1 : 0;
        this._applyHighlight();
        audio.sfx.play("pop");
      } else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        if (this._highlighted === 0) this._playAgain();
        else this._goTitle();
      } else if (e.key === "Escape") {
        this._goTitle();
      }
    };
    window.addEventListener("keydown", this._onKeyDown);

    audio.music.play("results", { intensity: 0.9 });
    this._phase = "swoop";
  }

  /* ---------------------------------------------------------------- */
  /*  Update                                                            */
  /* ---------------------------------------------------------------- */

  update(dt: number): void {
    if (this._transitioning) return;
    this._t += dt;
    const t = this._t;

    const scene = world.scene;
    const camera = world.camera;
    if (!scene || !camera || !this._camPos0 || !this._camQuat0 || !this._look0) return;

    // camera swoop
    if (this._phase === "swoop" || this._phase === "standings") {
      const camP = clamp01(t / SWOOP_T);
      const camE = easeInOutCubic(camP);
      const camTarget = new THREE.Vector3(0, 5.0, 11);
      const lookTarget = new THREE.Vector3(0, 1.4, 0.5);
      camera.position.lerpVectors(this._camPos0, camTarget, camE);
      const look = new THREE.Vector3().lerpVectors(this._look0, lookTarget, camE);
      camera.lookAt(look);

      if (this._podium) {
        const podP = clamp01(t / 0.5);
        this._podium.scale.setScalar(0.01 + 0.99 * easeOutBack(podP));
      }
    }

    // standings banner drops
    if (t >= SWOOP_T && this._standingsEl) {
      this._standingsEl.style.transform = "translateX(-50%) translateY(0)";
    }

    // standings count-up
    if (t >= SWOOP_T && t < SWOOP_T + STANDINGS_DUR) {
      this._phase = "standings";
      const p = clamp01((t - SWOOP_T) / STANDINGS_DUR);
      for (let i = 0; i < this._rankings.length; i++) {
        const baseStars = this._rankings[i].stars - this._rankings[i].bonus.length;
        const targetCoins = this._rankings[i].coins;
        const displayedStars = Math.round(p * baseStars);
        const displayedCoins = Math.round(p * targetCoins);
        if (displayedStars !== this._starDisplays[i]) {
          this._starDisplays[i] = displayedStars;
          const el = document.getElementById(`finale-stars-${i}`);
          if (el) el.textContent = String(displayedStars);
        }
        if (displayedCoins !== this._coinDisplays[i]) {
          this._coinDisplays[i] = displayedCoins;
          const el = document.getElementById(`finale-coins-${i}`);
          if (el) el.textContent = String(displayedCoins);
        }
      }
    }

    // bonus star reveals
    if (!this._bonusRevealed[0] && t >= BONUS1_T) {
      this._bonusRevealed[0] = true;
      this._revealBonus(0);
    }
    if (this._bonusRevealed[0] && !this._bonusRevealed[1] && t >= BONUS2_T) {
      this._bonusRevealed[1] = true;
      this._revealBonus(1);
    }

    // winner phase
    if (this._phase !== "winner" && this._phase !== "controls" && t >= WINNER_T) {
      this._phase = "winner";
      this._showWinner();
    }

    // controls phase
    if (this._phase === "winner" && t >= CONTROLS_T) {
      this._phase = "controls";
      this._showControls();
    }
  }

  /* ---------------------------------------------------------------- */
  /*  Bonus star reveal                                                 */
  /* ---------------------------------------------------------------- */

  private _revealBonus(idx: number): void {
    const award = this._bonuses[idx];
    if (!award) return;
    const player = match.players[award.playerId];
    const color = characterColor(player?.kind ?? "pip");
    const starLabel = award.star === "mini" ? "MINIGAME STAR" : "COIN STAR";

    audio.sfx.play("pop", { volume: 0.8 });

    if (this._bannerEl) {
      this._bannerEl.style.color = color;
      this._bannerEl.textContent = `${player?.name ?? "?"} WINS THE ${starLabel}!`;
      this._bannerEl.style.transform = "translate(-50%,-50%) scale(1)";
      audio.sfx.play("fanfare.win");
    }

    const rowIdx = this._rankings.findIndex((r) => r.playerId === award.playerId);
    setTimeout(() => this._flyStarToWinner(award, rowIdx, idx), 300);

    setTimeout(() => {
      if (this._bannerEl) {
        this._bannerEl.style.transform = "translate(-50%,-50%) scale(0)";
      }
    }, idx === 0 ? BONUS1_DUR * 800 : 1000);
  }

  private _flyStarToWinner(award: BonusStarAward, rowIdx: number, idx: number): void {
    if (rowIdx < 0) return;

    const player = match.players[award.playerId];
    const starEl = document.createElement("div");
    starEl.textContent = "★";
    starEl.style.cssText = `
      position:fixed;left:50%;top:45%;transform:translate(-50%,-50%) scale(3);
      font-size:48px;color:${palette.sun};z-index:98;pointer-events:none;text-shadow:0 2px 0 ${palette.ink};
    `;
    document.body.appendChild(starEl);
    this._domEls.push(starEl);

    const starsEl = document.getElementById(`finale-stars-${rowIdx}`);
    console.log(`[finale] bonus ${idx} (${award.star}) → row ${rowIdx} (${player?.name}), starsEl=${!!starsEl}`);
    if (starsEl) {
      const rect = starsEl.getBoundingClientRect();
      try {
        starEl.animate(
          [
            { left: "50%", top: "45%", transform: "translate(-50%,-50%) scale(3)", opacity: 1 },
            { left: `${rect.left + 20}px`, top: `${rect.top - 10}px`, transform: "translate(-50%,-50%) scale(1)", opacity: 1 },
          ],
          { duration: 500, easing: "cubic-bezier(.34,1.56,.64,1)", fill: "both" }
        );
      } catch { /* WAAPI unavailable */ }
      setTimeout(() => {
        // Count how many bonus stars this player has won up to and including idx
        const bonusesWon = this._bonuses.slice(0, idx + 1).filter((b) => b.playerId === award.playerId).length;
        const baseStars = this._rankings[rowIdx].stars - this._rankings[rowIdx].bonus.length;
        const newCount = baseStars + bonusesWon;
        console.log(`[finale] row ${rowIdx} (${player?.name}): base=${baseStars}, won=${bonusesWon}, new=${newCount}`);
        starsEl.textContent = String(newCount);
        this._starDisplays[rowIdx] = newCount;
        audio.sfx.play("star.get");
        starEl.remove();
      }, 500);
    } else {
      setTimeout(() => starEl.remove(), 800);
    }
  }

  /* ---------------------------------------------------------------- */
  /*  Winner                                                            */
  /* ---------------------------------------------------------------- */

  private _showWinner(): void {
    const scene = world.scene;
    if (!scene) return;

    const winnerId = this._rankings[0]?.playerId ?? 0;
    const winnerPlayer = match.players[winnerId];
    const winnerColor = characterColor(winnerPlayer?.kind ?? "pip");

    // move characters to podium steps
    for (let i = 0; i < this._rankings.length; i++) {
      const pid = this._rankings[i].playerId;
      const charIdx = this._charData.findIndex(
        (cd) => cd.ch === this._chars[this._rankings.findIndex((r) => r.playerId === pid)]
      );
      if (charIdx < 0) continue;
      const cd = this._charData[charIdx];
      const step = PODIUM_STEPS[Math.min(i, PODIUM_STEPS.length - 1)];

      scene.remove(cd.ch.group);
      const parent = new THREE.Group();
      parent.position.set(step.x, step.h, step.z + 0.4);
      scene.add(parent);
      parent.add(cd.ch.group);
      cd.ch.group.position.set(0, 0, 0);
      cd.ch.group.rotation.set(0, 0, 0);
      cd.ch.group.scale.set(1, 1, 1);
      cd.ch.setFacing(0);
      cd.parent = parent;
      this._podiumParents.push(parent);

      if (pid === winnerId) cd.ch.anim.cheer();
      else cd.ch.anim.sad();
    }

    // winner banner
    if (this._winnerBannerEl) {
      this._winnerBannerEl.textContent = `${winnerPlayer?.name ?? "?"} WINS!`;
      this._winnerBannerEl.style.color = winnerColor;
      this._winnerBannerEl.style.transform = "translate(-50%,-50%) scale(1)";
    }

    // confetti + sparkles
    this._spawnSustainedConfetti();
    this._sparkleTimer = window.setInterval(() => this._spawnSparkles(), 600);

    // camera push-in
    const camera = world.camera;
    if (camera) {
      const camTarget = new THREE.Vector3(0, 4.5, 9);
      const lookTarget = new THREE.Vector3(0, 1.6, 0);
      const startPos = camera.position.clone();
      const startLook = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion).add(camera.position);
      let pushT = 0;
      const pushInterval = window.setInterval(() => {
        pushT += 1 / 60;
        const p = clamp01(pushT / 1.2);
        const e = easeOutCubic(p);
        camera.position.lerpVectors(startPos, camTarget, e);
        const look = new THREE.Vector3().lerpVectors(startLook, lookTarget, e);
        camera.lookAt(look);
        if (p >= 1) window.clearInterval(pushInterval);
      }, 1000 / 60);
    }
  }

  private _spawnSustainedConfetti(): void {
    const burst = () => {
      ui.confettiBurst(window.innerWidth * 0.2, window.innerHeight * 0.3, { sound: null, count: 45 });
      ui.confettiBurst(window.innerWidth * 0.8, window.innerHeight * 0.3, { sound: null, count: 45 });
    };
    burst();
    this._confettiTimer = window.setInterval(burst, 900);
  }

  private _spawnSparkles(): void {
    const colors = [palette.sun, palette.candy, palette.mint, palette.bubble, palette.berry];
    for (let i = 0; i < 8; i++) {
      const el = document.createElement("div");
      const size = 4 + presRng() * 6;
      el.style.cssText = `
        position:fixed;left:${30 + presRng() * 40}%;top:${25 + presRng() * 30}%;
        width:${size}px;height:${size}px;border-radius:50%;
        background:${colors[i % colors.length]};z-index:94;pointer-events:none;
        box-shadow:0 0 6px ${colors[i % colors.length]};
      `;
      document.body.appendChild(el);
      this._domEls.push(el);
      try {
        el.animate(
          [{ opacity: 0, transform: "scale(0)" }, { opacity: 1, transform: "scale(1)", offset: 0.4 }, { opacity: 0, transform: "scale(0.5)" }],
          { duration: 600 + presRng() * 400, easing: "ease-out", fill: "both" }
        ).onfinish = () => el.remove();
      } catch {
        window.setTimeout(() => el.remove(), 800);
      }
    }
  }

  /* ---------------------------------------------------------------- */
  /*  Controls                                                          */
  /* ---------------------------------------------------------------- */

  private _showControls(): void {
    const controls = this._controlsEl;
    if (!controls) return;

    const playBtn = ui.button({
      label: "PLAY AGAIN",
      kind: "gold",
      size: "lg",
      sound: null,
      ariaLabel: "Play again — start a new match with the same roster",
      onClick: () => this._playAgain(),
    });
    playBtn.el.style.width = "200px";
    controls.appendChild(playBtn.el);
    this._playAgainBtn = playBtn;

    const titleBtn = ui.button({
      label: "BACK TO TITLE",
      kind: "ghost",
      size: "lg",
      sound: null,
      ariaLabel: "Back to title screen",
      onClick: () => this._goTitle(),
    });
    titleBtn.el.style.width = "200px";
    controls.appendChild(titleBtn.el);
    this._titleBtn = titleBtn;

    controls.style.opacity = "1";
    this._applyHighlight();
  }

  private _applyHighlight(): void {
    if (this._playAgainBtn && this._titleBtn) {
      this._playAgainBtn.el.style.transform = this._highlighted === 0 ? "scale(1.09)" : "scale(1)";
      this._playAgainBtn.el.style.boxShadow = this._highlighted === 0 ? `0 8px 0 ${palette.ink}, 0 0 22px ${palette.sun}aa` : "";
      this._titleBtn.el.style.transform = this._highlighted === 1 ? "scale(1.09)" : "scale(1)";
      this._titleBtn.el.style.boxShadow = this._highlighted === 1 ? `0 8px 0 ${palette.ink}, 0 0 22px ${palette.bubble}aa` : "";
    }
  }

  private _playAgain(): void {
    if (this._transitioning) return;
    this._transitioning = true;
    audio.sfx.play("fanfare.win");
    ui.confettiBurst(window.innerWidth / 2, window.innerHeight * 0.4, { sound: null, count: 80 });
    startMatch(this._kinds, this._names, 10);
    setTimeout(() => screens.goto("board"), 200);
  }

  private _goTitle(): void {
    if (this._transitioning) return;
    this._transitioning = true;
    audio.sfx.play("ui.back");
    screens.goto("title");
  }

  /* ---------------------------------------------------------------- */
  /*  Exit                                                              */
  /* ---------------------------------------------------------------- */

  exit(): void {
    this._transitioning = true;

    if (this._onKeyDown) {
      window.removeEventListener("keydown", this._onKeyDown);
      this._onKeyDown = null;
    }
    if (this._confettiTimer !== null) {
      window.clearInterval(this._confettiTimer);
      this._confettiTimer = null;
    }
    if (this._sparkleTimer !== null) {
      window.clearInterval(this._sparkleTimer);
      this._sparkleTimer = null;
    }

    for (const el of this._domEls) {
      try { el.remove(); } catch { /* gone */ }
    }
    this._domEls = [];
    this._bannerEl = null;
    this._winnerBannerEl = null;
    this._standingsEl = null;
    this._controlsEl = null;

    this._playAgainBtn?.destroy();
    this._playAgainBtn = null;
    this._titleBtn?.destroy();
    this._titleBtn = null;

    const scene = world.scene;
    if (this._podium && scene) scene.remove(this._podium);
    for (const m of this._podiumMats) m.dispose();
    for (const g of this._podiumGeos) g.dispose();
    this._podium = null;
    this._podiumMats = [];
    this._podiumGeos = [];

    if (scene) {
      for (const p of this._podiumParents) scene.remove(p);
    }
    this._podiumParents = [];

    for (const ch of this._chars) {
      try { ch.dispose(); } catch { /* */ }
    }
    this._chars = [];
    this._charData = [];

    audio.music.stop(0.3);
    ui.clearScreen();
  }

  /* ---------------------------------------------------------------- */
  /*  Render                                                            */
  /* ---------------------------------------------------------------- */

  render(): void {}
}

export const matchFinale: Screen = new FinaleScreen();

/** Exported entry for orchestrator wiring (phase === 'ended' → finale). */
export function startFinale(): void {
  screens.goto("finale");
}
