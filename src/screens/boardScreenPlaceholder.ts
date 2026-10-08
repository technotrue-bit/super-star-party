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
import { match, playerController, startMatch, rollForTurnOrder } from "../core/game";
import { setOnlineMatch } from "../net/mode";
import { rng, ease } from "../core/rng";
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
import { onViewportChange, viewportSize } from "../ui/viewport";
import { createMapLook, type MapLook } from "../ui/mapLook";

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
.ssp-item-bar { position:fixed; left:50%; bottom:calc(118px + env(safe-area-inset-bottom, 0px)); transform:translateX(-50%); display:flex; gap:10px; z-index:63; max-width:96vw; flex-wrap:wrap; justify-content:center; }
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
.ssp-pause-fab { position:fixed; top:calc(8px + env(safe-area-inset-top, 0px)); right:calc(8px + env(safe-area-inset-right, 0px)); z-index:65; width:54px; height:54px; border-radius:50%; font-size:24px; display:flex; align-items:center; justify-content:center; background:linear-gradient(180deg, rgba(255,255,255,.4) 0%, rgba(255,255,255,0) 40%), linear-gradient(180deg, ${palette.cream} 0%, ${palette.creamShadow} 100%); border:4px solid ${palette.ink}; color:${palette.ink}; box-shadow:0 5px 0 ${palette.ink}; cursor:pointer; touch-action:manipulation; transition:transform .1s cubic-bezier(.34,1.56,.64,1), box-shadow .1s ease-out; }
.ssp-pause-fab:hover { transform:scale(1.08); }
.ssp-pause-fab:active { transform:scale(0.94) translateY(3px); box-shadow:0 2px 0 ${palette.ink}; }
.ssp-map-fab { position:fixed; top:calc(70px + env(safe-area-inset-top, 0px)); right:calc(8px + env(safe-area-inset-right, 0px)); z-index:65; width:54px; height:54px; border-radius:50%; font-size:26px; display:none; align-items:center; justify-content:center; background:linear-gradient(180deg, rgba(255,255,255,.4) 0%, rgba(255,255,255,0) 40%), linear-gradient(180deg, ${palette.cream} 0%, ${palette.creamShadow} 100%); border:4px solid ${palette.ink}; color:${palette.ink}; box-shadow:0 5px 0 ${palette.ink}; cursor:pointer; touch-action:manipulation; }
.ssp-map-fab--on { display:flex; }
.ssp-map-fab:active { transform:scale(0.94) translateY(3px); box-shadow:0 2px 0 ${palette.ink}; }
.ssp-flash { position:fixed; inset:0; pointer-events:none; z-index:99999; opacity:0; }
.ssp-podium { display:flex; flex-direction:column; gap:8px; max-height:44vh; overflow-y:auto; text-align:left; font-size:16px; }
.ssp-podium__row { background:${palette.cream}; border:3px solid ${palette.ink}; border-radius:14px; padding:8px 12px; box-shadow:0 3px 0 ${palette.ink}; }
.ssp-podium__row--win { background:${palette.sun}; font-weight:700; }
.ssp-vignette { position:fixed; inset:0; pointer-events:none; z-index:80;
  background:radial-gradient(ellipse at center, transparent 25%, rgba(43,29,78,0.4) 100%);
  opacity:0; transition:opacity 120ms ease-out; }
.ssp-fb-banner--gold { color:${palette.sun};
  font-size:clamp(28px, 7.5vw, 56px);
  text-shadow:0 3px 0 ${palette.ink}, 3px 0 0 ${palette.ink}, -3px 0 0 ${palette.ink}, 0 -3px 0 ${palette.ink},
    3px 3px 0 ${palette.ink}, -3px 3px 0 ${palette.ink}, 3px -3px 0 ${palette.ink}, -3px -3px 0 ${palette.ink},
    0 6px 0 ${palette.ink}; }
.ssp-fb-banner--gold.ssp-fb-banner--show { transform:translateX(-50%) scale(1.08); }
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
  const { w, h } = viewportSize();
  const aspect = w / h;
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

/** Active 3D star-travel animation, driven from the board update loop. */
interface StarTravelActive {
  group: THREE.Group;
  geo: THREE.ExtrudeGeometry;
  mat: THREE.MeshBasicMaterial;
  elapsed: number;
  duration: number;
  start: THREE.Vector3;
  end: THREE.Vector3;
  sparkleCooldown: number;
}

/** 5-pointed star shape for the traveling star mesh (replicates boardScenery's starShape5). */
function starShape5(): THREE.Shape {
  const s = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? 1 : 0.42;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) s.moveTo(x, y);
    else s.lineTo(x, y);
  }
  s.closePath();
  return s;
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
  _vignette?: HTMLDivElement;
  _starTravels?: StarTravelActive[];
  _cam?: CamFit;
  _camHold?: { base: THREE.Vector3; look: THREE.Vector3; fov: number } | null;
  _punch?: Punch | null;
  _followPos?: THREE.Vector3;
  _followLook?: THREE.Vector3;
  _t?: number;
  _onResize?: () => void;
  _offResize?: () => void;
  _pauseBtn?: { el: HTMLButtonElement; destroy: () => void };
  _mapBtn?: HTMLButtonElement;
  _mapLook?: MapLook;
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
    x: (v.x * 0.5 + 0.5) * viewportSize().w,
    y: (-v.y * 0.5 + 0.5) * viewportSize().h,
  };
}

/** Module-level sparkle emitter (reused by ceremony.sparkle + star-travel trail). */
function emitSparkle(x: number, y: number, count: number, color: string): void {
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
      const used = Number.isFinite(seed) ? seed : 1;
      // Pass the URL seed in so pack assignment and the match share it.
      // The reset below restarts the dice stream at that seed (pack picks
      // use their own stream and do not consume this one).
      setOnlineMatch(false);
      startMatch(
        roster.map((c) => c.key),
        roster.map((c) => c.name),
        10,
        used,
      );
      rng.reset(used);
      match.seed = used;
    }
    if (params.get("autoplay") === "1") {
      setAutoplay(true);
    }
    bus.emit("match:start", { seed: match.seed, players: match.players.map((p) => p.id) });

    // Roll for turn order (Mario Party style) — only on fresh start
    if (match.orderRolls.length === 0) {
      rollForTurnOrder();
    }

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
    if (viewportSize().w / viewportSize().h >= 1) {
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

    const mapBtn = document.createElement("button");
    mapBtn.type = "button";
    mapBtn.className = "ssp-map-fab";
    mapBtn.textContent = "🔍";
    mapBtn.setAttribute("aria-label", "Look at the map");
    mapBtn.addEventListener("click", () => {
      if (this._mapLook?.isOpen()) this._mapLook.close();
      else this._mapLook?.open();
    });
    document.body.appendChild(mapBtn);
    this._mapBtn = mapBtn;
    if (world.camera) {
      this._mapLook = createMapLook({
        camera: world.camera,
        bounds: boardBounds(),
      });
    }

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
      // A modal owns the keyboard while it is up: closing the shop with Escape must
      // not also pop the pause menu behind it.
      if (document.querySelector(".ssp-shop") || document.querySelector(".ssp-popup")) return;
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
      hover() {
        // 2D fallback: just show the ? card (no floating 3D)
        die.style.display = "flex";
        dieFace.textContent = "?";
        die.classList.remove("ssp-die--slam");
      },
    };

    // ---- Grumpus lava flash overlay ----
    const flash = document.createElement("div");
    flash.className = "ssp-flash";
    document.body.appendChild(flash);
    this._flash = flash;

    // Gold/bubble vignette overlay for ceremony background reactions.
    const vignette = document.createElement("div");
    vignette.className = "ssp-vignette";
    document.body.appendChild(vignette);
    this._vignette = vignette;

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
    cam.fov = 45;
    cam.updateProjectionMatrix();
    cam.position.copy(this._cam.base);
    cam.lookAt(this._cam.look);

    // init smooth follow targets
    this._followPos = this._cam.base.clone();
    this._followLook = this._cam.look.clone();

    const onResize = (): void => {
      if (this._cam) this._cam = computeCameraFit();
    };
    this._offResize = onViewportChange(onResize);
    this._onResize = onResize;

    // ---- feedback wiring: route HUD banners through the queue, ----
    // ---- listen for coin changes + happenings + star buys.    ----
    this._unsubs = [];
    const suppressNextBanner = { current: false };
    const queuedHud = {
      ...hud,
      showBanner: (text: string, opts?: { durationMs?: number; style?: "default" | "green" | "grumpus" | "gold"; priority?: "normal" | "high" | "critical" }) => {
        if (suppressNextBanner.current) {
          suppressNextBanner.current = false;
          return { el: document.createElement("div"), destroy() {} };
        }
        const { durationMs, style, priority } = opts ?? {};
        // Star ceremony: clear any active turn banner so the gold spectacle takes center stage.
        if (style === "gold") {
          ui.clearFeedback();
        }
        return queue.banner(text, { durationMs, style, priority });
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
        // Clear any active turn banner so the happening banner fires immediately.
        ui.clearFeedback();
        const isGrumpus = eventId.startsWith("grumpus");
        queue.happening(label, {
          durationMs: 1900,
          kind: isGrumpus ? "grumpus" : "green",
        });
      })
    );
    this._unsubs.push(
      bus.on("star:buy", ({ player, spent }) => {
        if (spent <= 0) return;
        const pos = charPos(player);
        const sc = projectToScreen(pos);
        if (sc) ui.showFloatingNumber(sc.x, sc.y - 30, -spent);
      })
    );
    this._unsubs.push(
      bus.on("star:balloon_moved", ({ from, to }) => {
        const burst = (index: number, count: number): void => {
          const sc = projectToScreen(board.spaceWorldPos(index));
          if (sc) ui.confettiBurst(sc.x, sc.y, { count, sound: null });
        };
        burst(from, 46);
        burst(to, 32);
      })
    );

    // ---- turn loop (created but not started yet) ----
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
          pos: this._cam.base.clone().add(dir.multiplyScalar(dist * 0.30)),
          look: target.clone(),
          t: 0,
        };
      },
      ceremony: {
        focusCamera: (target: THREE.Vector3, intensity: number) => {
          if (!this._cam) return;
          const dir = this._cam.base.clone().sub(target);
          dir.normalize();
          this._punch = {
            pos: this._cam.base.clone().add(dir.multiplyScalar(dir.length() * intensity)),
            look: this._cam.look.clone().lerp(target, intensity),
            t: 0,
          };
        },
        holdCamera: (pos: THREE.Vector3, look: THREE.Vector3, fov: number) => {
          if (!this._cam) return;
          this._camHold = { base: this._cam.base.clone(), look: this._cam.look.clone(), fov: cam.fov };
          this._cam.base.copy(pos);
          this._cam.look.copy(look);
          cam.fov = fov;
          cam.updateProjectionMatrix();
        },
        releaseCamera: () => {
          if (!this._cam || !this._camHold) return;
          this._cam.base.copy(this._camHold.base);
          this._cam.look.copy(this._camHold.look);
          cam.fov = this._camHold.fov;
          cam.updateProjectionMatrix();
          this._camHold = null;
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
          const canvas = world.renderer?.domElement;
          if (!canvas) return;
          const dur = Math.round(duration * 1000);
          const steps = Math.max(6, Math.round(duration * 24));
          const keyframes = [];
          let seed = 0x5eed >>> 0;
          for (let i = 0; i <= steps; i++) {
            const decay = 1 - i / steps;
            seed = (seed * 1664525 + 1013904223) >>> 0;
            const sx = ((seed / 4294967296) - 0.5) * 2 * amp * decay;
            seed = (seed * 1664525 + 1013904223) >>> 0;
            const sy = ((seed / 4294967296) - 0.5) * 2 * amp * decay;
            keyframes.push({ transform: `translate(${sx.toFixed(1)}px,${sy.toFixed(1)}px)` });
          }
          keyframes.push({ transform: "translate(0,0)" });
          try {
            canvas.animate(keyframes, { duration: dur, easing: "ease-out", fill: "both" });
          } catch {}
        },
        sparkle: (x: number, y: number, count: number, color: string) => {
          emitSparkle(x, y, count, color);
        },
        starTravel: (startPos: THREE.Vector3, endPos: THREE.Vector3, duration: number) => {
          if (!world.scene) return;
          const geo = new THREE.ExtrudeGeometry(starShape5(), {
            depth: 0.18, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.06, bevelSegments: 2,
          });
          const mat = new THREE.MeshBasicMaterial({
            color: palette.sun, transparent: true, opacity: 1,
            depthWrite: false, side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending,
          });
          const star = new THREE.Mesh(geo, mat);
          star.rotation.x = -Math.PI / 2;
          star.scale.setScalar(2.5);
          // Ink outline shell (BackSide = silhouette border)
          const shell = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
            color: palette.ink, side: THREE.BackSide, depthWrite: false,
            transparent: true, opacity: 0.85,
          }));
          shell.scale.setScalar(2.95);
          const group = new THREE.Group();
          group.add(star, shell);
          group.position.copy(startPos);
          group.position.y = 0.9; // lifted off the space
          world.scene?.add(group);
          (boardScreenImpl._starTravels = boardScreenImpl._starTravels ?? []).push({
            group, geo, mat, elapsed: 0, duration,
            start: startPos.clone(), end: endPos.clone(), sparkleCooldown: 0,
          });
        },
        vignettePulse: (color: string, intensity: number, duration: number) => {
          const v = boardScreenImpl._vignette;
          if (!v) return;
          // Parse hex color (#RRGGBB) to rgb; fall back to ink.
          let r = 43, g = 29, b = 78;
          const h = color.replace("#", "");
          if (h.length === 6) {
            r = parseInt(h.slice(0, 2), 16);
            g = parseInt(h.slice(2, 4), 16);
            b = parseInt(h.slice(4, 6), 16);
          }
          v.style.background = `radial-gradient(ellipse at center, transparent 25%, rgba(${r},${g},${b},${intensity}) 100%)`;
          v.style.transition = "opacity 120ms ease-out";
          v.style.opacity = "1";
          const holdMs = Math.max(50, Math.round(duration * 1000) - 520);
          window.setTimeout(() => {
            v.style.transition = "opacity 400ms ease-out";
            v.style.opacity = "0";
            window.setTimeout(() => { if (v) v.style.background = ""; }, 400);
          }, holdMs);
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

    // Mario Party "roll to see who goes first" — show the rolls with suspense
    // The match and first turn only start after the order ceremony finishes.
    if (match.orderRolls.length > 0 && match.turn === 1) {
      const order = match.turnOrder;
      const rolls = match.orderRolls;

      queuedHud.showBanner("ROLLING FOR TURN ORDER!", { durationMs: 1200, style: "default" });

      let delay = 1400;
      order.forEach((pid) => {
        const p = match.players[pid];
        if (!p) return;
        const roll = rolls[pid] || 1;
        setTimeout(() => {
          queuedHud.showBanner(`${p.name} rolled ${roll}!`, { durationMs: 850, style: "default" });
        }, delay);
        delay += 900;
      });

      setTimeout(() => {
        const first = match.players[order[0]];
        if (first) {
          queuedHud.showBanner(`${first.name} GOES FIRST!`, { durationMs: 1500, style: "default" });
        }
        // The match now officially begins. The first player in the determined order gets their turn.
        this._loop?.start();
      }, delay + 150);
    } else {
      // Not a fresh match start (e.g. returning from minigame)
      this._loop?.start();
    }

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
    if (this._offResize) {
      this._offResize();
      this._offResize = undefined;
    }
    this._onResize = undefined;
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
    this._mapLook?.destroy();
    this._mapLook = undefined;
    this._mapBtn?.remove();
    this._mapBtn = undefined;
    ui.clearScreen();
    audio.music.stop(0.3);
    // Clean up vignette overlay.
    if (this._vignette) {
      this._vignette.remove();
      this._vignette = undefined;
    }
    // Clean up any active star travels.
    if (this._starTravels) {
      for (const s of this._starTravels) {
        world.scene?.remove(s.group);
        s.geo.dispose();
        s.mat.dispose();
        ((s.group.children[1] as THREE.Mesh).material as THREE.Material).dispose();
      }
      this._starTravels = [];
    }
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
    if (this._mapBtn) {
      const myTurn = playerController(match.currentPlayer) === "local" && (match.phase === "dice" || match.phase === "moving");
      this._mapBtn.classList.toggle("ssp-map-fab--on", myTurn && !this._mapLook?.isOpen());
    }
    if (this._mapLook?.isOpen()) {
      this._board?.setPrizeBalloon(match.players.length > 0 ? match.starBalloonPos : null);
      this._board?.update(dt);
      return;
    }

    this._t = (this._t ?? 0) + dt;
    const t = this._t;

    this._board?.setPrizeBalloon(match.players.length > 0 ? match.starBalloonPos : null);
    this._board?.update(dt);
    for (const ch of this._chars ?? []) ch.update(dt);

    // ---- party camera: smooth follow on active player, overview, or slow minigame pan ----
    const cam = world.camera;
    if (cam && this._cam && this._followPos && this._followLook) {
      const phase = match.phase;
      const currentPid = match.currentPlayer;

      let idealPos: THREE.Vector3;
      let idealLook: THREE.Vector3;

      if ((phase === "dice" || phase === "moving" || phase === "space-effect") && match.players[currentPid]) {
        // Follow the active player — compute ideal target each frame
        const off = PLAYER_OFFSETS[currentPid] ?? [0, 0];
        const v = this._board?.spaceWorldPos(match.players[currentPid]?.space ?? 0) || new THREE.Vector3();
        const playerPos = v.clone();
        playerPos.x += off[0];
        playerPos.z += off[1];

        idealPos = playerPos.clone();
        idealPos.y += 18; // high angle
        idealPos.z -= 12; // pull back
        idealLook = playerPos.clone();
        idealLook.y += 2;
      } else if (phase === "minigame") {
        // Slow graceful pan around the map center (while board still visible briefly)
        const center = new THREE.Vector3(0, 8, 0);
        const radius = 38;
        const angle = t * 0.25;
        idealPos = new THREE.Vector3(
          Math.cos(angle) * radius,
          22 + Math.sin(t * 0.4) * 2,
          Math.sin(angle) * radius * 0.7
        );
        idealLook = center;
      } else {
        // Default centered overview (idle / between turns)
        idealPos = this._cam.base.clone();
        idealPos.y += Math.sin(t * 0.23) * 0.14;
        idealPos.z += Math.cos(t * 0.17) * 0.09;
        idealLook = this._cam.look.clone();
        idealLook.z += Math.sin(t * 0.21) * 0.3;
      }

      // Smooth lerp the persistent follow target toward the ideal (prevents stutter/clip from discrete player hops)
      const followSpeed = 1 - Math.exp(-11 * dt); // responsive but silky (tune 9-14)
      this._followPos.lerp(idealPos, followSpeed);
      this._followLook.lerp(idealLook, followSpeed * 0.85);

      let pos = this._followPos.clone();
      let lk = this._followLook.clone();

      // Dice punch still takes priority (committed shot during roll)
      if (this._punch) {
        const p = this._punch;
        p.t += dt;
        let k: number;
        if (p.t < 0.45) {
          const q = p.t / 0.45;
          k = 1 - Math.pow(1 - q, 3);
        } else if (p.t < 1.55) {
          k = 1;
        } else {
          const q = Math.min(1, (p.t - 1.55) / 0.45);
          k = 1 - (1 - Math.pow(1 - q, 3));
        }
        pos.lerpVectors(pos, p.pos, k);
        lk.lerpVectors(lk, p.look, k);
        if (p.t > 2.05) this._punch = null;
      }

      cam.position.copy(pos);
      cam.lookAt(lk);
    }

    this._loop?.update(dt);
    this._die3d?.update(dt);

    // Animate active star travels (MP7: the star physically arcs to the buyer).
    if (this._starTravels && this._starTravels.length > 0) {
      for (let i = this._starTravels.length - 1; i >= 0; i--) {
        const s = this._starTravels[i];
        s.elapsed += dt;
        s.sparkleCooldown -= dt;
        const p = Math.min(1, s.elapsed / s.duration);
        const e = ease.outCubic(p);
        // Parabolic arc: rise then fall.
        const height = Math.sin(p * Math.PI) * 2.6;
        const pos = new THREE.Vector3().lerpVectors(s.start, s.end, e);
        pos.y = height + 0.5;
        s.group.position.copy(pos);
        s.group.rotation.y = s.elapsed * 4;
        // Scale pulse: the star gently grows/shrinks during flight for life.
        const pulse = 1 + Math.sin(s.elapsed * 6) * 0.15;
        (s.group.children[0] as THREE.Mesh).scale.setScalar(5 * pulse);
        (s.group.children[1] as THREE.Mesh).scale.setScalar(6.0 * (0.95 + Math.sin(s.elapsed * 4) * 0.05));
        // Sparkle trail at the star's projected screen position.
        if (s.sparkleCooldown <= 0 && p < 0.98) {
          s.sparkleCooldown = 0.08;
          const sc = projectToScreen(s.group.position);
          if (sc) emitSparkle(sc.x, sc.y, 4, palette.sun);
        }
        if (p >= 1) {
          // Arrival: big sparkle burst.
          const sc = projectToScreen(s.group.position);
          if (sc) emitSparkle(sc.x, sc.y, 20, palette.sun);
          world.scene?.remove(s.group);
          s.geo.dispose();
          s.mat.dispose();
          ((s.group.children[1] as THREE.Mesh).material as THREE.Material).dispose();
          this._starTravels.splice(i, 1);
        }
      }
    }

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
