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
 *
 * Determinism: the only rng consumed here is the music-track pick at GO
 * (gameplay rng via src/core/rng). Countdown/results timing is dt-driven;
 * no Math.random/Date.now/performance.now anywhere in the flow.
 */
import * as THREE from "three";
import { world } from "../main";
import { palette, hex } from "../config/palette";
import { settings } from "../config/settings";
import { match } from "../core/game";
import { rng, mulberry32 } from "../core/rng";
import { bus } from "../core/events";
import { audio } from "../audio/audioEngine";
import { ui } from "../ui/kit";
import { characterColor } from "../characters/roster";
import { createCharacter, type Character } from "../characters/characterFactory";
import { minigamePayout } from "../game/economy";
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
  _vsT?: number;
  _vsSkip?: boolean;
  _vsSeed?: () => number;
  _vsTimer?: number;
  _vsPointerX?: number;
  _vsPointerY?: number;
}

const COUNT_TICKS = ["3", "2", "1"];

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

    // ---- arena inside the SHARED scene (main.ts renders world.scene with
    // world.camera — same contract as the board/showcase screens) ----
    // Snapshot existing children: on exit we sweep everything added since.
    this._existing = new Set(world.scene?.children ?? []);

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

    // ---- the 4 live avatars, lined up facing the arena centre ----
    this._chars = match.players.map((p, i) => {
      const ch = createCharacter(p.kind);
      const x = (i - (match.players.length - 1) / 2) * 2.4;
      ch.group.position.set(x, 0, 5.4);
      ch.setFacing(Math.PI); // front is +Z; the arena centre is -Z from here
      ch.anim.idle();
      world.scene?.add(ch.group);
      return ch;
    });

    // ---- arena camera (party angle; minigames may reposition it) ----
    const cam = world.camera!;
    const portrait = window.innerWidth / window.innerHeight < 1;
    const dist = portrait ? 46 : 32;
    const elev = 1.05; // ~60deg
    cam.position.set(0, Math.sin(elev) * dist, Math.cos(elev) * dist);
    cam.lookAt(0, 0.4, 0);

    // ---- countdown + flash overlay elements ----
    const countEl = document.createElement("div");
    countEl.className = "ssp-mg-count";
    document.body.appendChild(countEl);
    this._countEl = countEl;
    const flashEl = document.createElement("div");
    flashEl.className = "ssp-mg-flash";
    document.body.appendChild(flashEl);
    this._flashEl = flashEl;

    // ---- input routing: pointer (normalized 0..1) + keyboard actions ----
    const px = (e: PointerEvent): [number, number] => [
      Math.min(1, Math.max(0, e.clientX / window.innerWidth)),
      Math.min(1, Math.max(0, e.clientY / window.innerHeight)),
    ];
    this._onPointerDown = (e) => {
      if (this._phase === "play") {
        const [x, y] = px(e);
        this._ctx?.input.pointer(x, y, true);
      } else if (this._phase === "vs-splash") {
        // Skip the splash after the grace period — real-player courtesy only
        this._vsSkip = true;
      }
    };
    this._onPointerMove = (e) => {
      if (this._phase === "play") {
        const [x, y] = px(e);
        this._ctx?.input.pointer(x, y, false);
      }
    };
    this._onPointerUp = (e) => {
      if (this._phase === "play") {
        const [x, y] = px(e);
        this._ctx?.input.pointer(x, y, false);
      }
    };
    this._onKeyDown = (e) => {
      if (this._phase !== "play") return;
      const k = e.key;
      let action: string | null = null;
      if (k === "ArrowUp" || k === "w" || k === "W") action = "up";
      else if (k === "ArrowDown" || k === "s" || k === "S") action = "down";
      else if (k === "ArrowLeft" || k === "a" || k === "A") action = "left";
      else if (k === "ArrowRight" || k === "d" || k === "D") action = "right";
      else if (k === " " || k === "Enter") action = "confirm";
      if (action) {
        e.preventDefault();
        this._ctx?.input.key(action);
      }
    };
    window.addEventListener("pointerdown", this._onPointerDown);
    window.addEventListener("pointermove", this._onPointerMove);
    window.addEventListener("pointerup", this._onPointerUp);
    window.addEventListener("keydown", this._onKeyDown);

    // ---- VS splash: play intro sting + build overlay BEFORE countdown ----
    audio.music.play("minigame_intro", { intensity: 0.8 });
    const startRound = async (): Promise<void> => {
      const mg = await loadMinigame(entry.id);
      if (!this._active) return; // exited while loading
      if (!mg) {
        screens.goto("board");
        return;
      }
      this._minigame = mg;

      const self = this;
      const ctx: MinigameContext = {
        players: match.players.map((p) => ({
          id: p.id,
          kind: p.kind,
          name: p.name,
          color: characterColor(p.kind),
        })),
        characters: self._chars ?? [],
        scene: world.scene!,
        camera: world.camera!,
        rng: () => rng.next(),
        get time(): number {
          return self._playT ?? 0;
        },
        announce: (text, opts) => {
          ui.banner(text, {
            durationMs: opts?.durationMs ?? 1800,
            sound: opts?.sound === undefined ? null : opts.sound,
          });
        },
        playSfx: (name, opts) => audio.sfx.play(name, opts),
        finish: (ranking) => {
          if (self._finished || self._phase !== "play") return;
          const cleaned = cleanRanking(ranking);
          if (cleaned.length === 0) return;
          self._finished = true;
          self._ranking = cleaned;
        },
        input: {
          pointer: () => {},
          key: () => {},
        },
      };
      this._ctx = ctx;

      mg.setup(ctx); // build the arena (splash + countdown overlay it)

      // Determine theme color from the human's character for the title accent
      const themeColor = characterColor(match.players[0]?.kind ?? "pip");

      // Build the VS splash overlay — runs for ~1.7s BEFORE the countdown
      this._vsT = 0;
      this._vsSkip = false;
      buildVsSplash(self, mg.name, themeColor);
      this._phase = "vs-splash";
      this._countdownT = 0;
      this._tick = -1;
    };
    void startRound();
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

    const ranking = this._ranking ?? [];
    const winner = ranking[0] ?? match.players[0]?.id ?? 0;
    const coins = settings.minigameWinCoins;
    const mg = this._minigame;

    // Payout + match bookkeeping (economy logic stays in economy.ts).
    minigamePayout(winner);
    const winnerPlayer = match.players[winner];
    if (winnerPlayer) winnerPlayer.minigameWins += 1;
    bus.emit("minigame:end", { id: mg?.id ?? "?", winner, coins });

    // Crowd cheer via the existing bus hook (minigame:end wired in crowd.ts).
    audio.music.play("win", { intensity: 0.9 });

    // Start the ceremony (camera + podium + banner + coins + confetti + card).
    this._ceremony = startResultsCeremony({
      chars: this._chars ?? [],
      ranking,
      winner,
      coins,
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
    if (this._onPointerUp) window.removeEventListener("pointerup", this._onPointerUp);
    if (this._onKeyDown) window.removeEventListener("keydown", this._onKeyDown);
    this._onPointerDown = undefined;
    this._onPointerMove = undefined;
    this._onPointerUp = undefined;
    this._onKeyDown = undefined;
    this._phase = undefined;
    ui.clearScreen();
    audio.music.stop(0.3);
  },
};

export const minigameScreen = minigameScreenImpl as Screen;
