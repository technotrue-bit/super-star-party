/**
 * SUPER STAR PARTY — hero face portraits for the 2D UI.
 *
 * The HUD chips, rival cards and shop show a round avatar. Instead of a
 * letter, they show the hero's own face: each hero's head is rendered once,
 * front-on, from the real 3D model into a small transparent image, so the
 * portrait always matches the current character design.
 *
 * One small offscreen renderer draws them. warmPortraits() (called at boot)
 * fills the cache one hero per idle moment so nothing stalls a frame; a
 * portrait asked for before then is drawn on the spot. When all of them
 * exist the renderer is released. Presentation only. Where WebGL is missing
 * (tests, very old devices) characterPortrait returns null and the avatar
 * keeps its letter.
 */
import * as THREE from "three";
import { buildModel } from "./models";
import { roster, type CharacterKind } from "./roster";

/** Pixel size of a portrait. The avatar is 48 CSS px, so this is crisp at 2x. */
const PORTRAIT_PX = 128;
/** Head box size to frame size: a little room round the head. */
const FRAME_PAD = 1.4;
/** Camera looks down at the face by this much (radians). */
const PORTRAIT_ELEV = 0.12;

const portraits = new Map<string, string>();
let failed = false;
let rig: { renderer: THREE.WebGLRenderer; canvas: HTMLCanvasElement; scene: THREE.Scene; cam: THREE.OrthographicCamera } | null = null;

/** Data URL of `key`'s face portrait, or null when it can't be drawn. */
export function characterPortrait(key: string): string | null {
  const k = key.trim().toLowerCase();
  const hit = portraits.get(k);
  if (hit || failed) return hit ?? null;
  const kind = roster.find((r) => r.key === k);
  if (!kind) return null;
  renderOne(kind);
  return portraits.get(k) ?? null;
}

/** Draw the remaining portraits one hero per idle moment, then free the renderer. */
export function warmPortraits(): void {
  if (typeof window === "undefined") return;
  const idle = (fn: () => void): void => {
    const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number })
      .requestIdleCallback;
    // A short timeout: a slow device that is never idle still finishes the
    // eight portraits within a couple of seconds on the title screen.
    if (ric) ric(fn, { timeout: 250 });
    else window.setTimeout(fn, 120);
  };
  const step = (): void => {
    if (failed) return;
    const next = roster.find((r) => !portraits.has(r.key));
    if (!next) return;
    renderOne(next);
    idle(step);
  };
  idle(step);
}

function setup(): boolean {
  if (rig) return true;
  if (failed) return false;
  try {
    if (typeof document === "undefined") throw new Error("no DOM");
    const canvas = document.createElement("canvas");
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.setSize(PORTRAIT_PX, PORTRAIT_PX, false);
    renderer.setClearColor(0x000000, 0);
    // The game world's lights, plus a soft front fill: at 48px a face lit
    // only from above reads darker than the colored circle behind it.
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xffffff, 0x2b1d4e, 1.1));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(3, 7, 9);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 0.7);
    fill.position.set(-2, 1, 10);
    scene.add(fill);
    rig = { renderer, canvas, scene, cam: new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 50) };
    return true;
  } catch {
    failed = true;
    return false;
  }
}

function renderOne(kind: CharacterKind): void {
  if (portraits.has(kind.key) || !setup() || !rig) return;
  const { renderer, canvas, scene, cam } = rig;
  try {
    const model = buildModel(kind);
    model.setExpression("normal");
    scene.add(model.group);
    model.group.updateMatrixWorld(true);
    const head = model.parts.head ?? model.group;
    const box = new THREE.Box3().setFromObject(head);
    const centre = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    // Centre between the head and its face, so tall crowns or ears don't
    // push the face out of the circle.
    const face = model.parts.face?.getWorldPosition(new THREE.Vector3());
    const cy = face ? (centre.y + face.y) / 2 : centre.y;
    const half = (Math.max(size.x, size.y) * FRAME_PAD) / 2;
    cam.left = -half;
    cam.right = half;
    cam.top = half;
    cam.bottom = -half;
    cam.position.set(centre.x, cy + Math.sin(PORTRAIT_ELEV) * 10, Math.cos(PORTRAIT_ELEV) * 10);
    cam.lookAt(centre.x, cy, 0);
    cam.updateProjectionMatrix();
    renderer.render(scene, cam);
    portraits.set(kind.key, canvas.toDataURL("image/png"));
    scene.remove(model.group);
    // Per-instance geometry and materials only: face and gradient textures
    // are shared with the game and stay alive.
    model.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.geometry.dispose();
      for (const mat of Array.isArray(m.material) ? m.material : [m.material]) mat.dispose();
    });
  } catch {
    failed = true;
  }
  if (failed || portraits.size >= roster.length) release();
}

function release(): void {
  if (!rig) return;
  rig.renderer.dispose();
  rig.renderer.forceContextLoss();
  rig = null;
}
