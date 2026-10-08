/**
 * SUPER STAR PARTY — the MP7-grade title screen (Wave 4).
 *
 * A living front door: a slow carnival backdrop (the full Fizzy Fairground
 * board scene behind a hero character on a pedestal), a chunky animated
 * "SUPER STAR PARTY" wordmark with sparkles, and a three-button menu
 * (PLAY / HOW TO PLAY / SETTINGS) with full keyboard + touch nav, MP7-style
 * hover/press bounce, live audio, persisted settings and a polished scale
 * wipe on exit.
 *
 * Everything visual comes from the palette + UI kit; no hand-rolled buttons
 * or off-palette colors. Music uses only the existing "title" track id.
 */
import * as THREE from "three";
import { palette, hex } from "../config/palette";
import { ui } from "../ui/kit";
import { audio } from "../audio/audioEngine";
import { settings } from "../config/settings";
import { world } from "../main";
import { screens } from "./screenManager";
import { createCharacter, type Character } from "../characters/characterFactory";
import { buildBoardScene, type BoardScene } from "../board/boardScene";
import { fizzyFairground } from "../board/boardData";
import { getMusicGain, setMusicGain, getSfxGain, setSfxGain } from "../ui/sound";
import { mountPackPicker } from "../ui/packPicker";
import { setOnlineMatch } from "../net/mode";
import type { Screen } from "./screenManager";

/* ------------------------------------------------------------------ */
/*  Scoped stylesheet (injected once)                                  */
/* ------------------------------------------------------------------ */

let titleStylesInjected = false;

function injectTitleStyles(): void {
  if (titleStylesInjected) return;
  titleStylesInjected = true;
  if (document.getElementById("ssp-title-styles")) return;
  const style = document.createElement("style");
  style.id = "ssp-title-styles";
  style.textContent = `
    .ssp-title-stage {
      position: fixed; inset: 0; z-index: 60;
      display: flex; flex-direction: column;
      align-items: center; justify-content: center;
      pointer-events: none;
      font-family: 'Fredoka', 'Comic Sans MS', sans-serif;
      box-sizing: border-box;
      padding: calc(16px + env(safe-area-inset-top, 0px)) 16px calc(20px + env(safe-area-inset-bottom, 0px));
    }
    .ssp-title-stage > * { pointer-events: auto; }
    .ssp-title-logo {
      font-size: clamp(30px, 8.5vw, 68px);
      font-weight: 700;
      color: ${palette.cream};
      text-shadow:
        3px 3px 0 ${palette.ink},
        -2px -2px 0 ${palette.ink},
        2px -2px 0 ${palette.ink},
        -2px 2px 0 ${palette.ink},
        0 5px 0 rgba(43,29,78,.45);
      letter-spacing: 2px;
      text-align: center;
      padding: 0 16px;
      margin-bottom: clamp(20px, 5vh, 40px);
      animation: sspTLogoBob 2.4s ease-in-out infinite;
      position: relative;
      white-space: normal;
      line-height: 0.95;
      max-width: 92vw;
    }
    .ssp-title-logo::after {
      content: "★";
      position: absolute;
      top: -10px; right: -18px;
      font-size: .55em;
      color: ${palette.sun};
      text-shadow: 2px 2px 0 ${palette.ink};
      animation: sspTLogoStarSpin 3s linear infinite;
    }
    @keyframes sspTLogoBob {
      0%,100% { transform: translateY(0) scale(1); }
      50% { transform: translateY(-12px) scale(1.02); }
    }
    @keyframes sspTLogoStarSpin {
      0% { transform: rotate(0deg) scale(1); }
      50% { transform: rotate(180deg) scale(1.2); }
      100% { transform: rotate(360deg) scale(1); }
    }
    .ssp-title-sparkles {
      position: absolute;
      inset: 0;
      pointer-events: none;
      overflow: hidden;
    }
    .ssp-title-sparkle {
      position: absolute;
      width: 8px; height: 8px;
      background: ${palette.sun};
      border-radius: 50%;
      box-shadow: 0 0 8px ${palette.sun};
      animation: sspTSparkle 1.6s ease-in-out infinite;
    }
    @keyframes sspTSparkle {
      0%,100% { opacity: 0; transform: scale(0); }
      50% { opacity: 1; transform: scale(1); }
    }
    .ssp-title-menu {
      display: flex;
      flex-direction: column;
      gap: clamp(10px, 2.5vh, 18px);
      align-items: center;
      margin-top: clamp(12px, 3vh, 28px);
    }
    .ssp-title-btn {
      transition: transform .14s cubic-bezier(.34,1.56,.64,1),
                  box-shadow .14s ease-out !important;
      width: min(280px, 82vw);
    }
    .ssp-title-btn--sel {
      transform: scale(1.09) !important;
      box-shadow: 0 8px 0 ${palette.ink},
                  0 0 22px rgba(255,210,63,.65) !important;
    }
    .ssp-title-btn:hover { transform: scale(1.05) !important; }
    .ssp-title-settings-overlay {
      position: fixed; inset: 0; z-index: 200;
      background: ${palette.overlay};
      display: flex; align-items: center; justify-content: center;
      animation: sspTFadeIn .18s ease-out;
    }
    @keyframes sspTFadeIn { from { opacity: 0; } to { opacity: 1; } }
    .ssp-title-settings {
      background: ${palette.cream};
      border: 5px solid ${palette.ink};
      border-radius: 28px;
      box-shadow: 0 8px 0 ${palette.ink};
      padding: clamp(20px, 4vw, 32px) clamp(24px, 5vw, 36px);
      width: min(400px, 92vw);
      max-height: min(86vh, 720px);
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: clamp(14px, 3vw, 20px);
      animation: sspTPopIn .22s cubic-bezier(.34,1.56,.64,1);
    }
    @keyframes sspTPopIn {
      from { transform: scale(.8); opacity: 0; }
      to { transform: scale(1); opacity: 1; }
    }
    .ssp-title-settings__title {
      font-size: clamp(22px, 5vw, 30px);
      font-weight: 700;
      color: ${palette.ink};
      text-align: center;
      text-shadow: 2px 2px 0 ${palette.sun};
    }
    .ssp-title-settings__row {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .ssp-title-settings__row > div {
      display: flex;
      justify-content: space-between;
      font-size: 15px;
      font-weight: 600;
      color: ${palette.ink};
    }
    .ssp-title-settings__pct {
      color: ${palette.candy};
      font-variant-numeric: tabular-nums;
    }
    .ssp-title-settings__slider {
      width: 100%;
      accent-color: ${palette.candy};
      height: 24px;
      cursor: pointer;
    }
    .ssp-title-settings__speed {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 15px;
      font-weight: 600;
      color: ${palette.ink};
      flex-wrap: wrap;
    }
    .ssp-title-settings__speedlabel { margin-right: 4px; }
    .ssp-title-settings__speedbtn {
      font-family: inherit;
      font-weight: 700;
      font-size: 14px;
      padding: 6px 16px;
      border-radius: 999px;
      border: 3px solid ${palette.ink};
      background: ${palette.white};
      color: ${palette.ink};
      cursor: pointer;
      transition: transform .12s cubic-bezier(.34,1.56,.64,1), background .12s;
      box-shadow: 0 3px 0 ${palette.ink};
    }
    .ssp-title-settings__speedbtn:active {
      transform: translateY(2px);
      box-shadow: 0 1px 0 ${palette.ink};
    }
    .ssp-title-settings__speedbtn--sel {
      background: ${palette.sun};
      transform: scale(1.06);
    }
    .ssp-title-settings__close {
      align-self: center;
      margin-top: 4px;
      position: sticky;
      bottom: 0;
      z-index: 2;
      background: ${palette.cream};
      box-shadow: 0 -8px 0 ${palette.cream};
    }
  `;
  document.head.appendChild(style);
}

/* ------------------------------------------------------------------ */
/*  Persistent settings (localStorage)                                 */
/* ------------------------------------------------------------------ */

const LS_MUSIC = "ssp.musicVolume";
const LS_SFX = "ssp.sfxVolume";
const LS_SPEED = "ssp.speed";

/* ------------------------------------------------------------------ */
/*  Screen state                                                       */
/* ------------------------------------------------------------------ */

interface TitleState {
  _board?: BoardScene;
  _char?: Character;
  _pedestal?: THREE.Mesh;
  _floatStar?: THREE.Mesh;
  _confettiTimer?: number;
  _t?: number;
  _onKeyDown?: (e: KeyboardEvent) => void;
  _onResize?: () => void;
  _onFirstGesture?: () => void;
  _buttons?: Array<{ el: HTMLButtonElement; destroy: () => void }>;
  _highlighted?: number;
  _stage?: HTMLDivElement;
  _settingsOpen?: boolean;
  _existing?: Set<THREE.Object3D>;
  _applyHighlight: () => void;
  _goPlay: () => void;
  _goHowTo: () => void;
  _openSettings: () => void;
  _showSettingsPanel: () => void;
  _sliderRow: (label: string, initial: number, apply: (v: number) => void) => HTMLDivElement;
}

/* ------------------------------------------------------------------ */
/*  Screen                                                             */
/* ------------------------------------------------------------------ */

const titleImpl: TitleState & Screen = {
  id: "title",

  enter() {
    injectTitleStyles();
    ui.clearScreen();
    setOnlineMatch(false);

    this._t = 0;
    this._highlighted = 0;
    this._settingsOpen = false;
    this._buttons = [];

    // Snapshot existing scene children so exit() only sweeps what we add.
    this._existing = new Set(world.scene?.children ?? []);

    // ---- camera: low party angle, hero in foreground, carnival behind ----
    const cam = world.camera!;
    cam.position.set(0, 2.6, 7.5);
    cam.fov = 45;
    cam.updateProjectionMatrix();
    cam.lookAt(0, 1, 0);

    // ---- backdrop: the full Fizzy Fairground carnival ----
    const board = buildBoardScene(fizzyFairground);
    this._board = board;

    // ---- hero pedestal + character (Pip, the orange star kid) ----
    const pedestal = new THREE.Mesh(
      new THREE.CylinderGeometry(0.7, 0.82, 0.35, 28),
      new THREE.MeshToonMaterial({ color: hex(palette.ink) })
    );
    pedestal.position.set(0, 0.175, 0);
    pedestal.castShadow = true;
    pedestal.receiveShadow = true;
    world.scene?.add(pedestal);
    this._pedestal = pedestal;

    const char = createCharacter("pip");
    char.group.position.set(0, 0.35, 0);
    char.group.scale.setScalar(1.15);
    char.setFacing(0);
    char.anim.idle();
    world.scene?.add(char.group);
    this._char = char;

    // ---- floating star accent ----
    const star = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.38, 0),
      new THREE.MeshToonMaterial({ color: hex(palette.sun) })
    );
    star.position.set(2.4, 2.9, -1.5);
    world.scene?.add(star);
    this._floatStar = star;

    // ---- DOM overlay stage ----
    const stage = document.createElement("div");
    stage.className = "ssp-title-stage";
    document.body.appendChild(stage);
    this._stage = stage;

    // Logo
    const logo = document.createElement("div");
    logo.className = "ssp-title-logo";
    logo.textContent = "SUPER STAR PARTY";
    logo.setAttribute("aria-label", "Super Star Party");
    stage.appendChild(logo);

    // Sparkles container
    const sparkles = document.createElement("div");
    sparkles.className = "ssp-title-sparkles";
    for (let i = 0; i < 10; i++) {
      const sp = document.createElement("div");
      sp.className = "ssp-title-sparkle";
      sp.style.left = `${10 + Math.random() * 80}%`;
      sp.style.top = `${10 + Math.random() * 60}%`;
      sp.style.animationDelay = `${Math.random() * 1.6}s`;
      sp.style.animationDuration = `${1.2 + Math.random() * 1.2}s`;
      sparkles.appendChild(sp);
    }
    stage.appendChild(sparkles);

    // Menu buttons
    const menu = document.createElement("div");
    menu.className = "ssp-title-menu";

    const playBtn = ui.button({
      label: "PLAY",
      kind: "gold",
      size: "lg",
      onClick: () => this._goPlay(),
      sound: "pop",
      ariaLabel: "Play — start the game",
    });
    playBtn.el.classList.add("ssp-title-btn");

    const friendsBtn = ui.button({
      label: "WITH FRIENDS",
      kind: "primary",
      size: "lg",
      onClick: () => screens.goto("friends"),
      sound: "pop",
      ariaLabel: "Play with friends on two phones",
    });
    friendsBtn.el.classList.add("ssp-title-btn");
    friendsBtn.el.dataset.party = "menu";

    const howBtn = ui.button({
      label: "HOW TO PLAY",
      kind: "primary",
      size: "lg",
      onClick: () => this._goHowTo(),
      sound: "pop",
      ariaLabel: "How to play",
    });
    howBtn.el.classList.add("ssp-title-btn");

    const setBtn = ui.button({
      label: "SETTINGS",
      kind: "ghost",
      size: "lg",
      onClick: () => this._openSettings(),
      sound: "pop",
      ariaLabel: "Settings",
    });
    setBtn.el.classList.add("ssp-title-btn");

    this._buttons = [playBtn, friendsBtn, howBtn, setBtn];
    for (const b of this._buttons) menu.appendChild(b.el);
    stage.appendChild(menu);

    // Initial highlight
    this._applyHighlight();

    // ---- keyboard nav ----
    this._onKeyDown = (e: KeyboardEvent) => {
      if (this._settingsOpen) return;
      if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
        e.preventDefault();
        const count = this._buttons?.length ?? 1;
        this._highlighted = ((this._highlighted ?? 0) - 1 + count) % count;
        this._applyHighlight();
        audio.sfx.play("pop");
      } else if (e.key === "ArrowDown" || e.key === "ArrowRight") {
        e.preventDefault();
        const count = this._buttons?.length ?? 1;
        this._highlighted = ((this._highlighted ?? 0) + 1) % count;
        this._applyHighlight();
        audio.sfx.play("pop");
      } else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        const b = this._buttons?.[this._highlighted ?? 0];
        if (b) b.el.click();
      }
    };
    window.addEventListener("keydown", this._onKeyDown);

    // ---- resize keeps the camera framed ----
    this._onResize = () => {
      const cam2 = world.camera;
      if (cam2) cam2.lookAt(0, 1, 0);
    };
    window.addEventListener("resize", this._onResize);

    // ---- first gesture: unlock audio, apply saved volumes, start music ----
    this._onFirstGesture = () => {
      audio.unlock();
      const savedMusic = parseFloat(
        localStorage.getItem(LS_MUSIC) ?? String(settings.musicVolume)
      );
      const savedSfx = parseFloat(
        localStorage.getItem(LS_SFX) ?? String(settings.sfxVolume)
      );
      setMusicGain(savedMusic);
      setSfxGain(savedSfx);
      if (audio.music.track() === "silence") {
        audio.music.play("title", { intensity: 0.6 });
      }
      window.removeEventListener("pointerdown", this._onFirstGesture!);
      window.removeEventListener("keydown", this._onFirstGesture!);
    };
    window.addEventListener("pointerdown", this._onFirstGesture);
    window.addEventListener("keydown", this._onFirstGesture);

    // ---- ambient confetti (periodic, no sfx) ----
    ui.confettiBurst(undefined, undefined, { sound: null });
    this._confettiTimer = window.setInterval(() => {
      ui.confettiBurst(
        Math.random() * window.innerWidth,
        window.innerHeight * (0.25 + Math.random() * 0.2),
        { sound: null, count: 28 }
      );
    }, 2400);
  },

  /* ---- highlight state ---- */
  _applyHighlight() {
    const idx = this._highlighted ?? 0;
    this._buttons?.forEach((b, i) => {
      if (i === idx) b.el.classList.add("ssp-title-btn--sel");
      else b.el.classList.remove("ssp-title-btn--sel");
    });
  },

  /* ---- actions ---- */
  _goPlay() {
    audio.sfx.play("fanfare.win");
    ui.confettiBurst(window.innerWidth / 2, window.innerHeight * 0.4, {
      sound: null,
      count: 80,
    });
    screens.goto("select");
  },

  _goHowTo() {
    audio.sfx.play("pop");
    screens.goto("howto");
  },

  _openSettings() {
    if (this._settingsOpen) return;
    this._settingsOpen = true;
    audio.sfx.play("pop");
    this._showSettingsPanel();
  },

  /* ---- settings panel ---- */
  _showSettingsPanel() {
    const overlay = document.createElement("div");
    overlay.className = "ssp-title-settings-overlay";

    const panel = document.createElement("div");
    panel.className = "ssp-title-settings";

    // Title
    const titleEl = document.createElement("div");
    titleEl.className = "ssp-title-settings__title";
    titleEl.textContent = "⚙ SETTINGS";
    panel.appendChild(titleEl);

    // Music volume
    panel.appendChild(
      this._sliderRow("🎵 MUSIC VOLUME", getMusicGain(), (v: number) => {
        localStorage.setItem(LS_MUSIC, String(v));
        setMusicGain(v);
      })
    );

    // SFX volume
    panel.appendChild(
      this._sliderRow("🔊 SFX VOLUME", getSfxGain(), (v: number) => {
        localStorage.setItem(LS_SFX, String(v));
        setSfxGain(v);
      })
    );

    // Game speed selector
    const speedRow = document.createElement("div");
    speedRow.className = "ssp-title-settings__speed";
    const speedLabel = document.createElement("span");
    speedLabel.className = "ssp-title-settings__speedlabel";
    speedLabel.textContent = "⏱ GAME SPEED";
    speedRow.appendChild(speedLabel);

    const savedSpeed = parseFloat(localStorage.getItem(LS_SPEED) ?? "1");
    const speedOpts: Array<{ label: string; val: number }> = [
      { label: "1×", val: 1 },
      { label: "1.5×", val: 1.5 },
      { label: "2×", val: 2 },
    ];
    const speedBtnEls: HTMLButtonElement[] = [];
    for (const opt of speedOpts) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "ssp-title-settings__speedbtn";
      b.textContent = opt.label;
      if (opt.val === savedSpeed) b.classList.add("ssp-title-settings__speedbtn--sel");
      b.addEventListener("click", () => {
        localStorage.setItem(LS_SPEED, String(opt.val));
        for (const el of speedBtnEls) el.classList.remove("ssp-title-settings__speedbtn--sel");
        b.classList.add("ssp-title-settings__speedbtn--sel");
        const url = new URL(window.location.href);
        url.searchParams.set("speed", String(opt.val));
        window.location.href = url.toString();
      });
      speedBtnEls.push(b);
      speedRow.appendChild(b);
    }
    panel.appendChild(speedRow);

    panel.appendChild(mountPackPicker().el);

    // Close button
    const closeBtn = ui.button({
      label: "CLOSE",
      kind: "gold",
      size: "md",
      sound: "ui.back",
      onClick: () => {
        this._settingsOpen = false;
        overlay.remove();
      },
    });
    closeBtn.el.classList.add("ssp-title-settings__close");
    closeBtn.el.style.width = "160px";
    panel.appendChild(closeBtn.el);

    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    // Click scrim to close
    overlay.addEventListener("pointerdown", (e) => {
      if (e.target === overlay) {
        this._settingsOpen = false;
        overlay.remove();
      }
    });
  },

  _sliderRow(
    label: string,
    initial: number,
    apply: (v: number) => void
  ): HTMLDivElement {
    const row = document.createElement("div");
    row.className = "ssp-title-settings__row";

    const labelRow = document.createElement("div");
    const lab = document.createElement("span");
    lab.textContent = label;
    const pct = document.createElement("span");
    pct.className = "ssp-title-settings__pct";
    pct.textContent = `${Math.round(initial * 100)}%`;
    labelRow.append(lab, pct);

    const input = document.createElement("input");
    input.type = "range";
    input.min = "0";
    input.max = "1";
    input.step = "0.01";
    input.value = String(initial);
    input.className = "ssp-title-settings__slider";
    input.setAttribute("aria-label", label);
    input.addEventListener("input", () => {
      const v = Number(input.value);
      pct.textContent = `${Math.round(v * 100)}%`;
      apply(v);
    });

    row.append(labelRow, input);
    return row;
  },

  /* ---- cleanup ---- */
  exit() {
    if (this._confettiTimer !== undefined) {
      window.clearInterval(this._confettiTimer);
      this._confettiTimer = undefined;
    }
    if (this._onKeyDown) {
      window.removeEventListener("keydown", this._onKeyDown);
      this._onKeyDown = undefined;
    }
    if (this._onResize) {
      window.removeEventListener("resize", this._onResize);
      this._onResize = undefined;
    }
    if (this._onFirstGesture) {
      window.removeEventListener("pointerdown", this._onFirstGesture);
      window.removeEventListener("keydown", this._onFirstGesture);
      this._onFirstGesture = undefined;
    }
    if (this._char) {
      world.scene?.remove(this._char.group);
      this._char.dispose();
      this._char = undefined;
    }
    if (this._pedestal) {
      world.scene?.remove(this._pedestal);
      this._pedestal.geometry.dispose();
      (this._pedestal.material as THREE.Material).dispose();
      this._pedestal = undefined;
    }
    if (this._floatStar) {
      world.scene?.remove(this._floatStar);
      this._floatStar.geometry.dispose();
      (this._floatStar.material as THREE.Material).dispose();
      this._floatStar = undefined;
    }
    this._board?.dispose();
    this._board = undefined;
    this._stage?.remove();
    this._stage = undefined;
    this._buttons = undefined;
    document.querySelectorAll(".ssp-title-settings-overlay").forEach((el) => el.remove());
    ui.clearScreen();
  },

  /* ---- per-frame ---- */
  update(dt: number) {
    this._t = (this._t ?? 0) + dt;
    const t = this._t;

    this._char?.update(dt);
    this._board?.update(dt);

    if (this._floatStar) {
      this._floatStar.rotation.y += dt * 1.4;
      this._floatStar.position.y = 2.9 + Math.sin(t * 1.7) * 0.18;
    }

    const cam = world.camera;
    if (cam) {
      const baseY = 2.6;
      const baseZ = 7.5;
      cam.position.x = Math.sin(t * 0.11) * 0.5;
      cam.position.y = baseY + Math.sin(t * 0.19) * 0.06;
      cam.position.z = baseZ + Math.cos(t * 0.09) * 0.3;
      cam.lookAt(0, 1 + Math.sin(t * 0.15) * 0.04, 0);
    }
  },

  render() {},
};

export const titleScreen = titleImpl as Screen;
