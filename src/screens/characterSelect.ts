/**
 * SUPER STAR PARTY — character select screen ('select').
 *
 * MP-style: the selected hero stands centre-stage on a podium under one
 * spotlight, idling, with ◀ ▶ at the slot edges (or swipe) and a name +
 * tagline plate under it. The other three sit in a small row of DOM cards
 * with a CPU badge (tap one to pick it). One "Match settings" card and one
 * big START! row finish the column. START! makes the chosen hero the local
 * seat and the rest CPU seats; BACK returns to the title.
 *
 * The camera is fitted to the DOM hero slot every resize/selection: the
 * hero's projected box sits inside the slot with an 8% margin, so no phone
 * shape can clip the model or hide it behind the cards.
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
import { mountMatchSettings } from "../ui/packPicker";
import { setSelectBoundsReader, type SelectBounds, type SelectRect } from "../core/debug";

const SLOT_COUNT = roster.length;
const PARTY_FOV = 45;
/** Lens for the hero shot: long enough that the model isn't fish-eyed. */
const HERO_FOV = 30;
/** Fraction of the slot kept clear around the hero box. */
const FIT_MARGIN = 0.08;
/** Camera looks down on the hero by this much (radians). */
const CAM_ELEV = 0.22;
const PODIUM_H = 0.26;
const SWIPE_PX = 40;

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
    .ssp-sel-stage{position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;gap:8px;pointer-events:none;z-index:10;padding:calc(10px + env(safe-area-inset-top, 0px)) 12px calc(12px + env(safe-area-inset-bottom, 0px));box-sizing:border-box;overflow:hidden}
    .ssp-sel-top{display:flex;justify-content:space-between;align-items:center;width:100%;max-width:520px;pointer-events:auto;flex:none}
    .ssp-sel-title{font-size:22px;font-weight:700;color:${palette.cream};text-shadow:3px 3px 0 ${palette.ink},6px 6px 0 rgba(43,29,78,.35);pointer-events:none;letter-spacing:1px}
    .ssp-sel-hero{position:relative;flex:1 1 auto;min-height:150px;width:100%;max-width:520px;pointer-events:auto;touch-action:none;user-select:none}
    .ssp-sel-arrow{position:absolute;top:calc(50% - 25px);min-width:48px;padding-left:0;padding-right:0;z-index:2}
    .ssp-sel-arrow--l{left:0}
    .ssp-sel-arrow--r{right:0}
    .ssp-sel-side{display:flex;flex-direction:column;gap:8px;width:100%;max-width:520px;flex:none;pointer-events:none}
    .ssp-sel-plate{align-self:center;display:flex;flex-direction:column;align-items:center;gap:1px;padding:5px 22px 6px;border-radius:16px;background:${palette.cream};border:4px solid var(--sel-color);box-shadow:0 0 0 3px ${palette.ink},4px 5px 0 3px ${palette.ink};pointer-events:none;max-width:92%;box-sizing:border-box}
    .ssp-sel-plate__name{font-size:24px;font-weight:700;line-height:1.05;color:var(--sel-color);-webkit-text-stroke:1.5px ${palette.ink};paint-order:stroke fill;text-shadow:2px 2px 0 ${palette.ink};letter-spacing:.5px}
    .ssp-sel-plate__tag{font-size:14px;font-weight:600;line-height:1.15;color:${palette.inkSoft};text-align:center}
    .ssp-sel-cards{display:flex;gap:8px;width:100%;pointer-events:auto}
    .ssp-sel-card{font-family:inherit;flex:1 1 0;min-width:0;display:flex;align-items:center;gap:5px;padding:6px 5px;border-radius:16px;border:3px solid ${palette.ink};box-shadow:3px 3px 0 ${palette.ink};cursor:pointer;user-select:none;color:${palette.ink};transition:transform .12s cubic-bezier(.34,1.56,.64,1)}
    .ssp-sel-card:active{transform:scale(.94) translateY(2px);box-shadow:1px 1px 0 ${palette.ink}}
    .ssp-sel-card:focus-visible{outline:4px solid ${palette.sun};outline-offset:2px}
    .ssp-sel-card .ssp-avatar{width:30px;height:30px;font-size:15px;flex:none;border-width:3px}
    .ssp-sel-card .ssp-avatar::after{top:4px;left:6px;width:8px;height:5px}
    .ssp-sel-card__text{display:flex;flex-direction:column;align-items:flex-start;gap:3px;min-width:0}
    .ssp-sel-card__name{font-size:14.5px;font-weight:700;line-height:1.05;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
    .ssp-sel-card__cpu{font-size:10px;font-weight:700;line-height:1;letter-spacing:.6px;padding:3px 6px;border-radius:8px;background:${palette.ink};color:${palette.cream}}
    .ssp-sel-start{width:100%;flex:none;pointer-events:auto;min-height:60px;font-size:28px;letter-spacing:1px}
    @media (max-height:720px) and (orientation:portrait){.ssp-ms-tile__blurb{font-size:10px}.ssp-sel-start{min-height:52px;font-size:24px}.ssp-sel-plate__name{font-size:20px}}
    @media (orientation:landscape){
      .ssp-sel-stage{display:grid;grid-template-columns:minmax(0,1fr) minmax(300px,400px);grid-template-rows:auto minmax(0,1fr);grid-template-areas:"top top" "hero side";column-gap:12px;row-gap:6px;justify-items:stretch}
      .ssp-sel-top{grid-area:top;max-width:none}
      .ssp-sel-hero{grid-area:hero;max-width:none;min-height:0}
      .ssp-sel-side{grid-area:side;max-width:none;min-height:0;overflow-y:auto;pointer-events:auto;padding:2px 6px 6px 2px;box-sizing:border-box}
    }
  `;
  document.head.appendChild(style);
}

// ------------------------------------------------------------------
//  Spotlight cone (additive, fades toward the lamp and at the rim)
// ------------------------------------------------------------------

function makeLightCone(height: number, radius: number): THREE.Mesh {
  const geo = new THREE.CylinderGeometry(radius * 0.12, radius, height, 40, 1, true);
  geo.translate(0, height / 2, 0);
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: { uColor: { value: new THREE.Color(hex(palette.lampHot)) } },
    vertexShader: `
      varying float vH;
      varying float vRim;
      void main(){
        vH = uv.y;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vec3 n = normalize(normalMatrix * normal);
        vRim = abs(dot(n, normalize(-mv.xyz)));
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform vec3 uColor;
      varying float vH;
      varying float vRim;
      void main(){
        float a = 0.30 * pow(1.0 - vH, 1.4) * pow(vRim, 1.6);
        gl_FragColor = vec4(uColor * a, a);
      }`,
  });
  const cone = new THREE.Mesh(geo, mat);
  cone.renderOrder = 5;
  return cone;
}

// ------------------------------------------------------------------
//  Screen-space helpers
// ------------------------------------------------------------------

function domRect(el: Element | null | undefined): SelectRect | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
}

/** Canvas origin in client px (the app is pinned to the visual viewport). */
function canvasOrigin(): { x: number; y: number } {
  const vv = window.visualViewport;
  return { x: vv?.offsetLeft ?? 0, y: vv?.offsetTop ?? 0 };
}

const corner = new THREE.Vector3();
/** Projected client-px box of a world Box3 through the current camera. */
function projectBox(box: THREE.Box3, cam: THREE.PerspectiveCamera, w: number, h: number): SelectRect {
  const o = canvasOrigin();
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let i = 0; i < 8; i++) {
    corner.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z);
    corner.project(cam);
    const px = ((corner.x + 1) / 2) * w;
    const py = ((1 - corner.y) / 2) * h;
    x0 = Math.min(x0, px);
    x1 = Math.max(x1, px);
    y0 = Math.min(y0, py);
    y1 = Math.max(y1, py);
  }
  return { x: x0 + o.x, y: y0 + o.y, w: x1 - x0, h: y1 - y0 };
}

// ------------------------------------------------------------------
//  Screen state
// ------------------------------------------------------------------

interface SelectScreenState {
  _active?: boolean;
  _chars?: Character[];
  _holders?: THREE.Group[];
  /** Rest-pose box of each hero standing on the podium (holder at origin). */
  _restBox?: THREE.Box3[];
  _selected?: number;
  _time?: number;
  _popT?: number;
  _podium?: THREE.Group;
  _spot?: THREE.SpotLight;
  _cone?: THREE.Mesh;
  _hemi?: THREE.HemisphereLight;
  _stage?: HTMLDivElement;
  _slot?: HTMLDivElement;
  _plate?: HTMLDivElement;
  _cardRow?: HTMLDivElement;
  _settingsEl?: HTMLElement;
  _startEl?: HTMLButtonElement;
  _arrowEls?: HTMLButtonElement[];
  _slotObserver?: ResizeObserver;
  _offResize?: () => void;
  _existing?: Set<THREE.Object3D>;
  _onKeyDown?: (e: KeyboardEvent) => void;
  _applySelection: () => void;
  _renderCards: () => void;
  _fitCamera: () => void;
  _bounds: () => SelectBounds | null;
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
    this._time = 0;
    this._popT = 1;
    this._chars = [];
    this._holders = [];
    this._restBox = [];

    // Snapshot existing scene children so exit() only sweeps what we add.
    this._existing = new Set(world.scene?.children ?? []);

    const hemi = new THREE.HemisphereLight(0xffffff, hex(palette.ink), 0.75);
    world.scene?.add(hemi);
    this._hemi = hemi;

    // Candy floor disk around the stage.
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(14, 48),
      new THREE.MeshToonMaterial({ color: hex(palette.grassA) })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -PODIUM_H - 0.01;
    world.scene?.add(floor);
    const floorRing = new THREE.Mesh(
      new THREE.RingGeometry(13.2, 14, 48),
      new THREE.MeshToonMaterial({ color: hex(palette.grassB) })
    );
    floorRing.rotation.x = -Math.PI / 2;
    floorRing.position.y = -PODIUM_H;
    world.scene?.add(floorRing);

    // Podium: top is y = 0, the hero's feet stand on it. Scaled per hero.
    const podium = new THREE.Group();
    const top = new THREE.Mesh(
      new THREE.CylinderGeometry(1, 1.06, PODIUM_H * 0.62, 40),
      new THREE.MeshToonMaterial({ color: hex(palette.sun) })
    );
    top.position.y = -PODIUM_H * 0.31;
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(1.1, 1.16, PODIUM_H * 0.38, 40),
      new THREE.MeshToonMaterial({ color: hex(palette.berry) })
    );
    base.position.y = -PODIUM_H * 0.81;
    podium.add(top, base);
    world.scene?.add(podium);
    this._podium = podium;

    // One spotlight from above-front, plus a soft additive beam.
    const spot = new THREE.SpotLight(0xffffff, 40, 0, Math.PI / 7, 0.5, 1.2);
    spot.position.set(0, 5.5, 2.2);
    spot.target.position.set(0, 0.4, 0);
    world.scene?.add(spot, spot.target);
    this._spot = spot;
    const cone = makeLightCone(5.2, 1.2);
    world.scene?.add(cone);
    this._cone = cone;

    // All four load now so a swap is instant; only the selected one shows.
    roster.forEach((charKind) => {
      const ch = createCharacter(charKind.key);
      ch.setFacing(0);
      ch.anim.idle();
      ch.group.position.set(0, 0, 0);
      ch.group.updateWorldMatrix(true, true);
      const raw = new THREE.Box3().setFromObject(ch.group);
      const holder = new THREE.Group();
      holder.add(ch.group);
      holder.position.y = -raw.min.y;
      holder.visible = false;
      world.scene?.add(holder);
      holder.updateWorldMatrix(true, true);
      const rest = new THREE.Box3().setFromObject(holder);
      // Room for the idle sway (rotation about Y) and squash.
      const size = rest.getSize(new THREE.Vector3());
      const pad = Math.max(size.x, size.z) * 0.12;
      rest.min.x -= pad;
      rest.max.x += pad;
      rest.min.z -= pad;
      rest.max.z += pad;
      rest.max.y += size.y * 0.06;
      this._chars!.push(ch);
      this._holders!.push(holder);
      this._restBox!.push(rest);
    });

    // ---- DOM overlay ----
    const stage = document.createElement("div");
    stage.className = "ssp-sel-stage";
    document.body.appendChild(stage);
    this._stage = stage;

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

    // Hero slot: the 3D hero is fitted into this rect. Arrows at its edges.
    const slot = document.createElement("div");
    slot.className = "ssp-sel-hero";
    this._slot = slot;
    const arrowL = ui.button({
      label: "◀",
      kind: "ghost",
      size: "md",
      onClick: () => this._doSelect((this._selected ?? 0) - 1),
      ariaLabel: "Previous hero",
    });
    const arrowR = ui.button({
      label: "▶",
      kind: "ghost",
      size: "md",
      onClick: () => this._doSelect((this._selected ?? 0) + 1),
      ariaLabel: "Next hero",
    });
    arrowL.el.classList.add("ssp-sel-arrow", "ssp-sel-arrow--l");
    arrowR.el.classList.add("ssp-sel-arrow", "ssp-sel-arrow--r");
    slot.append(arrowL.el, arrowR.el);
    this._arrowEls = [arrowL.el, arrowR.el];

    // Swipe on the slot: |dx| > 40px steps one hero.
    let downX: number | null = null;
    let downId = -1;
    slot.addEventListener("pointerdown", (e) => {
      if ((e.target as HTMLElement).closest("button")) return;
      downX = e.clientX;
      downId = e.pointerId;
    });
    const endSwipe = (e: PointerEvent): void => {
      if (downX === null || e.pointerId !== downId) return;
      const dx = e.clientX - downX;
      downX = null;
      if (Math.abs(dx) > SWIPE_PX) this._doSelect((this._selected ?? 0) + (dx < 0 ? 1 : -1));
    };
    slot.addEventListener("pointerup", endSwipe);
    slot.addEventListener("pointercancel", () => {
      downX = null;
    });

    const side = document.createElement("div");
    side.className = "ssp-sel-side";

    const plate = document.createElement("div");
    plate.className = "ssp-sel-plate";
    this._plate = plate;

    const cardRow = document.createElement("div");
    cardRow.className = "ssp-sel-cards";
    this._cardRow = cardRow;

    const settingsCard = mountMatchSettings().el;
    this._settingsEl = settingsCard;

    const okBtn = ui.button({
      label: "START!",
      kind: "gold",
      size: "lg",
      onClick: () => this._confirmStart(),
      ariaLabel: "Start the match",
    });
    okBtn.el.classList.add("ssp-sel-start");
    this._startEl = okBtn.el;

    side.append(plate, cardRow, settingsCard, okBtn.el);
    stage.append(topBar, slot, side);

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
        // A focused button handles its own Enter/Space.
        if (target?.closest?.("[data-ssp-pack-picker], button")) return;
        e.preventDefault();
        this._confirmStart();
      } else if (e.key === "Escape") {
        e.preventDefault();
        this._goBack();
      }
    };
    window.addEventListener("keydown", this._onKeyDown);

    // Re-fit on viewport change, on slot layout change, and after fonts land.
    this._offResize = onViewportChange(() => this._fitCamera());
    if (typeof ResizeObserver !== "undefined") {
      this._slotObserver = new ResizeObserver(() => this._fitCamera());
      this._slotObserver.observe(slot);
    }
    void document.fonts?.ready.then(() => this._fitCamera());
    requestAnimationFrame(() => this._fitCamera());

    setSelectBoundsReader(() => this._bounds());
  },

  _applySelection() {
    const sel = this._selected ?? 0;
    const kind = roster[sel];
    this._holders?.forEach((h, i) => {
      h.visible = i === sel;
    });

    const rest = this._restBox?.[sel];
    if (rest && this._podium) {
      const size = rest.getSize(new THREE.Vector3());
      const r = Math.max(size.x, size.z) * 0.5;
      this._podium.scale.set(r, 1, r);
      (this._podium.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshToonMaterial>).material.color.set(
        hex(kind.color)
      );
      this._cone?.scale.set(r / 1.2 + 0.1, 1, r / 1.2 + 0.1);
    }

    if (this._plate) {
      this._plate.style.setProperty("--sel-color", kind.color);
      const name = document.createElement("div");
      name.className = "ssp-sel-plate__name";
      name.textContent = kind.name;
      const tag = document.createElement("div");
      tag.className = "ssp-sel-plate__tag";
      tag.textContent = kind.tagline;
      this._plate.replaceChildren(name, tag);
    }
    this._renderCards();
    this._fitCamera();
  },

  _renderCards() {
    const row = this._cardRow;
    if (!row) return;
    const sel = this._selected ?? 0;
    row.replaceChildren();
    roster.forEach((charKind, i) => {
      if (i === sel) return;
      const card = document.createElement("button");
      card.type = "button";
      card.className = "ssp-sel-card";
      card.style.background = charKind.color;
      card.setAttribute("aria-label", `Pick ${charKind.name}`);
      card.dataset.sspHero = charKind.key;

      const text = document.createElement("div");
      text.className = "ssp-sel-card__text";
      const name = document.createElement("div");
      name.className = "ssp-sel-card__name";
      name.textContent = charKind.name;
      const cpu = document.createElement("div");
      cpu.className = "ssp-sel-card__cpu";
      cpu.textContent = "CPU";
      text.append(name, cpu);

      card.append(ui.playerAvatar(charKind.key, charKind.color), text);
      card.addEventListener("click", (e) => {
        e.preventDefault();
        this._doSelect(i);
      });
      row.appendChild(card);
    });
  },

  /**
   * Point the camera so the hero (plus its podium) fills the DOM slot with
   * an 8% margin. A view offset moves the projection centre onto the slot;
   * a few passes of "scale distance by box/target, shift by centre error"
   * converge in well under a millisecond.
   */
  _fitCamera() {
    const cam = world.camera;
    const slot = this._slot;
    const rest = this._restBox?.[this._selected ?? 0];
    if (!this._active || !cam || !slot || !rest) return;
    const { w, h } = viewportSize();
    const r = slot.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return;
    const o = canvasOrigin();

    const arrowW = this._arrowEls?.[0]?.getBoundingClientRect().width ?? 48;
    const mx = Math.max(r.width * FIT_MARGIN, arrowW + 6);
    const my = r.height * FIT_MARGIN;
    const target = {
      x: r.left - o.x + mx,
      y: r.top - o.y + my,
      w: Math.max(8, r.width - 2 * mx),
      h: Math.max(8, r.height - 2 * my),
    };

    // Fit box: the hero's rest box (sway room included) plus the podium top.
    const box = rest.clone();
    const podR = this._podium?.scale.x ?? 1;
    box.union(new THREE.Box3(new THREE.Vector3(-podR, -PODIUM_H, -podR), new THREE.Vector3(podR, 0, podR)));
    const centre = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());

    cam.fov = HERO_FOV;
    cam.aspect = w / h;
    const dir = new THREE.Vector3(0, Math.sin(CAM_ELEV), Math.cos(CAM_ELEV));
    let dist = (size.y * 0.5) / Math.tan(THREE.MathUtils.degToRad(HERO_FOV / 2)) / 0.8 + size.z;
    let ox = w / 2 - (target.x + target.w / 2);
    let oy = h / 2 - (target.y + target.h / 2);

    for (let pass = 0; pass < 8; pass++) {
      cam.position.copy(centre).addScaledVector(dir, dist);
      cam.lookAt(centre);
      cam.setViewOffset(w, h, ox, oy, w, h);
      cam.updateProjectionMatrix();
      cam.updateMatrixWorld(true);
      const p = projectBox(box, cam, w, h);
      p.x -= o.x;
      p.y -= o.y;
      const s = Math.max(p.w / target.w, p.h / target.h);
      dist = Math.max(1, dist * s);
      ox += p.x + p.w / 2 - (target.x + target.w / 2);
      oy += p.y + p.h / 2 - (target.y + target.h / 2);
    }
    cam.position.copy(centre).addScaledVector(dir, dist);
    cam.lookAt(centre);
    cam.setViewOffset(w, h, ox, oy, w, h);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);
  },

  _bounds() {
    const cam = world.camera;
    const sel = this._selected ?? 0;
    const ch = this._chars?.[sel];
    if (!this._active || !cam) return null;
    const { w, h } = viewportSize();
    let heroBox: SelectRect | null = null;
    if (ch) {
      ch.group.updateWorldMatrix(true, true);
      const b = new THREE.Box3().setFromObject(ch.group);
      if (!b.isEmpty()) heroBox = projectBox(b, cam, w, h);
    }
    return {
      viewport: { w, h },
      hero: { selected: roster[sel].key, box: heroBox },
      slot: domRect(this._slot),
      cards: [...(this._cardRow?.querySelectorAll(".ssp-sel-card") ?? [])].map((c) => domRect(c)!),
      settings: domRect(this._settingsEl),
      start: domRect(this._startEl),
      arrows: (this._arrowEls ?? []).map((a) => domRect(a)!),
      plate: domRect(this._plate),
    };
  },

  _doSelect(idx: number) {
    const wrapped = ((idx % SLOT_COUNT) + SLOT_COUNT) % SLOT_COUNT;
    if (wrapped === this._selected) {
      audio.sfx.play("pop");
      return;
    }
    this._selected = wrapped;
    this._popT = 0;
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
    setSelectBoundsReader(null);
    this._offResize?.();
    this._offResize = undefined;
    this._slotObserver?.disconnect();
    this._slotObserver = undefined;
    if (world.camera) {
      world.camera.clearViewOffset();
      world.camera.fov = PARTY_FOV;
      world.camera.updateProjectionMatrix();
    }

    if (this._onKeyDown) {
      window.removeEventListener("keydown", this._onKeyDown);
      this._onKeyDown = undefined;
    }

    for (const h of this._holders ?? []) world.scene?.remove(h);
    for (const ch of this._chars ?? []) ch.dispose();
    this._holders = undefined;
    this._chars = undefined;
    this._restBox = undefined;
    this._podium = undefined;
    this._spot = undefined;
    this._cone = undefined;
    this._hemi = undefined;

    // Sweep every scene object added since enter (floor, podium, light, beam).
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

    this._stage?.remove();
    for (const s of document.querySelectorAll(".ssp-sel-stage")) s.remove();
    this._stage = undefined;
    this._slot = undefined;
    this._plate = undefined;
    this._cardRow = undefined;
    this._settingsEl = undefined;
    this._startEl = undefined;
    this._arrowEls = undefined;

    ui.clearScreen();
  },

  update(dt: number) {
    for (const ch of this._chars ?? []) ch.update(dt);
    // Cosmetic only: deterministic sway + a small pop-in on a new pick.
    this._time = (this._time ?? 0) + dt;
    this._popT = Math.min(1, (this._popT ?? 1) + dt / 0.32);
    const holder = this._holders?.[this._selected ?? 0];
    if (holder) {
      const t = this._time;
      holder.rotation.y = Math.sin(t * 1.15) * 0.14;
      const k = 1 - this._popT;
      const s = 1 - 0.14 * k * k;
      holder.scale.set(s, s, s);
    }
    if (this._spot) this._spot.intensity = 40 + Math.sin((this._time ?? 0) * 2.1) * 4;
  },

  render() {},
};

export const characterSelect = characterSelectImpl as Screen;
