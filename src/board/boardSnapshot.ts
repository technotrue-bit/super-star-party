/**
 * SUPER STAR PARTY — board overview pictures for the board menu and the
 * party line-up screen.
 *
 * Each board is built once, shot from high above (the title orbit's fit, so
 * the whole board and its scenery are in frame), and kept as a canvas for
 * the rest of the session. The board is disposed straight after the shot.
 *
 * Presentation only: it never touches match state or the rng.
 */
import * as THREE from "three";
import { world } from "../main";
import { buildBoardScene } from "./boardScene";
import { boardDef, type BoardId } from "./registry";
import { titleOrbitNear, titleOrbitPose } from "./titleOrbit";

/** Picture size in pixels (16:10). The shot renders at twice this and is scaled down to smooth the edges. */
export const SNAPSHOT_W = 640;
export const SNAPSHOT_H = 400;
const SUPERSAMPLE = 2;
const FOV = 40;
/** A little toward the south-east, so the board reads as 3D rather than a flat map. */
const YAW_T = 6;

const cache = new Map<BoardId, HTMLCanvasElement>();

/** Render targets hold linear color; the picture is shown as sRGB. */
let toSrgb: Uint8Array | null = null;
function srgbTable(): Uint8Array {
  if (toSrgb) return toSrgb;
  toSrgb = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    const c = i / 255;
    const s = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
    toSrgb[i] = Math.round(Math.min(1, Math.max(0, s)) * 255);
  }
  return toSrgb;
}

/** True once `id` has a picture (getting it is then instant). */
export function hasBoardSnapshot(id: BoardId): boolean {
  return cache.has(id);
}

/**
 * The overview picture of a board, rendered on first use. Null when there is
 * no renderer (or the shot failed); callers show a plain card instead.
 * Anything already in the scene is hidden for the shot and shown again after.
 */
export function boardSnapshot(id: BoardId): HTMLCanvasElement | null {
  const hit = cache.get(id);
  if (hit) return hit;
  const renderer = world.renderer;
  const scene = world.scene;
  if (!renderer || !scene) return null;

  const hidden: THREE.Object3D[] = [];
  for (const obj of scene.children) {
    if (obj.visible && !(obj as THREE.Light).isLight) {
      obj.visible = false;
      hidden.push(obj);
    }
  }
  const def = boardDef(id);
  const w = SNAPSHOT_W * SUPERSAMPLE;
  const h = SNAPSHOT_H * SUPERSAMPLE;
  const prevTarget = renderer.getRenderTarget();
  let board: ReturnType<typeof buildBoardScene> | null = null;
  let rt: THREE.WebGLRenderTarget | null = null;
  try {
    board = buildBoardScene(def);
    board.update(0);
    const cam = new THREE.PerspectiveCamera(FOV, w / h, 0.1, 4000);
    const pose = titleOrbitPose(def, YAW_T, w / h, FOV);
    cam.position.copy(pose.pos);
    cam.lookAt(pose.look);
    cam.near = titleOrbitNear(pose);
    cam.far = pose.pos.distanceTo(pose.look) * 4;
    cam.updateProjectionMatrix();

    rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.UnsignedByteType });
    renderer.setRenderTarget(rt);
    renderer.clear();
    renderer.render(scene, cam);
    const px = new Uint8Array(w * h * 4);
    renderer.readRenderTargetPixels(rt, 0, 0, w, h, px);

    // GL rows run bottom-up: flip while converting to sRGB.
    const lut = srgbTable();
    const big = document.createElement("canvas");
    big.width = w;
    big.height = h;
    const bctx = big.getContext("2d")!;
    const img = bctx.createImageData(w, h);
    for (let y = 0; y < h; y++) {
      const src = (h - 1 - y) * w * 4;
      const dst = y * w * 4;
      for (let x = 0; x < w * 4; x += 4) {
        img.data[dst + x] = lut[px[src + x]];
        img.data[dst + x + 1] = lut[px[src + x + 1]];
        img.data[dst + x + 2] = lut[px[src + x + 2]];
        img.data[dst + x + 3] = 255;
      }
    }
    bctx.putImageData(img, 0, 0);

    const out = document.createElement("canvas");
    out.width = SNAPSHOT_W;
    out.height = SNAPSHOT_H;
    const ctx = out.getContext("2d")!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(big, 0, 0, SNAPSHOT_W, SNAPSHOT_H);
    cache.set(id, out);
    return out;
  } catch (e) {
    console.warn(`[SSP] board picture for ${id} failed:`, e);
    return null;
  } finally {
    renderer.setRenderTarget(prevTarget);
    rt?.dispose();
    board?.dispose();
    for (const obj of hidden) obj.visible = true;
  }
}
