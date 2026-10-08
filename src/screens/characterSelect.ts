/**
 * SUPER STAR PARTY — character select screen ('select').
 *
 * MP7-style: 4 characters on pedestals in 3D, each with a name plate +
 * tagline card. The selected character steps forward under a bright
 * spotlight; the others sit idle with a "CPU" badge. Tap a card or a
 * character, use arrows/keys to cycle, START! confirms (chosen character
 * becomes the local seat, the rest CPU seats), BACK returns to the title.
 */
import * as THREE from "three";
import { world } from "../main";
import { palette, hex } from "../config/palette";
import { startMatch } from "../core/game";
import { setOnlineMatch } from "../net/mode";
import type { SeatController } from "../core/seat";
import { audio } from "../audio/audioEngine";
import { ui } from "../ui/kit";
import { roster } from "../characters/roster";
import { createCharacter, type Character } from "../characters/characterFactory";
import type { Screen } from "./screenManager";
import { screens } from "./screenManager";
import { onViewportChange, viewportSize } from "../ui/viewport";
import { mountPackPicker } from "../ui/packPicker";

const SLOT_COUNT = roster.length;

// ------------------------------------------------------------------
//  Scoped styles (injected once; every color from the palette)
// ------------------------------------------------------------------

let stylesInjected = false;

function injectSelectStyles(): void {
  if (stylesInjected) return;
  stylesInjected = true;
  if (document.getElementById("ssp-select-styles")) return;
  const style = document.createElement("style");
  style.id = "ssp-select-styles";
  style.textContent = `
    .ssp-sel-stage{position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:space-between;pointer-events:none;z-index:10;padding:calc(12px + env(safe-area-inset-top, 0px)) 12px calc(12px + env(safe-area-inset-bottom, 0px));box-sizing:border-box}
    .ssp-sel-top{display:flex;justify-content:space-between;align-items:center;width:100%;pointer-events:auto}
    .ssp-sel-title{font-size:24px;font-weight:700;color:${palette.cream};text-shadow:3px 3px 0 ${palette.ink},6px 6px 0 rgba(43,29,78,.35);pointer-events:none;letter-spacing:1px}
    .ssp-sel-cards{display:flex;gap:10px;width:100%;max-width:520px;pointer-events:auto;margin-bottom:14px}
    .ssp-sel-card{flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;padding:12px 6px;border-radius:18px;border:3px solid ${palette.ink};box-shadow:4px 4px 0 ${palette.ink};cursor:pointer;transition:transform .14s cubic-bezier(.34,1.56,.64,1),box-shadow .14s;user-select:none;position:relative;min-width:0;overflow:hidden}
    .ssp-sel-card:hover{transform:translateY(-3px) scale(1.03);box-shadow:5px 6px 0 ${palette.ink}}
    .ssp-sel-card:active{transform:scale(.93) translateY(2px);box-shadow:2px 2px 0 ${palette.ink}}
    .ssp-sel-card__name{font-size:16px;font-weight:700;line-height:1.1;text-align:center;word-break:break-word;text-shadow:2px 2px 0 rgba(255,255,255,.65)}
    .ssp-sel-card__tag{font-size:12px;font-weight:500;color:${palette.ink};opacity:.85;text-align:center;line-height:1.25}
    .ssp-sel-card__cpu{position:absolute;top:-8px;right:-6px;background:${palette.lava};color:${palette.white};font-size:10px;font-weight:700;padding:2px 7px;border-radius:9px;border:2px solid ${palette.ink};box-shadow:2px 2px 0 ${palette.ink};transform:rotate(8deg);white-space:nowrap;z-index:2}
    .ssp-sel-card--sel{transform:translateY(-10px) scale(1.07);box-shadow:6px 9px 0 ${palette.ink},0 0 22px var(--sel-color)}
    .ssp-sel-card--sel:hover{transform:translateY(-13px) scale(1.1)}
    .ssp-sel-card--sel:active{transform:translateY(-7px) scale(1.04);box-shadow:4px 5px 0 ${palette.ink},0 0 22px var(--sel-color)}
    .ssp-sel-ctrls{display:flex;gap:14px;align-items:center;width:100%;max-width:520px;justify-content:center;pointer-events:auto;margin-bottom:8px}
    .ssp-sel-packs{width:100%;max-width:520px;pointer-events:auto;margin-bottom:8px;max-height:38vh;overflow-y:auto}
    @media(max-width:520px){.ssp-sel-cards{gap:8px}.ssp-sel-card{padding:14px 6px;min-height:72px}.ssp-sel-card__name{font-size:15px}.ssp-sel-card__tag{font-size:12px}.ssp-sel-title{font-size:22px}}
  `;
  document.head.appendChild(style);
}

// ------------------------------------------------------------------
//  Layout
// ------------------------------------------------------------------

interface Layout {
  spread: number;
  baseZ: number;
  selZ: number;
  /** Extra scale on the selected hero. Unselected uses 1. */
  selScale: number;
  pedR: number;
  portrait: boolean;
}

const PARTY_FOV = 45;

/**
 * Fit four heroes to the visible phone width.
 * At fov 45 a 430-wide phone only sees ~±1.9 world units, and the old
 * spread of 1.9 put Pip and Tusk at ±2.85 — off both edges. Portrait
 * widens fov slightly and places the outer hero's edge at 84% of the
 * screen so all four stay in proportion to the phone.
 */
function applySelectCamera(cam: THREE.PerspectiveCamera): Layout {
  const { w, h } = viewportSize();
  const aspect = w / Math.max(1, h);
  const portrait = aspect < 1;
  cam.aspect = aspect;
  cam.fov = portrait ? 46 : PARTY_FOV;
  cam.updateProjectionMatrix();

  if (!portrait) {
    const camDist = 13;
    const elev = 0.85;
    cam.position.set(0, camDist * Math.sin(elev), camDist * Math.cos(elev));
    cam.lookAt(0, 0.4, 0);
    cam.updateMatrixWorld();
    return { spread: 3.0, baseZ: 0, selZ: 1.4, selScale: 1.18, pedR: 0.62, portrait: false };
  }

  const camDist = 6.4;
  const elev = 0.48;
  cam.position.set(0, camDist * Math.sin(elev), camDist * Math.cos(elev));
  cam.lookAt(0, -0.05, 0);
  cam.updateMatrixWorld();

  const probe = new THREE.Vector3();
  let lo = 0;
  let hi = 12;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    probe.set(mid, 1.0, 0);
    probe.project(cam);
    if (probe.x < 0.9) lo = mid;
    else hi = mid;
  }
  // Outer center is 1.5 spreads out; a little of the slot is body half-width.
  const spread = lo / 1.68;
  return {
    spread,
    baseZ: 0,
    selZ: 0.12,
    selScale: 1.08,
    pedR: spread * 0.32,
    portrait: true,
  };
}

/** Scale a hero so height and width match the phone slot, not the raw mesh. */
function measureHero(group: THREE.Group, layout: Layout): { fit: number; foot: number } {
  group.position.set(0, 0, 0);
  group.scale.set(1, 1, 1);
  group.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(group);
  const size = box.getSize(new THREE.Vector3());
  if (!layout.portrait) return { fit: 1, foot: box.min.y };
  const targetH = Math.max(1.15, layout.spread * 2.35);
  const targetW = layout.spread * 0.8;
  const fit = Math.min(
    targetH / Math.max(0.05, size.y),
    targetW / Math.max(0.05, size.x),
  );
  return { fit, foot: box.min.y };
}

// ------------------------------------------------------------------
//  Screen state
// ------------------------------------------------------------------

interface SelectScreenState {
  _active?: boolean;
  _chars?: Character[];
  _selected?: number;
  _platforms?: THREE.Mesh[];
  _spotlights?: THREE.SpotLight[];
  _cardEls?: HTMLDivElement[];
  _cpuEls?: HTMLDivElement[];
  _floor?: THREE.Mesh;
  _holders?: THREE.Group[];
  _fit?: number[];
  _foot?: number[];
  _offResize?: () => void;
  _hemi?: THREE.HemisphereLight;
  _existing?: Set<THREE.Object3D>;
  _onKeyDown?: (e: KeyboardEvent) => void;
  _applySelection: () => void;
  _placeHeroes: (layout: Layout) => void;
  _doSelect: (idx: number) => void;
  _confirmStart: () => void;
  _goBack: () => void;
}

// ------------------------------------------------------------------
//  Screen
// ------------------------------------------------------------------

const characterSelectImpl: SelectScreenState & Screen = {
  id: "select",

  enter() {
    injectSelectStyles();
    ui.clearScreen();
    this._active = true;
    this._selected = 0;
    this._chars = [];
    this._platforms = [];
    this._spotlights = [];
    this._cardEls = [];
    this._cpuEls = [];
    this._holders = [];
    this._fit = [];
    this._foot = [];

    // Snapshot existing scene children so exit() only sweeps what we add.
    this._existing = new Set(world.scene?.children ?? []);

    // Camera fitted to the phone's visible width (landscape keeps the old party shot).
    const cam = world.camera!;
    const layout = applySelectCamera(cam);

    // Extra fill light for the stage.
    const hemi = new THREE.HemisphereLight(0xffffff, 0x2b1d4e, 0.85);
    world.scene?.add(hemi);
    this._hemi = hemi;

    // Candy floor disk — wide enough to fill a phone frustum.
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(14, 40),
      new THREE.MeshToonMaterial({ color: hex(palette.grassA) })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.03;
    world.scene?.add(floor);
    this._floor = floor;
    const floorRing = new THREE.Mesh(
      new THREE.RingGeometry(13.2, 14, 40),
      new THREE.MeshToonMaterial({ color: hex(palette.grassB) })
    );
    floorRing.rotation.x = -Math.PI / 2;
    floorRing.position.y = -0.02;
    world.scene?.add(floorRing);

    // Characters + pedestals + spotlights. Positions come from _placeHeroes
    // so a phone resize can refit without rebuilding meshes.
    roster.forEach((charKind) => {
      const pedTop = new THREE.Mesh(
        new THREE.CylinderGeometry(0.62, 0.72, 0.22, 28),
        new THREE.MeshToonMaterial({ color: hex(charKind.color) })
      );
      pedTop.castShadow = true;
      pedTop.receiveShadow = true;
      world.scene?.add(pedTop);
      this._platforms!.push(pedTop);

      const pedBase = new THREE.Mesh(
        new THREE.CylinderGeometry(0.72, 0.78, 0.12, 28),
        new THREE.MeshToonMaterial({ color: hex(palette.ink) })
      );
      world.scene?.add(pedBase);
      this._platforms!.push(pedBase);

      const ch = createCharacter(charKind.key);
      ch.setFacing(0);
      ch.anim.idle();
      const measured = measureHero(ch.group, layout);
      const holder = new THREE.Group();
      holder.add(ch.group);
      world.scene?.add(holder);
      this._holders!.push(holder);
      this._fit!.push(measured.fit);
      this._foot!.push(measured.foot);
      this._chars!.push(ch);

      const spot = new THREE.SpotLight(0xffffff, 0.25, 9, Math.PI / 6, 0.45, 1.4);
      world.scene?.add(spot);
      world.scene?.add(spot.target);
      this._spotlights!.push(spot);
    });
    this._placeHeroes(layout);

    // ---- DOM overlay ----
    const stage = document.createElement("div");
    stage.className = "ssp-sel-stage";
    document.body.appendChild(stage);

    // Top bar: back button + title.
    const topBar = document.createElement("div");
    topBar.className = "ssp-sel-top";

    const backBtn = ui.button({
      label: "◀ BACK",
      kind: "ghost",
      size: "sm",
      onClick: () => this._goBack(),
      sound: "ui.back",
    });

    const titleEl = document.createElement("div");
    titleEl.className = "ssp-sel-title";
    titleEl.textContent = "PICK A HERO!";

    topBar.append(backBtn.el, titleEl);
    stage.appendChild(topBar);

    // Middle spacer (3D scene shows through).
    const spacer = document.createElement("div");
    spacer.style.flex = "1";
    stage.appendChild(spacer);

    // Card row: one tappable card per character.
    const cardRow = document.createElement("div");
    cardRow.className = "ssp-sel-cards";
    roster.forEach((charKind, i) => {
      const card = document.createElement("div");
      card.className = "ssp-sel-card";
      card.style.setProperty("--sel-color", charKind.color);
      card.style.background = charKind.color;

      const cpu = document.createElement("div");
      cpu.className = "ssp-sel-card__cpu";
      cpu.textContent = "CPU";
      cpu.style.display = "none";

      const name = document.createElement("div");
      name.className = "ssp-sel-card__name";
      name.textContent = charKind.name;
      name.style.color = palette.ink;

      const tag = document.createElement("div");
      tag.className = "ssp-sel-card__tag";
      tag.textContent = charKind.tagline;

      card.append(cpu, name, tag);
      card.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        this._doSelect(i);
      });

      this._cardEls!.push(card);
      this._cpuEls!.push(cpu);
      cardRow.appendChild(card);
    });
    stage.appendChild(cardRow);

    // Host picks the rotation, their pack, and the coin multiplier
    // before the match. Same keys as title / pause settings.
    const packSlot = document.createElement("div");
    packSlot.className = "ssp-sel-packs";
    packSlot.appendChild(mountPackPicker({ card: true }).el);
    stage.appendChild(packSlot);

    // Controls row: arrows + big START! button.
    const ctrlRow = document.createElement("div");
    ctrlRow.className = "ssp-sel-ctrls";

    const arrowL = ui.button({
      label: "◀",
      kind: "ghost",
      size: "md",
      onClick: () => this._doSelect((this._selected ?? 0) - 1),
      ariaLabel: "Previous character",
    });

    const okBtn = ui.button({
      label: "START!",
      kind: "gold",
      size: "lg",
      onClick: () => this._confirmStart(),
      ariaLabel: "Start the match",
    });

    const arrowR = ui.button({
      label: "▶",
      kind: "ghost",
      size: "md",
      onClick: () => this._doSelect((this._selected ?? 0) + 1),
      ariaLabel: "Next character",
    });

    ctrlRow.append(arrowL.el, okBtn.el, arrowR.el);
    stage.appendChild(ctrlRow);

    // Apply initial selection.
    this._applySelection();

    // Keyboard: arrows cycle, Enter/Space confirms, Escape goes back.
    this._onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        this._doSelect((this._selected ?? 0) - 1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        this._doSelect((this._selected ?? 0) + 1);
      } else if (e.key === "Enter" || e.key === " ") {
        const target = e.target as HTMLElement | null;
        if (target?.closest?.("[data-ssp-pack-picker]")) return;
        e.preventDefault();
        this._confirmStart();
      } else if (e.key === "Escape") {
        e.preventDefault();
        this._goBack();
      }
    };
    window.addEventListener("keydown", this._onKeyDown);
    this._offResize = onViewportChange(() => {
      if (!this._active || !world.camera) return;
      this._placeHeroes(applySelectCamera(world.camera));
    });
  },

  _applySelection() {
    if (!world.camera) return;
    this._placeHeroes(applySelectCamera(world.camera));
  },

  _placeHeroes(layout: Layout) {
    const sel = this._selected ?? 0;
    const pedScale = layout.portrait ? layout.pedR / 0.62 : 1;

    this._chars?.forEach((_ch, i) => {
      const isSel = i === sel;
      const x = (i - (SLOT_COUNT - 1) / 2) * layout.spread;
      const fit = (this._fit?.[i] ?? 1) * (isSel ? layout.selScale : layout.portrait ? 0.94 : 0.9);
      const foot = this._foot?.[i] ?? 0;
      const holder = this._holders?.[i];
      if (holder) {
        holder.position.set(x, 0.22 - foot * fit, isSel ? layout.selZ : layout.baseZ);
        holder.scale.setScalar(fit);
      }

      const pedTop = this._platforms?.[i * 2];
      const pedBase = this._platforms?.[i * 2 + 1];
      if (pedTop) {
        pedTop.position.set(x, 0.11, 0);
        pedTop.scale.set(pedScale, 1, pedScale);
      }
      if (pedBase) {
        pedBase.position.set(x, 0, 0);
        pedBase.scale.set(pedScale, 1, pedScale);
      }

      const spot = this._spotlights?.[i];
      if (spot) {
        spot.position.set(x, 4.2, 1.2);
        spot.target.position.set(x, 0.6, isSel ? layout.selZ : 0);
        spot.intensity = isSel ? 3.5 : 0.25;
      }

      const card = this._cardEls?.[i];
      if (card) {
        if (isSel) card.classList.add("ssp-sel-card--sel");
        else card.classList.remove("ssp-sel-card--sel");
      }

      const cpu = this._cpuEls?.[i];
      if (cpu) cpu.style.display = isSel ? "none" : "flex";
    });
  },

  _doSelect(idx: number) {
    const wrapped = ((idx % SLOT_COUNT) + SLOT_COUNT) % SLOT_COUNT;
    if (wrapped === this._selected) {
      audio.sfx.play("pop");
      return;
    }
    this._selected = wrapped;
    audio.sfx.play("pop");
    audio.sfx.play("boing");
    this._applySelection();
  },

  _confirmStart() {
    const selIdx = this._selected ?? 0;
    const sel = roster[selIdx];
    const others = roster.filter((_, i) => i !== selIdx);
    const kinds = [sel.key, ...others.map((c) => c.key)];
    const names = [sel.name, ...others.map((c) => c.name)];
    const controllers: SeatController[] = ["local", ...others.map(() => "cpu" as const)];

    let urlSeed: number | undefined;
    try {
      const s = new URLSearchParams(window.location.search).get("seed");
      if (s) urlSeed = Number(s);
    } catch {
      /* URL parse must never break the game */
    }

    setOnlineMatch(false);
    startMatch(kinds, names, 10, urlSeed, controllers);
    audio.sfx.play("fanfare.win");
    screens.goto("board");
  },

  _goBack() {
    audio.sfx.play("ui.back");
    screens.goto("title");
  },

  exit() {
    this._active = false;
    this._offResize?.();
    this._offResize = undefined;
    if (world.camera) {
      world.camera.fov = PARTY_FOV;
      world.camera.updateProjectionMatrix();
    }

    if (this._onKeyDown) {
      window.removeEventListener("keydown", this._onKeyDown);
      this._onKeyDown = undefined;
    }

    for (const h of this._holders ?? []) world.scene?.remove(h);
    this._holders = undefined;
    this._fit = undefined;
    this._foot = undefined;

    for (const ch of this._chars ?? []) {
      ch.dispose();
    }
    this._chars = undefined;

    for (const p of this._platforms ?? []) {
      world.scene?.remove(p);
      p.geometry.dispose();
      (p.material as THREE.Material).dispose();
    }
    this._platforms = undefined;

    for (const s of this._spotlights ?? []) {
      world.scene?.remove(s.target);
      world.scene?.remove(s);
      s.dispose();
    }
    this._spotlights = undefined;

    if (this._floor) {
      world.scene?.remove(this._floor);
      this._floor.geometry.dispose();
      (this._floor.material as THREE.Material).dispose();
      this._floor = undefined;
    }
    if (this._hemi) {
      world.scene?.remove(this._hemi);
      this._hemi.dispose();
      this._hemi = undefined;
    }

    // Sweep every scene object added since enter.
    const existing = this._existing;
    if (existing && world.scene) {
      for (const obj of [...world.scene.children]) {
        if (!existing.has(obj)) {
          world.scene.remove(obj);
          obj.traverse((o) => {
            const m = o as THREE.Mesh;
            if (m.isMesh) {
              m.geometry.dispose();
              const mats = Array.isArray(m.material) ? m.material : [m.material];
              for (const mat of mats) mat.dispose();
            }
            const l = o as THREE.Light;
            if (l.isLight) l.dispose();
          });
        }
      }
    }
    this._existing = undefined;

    // Remove DOM overlay.
    const stages = document.querySelectorAll(".ssp-sel-stage");
    for (const s of stages) s.remove();
    this._cardEls = undefined;
    this._cpuEls = undefined;

    ui.clearScreen();
  },

  update(dt: number) {
    for (const ch of this._chars ?? []) ch.update(dt);
  },

  render() {},
};

export const characterSelect = characterSelectImpl as Screen;
