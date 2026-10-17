/**
 * SUPER STAR PARTY — minigame "ready to play" screen (free play).
 *
 * MP7-style: a short looping clip of the minigame in action across the top
 * (public/minigames/<id>.webp, recorded by tools/capture-minigame-clips.mjs),
 * the name, how to win and the controls, and the four players lined up on a
 * little stage below, idling. PLAY sends everyone jumping up into the game,
 * then the minigame starts as normal (practice, GO, play, results) and comes
 * back to the minigame menu. BACK returns to the menu.
 */
import * as THREE from "three";
import { world } from "../main";
import { palette, hex } from "../config/palette";
import { match } from "../core/game";
import { audio } from "../audio/audioEngine";
import { ui } from "../ui/kit";
import { createCharacter, type Character } from "../characters/characterFactory";
import { characterColor } from "../characters/roster";
import { screens, type Screen } from "./screenManager";
import { onViewportChange, viewportSize } from "../ui/viewport";
import { loadMinigame, setPendingMinigame, type Minigame } from "../minigames/framework";
import { minigameEntry } from "../minigames/registry";
import { skipNextMinigamePreScreen } from "./minigameScreen";
import { freeplayMinigame, minigameMediaUrl, prettyMinigameId } from "../game/freeplay";

const STYLE_ID = "ssp-mgready-styles";
const PARTY_FOV = 45;
const STAGE_FOV = 30;
const SPACING = 1.55;
const JUMP_TIME = 0.9;

function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = `
    .ssp-mgr{position:fixed;inset:0;max-height:100vh;max-height:100dvh;z-index:20;display:flex;flex-direction:column;align-items:center;gap:8px;
      padding:calc(10px + env(safe-area-inset-top,0px)) calc(14px + env(safe-area-inset-right,0px)) calc(14px + env(safe-area-inset-bottom,0px)) calc(14px + env(safe-area-inset-left,0px));
      box-sizing:border-box;font-family:Fredoka,sans-serif;color:${palette.cream};pointer-events:none;
      overflow-x:hidden;overflow-y:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;touch-action:pan-y}
    .ssp-mgr > *{pointer-events:auto}
    .ssp-mgr__top{display:flex;align-items:center;justify-content:space-between;width:100%;max-width:560px}
    .ssp-mgr__ready{font-size:15px;font-weight:700;color:${palette.sun};letter-spacing:1px;text-shadow:2px 2px 0 ${palette.ink}}
    .ssp-mgr__name{font-size:clamp(24px,7vw,34px);font-weight:700;line-height:1.05;text-align:center;
      text-shadow:3px 3px 0 ${palette.ink};max-width:560px}
    .ssp-mgr__clip{position:relative;width:min(100%,520px);aspect-ratio:16/10;border:5px solid ${palette.cream};
      border-radius:18px;overflow:hidden;background:${palette.inkSoft};box-shadow:0 6px 0 ${palette.ink};flex:0 1 auto;min-height:clamp(72px,16dvh,140px)}
    .ssp-mgr__clip img{width:100%;height:100%;object-fit:cover;display:block}
    .ssp-mgr__tag{position:absolute;left:8px;top:8px;font-size:12px;font-weight:700;padding:3px 8px;border-radius:9px;
      background:${palette.candy};color:${palette.cream};letter-spacing:.5px;box-shadow:0 2px 0 ${palette.ink}}
    .ssp-mgr__info{width:min(100%,520px);display:flex;flex-direction:column;gap:5px;font-size:14px;line-height:1.3;text-align:center}
    .ssp-mgr__win{background:${palette.sun};color:${palette.ink};border-radius:12px;padding:6px 10px;font-weight:700;font-size:15px}
    .ssp-mgr__ctl{opacity:.9}
    .ssp-mgr__stage{flex:1 1 auto;min-height:140px;width:100%;max-width:560px;pointer-events:none}
    .ssp-mgr__seats{display:flex;gap:6px;width:100%;max-width:520px;justify-content:space-between}
    .ssp-mgr__seat{flex:1 1 0;min-width:0;text-align:center;font-size:12px;font-weight:700;padding:3px 4px;border-radius:9px;
      background:${palette.cream};color:${palette.ink};border:3px solid ${palette.ink};white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .ssp-mgr__seat.is-you{background:${palette.sun}}
    .ssp-mgr__seat b{display:inline-block;width:9px;height:9px;border-radius:50%;border:2px solid ${palette.ink};margin-right:4px;vertical-align:-1px}
    /* PLAY! is the last flex item and sticky, so it stays on screen even if the card has to scroll */
    .ssp-mgr__play{width:min(100%,520px);min-height:60px;font-size:28px;letter-spacing:1px;flex:none;position:sticky;bottom:0;z-index:1}
    /* The preview crops (shrinks in height first) so seats + PLAY! fit; the line-up slot keeps a floor. */
    @media (max-height:700px){
      .ssp-mgr{gap:6px;padding-top:calc(6px + env(safe-area-inset-top,0px));padding-bottom:calc(8px + env(safe-area-inset-bottom,0px))}
      .ssp-mgr__top .ssp-btn--sm{min-height:44px}
      .ssp-mgr__name{font-size:clamp(22px,6.5vw,30px)}
      .ssp-mgr__info{gap:4px;font-size:13px;line-height:1.25}
      .ssp-mgr__win{padding:4px 10px;font-size:14px}
      .ssp-mgr__stage{min-height:110px}
      .ssp-mgr__play{min-height:48px;font-size:22px;padding-top:8px;padding-bottom:8px}
    }
    @media (max-height:600px){
      .ssp-mgr__stage{min-height:96px}
      .ssp-mgr__info{font-size:12px}
      .ssp-mgr__clip{border-width:4px}
    }
    /* Landscape phones: preview + rules on the left, line-up + seats + PLAY! on the right. */
    @media (orientation:landscape) and (max-height:500px){
      .ssp-mgr{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);
        grid-template-rows:auto auto minmax(0,1fr) auto auto;
        grid-template-areas:"top top" "name stage" "clip stage" "info seats" "info play";
        column-gap:14px;row-gap:6px;justify-items:center;align-items:stretch}
      .ssp-mgr__top{grid-area:top;max-width:none}
      .ssp-mgr__top .ssp-btn--sm{min-height:40px;padding-top:4px;padding-bottom:4px}
      .ssp-mgr__name{grid-area:name;font-size:24px}
      .ssp-mgr__clip{grid-area:clip;width:auto;height:100%;max-width:100%;min-height:0;aspect-ratio:16/10;justify-self:center}
      .ssp-mgr__info{grid-area:info;align-self:start}
      .ssp-mgr__stage{grid-area:stage;min-height:0;height:100%}
      .ssp-mgr__seats{grid-area:seats;align-self:end}
      .ssp-mgr__play{grid-area:play;align-self:end;min-height:48px;font-size:22px}
    }
  `;
  document.head.appendChild(s);
}

function canvasOrigin(): { x: number; y: number } {
  const vv = window.visualViewport;
  return { x: vv?.offsetLeft ?? 0, y: vv?.offsetTop ?? 0 };
}

const corner = new THREE.Vector3();
function projectBox(box: THREE.Box3, cam: THREE.PerspectiveCamera, w: number, h: number) {
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
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

interface ReadyState {
  _id?: string;
  _root?: HTMLElement;
  _stageEl?: HTMLElement;
  _buttons?: { destroy(): void }[];
  _chars?: Character[];
  _holders?: THREE.Group[];
  _existing?: Set<THREE.Object3D>;
  _stageBox?: THREE.Box3;
  _t?: number;
  /** Seconds into the jump-in, or -1 before PLAY. */
  _jumpT?: number;
  _launched?: boolean;
  _offResize?: () => void;
  _onKey?: (e: KeyboardEvent) => void;
}

const readyImpl: ReadyState & Screen & { _fit(): void; _play(): void; _back(): void } = {
  id: "mgready",

  enter() {
    injectStyles();
    ui.clearScreen();
    const id = freeplayMinigame();
    if (!id || match.players.length === 0) {
      screens.goto("minigames");
      return;
    }
    this._id = id;
    this._t = 0;
    this._jumpT = -1;
    this._launched = false;
    this._chars = [];
    this._holders = [];
    this._buttons = [];
    this._existing = new Set(world.scene?.children ?? []);

    // ---- 3D: a little stage with the four players in a row ----
    const scene = world.scene;
    if (scene) {
      scene.add(new THREE.HemisphereLight(0xffffff, hex(palette.ink), 0.8));
      const key = new THREE.DirectionalLight(0xffffff, 1.6);
      key.position.set(2, 6, 5);
      scene.add(key);
      const grass = new THREE.Mesh(
        new THREE.CircleGeometry(16, 48),
        new THREE.MeshToonMaterial({ color: hex(palette.grassA) }),
      );
      grass.rotation.x = -Math.PI / 2;
      grass.position.y = -0.26;
      scene.add(grass);
      const stage = new THREE.Mesh(
        new THREE.BoxGeometry(SPACING * 4 + 0.8, 0.25, 2.2),
        new THREE.MeshToonMaterial({ color: hex(palette.cream) }),
      );
      stage.position.y = -0.13;
      scene.add(stage);
      const trim = new THREE.Mesh(
        new THREE.BoxGeometry(SPACING * 4 + 0.9, 0.08, 2.3),
        new THREE.MeshToonMaterial({ color: hex(palette.candy) }),
      );
      trim.position.y = -0.02;
      scene.add(trim);
      match.players.forEach((p, i) => {
        const ch = createCharacter(p.kind);
        ch.setFacing(0);
        ch.anim.idle();
        const holder = new THREE.Group();
        holder.position.set((i - (match.players.length - 1) / 2) * SPACING, 0, 0);
        holder.add(ch.group);
        scene.add(holder);
        this._chars!.push(ch);
        this._holders!.push(holder);
      });
      this._stageBox = new THREE.Box3(
        new THREE.Vector3(-SPACING * 2.1, -0.3, -1.1),
        new THREE.Vector3(SPACING * 2.1, 1.75, 1.1),
      );
    }

    // ---- DOM ----
    const root = document.createElement("div");
    root.className = "ssp-mgr";
    root.dataset.sspScreen = "mgready";
    const top = document.createElement("div");
    top.className = "ssp-mgr__top";
    const back = ui.button({ label: "◀ BACK", kind: "ghost", size: "sm", sound: "ui.back", onClick: () => this._back() });
    const ready = document.createElement("div");
    ready.className = "ssp-mgr__ready";
    ready.textContent = "READY TO PLAY?";
    top.append(back.el, ready, document.createElement("span"));
    const name = document.createElement("div");
    name.className = "ssp-mgr__name";
    name.textContent = minigameEntry(id)?.name ?? prettyMinigameId(id);
    const clip = document.createElement("div");
    clip.className = "ssp-mgr__clip";
    const img = document.createElement("img");
    img.alt = `${name.textContent} gameplay`;
    img.src = minigameMediaUrl(id, "clip");
    img.onerror = () => {
      img.src = minigameMediaUrl(id, "thumb");
      img.onerror = () => img.remove();
    };
    const tag = document.createElement("span");
    tag.className = "ssp-mgr__tag";
    tag.textContent = "▶ PREVIEW";
    clip.append(img, tag);
    const info = document.createElement("div");
    info.className = "ssp-mgr__info";
    const win = document.createElement("div");
    win.className = "ssp-mgr__win";
    win.hidden = true;
    const ctl = document.createElement("div");
    ctl.className = "ssp-mgr__ctl";
    info.append(win, ctl);
    const stageEl = document.createElement("div");
    stageEl.className = "ssp-mgr__stage";
    const seats = document.createElement("div");
    seats.className = "ssp-mgr__seats";
    for (const p of match.players) {
      const seat = document.createElement("div");
      seat.className = "ssp-mgr__seat";
      const dot = document.createElement("b");
      dot.style.background = characterColor(p.kind);
      const you = p.controller === "local";
      seat.append(dot, document.createTextNode(you ? "YOU" : p.name));
      if (you) seat.classList.add("is-you");
      seat.title = you ? `${p.name} (you)` : `${p.name} (CPU)`;
      seats.appendChild(seat);
    }
    const play = ui.button({ label: "PLAY!", kind: "gold", size: "lg", sound: null, onClick: () => this._play() });
    play.el.classList.add("ssp-mgr__play");
    root.append(top, name, clip, info, stageEl, seats, play.el);
    document.body.appendChild(root);
    this._root = root;
    this._stageEl = stageEl;
    this._buttons.push(back, play);

    // How to win + controls for this device, once the module has loaded.
    const touch = window.matchMedia?.("(pointer: coarse)").matches ?? false;
    void loadMinigame(id).then((mg: Minigame | null) => {
      if (!mg || this._id !== id || !this._root) return;
      name.textContent = mg.name;
      img.alt = `${mg.name} gameplay`;
      if (mg.rules?.win) {
        win.textContent = `🏆 ${mg.rules.win}`;
        win.hidden = false;
      }
      const lines = (touch ? mg.rules?.touch : mg.rules?.keys) ?? [];
      ctl.textContent = lines.length ? lines.join(" · ") : mg.howTo?.trim() ?? "";
      this._fit();
    });

    this._onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        this._play();
      } else if (e.key === "Escape") {
        e.preventDefault();
        this._back();
      }
    };
    window.addEventListener("keydown", this._onKey);
    this._offResize = onViewportChange(() => this._fit());
    // If the card has to scroll (very short screens), keep the line-up on its slot.
    root.addEventListener("scroll", () => this._fit(), { passive: true });
    requestAnimationFrame(() => this._fit());
    audio.music.play("shop", { intensity: 0.4 });
  },

  /** Fit the camera so the line-up fills the stage slot between the info and the PLAY button. */
  _fit() {
    const cam = world.camera;
    const slot = this._stageEl;
    const box = this._stageBox;
    if (!cam || !slot || !box) return;
    const { w, h } = viewportSize();
    const r = slot.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return;
    const o = canvasOrigin();
    const target = { x: r.left - o.x + 6, y: r.top - o.y + 4, w: Math.max(8, r.width - 12), h: Math.max(8, r.height - 8) };
    const centre = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    cam.fov = STAGE_FOV;
    cam.aspect = w / h;
    const dir = new THREE.Vector3(0, 0.32, 0.95).normalize();
    let dist = Math.max(size.x, size.y * 2) / Math.tan(THREE.MathUtils.degToRad(STAGE_FOV / 2));
    let ox = w / 2 - (target.x + target.w / 2);
    let oy = h / 2 - (target.y + target.h / 2);
    for (let pass = 0; pass < 8; pass++) {
      cam.position.copy(centre).addScaledVector(dir, dist);
      cam.lookAt(centre);
      cam.setViewOffset(w, h, ox, oy, w, h);
      cam.updateProjectionMatrix();
      cam.updateMatrixWorld(true);
      const p = projectBox(box, cam, w, h);
      const s = Math.max(p.w / target.w, p.h / target.h);
      dist = Math.max(1, dist * s);
      ox += p.x + p.w / 2 - (target.x + target.w / 2);
      oy += p.y + p.h / 2 - (target.y + target.h / 2);
    }
    cam.position.copy(centre).addScaledVector(dir, dist);
    cam.lookAt(centre);
    cam.setViewOffset(w, h, ox, oy, w, h);
    cam.updateProjectionMatrix();
  },

  /** PLAY: everyone jumps up into the game, then the minigame starts. */
  _play() {
    if ((this._jumpT ?? -1) >= 0 || !this._id) return;
    this._jumpT = 0;
    for (const b of this._buttons ?? []) (b as { setEnabled?: (on: boolean) => void }).setEnabled?.(false);
    audio.sfx.play("jump");
    audio.sfx.play("fanfare.win", { volume: 0.6 });
    this._chars?.forEach((ch) => ch.anim.jump());
  },

  _back() {
    if ((this._jumpT ?? -1) >= 0) return;
    screens.goto("minigames");
  },

  update(dt: number) {
    this._t = (this._t ?? 0) + dt;
    this._chars?.forEach((ch) => ch.update(dt));
    const jt = this._jumpT ?? -1;
    if (jt < 0) return;
    this._jumpT = jt + dt;
    // Staggered leap: crouch, then up and out of the top of the screen.
    this._holders?.forEach((hd, i) => {
      const u = Math.max(0, (this._jumpT! - i * 0.08) / JUMP_TIME);
      const e = u * u;
      hd.position.y = e * 9;
      hd.position.z = -e * 1.5;
      hd.rotation.y = e * Math.PI * 2;
    });
    if (!this._launched && this._jumpT! >= JUMP_TIME + 0.25) {
      this._launched = true;
      const id = this._id!;
      const entry = minigameEntry(id) ?? { id, name: prettyMinigameId(id) };
      setPendingMinigame(entry);
      skipNextMinigamePreScreen();
      audio.sfx.play("whoosh");
      screens.goto("minigame");
    }
  },

  render() {},

  exit() {
    if (this._onKey) window.removeEventListener("keydown", this._onKey);
    this._onKey = undefined;
    this._offResize?.();
    this._offResize = undefined;
    for (const b of this._buttons ?? []) b.destroy();
    this._buttons = undefined;
    this._root?.remove();
    this._root = undefined;
    this._stageEl = undefined;
    for (const h of this._holders ?? []) world.scene?.remove(h);
    for (const ch of this._chars ?? []) ch.dispose();
    this._holders = undefined;
    this._chars = undefined;
    const existing = this._existing;
    if (existing && world.scene) {
      for (const obj of [...world.scene.children]) {
        if (existing.has(obj)) continue;
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
    this._existing = undefined;
    if (world.camera) {
      world.camera.clearViewOffset();
      world.camera.fov = PARTY_FOV;
      world.camera.updateProjectionMatrix();
    }
    ui.clearScreen();
  },
};

export const minigameReadyScreen: Screen = readyImpl;
