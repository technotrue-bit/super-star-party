/**
 * SUPER STAR PARTY — party line-up ('lineup'). The board menu's NEXT lands
 * here; the board loads after it.
 *
 * The four heroes stand in a row on a stage in front of a big marquee screen
 * that shows the board's overview picture (boardSnapshot.ts). PLAY! sends
 * them, one after another, hopping into the screen: each shrinks into the
 * picture with a ripple and a flash. Once the last one is in, the camera
 * pushes into the screen and the board screen takes over.
 *
 * The match starts on enter (seats from character select, board from the
 * saved rule), so a "random" board is already resolved and the screen shows
 * the board that will be played. BACK returns to the board menu, and coming
 * back starts the match again. Timing is presentation only; nothing here
 * draws from the rng or writes match state after startMatch.
 */
import * as THREE from "three";
import { world } from "../main";
import { palette, hex } from "../config/palette";
import { audio } from "../audio/audioEngine";
import { ui } from "../ui/kit";
import { match, startMatch } from "../core/game";
import { setOnlineMatch } from "../net/mode";
import { roster, MATCH_SEATS, characterColor } from "../characters/roster";
import { createCharacter, type Character } from "../characters/characterFactory";
import { BOARDS, activeBoardId } from "../board/registry";
import { boardSnapshot } from "../board/boardSnapshot";
import { readPersistedRules } from "../minigames/packRules";
import { partySetup } from "../game/partySetup";
import { readTurnsRule } from "../minigames/packRules";
import { onViewportChange, viewportSize } from "../ui/viewport";
import { screens, type Screen } from "./screenManager";

const STYLE_ID = "ssp-lineup-styles";
const FOV = 40;
const CAM_ELEV = 0.17;
/** Picture aspect (boardSnapshot is 16:10). */
const PIC_ASPECT = 1.6;
/** Seconds between one hero's jump and the next. */
const JUMP_STAGGER = 0.34;
/** Crouch, then the hop into the screen. */
const CROUCH_S = 0.14;
const HOP_S = 0.62;
/** After the last hero is in: a beat, then the push into the screen. */
const SETTLE_S = 0.45;
const PUSH_S = 0.75;

function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = `
    .ssp-lu{position:fixed;inset:0;z-index:20;pointer-events:none;font-family:Fredoka,'Comic Sans MS',sans-serif;color:${palette.cream}}
    .ssp-lu > *{pointer-events:auto}
    .ssp-lu__top{position:absolute;left:0;right:0;top:0;display:flex;align-items:flex-start;justify-content:space-between;gap:10px;
      padding:calc(10px + env(safe-area-inset-top,0px)) calc(14px + env(safe-area-inset-right,0px)) 0 calc(14px + env(safe-area-inset-left,0px))}
    .ssp-lu__head{display:flex;flex-direction:column;align-items:center;text-align:center;pointer-events:none}
    .ssp-lu__kicker{font-size:clamp(13px,3.4vw,16px);font-weight:700;letter-spacing:2px;color:${palette.sun};text-shadow:2px 2px 0 ${palette.ink}}
    .ssp-lu__board{font-size:clamp(22px,5.6vw,36px);font-weight:700;line-height:1;
      text-shadow:3px 3px 0 ${palette.ink},-2px -2px 0 ${palette.ink},2px -2px 0 ${palette.ink},-2px 2px 0 ${palette.ink}}
    .ssp-lu__pick{margin-top:4px;font-size:13px;font-weight:700;padding:3px 10px;border-radius:999px;background:${palette.candy};
      border:3px solid ${palette.ink};letter-spacing:1px}
    .ssp-lu__foot{position:absolute;left:0;right:0;bottom:0;display:flex;justify-content:center;
      padding:0 16px calc(14px + env(safe-area-inset-bottom,0px))}
    .ssp-lu__play{width:min(320px,86vw)}
    .ssp-lu__play.is-ready{animation:sspLuPulse 1.1s ease-in-out infinite}
    /* A glow, not a scale: the button stays put for taps (and test clicks). */
    @keyframes sspLuPulse{0%,100%{filter:drop-shadow(0 0 0 rgba(255,210,63,0))}50%{filter:drop-shadow(0 0 14px rgba(255,210,63,.95))}}
    .ssp-lu__tags{position:absolute;inset:0;pointer-events:none}
    .ssp-lu-tag{position:absolute;transform:translate(-50%,0);white-space:nowrap;font-size:clamp(11px,2.8vw,14px);font-weight:700;
      padding:2px 9px;border-radius:999px;border:3px solid ${palette.ink};color:${palette.ink};box-shadow:0 3px 0 ${palette.ink};
      transition:opacity .18s}
    .ssp-lu-tag b{font-weight:700;color:${palette.cream};text-shadow:1px 1px 0 ${palette.ink}}
    .ssp-lu.is-going .ssp-lu__top button,.ssp-lu.is-going .ssp-lu__foot{opacity:0;transition:opacity .25s;pointer-events:none}
    @media (orientation:landscape) and (max-height:500px){
      .ssp-lu__board{font-size:24px}
      .ssp-lu__foot{padding-bottom:calc(8px + env(safe-area-inset-bottom,0px))}
      .ssp-lu__play.ssp-btn--lg{min-height:46px;padding-top:6px;padding-bottom:6px;font-size:22px;width:min(240px,40vw)}
    }
    @media (prefers-reduced-motion:reduce){.ssp-lu__play.is-ready{animation:none}}
  `;
  document.head.appendChild(s);
}

interface Hero {
  ch: Character;
  holder: THREE.Group;
  home: THREE.Vector3;
  /** Point on the screen this hero dives into. */
  target: THREE.Vector3;
  tag: HTMLDivElement;
  /** Seconds since PLAY when this hero leaves (crouch start). */
  leaveAt: number;
  phase: "stand" | "crouch" | "hop" | "in";
}

interface Ripple {
  mesh: THREE.Mesh;
  t: number;
}

interface LineupState {
  _existing?: Set<THREE.Object3D>;
  _heroes?: Hero[];
  _screen?: THREE.Group;
  _display?: THREE.MeshBasicMaterial;
  _texture?: THREE.Texture;
  _stripeTex?: THREE.Texture;
  _bulbs?: THREE.MeshBasicMaterial[];
  _ripples?: Ripple[];
  _layout?: { sw: number; sh: number; bottom: number; z: number; gap: number };
  _root?: HTMLDivElement;
  _tags?: HTMLDivElement;
  _top?: HTMLDivElement;
  _foot?: HTMLDivElement;
  _buttons?: Array<ReturnType<typeof ui.button>>;
  _play?: ReturnType<typeof ui.button>;
  _t?: number;
  /** Seconds since PLAY!, or null while waiting for it. */
  _goT?: number | null;
  _flash?: number;
  _camPos?: THREE.Vector3;
  _camLook?: THREE.Vector3;
  _left?: boolean;
  _offResize?: () => void;
  _onKey?: (e: KeyboardEvent) => void;
  _startMatch(): void;
  _buildStage(): void;
  _layoutRow(): void;
  _fitCamera(): void;
  _go(): void;
  _back(): void;
  _ripple(at: THREE.Vector3): void;
}

function toon(color: string): THREE.MeshToonMaterial {
  return new THREE.MeshToonMaterial({ color: hex(color) });
}

const easeOut = (u: number): number => 1 - (1 - u) * (1 - u);
const easeInOut = (u: number): number => (u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2);

const lineupImpl: LineupState & Screen = {
  id: "lineup",

  enter() {
    injectStyles();
    ui.clearScreen();
    this._t = 0;
    this._goT = null;
    this._flash = 0;
    this._left = false;
    this._ripples = [];
    this._bulbs = [];
    this._heroes = [];
    this._buttons = [];

    this._startMatch();

    // The picture first: the shot hides everything else in the scene while it renders.
    const boardId = activeBoardId();
    const pic = boardSnapshot(boardId);
    this._existing = new Set(world.scene?.children ?? []);
    if (pic) {
      const tex = new THREE.CanvasTexture(pic);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      this._texture = tex;
    }
    this._buildStage();

    // ---- DOM ----
    const root = document.createElement("div");
    root.className = "ssp-lu";
    root.dataset.sspScreen = "lineup";

    const tags = document.createElement("div");
    tags.className = "ssp-lu__tags";
    root.appendChild(tags);
    this._tags = tags;

    const top = document.createElement("div");
    top.className = "ssp-lu__top";
    const back = ui.button({
      label: "◀ BACK",
      kind: "ghost",
      size: "sm",
      sound: "ui.back",
      onClick: () => this._back(),
      ariaLabel: "Back to the board menu",
    });
    const head = document.createElement("div");
    head.className = "ssp-lu__head";
    const kicker = document.createElement("div");
    kicker.className = "ssp-lu__kicker";
    kicker.textContent = "READY TO PARTY?";
    const name = document.createElement("div");
    name.className = "ssp-lu__board";
    name.textContent = BOARDS[boardId].name;
    head.append(kicker, name);
    if (readPersistedRules().board === "random") {
      const pick = document.createElement("div");
      pick.className = "ssp-lu__pick";
      pick.textContent = "RANDOM PICK!";
      head.appendChild(pick);
    }
    top.append(back.el, head, document.createElement("span"));
    root.appendChild(top);
    this._top = top;

    const foot = document.createElement("div");
    foot.className = "ssp-lu__foot";
    const play = ui.button({
      label: "PLAY!",
      kind: "gold",
      size: "lg",
      sound: null,
      onClick: () => this._go(),
      ariaLabel: "Play: jump into the board",
    });
    play.el.classList.add("ssp-lu__play", "is-ready");
    foot.appendChild(play.el);
    root.appendChild(foot);
    this._foot = foot;
    this._play = play;
    this._buttons = [back, play];

    // Name tags under each hero's feet.
    for (const [i, hero] of this._heroes.entries()) {
      const p = match.players[i];
      const tag = document.createElement("div");
      tag.className = "ssp-lu-tag";
      tag.style.background = characterColor(hero.ch.kind.key);
      // "YOU" under your hero, the name under each rival (short enough for a phone row).
      if (p?.controller === "local") {
        const who = document.createElement("b");
        who.textContent = "YOU";
        tag.appendChild(who);
      } else tag.textContent = p?.name ?? hero.ch.kind.name;
      tags.appendChild(tag);
      hero.tag = tag;
    }

    document.body.appendChild(root);
    this._root = root;

    this._layoutRow();
    this._fitCamera();
    this._offResize = onViewportChange(() => {
      if (this._goT === null) this._layoutRow();
      this._fitCamera();
    });
    requestAnimationFrame(() => this._fitCamera());

    this._onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        this._go();
      } else if (e.key === "Escape") {
        e.preventDefault();
        this._back();
      }
    };
    window.addEventListener("keydown", this._onKey);
  },

  /** Seat the party picked on character select (or the default four on a direct visit). */
  _startMatch() {
    const setup = partySetup();
    const seated = roster.slice(0, MATCH_SEATS);
    const kinds = setup?.kinds ?? seated.map((c) => c.key);
    const names = setup?.names ?? seated.map((c) => c.name);
    const controllers = setup?.controllers ?? kinds.map((_, i) => (i === 0 ? ("local" as const) : ("cpu" as const)));
    let seed = setup?.seed;
    if (!setup) {
      const s = new URLSearchParams(window.location.search).get("seed");
      if (s && Number.isFinite(Number(s))) seed = Number(s);
    }
    setOnlineMatch(false);
    startMatch(kinds, names, readTurnsRule(), seed, controllers);
  },

  _buildStage() {
    const scene = world.scene;
    if (!scene) return;
    const add = (o: THREE.Object3D): void => {
      scene.add(o);
    };

    add(new THREE.HemisphereLight(0xffffff, hex(palette.ink), 0.7));

    // Big-top backdrop: candy and cream tent stripes behind the screen.
    const stripes = document.createElement("canvas");
    stripes.width = 64;
    stripes.height = 4;
    const sctx = stripes.getContext("2d")!;
    sctx.fillStyle = palette.candyDeep;
    sctx.fillRect(0, 0, 32, 4);
    sctx.fillStyle = palette.berry;
    sctx.fillRect(32, 0, 32, 4);
    const stripeTex = new THREE.CanvasTexture(stripes);
    stripeTex.colorSpace = THREE.SRGBColorSpace;
    stripeTex.wrapS = THREE.RepeatWrapping;
    stripeTex.repeat.set(16, 1);
    stripeTex.magFilter = THREE.NearestFilter;
    const wallMat = new THREE.MeshBasicMaterial({ map: stripeTex, toneMapped: false });
    wallMat.color.setScalar(0.62);
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(9, 9, 24, 48, 1, true, -Math.PI * 0.62, Math.PI * 1.24), wallMat);
    wall.position.set(0, 11.6, 3.5);
    wall.rotation.y = Math.PI;
    wall.material.side = THREE.BackSide;
    add(wall);
    this._stripeTex = stripeTex;

    // Floor and the stage the heroes stand on.
    const floor = new THREE.Mesh(new THREE.CircleGeometry(30, 56), toon(palette.berryDeep));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.36;
    add(floor);
    const stage = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.34, 56, 1, false, 0, Math.PI), toon(palette.sun));
    stage.name = "lineup:stage";
    stage.rotation.y = -Math.PI / 2;
    stage.position.set(0, -0.17, -0.6);
    add(stage);
    const lip = new THREE.Mesh(new THREE.CylinderGeometry(1.02, 1.02, 0.1, 56, 1, false, 0, Math.PI), toon(palette.candy));
    lip.name = "lineup:lip";
    lip.rotation.y = -Math.PI / 2;
    lip.position.set(0, -0.04, -0.6);
    add(lip);

    // The marquee screen: unit-size parts, scaled to the layout in _layoutRow().
    const screen = new THREE.Group();
    screen.name = "lineup:screen";
    const trim = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), toon(palette.sun));
    trim.name = "trim";
    const bezel = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), toon(palette.ink));
    bezel.name = "bezel";
    const display = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      map: this._texture ?? null,
      toneMapped: false,
    });
    if (!this._texture) display.color.set(hex(palette.inkSoft));
    this._display = display;
    const face = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), display);
    face.name = "face";
    screen.add(trim, bezel, face);
    // Legs, and a row of marquee bulbs along the top and bottom of the frame.
    for (const side of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 1, 14), toon(palette.metal));
      leg.name = side < 0 ? "legL" : "legR";
      screen.add(leg);
    }
    const bulbGeo = new THREE.SphereGeometry(1, 10, 8);
    for (let i = 0; i < 26; i++) {
      const m = new THREE.MeshBasicMaterial({ color: hex(i % 2 ? palette.cream : palette.sun), toneMapped: false });
      this._bulbs!.push(m);
      const b = new THREE.Mesh(bulbGeo, m);
      b.name = `bulb${i}`;
      screen.add(b);
    }
    add(screen);
    this._screen = screen;

    // A soft key from the front so the heroes read against the screen.
    const spot = new THREE.SpotLight(0xffffff, 30, 0, Math.PI / 5, 0.6, 1.1);
    spot.position.set(0, 7, 6);
    spot.target.position.set(0, 0.8, 0);
    add(spot);
    add(spot.target);

    // Heroes, feet on the stage top (y = 0).
    const kinds = match.players.map((p) => p.kind);
    for (const key of kinds) {
      const ch = createCharacter(key);
      ch.setFacing(0);
      ch.anim.idle();
      ch.group.updateWorldMatrix(true, true);
      const raw = new THREE.Box3().setFromObject(ch.group);
      const holder = new THREE.Group();
      ch.group.position.y = -raw.min.y;
      holder.add(ch.group);
      add(holder);
      this._heroes!.push({
        ch,
        holder,
        home: new THREE.Vector3(),
        target: new THREE.Vector3(),
        tag: document.createElement("div"),
        leaveAt: 0,
        phase: "stand",
      });
    }
  },

  /** Size the screen and space the row for this aspect (portrait stands closer and shows a smaller screen). */
  _layoutRow() {
    const heroes = this._heroes ?? [];
    const { w, h } = viewportSize();
    const portrait = w / h < 1;
    const n = heroes.length;
    const gap = portrait ? 1.2 : 1.75;
    const sw = portrait ? Math.max(4.4, gap * (n - 1) + 1.4) : Math.max(6.4, gap * (n - 1) + 1.6);
    const sh = sw / PIC_ASPECT;
    let tallest = 1.2;
    for (const hero of heroes) {
      const box = new THREE.Box3().setFromObject(hero.ch.group);
      tallest = Math.max(tallest, box.max.y - box.min.y);
    }
    const bottom = tallest * 0.55;
    const z = -2.4;
    this._layout = { sw, sh, bottom, z, gap };

    const screen = this._screen;
    if (screen) {
      const cy = bottom + sh / 2;
      const set = (name: string, fn: (o: THREE.Object3D) => void): void => {
        const o = screen.getObjectByName(name);
        if (o) fn(o);
      };
      set("trim", (o) => {
        o.scale.set(sw + 0.62, sh + 0.62, 0.28);
        o.position.set(0, cy, z - 0.2);
      });
      set("bezel", (o) => {
        o.scale.set(sw + 0.3, sh + 0.3, 0.34);
        o.position.set(0, cy, z - 0.1);
      });
      set("face", (o) => {
        o.scale.set(sw, sh, 1);
        o.position.set(0, cy, z + 0.08);
      });
      const legH = bottom + 0.36;
      for (const [name, side] of [["legL", -1], ["legR", 1]] as const) {
        set(name, (o) => {
          o.scale.set(0.16, legH, 0.16);
          o.position.set(side * sw * 0.36, -0.36 + legH / 2, z - 0.2);
        });
      }
      const perRow = 13;
      for (let i = 0; i < 26; i++) {
        const row = Math.floor(i / perRow);
        const k = i % perRow;
        set(`bulb${i}`, (o) => {
          o.scale.setScalar(0.075);
          o.position.set(-sw / 2 + (k / (perRow - 1)) * sw, row === 0 ? cy + sh / 2 + 0.31 : cy - sh / 2 - 0.31, z - 0.02);
        });
      }
      // The stage reaches past the row's ends.
      const half = Math.max(sw / 2 + 0.5, gap * (n - 1) / 2 + 1.2);
      for (const nm of ["lineup:stage", "lineup:lip"]) {
        const o = world.scene?.getObjectByName(nm);
        if (o) o.scale.set(2.1, 1, half); // turned a quarter: local z runs across the row
      }
    }

    heroes.forEach((hero, i) => {
      const x = (i - (n - 1) / 2) * gap;
      hero.home.set(x, 0, 0.35);
      hero.target.set(x * 0.55, bottom + sh * 0.36, z + 0.1);
      if (hero.phase === "stand") hero.holder.position.copy(hero.home);
    });
  },

  /** Fit the screen and the row between the header and the PLAY! bar. */
  _fitCamera() {
    const cam = world.camera;
    const L = this._layout;
    if (!cam || !L) return;
    const { w, h } = viewportSize();
    const topY = this._top?.getBoundingClientRect().bottom ?? 0;
    const footR = this._foot?.getBoundingClientRect();
    const botY = footR && footR.height > 0 ? footR.top : h;
    // Room under the stage for the name tags.
    const TAG_ROOM = 34;
    const bandH = Math.max(80, botY - topY - 12 - TAG_ROOM);
    const bandMid = topY + 6 + bandH / 2;

    const box = new THREE.Box3(
      new THREE.Vector3(-L.sw / 2 - 0.4, -0.2, L.z - 0.3),
      new THREE.Vector3(L.sw / 2 + 0.4, L.bottom + L.sh + 0.45, 0.9)
    );
    const centre = box.getCenter(new THREE.Vector3());
    const dir = new THREE.Vector3(0, Math.sin(CAM_ELEV), Math.cos(CAM_ELEV));
    cam.fov = FOV;
    cam.aspect = w / h;
    cam.setViewOffset(w, h, 0, h / 2 - bandMid, w, h);
    let dist = 12;
    const corner = new THREE.Vector3();
    for (let pass = 0; pass < 8; pass++) {
      cam.position.copy(centre).addScaledVector(dir, dist);
      cam.lookAt(centre);
      cam.updateProjectionMatrix();
      cam.updateMatrixWorld(true);
      let x0 = Infinity;
      let x1 = -Infinity;
      let y0 = Infinity;
      let y1 = -Infinity;
      for (let i = 0; i < 8; i++) {
        corner.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z);
        corner.project(cam);
        x0 = Math.min(x0, corner.x);
        x1 = Math.max(x1, corner.x);
        y0 = Math.min(y0, corner.y);
        y1 = Math.max(y1, corner.y);
      }
      const pw = ((x1 - x0) / 2) * w;
      const ph = ((y1 - y0) / 2) * h;
      const s = Math.max(pw / (w * 0.94), ph / (bandH * 0.96));
      dist = Math.max(2, dist * s);
    }
    cam.position.copy(centre).addScaledVector(dir, dist);
    cam.lookAt(centre);
    cam.updateProjectionMatrix();
    this._camPos = cam.position.clone();
    this._camLook = centre.clone();
  },

  _go() {
    if (this._goT !== null || this._left) return;
    this._goT = 0;
    audio.sfx.play("crowd.cheer");
    for (const b of this._buttons ?? []) b.setEnabled(false);
    this._play?.el.classList.remove("is-ready");
    this._root?.classList.add("is-going");
    // Left to right, the local player first when they are not already leftmost.
    const heroes = this._heroes ?? [];
    const order = heroes.map((_, i) => i);
    const me = match.players.findIndex((p) => p.controller === "local");
    if (me > 0) order.unshift(...order.splice(me, 1));
    order.forEach((idx, k) => {
      heroes[idx].leaveAt = 0.2 + k * JUMP_STAGGER;
    });
  },

  _back() {
    if (this._goT !== null || this._left) return;
    audio.sfx.play("ui.back");
    screens.goto("boards");
  },

  _ripple(at: THREE.Vector3) {
    const mesh = new THREE.Mesh(
      new THREE.RingGeometry(0.62, 0.8, 40),
      new THREE.MeshBasicMaterial({ color: hex(palette.cream), transparent: true, toneMapped: false, depthWrite: false })
    );
    mesh.position.set(at.x, at.y, (this._layout?.z ?? 0) + 0.1);
    mesh.scale.setScalar(0.2);
    world.scene?.add(mesh);
    this._ripples?.push({ mesh, t: 0 });
  },

  exit() {
    this._offResize?.();
    this._offResize = undefined;
    if (this._onKey) window.removeEventListener("keydown", this._onKey);
    this._onKey = undefined;
    const cam = world.camera;
    if (cam) {
      cam.clearViewOffset();
      cam.fov = 45;
      cam.updateProjectionMatrix();
    }
    for (const hero of this._heroes ?? []) {
      world.scene?.remove(hero.holder);
      hero.ch.dispose();
    }
    this._heroes = undefined;
    for (const r of this._ripples ?? []) {
      world.scene?.remove(r.mesh);
      r.mesh.geometry.dispose();
      (r.mesh.material as THREE.Material).dispose();
    }
    this._ripples = undefined;
    // Sweep every scene object added since enter (stage, screen, lights).
    const existing = this._existing;
    if (existing && world.scene) {
      for (const obj of [...world.scene.children]) {
        if (existing.has(obj)) continue;
        world.scene.remove(obj);
        const geoms = new Set<THREE.BufferGeometry>();
        obj.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh) {
            geoms.add(m.geometry);
            const mats = Array.isArray(m.material) ? m.material : [m.material];
            for (const mat of mats) mat.dispose();
          }
          const l = o as THREE.Light;
          if (l.isLight) l.dispose();
        });
        for (const g of geoms) g.dispose();
      }
    }
    this._existing = undefined;
    this._texture?.dispose();
    this._texture = undefined;
    this._stripeTex?.dispose();
    this._stripeTex = undefined;
    this._display = undefined;
    this._screen = undefined;
    this._bulbs = undefined;
    for (const b of this._buttons ?? []) b.destroy();
    this._buttons = undefined;
    this._play = undefined;
    this._root?.remove();
    this._root = undefined;
    this._tags = undefined;
    this._top = undefined;
    this._foot = undefined;
    ui.clearScreen();
  },

  update(dt: number) {
    const t = (this._t = (this._t ?? 0) + dt);
    const heroes = this._heroes ?? [];
    const L = this._layout;

    // Marquee bulbs chase; the display flashes as each hero lands in it.
    this._bulbs?.forEach((m, i) => {
      const on = Math.floor(t * 6 + i) % 3 !== 0;
      m.color.set(hex(on ? (i % 2 ? palette.cream : palette.sun) : palette.sunDeep));
    });
    this._flash = Math.max(0, (this._flash ?? 0) - dt * 2.6);
    if (this._display && this._texture) this._display.color.setScalar(1 + (this._flash ?? 0) * 0.9);

    for (const r of this._ripples ?? []) {
      r.t += dt / 0.55;
      const u = Math.min(1, r.t);
      r.mesh.scale.setScalar(0.2 + easeOut(u) * 1.6);
      (r.mesh.material as THREE.MeshBasicMaterial).opacity = 1 - u;
      r.mesh.visible = u < 1;
    }

    for (const [i, hero] of heroes.entries()) {
      hero.ch.update(dt);
      const g = this._goT ?? null;
      if (g === null || hero.phase === "in" || g < hero.leaveAt) {
        if (hero.phase === "stand") hero.holder.rotation.y = Math.sin(t * 1.3 + i * 1.7) * 0.12;
        continue;
      }
      const local = g - hero.leaveAt;
      if (local < CROUCH_S) {
        if (hero.phase !== "crouch") {
          hero.phase = "crouch";
          hero.ch.anim.squash();
        }
        const k = Math.sin((local / CROUCH_S) * Math.PI * 0.5);
        hero.holder.scale.set(1 + 0.12 * k, 1 - 0.2 * k, 1 + 0.12 * k);
        continue;
      }
      if (hero.phase !== "hop") {
        hero.phase = "hop";
        hero.ch.anim.jump();
        hero.ch.setFacing(Math.PI);
        hero.holder.rotation.y = 0;
        audio.sfx.play("jump");
      }
      const u = Math.min(1, (local - CROUCH_S) / HOP_S);
      const p = hero.holder.position;
      p.lerpVectors(hero.home, hero.target, easeInOut(u));
      p.y += Math.sin(u * Math.PI) * 0.85;
      const shrink = u < 0.55 ? 1 : 1 - easeInOut((u - 0.55) / 0.45) * 0.8;
      const stretch = u < 0.3 ? 1 + 0.15 * Math.sin((u / 0.3) * Math.PI) : 1;
      hero.holder.scale.set(shrink / Math.sqrt(stretch), shrink * stretch, shrink / Math.sqrt(stretch));
      if (u >= 1) {
        hero.phase = "in";
        hero.holder.visible = false;
        hero.tag.style.opacity = "0";
        this._ripple(hero.target);
        this._flash = 1;
        audio.sfx.play("pop");
        audio.sfx.play("happening.magic");
      }
    }

    // Name tags follow the feet until their hero leaves the stage.
    const cam = world.camera;
    if (cam) {
      cam.updateMatrixWorld();
      const { w, h } = viewportSize();
      const v = new THREE.Vector3();
      for (const hero of heroes) {
        if (hero.phase !== "stand") {
          hero.tag.style.opacity = "0";
          continue;
        }
        v.copy(hero.holder.position).project(cam);
        hero.tag.style.left = `${((v.x * 0.5 + 0.5) * w).toFixed(1)}px`;
        hero.tag.style.top = `${((-v.y * 0.5 + 0.5) * h + 6).toFixed(1)}px`;
      }
    }

    // Everyone is in: a beat, then push into the screen and load the board.
    if (this._goT != null) {
      const goT = (this._goT += dt);
      const lastIn = heroes.length ? Math.max(...heroes.map((x) => x.leaveAt)) + CROUCH_S + HOP_S : 0;
      const pushT = goT - lastIn - SETTLE_S;
      if (pushT > 0 && cam && L && this._camPos && this._camLook) {
        if (!this._left && pushT - dt <= 0) audio.sfx.play("whoosh");
        const u = easeInOut(Math.min(1, pushT / PUSH_S));
        const into = new THREE.Vector3(0, L.bottom + L.sh / 2, L.z + 0.6);
        cam.position.lerpVectors(this._camPos, into, u * 0.92);
        cam.lookAt(new THREE.Vector3().lerpVectors(this._camLook, new THREE.Vector3(0, L.bottom + L.sh / 2, L.z), u));
        if (pushT >= PUSH_S * 0.8 && !this._left) {
          this._left = true;
          screens.goto("board");
        }
      }
    }
  },

  render() {},
};

export const partyLineupScreen: Screen = lineupImpl;
