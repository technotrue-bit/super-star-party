/**
 * SUPER STAR PARTY — day -> dusk -> night on the board (lively board, slice 3).
 *
 * The board screen hands in match.turn every frame; timeOfDay() turns it into
 * a target look and this eases toward it (cosmetic, frame-driven). It drives
 * the boot hemi + key lights, the background, and a fog of its own, brightens
 * the lamp posts, lights a string of bulbs along the bunting, shows the LAST 5
 * marquee, and in the last five turns pulls in the fireworks chunk.
 *
 * Everything it changes on the shared scene is snapshotted at creation and
 * put back by dispose() (the board's exit), so minigames get the boot rig
 * untouched. New light: none. New draw calls: bulbs (1) + fireworks (1).
 * Never writes `match`. update() allocates nothing once the turn is steady.
 */
import * as THREE from "three";
import { settings, prefersReducedMotion } from "../../config/settings";
import { palette } from "../../config/palette";
import { blankTimeOfDay, sampleTimeOfDay, timeOfDay, FOG_OFF_FAR, type TimeOfDay } from "./timeOfDay";
import type { Fireworks } from "./fireworks";

export interface NightHost {
  /** The shared scene whose lights, fog, and background are driven. */
  scene: THREE.Scene;
  /** Board-local parent for the bulbs and fireworks. */
  root: THREE.Object3D;
  /** Lamp-post glow cores and halos (board meshes, restyled from dusk). */
  lamps: ReadonlyArray<{ glow: THREE.Mesh; halo: THREE.Mesh }>;
  /** String-light bulb spots (board-local). */
  bulbs: ReadonlyArray<{ x: number; y: number; z: number }>;
  /** The board camera: fireworks are framed for it. */
  camera: () => THREE.Camera | null;
  /** Board centre (fireworks fallback without a camera). */
  center: { x: number; z: number };
}

export interface Night {
  /** Feed the live turn; the look eases toward its target. */
  setTurn(turn: number, totalTurns: number): void;
  update(dt: number): void;
  /** Restore the scene rig and free everything. */
  dispose(): void;
}

const L = settings.lively;

// ---- fireworks chunk: fetched once per page, the first time it is wanted -------------
type FireworksModule = typeof import("./fireworks");
let fireworksChunk: Promise<FireworksModule | null> | null = null;
let fireworksImports = 0;
let fireworksLoaded = false;
let fireworksFailed = false;

function loadFireworks(): Promise<FireworksModule | null> {
  if (!fireworksChunk) {
    fireworksImports++;
    fireworksChunk = import("./fireworks").then(
      (m) => {
        fireworksLoaded = true;
        return m;
      },
      (err) => {
        // Cosmetic: no retry, so the chunk is never asked for twice.
        fireworksFailed = true;
        console.warn("[SSP] fireworks chunk failed", err);
        return null;
      }
    );
  }
  return fireworksChunk;
}

// ---- LAST 5 marquee (DOM, palette colours) ---------------------------------------------
const MARQUEE_STYLE_ID = "ssp-last5-style";
function injectMarqueeStyle(): void {
  if (document.getElementById(MARQUEE_STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = MARQUEE_STYLE_ID;
  // Sits under the HUD chip row and clear of the pause / map buttons on the
  // right; pointer-events none, so it never blocks a tap.
  s.textContent = `
.ssp-last5 { position:fixed; left:50%; top:calc(env(safe-area-inset-top, 0px) + 122px); transform:translateX(-50%); z-index:62; pointer-events:none;
  display:flex; align-items:center; gap:8px; padding:4px 14px; border-radius:999px; white-space:nowrap;
  font-family:Fredoka, system-ui, sans-serif; font-weight:700; font-size:17px; letter-spacing:1px; color:${palette.ink};
  background:${palette.sun}; border:3px solid ${palette.ink}; box-shadow:0 4px 0 ${palette.ink}; }
.ssp-last5__bulbs { width:34px; height:10px; border-radius:6px;
  background-image:radial-gradient(circle, ${palette.lampHot} 0 2.5px, transparent 3px), radial-gradient(circle, ${palette.candy} 0 2.5px, transparent 3px);
  background-size:10px 10px; background-position:0 0, 5px 0; background-color:${palette.ink};
  animation:ssp-last5-chase .6s steps(2) infinite; }
.ssp-last5--still .ssp-last5__bulbs { animation:none; }
@keyframes ssp-last5-chase { to { background-position:10px 0, 15px 0; } }
@media (prefers-reduced-motion: reduce) { .ssp-last5__bulbs { animation:none; } }
`;
  document.head.appendChild(s);
}

function makeMarquee(): HTMLElement {
  injectMarqueeStyle();
  const el = document.createElement("div");
  el.className = "ssp-last5";
  el.setAttribute("role", "status");
  const left = document.createElement("span");
  left.className = "ssp-last5__bulbs";
  const text = document.createElement("span");
  text.textContent = "LAST 5 TURNS!";
  const right = document.createElement("span");
  right.className = "ssp-last5__bulbs";
  el.append(left, text, right);
  if (prefersReducedMotion()) el.classList.add("ssp-last5--still");
  document.body.appendChild(el);
  return el;
}

// ---- debug ---------------------------------------------------------------------------
let current: {
  root: THREE.Object3D;
  view: () => ReturnType<typeof nightDebug>["live"];
} | null = null;
let overrideTurn: number | null = null;

/**
 * Probe aid: drive the board's time of day as if match.turn were `turn`
 * (null hands control back to the match). Lively-only, never touches match.
 */
export function setNightTurnOverride(turn: number | null): void {
  overrideTurn = turn === null || !Number.isFinite(turn) ? null : Math.floor(turn);
}

function findLight<T extends THREE.Light>(scene: THREE.Scene, name: string, type: new (...a: never[]) => T): T | null {
  const named = scene.getObjectByName(name);
  if (named instanceof type) return named;
  for (const c of scene.children) if (c instanceof type) return c;
  return null;
}

export function createNight(host: NightHost): Night {
  const scene = host.scene;
  const hemi = findLight(scene, "world:hemi", THREE.HemisphereLight);
  const key = findLight(scene, "world:key", THREE.DirectionalLight);

  // ---- snapshot everything this touches on the shared scene ---------------------------
  const saved = {
    background: scene.background,
    fog: scene.fog,
    hemiColor: hemi ? hemi.color.clone() : null,
    hemiGround: hemi ? hemi.groundColor.clone() : null,
    hemiIntensity: hemi ? hemi.intensity : 0,
    keyColor: key ? key.color.clone() : null,
    keyIntensity: key ? key.intensity : 0,
  };
  const bg = new THREE.Color();
  const fog = new THREE.Fog(palette.nightSky, FOG_OFF_FAR, FOG_OFF_FAR * 2);

  // ---- lamps: remember the day look ----------------------------------------------------
  const lampDay = host.lamps.map((l) => ({
    glow: (l.glow.material as THREE.MeshBasicMaterial).color.clone(),
    halo: (l.halo.material as THREE.MeshBasicMaterial).color.clone(),
    haloOpacity: (l.halo.material as THREE.MeshBasicMaterial).opacity,
  }));
  const hot = new THREE.Color(palette.lampHot);
  const warm = new THREE.Color(palette.lampWarm);

  // ---- string-light bulbs: one InstancedMesh, hidden by day ----------------------------
  // Unlit octahedra, 8 triangles each: at phone size a bulb is a few pixels.
  const bulbGeo = new THREE.BufferGeometry();
  {
    const r = 0.18;
    bulbGeo.setAttribute("position", new THREE.Float32BufferAttribute([r, 0, 0, -r, 0, 0, 0, r, 0, 0, -r, 0, 0, 0, r, 0, 0, -r], 3));
    bulbGeo.setIndex([0, 2, 4, 2, 1, 4, 1, 3, 4, 3, 0, 4, 2, 0, 5, 1, 2, 5, 3, 1, 5, 0, 3, 5]);
  }
  const bulbMat = new THREE.MeshBasicMaterial({ color: palette.white, transparent: true, opacity: 0, fog: false });
  const bulbs = new THREE.InstancedMesh(bulbGeo, bulbMat, Math.max(1, host.bulbs.length));
  bulbs.name = "lively:string-lights";
  bulbs.castShadow = false;
  bulbs.receiveShadow = false;
  bulbs.frustumCulled = false;
  bulbs.visible = false;
  bulbs.count = host.bulbs.length;
  {
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    const tints = [palette.lampWarm, palette.lampHot, palette.candy, palette.lampWarm, palette.bubble];
    host.bulbs.forEach((b, i) => {
      bulbs.setMatrixAt(i, m.makeTranslation(b.x, b.y - 0.06, b.z));
      bulbs.setColorAt(i, c.set(tints[i % tints.length]));
    });
  }
  host.root.add(bulbs);

  // ---- state ---------------------------------------------------------------------------
  let target: TimeOfDay = timeOfDay(1, 1);
  let snapped = false;
  let progress = 0;
  const cur = blankTimeOfDay();
  let marquee: HTMLElement | null = null;
  let fw: Fireworks | null = null;
  let fwWanted = false;
  let disposed = false;
  let lastTurn = 1;
  let lastTotal = 1;

  const apply = (): void => {
    sampleTimeOfDay(progress, cur);
    if (hemi) {
      hemi.color.setHex(cur.hemiSky);
      hemi.groundColor.setHex(cur.hemiGround);
      hemi.intensity = cur.hemiIntensity;
    }
    if (key) {
      key.color.setHex(cur.keyColor);
      key.intensity = cur.keyIntensity;
    }
    scene.background = bg.setHex(cur.sky);
    if (cur.fogFar < FOG_OFF_FAR) {
      fog.color.setHex(cur.fogColor);
      fog.near = cur.fogNear;
      fog.far = cur.fogFar;
      scene.fog = fog;
    } else {
      scene.fog = saved.fog;
    }
    const g = cur.lampGlow;
    for (let i = 0; i < host.lamps.length; i++) {
      const l = host.lamps[i];
      const d = lampDay[i];
      (l.glow.material as THREE.MeshBasicMaterial).color.copy(d.glow).lerp(hot, g);
      const haloMat = l.halo.material as THREE.MeshBasicMaterial;
      haloMat.color.copy(d.halo).lerp(warm, g);
      // A brighter, slightly wider halo; the hot core does the popping. Kept
      // small: the foreground lamp sits next to a space in the follow view.
      haloMat.opacity = d.haloOpacity + 0.28 * g;
      l.halo.scale.setScalar(1 + 0.12 * g);
    }
    bulbs.visible = g > 0.02 && host.bulbs.length > 0;
    bulbMat.opacity = Math.min(1, g * 1.2);
  };

  const night: Night = {
    setTurn(turn: number, totalTurns: number): void {
      if (disposed) return;
      const t = overrideTurn ?? turn;
      if (snapped && t === lastTurn && totalTurns === lastTotal) return;
      lastTurn = t;
      lastTotal = totalTurns;
      target = timeOfDay(t, totalTurns);
      if (!snapped) {
        // Board entry (match start, or back from a minigame at night): no fade from day.
        snapped = true;
        progress = target.progress;
        apply();
      }
    },

    update(dt: number): void {
      if (disposed || !snapped) return;
      const reduced = prefersReducedMotion();
      if (progress !== target.progress) {
        const k = reduced ? 1 : 1 - Math.exp(-dt / L.nightTween);
        progress += (target.progress - progress) * k;
        if (Math.abs(target.progress - progress) < 1e-4) progress = target.progress;
        apply();
      }

      // LAST 5 marquee
      if (target.last5 && !marquee) marquee = makeMarquee();
      else if (!target.last5 && marquee) {
        marquee.remove();
        marquee = null;
      }
      if (marquee) marquee.classList.toggle("ssp-last5--still", reduced);

      // Fireworks: the chunk is asked for the first time the last five turns
      // arrive (never under reduced motion), then kept for the page.
      if (target.last5 && L.fireworks && !reduced && !fwWanted) {
        fwWanted = true;
        void loadFireworks().then((mod) => {
          if (disposed || !mod) return;
          fw = mod.createFireworks({ root: host.root, camera: host.camera, center: host.center });
        });
      }
      if (fw) {
        fw.setActive(target.last5);
        if (reduced) fw.clear();
        else fw.update(dt);
      }
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      // Put the shared rig back exactly as it was found.
      if (hemi && saved.hemiColor && saved.hemiGround) {
        hemi.color.copy(saved.hemiColor);
        hemi.groundColor.copy(saved.hemiGround);
        hemi.intensity = saved.hemiIntensity;
      }
      if (key && saved.keyColor) {
        key.color.copy(saved.keyColor);
        key.intensity = saved.keyIntensity;
      }
      scene.background = saved.background;
      scene.fog = saved.fog;
      marquee?.remove();
      marquee = null;
      fw?.dispose();
      fw = null;
      host.root.remove(bulbs);
      bulbGeo.dispose();
      bulbMat.dispose();
      bulbs.dispose();
      if (current?.root === host.root) current = null;
    },
  };

  const hexOf = (c: THREE.Color | null | undefined): string | null => (c ? `#${c.getHexString()}` : null);
  current = {
    root: host.root,
    view: () => ({
      turn: lastTurn,
      totalTurns: lastTotal,
      phase: target.phase,
      last5: target.last5,
      progress: +progress.toFixed(4),
      targetProgress: +target.progress.toFixed(4),
      lampGlow: +cur.lampGlow.toFixed(3),
      hemi: hemi ? { sky: hexOf(hemi.color), ground: hexOf(hemi.groundColor), intensity: +hemi.intensity.toFixed(3) } : null,
      key: key ? { color: hexOf(key.color), intensity: +key.intensity.toFixed(3) } : null,
      background: scene.background instanceof THREE.Color ? hexOf(scene.background) : null,
      fog: scene.fog instanceof THREE.Fog ? { color: hexOf(scene.fog.color), near: +scene.fog.near.toFixed(1), far: +scene.fog.far.toFixed(1) } : null,
      bulbs: { count: bulbs.count, visible: bulbs.visible },
      marquee: marquee !== null,
      fireworks: fw ? fw.debug() : null,
    }),
  };
  return night;
}

/** Probe view: the board's time of day, the fireworks chunk, and their cost. */
export function nightDebug(): {
  active: boolean;
  override: number | null;
  chunk: { imports: number; loaded: boolean; failed: boolean };
  live: {
    turn: number;
    totalTurns: number;
    phase: string;
    last5: boolean;
    progress: number;
    targetProgress: number;
    lampGlow: number;
    hemi: { sky: string | null; ground: string | null; intensity: number } | null;
    key: { color: string | null; intensity: number } | null;
    background: string | null;
    fog: { color: string | null; near: number; far: number } | null;
    bulbs: { count: number; visible: boolean };
    marquee: boolean;
    fireworks: ReturnType<Fireworks["debug"]> | null;
  } | null;
  budget: { drawCalls: number; triangles: number; instances: number; meshes: string[] } | null;
} {
  let budget: { drawCalls: number; triangles: number; instances: number; meshes: string[] } | null = null;
  if (current) {
    budget = { drawCalls: 0, triangles: 0, instances: 0, meshes: [] };
    const b = budget;
    current.root.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return;
      const inst = obj instanceof THREE.InstancedMesh ? obj.count : 1;
      const idx = obj.geometry.getIndex();
      const tris = Math.floor((idx ? idx.count : obj.geometry.getAttribute("position").count) / 3);
      b.drawCalls++;
      b.triangles += tris * inst;
      if (obj instanceof THREE.InstancedMesh) b.instances += inst;
      b.meshes.push(obj.name || obj.type);
    });
  }
  return {
    active: current !== null,
    override: overrideTurn,
    chunk: { imports: fireworksImports, loaded: fireworksLoaded, failed: fireworksFailed },
    live: current ? current.view() : null,
    budget,
  };
}
