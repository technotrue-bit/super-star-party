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
import { match, startMatch } from "../core/game";
import { rng } from "../core/rng";
import { bus } from "../core/events";
import { roster } from "../characters/roster";
import { audio } from "../audio/audioEngine";
import { ui } from "../ui/kit";
import { setAutoplay } from "../core/debug";
import { buildBoardScene, boardBounds, type BoardScene } from "../board/boardScene";
import { fizzyFairground } from "../board/boardData";
import { createCharacter, type Character } from "../characters/characterFactory";
import { createTurnLoop, PLAYER_OFFSETS, type DiceView, type TurnLoop } from "../game/turnLoop";
import type { Screen } from "./screenManager";

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
.ssp-roll-wrap { position:fixed; left:50%; bottom:calc(22px + env(safe-area-inset-bottom, 0px)); transform:translateX(-50%); z-index:64; animation:sspRollPulse 1.15s ease-in-out infinite; }
@keyframes sspRollPulse { 0%,100% { transform:translateX(-50%) scale(1); } 50% { transform:translateX(-50%) scale(1.08); } }
.ssp-item-bar { position:fixed; left:50%; bottom:118px; transform:translateX(-50%); display:flex; gap:10px; z-index:63; }
.ssp-die { position:fixed; left:50%; top:32%; transform:translateX(-50%); width:104px; height:104px; border-radius:24px; background:${palette.cream}; border:5px solid ${palette.ink}; box-shadow:7px 7px 0 ${palette.ink}; display:flex; align-items:center; justify-content:center; z-index:70; }
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
.ssp-flash { position:fixed; inset:0; pointer-events:none; z-index:85; opacity:0; }
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
 * Fit the WHOLE board + scenery into the frame for the current aspect:
 * - scenery pad ~5.2u beyond the space-loop bounds (tents ~2.9u, ferris
 *   wheel ~4.2u) so corner landmarks never clip;
 * - vertical fit solved so the far edge of the board lands at ~+20deg
 *   (no dead ink band at the top of the frame), pitch ~55deg;
 * - portrait tightens the pad and raises the pitch (~62deg).
 */
function computeCameraFit(): CamFit {
  const b = boardBounds();
  const aspect = window.innerWidth / window.innerHeight;
  const portrait = aspect < 1;
  const SCENERY_PAD = portrait ? 3.6 : 5.2;
  const fitX = b.maxX - b.minX + SCENERY_PAD * 2;
  const fitZ = b.maxY - b.minY + SCENERY_PAD * 2;
  const pitch = portrait ? 1.0821 : 0.9599; // 62deg / 55deg
  const vfov = (45 * Math.PI) / 180;
  const hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspect);

  const cx = (b.minX + b.maxX) / 2;
  const cz = (b.minY + b.maxY) / 2;

  // Horizontal: keep the full width on screen.
  const dW = (fitX / 2 / Math.tan(hfov / 2)) * 1.06;
  // Vertical: far edge at ~+20deg (near frame top, scenery fills the rest).
  const halfZ = fitZ / 2;
  const dH = (halfZ * Math.sin(pitch)) / Math.tan((20 * Math.PI) / 180) + halfZ * Math.cos(pitch);
  const d = Math.max(dW, dH);

  const base = new THREE.Vector3(cx, d * Math.sin(pitch), cz + d * Math.cos(pitch));
  // Look slightly past center (ferris-wheel side) in landscape; in portrait
  // look a touch closer so the board sits high and the band stays at the
  // bottom (under the UI), never at the top.
  const look = new THREE.Vector3(cx, 0, cz + (portrait ? 2.0 : -0.5));
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
  _dieFace?: HTMLDivElement;
  _flash?: HTMLDivElement;
  _cam?: CamFit;
  _punch?: Punch | null;
  _t?: number;
  _onResize?: () => void;
}

function projectToScreen(pos: THREE.Vector3): { x: number; y: number } | null {
  const cam = world.camera;
  if (!cam) return null;
  const v = pos.clone().project(cam);
  return {
    x: (v.x * 0.5 + 0.5) * window.innerWidth,
    y: (-v.y * 0.5 + 0.5) * window.innerHeight,
  };
}

const boardScreenImpl: BoardScreenState & Screen = {
  id: "board",

  enter() {
    injectBoardStyles();
    ui.clearScreen();
    this._t = 0;
    this._punch = null;

    // ---- match: start a default one when nothing is running (URL-direct) ----
    if (match.players.length === 0) {
      const params = new URLSearchParams(window.location.search);
      const seed = Number(params.get("seed") ?? "1");
      startMatch(
        roster.map((c) => c.key),
        roster.map((c) => c.name)
      );
      rng.reset(seed); // startMatch reseeds internally — re-seed for the URL
      match.seed = seed;
    }
    if (new URLSearchParams(window.location.search).get("autoplay") === "1") {
      setAutoplay(true);
    }
    bus.emit("match:start", { seed: match.seed, players: match.players.map((p) => p.id) });

    // ---- board ----
    const board = buildBoardScene(fizzyFairground);
    this._board = board;

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

    // ---- ROLL button (gold, pulsing) ----
    const rollWrap = document.createElement("div");
    rollWrap.className = "ssp-roll-wrap";
    const rollBtn = ui.button({
      label: "ROLL!",
      kind: "gold",
      size: "lg",
      ariaLabel: "Roll the dice",
      onClick: () => this._loop?.rollPressed(),
    });
    rollWrap.appendChild(rollBtn.el);
    document.body.appendChild(rollWrap);
    this._rollWrap = rollWrap;
    this._rollBtn = rollBtn;

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

    // ---- turn loop ----
    this._loop = createTurnLoop({
      board,
      chars: this._chars,
      hud,
      rollButton: rollBtn,
      dice: diceView,
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
      projectToScreen,
      flashOverlay: (color: string) => {
        if (!flash) return;
        flash.style.background = color;
        try {
          flash.animate(
            [{ opacity: 0 }, { opacity: 0.55, offset: 0.25 }, { opacity: 0 }],
            { duration: 480, easing: "ease-out" }
          );
        } catch {
          flash.style.opacity = "0";
        }
      },
    });
    this._loop.start();
  },

  exit() {
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
    ui.clearScreen();
    audio.music.stop(0.3);
  },

  update(dt: number) {
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
  },

  render() {},
};

export const boardScreenPlaceholder = boardScreenImpl as Screen;
