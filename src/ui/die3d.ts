/**
 * SUPER STAR PARTY — the 3D pipped die (the MP7 dice ritual).
 *
 * A real toon-shaded cube with canvas-2D pips (red body + white pips + ink
 * outline) that arcs, tumbles in two axes, and lands on its face. This
 * replaces the old flat DOM "?" card.
 *
 * Hard contracts:
 *  - FACE authority: the turn loop calls setFace(face); the die NEVER rolls its
 *    own face. The face comes from rng via rollPressed -> setFace. So the die's
 *    landed value always equals match.lastDice.
 *  - Determinism: animation jitter (spin axis/speed, drift) draws from a PRIVATE
 *    mulberry32 stream. It consumes zero gameplay rng draws, so seeded replays
 *    stay byte-identical to the simulation.
 *  - Timing: the tumble lasts exactly settings.diceSuspense (same game-time dt
 *    the loop uses for its diceT countdown), so setFace arrives as the die
 *    finishes its arc -> the hop begins the moment the die lands.
 *
 * True die pip layout (opposite faces sum to 7):
 *   top=+Y=1  bottom=-Y=6 | front=+Z=2  back=-Z=5 | right=+X=3  left=-X=4
 */
import * as THREE from "three";
import { match } from "../core/game";
import { mulberry32, ease } from "../core/rng";
import { palette } from "../config/palette";
import { settings } from "../config/settings";
import { buildKit, type BoardTextures } from "../board/boardTextures";
import { outline } from "../board/boardScenery";
import type { BoardScene } from "../board/boardScene";
import type { DiceView } from "../game/turnLoop";

/* ---------------- geometry / timing ---------------- */

const DIE = 2.0; // world units — a jumbo party die, clearly readable at the 390px viewport
const GROUND_Y = DIE / 2 + 0.1; // rests just above the board (no z-fight with grass/disk)
const APEAK = 4.2; // arc height above ground
const DRIFT = 0.9; // lateral drift at apex
const LAND_OFFSET = new THREE.Vector3(1.5, 0, 0.5); // die parks beside (not under) the roller
const TUMBLE_DUR = settings.diceSuspense; // 1.1s — matches the suspense countdown
const LAND_DUR = 0.28; // squash + settle onto the board
const REST_HOLD = 0.26; // how long the landed die sits before hide()
const OUTLINE_SCALE = 1.06;
const PIP_TEX = 128;

// BoxGeometry group order is [+X, -X, +Y, -Y, +Z, -Z]; map each to its face value.
// (+X=right=3, -X=left=4, +Y=top=1, -Y=bottom=6, +Z=front=2, -Z=back=5)
const GROUP_FACE: ReadonlyArray<number> = [3, 4, 1, 6, 2, 5];

/* ---------------- face -> orientation ---------------- */

// Rotations that bring each face value to TOP (+Y). Single-axis, unambiguous.
const FACE_QUAT: THREE.Quaternion[] = (() => {
  const out: THREE.Quaternion[] = [];
  const axis = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).normalize();
  out[1] = new THREE.Quaternion(); // identity: top already up
  out[2] = new THREE.Quaternion().setFromAxisAngle(axis(1, 0, 0), -Math.PI / 2); // +Z front -> top
  out[3] = new THREE.Quaternion().setFromAxisAngle(axis(0, 0, 1), Math.PI / 2); // +X right -> top
  out[4] = new THREE.Quaternion().setFromAxisAngle(axis(0, 0, 1), -Math.PI / 2); // -X left -> top
  out[5] = new THREE.Quaternion().setFromAxisAngle(axis(1, 0, 0), Math.PI / 2); // -Z back -> top
  out[6] = new THREE.Quaternion().setFromAxisAngle(axis(1, 0, 0), Math.PI); // -Y bottom -> top
  return out;
})();

/* ---------------- pip canvases ---------------- */

// Standard die patterns, normalized uv (0..1, 0=top). Pip radius ~5.5% of face.
const PIP_POS: Record<number, Array<[number, number]>> = {
  1: [[0.5, 0.5]],
  2: [[0.22, 0.22], [0.78, 0.78]],
  3: [[0.22, 0.22], [0.5, 0.5], [0.78, 0.78]],
  4: [[0.22, 0.22], [0.78, 0.22], [0.22, 0.78], [0.78, 0.78]],
  5: [[0.22, 0.22], [0.78, 0.22], [0.22, 0.78], [0.78, 0.78], [0.5, 0.5]],
  6: [[0.22, 0.18], [0.22, 0.5], [0.22, 0.82], [0.78, 0.18], [0.78, 0.5], [0.78, 0.82]],
};

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  return [c, ctx];
}

function toTexture(c: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

/** Red body (#FF5A3C) + white pips (white texel * white toon color = white). */
function pipTexture(kit: BoardTextures, face: number): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(PIP_TEX, PIP_TEX);
  ctx.fillStyle = palette.lava;
  ctx.fillRect(0, 0, PIP_TEX, PIP_TEX);
  const r = PIP_TEX * 0.16;
  ctx.fillStyle = palette.white;
  ctx.strokeStyle = palette.ink;
  ctx.lineWidth = PIP_TEX * 0.018;
  ctx.textRendering = "optimizeSpeed";
  for (const [u, v] of PIP_POS[face]) {
    ctx.beginPath();
    ctx.arc(u * PIP_TEX, v * PIP_TEX, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  return toTexture(c);
}

function randomAxis(r: () => number): THREE.Vector3 {
  // uniform random unit vector (body-fixed spin axis)
  const u1 = r();
  const u2 = r();
  const cosA = 2 * u1 - 1;
  const sinA = Math.sqrt(1 - cosA * cosA);
  const p = 2 * Math.PI * u2;
  return new THREE.Vector3(sinA * Math.cos(p), sinA * Math.sin(p), cosA);
}

const _spinQ = new THREE.Quaternion();

/* ---------------- 3D die ---------------- */

export interface Die3DHandle extends DiceView {
  /** Advance the roll animation. Called by the board screen's update(dt). */
  update(dt: number): void;
  dispose(): void;
  /** Trigger a full-screen colour flash rendered via the WebGL canvas. */
  flash(color: string): void;
}

export function createDie3d(scene: THREE.Scene, camera: THREE.Camera, board: BoardScene): Die3DHandle {
  const kit = buildKit();
  const geo = new THREE.BoxGeometry(DIE, DIE, DIE);
  const mats = GROUP_FACE.map((f) => {
    // MeshBasicMaterial — no lighting, no gradient ramp, no emissive glow.
    // The texture (red body + white pips) is reproduced verbatim, so pips
    // stay countable from any camera angle.  (Toon + strong emissive was
    // washing the white pips into brown at the 390px viewport.)
    const m = new THREE.MeshBasicMaterial({
      color: palette.white,
      map: pipTexture(kit, f),
      toneMapped: false,
      side: THREE.FrontSide,
    });
    return m;
  });
  const body = new THREE.Mesh(geo, mats);
  body.castShadow = true;
  body.receiveShadow = false; // die is airborne during the roll; no self-shadow darkening the top faces
  body.name = "ssp-die";
  const shell = outline(body, OUTLINE_SCALE);
  const group = new THREE.Group();
  group.add(body, shell);
  group.visible = false;
  scene.add(group);
  (globalThis as any).__DIE = group; // debug hook — die group reference
  const _camDir = new THREE.Vector3();
  const _tmpQuat = new THREE.Quaternion();
  const _tmpScale = new THREE.Vector3();
  const _tmpPos = new THREE.Vector3();

  // Full-screen red flash rendered via the WebGL canvas so that
  // page_screenshot / vision analysis can see it (DOM overlays over the
  // canvas are not always captured by Playwright).
  const FLASH_DUR = 0.42; /* a sting, not a red screen: snap to peak then fade */
  const FLASH_DIST = 20;
  let flashActive = false;
  let flashTimer = 0;
  let flashStartReal = 0;
  let flashBaseOpacity = 0;
  const flashMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(palette.lava),
    transparent: true,
    opacity: 0,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    side: THREE.DoubleSide,
    blending: THREE.NormalBlending,
  });
  const flashGeo = new THREE.PlaneGeometry(1, 1);
  const flashMesh = new THREE.Mesh(flashGeo, flashMat);
  flashMesh.frustumCulled = false;
  flashMesh.renderOrder = 1000;
  scene.add(flashMesh);
  (globalThis as any).__FLASH = flashMesh;

  let state: "hidden" | "tumbling" | "landing" | "resting" = "hidden";
  let timer = 0;
  let spinAxis = new THREE.Vector3(1, 0, 0);
  let spinSpeed = 8;
  let driftAngle = 0;
  let targetQuat = new THREE.Quaternion();
  const landPos = new THREE.Vector3();

  // Private animation rng — a fresh mulberry32 stream, never the gameplay `rng`.
  const animRng = mulberry32(0xd1ce);

  const update = (dt: number): void => {
    (globalThis as any).__DIE_STATE = state;
    (globalThis as any).__DIE = group;

    // --- Full-screen flash (always positioned even when die is hidden, so red-space sting renders after die is parked) ---
    if (camera && (camera as any).isPerspectiveCamera) {
    const cam = camera as THREE.PerspectiveCamera;
    camera.getWorldDirection(_camDir);
    flashMesh.position.copy(camera.position as THREE.Vector3).add(_camDir.multiplyScalar(FLASH_DIST));
    flashMesh.quaternion.copy(camera.quaternion);
    const fovRad = cam.fov * Math.PI / 180;
    const h = 2 * FLASH_DIST * Math.tan(fovRad / 2);
    const w = h * (cam.aspect || 1);
    flashMesh.scale.set(w, h, 1);
    if (flashActive) { // update flash opacity
      const elapsed = (performance.now() - flashStartReal) / 1000;
      const t = Math.min(1, elapsed / FLASH_DUR);
      const k = 1 - t;
      flashMat.opacity = flashBaseOpacity * k;
      if (elapsed >= FLASH_DUR) {
        flashActive = false;
        flashMat.opacity = 0;
      }
    }
  } /* close: if (camera && isPerspectiveCamera) */

    if (state === "hidden") return;
    if (state === "tumbling") {
      timer += dt;
      const p = Math.min(1, timer / TUMBLE_DUR);
      const arc = 4 * p * (1 - p); // parabola: 0 -> 1 (apex) -> 0
      const drift = Math.sin(p * Math.PI) * DRIFT;
      group.position.x = landPos.x + Math.cos(driftAngle) * drift;
      group.position.z = landPos.z + Math.sin(driftAngle) * drift;
      group.position.y = GROUND_Y + 0.4 + arc * APEAK;
      // body-fixed tumble spin (post-multiply = local axis)
      _spinQ.setFromAxisAngle(spinAxis, spinSpeed * dt);
      group.quaternion.multiply(_spinQ);
    } else if (state === "landing") {
      timer += dt;
      const s = Math.min(1, timer / LAND_DUR);
      const k = ease.outBack(s);
      group.quaternion.slerp(targetQuat, k); // snap to the settled face
      group.position.y = THREE.MathUtils.lerp(group.position.y, GROUND_Y, 0.6);
      const sy = 0.55 + 0.45 * k; // squash on impact
      const sx = 1.16 - 0.2 * k; // bulge then recover
      group.scale.set(sx, sy, sx);
      if (s >= 1) {
        state = "resting";
        timer = 0;
        group.scale.set(1, 1, 1);
      }
    } else if (state === "resting") {
      timer += dt;
      // slow idle yaw — the settled face stays readable, die feels alive
      _spinQ.setFromAxisAngle(_UP, 0.22 * dt);
      group.quaternion.multiply(_spinQ);
      // timer kept for a future hide; hide() just vanishes the die (MP7 style)
    }
  };

  const show = (): void => {
    state = "hidden";
    group.visible = true;
  };
  const hide = (): void => {
    if ((globalThis as any).__SSP_HOLD_DIE) return; // debug: keep die visible for pixel capture
    state = "hidden";
    group.visible = false;
    group.position.set(0, -1000, 0); // park under the world
  };
  const tumble = (): void => {
    state = "tumbling";
    timer = 0;
    group.scale.set(1, 1, 1);
    const pid = match.currentPlayer;
    const space = match.players[pid]?.space ?? 0;
    const base = board.spaceWorldPos(space).clone();
    landPos.set(base.x + LAND_OFFSET.x, GROUND_Y, base.z + LAND_OFFSET.z);
    group.position.set(landPos.x, GROUND_Y + 0.4, landPos.z);
    // start from a clean spin origin; jitter is body-fixed
    group.quaternion.identity();
    spinAxis = randomAxis(animRng);
    spinSpeed = 7 + animRng() * 3;
    driftAngle = animRng() * Math.PI * 2;
  };
  const setFace = (face: number): void => {
    const n = Math.max(1, Math.min(6, Math.round(face)));
    targetQuat.copy(FACE_QUAT[n] ?? FACE_QUAT[1]);
    state = "landing";
    timer = 0;
  };

  const flash = (color: string): void => {
    // full-screen flash — opacity + colour set below
    const m = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
    if (!m) {
      flashMat.color.setHex(0xff5a3c);
      flashBaseOpacity = 0.55;
    } else {
      flashMat.color.setRGB(
        parseInt(m[1], 10) / 255,
        parseInt(m[2], 10) / 255,
        parseInt(m[3], 10) / 255
      );
      const a = m[4] ? parseFloat(m[4]) : 1;
      flashBaseOpacity = a * 1.6;
    }
    flashMat.opacity = flashBaseOpacity;
    flashStartReal = performance.now();
    flashTimer = 0;
    flashActive = true;
  };

  return {
    show,
    hide,
    tumble,
    setFace,
    flash,
    update,
    dispose: () => {
      state = "hidden";
      group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.geometry.dispose?.();
        const mat = m.material;
        const disposeMat = (mm: THREE.Material) => {
          (mm as unknown as { map?: THREE.Texture }).map?.dispose();
          mm.dispose();
        };
        if (Array.isArray(mat)) for (const mm of mat) disposeMat(mm);
        else disposeMat(mat);
      });
      flashMat.dispose();
      flashGeo.dispose();
      flashMesh.removeFromParent();
      group.removeFromParent();
      kit.dispose();
    },
  };
}

const _UP = new THREE.Vector3(0, 1, 0);
