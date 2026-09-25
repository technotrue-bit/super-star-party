/**
 * SUPER STAR PARTY — board screen (replaces the wave-0 placeholder; same
 * filename + export so src/main.ts keeps working).
 *
 * Owns: the Fizzy Fairground scene, the 4 characters, the party HUD + ROLL
 * button, the big DOM die, the item bar, the Grumpus flash overlay, and the
 * party camera (whole board INCLUDING corner landmarks in frame, no dead
 * band at the top, pitch ~55deg, slow breathing, punch-in on rolls). The
 * turn loop (src/game/turnLoop.ts) owns the match phase machine; this
 * screen just feeds it the world + UI handles every frame.
 */
import * as THREE from "three";
import { world } from "../main";
import { palette } from "../config/palette";
import { settings } from "../config/settings";
import { match, startMatch } from "../core/game";
import { rng } from "../core/rng";
import { bus } from "../core/events";
import { roster } from "../characters/roster";
import { audio } from "../audio/audioEngine";
import { ui, queue } from "../ui/kit";
import { setAutoplay } from "../core/debug";
import { isAutoplay } from "../core/debug";
import { buildBoardScene, boardBounds, type BoardScene } from "../board/boardScene";
import { fizzyFairground } from "../board/boardData";
import { createCharacter, type Character } from "../characters/characterFactory";
import { createTurnLoop, PLAYER_OFFSETS, type DiceView, type TurnLoop } from "../game/turnLoop";
import { createDie3d, type Die3DHandle } from "../ui/die3d";
import { createPauseOverlay, makePauseButton } from "./pauseMenu";
import type { PauseOverlayHandle } from "./pauseMenu";
import type { Screen } from "./screenManager";
import { screens } from "./screenManager";
import { openShop } from "./shopScreen";

/* ------------------------------------------------------------------ */
/*  Scoped styles (injected once; every color from the palette)        */
/* ------------------------------------------------------------------ */

let stylesInjected = false;

function injectBoardStyles(): void {
  if (stylesInjected) return;
  stylesInjected = true;
  if (document.getElementById("ssp-board-styles")) return;
  const style = document.createElement("style");
  style.id = "ssp-board-styles";
  style.textContent = `
/* The wrap stays STABLE for clickability — pulse is a non-layout glow on the
   inner button (.ssp-roll-pulse), never on the hit target itself. Playwright's
   actionability check (stable bounding box) and a real finger both succeed. */
.ssp-roll-wrap { position:fixed; left:50%; bottom:calc(22px + env(safe-area-inset-bottom, 0px)); transform:translateX(-50%); z-index:89; }
.ssp-roll-pulse { animation:sspRollPulse 1.15s ease-in-out infinite; }
@keyframes sspRollPulse { 0%,100% { filter:brightness(1); } 50% { filter:brightness(1.18); } }
.ssp-item-bar { position:fixed; left:50%; bottom:118px; transform:translateX(-50%); display:flex; gap:10px; z-index:63; }
.ssp-die { position:fixed; left:50%; top:32%; transform:translateX(-50%); width:104px; height:104px; border-radius:24px; background:${palette.cream}; border:5px solid ${palette.ink}; box-shadow:7px 7px 0 ${palette.ink}; display:flex; align-items:center; justify-content:center; z-index:90; }
.ssp-die__face { font-size:52px; font-weight:700; color:${palette.ink}; user-select:none; line-height:1; }
.ssp-die--tumble { animation:sspDieTumble .8s ease-in-out infinite; }
@keyframes sspDieTumble {
  0% { transform:translateX(-50%) rotate(0deg) translateY(0); }
  15% { transform:translateX(-50%) rotate(-16deg) translateY(-14px); }
  30% { transform:translateX(-50%) rotate(12deg) translateY(0); }
  45% { transform:translateX(-50%) rotate(-10deg) translateY(-10px); }
  60% { transform:translateX(-50%) rotate(8deg) translateY(2px); }
  80% { transform:translateX(-50%) rotate(-5deg) translateY(-5px); }
  100% { transform:translateX(-50%) rotate(0deg) translateY(0); }
}
.ssp-die--slam { animation:sspDieSlam .34s cubic-bezier(.2,1.6,.4,1); }
@keyframes sspDieSlam { 0% { transform:translateX(-50%) scale(1.45) rotate(8deg); } 60% { transform:translateX(-50%) scale(0.94); } 100% { transform:translateX(-50%) scale(1); } }
.ssp-pause-fab { position:fixed; top:14px; right:14px; z-index:65; width:54px; height:54px; border-radius:50%; font-size:24px; display:flex; align-items:center; justify-content:center; background:linear-gradient(180deg, rgba(255,255,255,.4) 0%, rgba(255,255,255,0) 40%), linear-gradient(180deg, ${palette.cream} 0%, ${palette.creamShadow} 100%); border:4px solid ${palette.ink}; color:${palette.ink}; box-shadow:0 5px 0 ${palette.ink}; cursor:pointer; transition:transform .1s cubic-bezier(.34,1.56,.64,1), box-shadow .1s ease-out; }
.ssp-pause-fab:hover { transform:scale(1.08); }
.ssp-pause-fab:active { transform:scale(0.94) translateY(3px); box-shadow:0 2px 0 ${palette.ink}; }
.ssp-flash { position:fixed; inset:0; pointer-events:none; z-index:99999; opacity:0; }
.ssp-podium { display:flex; flex-direction:column; gap:8px; max-height:44vh; overflow-y:auto; text-align:left; font-size:16px; }
.ssp-podium__row { background:${palette.cream}; border:3px solid ${palette.ink}; border-radius:14px; padding:8px 12px; box-shadow:0 3px 0 ${palette.ink}; }
.ssp-podium__row--win { background:${palette.sun}; font-weight:700; }
`;
  document.head.appendChild(style);
}

/* ------------------------------------------------------------------ */
/*  Party camera                                                       */
/* ------------------------------------------------------------------ */

interface CamFit {
  base: THREE.Vector3;
  look: THREE.Vector3;
}

/**
 * Fit the WHOLE board + scenery for the current aspect:
 * - scenery pad ~5.2u beyond the space-loop bounds (tents ~2.9u, ferris
 *   wheel ~4.2u) so corner landmarks never clip;
 * - distance = fit * distMul (fit = max bounds + pad), elevation per aspect;
 * - the camera shoots from the NORTH in landscape (ferris wheel in the near
 *   foreground, big + face-on; its wheel faces +/-z so only a north/south
 *   camera reads it), and from the classic SOUTH in portrait;
 * - lookAt biased toward the ferris corner so the signature landmark stays
 *   readable, with the board center projecting near the screen center.
 */
function computeCameraFit(): CamFit {
  const b = boardBounds();
  const aspect = window.innerWidth / window.innerHeight;
  const portrait = aspect < 1;
  const cam = settings.matchCamera;

  const fitX = b.maxX - b.minX + cam.sceneryPad * 2;
  const fitZ = b.maxY - b.minY + cam.sceneryPad * 2;
  const fit = Math.max(fitX, fitZ);

  const cx = (b.minX + b.maxX) / 2;
  const cz = (b.minY + b.maxY) / 2;

  const elev = portrait ? cam.elevPortrait : cam.elevLandscape;
  const m = fit * (portrait ? cam.distMulPortrait : cam.distMulLandscape);
  const H = m * Math.sin(elev);
  const D = m * Math.cos(elev);

  // North in landscape (ferris near + face-on), south in portrait; the
  // landscape camera sits slightly east of the board axis so the grass's far
  // edge exits the frame side (no sky wedge in the top strip).
  const base = new THREE.Vector3(cx + (portrait ? 0 : cam.camXLandscape), H, cz + (portrait ? D : -D));
  const look = new THREE.Vector3(
    cx + (portrait ? cam.lookXPortrait : cam.lookXLandscape),
    0,
    cz + (portrait ? cam.lookZPortrait : cam.lookZLandscape)
  );
  return { base, look };
}

interface Punch {
  pos: THREE.Vector3;
  look: THREE.Vector3;
  t: number;
}

/* ------------------------------------------------------------------ */
/*  Screen state                                                       */
/* ------------------------------------------------------------------ */

interface BoardScreenState {
  _board?: BoardScene;
  _chars?: Character[];
  _hud?: ReturnType<typeof ui.hud>;
  _loop?: TurnLoop;
  _rollWrap?: HTMLDivElement;
  _rollBtn?: ReturnType<typeof ui.button>;
  _itemBar?: HTMLDivElement;
  _die?: HTMLDivElement;
  _die3d?: Die3DHandle;
  _dieFace?: HTMLDivElement;
  _flash?: HTMLDivElement;
  _cam?: CamFit;
  _punch?: Punch | null;
  _t?: number;
  _onResize?: () => void;
  _pauseBtn?: { el: HTMLButtonElement; destroy: () => void };
  _pause?: PauseOverlayHandle;
  _onPauseKey?: (e: KeyboardEvent) => void;
  _unfreezeAutoplay?: boolean;
  _finaleShown?: boolean;
  _unsubs: Array<() => void>;
  _openPause: () => void;
  _closePause: () => void;
}

function projectToScreen(pos: THREE.Vector3): { x: number; y: number } | null {
  const cam = world.camera;
  if (!cam) return null;

  // Three.js updates camera.matrixWorldInverse inside renderer.render().
  // Callers fire during screens.update() (BEFORE render), so on the first
  // frame it is identity and on subsequent frames it is one frame behind —
  // projecting points far off-screen (x ≈ -193px on a 390px viewport).
  // Fix: refresh the matrix before projecting.
  cam.updateMatrixWorld();
  cam.matrixWorldInverse.copy(cam.matrixWorld).invert();

  const v = pos.clone().project(cam);

  // Guard: return null for off-screen / behind-camera points so callers
  // can skip rather than pile up invisible DOM nodes.
  if (v.z < -1 || v.z > 1 || v.x < -1.5 || v.x > 1.5 || v.y < -1.5 || v.y > 1.5) {
    return null;
  }

  return {
    x: (v.x * 0.5 + 0.5) * window.innerWidth,
    y: (-v.y * 0.5 + 0.5) * window.innerHeight,
  };
}

const boardScreenImpl: BoardScreenState & Screen = {
  id: "board",
  _unsubs: [],

  enter() {
    injectBoardStyles();
    ui.clearScreen();
    this._t = 0;
    this._punch = null;
    this._finaleShown = false; // a fresh board entry can reach the finale again (rematch)

    // ---- match: start a default one when nothing is running (URL-direct) ----
    const params = new URLSearchParams(window.location.search);
    if (match.players.length === 0) {
      const seed = Number(params.get("seed") ?? "1");
      startMatch(
        roster.map((c) => c.key),
        roster.map((c) => c.name)
      );
      rng.reset(seed); // startMatch reseeds internally — re-seed for the URL
      match.seed = seed;
    }
    if (params.get("autoplay") === "1") {
      setAutoplay(true);
    }
    bus.emit("match:start", { seed: match.seed, players: match.players.map((p) => p.id) });

    // ---- board ----
    const board = buildBoardScene(fizzyFairground);
    this._board = board;

    // 3D pipped die — arcs, tumbles, lands on the sim's face.
    // Falls back to the DOM die if the 3D die throws.
    try {
      this._die3d = createDie3d(world.scene!, world.camera!, board);
    } catch (e) {
      console.error("[SSP] 3D die failed, falling back to DOM die:", e);
      this._die3d = undefined;
    }

    // North-side party camera in landscape: the disk icons (designed to read
    // upright from the south) get a 180deg in-plane flip so they stay upright.
    if (window.innerWidth / window.innerHeight >= 1) {
      for (let i = 0; i < fizzyFairground.spaces.length; i++) {
        for (const c of board.spaceMesh(i).children) {
          if (c instanceof THREE.Mesh && Math.abs(c.rotation.y - Math.PI / 2) < 1e-4) {
            c.rotation.y = -Math.PI / 2;
          }
        }
      }
    }

    // ---- characters at space 0 (2x2 stand-off grid) ----
    const start = board.spaceWorldPos(0);
    this._chars = match.players.map((p, i) => {
      const off = PLAYER_OFFSETS[i] ?? [0, 0];
      const ch = createCharacter(p.kind);
      ch.group.position.set(start.x + off[0], 0, start.z + off[1]);
      ch.group.scale.setScalar(0.92);
      ch.setFacing(Math.PI / 4 + i);
      ch.anim.idle();
      world.scene?.add(ch.group);
      return ch;
    });

    // ---- HUD ----
    const hud = ui.hud();
    this._hud = hud;

    // ---- ROLL button (gold, pulsing — pulse is an inner glow so the
    // ---- wrap stays a STABLE hit target for automation and real fingers)
    const rollWrap = document.createElement("div");
    rollWrap.className = "ssp-roll-wrap";
    const rollBtn = ui.button({
      label: "ROLL!",
      kind: "gold",
      size: "lg",
      ariaLabel: "Roll the dice",
      onClick: () => this._loop?.rollPressed(),
    });
    rollBtn.el.classList.add("ssp-roll-pulse");
    rollWrap.appendChild(rollBtn.el);
    document.body.appendChild(rollWrap);
    this._rollWrap = rollWrap;
    this._rollBtn = rollBtn;

    // ---- pause button (top-right corner, MP7-style) ----
    const pauseBtn = makePauseButton(() => {
      if (this._pause && !this._pause.isOpen()) this._openPause();
    });
    document.body.appendChild(pauseBtn.el);
    this._pauseBtn = pauseBtn;

    // ---- pause overlay (lives over the board, freezes on open) ----
    this._pause = createPauseOverlay({
      onResume: () => this._closePause(),
      onQuit: () => {
        this._pause?.close();
        this._unfreezeAutoplay = false;
        this.exit();
        screens.goto("title");
      },
    });

    // ---- keyboard: Escape and P toggle the pause overlay ----
    this._onPauseKey = (e: KeyboardEvent) => {
      if (!this._pause) return;
      if (e.key === "Escape" || e.key === "p" || e.key === "P") {
        e.preventDefault();
        if (this._pause.isOpen()) {
          this._closePause();
        } else {
          this._openPause();
        }
      }
    };
    window.addEventListener("keydown", this._onPauseKey);

    // ---- item bar (pre-roll items for the human) ----
    const itemBar = document.createElement("div");
    itemBar.className = "ssp-item-bar";
    document.body.appendChild(itemBar);
    this._itemBar = itemBar;

    // ---- big DOM die ----
    const die = document.createElement("div");
    die.className = "ssp-die";
    die.style.display = "none";
    const dieFace = document.createElement("div");
    dieFace.className = "ssp-die__face";
    dieFace.textContent = "?";
    die.appendChild(dieFace);
    document.body.appendChild(die);
    this._die = die;
    this._dieFace = dieFace;

    const diceView: DiceView = {
      show() {
        die.style.display = "flex";
      },
      hide() {
        die.style.display = "none";
        die.classList.remove("ssp-die--tumble", "ssp-die--slam");
        dieFace.textContent = "?";
      },
      tumble() {
        dieFace.textContent = "?";
        die.classList.remove("ssp-die--slam");
        die.classList.add("ssp-die--tumble");
      },
      setFace(n: number) {
        die.classList.remove("ssp-die--tumble");
        dieFace.textContent = String(n);
        die.classList.add("ssp-die--slam");
        try {
          dieFace.animate(
            [
              { transform: "scale(2.2) rotate(-14deg)", opacity: 0.2 },
              { transform: "scale(0.92)", opacity: 1, offset: 0.6 },
              { transform: "scale(1.06) rotate(3deg)", offset: 0.8 },
              { transform: "scale(1) rotate(0deg)" },
            ],
            { duration: 340, easing: "cubic-bezier(.2,1.4,.4,1)" }
          );
        } catch {
          /* WAAPI unavailable — die still lands */
        }
      },
    };

    // ---- Grumpus lava flash overlay ----
    const flash = document.createElement("div");
    flash.className = "ssp-flash";
    document.body.appendChild(flash);
    this._flash = flash;

    /* A red-space STING, not a red screen: snap to peak, then fade over ~0.42s.
       Wall-clock timed (game dt is useless here: at speed=2 it expires in ~4 frames), and
       mirrored to __SSP_FLASH so a probe can verify the timeline without racing
       Playwright's screenshot stall, which cannot catch a sub-500ms flash. */
    const STING_PEAK = 0.62;
    const STING_DUR = 420;
    const stingFlash = (color: string) => {
      if (!flash) return;
      flash.style.background = color;
      flash.style.transition = "none";
      flash.style.opacity = String(STING_PEAK);
      (globalThis as any).__SSP_FLASH = { at: performance.now(), peak: STING_PEAK, dur: STING_DUR };
      requestAnimationFrame(() => {
        flash.style.transition = `opacity ${STING_DUR}ms ease-out`;
        flash.style.opacity = "0";
      });
      window.setTimeout(() => {
        flash.style.opacity = "0";
        flash.style.background = "";
        (globalThis as any).__SSP_FLASH = null;
      }, STING_DUR + 220);
    };

    // ---- camera: fit for the current aspect, then drive the loop ----
    this._cam = computeCameraFit();
    const cam = world.camera!;
    cam.position.copy(this._cam.base);
    cam.lookAt(this._cam.look);

    const onResize = (): void => {
      if (this._cam) this._cam = computeCameraFit();
    };
    window.addEventListener("resize", onResize);
    this._onResize = onResize;

    // ---- feedback wiring: route HUD banners through the queue, ----
    // ---- listen for coin changes + happenings + star buys.    ----
    this._unsubs = [];
    const suppressNextBanner = { current: false };
    const queuedHud = {
      ...hud,
      showBanner: (text: string, opts?: { durationMs?: number }) => {
        if (suppressNextBanner.current) {
          suppressNextBanner.current = false;
          return { el: document.createElement("div"), destroy() {} };
        }
        return queue.banner(text, { durationMs: opts?.durationMs });
      },
    };
    const charPos = (pid: number): THREE.Vector3 => {
      const off = PLAYER_OFFSETS[pid] ?? [0, 0];
      const v = board.spaceWorldPos(match.players[pid]?.space ?? 0);
      v.x += off[0];
      v.z += off[1];
      return v;
    };
    this._unsubs.push(
      bus.on("coins:change", ({ player, delta }) => {
        if (delta === 0) return;
        const pos = charPos(player);
        const sc = projectToScreen(pos);
        if (sc) {
          ui.showFloatingNumber(sc.x, sc.y - 30, delta);
        }
      })
    );
    this._unsubs.push(
      bus.on("happening:event", ({ player, label, eventId }) => {
        suppressNextBanner.current = true;
        const isGrumpus = eventId.startsWith("grumpus");
        queue.happening(label, {
          durationMs: 1900,
          kind: isGrumpus ? "grumpus" : "green",
        });
      })
    );
    this._unsubs.push(
      bus.on("star:buy", ({ player }) => {
        const pos = charPos(player);
        const sc = projectToScreen(pos);
        if (sc) ui.showFloatingNumber(sc.x, sc.y - 30, -settings.starCost);
      })
    );

    // ---- turn loop ----
    this._loop = createTurnLoop({
      board,
      chars: this._chars,
      hud: queuedHud,
      rollButton: rollBtn,
      dice: this._die3d ?? diceView,
      itemBar,
      punchCamera: (target: THREE.Vector3) => {
        if (!this._cam) return;
        const dir = this._cam.base.clone().sub(target);
        const dist = dir.length();
        dir.normalize();
        this._punch = {
          pos: this._cam.base.clone().add(dir.multiplyScalar(dist * 0.14)),
          look: this._cam.look.clone().lerp(target, 0.35),
          t: 0,
        };
      },
      ceremony: {
        focusCamera: (target: THREE.Vector3, intensity: number) => {
          // Punch toward target; intensity scales the punch distance.
          if (!this._cam) return;
          const dir = this._cam.base.clone().sub(target);
          dir.normalize();
          this._punch = {
            pos: this._cam.base.clone().add(dir.multiplyScalar(dir.length() * intensity)),
            look: this._cam.look.clone().lerp(target, intensity),
            t: 0,
          };
        },
        projectToScreen,
        flashOverlay: (color: string) => {
          this._die3d?.flash(color);
          if (!flash) return;
          flash.style.zIndex = "9999999";
          flash.style.setProperty("z-index", "9999999", "important");
          stingFlash(color);
        },
        shakeScreen: (amp: number, duration: number) => {
          // DOM-based screen shake: jitter the renderer canvas with decaying amp.
          const canvas = world.renderer?.domElement;
          if (!canvas) return;
          const dur = Math.round(duration * 1000);
          const steps = Math.max(6, Math.round(duration * 24));
          const keyframes = [];
          let seed = 0x5eed >>> 0;
          for (let i = 0; i <= steps; i++) {
            const decay = 1 - i / steps;
            // Simple LCG for shake offsets (presentation only).
            seed = (seed * 1664525 + 1013904223) >>> 0;
            const sx = ((seed / 4294967296) - 0.5) * 2 * amp * decay;
            seed = (seed * 1664525 + 1013904223) >>> 0;
            const sy = ((seed / 4294967296) - 0.5) * 2 * amp * decay;
            keyframes.push({ transform: `translate(${sx.toFixed(1)}px,${sy.toFixed(1)}px)` });
          }
          keyframes.push({ transform: "translate(0,0)" });
          try {
            canvas.animate(keyframes, { duration: dur, easing: "ease-out", fill: "both" });
          } catch {
            // WAAPI unavailable — shake is a nice-to-have.
          }
        },
        sparkle: (x: number, y: number, count: number, color: string) => {
          // Glittering sparkle burst: small 4-point stars that flash and fade.
          for (let i = 0; i < count; i++) {
            const el = document.createElement("div");
            const size = 4 + ((i * 37) % 8);
            el.style.cssText = `
              position: fixed; left: ${x}px; top: ${y}px;
              width: ${size}px; height: ${size}px;
              background: ${color};
              clip-path: polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%);
              z-index: 96; pointer-events: none;
              transform: translate(-50%,-50%);
            `;
            document.body.appendChild(el);
            const angle = (i / count) * Math.PI * 2;
            const dist = 30 + (i % 5) * 18;
            const vx = Math.cos(angle) * dist;
            const vy = Math.sin(angle) * dist - 20;
            try {
              el.animate(
                [
                  { transform: "translate(-50%,-50%) scale(0)", opacity: 0 },
                  { transform: `translate(calc(-50% + ${vx.toFixed(0)}px), calc(-50% + ${vy.toFixed(0)}px)) scale(1)`, opacity: 1, offset: 0.4 },
                  { transform: `translate(calc(-50% + ${(vx * 1.3).toFixed(0)}px), calc(-50% + ${(vy * 1.3 + 40).toFixed(0)}px)) scale(0.3)`, opacity: 0 },
                ],
                { duration: 550 + (i % 4) * 80, easing: "cubic-bezier(.2,.55,.35,1)", fill: "both" }
              ).onfinish = () => el.remove();
            } catch {
              window.setTimeout(() => el.remove(), 700);
            }
          }
        },
      },
      projectToScreen,
      flashOverlay: (color: string) => {
        this._die3d?.flash(color);
        if (!flash) return;
        // DOM flash as visual backup (3D WebGL flash is the census path)
        // Inline style for immediate render; WAAPI drives the fade-out.
        flash.style.background = color;
        flash.style.opacity = "0.62";
        flash.animate(
          [
            { opacity: "0.62", backgroundColor: color },
            { opacity: "0", backgroundColor: "transparent" },
          ],
          { duration: 420, easing: "ease-out", fill: "forwards" }
        );
        (globalThis as any).__SSP_FLASH = { at: performance.now(), peak: 0.62, dur: 420 };
        window.setTimeout(() => {
          flash.style.background = "";
          (globalThis as any).__SSP_FLASH = null;
        }, 640);
      },
    });
    this._loop.start();

    // ?shop=1 opens the Gumball Shop on demand for inspection — the shop
    // stays open indefinitely (no auto-resolve) so the critic can reach it.
    if (params.get("shop") === "1") {
      // Small delay so the board is rendered under the shop.
      window.setTimeout(() => openShop(0), 250);
    }
  },

  exit() {
    for (const off of this._unsubs ?? []) off();
    this._unsubs = [];
    ui.clearFeedback();
    this._loop?.dispose();
    this._loop = undefined;
    if (this._onResize) {
      window.removeEventListener("resize", this._onResize);
      this._onResize = undefined;
    }
    for (const ch of this._chars ?? []) {
      world.scene?.remove(ch.group);
      ch.dispose();
    }
    this._chars = undefined;
    this._board?.dispose();
    this._board = undefined;
    this._die3d?.dispose();
    this._die3d = undefined;
    this._hud?.destroy();
    this._hud = undefined;
    this._rollBtn?.destroy();
    this._rollBtn = undefined;
    this._rollWrap?.remove();
    this._rollWrap = undefined;
    this._itemBar?.remove();
    this._itemBar = undefined;
    this._die?.remove();
    this._die = undefined;
    this._dieFace = undefined;
    this._flash?.remove();
    this._flash = undefined;
    this._cam = undefined;
    this._punch = null;
    if (this._onPauseKey) {
      window.removeEventListener("keydown", this._onPauseKey);
      this._onPauseKey = undefined;
    }
    this._pause?.destroy();
    this._pause = undefined;
    this._pauseBtn?.destroy();
    this._pauseBtn = undefined;
    ui.clearScreen();
    audio.music.stop(0.3);
  },

  update(dt: number) {
    // ---- freeze guard: while the pause overlay is open, NOTHING advances ----
    // No board idle animation, no character animation, no turn-loop phase
    // machine, no party camera breathing. The last rendered frame just persists
    // behind the dimmed overlay. We do NOT touch the turn loop's own timing
    // here — seeded-determinism runs that never open the overlay are unaffected.
    if (this._pause?.isOpen()) {
      return;
    }

    this._t = (this._t ?? 0) + dt;
    const t = this._t;

    this._board?.update(dt);
    for (const ch of this._chars ?? []) ch.update(dt);

    // ---- party camera: static MP7-style frame + slow breathing + punch ----
    const cam = world.camera;
    if (cam && this._cam) {
      const base = this._cam.base;
      const look = this._cam.look;
      const pos = base.clone();
      pos.y += Math.sin(t * 0.23) * 0.14;
      pos.z += Math.cos(t * 0.17) * 0.09;
      const lk = look.clone();
      lk.z += Math.sin(t * 0.21) * 0.3;

      if (this._punch) {
        const p = this._punch;
        p.t += dt;
        let k: number;
        if (p.t < 0.45) {
          const q = p.t / 0.45;
          k = 1 - Math.pow(1 - q, 3); // ease-out in
        } else if (p.t < 1.15) {
          k = 1;
        } else {
          const q = Math.min(1, (p.t - 1.15) / 0.45);
          k = 1 - (1 - Math.pow(1 - q, 3)); // ease-out back
        }
        pos.lerpVectors(pos, p.pos, k);
        lk.lerpVectors(lk, p.look, k);
        if (p.t > 1.6) this._punch = null;
      }

      cam.position.copy(pos);
      cam.lookAt(lk);
    }

    this._loop?.update(dt);
    this._die3d?.update(dt);

    // Natural end of match -> the awards finale (MP7's closing ceremony).
    // The turn loop sets phase='ended' after the final round + bonus stars.
    if (match.phase === "ended" && !this._finaleShown) {
      this._finaleShown = true;
      screens.goto("finale");
    }
  },

  render() {},

  _openPause() {
    if (!this._pause || this._pause.isOpen()) return;
    // Snapshot the autoplay state so we can freeze it. The autoplay hook
    // fires rollPressed() directly from main.ts, bypassing this.update()'s
    // freeze gate — so we toggle autoplay off here and restore it on close.
    this._unfreezeAutoplay = isAutoplay();
    if (this._unfreezeAutoplay) setAutoplay(false);
    this._pause.open();
  },

  _closePause() {
    if (!this._pause || !this._pause.isOpen()) return;
    this._pause.close();
    if (this._unfreezeAutoplay) setAutoplay(true);
    this._unfreezeAutoplay = false;
  },
};

export const boardScreenPlaceholder = boardScreenImpl as Screen;
