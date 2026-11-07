/**
 * SUPER STAR PARTY — hero face portraits for the 2D UI.
 *
 * The HUD chips, rival cards and shop show a round avatar. Instead of a
 * letter, they show the hero's own face: each hero's head is rendered once,
 * front-on, from the real 3D model into a small transparent image, so the
 * portrait always matches the current character design.
 *
 * The game's own renderer draws them into an offscreen sRGB target (no
 * second WebGL context: browsers cap them, phones are short on GPU memory,
 * and creating and losing contexts is slow on software GL). warmPortraits()
 * hands over the renderer at boot and fills the cache one hero per idle
 * moment, between frames; a portrait asked for before then is drawn on the
 * spot. Presentation only. Without a renderer or WebGL2, characterPortrait
 * returns null and the avatar keeps its letter.
 */
import * as THREE from "three";
import { buildModel } from "./models";
import { roster, type CharacterKind } from "./roster";

/** Pixel size of a portrait. The avatar is 48 CSS px, so this is crisp at 2x. */
const PORTRAIT_PX = 128;
/** Rendered at this multiple and scaled down, for smooth edges without MSAA. */
const SUPERSAMPLE = 2;
/** Head box size to frame size: a little room round the head. */
const FRAME_PAD = 1.4;
/** Camera looks down at the face by this much (radians). */
const PORTRAIT_ELEV = 0.12;

const portraits = new Map<string, string>();
let host: THREE.WebGLRenderer | null = null;
let failed = false;
let kit: {
  target: THREE.WebGLRenderTarget;
  scene: THREE.Scene;
  cam: THREE.OrthographicCamera;
  pixels: Uint8Array;
  big: HTMLCanvasElement;
  small: HTMLCanvasElement;
} | null = null;

/** Data URL of `key`'s face portrait, or null when it can't be drawn. */
export function characterPortrait(key: string): string | null {
  const k = key.trim().toLowerCase();
  const hit = portraits.get(k);
  if (hit || failed || !host) return hit ?? null;
  const kind = roster.find((r) => r.key === k);
  if (!kind) return null;
  renderOne(kind);
  return portraits.get(k) ?? null;
}

/**
 * Give the portraits the game renderer and draw them one hero per idle
 * moment, so no frame carries more than one small offscreen render.
 */
export function warmPortraits(renderer: THREE.WebGLRenderer): void {
  host = renderer;
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
    if (!next) {
      release();
      return;
    }
    renderOne(next);
    idle(step);
  };
  idle(step);
}

function setup(): boolean {
  if (kit) return true;
  if (failed || !host) return false;
  if (!host.capabilities.isWebGL2) {
    failed = true;
    return false;
  }
  const px = PORTRAIT_PX * SUPERSAMPLE;
  // An sRGB target: WebGL2 encodes on write, so the pixels read back are
  // already display colors (a linear target would need a per-pixel gamma).
  const target = new THREE.WebGLRenderTarget(px, px, { colorSpace: THREE.SRGBColorSpace });
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
  const big = document.createElement("canvas");
  big.width = px;
  big.height = px;
  const small = document.createElement("canvas");
  small.width = PORTRAIT_PX;
  small.height = PORTRAIT_PX;
  kit = {
    target,
    scene,
    cam: new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 50),
    pixels: new Uint8Array(px * px * 4),
    big,
    small,
  };
  return true;
}

function renderOne(kind: CharacterKind): void {
  if (portraits.has(kind.key) || !setup() || !kit || !host) return;
  const renderer = host;
  const { target, scene, cam, pixels, big, small } = kit;
  const prevTarget = renderer.getRenderTarget();
  const prevClear = renderer.getClearColor(new THREE.Color());
  const prevAlpha = renderer.getClearAlpha();
  const prevShadowAuto = renderer.shadowMap.autoUpdate;
  try {
    const model = buildModel(kind);
    model.setExpression("normal");
    scene.add(model.group);
    model.group.updateMatrixWorld(true);
    // A hero can name the box to frame (Pops is all head, so his frame is
    // the face and the ice round it); otherwise frame the head.
    const head = model.parts.portrait ?? model.parts.head ?? model.group;
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

    renderer.shadowMap.autoUpdate = false; // no shadows here; leave the game's map alone
    renderer.setRenderTarget(target);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, true, true);
    renderer.render(scene, cam);
    renderer.readRenderTargetPixels(target, 0, 0, target.width, target.height, pixels);

    // GL rows run bottom-up; flip into the canvas, then scale down smoothly.
    const n = target.width;
    const ctx = big.getContext("2d")!;
    const img = ctx.createImageData(n, n);
    const row = n * 4;
    for (let y = 0; y < n; y++) img.data.set(pixels.subarray((n - 1 - y) * row, (n - y) * row), y * row);
    ctx.putImageData(img, 0, 0);
    const sctx = small.getContext("2d")!;
    sctx.clearRect(0, 0, PORTRAIT_PX, PORTRAIT_PX);
    sctx.imageSmoothingEnabled = true;
    sctx.imageSmoothingQuality = "high";
    sctx.drawImage(big, 0, 0, PORTRAIT_PX, PORTRAIT_PX);
    portraits.set(kind.key, small.toDataURL("image/png"));

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
  } finally {
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(prevClear, prevAlpha);
    renderer.shadowMap.autoUpdate = prevShadowAuto;
  }
  if (failed || portraits.size >= roster.length) release();
}

function release(): void {
  if (!kit) return;
  kit.target.dispose();
  kit = null;
}
