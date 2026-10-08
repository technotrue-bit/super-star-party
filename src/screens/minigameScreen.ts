/**
 * SUPER STAR PARTY — minigame screen ('minigame').
 *
 * Runs one minigame round end to end:
 *   enter()  -> read the pending entry (set by the turn loop) and build the
 *               arena: lights, party floor, the 4 live avatars, arena
 *               camera, minigame_intro, 3-2-1-GO countdown (minigame.count
 *               per tick, minigame.go + flash on GO), then the minigame
 *               runs with minigame_a/minigame_b (rng-picked).
 *   update() -> countdown -> minigame.update(dt) -> on ctx.finish(ranking):
 *               RESULTS phase — payout (winner +10), minigame:end emit,
 *               fanfare + confetti + winner banner, characters cheer/sulk,
 *               rank popup, ~3.5s later auto-return to the board (the turn
 *               loop resumes its minigame round on re-entry).
 *   exit()   -> minigame.teardown(), dispose characters, sweep every scene
 *               object added since enter, clear UI + listeners, stop music.
 *
 * Robustness: with no pending minigame (or no match) enter() bails straight
 * back to the board, and an unresolvable minigame id does the same — the
 * turn loop's resume path keeps the match moving either way.
 */
import * as THREE from "three";
import { world } from "../main";
import { palette, hex } from "../config/palette";
import { settings } from "../config/settings";
import { match } from "../core/game";
import { mulberry32 } from "../core/rng";
import { bus } from "../core/events";
import { audio } from "../audio/audioEngine";
import { ui } from "../ui/kit";
import { characterColor } from "../characters/roster";
import { createCharacter, type Character } from "../characters/characterFactory";
import { minigamePayout, playerCoins } from "../game/economy";
import {
  consumePendingMinigame,
  loadMinigame,
  type Minigame,
  type MinigameContext,
  type MinigameEntry,
} from "../minigames/framework";
import type { Screen } from "./screenManager";
import { screens } from "./screenManager";
import { startResultsCeremony, type ResultsCeremony } from "./resultsCeremony";
import { createTouchPad, type TouchPad } from "../ui/touchPad";

/* ------------------------------------------------------------------ */
/*  Scoped styles (injected once; every color from the palette)        */
/* ------------------------------------------------------------------ */

let stylesInjected = false;

function injectMinigameStyles(): void {
  if (stylesInjected) return;
  stylesInjected = true;
  if (document.getElementById("ssp-minigame-styles")) return;
  const style = document.createElement("style");
  style.id = "ssp-minigame-styles";
  style.textContent = `
.ssp-mg-count { position:fixed; left:50%; top:36%; transform:translateX(-50%); font-size:112px; font-weight:700; color:${palette.sun}; text-shadow:6px 6px 0 ${palette.ink}, 10px 10px 0 rgba(43,29,78,.35); z-index:80; pointer-events:none; user-select:none; line-height:1; }
.ssp-mg-count--pop { animation:sspMgPop .55s cubic-bezier(.34,1.56,.64,1); }
@keyframes sspMgPop { 0% { transform:translateX(-50%) scale(.2) rotate(-10deg); opacity:0; } 100% { transform:translateX(-50%) scale(1) rotate(0deg); opacity:1; } }
.ssp-mg-count--go { color:${palette.mint}; }
.ssp-mg-count--out { opacity:0; transform:translateX(-50%) scale(1.15); transition:opacity 200ms ease-out, transform 200ms ease-out; }
.ssp-mg-flash { position:fixed; inset:0; pointer-events:none; z-index:79; opacity:0; }
.ssp-mg-results { display:flex; flex-direction:column; gap:8px; text-align:left; font-size:17px; }
.ssp-mg-results__row { background:${palette.cream}; border:3px solid ${palette.ink}; border-radius:14px; padding:8px 12px; box-shadow:0 3px 0 ${palette.ink}; }
.ssp-mg-results__row--win { background:${palette.sun}; font-weight:700; }
`;
  document.head.appendChild(style);
}

/* ------------------------------------------------------------------ */
/*  VS splash styles (injected once)                                   */
/* ------------------------------------------------------------------ */

let vsStylesInjected = false;

function injectVsSplashStyles(): void {
  if (vsStylesInjected) return;
  vsStylesInjected = true;
  if (document.getElementById("ssp-vs-splash-styles")) return;
  const style = document.createElement("style");
  style.id = "ssp-vs-splash-styles";
  style.textContent = `
    .ssp-vs-root { position:fixed; inset:0; z-index:88; pointer-events:none; overflow:hidden; }
    .ssp-vs-rect { position:absolute; bottom:0; left:0; width:100%; height:100%; }
    .ssp-vs-rect--a { background:linear-gradient(180deg, transparent 0%, ${palette.berry}22 100%); }
    .ssp-vs-rect--b { background:linear-gradient(180deg, transparent 0%, ${palette.sun}18 100%); }
    .ssp-vs-title {
      position:absolute; left:50%; top:22%; transform:translateX(-50%);
      font-size:clamp(34px, 9vw, 72px); font-weight:700; color:${palette.white};
      text-align:center; white-space:nowrap; line-height:1.05;
      text-shadow:0 3px 0 ${palette.ink}, 3px 0 0 ${palette.ink}, -3px 0 0 ${palette.ink}, 0 -3px 0 ${palette.ink},
        2px 2px 0 ${palette.ink}, -2px 2px 0 ${palette.ink}, 2px -2px 0 ${palette.ink}, -2px -2px 0 ${palette.ink},
        0 6px 0 ${palette.ink};
      letter-spacing:1px;
    }
    .ssp-vs-vs {
      position:absolute; left:50%; top:52%; transform:translateX(-50%) translateY(-50%);
      font-size:clamp(40px, 12vw, 96px); font-weight:700; color:${palette.sun};
      text-shadow:0 3px 0 ${palette.ink}, 3px 0 0 ${palette.ink}, -3px 0 0 ${palette.ink}, 0 -3px 0 ${palette.ink},
        2px 2px 0 ${palette.ink}, -2px 2px 0 ${palette.ink}, 2px -2px 0 ${palette.ink}, -2px -2px 0 ${palette.ink},
        0 7px 0 ${palette.ink};
      letter-spacing:2px;
    }
    .ssp-vs-player {
      position:absolute; width:clamp(44px, 13vw, 80px); height:clamp(44px, 13vw, 80px);
      border-radius:50%; border:3px solid ${palette.ink};
      display:flex; align-items:center; justify-content:center;
      font-weight:700; font-size:clamp(20px, 5vw, 36px); color:${palette.ink};
      box-shadow:0 3px 0 ${palette.ink};
      will-change: transform, opacity;
    }
    .ssp-vs-player--highlight { animation: sspVsPulse 0.9s ease-in-out infinite alternate; }
    @keyframes sspVsPulse { 0% { box-shadow:0 3px 0 ${palette.ink}, 0 0 0 0 rgba(255,210,63,0.7); } 100% { box-shadow:0 3px 0 ${palette.ink}, 0 0 0 8px rgba(255,210,63,0); } }
    .ssp-vs-badge {
      position:absolute; bottom:-10px; left:50%; transform:translateX(-50%);
      background:${palette.cream}; border:2px solid ${palette.ink}; border-radius:8px;
      padding:1px 6px; font-size:clamp(9px, 2vw, 13px); font-weight:700; color:${palette.ink};
      white-space:nowrap; line-height:1.2;
    }
  `;
  document.head.appendChild(style);
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/** Keep only valid, unique player ids (winner must be a real player). */
function cleanRanking(ranking: number[]): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const id of ranking) {
    if (!Number.isInteger(id)) continue;
    if (seen.has(id)) continue;
    if (!match.players[id]) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/*  VS splash — presentation-only layer (deterministic, pre-countdown) */
/* ------------------------------------------------------------------ */

const VS_TOTAL = 1.7; // total splash duration (s) — fits the 1.4-1.9s target
const VS_STAGGER = 0.18; // stagger between element pop-ins (s)
const VS_SKIP_DELAY = 0.6; // earliest a tap can skip the splash (s)

/**
 * Build the MP7-style VS splash overlay (game name + VS + 4 player pips).
 * Timing budget: VS_TOTAL seconds. Runs BEFORE the countdown timer starts,
 * so it adds no time to the playable budget. All randomness comes from a
 * dedicated seeded presentation stream (never ctx.rng / gameplay rng).
 */
function buildVsSplash(self: MgScreenState, mgName: string, themeColor: string): void {
  injectVsSplashStyles();
  const players = self._ctx?.players ?? match.players.map((p) => ({
    id: p.id, kind: p.kind, name: p.name, color: characterColor(p.kind),
  }));
  const seedFn = mulberry32(0x5eed ^ ((match.seed * 2654435761) >>> 0));

  // Root container
  const root = document.createElement("div");
  root.className = "ssp-vs-root";
  root.setAttribute("data-vs-name", mgName);
  document.body.appendChild(root);

  // Background accent rects (two soft color bands, animated via CSS)
  const rectA = document.createElement("div");
  rectA.className = "ssp-vs-rect ssp-vs-rect--a";
  root.appendChild(rectA);
  const rectB = document.createElement("div");
  rectB.className = "ssp-vs-rect ssp-vs-rect--b";
  root.appendChild(rectB);

  // Game name title — palette-colored per theme
  const titleEl = document.createElement("div");
  titleEl.className = "ssp-vs-title";
  titleEl.style.color = themeColor || palette.white;
  titleEl.textContent = mgName;
  root.appendChild(titleEl);

  // VS card
  const vsEl = document.createElement("div");
  vsEl.className = "ssp-vs-vs";
  vsEl.textContent = "VS";
  root.appendChild(vsEl);

  // Player pips — 4-PLAYER free-for-all layout
  const positions = [
    { x: 20, y: 70 }, { x: 55, y: 70 }, { x: 20, y: 82 }, { x: 55, y: 82 },
  ];
  const pipEls: HTMLDivElement[] = [];
  for (let i = 0; i < 4; i++) {
    const p = players[i];
    if (!p) continue;
    const el = document.createElement("div");
    el.className = "ssp-vs-player";
    const bg = p.color || palette.white;
    el.style.background = `radial-gradient(circle at 32% 28%, rgba(255,255,255,.55) 0%, rgba(255,255,255,0) 50%), linear-gradient(180deg, ${bg} 0%, ${bg} 100%)`;
    el.style.left = `${positions[i].x}vw`;
    el.style.top = `${positions[i].y}vh`;
    el.textContent = (p.name || "?")[0]?.toUpperCase() ?? "?";
    const badge = document.createElement("div");
    badge.className = "ssp-vs-badge";
    badge.textContent = p.name || "?";
    el.appendChild(badge);
    root.appendChild(el);
    pipEls.push(el);
  }

  // Staggered pop-in animation (seeded so placement is deterministic)
  const popIn = (el: HTMLElement, delay: number, startScale = 0.2, startOpacity = 0, startY = 20) => {
    el.style.opacity = String(startOpacity);
    el.style.transform = el.style.transform.replace(/scale\([^)]*\)/, "").trim() +
      ` scale(${startScale}) translateY(${startY}px)`;
    try {
      el.animate(
        [
          { opacity: startOpacity, transform: `scale(${startScale}) translateY(${startY}px)` },
          { opacity: 1, transform: "scale(1.08) translateY(-3px)", offset: 0.7 },
          { opacity: 1, transform: "scale(1) translateY(0)" },
        ],
        { duration: 380, delay: delay * 1000, easing: "cubic-bezier(.34,1.56,.64,1)", fill: "both" }
      );
    } catch {
      el.style.opacity = "1";
    }
  };

  // Title pops first, then VS, then staggered player pips
  popIn(titleEl, VS_STAGGER * 0, 0.3, 0, 30);
  popIn(vsEl, VS_STAGGER * 1.5, 0.1, 0, 0);
  // VS pulse emphasis
  try {
    vsEl.animate(
      [{ transform: "translateX(-50%) translateY(-50%) scale(1)" },
       { transform: "translateX(-50%) translateY(-50%) scale(1.18)", offset: 0.4 },
       { transform: "translateX(-50%) translateY(-50%) scale(1)" }],
      { duration: 520, delay: VS_STAGGER * 1500, easing: "ease-out", fill: "both" }
    );
  } catch { /* */ }
  for (let i = 0; i < pipEls.length; i++) {
    const delay = VS_STAGGER * (2.5 + i * 0.6 + seedFn() * 0.3);
    popIn(pipEls[i], delay, 0.2, 0, 18);
  }

  // Highlight ring on the human pip (player 0)
  if (pipEls[0]) {
    setTimeout(() => pipEls[0].classList.add("ssp-vs-player--highlight"), VS_STAGGER * 2500);
  }

  // Store cleanup handle
  self._vsTimer = window.setTimeout(() => {
    self._vsTimer = undefined;
    if (root.isConnected) root.remove();
  }, (VS_TOTAL + 0.3) * 1000);

  // Stash for skip handler
  (self as unknown as { _vsRoot?: HTMLDivElement })._vsRoot = root;
}

/** Dispose every mesh geometry/material under a root (idempotent). */
function disposeObj(root: THREE.Object3D): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.dispose();
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) m.dispose();
  });
}

/* ------------------------------------------------------------------ */
/*  HUD coin rolling count-up — board chip tween when board reappears  */
/* ------------------------------------------------------------------ */
/* The board HUD is torn down while the minigame/ceremony run. We read
 * the TRUE payout delta from the economy and tween the board's coin chip
 * when it re-materialises — the board screen creates its HUD AFTER
 * minigameScreen.exit() runs (during the wipe's onCover), so we poll via
 * RAF until the chip element exists. No gameplay rng is touched.
 *
 * hud.update() (called by the board's turn-loop refreshHud) sets
 * coinsEl.textContent unconditionally every call. To make the count-up
 * actually visible we temporarily intercept textContent on the target
 * element so hud.update() can't clobber the rolling value mid-tween.
 * The original accessor is restored when the tween completes. */
let _hudCoinName: string | null = null;
let _hudCoinFrom = 0;
let _hudCoinTo = 0;
let _hudCoinRAF: number | null = null;
let _hudCoinStart = 0;
let _hudTweenEl: HTMLElement | null = null;
let _hudOrigDesc: PropertyDescriptor | null = null;
let _hudTweenActive = false;

function tweenHudCoins(name: string, from: number, to: number): void {
  if (from === to) return;
  _hudCoinName = name;
  _hudCoinFrom = from;
  _hudCoinTo = to;
  _hudCoinStart = performance.now();
  if (_hudCoinRAF) cancelAnimationFrame(_hudCoinRAF);
  _hudCoinRAF = requestAnimationFrame(tweenHudCoinsStep);
}

function tweenHudCoinsStep(): void {
  if (!_hudCoinName) return;
  if (performance.now() - _hudCoinStart > 8_000) {
    _hudCoinName = null;
    _hudCoinRAF = null;
    return;
  }
  const chips = document.querySelectorAll(".ssp-hud-chip");
  for (let i = 0; i < chips.length; i++) {
    const chip = chips[i] as HTMLElement;
    const nameEl = chip.querySelector(".ssp-hud-chip__name") as HTMLElement | null;
    if (nameEl && nameEl.textContent === _hudCoinName) {
      const coinEl = chip.querySelector('[aria-label="coins"]') as HTMLElement | null;
      if (coinEl) {
        _hudCoinName = null;
        _hudCoinRAF = null;
        /* The board HUD is created during the wipe's onCover (inside
         * boardScreen.enter) — but the board isn't visible until the wipe
         * finishes (~250ms). Delay the tween start so the rolling count-up
         * plays out on-screen rather than during the wipe. */
        let settle = 15; // ≈250 ms at 60 fps
        const go = (): void => {
          settle--;
          if (settle > 0) {
            requestAnimationFrame(go);
          } else {
            startCoinTween(coinEl, _hudCoinFrom, _hudCoinTo);
          }
        };
        requestAnimationFrame(go);
        return;
      }
    }
  }
  _hudCoinRAF = requestAnimationFrame(tweenHudCoinsStep);
}

function startCoinTween(el: HTMLElement, from: number, to: number): void {
  const start = performance.now();
  const dur = 500; // <= 0.6s per contract
  const eased = (p: number) => 1 - Math.pow(1 - p, 3);
  let tweenVal = from;
  _hudTweenActive = true;
  _hudTweenEl = el;

  // Temporarily intercept textContent so hud.update()'s unconditional
  // write can't clobber the rolling count-up. Restore on completion.
  let origDesc: PropertyDescriptor | undefined;
  try {
    let proto: object | null = el;
    while ((proto = Object.getPrototypeOf(proto))) {
      const d = Object.getOwnPropertyDescriptor(proto, "textContent");
      if (d && (d.get || d.set)) { origDesc = d; break; }
    }
    _hudOrigDesc = origDesc || null;
    Object.defineProperty(el, "textContent", {
      configurable: true,
      get: () => String(tweenVal),
      set: () => { /* tween owns display during count-up */ },
    });
    // Seed the DOM's underlying text node so the browser paints the starting
    // value (the getter drives reads, but render comes from text nodes).
    el.innerHTML = String(from);
  } catch {
    _hudOrigDesc = null; /* interception unavailable — fall through to direct set */
  }

  const tick = (t: number): void => {
    if (!el.isConnected || !_hudTweenActive) {
      finishTween(el, to);
      return;
    }
    const p = Math.min(1, (t - start) / dur);
    tweenVal = Math.round(from + (to - from) * eased(p));
    // Update the DOM via innerHTML (bypasses our textContent interceptor's
    // no-op setter, creating a real text-node mutation the browser will paint).
    // hud.update()'s writes still hit the no-op textContent setter.
    el.innerHTML = String(tweenVal);
    if (p < 1) {
      requestAnimationFrame(tick);
    } else {
      finishTween(el, to);
    }
  };
  requestAnimationFrame(tick);

  function finishTween(el: HTMLElement, finalVal: number): void {
    _hudTweenActive = false;
    _hudTweenEl = null;
    try {
      if (_hudOrigDesc) Object.defineProperty(el, "textContent", _hudOrigDesc);
      else Reflect.deleteProperty(el, "textContent"); // fall back to prototype accessor
    } catch { /* */ }
    _hudOrigDesc = null;
    el.innerHTML = String(finalVal);
  }
}

/** Cancel any in-flight HUD coin tween and restore the element's
 *  original textContent accessor so the board HUD is fully functional. */
function cancelHudCoinsTween(): void {
  if (_hudCoinRAF) cancelAnimationFrame(_hudCoinRAF);
  _hudCoinRAF = null;
  _hudCoinName = null;
  if (_hudTweenActive && _hudTweenEl && _hudOrigDesc) {
    _hudTweenActive = false;
    try {
      Object.defineProperty(_hudTweenEl, "textContent", _hudOrigDesc);
    } catch { /* */ }
    _hudOrigDesc = null;
    _hudTweenEl = null;
  }
}

/* ------------------------------------------------------------------ */
/*  Screen state                                                       */
/* ------------------------------------------------------------------ */

type MgPhase = "vs-splash" | "countdown" | "play" | "results";

interface MgScreenState {
  _active?: boolean;
  _minigame?: Minigame;
  _ctx?: MinigameContext;
  _chars?: Character[];
  _phase?: MgPhase;
  _countdownT?: number;
  _tick?: number;
  _playT?: number;
  _finished?: boolean;
  _ranking?: number[];
  _resultsT?: number;
  _presented?: boolean;
  _existing?: Set<THREE.Object3D>;
  _present: () => void;
  _beginPlay: () => void;
  _countEl?: HTMLDivElement;
  _flashEl?: HTMLDivElement;
  _ceremony?: ResultsCeremony | null;
  _ceremonyDone?: boolean;
  _onPointerDown?: (e: PointerEvent) => void;
  _onPointerMove?: (e: PointerEvent) => void;
  _onPointerUp?: (e: PointerEvent) => void;
  _onKeyDown?: (e: KeyboardEvent) => void;
  _touch?: TouchPad;
  _vsT?: number;
  _vsSkip?: boolean;
  _vsSeed?: () => number;
  _vsTimer?: number;
  _vsPointerX?: number;
  _vsPointerY?: number;
}

const COUNT_TICKS = ["3", "2", "1"];

// When the pre-screen was already shown (and clicked) while the board was still
// panning for "MINI GAME TIME", the enter() should skip re-showing the card
// and go straight to building the arena so the player "jumps in" after the click.
let skipPreScreen = false;

export function skipNextMinigamePreScreen(): void {
  skipPreScreen = true;
}

function minigameDie(seed: number, turn: number) {
  const mixed = (Math.imul(seed, 0x9e3779b1) ^ Math.imul(turn, 0x85ebca6b)) >>> 0;
  return mulberry32(mixed || 1);
}

const minigameScreenImpl: MgScreenState & Screen = {
  id: "minigame",

  enter() {
    injectMinigameStyles();
    ui.clearScreen();
    this._presented = false;
    this._finished = false;

    // Robustness: no pending entry (or no live match) -> straight back to
    // the board; the turn loop's resume path continues the round.
    // Debug/critic hook: ?minigame=ID forces a specific minigame.
    let entry = consumePendingMinigame();
    const forced = new URLSearchParams(window.location.search).get("minigame");
    if (forced && match.players.length > 0) {
      entry = { id: forced, name: forced };
    }
    if (!entry || match.players.length === 0) {
      screens.goto("board");
      return;
    }

    this._active = true;
    var self = this;
    console.log('[minigameScreen] enter, skipPreScreen=', skipPreScreen, 'entry=', entry);

    if (skipPreScreen) {
      skipPreScreen = false;
      console.log('[minigameScreen] skipping pre-screen, direct build');
      buildArenaAndStart();
      return;
    }

    // --- Mini Game Pre-Screen (as requested) ---
    // Show description + "START MINI GAME". The arena and players are only
    // built AFTER the user clicks, so they "jump in".
    const desc = (entry as any).description || getMinigameDescription(entry.id, entry.name);
    showMinigamePreview(entry.name, desc).then((started) => {
      if (!started) {
        screens.goto("board");
        return;
      }
      buildArenaAndStart();
    });

    function buildArenaAndStart() {
      console.log('[minigameScreen] buildArenaAndStart called');
      // ---- arena inside the SHARED scene (main.ts renders world.scene with
      // world.camera — same contract as the board/showcase screens) ----
      // Snapshot existing children: on exit we sweep everything added since.
      self._existing = new Set(world.scene?.children ?? []);

      const hemi = new THREE.HemisphereLight(0xffffff, 0x2b1d4e, 1.1);
      const key = new THREE.DirectionalLight(0xffffff, 1.5);
      key.position.set(6, 14, 8);
      world.scene?.add(hemi, key);

      // Decorative party floor — the minigame builds the actual arena on top.
      const ground = new THREE.Mesh(
        new THREE.CircleGeometry(13, 48),
        new THREE.MeshBasicMaterial({ color: hex(palette.grassA) })
      );
      ground.rotation.x = -Math.PI / 2;
      ground.position.y = -0.02;
      world.scene?.add(ground);
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(12.6, 13, 48),
        new THREE.MeshBasicMaterial({ color: hex(palette.grassB) })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = -0.01;
      world.scene?.add(ring);

      // ---- the 4 live avatars — players "jump in" only after START is clicked ----
      self._chars = match.players.map((p, i) => {
        const ch = createCharacter(p.kind);
        const x = (i - (match.players.length - 1) / 2) * 2.4;
        ch.group.position.set(x, 0, 5.4);
        ch.setFacing(0);
        ch.anim.idle();
        world.scene?.add(ch.group);
        return ch;
      });

      // ---- arena camera (party angle; minigames may reposition it) ----
      const cam = world.camera!;
      const portrait = window.innerWidth / window.innerHeight < 1;
      const dist = portrait ? 46 : 32;
      const elev = 1.05;
      cam.position.set(0, Math.sin(elev) * dist, Math.cos(elev) * dist);
      cam.lookAt(0, 0.4, 0);

      // ---- countdown + flash overlay elements ----
      const countEl = document.createElement("div");
      countEl.className = "ssp-mg-count";
      document.body.appendChild(countEl);
      self._countEl = countEl;
      const flashEl = document.createElement("div");
      flashEl.className = "ssp-mg-flash";
      document.body.appendChild(flashEl);
      self._flashEl = flashEl;

      // ---- input routing ----
      // Pointer listeners were defined and removed but never attached, so a
      // finger did nothing. Keys were passed raw ("ArrowLeft") while every
      // minigame listens for "left" / "confirm".
      const keyAction = (key: string): string | null => {
        switch (key) {
          case "ArrowUp":
          case "w":
          case "W":
            return "up";
          case "ArrowDown":
          case "s":
          case "S":
            return "down";
          case "ArrowLeft":
          case "a":
          case "A":
            return "left";
          case "ArrowRight":
          case "d":
          case "D":
            return "right";
          case " ":
          case "Enter":
            return "confirm";
          default:
            return null;
        }
      };
      const px = (e: PointerEvent): [number, number] => [
        Math.min(1, Math.max(0, e.clientX / window.innerWidth)),
        Math.min(1, Math.max(0, e.clientY / window.innerHeight)),
      ];
      const onPad = (e: Event): boolean =>
        (e.target as HTMLElement | null)?.closest?.(".ssp-touch") != null;
      self._onPointerDown = (e) => {
        if (onPad(e)) return;
        if (self._phase === "play") {
          const [x, y] = px(e);
          self._ctx?.input.pointer(x, y, true);
        } else if (self._phase === "vs-splash") {
          self._vsSkip = true;
        }
      };
      self._onPointerMove = (e) => {
        if (onPad(e)) return;
        if (self._phase === "play" && (e.buttons & 1)) {
          const [x, y] = px(e);
          self._ctx?.input.pointer(x, y, true);
        }
      };
      self._onPointerUp = (e) => {
        if (onPad(e)) return;
        if (self._phase === "play") {
          const [x, y] = px(e);
          self._ctx?.input.pointer(x, y, false);
        }
      };

      self._onKeyDown = (e: KeyboardEvent) => {
        if ((e.key === " " || e.key === "Enter") && self._phase === "vs-splash") {
          self._vsSkip = true;
        }
        if (self._phase !== "play" || !self._ctx) return;
        const action = keyAction(e.key);
        if (!action) return;
        e.preventDefault();
        self._ctx.input.key(action);
      };
      window.addEventListener("pointerdown", self._onPointerDown);
      window.addEventListener("pointermove", self._onPointerMove);
      window.addEventListener("pointerup", self._onPointerUp);
      window.addEventListener("pointercancel", self._onPointerUp);
      window.addEventListener("keydown", self._onKeyDown);

      self._touch = createTouchPad({
        onSteer: (action) => {
          if (self._phase !== "play") return;
          document.body.dataset.sspSteer = action;
          self._ctx?.input.key(action);
        },
        onAction: () => {
          if (self._phase !== "play") return;
          document.body.dataset.sspAction = "1";
          self._ctx?.input.key("confirm");
        },
      });

      // ---- wire minigame and start (VS splash etc) ----
      const startRound = async () => {
        if (!entry) return;
        const mg = await loadMinigame(entry.id);
        if (!self._active) return;
        if (!mg) {
          screens.goto("board");
          return;
        }
        self._minigame = mg;

        const ctx: MinigameContext = {
          players: match.players.map(p => ({
            id: p.id,
            kind: p.kind,
            name: p.name,
            color: characterColor(p.kind),
          })),
          characters: self._chars ?? [],
          scene: world.scene!,
          camera: world.camera!,
          rng: minigameDie(match.seed, match.turn),
          get time() { return (self as any)._playT ?? 0; },
          announce: (text, opts) => {
            ui.clearFeedback();
            ui.banner(text, { durationMs: opts?.durationMs ?? 1800, sound: opts?.sound === undefined ? null : opts.sound });
          },
          playSfx: (name, opts) => audio.sfx.play(name, opts),
          finish: (ranking) => {
            (self as any)._finished = true;
            (self as any)._ranking = ranking;
          },
          input: {
            pointer: (x, y, down) => {},
            key: (k) => {},
          },
        };
        self._ctx = ctx;

        mg.setup(ctx);

        const themeColor = characterColor(match.players[0]?.kind ?? "pip");
        self._vsT = 0;
        self._vsSkip = false;
        buildVsSplash(self, mg.name, themeColor);
        self._phase = "vs-splash";
        self._countdownT = 0;
        self._tick = -1;
      };
      void startRound();
    }
  },

  update(dt: number) {
    for (const ch of this._chars ?? []) ch.update(dt);

    switch (this._phase) {
      case "vs-splash": {
        this._vsT = (this._vsT ?? 0) + dt;
        // End the splash on timer expiry, skip flag, or after grace delay
        const elapsed = this._vsT ?? 0;
        const canSkip = elapsed >= VS_SKIP_DELAY;
        if (elapsed >= VS_TOTAL || (canSkip && (this._vsSkip))) {
          // Tear down splash, advance to countdown
          const vsRoot = (this as unknown as { _vsRoot?: HTMLDivElement })._vsRoot;
          if (vsRoot?.isConnected) vsRoot.remove();
          (this as unknown as { _vsRoot?: HTMLDivElement })._vsRoot = undefined;
          this._vsTimer = undefined;
          this._phase = "countdown";
          this._countdownT = 0;
          this._tick = -1;
          // Clear the splash banner from the UI queue
          ui.clearFeedback();
        }
        break;
      }
      case "countdown": {
        // 4 equal beats: 3, 2, 1, GO — then play.
        this._countdownT = (this._countdownT ?? 0) + dt;
        const tick = Math.min(4, Math.floor((this._countdownT ?? 0) / (settings.minigameCountdown / 4)));
        if (tick !== this._tick) {
          this._tick = tick;
          if (tick < 3) {
            const el = this._countEl;
            if (el) {
              el.textContent = COUNT_TICKS[tick];
              el.classList.remove("ssp-mg-count--pop", "ssp-mg-count--go");
              void el.offsetHeight;
              el.classList.add("ssp-mg-count--pop");
            }
            audio.sfx.play("minigame.count");
          } else {
            const el = this._countEl;
            if (el) {
              el.textContent = "GO!";
              el.classList.remove("ssp-mg-count--pop");
              el.classList.add("ssp-mg-count--pop", "ssp-mg-count--go");
            }
            audio.sfx.play("minigame.go");
            const flash = this._flashEl;
            if (flash) {
              flash.style.background = palette.mint;
              try {
                flash.animate(
                  [{ opacity: 0 }, { opacity: 0.5, offset: 0.25 }, { opacity: 0 }],
                  { duration: 500, easing: "ease-out" }
                );
              } catch {
                flash.style.opacity = "0";
              }
            }
          }
        }
        if (tick >= 4) this._beginPlay();
        break;
      }
      case "play": {
        this._playT = (this._playT ?? 0) + dt;
        if (!this._finished) {
          this._minigame?.update(dt);
          // Safety net: a minigame that never calls finish must not hang
          // the match. Deterministic fallback ranking (player id order).
          if (!this._finished && (this._playT ?? 0) > settings.minigameTimeLimit) {
            this._finished = true;
            this._ranking = match.players.map((p) => p.id).sort((a, b) => a - b);
            console.warn("[minigames] time limit reached — forced finish");
          }
        }
        if (this._finished && this._ranking) {
          this._phase = "results";
          this._touch?.hide();
          this._resultsT = 0.6; // short winner-reveal beat
        }
        break;
      }
      case "results": {
        this._resultsT = (this._resultsT ?? 0) - dt;
        // Tick the ceremony (banner/coins/confetti/card timeline).
        this._ceremony?.update(dt);
        if ((this._resultsT ?? 0) <= 0) {
          if (!this._presented) {
            this._presented = true;
            this._present();
          } else if (this._ceremony?.isDone() && !this._ceremonyDone) {
            this._ceremonyDone = true;
            screens.goto("board");
            return;
          }
        }
        break;
      }
      default:
        break;
    }
  },

  render() {},

  /** RESULTS beat: payout + full MP7-style ceremony (runs once). */
  _present() {
    this._presented = true;
    this._ceremonyDone = false;
    cancelHudCoinsTween(); // clean up any stale tween from a previous minigame

    const ranking = this._ranking ?? [];
    const winner = ranking[0] ?? match.players[0]?.id ?? 0;
    const mg = this._minigame;

    // Read the TRUE payout the economy awards — never hardcode 10.
    const coinsBefore = playerCoins(winner);
    minigamePayout(winner);
    const coinsAfter = playerCoins(winner);
    const payout = coinsAfter - coinsBefore;

    const winnerPlayer = match.players[winner];
    if (winnerPlayer) winnerPlayer.minigameWins += 1;
    bus.emit("minigame:end", { id: mg?.id ?? "?", winner, coins: payout });

    // Schedule a rolling count-up on the board's coin chip when the board
    // reappears (its HUD is destroyed during the ceremony).
    if (payout !== 0 && winnerPlayer) {
      tweenHudCoins(winnerPlayer.name, coinsBefore, coinsAfter);
    }

    // Crowd cheer via the existing bus hook (minigame:end wired in crowd.ts).
    audio.music.play("win", { intensity: 0.9 });

    // Start the ceremony (camera + podium + banner + coins + confetti + card).
    this._ceremony = startResultsCeremony({
      chars: this._chars ?? [],
      ranking,
      winner,
      coins: payout,
      minigameName: mg?.name ?? "MINIGAME",
    });
  },

  /** GO! — play begins: minigame music (rng-picked) + minigame:start. */
  _beginPlay() {
    this._phase = "play";
    this._playT = 0;
    // Clear the GO! countdown overlay so it never overlaps play or results.
    const el = this._countEl;
    if (el) {
      el.classList.add("ssp-mg-count--out");
      window.setTimeout(() => el.remove(), 250);
      this._countEl = undefined;
    }
    const flash = this._flashEl;
    if (flash) {
      flash.style.opacity = "0";
      this._flashEl = undefined;
    }
    // MP7-style: vary minigame music by genre. Action genres (survival,
    // race, timing, target, collect) get the high-energy minigame_a; puzzle
    // / memory / rhythm genres get the quirky comedic minigame_b.
    const actionGenres = new Set(["survival", "race", "timing", "target", "collect"]);
    const mgGenre = this._minigame?.genre ?? "race";
    const track = actionGenres.has(mgGenre) ? "minigame_a" : "minigame_b";
    audio.music.play(track, { intensity: 1 });
    this._touch?.show();
    const mg = this._minigame;
    if (mg) bus.emit("minigame:start", { id: mg.id, name: mg.name });
  },

  exit() {
    this._active = false;
    // Destroy ceremony first (removes podium, DOM, restores characters).
    this._ceremony?.destroy();
    this._ceremony = null;
    this._ceremonyDone = false;
    // VS splash cleanup: remove DOM, clear timer
    if (this._vsTimer) {
      window.clearTimeout(this._vsTimer);
      this._vsTimer = undefined;
    }
    const vsRoot = (this as unknown as { _vsRoot?: HTMLDivElement })._vsRoot;
    if (vsRoot?.isConnected) vsRoot.remove();
    (this as unknown as { _vsRoot?: HTMLDivElement })._vsRoot = undefined;
    this._minigame?.teardown();
    this._minigame = undefined;
    this._ctx = undefined;
    for (const ch of this._chars ?? []) {
      world.scene?.remove(ch.group);
      ch.dispose();
    }
    this._chars = undefined;
    // Sweep everything added since enter (lights, floor, arena objects,
    // anything a minigame forgot to remove in teardown).
    const existing = this._existing;
    if (existing && world.scene) {
      for (const obj of [...world.scene.children]) {
        if (!existing.has(obj)) {
          world.scene.remove(obj);
          disposeObj(obj);
        }
      }
    }
    this._existing = undefined;
    this._countEl?.remove();
    this._countEl = undefined;
    this._flashEl?.remove();
    this._flashEl = undefined;
    if (this._onPointerDown) window.removeEventListener("pointerdown", this._onPointerDown);
    if (this._onPointerMove) window.removeEventListener("pointermove", this._onPointerMove);
    if (this._onPointerUp) {
      window.removeEventListener("pointerup", this._onPointerUp);
      window.removeEventListener("pointercancel", this._onPointerUp);
    }
    if (this._onKeyDown) window.removeEventListener("keydown", this._onKeyDown);
    this._touch?.destroy();
    this._touch = undefined;
    this._onPointerDown = undefined;
    this._onPointerMove = undefined;
    this._onPointerUp = undefined;
    this._onKeyDown = undefined;
    this._phase = undefined;
    ui.clearScreen();
    audio.music.stop(0.3);
  },
};

export function getMinigameDescription(id: string, name: string): string {
  const map: Record<string, string> = {
    balloon_pop: "Pop balloons before they float away! Quick reflexes win big points.",
    bumper_balls: "Bump other players out of the shrinking ring. Last one standing wins!",
    cake_dash: "Race through the obstacle course. Avoid the forks and be first to the finish!",
    coin_cannon: "Aim and fire coins into the moving baskets. Most coins in the basket wins.",
    coin_grab: "Grab as many coins as you can before time runs out. Watch out for the others!",
    drum_solo: "Hit the drums in time with the beat. Perfect timing scores the most points.",
    memory_match: "Flip cards and find the matches. Memory is key to victory.",
    pipe_puzzle: "Guide the water through the pipes to the exit. Solve it fast!",
    push_of_war: "Push the crate to the other team's side! Teamwork and strength matter here.",
  };
  return map[id] || `Play ${name} and show your skills!`;
}

export async function showMinigamePreview(name: string, description: string): Promise<boolean> {
  return new Promise((resolve) => {
    const root = document.createElement("div");
    root.style.cssText = "position:fixed;inset:0;z-index:95;background:rgba(43,29,78,0.35);display:flex;align-items:center;justify-content:center;font-family:Fredoka,sans-serif;box-sizing:border-box;padding:calc(12px + env(safe-area-inset-top, 0px)) 12px calc(12px + env(safe-area-inset-bottom, 0px));";
    root.innerHTML = `
      <div style="background:${palette.ink};border:5px solid ${palette.cream};border-radius:20px;padding:20px 16px;width:min(92vw, 420px);max-height:calc(100dvh - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px) - 24px);overflow-y:auto;box-sizing:border-box;text-align:center;box-shadow:0 8px 0 ${palette.ink};">
        <div style="font-size:clamp(26px, 8vw, 44px);font-weight:700;color:${palette.sun};margin-bottom:4px;line-height:1.05;text-shadow:0 3px 0 ${palette.ink};">MINI GAME TIME!</div>
        <div style="font-size:clamp(22px, 6vw, 34px);font-weight:700;color:${palette.cream};margin-bottom:8px;line-height:1.1;">${name}</div>
        <div style="color:${palette.cream};font-size:17px;line-height:1.4;margin-bottom:18px;">${description}</div>
        <div style="color:${palette.cream};opacity:0.75;font-size:14px;margin-bottom:16px;">Get ready, then start.</div>
        <button id="mg-start-btn" style="background:${palette.sunDeep};color:${palette.ink};border:4px solid ${palette.ink};border-radius:14px;padding:14px 20px;min-height:56px;width:100%;font-size:22px;font-weight:700;cursor:pointer;touch-action:manipulation;font-family:inherit;">START MINI GAME</button>
      </div>
    `;
    document.body.appendChild(root);

    const btn = root.querySelector("#mg-start-btn") as HTMLButtonElement;
    btn.onclick = () => {
      root.remove();
      resolve(true);
    };

    // Allow clicking outside or escape as cancel (back to board)
    root.onclick = (e) => {
      if (e.target === root) {
        root.remove();
        resolve(false);
      }
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        window.removeEventListener("keydown", onEsc);
        root.remove();
        resolve(false);
      }
    };
    window.addEventListener("keydown", onEsc, { once: true });
  });
}

export const minigameScreen = minigameScreenImpl as Screen;
