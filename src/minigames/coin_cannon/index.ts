/**
 * SUPER STAR PARTY — COIN CANNON (genre: timing)
 *
 * MP7's Coin Crossfire: four carnival cannons perched on tall platforms fire
 * coins straight down into their own conveyor lane; candy baskets slide along
 * each belt from right to left. TAP (or 'confirm') to fire — a tiny 0.12s
 * charge-up plus a ~0.6s coin flight means you must LEAD the basket. Land in
 * the basket for +1, dead-center for +2. 16 coins each, then you're out; best
 * score wins.
 *
 * Determinism: every gameplay random draw (basket speed/color/spawn jitter,
 * CPU aim/timing) comes from ctx.rng() only. Catch resolution is analytic
 * (predicted basket position at the exact rim crossing), so results are
 * frame-rate independent.
 */
import * as THREE from "three";
import type { Minigame, MinigameContext } from "../framework";
import { registerMinigame } from "../registry";
import { palette, hex } from "../../config/palette";
import { celGradient } from "../../characters/cel";

/* ------------------------------ tuning --------------------------------- */

const LANE_Z = [5.25, 1.75, -1.75, -5.25]; // lane depth per player (0 = human, nearest camera)
const PLAT_X = [-1.9, 1.9, -1.9, 1.9]; // platform x per lane (staggered so fall lines stay clear)
const PLAT_Z_OFF = -3.4; // platform z = laneZ + PLAT_Z_OFF (behind its own lane)
const MUZZLE_Y = 4.64; // coin spawn height (muzzle)
const MUZZLE_Z_OFF = 1.13; // muzzle z = laneZ + PLAT_Z_OFF + MUZZLE_Z_OFF
const CATCH_Y = 0.66; // basket rim height — coin center at catch
const LAND_Z_OFF = 0.11; // coin z at catch = laneZ + LAND_Z_OFF (belt centre)
const GRAV = 9; // downward gravity
const VY = -3.9; // coin launch vy (flight ~0.6s, impact ~9.3 u/s)
const CHARGE = 0.12; // tap -> fire charge-up (fixed, feels fair)
const AMINO = 16; // coins per player
const BASKET_R = 0.6; // basket radius (width ~1.2)
const CATCH_R = BASKET_R * 1.4; // generous catch radius
const PERFECT_R = 0.36; // perfect-center radius (30% of basket width)
const BASKET_SPAWN_X = 9.8; // baskets enter on the right...
const BASKET_DESPAWN_X = -9.8; // ...and exit on the left
const TIME_CAP = 28.5; // round cap — the framework force-finishes at 30s, so end before that
const BASKET_COLORS = [palette.candy, palette.berry, palette.mint, palette.bubble];

/* ------------------------------ state ----------------------------------- */

interface Basket {
  group: THREE.Group;
  lane: number;
  x: number;
  speed: number;
  bounce: number;
}

interface Coin {
  group: THREE.Group;
  tail: THREE.Mesh[];
  lane: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  landX: number; // x the coin lands at (0 for human, aim error for CPU)
  resolved: boolean;
}

interface Particle {
  mesh: THREE.Mesh;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
  grav: number;
  base: number;
}

interface PlayerSt {
  id: number;
  lane: number;
  color: number;
  ammo: number;
  score: number;
  charging: boolean;
  chargeT: number;
  aimError: number; // CPU aim error for the in-flight shot (human: 0)
  aimSlop: number; // CPU timing slop: widens the fire window this shot
  thinkT: number; // CPU decision cooldown
  recoil: number; // 1 -> 0 cannon kick
  poseT: number; // squash timer -> idle
  cheerT: number; // cheer timer -> idle
  cpuShots: number; // debug counters
  cpuHits: number;
  cpuAborts: number;
  wrapper: THREE.Group;
  char: THREE.Group | null;
  barrel: THREE.Group;
  glow: THREE.Mesh;
  ammoPips: THREE.Mesh[];
  scoreStars: THREE.Mesh[];
}

interface State {
  ctx: MinigameContext;
  root: THREE.Group;
  players: PlayerSt[];
  baskets: Basket[];
  coins: Coin[];
  particles: Particle[];
  rollers: THREE.Mesh[];
  spawnT: number[];
  t: number;
  shake: number;
  announcedGo: boolean;
  finished: boolean;
  camBase: [number, number, number];
  camLook: [number, number, number];
  toons: Map<number, THREE.MeshToonMaterial>;
  geos: THREE.BufferGeometry[];
  mats: THREE.Material[];
}

let state: State | null = null;

/* --------------------------- tiny helpers ------------------------------- */

/** Time for a coin from (y, vy) under gravity to reach the rim plane. */
function arriveTime(y: number, vy: number): number {
  return (vy + Math.sqrt(vy * vy + 2 * GRAV * (y - CATCH_Y))) / GRAV;
}

function toon(st: State, color: number): THREE.MeshToonMaterial {
  let m = st.toons.get(color);
  if (!m) {
    m = new THREE.MeshToonMaterial({ map: celGradient, color });
    st.toons.set(color, m);
    st.mats.push(m);
  }
  return m;
}

function basic(st: State, color: number): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({ color });
  st.mats.push(m);
  return m;
}

const OUTLINE_SCALE = 1.06;

function outlineShell(st: State, geo: THREE.BufferGeometry): THREE.Mesh {
  const g = geo.clone();
  g.scale(OUTLINE_SCALE, OUTLINE_SCALE, OUTLINE_SCALE);
  return new THREE.Mesh(g, basic(st, hex(palette.ink)));
}

function addMesh(
  st: State,
  parent: THREE.Object3D,
  geo: THREE.BufferGeometry,
  mat: THREE.Material,
  pos: [number, number, number],
  rot?: [number, number, number],
  shadow = true
): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(pos[0], pos[1], pos[2]);
  if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
  // Arena is flat-cel lit (toon bands): no shadow casting/receiving, so
  // platform columns never darken the play lanes.
  void shadow;
  m.castShadow = false;
  m.receiveShadow = false;
  parent.add(m);
  return m;
}

function newGeo(st: State, g: THREE.BufferGeometry): THREE.BufferGeometry {
  st.geos.push(g);
  return g;
}

/** Dispose only geometries under a root (materials are shared/round-scoped). */
function disposeGeos(root: THREE.Object3D): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.isMesh) mesh.geometry.dispose();
  });
}

/** Dispose geometries + materials under a root (full teardown). */
function disposeObj(root: THREE.Object3D): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.dispose();
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) m.dispose();
  });
}

/* ----------------------------- particles -------------------------------- */

function spawnBurst(
  st: State,
  pos: [number, number, number],
  color: number,
  count: number,
  speed: number,
  life: number,
  grav: number,
  base = 0.07
): void {
  const geo = newGeo(st, new THREE.SphereGeometry(1, 8, 6));
  const mat = basic(st, color);
  for (let i = 0; i < count; i++) {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(pos[0], pos[1], pos[2]);
    mesh.scale.setScalar(base);
    mesh.castShadow = false;
    st.root.add(mesh);
    const th = st.ctx.rng() * Math.PI * 2;
    const ph = st.ctx.rng() * Math.PI - Math.PI / 2;
    const sp = speed * (0.5 + st.ctx.rng() * 0.8);
    st.particles.push({
      mesh,
      vx: Math.cos(th) * Math.cos(ph) * sp,
      vy: Math.sin(ph) * sp + 1.5,
      vz: Math.sin(th) * Math.cos(ph) * sp,
      life,
      maxLife: life,
      grav,
      base: base * (0.7 + st.ctx.rng() * 0.6),
    });
  }
}

function updateParticles(st: State, dt: number): void {
  for (let i = st.particles.length - 1; i >= 0; i--) {
    const p = st.particles[i];
    p.life -= dt;
    if (p.life <= 0) {
      st.root.remove(p.mesh);
      st.particles.splice(i, 1);
      continue;
    }
    p.vy -= p.grav * dt;
    p.mesh.position.x += p.vx * dt;
    p.mesh.position.y += p.vy * dt;
    p.mesh.position.z += p.vz * dt;
    const s = p.base * Math.max(0, p.life / p.maxLife);
    p.mesh.scale.setScalar(s);
  }
}

/* ---------------------------- arena build ------------------------------- */

function buildArena(st: State): void {
  const { ctx } = st;
  const scene = ctx.scene;
  const cream = hex(palette.cream);
  const ink = hex(palette.ink);

  // ---- party floor: saturated grass checker (cel bands stay colourful) ----
  const grassA = hex(palette.grassA);
  const grassB = hex(palette.grassB);
  for (let gx = 0; gx < 4; gx++) {
    for (let gz = 0; gz < 4; gz++) {
      const col = (gx + gz) % 2 === 0 ? grassA : grassB;
      addMesh(
        st, st.root, newGeo(st, new THREE.BoxGeometry(5.5, 0.2, 4.15)),
        toon(st, col), [gx * 5.5 - 8.25, -0.1, gz * 4.15 - 8.8], undefined, false
      );
    }
  }
  const borderMat = toon(st, hex(palette.mint));
  const b1 = addMesh(st, st.root, newGeo(st, new THREE.BoxGeometry(22, 0.26, 0.3)), borderMat, [0, 0.03, -8.5], undefined, false);
  const b2 = addMesh(st, st.root, newGeo(st, new THREE.BoxGeometry(22, 0.26, 0.3)), borderMat, [0, 0.03, 7.75], undefined, false);
  const b3 = addMesh(st, st.root, newGeo(st, new THREE.BoxGeometry(0.3, 0.26, 16.5)), borderMat, [-11.15, 0.03, 0.4], undefined, false);
  const b4 = addMesh(st, st.root, newGeo(st, new THREE.BoxGeometry(0.3, 0.26, 16.5)), borderMat, [11.15, 0.03, 0.4], undefined, false);
  for (const b of [b1, b2, b3, b4]) st.root.add(outlineShell(st, b.geometry));

  // ---- carnival backdrop wall ----
  addMesh(st, st.root, newGeo(st, new THREE.BoxGeometry(24, 8.2, 0.3)), toon(st, cream), [0, 4.1, -9.9], undefined, false);
  const stripeColors = [
    hex(palette.candy), hex(palette.sun), hex(palette.mint), hex(palette.bubble),
    hex(palette.candy), hex(palette.sun), hex(palette.mint), hex(palette.bubble),
  ];
  for (let i = 0; i < 8; i++) {
    const x = -10.5 + i * 3;
    addMesh(st, st.root, newGeo(st, new THREE.BoxGeometry(3.0, 8.2, 0.34)), toon(st, stripeColors[i]), [x, 4.1, -9.74], undefined, false);
  }
  const starGeo = newGeo(st, new THREE.OctahedronGeometry(1));
  const star = addMesh(st, st.root, starGeo, toon(st, hex(palette.sun)), [0, 6.15, -9.7]);
  star.scale.set(1.15, 1.55, 0.5);
  st.root.add(outlineShell(st, starGeo));
  // two big gold coins on the wall
  for (const cx of [-4.4, 4.4]) {
    const coinDisc = newGeo(st, new THREE.CylinderGeometry(0.62, 0.62, 0.1, 20));
    const disc = addMesh(st, st.root, coinDisc, toon(st, hex(palette.sun)), [cx, 2.5, -9.72], [Math.PI / 2, 0, 0], false);
    const inner = addMesh(st, st.root, newGeo(st, new THREE.CylinderGeometry(0.38, 0.38, 0.14, 16)), toon(st, hex(palette.sunDeep)), [cx, 2.5, -9.64], [Math.PI / 2, 0, 0], false);
    st.root.add(outlineShell(st, coinDisc));
    void inner;
  }

  // ---- conveyor belts, rollers, lane walls, target rings, chevrons ----
  const wood = hex(palette.wood);
  const woodDark = hex(palette.woodDark);
  const rollerGeo = newGeo(st, new THREE.CylinderGeometry(0.16, 0.16, 1.44, 10));
  for (let lane = 0; lane < 4; lane++) {
    const lz = LANE_Z[lane];
    addMesh(st, st.root, newGeo(st, new THREE.BoxGeometry(18.4, 0.16, 1.3)), toon(st, wood), [0, 0.08, lz], undefined, true);
    for (let x = -8; x <= 8; x += 2) {
      const rollGroup = new THREE.Group();
      rollGroup.position.set(x, 0.24, lz);
      rollGroup.rotation.x = Math.PI / 2;
      const roll = new THREE.Mesh(rollerGeo, toon(st, woodDark));
      roll.castShadow = false;
      rollGroup.add(roll);
      st.root.add(rollGroup);
      st.rollers.push(roll);
    }
    // lane divider walls (candy / berry alternating)
    const wallColor = lane % 2 === 0 ? hex(palette.candy) : hex(palette.berry);
    for (const side of [-0.8, 0.8]) {
      const w = addMesh(st, st.root, newGeo(st, new THREE.BoxGeometry(18.4, 0.36, 0.14)), toon(st, wallColor), [0, 0.18, lz + side], undefined, false);
      st.root.add(outlineShell(st, w.geometry));
    }
    // target ring (bubble) + centre dot where coins land
    const ring = addMesh(
      st, st.root, newGeo(st, new THREE.TorusGeometry(0.36, 0.06, 8, 18)),
      toon(st, hex(palette.bubble)), [0, 0.21, lz + LAND_Z_OFF], [Math.PI / 2, 0, 0], false
    );
    st.root.add(outlineShell(st, ring.geometry));
    addMesh(st, st.root, newGeo(st, new THREE.SphereGeometry(1, 8, 6)), toon(st, hex(palette.sun)), [0, 0.22, lz + LAND_Z_OFF], undefined, false).scale.setScalar(0.08);
    // direction chevrons painted on the belt
    for (const cx of [-4.5, -7.5]) {
      const c1 = addMesh(st, st.root, newGeo(st, new THREE.BoxGeometry(0.5, 0.045, 0.1)), toon(st, hex(palette.sunDeep)), [cx - 0.24, 0.24, lz + 0.17], [0, 0.55, 0], false);
      const c2 = addMesh(st, st.root, newGeo(st, new THREE.BoxGeometry(0.5, 0.045, 0.1)), toon(st, hex(palette.sunDeep)), [cx - 0.24, 0.24, lz - 0.17], [0, -0.55, 0], false);
      void c1;
      void c2;
    }
  }

  // ---- scoreboards: gold coin pips = ammo left, mint star pips = score ----
  const sbX = [-8.2, -8.6, -9.0, -9.4];
  const coinPipGeo = newGeo(st, new THREE.CylinderGeometry(1, 1, 0.42, 10));
  const starPipGeo = newGeo(st, new THREE.OctahedronGeometry(1));
  for (let lane = 0; lane < 4; lane++) {
    const lz = LANE_Z[lane];
    const bx = sbX[lane];
    const post = addMesh(st, st.root, newGeo(st, new THREE.CylinderGeometry(0.07, 0.09, 1.1, 8)), toon(st, woodDark), [bx, 0.55, lz], undefined, false);
    const baseDisc = addMesh(st, st.root, newGeo(st, new THREE.CylinderGeometry(0.2, 0.24, 0.1, 12)), toon(st, woodDark), [bx, 0.05, lz], undefined, false);
    const frame = addMesh(st, st.root, newGeo(st, new THREE.BoxGeometry(2.5, 1.0, 0.06)), toon(st, cream), [bx, 1.4, lz], undefined, false);
    addMesh(st, st.root, newGeo(st, new THREE.BoxGeometry(2.32, 0.82, 0.07)), toon(st, hex(palette.berryDeep)), [bx, 1.42, lz], undefined, false);
    // header glyphs: gold coin = ammo, mint star = score
    const coinHead = addMesh(st, st.root, coinPipGeo, toon(st, hex(palette.sun)), [bx - 0.68, 1.8, lz + 0.05], undefined, false);
    coinHead.scale.setScalar(0.1);
    const starHead = addMesh(st, st.root, starPipGeo, toon(st, hex(palette.mint)), [bx + 0.68, 1.8, lz + 0.05], undefined, false);
    starHead.scale.setScalar(0.11);
    const pips: THREE.Mesh[] = [];
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        const pip = new THREE.Mesh(coinPipGeo, toon(st, hex(palette.sun)));
        pip.position.set(bx - 0.68 + (c - 1.5) * 0.17, 1.42 + (1.5 - r) * 0.17, lz + 0.05);
        pip.scale.setScalar(0.075);
        pip.castShadow = false;
        st.root.add(pip);
        pips.push(pip);
      }
    }
    const stars: THREE.Mesh[] = [];
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 8; c++) {
        const pip = new THREE.Mesh(starPipGeo, toon(st, hex(palette.mint)));
        pip.position.set(bx + 0.68 + (c - 3.5) * 0.17, 1.42 + (1.5 - r) * 0.17, lz + 0.05);
        pip.scale.setScalar(0.08);
        pip.castShadow = false;
        pip.visible = false;
        st.root.add(pip);
        stars.push(pip);
      }
    }
    st.players[lane].ammoPips = pips;
    st.players[lane].scoreStars = stars;
    void post;
    void baseDisc;
    void frame;
  }

  // ---- player platforms + cannons ----
  const BASE_TILT = Math.atan2(0.51, -0.51); // barrel tilt toward the lane (down-forward)
  for (let lane = 0; lane < 4; lane++) {
    const lz = LANE_Z[lane];
    const px = PLAT_X[lane];
    const pz = lz + PLAT_Z_OFF;
    const color = st.players[lane].color;
    // stilted platform: thin column + floating disk (coin fall lines stay clear)
    const col = addMesh(st, st.root, newGeo(st, new THREE.CylinderGeometry(0.34, 0.44, 4.3, 14)), toon(st, color), [px, 2.15, pz], undefined, true);
    st.root.add(outlineShell(st, col.geometry));
    const disk = addMesh(st, st.root, newGeo(st, new THREE.CylinderGeometry(1.05, 1.05, 0.55, 18)), toon(st, color), [px, 4.62, pz], undefined, true);
    st.root.add(outlineShell(st, disk.geometry));
    // cannon group
    const cannon = new THREE.Group();
    cannon.position.set(px, 0, pz);
    st.root.add(cannon);
    const base = addMesh(st, cannon, newGeo(st, new THREE.BoxGeometry(0.5, 0.28, 0.55)), toon(st, hex(palette.metal)), [0, 5.04, 0.62], undefined, true);
    cannon.add(outlineShell(st, base.geometry));
    const barrel = new THREE.Group();
    barrel.position.set(0, 5.15, 0.62);
    cannon.add(barrel);
    const barMesh = addMesh(st, barrel, newGeo(st, new THREE.CylinderGeometry(0.17, 0.21, 0.78, 12)), toon(st, hex(palette.metal)), [0, -0.255, 0.255], [BASE_TILT, 0, 0], true);
    void barMesh;
    const ringMesh = addMesh(st, barrel, newGeo(st, new THREE.TorusGeometry(0.2, 0.055, 8, 16)), toon(st, hex(palette.candy)), [0, -0.51, 0.51], [Math.PI / 2 + BASE_TILT, 0, 0], false);
    void ringMesh;
    const glow = new THREE.Mesh(newGeo(st, new THREE.SphereGeometry(1, 10, 8)), basic(st, hex(palette.sun)));
    glow.position.set(0, -0.51, 0.51);
    glow.scale.setScalar(0.12);
    glow.visible = false;
    glow.castShadow = false;
    barrel.add(glow);
    st.players[lane].barrel = barrel;
    st.players[lane].glow = glow;

    // character on the platform, behind the cannon, facing the lane (+Z)
    const ch = st.ctx.characters[st.players[lane].id] ?? null;
    if (ch) {
      const wrapper = new THREE.Group();
      wrapper.position.set(px + 0.55, 4.895, lz - 3.95);
      wrapper.add(ch.group);
      st.root.add(wrapper);
      st.players[lane].wrapper = wrapper;
      st.players[lane].char = ch.group;
      ch.setFacing(0);
      ch.anim.idle();
    }
  }

  // Multi-directional fills keep every surface in the cel light band so the
  // arena reads bright and candy-coloured from any angle.
  const fill = new THREE.DirectionalLight(0xffffff, 1.15);
  fill.position.set(2, 10, 16);
  st.root.add(fill);
  const fillBack = new THREE.DirectionalLight(0xffffff, 0.9);
  fillBack.position.set(0, 12, -16);
  st.root.add(fillBack);
  const fillSide = new THREE.DirectionalLight(0xffffff, 0.55);
  fillSide.position.set(-12, 7, 2);
  st.root.add(fillSide);
  void ink;
  void scene;
}

/* --------------------------- gameplay bits ------------------------------ */

function spawnBasket(st: State, lane: number): void {
  const speed = 2.6 + st.ctx.rng() * 0.9;
  const colorHex = hex(BASKET_COLORS[Math.floor(st.ctx.rng() * BASKET_COLORS.length)]);
  const lz = LANE_Z[lane];
  const group = new THREE.Group();
  group.position.set(BASKET_SPAWN_X, 0, lz);
  const body = addMesh(st, group, newGeo(st, new THREE.CylinderGeometry(0.55, 0.42, 0.5, 14)), toon(st, colorHex), [0, 0.41, 0], undefined, true);
  group.add(outlineShell(st, body.geometry));
  const rim = addMesh(st, group, newGeo(st, new THREE.TorusGeometry(0.58, 0.07, 8, 18)), toon(st, hex(palette.cream)), [0, 0.66, 0], [Math.PI / 2, 0, 0], true);
  group.add(outlineShell(st, rim.geometry));
  st.root.add(group);
  st.baskets.push({ group, lane, x: BASKET_SPAWN_X, speed, bounce: 0 });
}

function fireCoin(st: State, pid: number): void {
  const P = st.players[pid];
  const lane = P.lane;
  const tA = arriveTime(MUZZLE_Y, VY);
  const z0 = LANE_Z[lane] + PLAT_Z_OFF + MUZZLE_Z_OFF;
  const vx = (P.aimError - PLAT_X[lane]) / tA;
  const vz = (LANE_Z[lane] + LAND_Z_OFF - z0) / tA;
  const x0 = PLAT_X[lane];
  const group = new THREE.Group();
  const coinMesh = new THREE.Mesh(newGeo(st, new THREE.SphereGeometry(1, 10, 8)), toon(st, hex(palette.sun)));
  coinMesh.scale.setScalar(0.09);
  coinMesh.position.set(x0, MUZZLE_Y, z0);
  coinMesh.castShadow = true;
  group.add(coinMesh);
  const tail: THREE.Mesh[] = [];
  for (let i = 0; i < 2; i++) {
    const t = new THREE.Mesh(newGeo(st, new THREE.SphereGeometry(1, 8, 6)), toon(st, hex(palette.sunDeep)));
    t.scale.setScalar(0.05 - i * 0.012);
    t.position.copy(coinMesh.position);
    t.castShadow = false;
    group.add(t);
    tail.push(t);
  }
  st.root.add(group);
  st.coins.push({ group, tail, lane, x: x0, y: MUZZLE_Y, z: z0, vx, vy: VY, vz, landX: P.aimError, resolved: false });
  P.recoil = 1;
  P.poseT = 0.45;
  const ch = st.ctx.characters[P.id];
  if (ch) ch.anim.squash();
  st.ctx.playSfx("whoosh", { volume: 0.6 });
}

function scoreHit(st: State, pid: number, pts: number, at: [number, number, number]): void {
  const P = st.players[pid];
  P.score += pts;
  for (let k = 0; k < pts; k++) {
    const idx = P.score - pts + k;
    if (idx < P.scoreStars.length) P.scoreStars[idx].visible = true;
  }
  if (pts >= 2) {
    st.ctx.playSfx("coin.gain", { volume: 0.9, pitch: 1.3 });
    st.ctx.playSfx("crowd.ooh", { volume: 0.6 });
    spawnBurst(st, at, hex(palette.sun), 10, 3.2, 0.5, 7, 0.08);
    spawnBurst(st, at, hex(palette.white), 6, 2.6, 0.45, 6, 0.06);
    st.shake = Math.min(0.3, st.shake + 0.12);
  } else {
    st.ctx.playSfx("coin.gain", { volume: 0.8 });
    spawnBurst(st, at, hex(palette.sun), 8, 2.6, 0.45, 7, 0.07);
    st.shake = Math.min(0.3, st.shake + 0.05);
  }
  const ch = st.ctx.characters[P.id];
  if (ch) {
    ch.anim.cheer();
    P.cheerT = 1.1;
  }
}

function resolveCoin(st: State, c: Coin): void {
  const lane = c.lane;
  const tA = c.y > CATCH_Y ? Math.min(arriveTime(c.y, c.vy), 0.15) : 0;
  let best = Infinity;
  let bestX = 0;
  let bestB: Basket | null = null;
  for (const b of st.baskets) {
    if (b.lane !== lane) continue;
    const bx = b.x - b.speed * tA;
    const d = Math.abs(bx - c.landX); // distance from THIS coin's landing x
    if (d < best) {
      best = d;
      bestX = bx;
      bestB = b;
    }
  }
  if (best <= CATCH_R) {
    // caught (bestX = basket centre at the exact rim crossing)
    if (bestB) bestB.bounce = 1;
    const pts = best <= PERFECT_R ? 2 : 1;
    if (st.players[lane].id > 0) st.players[lane].cpuHits += 1;
    scoreHit(st, lane, pts, [bestX, 0.8, LANE_Z[lane] + LAND_Z_OFF]);
  } else if (best <= 1.6) {
    // near miss: little dust puff
    spawnBurst(st, [bestX, 0.22, LANE_Z[lane] + LAND_Z_OFF], hex(palette.creamShadow), 5, 1.4, 0.4, 2.5, 0.05);
  }
  c.resolved = true;
  st.root.remove(c.group);
}

function endRound(st: State): void {
  if (st.finished) return;
  st.finished = true;
  const ranking = [...st.players]
    .sort((a, b) => b.score - a.score || a.id - b.id)
    .map((p) => p.id);
  const scores = st.players.map((p) => `${p.id}:${p.score}`).join(",");
  const shots = st.players.map((p) => `s${p.id}:${p.cpuShots}/${p.cpuHits}/${p.cpuAborts}`).join(",");
  console.log(`[coin_cannon] finish ranking=${ranking.join(",")} scores=${scores} shots=${shots}`);
  const winnerName = st.ctx.players[ranking[0]]?.name ?? "?";
  st.ctx.announce(`${winnerName} WINS COIN CANNON!`, { durationMs: 1600, sound: null });
  st.ctx.playSfx("crowd.cheer", { volume: 0.9 });
  st.shake = 0.24;
  const winCh = st.ctx.characters[ranking[0]];
  if (winCh) winCh.anim.cheer();
  st.ctx.finish(ranking);
}

/* ------------------------------ minigame --------------------------------- */

const coinCannon: Minigame = {
  id: "coin_cannon",
  name: "Coin Cannon",
  genre: "timing",

  setup(ctx: MinigameContext): void {
    const st: State = {
      ctx,
      root: new THREE.Group(),
      players: [],
      baskets: [],
      coins: [],
      particles: [],
      rollers: [],
      spawnT: [0, 0, 0, 0],
      t: 0,
      shake: 0,
      announcedGo: false,
      finished: false,
      camBase: [0, 12.5, 13.8],
      camLook: [0, 2.6, -0.5],
      toons: new Map(),
      geos: [],
      mats: [],
    };
    state = st;

    // ---- per-player state (id = playerId; lane 0 = human, nearest camera) ----
    ctx.players.forEach((p, lane) => {
      st.players.push({
        id: p.id,
        lane,
        color: hex(p.color),
        ammo: AMINO,
        score: 0,
        charging: false,
        chargeT: 0,
        aimError: 0,
        aimSlop: 0,
        thinkT: 0.4 + lane * 0.25 + ctx.rng() * 0.3,
        recoil: 0,
        poseT: 0,
        cheerT: 0,
        cpuShots: 0,
        cpuHits: 0,
        cpuAborts: 0,
        wrapper: new THREE.Group(),
        char: null,
        barrel: new THREE.Group(),
        glow: new THREE.Mesh(),
        ammoPips: [],
        scoreStars: [],
      });
    });

    // ---- camera (party view of all four corridors) ----
    const cam = ctx.camera;
    const portrait = window.innerWidth / window.innerHeight < 1;
    if (portrait) {
      st.camBase = [0, 16.5, 22];
      st.camLook = [0, 2.8, -0.5];
      cam.fov = 64;
    } else {
      st.camBase = [0, 12.5, 13.8];
      st.camLook = [0, 2.6, -0.5];
      cam.fov = 58;
    }
    cam.position.set(st.camBase[0], st.camBase[1], st.camBase[2]);
    cam.lookAt(st.camLook[0], st.camLook[1], st.camLook[2]);
    cam.updateProjectionMatrix();

    buildArena(st);
    st.ctx.scene.add(st.root); // the arena is one root group — add it to the live scene

    ctx.announce("COIN CANNON!", { durationMs: 1500, sound: null });

    // ---- input: tap anywhere (or confirm) to fire ----
    ctx.input.pointer = (x: number, y: number, down: boolean): void => {
      void x;
      void y;
      if (!down) return;
      const P = st.players[0];
      if (st.finished || P.ammo <= 0 || P.charging) return;
      P.ammo -= 1;
      P.ammoPips[P.ammo].visible = false;
      P.charging = true;
      P.chargeT = CHARGE;
      P.aimError = 0;
      ctx.playSfx("ui.click", { volume: 0.5 });
    };
    ctx.input.key = (action: string): void => {
      if (action !== "confirm") return;
      const P = st.players[0];
      if (st.finished || P.ammo <= 0 || P.charging) return;
      P.ammo -= 1;
      P.ammoPips[P.ammo].visible = false;
      P.charging = true;
      P.chargeT = CHARGE;
      P.aimError = 0;
      ctx.playSfx("ui.click", { volume: 0.5 });
    };
  },

  update(dt: number): void {
    const st = state;
    if (!st || st.finished) return;
    const { ctx } = st;
    st.t += dt;

    if (!st.announcedGo && st.t > 0.05) {
      st.announcedGo = true;
      ctx.announce("TAP TO FIRE!", { durationMs: 1300, sound: null });
    }

    // ---- basket spawns (per-lane timers, rng jitter) ----
    for (let lane = 0; lane < 4; lane++) {
      st.spawnT[lane] -= dt;
      if (st.spawnT[lane] <= 0) {
        spawnBasket(st, lane);
        st.spawnT[lane] = 1.7 + (ctx.rng() - 0.5) * 0.5;
      }
    }
    // move + despawn baskets
    for (let i = st.baskets.length - 1; i >= 0; i--) {
      const b = st.baskets[i];
      b.x -= b.speed * dt;
      b.bounce = Math.max(0, b.bounce - dt * 2.2);
      b.group.position.x = b.x;
      b.group.position.y = 0.12 * b.bounce;
      const dip = 1 - 0.18 * b.bounce; // squash on catch, with a slight stretch
      b.group.scale.set(1 + 0.08 * b.bounce, dip, 1 + 0.08 * b.bounce);
      if (b.x < BASKET_DESPAWN_X) {
        st.root.remove(b.group);
        disposeGeos(b.group);
        st.baskets.splice(i, 1);
      }
    }

    // ---- CPU thinking (players 1..3): watch the lane, fire at ~60% of
    // opportunities. Each evaluation draws this shot's aim error + timing
    // slop and only commits when a basket is already inside the fire zone
    // (compensating the 0.12s charge delay), so commits rarely abort.
    const tAThink = arriveTime(MUZZLE_Y, VY);
    for (let pid = 1; pid < 4; pid++) {
      const P = st.players[pid];
      if (P.ammo <= 0) continue;
      P.thinkT -= dt;
      if (P.thinkT <= 0 && !P.charging) {
        P.thinkT = 0.35 + ctx.rng() * 0.3;
        const err = (ctx.rng() * 2 - 1) * 1.3;
        const slop = ctx.rng() * 0.55;
        // lead: where a basket must be NOW so it is within catch+slop of the
        // aim point when the coin lands (charge delay shifts it by ~s*CHARGE)
        const lead = tAThink + CHARGE;
        let best = Infinity;
        for (const b of st.baskets) {
          if (b.lane !== P.lane) continue;
          const d = Math.abs(b.x - b.speed * lead - err);
          if (d < best) best = d;
        }
        if (best <= 0.84 + slop && ctx.rng() < 0.6) {
          P.aimError = err;
          P.aimSlop = slop;
          P.charging = true;
          P.chargeT = CHARGE;
        }
      }
    }

    // ---- charge-up -> fire ----
    for (const P of st.players) {
      if (!P.charging) continue;
      P.chargeT -= dt;
      const frac = 1 - Math.max(0, P.chargeT) / CHARGE;
      P.glow.visible = true;
      P.glow.scale.setScalar(0.12 * (0.5 + 1.3 * frac));
      if (P.chargeT <= 0) {
        P.charging = false;
        P.glow.visible = false;
        if (P.id === 0) {
          fireCoin(st, P.id);
        } else {
          // CPU re-checks the window at fire time: a basket must be within
          // catch + timing slop of its aim point at coin arrival, else hold.
          const tA = arriveTime(MUZZLE_Y, VY);
          let best = Infinity;
          for (const b of st.baskets) {
            if (b.lane !== P.lane) continue;
            const d = Math.abs(b.x - b.speed * tA - P.aimError);
            if (d < best) best = d;
          }
          if (best <= 0.84 + P.aimSlop) {
            P.ammo -= 1;
            P.ammoPips[P.ammo].visible = false;
            P.cpuShots += 1;
            fireCoin(st, P.id);
          } else {
            P.cpuAborts += 1;
          }
        }
      }
    }

    // ---- coins: analytic rim-crossing resolve, then integrate ----
    for (const c of st.coins) {
      if (!c.resolved) {
        if (c.y <= CATCH_Y || arriveTime(c.y, c.vy) <= dt) {
          resolveCoin(st, c);
        }
      }
      if (c.resolved) continue;
      c.vy -= GRAV * dt;
      c.x += c.vx * dt;
      c.y += c.vy * dt;
      c.z += c.vz * dt;
      c.group.position.set(c.x, c.y, c.z);
      for (let i = 0; i < c.tail.length; i++) {
        const t = c.tail[i];
        t.position.set(c.x - c.vx * (0.03 + i * 0.035), c.y - c.vy * (0.03 + i * 0.035), c.z - c.vz * (0.03 + i * 0.035));
        const s = 0.05 - i * 0.012;
        t.scale.setScalar(Math.max(0.008, s * Math.min(1, c.y / (MUZZLE_Y * 0.8))));
      }
      if (c.y <= 0.06) {
        c.resolved = true;
        st.root.remove(c.group);
        ctx.playSfx("pop", { volume: 0.3 });
      }
    }
    for (let i = st.coins.length - 1; i >= 0; i--) {
      if (st.coins[i].resolved) st.coins.splice(i, 1);
    }

    // ---- juice: rollers, recoil, poses, shake, particles ----
    for (const r of st.rollers) r.rotation.y += dt * 4;
    for (const P of st.players) {
      if (P.recoil > 0) {
        P.recoil = Math.max(0, P.recoil - dt * 3.5);
        P.barrel.rotation.x = Math.atan2(0.51, -0.51) + 0.22 * P.recoil;
        P.barrel.position.z = 0.62 + 0.06 * P.recoil;
      }
      if (P.poseT > 0) {
        P.poseT -= dt;
        if (P.poseT <= 0) {
          const ch = ctx.characters[P.id];
          if (ch) ch.anim.idle();
        }
      }
      if (P.cheerT > 0) {
        P.cheerT -= dt;
        if (P.cheerT <= 0) {
          const ch = ctx.characters[P.id];
          if (ch) ch.anim.idle();
        }
      }
    }
    st.shake = Math.max(0, st.shake - dt * 0.9);
    if (st.shake > 0) {
      const a = st.shake;
      ctx.camera.position.set(
        st.camBase[0] + Math.sin(st.t * 57) * a,
        st.camBase[1] + Math.cos(st.t * 43) * a,
        st.camBase[2] + Math.sin(st.t * 61) * a
      );
      ctx.camera.lookAt(st.camLook[0], st.camLook[1], st.camLook[2]);
    }
    updateParticles(st, dt);

    // ---- end conditions ----
    if (st.t >= TIME_CAP || st.players.every((p) => p.ammo <= 0)) {
      endRound(st);
    }
  },

  teardown(): void {
    const st = state;
    if (!st) return;
    // hand the characters back to the framework (direct scene children again)
    for (const P of st.players) {
      if (P.char && P.wrapper) {
        P.wrapper.remove(P.char);
        st.ctx.scene.add(P.char);
      }
    }
    st.ctx.input.pointer = (): void => {};
    st.ctx.input.key = (): void => {};
    st.ctx.scene.remove(st.root);
    disposeObj(st.root);
    state = null;
  },
};

export function loadCoinCannon(): Promise<Minigame> {
  return Promise.resolve(coinCannon);
}

export default coinCannon;

// Self-register once the module is importable (registry dedupes by id).
void registerMinigame({ id: coinCannon.id, name: coinCannon.name });
