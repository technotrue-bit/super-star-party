/**
 * SUPER STAR PARTY — last-five-turns fireworks (lively board, slice 3).
 *
 * Its own chunk: lively/night.ts pulls it in with import() the first time a
 * match reaches the last five turns, and never with `?lively=0`. One draw
 * call in all: a single additive InstancedMesh of 4-triangle shards. A shell
 * is a rising rocket (its first shard), then a sphere of sparks that drag,
 * fall, and fade; each spark is stretched along its velocity, which reads as
 * a short trail without a second mesh. No shadows, no fog.
 *
 * The board camera looks steeply down from close in, so a ring around the
 * board is almost never in frame. Each shell is placed where the live camera
 * sees it: a ray through the upper part of the frame, part-way to the ground,
 * and the burst is sized to its distance so it reads the same at any zoom.
 *
 * Burst spots, timing, and colours come from a private fxMulberry32 stream,
 * so they never touch the match. update() allocates nothing.
 */
import * as THREE from "three";
import { settings } from "../../config/settings";
import { palette } from "../../config/palette";
import { fxMulberry32 } from "./fxRng";

export interface FireworksHost {
  /** Board-local parent for the one mesh. */
  root: THREE.Object3D;
  /** The camera the bursts are framed for (read at each launch). */
  camera: () => THREE.Camera | null;
  /** Fallback burst spot without a camera (board-local x/z). */
  center: { x: number; z: number };
}

export interface FireworksDebug {
  instances: number;
  drawCalls: number;
  triangles: number;
  live: number;
  /** Live sparks/rockets whose centre projects inside the camera frustum (NDC). */
  inFrustum: number;
  /** ...of which in the upper half of the frame. */
  inUpperHalf: number;
  bursts: number;
  active: boolean;
}

export interface Fireworks {
  /** Advance by board seconds. */
  update(dt: number): void;
  /** False stops new launches; shells in the air finish. */
  setActive(on: boolean): void;
  /** Hide everything now (reduced motion). */
  clear(): void;
  dispose(): void;
  debug(): FireworksDebug;
}

const L = settings.lively;
const MAX_INSTANCES = 256;
const COLORS = [palette.candy, palette.sun, palette.bubble, palette.mint, palette.berry, palette.heroTusk, palette.lampWarm];

const RISE_MIN = 0.55; // rocket climb (s)
const RISE_MAX = 0.85;
const LIFE = 1.8; // spark fade (s)
const DRAG = 1.6; // per-second velocity damping rate
const FLASH = 0.14; // white flash at burst (s)
// Distance-relative sizes (per world unit from the camera), so a burst
// covers about a fifth of the frame height wherever it lands.
const SPEED_K = 0.2; // burst speed
const GRAV_K = 0.12; // spark fall
const SIZE_K = 0.012; // shard radius
const RISE_K = 0.3; // rocket climb height
const STRETCH = 6; // extra length per unit of relative speed: thin streaks
// Frame window the bursts aim for (NDC): the upper part, left or right of
// centre (the die hovers mid-frame), below the HUD chips and LAST 5 marquee.
const NDC_X_MIN = 0.3;
const NDC_X_MAX = 0.72;
const NDC_Y_MIN = 0.12;
const NDC_Y_MAX = 0.55;

const enum Shell {
  Wait = 0,
  Rise = 1,
  Burst = 2,
}

/** Regular tetrahedron, radius 1: 4 triangles, no normals (unlit). */
function shardGeometry(): THREE.BufferGeometry {
  const k = 1 / Math.sqrt(3);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute([k, k, k, -k, -k, k, -k, k, -k, k, -k, -k], 3));
  g.setIndex([2, 1, 0, 0, 3, 2, 1, 3, 0, 2, 3, 1]);
  return g;
}

export function createFireworks(host: FireworksHost): Fireworks {
  const shells = Math.max(1, Math.floor(L.fireworkShells));
  const per = Math.max(2, Math.min(Math.floor(L.fireworkSparks), Math.floor(MAX_INSTANCES / shells)));
  const count = shells * per;

  const geo = shardGeometry();
  const mat = new THREE.MeshBasicMaterial({
    color: palette.white,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
    fog: false,
    toneMapped: false,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.name = "lively:fireworks";
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.frustumCulled = false;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.userData.lively = true;

  // ---- private cosmetic stream + precomputed unit sphere --------------------------
  const draw = fxMulberry32(0xf12e);
  const dirX = new Float32Array(per);
  const dirY = new Float32Array(per);
  const dirZ = new Float32Array(per);
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let j = 0; j < per; j++) {
    const y = 1 - (2 * (j + 0.5)) / per;
    const r = Math.sqrt(1 - y * y);
    dirX[j] = Math.cos(golden * j) * r;
    dirY[j] = y;
    dirZ[j] = Math.sin(golden * j) * r;
  }

  // ---- shell + spark state --------------------------------------------------------
  const state = new Uint8Array(shells);
  const timer = new Float32Array(shells);
  const rise = new Float32Array(shells);
  const scale = new Float32Array(shells); // distance from the camera at launch
  const fromX = new Float32Array(shells);
  const fromY = new Float32Array(shells);
  const fromZ = new Float32Array(shells);
  const atX = new Float32Array(shells);
  const atY = new Float32Array(shells);
  const atZ = new Float32Array(shells);
  const colR = new Float32Array(shells);
  const colG = new Float32Array(shells);
  const colB = new Float32Array(shells);
  const bright = new Float32Array(shells);
  const px = new Float32Array(count);
  const py = new Float32Array(count);
  const pz = new Float32Array(count);
  const vx = new Float32Array(count);
  const vy = new Float32Array(count);
  const vz = new Float32Array(count);

  const color = new THREE.Color();
  const white = new THREE.Color(palette.white);
  const hot = new THREE.Color(palette.lampHot);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const dir = new THREE.Vector3();
  const pos = new THREE.Vector3();
  const eye = new THREE.Vector3();
  const scl = new THREE.Vector3();
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);

  let active = true;
  let bursts = 0;
  let live = 0;
  let disposed = false;

  for (let i = 0; i < count; i++) {
    mesh.setMatrixAt(i, zero);
    mesh.setColorAt(i, color.setRGB(0, 0, 0));
  }
  // Stagger the first launches so the shells never fire in lockstep.
  for (let s = 0; s < shells; s++) {
    state[s] = Shell.Wait;
    timer[s] = -(0.1 + s * 0.38 + draw() * 0.25); // Wait counts up to 0
  }
  host.root.add(mesh);

  /** Aim shell s at a spot the camera sees, in the upper part of the frame. */
  const aim = (s: number): void => {
    const cam = host.camera();
    if (!cam) {
      atX[s] = host.center.x + (draw() - 0.5) * 12;
      atY[s] = 9 + draw() * 3;
      atZ[s] = host.center.z + (draw() - 0.5) * 8;
      scale[s] = 30;
      return;
    }
    eye.setFromMatrixPosition(cam.matrixWorld);
    const side = draw() < 0.5 ? -1 : 1;
    pos.set(side * (NDC_X_MIN + (NDC_X_MAX - NDC_X_MIN) * draw()), NDC_Y_MIN + (NDC_Y_MAX - NDC_Y_MIN) * draw(), 0.5).unproject(cam);
    dir.subVectors(pos, eye).normalize();
    // Part-way to where the ray meets the ground, so the burst floats over the board.
    const toGround = dir.y < -0.05 ? Math.min(90, -eye.y / dir.y) : 40;
    const d = toGround * (0.42 + 0.16 * draw());
    pos.copy(eye).addScaledVector(dir, d);
    host.root.worldToLocal(pos);
    atX[s] = pos.x;
    atY[s] = pos.y;
    atZ[s] = pos.z;
    scale[s] = d;
  };

  const launch = (s: number): void => {
    aim(s);
    const d = scale[s];
    fromX[s] = atX[s] + (draw() - 0.5) * 0.1 * d;
    fromY[s] = atY[s] - RISE_K * d;
    fromZ[s] = atZ[s] + (draw() - 0.5) * 0.1 * d;
    rise[s] = RISE_MIN + (RISE_MAX - RISE_MIN) * draw();
    color.set(COLORS[Math.floor(draw() * COLORS.length) % COLORS.length]);
    colR[s] = color.r;
    colG[s] = color.g;
    colB[s] = color.b;
    state[s] = Shell.Rise;
    timer[s] = 0;
  };

  const burst = (s: number): void => {
    const yaw = draw() * Math.PI * 2;
    const c = Math.cos(yaw);
    const sn = Math.sin(yaw);
    const sp = SPEED_K * scale[s] * (0.85 + draw() * 0.3);
    for (let j = 0; j < per; j++) {
      const i = s * per + j;
      const k = 0.88 + draw() * 0.24;
      px[i] = atX[s];
      py[i] = atY[s];
      pz[i] = atZ[s];
      vx[i] = (dirX[j] * c - dirZ[j] * sn) * sp * k;
      vy[i] = (dirY[j] * k + 0.12) * sp;
      vz[i] = (dirX[j] * sn + dirZ[j] * c) * sp * k;
    }
    state[s] = Shell.Burst;
    timer[s] = 0;
    bursts++;
  };

  const hideShell = (s: number, from: number): void => {
    for (let j = from; j < per; j++) mesh.setMatrixAt(s * per + j, zero);
  };

  const fw: Fireworks = {
    update(dt: number): void {
      if (disposed) return;
      live = 0;
      const damp = Math.exp(-DRAG * dt);
      for (let s = 0; s < shells; s++) {
        timer[s] += dt;
        if (state[s] === Shell.Wait) {
          bright[s] = 0;
          hideShell(s, 0);
          if (active && timer[s] >= 0) launch(s);
          else continue;
        }
        if (state[s] === Shell.Rise) {
          const u = timer[s] / rise[s];
          if (u >= 1) {
            burst(s);
          } else {
            // The rocket: shard 0 climbs on an easing-out arc, the rest stay hidden.
            const e = 1 - (1 - u) * (1 - u);
            pos.set(fromX[s] + (atX[s] - fromX[s]) * e, fromY[s] + (atY[s] - fromY[s]) * e, fromZ[s] + (atZ[s] - fromZ[s]) * e);
            dir.set(atX[s] - fromX[s], atY[s] - fromY[s], atZ[s] - fromZ[s]).normalize();
            q.setFromUnitVectors(up, dir);
            const r = SIZE_K * scale[s];
            scl.set(r * 1.4, r * 7, r * 1.4);
            m.compose(pos, q, scl);
            const i = s * per;
            px[i] = pos.x;
            py[i] = pos.y;
            pz[i] = pos.z;
            mesh.setMatrixAt(i, m);
            mesh.setColorAt(i, color.copy(hot).multiplyScalar(0.9));
            hideShell(s, 1);
            bright[s] = 1;
            live++;
            continue;
          }
        }
        // Burst: integrate, fade, stretch along velocity.
        const age = timer[s];
        if (age >= LIFE) {
          hideShell(s, 0);
          bright[s] = 0;
          state[s] = Shell.Wait;
          timer[s] = -(0.15 + draw() * 0.7);
          continue;
        }
        const fade = 1 - age / LIFE;
        const b = Math.min(1, fade * 1.7);
        bright[s] = b;
        const flash = age < FLASH ? 1 - age / FLASH : 0;
        const d = scale[s];
        const grav = GRAV_K * d;
        const r = SIZE_K * d;
        for (let j = 0; j < per; j++) {
          const i = s * per + j;
          vx[i] *= damp;
          vy[i] = vy[i] * damp - grav * dt;
          vz[i] *= damp;
          px[i] += vx[i] * dt;
          py[i] += vy[i] * dt;
          pz[i] += vz[i] * dt;
          const speed = Math.hypot(vx[i], vy[i], vz[i]);
          if (speed > 1e-4) dir.set(vx[i] / speed, vy[i] / speed, vz[i] / speed);
          else dir.copy(up);
          q.setFromUnitVectors(up, dir);
          const size = r * (0.6 + 0.4 * fade);
          scl.set(size, size * (1 + (STRETCH * speed) / d), size);
          pos.set(px[i], py[i], pz[i]);
          m.compose(pos, q, scl);
          mesh.setMatrixAt(i, m);
          color.setRGB(colR[s] * b, colG[s] * b, colB[s] * b).lerp(white, flash);
          mesh.setColorAt(i, color);
          live++;
        }
      }
      mesh.visible = live > 0;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    },

    setActive(on: boolean): void {
      active = on;
    },

    clear(): void {
      for (let s = 0; s < shells; s++) {
        hideShell(s, 0);
        bright[s] = 0;
        state[s] = Shell.Wait;
        timer[s] = -0.2 - s * 0.38;
      }
      live = 0;
      mesh.visible = false;
      mesh.instanceMatrix.needsUpdate = true;
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      host.root.remove(mesh);
      geo.dispose();
      mat.dispose();
      mesh.dispose();
    },

    debug(): FireworksDebug {
      // Probe-only: project every visible shard centre with the live camera.
      let inFrustum = 0;
      let inUpperHalf = 0;
      const cam = host.camera();
      if (cam && mesh.visible) {
        for (let s = 0; s < shells; s++) {
          if (bright[s] < 0.05) continue;
          const n = state[s] === Shell.Rise ? 1 : state[s] === Shell.Burst ? per : 0;
          for (let j = 0; j < n; j++) {
            const i = s * per + j;
            pos.set(px[i], py[i], pz[i]);
            host.root.localToWorld(pos);
            pos.project(cam);
            if (pos.z > -1 && pos.z < 1 && Math.abs(pos.x) <= 1 && Math.abs(pos.y) <= 1) {
              inFrustum++;
              if (pos.y > 0) inUpperHalf++;
            }
          }
        }
      }
      const idx = geo.getIndex();
      return {
        instances: count,
        drawCalls: 1,
        triangles: (idx ? idx.count / 3 : 0) * count,
        live,
        inFrustum,
        inUpperHalf,
        bursts,
        active,
      };
    },
  };
  mesh.visible = false;
  return fw;
}
