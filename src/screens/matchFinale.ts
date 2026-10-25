/**
 * SUPER STAR PARTY — the party finale (end-of-match ceremony).
 *
 * MP-style final results, told as a run of beats on a night carnival stage:
 *
 *   intro      fade up, camera dollies onto everyone in a row, nameplates
 *              count up to the board totals
 *   bonus      "BONUS STARS!", then one award at a time: category card with
 *              everyone's number, a drumroll while a spotlight hops between
 *              the players and slows down, the hit, a star drops onto the
 *              winner and their nameplate gains it
 *   places     last place up to 2nd: spotlight, rank badge, reaction
 *   suspense   lights down, "THE SUPER STAR IS…", long drumroll
 *   winner     lights slam on, the podium rises out of the stage, everyone
 *              hops onto their step, confetti cannons, colored beams, the
 *              camera orbits in on the winner, win fanfare into the results
 *              music
 *   summary    results card with PLAY AGAIN / MAIN MENU
 *
 * Tap / Space finishes the current beat; SKIP (or Escape) jumps straight to
 * the summary. A finished beat always leaves the same end state, so skipping
 * never changes what is shown.
 *
 * Results are read from game/finalResults (decided once by the turn loop).
 * This screen never draws the gameplay rng: presentation randomness comes
 * from its own mulberry32 stream, reseeded on every entry, and all motion is
 * driven by dt. exit() removes every DOM node, 3D object, listener and audio
 * it started, and puts back the camera fov, background, fog and world lights.
 */
import * as THREE from "three";
import { world } from "../main";
import { palette, hex } from "../config/palette";
import { match, startMatch } from "../core/game";
import { playerLabel, isYou } from "../ui/labels";
import { audio } from "../audio/audioEngine";
import { ui } from "../ui/kit";
import { mulberry32, type RNG } from "../core/rng";
import { characterColor } from "../characters/roster";
import { screens } from "./screenManager";
import { onlineMatch, setOnlineMatch } from "../net/mode";
import { markMatchFinished } from "../analytics";
import { dropOut } from "../net/session";
import { createCharacter, type Character } from "../characters/characterFactory";
import { box, makeSkyTexture } from "../minigames/framing";
import { viewportSize, onViewportChange } from "../ui/viewport";
import { finalResults, decideFinalResults, clearFinalResults, type FinalResults } from "../game/finalResults";
import type { BonusStarKind } from "../game/economy";
import type { ButtonHandle } from "../ui/button";
import type { Screen } from "./screenManager";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
const easeOutCubic = (p: number): number => 1 - Math.pow(1 - p, 3);
const easeInOutCubic = (p: number): number =>
  p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
const easeOutBack = (p: number): number => {
  const c = 1.70158;
  return 1 + (c + 1) * Math.pow(p - 1, 3) + c * Math.pow(p - 1, 2);
};
/** Frame-rate independent approach factor. */
const damp = (k: number, dt: number): number => 1 - Math.exp(-k * dt);

const ORDINAL = ["1ST", "2ND", "3RD", "4TH"];

const BONUS_INFO: Record<BonusStarKind, { title: string; desc: string; unit: string; color: string }> = {
  mini: { title: "MINIGAME STAR", desc: "Most minigames won", unit: "win", color: palette.bubble },
  coin: { title: "COIN STAR", desc: "Most coins at the end", unit: "coin", color: palette.sun },
  stamp: { title: "STAMP STAR", desc: "Most carnival stamps", unit: "stamp", color: palette.candy },
};
/** "1 star", "3 stars". */
const count = (n: number, unit: string): string => `${n} ${unit}${n === 1 ? "" : "s"}`;
const BONUS_SHORT: Record<BonusStarKind, string> = { mini: "MINI", coin: "COIN", stamp: "STAMP" };

/* ------------------------------------------------------------------ */
/*  Stage layout                                                       */
/* ------------------------------------------------------------------ */

/** Row spacing: tighter on a portrait phone so the characters read bigger. */
const rowSpacing = (): number => (viewportSize().w < viewportSize().h ? 1.75 : 2.1);
const FOV = 36;
/** Camera looks at the stage from a little above, straight on. */
const VIEW_DIR = new THREE.Vector3(0, 0.36, 1);

interface PodiumSpot {
  x: number;
  z: number;
  h: number;
  color: string;
}
/** By final place: 2nd | 1st | 3rd on steps, 4th on a low riser at the end. */
const PODIUM: PodiumSpot[] = [
  { x: 0, z: 0, h: 1.25, color: palette.sun },
  { x: -2.1, z: 0.12, h: 0.8, color: palette.metal },
  { x: 2.1, z: 0.12, h: 0.5, color: palette.sunDeep },
  { x: 3.95, z: 0.3, h: 0.18, color: palette.berry },
];

/* ------------------------------------------------------------------ */
/*  Styles (injected once)                                             */
/* ------------------------------------------------------------------ */

const STYLE_ID = "ssp-finale-style";
const OUTLINE = (w: number): string =>
  `0 ${w}px 0 ${palette.ink}, ${w}px 0 0 ${palette.ink}, -${w}px 0 0 ${palette.ink}, 0 -${w}px 0 ${palette.ink},` +
  ` ${w - 1}px ${w - 1}px 0 ${palette.ink}, -${w - 1}px ${w - 1}px 0 ${palette.ink}, ${w - 1}px -${w - 1}px 0 ${palette.ink}, -${w - 1}px -${w - 1}px 0 ${palette.ink}`;

function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = `
.ssp-fin { position: fixed; inset: 0; z-index: 90; pointer-events: none; font-family: 'Fredoka', sans-serif; overflow: hidden; }
.ssp-fin * { box-sizing: border-box; }
.ssp-fin-fade { position: absolute; inset: 0; background: ${palette.ink}; opacity: 1; }
.ssp-fin-flash { position: absolute; inset: 0; background: ${palette.cream}; opacity: 0; }
.ssp-fin-vignette { position: absolute; inset: 0; background: radial-gradient(ellipse at 50% 55%, rgba(0,0,0,0) 40%, rgba(16,8,36,0.75) 100%); opacity: 0.5; }
.ssp-fin-top { position: absolute; left: 0; right: 0; top: calc(env(safe-area-inset-top, 0px) + 14px);
  display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 0 12px; }
.ssp-fin-head { font-size: clamp(30px, 8.6vw, 64px); font-weight: 700; line-height: 1.04; text-align: center;
  color: ${palette.cream}; text-shadow: ${OUTLINE(3)}, 0 7px 0 ${palette.ink}; max-width: 94vw;
  text-wrap: balance; overflow-wrap: anywhere; min-height: 1em; }
.ssp-fin-sub { font-size: clamp(16px, 4.4vw, 26px); font-weight: 700; color: ${palette.cream}; text-align: center;
  text-shadow: ${OUTLINE(2)}; max-width: 92vw; min-height: 1.1em; }
.ssp-fin-card { background: ${palette.cream}; border: 4px solid ${palette.ink}; border-radius: 18px; box-shadow: 0 6px 0 ${palette.ink};
  padding: 8px 12px 10px; max-width: min(560px, 94vw); width: max-content; text-align: center; color: ${palette.ink};
  transform: translateY(-16px) scale(0.6); opacity: 0; transition: transform .35s cubic-bezier(.34,1.56,.64,1), opacity .2s ease-out; }
.ssp-fin-card.on { transform: none; opacity: 1; }
.ssp-fin-card__title { font-size: clamp(18px, 5vw, 26px); font-weight: 700; letter-spacing: .02em; }
.ssp-fin-card__desc { font-size: 13px; font-weight: 600; color: ${palette.inkSoft}; margin-top: 1px; }
.ssp-fin-chips { display: flex; flex-wrap: wrap; justify-content: center; gap: 6px; margin-top: 7px; }
.ssp-fin-chip { display: flex; align-items: center; gap: 5px; padding: 3px 9px 3px 6px; border-radius: 999px;
  border: 3px solid ${palette.ink}; background: #fff; font-size: 13px; font-weight: 700; white-space: nowrap;
  transition: transform .3s cubic-bezier(.34,1.56,.64,1), background .2s; }
.ssp-fin-chip.win { background: ${palette.sun}; transform: scale(1.14); }
.ssp-fin-chip.dim { opacity: .55; }
.ssp-fin-dot { width: 12px; height: 12px; border-radius: 50%; border: 2px solid ${palette.ink}; flex: 0 0 auto; }
.ssp-fin-plate { position: absolute; left: 0; top: 0; transform: translate(-50%, 0); min-width: 74px; max-width: 23vw;
  background: ${palette.cream}; border: 3px solid ${palette.ink}; border-radius: 12px; box-shadow: 0 4px 0 ${palette.ink};
  padding: 2px 6px 3px; text-align: center; color: ${palette.ink}; opacity: 0; transition: opacity .3s; will-change: left, top; }
.ssp-fin-plate.on { opacity: 1; }
.ssp-fin-plate__name { display: flex; align-items: center; justify-content: center; gap: 4px; font-size: 13px; font-weight: 700;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ssp-fin-plate__nums { display: flex; justify-content: center; gap: 8px; font-size: 14px; font-weight: 700; font-variant-numeric: tabular-nums; white-space: nowrap; }
.ssp-fin-plate__star { color: ${palette.sunDeep}; text-shadow: 0 1px 0 ${palette.ink}; }
.ssp-fin-coin { display: inline-block; width: 11px; height: 11px; border-radius: 50%; border: 2px solid ${palette.ink};
  background: ${palette.sun}; vertical-align: -1px; margin-right: 2px; }
.ssp-fin-badge { position: absolute; left: 50%; top: -18px; transform: translateX(-50%) scale(0); padding: 1px 8px; border-radius: 999px;
  border: 3px solid ${palette.ink}; background: ${palette.berry}; color: ${palette.cream}; font-size: 13px; font-weight: 700;
  white-space: nowrap; transition: transform .35s cubic-bezier(.34,1.56,.64,1); }
.ssp-fin-badge.on { transform: translateX(-50%) scale(1); }
.ssp-fin-badge.gold { background: ${palette.sun}; color: ${palette.ink}; }
.ssp-fin-bump { animation: ssp-fin-bump .5s cubic-bezier(.34,1.56,.64,1); }
@keyframes ssp-fin-bump { 0% { transform: translate(-50%,0) scale(1); } 35% { transform: translate(-50%,0) scale(1.28); } 100% { transform: translate(-50%,0) scale(1); } }
.ssp-fin-pop { animation: ssp-fin-pop .45s cubic-bezier(.34,1.56,.64,1); }
@keyframes ssp-fin-pop { 0% { transform: scale(.2); opacity: 0; } 100% { transform: scale(1); opacity: 1; } }
.ssp-fin-skip { position: absolute; right: calc(env(safe-area-inset-right, 0px) + 12px); bottom: calc(env(safe-area-inset-bottom, 0px) + 12px);
  pointer-events: auto; border: 3px solid ${palette.ink}; border-radius: 999px; background: ${palette.cream}; color: ${palette.ink};
  font: 700 14px 'Fredoka', sans-serif; padding: 5px 12px; box-shadow: 0 3px 0 ${palette.ink}; cursor: pointer; z-index: 3; }
.ssp-fin-skip:active { transform: translateY(2px); box-shadow: 0 1px 0 ${palette.ink}; }
.ssp-fin-hint { position: absolute; left: calc(env(safe-area-inset-left, 0px) + 14px); bottom: calc(env(safe-area-inset-bottom, 0px) + 20px);
  font-size: 12px; font-weight: 600; color: ${palette.cream}; opacity: .6; white-space: nowrap; text-shadow: 0 1px 0 ${palette.ink}; }
.ssp-fin-sum { position: absolute; pointer-events: auto; background: ${palette.cream}; border: 5px solid ${palette.ink}; border-radius: 22px;
  box-shadow: 0 8px 0 ${palette.ink}; padding: 12px 14px 14px; color: ${palette.ink}; opacity: 0;
  transition: transform .5s cubic-bezier(.34,1.56,.64,1), opacity .25s ease-out; }
.ssp-fin-sum.portrait { left: 50%; bottom: calc(env(safe-area-inset-bottom, 0px) + 12px); width: min(420px, calc(100vw - 24px));
  transform: translate(-50%, 60px); }
.ssp-fin-sum.portrait.on { transform: translate(-50%, 0); opacity: 1; }
.ssp-fin-sum.wide { right: calc(env(safe-area-inset-right, 0px) + 24px); top: 50%; width: min(400px, 40vw); transform: translate(60px, -50%); }
.ssp-fin-sum.wide.on { transform: translate(0, -50%); opacity: 1; }
.ssp-fin-sum__title { text-align: center; font-size: 22px; font-weight: 700; margin-bottom: 6px; }
.ssp-fin-row { display: grid; grid-template-columns: 34px 1fr auto auto; align-items: center; gap: 8px; padding: 5px 6px;
  border-radius: 12px; font-weight: 700; }
.ssp-fin-row + .ssp-fin-row { margin-top: 3px; }
.ssp-fin-row.first { background: ${palette.sun}; border: 3px solid ${palette.ink}; }
.ssp-fin-row__place { font-size: 17px; text-align: center; }
.ssp-fin-row__who { display: flex; flex-direction: column; min-width: 0; }
.ssp-fin-row__name { display: flex; align-items: center; gap: 6px; font-size: 16px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ssp-fin-row__meta { font-size: 11px; font-weight: 600; color: ${palette.inkSoft}; display: flex; gap: 4px; flex-wrap: wrap; align-items: center; }
.ssp-fin-tag { font-size: 10px; font-weight: 700; padding: 0 5px; border-radius: 6px; border: 2px solid ${palette.ink}; background: ${palette.sun}; color: ${palette.ink}; }
.ssp-fin-row__stars { font-size: 18px; color: ${palette.sunDeep}; text-shadow: 0 1px 0 ${palette.ink}; white-space: nowrap; font-variant-numeric: tabular-nums; }
.ssp-fin-row.first .ssp-fin-row__stars { color: ${palette.ink}; text-shadow: none; }
.ssp-fin-row__coins { font-size: 14px; white-space: nowrap; font-variant-numeric: tabular-nums; }
.ssp-fin-btns { display: flex; gap: 10px; justify-content: center; margin-top: 12px; flex-wrap: wrap; }
.ssp-fin-btns .ssp-btn { flex: 1 1 140px; max-width: 200px; }
`;
  document.head.appendChild(s);
}

/* ------------------------------------------------------------------ */
/*  Beats                                                              */
/* ------------------------------------------------------------------ */

interface Cue {
  at: number;
  fn: () => void;
  fired: boolean;
}

interface Beat {
  name: string;
  dur: number;
  cues: Cue[];
  tick: ((lt: number, dt: number) => void) | null;
}

class BeatBuilder {
  readonly beat: Beat;
  constructor(name: string, dur: number) {
    this.beat = { name, dur, cues: [], tick: null };
  }
  at(t: number, fn: () => void): this {
    this.beat.cues.push({ at: t, fn, fired: false });
    this.beat.cues.sort((a, b) => a.at - b.at);
    return this;
  }
  tick(fn: (lt: number, dt: number) => void): this {
    this.beat.tick = fn;
    return this;
  }
}

/* ------------------------------------------------------------------ */
/*  Scene pieces                                                       */
/* ------------------------------------------------------------------ */

interface Spot {
  group: THREE.Group;
  coneMat: THREE.MeshBasicMaterial;
  discMat: THREE.MeshBasicMaterial;
  disc: THREE.Mesh;
  x: number;
  z: number;
  floorY: number;
  level: number;
  goal: number;
}

interface Seat {
  pid: number;
  ch: Character;
  color: string;
  /** Final place (0 = winner). */
  place: number;
  plate: HTMLDivElement;
  plateStars: HTMLSpanElement;
  plateCoins: HTMLSpanElement;
  badge: HTMLDivElement;
  shownStars: number;
  shownCoins: number;
  /** Stars shown on the plate after the bonus beats so far. */
  starTarget: number;
  /** Model height (top of the head above the feet). */
  height: number;
}

interface Confetto {
  p: THREE.Vector3;
  v: THREE.Vector3;
  r: THREE.Euler;
  spin: THREE.Vector3;
  phase: number;
  live: boolean;
}

const CONFETTI_COUNT = 240;

/* ------------------------------------------------------------------ */
/*  Screen                                                             */
/* ------------------------------------------------------------------ */

class FinaleScreen implements Screen {
  readonly id = "finale";

  private _rng: RNG = mulberry32(0xf1a1e);
  private _results: FinalResults = { ranking: [], bonuses: [], stats: [] };
  private _seats: Seat[] = [];
  private _beats: Beat[] = [];
  private _bi = 0;
  private _lt = 0;
  private _quiet = false;
  private _leaving = false;
  private _t = 0;
  private _spacing = 2.1;

  // scene
  private _root3d: THREE.Group | null = null;
  private _podium: THREE.Group | null = null;
  private _spots: Spot[] = [];
  private _star: THREE.Group | null = null;
  private _bulbs: THREE.Mesh[] = [];
  private _bulbOn: THREE.MeshBasicMaterial | null = null;
  private _bulbOff: THREE.MeshBasicMaterial | null = null;
  private _confetti: THREE.InstancedMesh | null = null;
  private _confetti3: Confetto[] = [];
  private _confettiRate = 0;
  private _confettiAcc = 0;
  private _disposeMats: THREE.Material[] = [];
  private _disposeGeos: THREE.BufferGeometry[] = [];
  private _disposeTexs: THREE.Texture[] = [];
  private _dimmables: Array<{ mat: THREE.MeshBasicMaterial; base: THREE.Color }> = [];
  private _light = 1;
  private _lightGoal = 1;

  // world state to restore
  private _fov0 = 45;
  private _bg0: THREE.Scene["background"] = null;
  private _fog0: THREE.Scene["fog"] = null;
  private _lights0: Array<{ light: THREE.Light; intensity: number }> = [];

  // camera
  private _camGoalPos = new THREE.Vector3();
  private _camGoalLook = new THREE.Vector3();
  private _camLook = new THREE.Vector3();
  private _camK = 2.2;
  private _framing: (() => void) | null = null;
  private _orbit = 0;

  // DOM
  private _dom: HTMLDivElement | null = null;
  private _fade: HTMLDivElement | null = null;
  private _flash: HTMLDivElement | null = null;
  private _head: HTMLDivElement | null = null;
  private _sub: HTMLDivElement | null = null;
  private _card: HTMLDivElement | null = null;
  private _skipBtn: HTMLButtonElement | null = null;
  private _hint: HTMLDivElement | null = null;
  private _buttons: ButtonHandle[] = [];
  private _highlighted = 0;
  private _chipEls = new Map<number, HTMLDivElement>();

  // audio + listeners
  private _stopRoll: (() => void) | null = null;
  private _offs: Array<() => void> = [];

  /* ---------------------------------------------------------------- */
  /*  Enter                                                            */
  /* ---------------------------------------------------------------- */

  enter(): void {
    this._rng = mulberry32(0xf1a1e);
    this._seats = [];
    this._beats = [];
    this._bi = 0;
    this._lt = 0;
    this._quiet = false;
    this._leaving = false;
    this._t = 0;
    this._spacing = rowSpacing();
    this._spots = [];
    this._bulbs = [];
    this._confetti3 = [];
    this._confettiRate = 0;
    this._confettiAcc = 0;
    this._disposeMats = [];
    this._disposeGeos = [];
    this._disposeTexs = [];
    this._dimmables = [];
    this._light = 1;
    this._lightGoal = 1;
    this._lights0 = [];
    this._buttons = [];
    this._highlighted = 0;
    this._chipEls = new Map();
    this._offs = [];
    this._orbit = 0;
    this._camK = 2.2;

    const scene = world.scene;
    const camera = world.camera;
    if (!scene || !camera) return;

    // A match that ended through the turn loop has its results decided
    // already. Reaching the finale any other way (debug goto) decides them
    // here, once.
    this._results = finalResults() ?? decideFinalResults();
    markMatchFinished({
      board: match.boardId,
      mode: onlineMatch() ? "friends" : "solo",
      turns: match.totalTurns,
    });

    // world state we change
    this._fov0 = camera.fov;
    this._bg0 = scene.background;
    this._fog0 = scene.fog;
    scene.traverse((o) => {
      const l = o as THREE.Light;
      if (l.isLight && (l.name === "world:hemi" || l.name === "world:key")) {
        this._lights0.push({ light: l, intensity: l.intensity });
      }
    });

    ui.clearFeedback(); // nothing from the board may sit on top of the ceremony
    injectStyles();
    this._buildStage(scene);
    this._buildSeats(scene);
    this._buildDom();
    this._buildBeats();

    // camera starts high and far back, then dollies in on the row
    camera.fov = FOV;
    camera.updateProjectionMatrix();
    this._frameRow();
    camera.position.copy(this._camGoalPos).add(new THREE.Vector3(0, 7, 9));
    this._camLook.copy(this._camGoalLook).add(new THREE.Vector3(0, 2.5, 0));
    camera.lookAt(this._camLook);
    this._camK = 1.5;

    // input
    const onKey = (e: KeyboardEvent): void => this._onKey(e);
    window.addEventListener("keydown", onKey);
    this._offs.push(() => window.removeEventListener("keydown", onKey));
    const onDown = (e: PointerEvent): void => {
      const target = e.target as HTMLElement | null;
      if (target?.closest("button, .ssp-fin-sum")) return;
      this._advanceBeat();
    };
    window.addEventListener("pointerdown", onDown);
    this._offs.push(() => window.removeEventListener("pointerdown", onDown));
    this._offs.push(
      onViewportChange(() => {
        this._framing?.();
        if (this._isSummary()) this._snapCamera();
      }),
    );

    audio.music.play("results", { intensity: 0.25 });
    this._startBeat();
  }

  /* ---------------------------------------------------------------- */
  /*  Stage                                                            */
  /* ---------------------------------------------------------------- */

  private _mesh(parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material): THREE.Mesh {
    this._disposeGeos.push(geo);
    if (!this._disposeMats.includes(mat)) this._disposeMats.push(mat);
    const m = new THREE.Mesh(geo, mat);
    parent.add(m);
    return m;
  }

  private _basic(color: string, opts: THREE.MeshBasicMaterialParameters = {}): THREE.MeshBasicMaterial {
    const mat = new THREE.MeshBasicMaterial({ color: hex(color), ...opts });
    this._dimmables.push({ mat, base: mat.color.clone() });
    return mat;
  }

  private _buildStage(scene: THREE.Scene): void {
    const root = new THREE.Group();
    root.name = "finale-stage";
    this._root3d = root;
    scene.add(root);

    const sky = makeSkyTexture(palette.ink, palette.berryDeep);
    this._disposeTexs.push(sky);
    scene.background = sky;
    scene.fog = null;

    // night lawn far out, then the round stage
    const ground = this._mesh(root, new THREE.CircleGeometry(70, 48), this._basic(palette.inkSoft));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.42;
    const stage = this._mesh(root, new THREE.CylinderGeometry(6.6, 6.8, 0.4, 56), this._basic(palette.wood));
    stage.position.y = -0.2;
    const top = this._mesh(root, new THREE.CircleGeometry(6.6, 56), this._basic(palette.path));
    top.rotation.x = -Math.PI / 2;
    top.position.y = 0.002;
    const ring = this._mesh(root, new THREE.RingGeometry(5.3, 5.6, 56), this._basic(palette.pathEdge));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.004;
    const rim = this._mesh(root, new THREE.RingGeometry(6.6, 6.95, 56), this._basic(palette.ink));
    rim.rotation.x = -Math.PI / 2;
    rim.position.y = 0.003;

    // striped carnival curtain + gold valance behind the stage
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 4;
    const c = canvas.getContext("2d");
    if (c) {
      c.fillStyle = palette.tentRed;
      c.fillRect(0, 0, 32, 4);
      c.fillStyle = palette.tentCream;
      c.fillRect(32, 0, 32, 4);
    }
    const stripes = new THREE.CanvasTexture(canvas);
    stripes.colorSpace = THREE.SRGBColorSpace;
    stripes.wrapS = THREE.RepeatWrapping;
    stripes.repeat.set(16, 1);
    stripes.magFilter = THREE.NearestFilter;
    this._disposeTexs.push(stripes);
    const curtain = this._mesh(
      root,
      new THREE.CylinderGeometry(9.5, 9.5, 8, 56, 1, true, Math.PI / 2, Math.PI),
      this._basic(palette.white, { map: stripes, side: THREE.DoubleSide }),
    );
    curtain.position.set(0, 3.6, 1.6);
    const valance = this._mesh(
      root,
      new THREE.CylinderGeometry(9.56, 9.56, 0.7, 56, 1, true, Math.PI / 2, Math.PI),
      this._basic(palette.sun, { side: THREE.DoubleSide }),
    );
    valance.position.set(0, 7.4, 1.6);

    // marquee bulbs along the valance and the stage lip (chase lights)
    this._bulbOn = new THREE.MeshBasicMaterial({ color: hex(palette.sun) });
    this._bulbOff = this._basic(palette.sunDeep);
    this._disposeMats.push(this._bulbOn, this._bulbOff);
    const bulbGeo = new THREE.SphereGeometry(0.13, 10, 8);
    this._disposeGeos.push(bulbGeo);
    for (let i = 0; i <= 26; i++) {
      // same arc as the curtain (three's cylinder: x = r sin θ, z = r cos θ)
      const a = Math.PI / 2 + (Math.PI * i) / 26;
      const b = new THREE.Mesh(bulbGeo, this._bulbOn);
      b.position.set(Math.sin(a) * 9.3, 7.05, 1.6 + Math.cos(a) * 9.3);
      root.add(b);
      this._bulbs.push(b);
    }
    for (let i = 0; i < 22; i++) {
      const a = -Math.PI * 0.42 + (Math.PI * 0.84 * i) / 21;
      const b = new THREE.Mesh(bulbGeo, this._bulbOn);
      b.position.set(Math.sin(a) * 6.75, -0.12, Math.cos(a) * 6.75);
      root.add(b);
      this._bulbs.push(b);
    }

    // podium: hidden under the stage floor until the winner beat
    const podium = new THREE.Group();
    podium.name = "finale-podium";
    const n = this._results.ranking.length;
    for (let k = 0; k < Math.min(n, PODIUM.length); k++) {
      const s = PODIUM[k];
      const w = k === 0 ? 1.9 : 1.75;
      const step = this._mesh(podium, new THREE.BoxGeometry(w, s.h, 1.7), this._basic(s.color));
      step.position.set(s.x, s.h / 2, s.z);
      const outline = this._mesh(
        podium,
        new THREE.BoxGeometry(w + 0.12, s.h + 0.12, 1.82),
        this._basic(palette.ink, { side: THREE.BackSide }),
      );
      outline.position.copy(step.position);
      if (s.h > 0.3) {
        // place number on the front face
        const label = this._numberPlate(k + 1);
        label.position.set(s.x, s.h * 0.55, s.z + 0.86);
        podium.add(label);
      }
    }
    podium.position.y = -1.6;
    podium.visible = false;
    root.add(podium);
    this._podium = podium;

    // spotlights: 0 = main (warm), 1-2 = colored sweepers for the winner
    this._spots.push(this._makeSpot(root, palette.cream));
    this._spots.push(this._makeSpot(root, palette.candy));
    this._spots.push(this._makeSpot(root, palette.bubble));

    // bonus star
    this._star = this._makeStar();
    this._star.visible = false;
    root.add(this._star);

    // 3D confetti
    const cGeo = new THREE.PlaneGeometry(0.14, 0.22);
    const cMat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
    this._disposeGeos.push(cGeo);
    this._disposeMats.push(cMat);
    const conf = new THREE.InstancedMesh(cGeo, cMat, CONFETTI_COUNT);
    conf.frustumCulled = false;
    const colors = [palette.sun, palette.candy, palette.mint, palette.bubble, palette.berry, palette.lava, palette.cream];
    const tmp = new THREE.Color();
    const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < CONFETTI_COUNT; i++) {
      conf.setColorAt(i, tmp.set(hex(colors[i % colors.length])));
      conf.setMatrixAt(i, hidden);
      this._confetti3.push({
        p: new THREE.Vector3(),
        v: new THREE.Vector3(),
        r: new THREE.Euler(),
        spin: new THREE.Vector3(),
        phase: 0,
        live: false,
      });
    }
    root.add(conf);
    this._confetti = conf;
  }

  private _numberPlate(place: number): THREE.Mesh {
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 128;
    const c = canvas.getContext("2d");
    if (c) {
      c.font = "700 104px Fredoka, sans-serif";
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.lineWidth = 14;
      c.strokeStyle = palette.ink;
      c.strokeText(String(place), 64, 70);
      c.fillStyle = palette.cream;
      c.fillText(String(place), 64, 70);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    this._disposeTexs.push(tex);
    const mat = this._basic(palette.white, { map: tex, transparent: true, depthWrite: false });
    const geo = new THREE.PlaneGeometry(0.62, 0.62);
    this._disposeGeos.push(geo);
    this._disposeMats.push(mat);
    return new THREE.Mesh(geo, mat);
  }

  private _makeSpot(root: THREE.Group, color: string): Spot {
    const group = new THREE.Group();
    const coneMat = new THREE.MeshBasicMaterial({
      color: hex(color),
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const discMat = new THREE.MeshBasicMaterial({
      color: hex(color),
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const cone = this._mesh(group, new THREE.CylinderGeometry(0.2, 1.2, 9, 28, 1, true), coneMat);
    cone.position.y = 4.5;
    const disc = this._mesh(group, new THREE.CircleGeometry(1.2, 32), discMat);
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = 0.02;
    group.visible = false;
    root.add(group);
    return { group, coneMat, discMat, disc, x: 0, z: 0, floorY: 0, level: 0, goal: 0 };
  }

  private _makeStar(): THREE.Group {
    const shape = new THREE.Shape();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 === 0 ? 0.62 : 0.27;
      const a = Math.PI / 2 + (i * Math.PI) / 5;
      if (i === 0) shape.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      else shape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.2, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.05, bevelSegments: 2 });
    geo.center();
    const g = new THREE.Group();
    const face = this._mesh(g, geo, new THREE.MeshBasicMaterial({ color: hex(palette.sun) }));
    face.renderOrder = 2;
    const outline = this._mesh(g, geo, new THREE.MeshBasicMaterial({ color: hex(palette.ink), side: THREE.BackSide }));
    outline.scale.setScalar(1.14);
    return g;
  }

  /* ---------------------------------------------------------------- */
  /*  Seats (characters + nameplates)                                  */
  /* ---------------------------------------------------------------- */

  private _buildSeats(scene: THREE.Scene): void {
    const ranking = this._results.ranking;
    const ids = match.players.map((p) => p.id).filter((id) => ranking.some((r) => r.playerId === id));
    const n = ids.length;
    ids.forEach((pid, i) => {
      const p = match.players[pid];
      const ch = createCharacter(p?.kind ?? "pip");
      ch.group.position.set((i - (n - 1) / 2) * this._spacing, 0, 0);
      ch.setFacing(0);
      ch.anim.idle();
      scene.add(ch.group);
      ch.group.updateMatrixWorld(true);
      const height = Math.max(1, new THREE.Box3().setFromObject(ch.group).max.y);
      const plate = document.createElement("div");
      plate.className = "ssp-fin-plate";
      plate.dataset.sspPlayer = String(pid);
      const color = characterColor(p?.kind ?? "pip");
      const name = document.createElement("div");
      name.className = "ssp-fin-plate__name";
      const dot = document.createElement("span");
      dot.className = "ssp-fin-dot";
      dot.style.background = color;
      const nm = document.createElement("span");
      nm.textContent = playerLabel(pid, "short");
      name.append(dot, nm);
      const nums = document.createElement("div");
      nums.className = "ssp-fin-plate__nums";
      const st = document.createElement("span");
      st.className = "ssp-fin-plate__star";
      const stN = document.createElement("span");
      stN.textContent = "0";
      st.append("★", stN);
      const co = document.createElement("span");
      const coin = document.createElement("span");
      coin.className = "ssp-fin-coin";
      const coN = document.createElement("span");
      coN.textContent = "0";
      co.append(coin, coN);
      nums.append(st, co);
      const badge = document.createElement("div");
      badge.className = "ssp-fin-badge";
      plate.append(badge, name, nums);
      this._seats.push({
        pid,
        ch,
        color,
        place: ranking.findIndex((r) => r.playerId === pid),
        plate,
        plateStars: stN,
        plateCoins: coN,
        badge,
        shownStars: 0,
        shownCoins: 0,
        starTarget: this._stats(pid).boardStars,
        height,
      });
    });
  }

  private _stats(pid: number): FinalResults["stats"][number] {
    return (
      this._results.stats[pid] ?? { playerId: pid, boardStars: 0, coins: 0, minigameWins: 0, stampsCollected: 0 }
    );
  }

  private _seat(pid: number): Seat | undefined {
    return this._seats.find((s) => s.pid === pid);
  }

  private _seatAtPlace(place: number): Seat | undefined {
    return this._seats.find((s) => s.place === place);
  }

  /* ---------------------------------------------------------------- */
  /*  DOM                                                              */
  /* ---------------------------------------------------------------- */

  private _buildDom(): void {
    const dom = document.createElement("div");
    dom.className = "ssp-fin";
    dom.dataset.sspFinale = "on";
    const vignette = document.createElement("div");
    vignette.className = "ssp-fin-vignette";
    const top = document.createElement("div");
    top.className = "ssp-fin-top";
    const head = document.createElement("div");
    head.className = "ssp-fin-head";
    head.dataset.sspHeadline = "finale";
    const sub = document.createElement("div");
    sub.className = "ssp-fin-sub";
    const card = document.createElement("div");
    card.className = "ssp-fin-card";
    top.append(head, sub, card);
    const flash = document.createElement("div");
    flash.className = "ssp-fin-flash";
    const fade = document.createElement("div");
    fade.className = "ssp-fin-fade";
    const skip = document.createElement("button");
    skip.type = "button";
    skip.className = "ssp-fin-skip";
    skip.textContent = "SKIP ▸▸";
    skip.setAttribute("aria-label", "Skip to the final results");
    skip.addEventListener("click", () => this._skipAll());
    const hint = document.createElement("div");
    hint.className = "ssp-fin-hint";
    hint.textContent = "Tap to hurry";
    dom.append(vignette);
    for (const s of this._seats) dom.appendChild(s.plate);
    dom.append(top, hint, flash, fade, skip);
    document.body.appendChild(dom);
    this._dom = dom;
    this._head = head;
    this._sub = sub;
    this._card = card;
    this._flash = flash;
    this._fade = fade;
    this._skipBtn = skip;
    this._hint = hint;
  }

  private _say(text: string, color: string = palette.cream, sub = "", subColor: string = palette.cream): void {
    const head = this._head;
    const subEl = this._sub;
    if (!head || !subEl) return;
    head.textContent = text;
    head.style.color = color;
    subEl.textContent = sub;
    subEl.style.color = subColor;
    if (!this._quiet) {
      head.classList.remove("ssp-fin-pop");
      void head.offsetWidth;
      head.classList.add("ssp-fin-pop");
    }
  }

  private _showCard(kind: BonusStarKind): void {
    const card = this._card;
    if (!card) return;
    const info = BONUS_INFO[kind];
    card.replaceChildren();
    this._chipEls.clear();
    const title = document.createElement("div");
    title.className = "ssp-fin-card__title";
    title.textContent = `★ ${info.title} ★`;
    const desc = document.createElement("div");
    desc.className = "ssp-fin-card__desc";
    desc.textContent = info.desc;
    const chips = document.createElement("div");
    chips.className = "ssp-fin-chips";
    for (const s of this._seats) {
      const chip = document.createElement("div");
      chip.className = "ssp-fin-chip";
      const dot = document.createElement("span");
      dot.className = "ssp-fin-dot";
      dot.style.background = s.color;
      const label = document.createElement("span");
      label.textContent = `${playerLabel(s.pid, "short")} ${this._statFor(kind, s.pid)}`;
      chip.append(dot, label);
      chips.appendChild(chip);
      this._chipEls.set(s.pid, chip);
    }
    card.append(title, desc, chips);
    card.classList.add("on");
  }

  private _hideCard(): void {
    this._card?.classList.remove("on");
  }

  private _statFor(kind: BonusStarKind, pid: number): number {
    const st = this._stats(pid);
    return kind === "mini" ? st.minigameWins : kind === "coin" ? st.coins : st.stampsCollected;
  }

  private _setPlate(seat: Seat, stars: number, coins: number): void {
    if (stars !== seat.shownStars) {
      seat.shownStars = stars;
      seat.plateStars.textContent = String(stars);
    }
    if (coins !== seat.shownCoins) {
      seat.shownCoins = coins;
      seat.plateCoins.textContent = String(coins);
    }
  }

  private _bumpPlate(seat: Seat): void {
    if (this._quiet) return;
    seat.plate.classList.remove("ssp-fin-bump");
    void seat.plate.offsetWidth;
    seat.plate.classList.add("ssp-fin-bump");
  }

  private _flashScreen(strength = 0.85): void {
    if (this._quiet || !this._flash) return;
    try {
      this._flash.animate([{ opacity: strength }, { opacity: 0 }], { duration: 520, easing: "ease-out" });
    } catch {
      /* WAAPI unavailable */
    }
  }

  /** Screen position of a world point, in CSS pixels. */
  private _toScreen(v: THREE.Vector3): { x: number; y: number } | null {
    const camera = world.camera;
    const canvas = world.renderer?.domElement;
    if (!camera || !canvas) return null;
    const p = v.clone().project(camera);
    if (p.z > 1) return null;
    const r = canvas.getBoundingClientRect();
    return { x: r.left + (p.x * 0.5 + 0.5) * r.width, y: r.top + (-p.y * 0.5 + 0.5) * r.height };
  }

  private _sparkles(at: THREE.Vector3, count = 14, colors: string[] = [palette.sun, palette.cream, palette.candy]): void {
    if (this._quiet || !this._dom) return;
    const sc = this._toScreen(at);
    if (!sc) return;
    for (let i = 0; i < count; i++) {
      const el = document.createElement("div");
      const size = 6 + this._rng() * 8;
      const c = colors[i % colors.length];
      el.style.cssText = `position:absolute;left:${sc.x}px;top:${sc.y}px;width:${size}px;height:${size}px;border-radius:50%;
        background:${c};box-shadow:0 0 8px ${c};pointer-events:none;`;
      this._dom.appendChild(el);
      const a = this._rng() * Math.PI * 2;
      const d = 40 + this._rng() * 90;
      try {
        el.animate(
          [
            { transform: "translate(-50%,-50%) scale(0.4)", opacity: 1 },
            { transform: `translate(calc(-50% + ${Math.cos(a) * d}px), calc(-50% + ${Math.sin(a) * d}px)) scale(1)`, opacity: 0 },
          ],
          { duration: 650 + this._rng() * 350, easing: "cubic-bezier(.2,.6,.3,1)", fill: "both" },
        ).onfinish = () => el.remove();
      } catch {
        window.setTimeout(() => el.remove(), 900);
      }
    }
  }

  private _cannons(): void {
    if (this._quiet) return;
    const { w, h } = viewportSize();
    ui.confettiBurst(w * 0.08, h * 0.62, { sound: null, count: 70 });
    ui.confettiBurst(w * 0.92, h * 0.62, { sound: null, count: 70 });
  }

  private _sfx(name: string, volume?: number): void {
    if (this._quiet) return;
    audio.sfx.play(name, volume !== undefined ? { volume } : undefined);
  }

  private _drumroll(on: boolean): void {
    if (this._stopRoll) {
      this._stopRoll();
      this._stopRoll = null;
    }
    if (on && !this._quiet) this._stopRoll = audio.music.stinger("drumroll", { duckTo: 0.12 });
  }

  private _hit(): void {
    this._drumroll(false);
    if (!this._quiet) audio.music.stinger("drumroll_hit", { duckTo: 0.3, duckRelease: 1.2 });
  }

  /* ---------------------------------------------------------------- */
  /*  Camera                                                           */
  /* ---------------------------------------------------------------- */

  /**
   * Fit a world box into the free screen area (the viewport minus `insets`)
   * and set the camera goal (not the camera). The view direction is fixed;
   * the camera slides sideways/up so the box centre lands in the middle of
   * the free area, then a binary search finds the nearest distance at which
   * every corner fits. Exact for any off-centre band (a tall card below).
   */
  private _frameBox(
    min: [number, number, number],
    max: [number, number, number],
    insets: { top: number; bottom: number; left?: number; right?: number },
  ): void {
    const camera = world.camera;
    if (!camera) return;
    const { w, h } = viewportSize();
    const aspect = w / h;
    const tanV = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    const tanH = tanV * aspect;
    const L = -1 + (2 * (insets.left ?? 10)) / w;
    const R = 1 - (2 * (insets.right ?? 10)) / w;
    const T = 1 - (2 * insets.top) / h;
    const B = -1 + (2 * insets.bottom) / h;
    const cx = (L + R) / 2;
    const cy = (T + B) / 2;
    const b = box(min, max);
    const center = b.getCenter(new THREE.Vector3());
    const back = VIEW_DIR.clone().normalize(); // from the target toward the camera
    const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), back).normalize();
    const up = new THREE.Vector3().crossVectors(back, right).normalize();
    const corners: THREE.Vector3[] = [];
    for (let i = 0; i < 8; i++) {
      corners.push(
        new THREE.Vector3(i & 1 ? max[0] : min[0], i & 2 ? max[1] : min[1], i & 4 ? max[2] : min[2]).sub(center),
      );
    }
    const fits = (d: number): boolean => {
      for (const c of corners) {
        const depth = d - c.dot(back);
        if (depth < 0.3) return false;
        const x = (c.dot(right) / depth / tanH) + (cx * d) / depth;
        const y = (c.dot(up) / depth / tanV) + (cy * d) / depth;
        if (x < L || x > R || y < B || y > T) return false;
      }
      return true;
    };
    let lo = 0.5;
    let hi = 400;
    if (fits(hi) && R > L && T > B) {
      for (let i = 0; i < 40; i++) {
        const mid = (lo + hi) / 2;
        if (fits(mid)) hi = mid;
        else lo = mid;
      }
    }
    const d = hi;
    // slide so the box centre (at depth d) projects to (cx, cy)
    const shift = right.clone().multiplyScalar(-cx * tanH * d).addScaledVector(up, -cy * tanV * d);
    this._camGoalLook.copy(center).add(shift);
    this._camGoalPos.copy(this._camGoalLook).addScaledVector(back, d);
  }

  private _topInset(): number {
    const { h } = viewportSize();
    // headline + sub + bonus card band
    return Math.min(h * 0.36, 236);
  }

  private _frameRow(): void {
    this._framing = () => {
      const half = Math.max(1, this._seats.length) * this._spacing * 0.5;
      this._frameBox([-half, 0, -0.9], [half, 2.3, 0.9], { top: this._topInset(), bottom: 70 });
    };
    this._framing();
  }

  private _frameSeat(seat: Seat): void {
    this._framing = () => {
      const p = seat.ch.group.position;
      this._frameBox([p.x - 1.5, p.y, p.z - 0.8], [p.x + 1.5, p.y + seat.height + 1.3, p.z + 0.8], { top: this._topInset(), bottom: 80 });
    };
    this._framing();
  }

  private _podiumBox(): { min: [number, number, number]; max: [number, number, number] } {
    const n = Math.min(this._seats.length, PODIUM.length);
    let lo = -1;
    let hi = 1;
    for (let k = 0; k < n; k++) {
      lo = Math.min(lo, PODIUM[k].x - 1.1);
      hi = Math.max(hi, PODIUM[k].x + 1.1);
    }
    return { min: [lo, 0, -0.9], max: [hi, 3.5, 1.2] };
  }

  private _framePodium(insets?: { top: number; bottom: number; left?: number; right?: number }): void {
    this._framing = () => {
      const b = this._podiumBox();
      this._frameBox(b.min, b.max, insets ?? { top: this._topInset() * 0.8, bottom: 70 });
    };
    this._framing();
  }

  private _snapCamera(): void {
    const camera = world.camera;
    if (!camera) return;
    camera.position.copy(this._camGoalPos);
    this._camLook.copy(this._camGoalLook);
    camera.lookAt(this._camLook);
  }

  /* ---------------------------------------------------------------- */
  /*  Lights                                                           */
  /* ---------------------------------------------------------------- */

  private _applyLight(level: number): void {
    const k = 0.22 + 0.78 * level;
    for (const d of this._dimmables) d.mat.color.copy(d.base).multiplyScalar(k);
    for (const l of this._lights0) l.light.intensity = l.intensity * (0.3 + 0.7 * level);
  }

  private _aimSpot(i: number, x: number, z: number, floorY: number, level: number): void {
    const s = this._spots[i];
    if (!s) return;
    s.x = x;
    s.z = z;
    s.floorY = floorY;
    s.goal = level;
  }

  private _spotOnSeat(i: number, seat: Seat | undefined, level = 1): void {
    if (!seat) return;
    const p = seat.ch.group.position;
    this._aimSpot(i, p.x, p.z, p.y, level);
  }

  private _spotsOff(): void {
    for (const s of this._spots) s.goal = 0;
  }

  /* ---------------------------------------------------------------- */
  /*  Timeline                                                         */
  /* ---------------------------------------------------------------- */

  private _buildBeats(): void {
    const beats: Beat[] = [];
    const R = this._results;
    const n = this._seats.length;
    if (n === 0) {
      beats.push(this._summaryBeat());
      this._beats = beats;
      return;
    }
    beats.push(this._introBeat());
    if (R.bonuses.length > 0) {
      beats.push(
        new BeatBuilder("bonus-intro", 1.9).at(0, () => {
          this._frameRow();
          this._camK = 2.4;
          this._lightGoal = 0.75;
          this._say("BONUS STARS!", palette.sun, "Who earned the extra stars?");
          this._sfx("crowd.ooh");
          this._sfx("whoosh");
        }).beat,
      );
      R.bonuses.forEach((b, i) => beats.push(this._bonusBeat(b.star, b.playerId, i)));
    }
    if (n >= 2) {
      beats.push(
        new BeatBuilder("places-intro", 1.7).at(0, () => {
          this._hideCard();
          this._frameRow();
          this._camK = 2.4;
          this._lightGoal = 0.5;
          this._spotsOff();
          this._say("FINAL STANDINGS", palette.cream, "From last place up…");
          this._sfx("whoosh");
          for (const s of this._seats) s.ch.anim.idle();
        }).beat,
      );
      for (let place = n - 1; place >= 1; place--) beats.push(this._placeBeat(place));
      beats.push(this._suspenseBeat());
    }
    beats.push(this._winnerBeat());
    beats.push(this._summaryBeat());
    this._beats = beats;
  }

  private _introBeat(): Beat {
    const COUNT_FROM = 1.3;
    const COUNT_DUR = 1.4;
    return new BeatBuilder("intro", 3.4)
      .at(0, () => {
        this._lightGoal = 1;
        this._sfx("crowd.cheer");
      })
      .at(0.5, () => {
        this._say("FINAL RESULTS", palette.sun, "The party's over! Let's count it up.");
        this._sfx("pop", 0.7);
      })
      .at(1.0, () => {
        for (const s of this._seats) s.plate.classList.add("on");
        this._sfx("coin.gain", 0.6);
      })
      .tick((lt) => {
        if (this._fade) this._fade.style.opacity = String(1 - clamp01(lt / 0.7));
        const p = easeOutCubic(clamp01((lt - COUNT_FROM) / COUNT_DUR));
        for (const s of this._seats) {
          const st = this._stats(s.pid);
          this._setPlate(s, Math.round(p * st.boardStars), Math.round(p * st.coins));
        }
      }).beat;
  }

  /**
   * One bonus star: card, drumroll with a hopping spotlight that slows down
   * and lands on the winner, the hit, a star drops onto them.
   */
  private _bonusBeat(kind: BonusStarKind, pid: number, index: number): Beat {
    const info = BONUS_INFO[kind];
    const seat = this._seat(pid);
    const n = this._seats.length;
    const SWEEP_AT = 1.1;
    const SWEEP_DUR = 3.0;
    const HIT = SWEEP_AT + SWEEP_DUR;
    const DROP = 1.0;

    // Spotlight hops: ping-pong over the row, at least 9 hops, ending on the
    // winner; gaps grow so it visibly slows into the answer.
    const target = seat ? this._seats.indexOf(seat) : 0;
    const order: number[] = [];
    if (n > 1) {
      const cycle: number[] = [];
      for (let i = 0; i < n; i++) cycle.push(i);
      for (let i = n - 2; i >= 1; i--) cycle.push(i);
      let j = Math.floor(this._rng() * cycle.length);
      while (order.length < 9 || order[order.length - 1] !== target) {
        order.push(cycle[j % cycle.length]);
        j++;
        if (order.length > 40) break;
      }
    } else {
      order.push(0);
    }
    const gaps = order.map((_, i) => 0.08 + Math.pow(i / Math.max(1, order.length - 1), 2.3));
    const scale = SWEEP_DUR / gaps.reduce((a, b) => a + b, 0);
    const times: number[] = [];
    let acc = 0;
    for (const g of gaps) {
      times.push(acc);
      acc += g * scale;
    }
    let lastHop = -1;

    const st = this._stats(pid);
    const mine = this._statFor(kind, pid);
    const best = Math.max(...this._seats.map((s) => this._statFor(kind, s.pid)));
    const runnerUp = kind === "coin" && mine < best;
    const tied = this._seats.filter((s) => this._statFor(kind, s.pid) === mine).length > 1;
    const why = runnerUp
      ? "One bonus star each, so the runner-up gets it!"
      : tied
        ? `A tie at ${count(mine, info.unit)}! The lucky draw picked them.`
        : `${info.title}: ${count(mine, info.unit)}`;

    return new BeatBuilder(`bonus-${kind}`, HIT + DROP + 1.5)
      .at(0, () => {
        lastHop = -1;
        this._frameRow();
        this._camK = 2.4;
        this._lightGoal = 0.6;
        this._spotsOff();
        for (const s of this._seats) s.ch.anim.idle();
        this._say(index === 0 ? "THE FIRST ONE…" : index === 1 ? "NEXT UP…" : "ONE MORE…", palette.cream);
        this._showCard(kind);
        this._sfx("whoosh");
      })
      .at(SWEEP_AT, () => {
        this._lightGoal = 0.35;
        this._say(info.title, info.color, "goes to…");
        this._drumroll(true);
      })
      .at(HIT, () => {
        this._hit();
        this._lightGoal = 1;
        this._flashScreen(0.6);
        if (seat) {
          this._spotOnSeat(0, seat, 1);
          this._frameSeat(seat);
          this._camK = 3;
          seat.ch.anim.jump();
        }
        this._say(
          `${playerLabel(pid).toUpperCase()}!`,
          seat?.color ?? palette.sun,
          why,
        );
        for (const [cpid, chip] of this._chipEls) {
          chip.classList.toggle("win", cpid === pid);
          chip.classList.toggle("dim", cpid !== pid);
        }
        this._sfx("crowd.cheer");
        if (this._star && seat) this._star.visible = true;
      })
      .at(HIT + DROP, () => {
        if (this._star) this._star.visible = false;
        if (seat) {
          seat.starTarget += 1;
          this._setPlate(seat, seat.starTarget, st.coins);
          this._bumpPlate(seat);
          seat.ch.anim.cheer();
          const head = seat.ch.group.position.clone();
          head.y += seat.height + 0.3;
          this._sparkles(head, 18);
        }
        this._sfx("star.get");
      })
      .at(HIT + DROP + 1.4, () => {
        this._hideCard();
      })
      .tick((lt) => {
        // hopping spotlight
        if (lt >= SWEEP_AT && lt < HIT && n > 0) {
          const t = lt - SWEEP_AT;
          let hop = 0;
          while (hop + 1 < times.length && times[hop + 1] <= t) hop++;
          if (hop !== lastHop) {
            lastHop = hop;
            this._spotOnSeat(0, this._seats[order[hop]], 1);
            const sp = this._spots[0];
            if (sp) sp.level = 1;
            this._sfx("pop", 0.22);
          }
        }
        // star drop: falls from the rafters, spinning, onto the winner's head
        if (this._star && seat && lt >= HIT) {
          const p = clamp01((lt - HIT) / DROP);
          const head = seat.ch.group.position;
          const e = easeOutBack(p);
          this._star.position.set(head.x, head.y + seat.height + 0.55 + (1 - e) * 6.5, head.z + 0.2);
          this._star.rotation.y = p * Math.PI * 6;
          this._star.scale.setScalar(0.6 + 0.6 * Math.sin(Math.PI * p) + 0.3 * (1 - p));
        }
      }).beat;
  }

  private _placeBeat(place: number): Beat {
    const seat = this._seatAtPlace(place);
    const last = place === this._seats.length - 1;
    const entry = this._results.ranking[place];
    const ord = ORDINAL[place] ?? `${place + 1}TH`;
    return new BeatBuilder(`place-${place + 1}`, 2.4)
      .at(0, () => {
        if (!seat) return;
        this._lightGoal = 0.45;
        this._spotOnSeat(0, seat, 1);
        const sp = this._spots[0];
        if (sp) sp.level = 1;
        this._frameSeat(seat);
        this._camK = 3.2;
        this._say(`${ord} PLACE`, palette.cream, playerLabel(seat.pid), seat.color);
        seat.badge.textContent = ord;
        seat.badge.classList.add("on");
        if (entry) this._setPlate(seat, entry.stars, entry.coins);
        if (place === 1) seat.ch.anim.squash();
        else seat.ch.anim.sad();
        this._sfx(last ? "sad" : "boing", 0.8);
        this._sfx("crowd.aah", 0.6);
      })
      .at(1.0, () => {
        if (place === 1 && seat) seat.ch.anim.sad();
      }).beat;
  }

  private _suspenseBeat(): Beat {
    return new BeatBuilder("suspense", 3.4)
      .at(0, () => {
        this._frameRow();
        this._camK = 1.6;
        this._lightGoal = 0.08;
        this._say("THE SUPER STAR IS…", palette.sun);
        this._drumroll(true);
        for (const sp of this._spots) sp.goal = 0.8;
      })
      .tick((lt) => {
        // three beams wander across the row in the dark
        const half = Math.max(1, this._seats.length) * this._spacing * 0.5;
        this._spots.forEach((sp, i) => {
          sp.x = Math.sin(lt * (1.6 + i * 0.55) + i * 2.1) * half;
          sp.z = 0;
          sp.floorY = 0;
        });
      }).beat;
  }

  private _winnerBeat(): Beat {
    const winner = this._seatAtPlace(0);
    const RISE = 0.9;
    const HOP_AT = 0.55;
    const HOP = 0.8;
    const from = new Map<Seat, THREE.Vector3>();
    const youWon = !!winner && isYou(winner.pid) && playerLabel(winner.pid) === "You";
    const label = winner
      ? youWon
        ? "YOU'RE THE SUPER STAR!"
        : `${playerLabel(winner.pid).toUpperCase()} IS THE SUPER STAR!`
      : "THE SUPER STAR!";
    const top = this._results.ranking[0];
    return new BeatBuilder("winner", 7.2)
      .at(0, () => {
        this._hit();
        this._lightGoal = 1;
        this._light = 1;
        this._flashScreen(0.95);
        this._say(label, winner?.color ?? palette.sun, top ? `★ ${count(top.stars, "star")} · ${count(top.coins, "coin")}` : "", palette.sun);
        this._sfx("crowd.cheer");
        if (!this._quiet) audio.music.play("win", { intensity: 1 });
        if (this._podium) this._podium.visible = true;
        for (const s of this._seats) from.set(s, s.ch.group.position.clone());
        this._framePodium();
        this._camK = 2.6;
        this._confettiRate = 70;
      })
      .at(0.25, () => this._cannons())
      .at(HOP_AT, () => {
        for (const s of this._seats) s.ch.anim.jump();
        this._sfx("jump", 0.7);
      })
      .at(HOP_AT + HOP + 0.25, () => {
        for (const s of this._seats) {
          if (s.place === 0) {
            s.ch.anim.cheer();
            s.badge.classList.add("gold");
          } else {
            s.ch.anim.sad();
          }
          s.badge.textContent = ORDINAL[s.place] ?? `${s.place + 1}TH`;
          s.badge.classList.add("on");
          const e = this._results.ranking[s.place];
          if (e) this._setPlate(s, e.stars, e.coins);
        }
        this._sfx("cheer");
        this._sfx("land", 0.7);
        if (winner) {
          const head = winner.ch.group.position.clone();
          head.y += winner.height + 0.3;
          this._sparkles(head, 26, [palette.sun, palette.cream, palette.mint, palette.candy]);
        }
      })
      .at(1.9, () => this._cannons())
      .at(2.2, () => {
        if (winner) {
          this._frameSeat(winner);
          this._camK = 1.4;
        }
      })
      .at(3.8, () => this._cannons())
      .tick((lt) => {
        // podium rises out of the stage floor
        if (this._podium) this._podium.position.y = -1.6 + 1.6 * easeOutBack(clamp01(lt / RISE));
        // everyone hops from the row onto their step (staggered by place)
        for (const s of this._seats) {
          const a = from.get(s);
          if (!a) continue;
          const spot = PODIUM[Math.min(s.place, PODIUM.length - 1)];
          const extra = Math.max(0, s.place - PODIUM.length + 1) * 1.6;
          const tx = spot.x + extra;
          const tz = spot.z + 0.05;
          const ty = extra > 0 ? 0 : spot.h;
          const p = clamp01((lt - HOP_AT - s.place * 0.08) / HOP);
          const e = easeInOutCubic(p);
          s.ch.group.position.set(a.x + (tx - a.x) * e, a.y + (ty - a.y) * e + Math.sin(Math.PI * p) * 1.7, a.z + (tz - a.z) * e);
        }
        // beams: warm one on the winner, colored ones sweeping
        if (winner) this._spotOnSeat(0, winner, 1);
        const sweep = Math.sin(lt * 1.3) * 2.4;
        this._aimSpot(1, -1.6 + sweep * 0.6, 0.4, 0, 0.75);
        this._aimSpot(2, 1.6 - sweep * 0.6, 0.4, 0, 0.75);
        this._orbit = lt > 2.2 ? Math.sin((lt - 2.2) * 0.5) * 0.45 : 0;
      }).beat;
  }

  private _summaryBeat(): Beat {
    return new BeatBuilder("summary", Infinity)
      .at(0, () => {
        this._drumroll(false);
        audio.music.play("results", { intensity: 0.9 });
        if (this._fade) this._fade.style.opacity = "0";
        this._orbit = 0;
        this._lightGoal = 1;
        this._confettiRate = 18;
        if (this._skipBtn) this._skipBtn.style.display = "none";
        if (this._hint) this._hint.style.display = "none";
        this._hideCard();
        const w = this._seatAtPlace(0);
        if (w) {
          const you = isYou(w.pid) && playerLabel(w.pid) === "You";
          this._say(you ? "YOU WIN!" : `${playerLabel(w.pid).toUpperCase()} WINS!`, w.color);
        } else {
          this._say("FINAL RESULTS", palette.sun);
        }
        this._showSummary();
      })
      .tick((lt) => {
        const w = this._seatAtPlace(0);
        if (w) this._spotOnSeat(0, w, 1);
        const sweep = Math.sin(lt * 0.9) * 2.4;
        this._aimSpot(1, -1.6 + sweep * 0.6, 0.4, 0, 0.5);
        this._aimSpot(2, 1.6 - sweep * 0.6, 0.4, 0, 0.5);
      }).beat;
  }

  /* ---------------------------------------------------------------- */
  /*  Summary card                                                     */
  /* ---------------------------------------------------------------- */

  private _showSummary(): void {
    const dom = this._dom;
    if (!dom) return;
    for (const s of this._seats) s.plate.classList.remove("on");
    const { w, h } = viewportSize();
    const wide = w > h * 1.15 && w >= 700;
    const card = document.createElement("div");
    card.className = `ssp-fin-sum ${wide ? "wide" : "portrait"}`;
    card.dataset.sspResults = "finale";
    const title = document.createElement("div");
    title.className = "ssp-fin-sum__title";
    title.textContent = "FINAL RESULTS";
    card.appendChild(title);
    this._results.ranking.forEach((r, i) => {
      const p = match.players[r.playerId];
      const st = this._stats(r.playerId);
      const row = document.createElement("div");
      row.className = `ssp-fin-row${i === 0 ? " first" : ""}`;
      row.dataset.sspPlayer = String(r.playerId);
      const place = document.createElement("div");
      place.className = "ssp-fin-row__place";
      place.textContent = ORDINAL[i] ?? `${i + 1}TH`;
      const who = document.createElement("div");
      who.className = "ssp-fin-row__who";
      const name = document.createElement("div");
      name.className = "ssp-fin-row__name";
      const dot = document.createElement("span");
      dot.className = "ssp-fin-dot";
      dot.style.background = characterColor(p?.kind ?? "pip");
      const nm = document.createElement("span");
      nm.textContent = p ? playerLabel(p.id) : "?";
      name.append(dot, nm);
      const meta = document.createElement("div");
      meta.className = "ssp-fin-row__meta";
      const wins = document.createElement("span");
      wins.textContent = count(st.minigameWins, "minigame win");
      meta.appendChild(wins);
      for (const b of r.bonus) {
        const tag = document.createElement("span");
        tag.className = "ssp-fin-tag";
        tag.textContent = `★${BONUS_SHORT[b]}`;
        meta.appendChild(tag);
      }
      who.append(name, meta);
      const stars = document.createElement("div");
      stars.className = "ssp-fin-row__stars";
      stars.textContent = `★${r.stars}`;
      const coins = document.createElement("div");
      coins.className = "ssp-fin-row__coins";
      const coin = document.createElement("span");
      coin.className = "ssp-fin-coin";
      coins.append(coin, String(r.coins));
      row.append(place, who, stars, coins);
      card.appendChild(row);
    });
    const btns = document.createElement("div");
    btns.className = "ssp-fin-btns";
    const play = ui.button({
      label: "PLAY AGAIN",
      kind: "gold",
      size: "lg",
      sound: null,
      ariaLabel: "Play again: a new match with the same players",
      onClick: () => this._playAgain(),
    });
    const menu = ui.button({
      label: "MAIN MENU",
      kind: "primary",
      size: "lg",
      sound: null,
      ariaLabel: "Back to the main menu",
      onClick: () => this._goTitle(),
    });
    btns.append(play.el, menu.el);
    card.appendChild(btns);
    this._buttons = [play, menu];
    dom.appendChild(card);
    void card.offsetWidth;
    card.classList.add("on");
    this._applyHighlight();

    // frame the podium in the space the card leaves
    const head = this._head;
    const topInset = (head ? head.getBoundingClientRect().bottom : 80) + 24;
    if (wide) {
      this._framePodium({ top: topInset, bottom: 30, left: 20, right: card.offsetWidth + 48 });
    } else {
      this._framePodium({ top: topInset, bottom: Math.min(h * 0.62, card.offsetHeight + 34), left: 8, right: 8 });
    }
    this._camK = 2.2;
  }

  private _applyHighlight(): void {
    this._buttons.forEach((b, i) => {
      const on = i === this._highlighted;
      b.el.style.transform = on ? "scale(1.06)" : "";
      b.el.style.outline = on ? `3px solid ${palette.ink}` : "";
      b.el.style.outlineOffset = on ? "3px" : "";
    });
  }

  /* ---------------------------------------------------------------- */
  /*  Beat runner                                                      */
  /* ---------------------------------------------------------------- */

  private _isSummary(): boolean {
    return this._beats[this._bi]?.name === "summary";
  }

  private _startBeat(): void {
    this._lt = 0;
    const beat = this._beats[this._bi];
    if (!beat) return;
    for (const c of beat.cues) c.fired = false;
    this._fireCues(beat, 0);
  }

  private _fireCues(beat: Beat, upTo: number): void {
    for (const c of beat.cues) {
      if (!c.fired && c.at <= upTo) {
        c.fired = true;
        c.fn();
      }
    }
  }

  /** Run the rest of the current beat instantly (silently) and start the next. */
  private _finishBeat(): void {
    const beat = this._beats[this._bi];
    if (!beat || !Number.isFinite(beat.dur)) return;
    const wasQuiet = this._quiet;
    this._quiet = true;
    this._fireCues(beat, beat.dur);
    beat.tick?.(beat.dur, 0);
    this._quiet = wasQuiet;
    this._bi++;
    this._startBeat();
  }

  /** Tap / Space: hurry to the next beat. */
  private _advanceBeat(): void {
    if (this._leaving || this._isSummary()) return;
    if (this._lt < 0.25) return; // a tap must not swallow a beat that just started
    this._finishBeat();
  }

  /** SKIP / Escape: straight to the results card. */
  private _skipAll(): void {
    if (this._leaving || this._isSummary()) return;
    this._quiet = true;
    let guard = 0;
    while (!this._isSummary() && this._bi < this._beats.length && guard++ < 64) this._finishBeat();
    this._quiet = false;
    this._drumroll(false);
    audio.music.restoreDuck(0.2);
    this._light = this._lightGoal;
    this._snapCamera();
    for (const sp of this._spots) sp.level = sp.goal;
  }

  /* ---------------------------------------------------------------- */
  /*  Input                                                            */
  /* ---------------------------------------------------------------- */

  private _onKey(e: KeyboardEvent): void {
    if (this._leaving) return;
    if (!this._isSummary()) {
      if (e.key === "Escape") {
        e.preventDefault();
        this._skipAll();
      } else if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        this._advanceBeat();
      }
      return;
    }
    if (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "Tab") {
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
  }

  private _leaveRoom(): void {
    // The friends room is over once the finale shows; leave it cleanly.
    if (onlineMatch()) {
      try {
        dropOut();
      } catch {
        /* relay already gone */
      }
    }
    setOnlineMatch(false);
  }

  private _playAgain(): void {
    if (this._leaving) return;
    this._leaving = true;
    audio.sfx.play("fanfare.win");
    // Same roster and length as the match just played. A rematch is always a
    // local match (the friends room has closed by now).
    const kinds = match.players.map((p) => p.kind);
    const names = match.players.map((p) => p.name);
    const turns = match.totalTurns > 0 ? match.totalTurns : 10;
    this._leaveRoom();
    startMatch(kinds, names, turns);
    screens.goto("board");
  }

  private _goTitle(): void {
    if (this._leaving) return;
    this._leaving = true;
    audio.sfx.play("ui.back");
    this._leaveRoom();
    screens.goto("title");
  }

  /* ---------------------------------------------------------------- */
  /*  Update                                                           */
  /* ---------------------------------------------------------------- */

  update(dt: number): void {
    const camera = world.camera;
    if (!camera || !this._root3d) return;
    this._t += dt;

    // timeline
    const beat = this._beats[this._bi];
    if (beat && !this._leaving) {
      this._lt += dt;
      this._fireCues(beat, this._lt);
      beat.tick?.(Math.min(this._lt, beat.dur), dt);
      if (this._lt >= beat.dur && this._bi < this._beats.length - 1) {
        this._bi++;
        this._startBeat();
      }
    }

    // characters
    for (const s of this._seats) s.ch.update(dt);

    // lights
    this._light += (this._lightGoal - this._light) * damp(5, dt);
    this._applyLight(this._light);
    for (const sp of this._spots) {
      sp.level += (sp.goal - sp.level) * damp(8, dt);
      sp.group.visible = sp.level > 0.01;
      sp.group.position.set(sp.x, 0, sp.z);
      sp.disc.position.y = sp.floorY + 0.03;
      const flicker = 0.92 + 0.08 * Math.sin(this._t * 23 + sp.x);
      sp.coneMat.opacity = 0.2 * sp.level * flicker;
      sp.discMat.opacity = 0.55 * sp.level;
    }
    // chase lights: every third bulb lit, marching
    const on = this._bulbOn;
    const off = this._bulbOff;
    if (on && off) {
      const step = Math.floor(this._t * 7);
      this._bulbs.forEach((b, i) => {
        b.material = (i + step) % 3 === 0 ? on : off;
      });
    }

    // camera
    const k = damp(this._camK, dt);
    let goal = this._camGoalPos;
    if (this._orbit !== 0) {
      const rel = this._camGoalPos.clone().sub(this._camGoalLook);
      rel.applyAxisAngle(new THREE.Vector3(0, 1, 0), this._orbit);
      goal = this._camGoalLook.clone().add(rel);
    }
    camera.position.lerp(goal, k);
    this._camLook.lerp(this._camGoalLook, k);
    camera.lookAt(this._camLook);

    // 3D confetti
    this._updateConfetti(dt);

    // nameplates follow the characters' feet
    camera.updateMatrixWorld();
    for (const s of this._seats) {
      const sc = this._toScreen(s.ch.group.position.clone().add(new THREE.Vector3(0, -0.05, 0.6)));
      if (sc) {
        s.plate.style.left = `${sc.x}px`;
        s.plate.style.top = `${sc.y + 4}px`;
      }
    }
  }

  private _updateConfetti(dt: number): void {
    const mesh = this._confetti;
    if (!mesh) return;
    if (this._confettiRate > 0) {
      this._confettiAcc = Math.min(4, this._confettiAcc + dt * this._confettiRate);
      for (const c of this._confetti3) {
        if (this._confettiAcc < 1) break;
        if (c.live) continue;
        this._confettiAcc -= 1;
        c.live = true;
        c.p.set((this._rng() - 0.5) * 11, 8 + this._rng() * 2, -1.5 + this._rng() * 3);
        c.v.set((this._rng() - 0.5) * 0.6, -(1.3 + this._rng() * 1.2), 0);
        c.r.set(this._rng() * 6, this._rng() * 6, this._rng() * 6);
        c.spin.set(2 + this._rng() * 5, 1 + this._rng() * 4, 2 + this._rng() * 5);
        c.phase = this._rng() * 6;
      }
    }
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const one = new THREE.Vector3(1, 1, 1);
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    this._confetti3.forEach((c, i) => {
      if (c.live) {
        c.p.x += (c.v.x + Math.sin(this._t * 3 + c.phase) * 0.5) * dt;
        c.p.y += c.v.y * dt;
        c.r.x += c.spin.x * dt;
        c.r.y += c.spin.y * dt;
        c.r.z += c.spin.z * dt;
        if (c.p.y < -0.2) c.live = false;
      }
      if (!c.live) {
        mesh.setMatrixAt(i, zero);
        return;
      }
      q.setFromEuler(c.r);
      m.compose(c.p, q, one);
      mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
  }

  render(): void {}

  /* ---------------------------------------------------------------- */
  /*  Exit                                                             */
  /* ---------------------------------------------------------------- */

  exit(): void {
    this._leaving = true;
    for (const off of this._offs) off();
    this._offs = [];
    this._drumroll(false);
    audio.music.restoreDuck(0.2);
    audio.music.stop(0.3);

    for (const b of this._buttons) b.destroy();
    this._buttons = [];
    this._dom?.remove();
    this._dom = null;
    this._head = null;
    this._sub = null;
    this._card = null;
    this._fade = null;
    this._flash = null;
    this._hint = null;
    this._skipBtn = null;
    this._chipEls.clear();

    const scene = world.scene;
    const camera = world.camera;
    for (const s of this._seats) {
      s.ch.group.removeFromParent();
      try {
        s.ch.dispose();
      } catch {
        /* already gone */
      }
    }
    this._seats = [];
    this._root3d?.removeFromParent();
    this._root3d = null;
    this._podium = null;
    this._star = null;
    this._confetti?.dispose();
    this._confetti = null;
    this._spots = [];
    this._bulbs = [];
    this._bulbOn = null;
    this._bulbOff = null;
    for (const m of this._disposeMats) m.dispose();
    for (const g of this._disposeGeos) g.dispose();
    for (const t of this._disposeTexs) t.dispose();
    this._disposeMats = [];
    this._disposeGeos = [];
    this._disposeTexs = [];
    this._dimmables = [];

    for (const l of this._lights0) l.light.intensity = l.intensity;
    this._lights0 = [];
    if (scene) {
      scene.background = this._bg0;
      scene.fog = this._fog0;
    }
    if (camera) {
      camera.fov = this._fov0;
      camera.updateProjectionMatrix();
    }
    this._beats = [];
    this._framing = null;
    clearFinalResults();
    ui.clearScreen();
  }
}

export const matchFinale: Screen = new FinaleScreen();

/** Exported entry for orchestrator wiring (phase === 'ended' → finale). */
export function startFinale(): void {
  screens.goto("finale");
}
