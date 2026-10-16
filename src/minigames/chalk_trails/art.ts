/**
 * CHALK TRAILS — the art kit (presentation only).
 *
 * One material cache and one geometry list per round, everything disposed by
 * `kit.dispose()`. Builders for the snails and gems, the chalk layer that shows the
 * paths (and washes them away under the rain), and the small particle pools. No
 * gameplay rng: the few "random" looks come from a fixed local generator.
 */
import * as THREE from "three";
import { palette, hex } from "../../config/palette";
import { celGradient } from "../../characters/cel";
import { HALF_D, HALF_W, SEATS, type Pt, type Snail } from "./rules";

/* ------------------------------------------------------------------ */
/*  The kit                                                            */
/* ------------------------------------------------------------------ */

export interface Kit {
  toon(color: string): THREE.MeshToonMaterial;
  basic(color: string): THREE.MeshBasicMaterial;
  /** A flat, see-through basic material shared by colour + opacity. */
  ghost(color: string, opacity: number): THREE.MeshBasicMaterial;
  geo<T extends THREE.BufferGeometry>(g: T): T;
  tex<T extends THREE.Texture>(t: T): T;
  mat<T extends THREE.Material>(m: T): T;
  dispose(): void;
}

export function createKit(): Kit {
  const toons = new Map<string, THREE.MeshToonMaterial>();
  const basics = new Map<string, THREE.MeshBasicMaterial>();
  const ghosts = new Map<string, THREE.MeshBasicMaterial>();
  const geos: THREE.BufferGeometry[] = [];
  const texs: THREE.Texture[] = [];
  const mats: THREE.Material[] = [];
  return {
    toon(color) {
      let m = toons.get(color);
      if (!m) {
        m = new THREE.MeshToonMaterial({ color: hex(color), gradientMap: celGradient });
        toons.set(color, m);
      }
      return m;
    },
    basic(color) {
      let m = basics.get(color);
      if (!m) {
        m = new THREE.MeshBasicMaterial({ color: hex(color) });
        basics.set(color, m);
      }
      return m;
    },
    ghost(color, opacity) {
      const key = `${color}@${opacity}`;
      let m = ghosts.get(key);
      if (!m) {
        m = new THREE.MeshBasicMaterial({ color: hex(color), transparent: true, opacity, depthWrite: false });
        ghosts.set(key, m);
      }
      return m;
    },
    geo(g) {
      geos.push(g);
      return g;
    },
    tex(t) {
      texs.push(t);
      return t;
    },
    mat(m) {
      mats.push(m);
      return m;
    },
    dispose() {
      for (const m of toons.values()) m.dispose();
      for (const m of basics.values()) m.dispose();
      for (const m of ghosts.values()) m.dispose();
      for (const m of mats) m.dispose();
      for (const g of geos) g.dispose();
      for (const t of texs) t.dispose();
      toons.clear();
      basics.clear();
      ghosts.clear();
      geos.length = 0;
      texs.length = 0;
      mats.length = 0;
    },
  };
}

/** Fixed local generator for looks (never a gameplay draw). */
export function lookRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------------ */
/*  Textures                                                           */
/* ------------------------------------------------------------------ */

export function canvasOf(w: number, h: number): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d");
  if (!g) throw new Error("2D canvas context unavailable");
  return { c, g };
}

/** Chunky outlined word on a transparent card (popups). */
export function makeWordTexture(text: string, fill: string, w = 128, h = 80, size = 60): THREE.CanvasTexture {
  const { c, g } = canvasOf(w, h);
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.lineJoin = "round";
  g.font = `700 ${size}px Fredoka, sans-serif`;
  g.lineWidth = Math.round(size / 5);
  g.strokeStyle = palette.ink;
  g.strokeText(text, w / 2, h / 2 + 3);
  g.fillStyle = fill;
  g.fillText(text, w / 2, h / 2 + 3);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A spiral on a round shell, in the player's colour. */
export function makeShellTexture(color: string): THREE.CanvasTexture {
  const { c, g } = canvasOf(128, 128);
  g.fillStyle = color;
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = palette.ink;
  g.globalAlpha = 0.5;
  g.lineWidth = 8;
  g.lineCap = "round";
  g.beginPath();
  for (let i = 0; i <= 90; i++) {
    const a = i * 0.2;
    const r = 4 + i * 0.62;
    const x = 64 + Math.cos(a) * r;
    const y = 64 + Math.sin(a) * r;
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* ------------------------------------------------------------------ */
/*  Snail and gem                                                      */
/* ------------------------------------------------------------------ */

export interface SnailView {
  /** Moves and turns with the snail on the ground. */
  root: THREE.Group;
  /** The shell and body bob and squash inside the root. */
  body: THREE.Group;
  stalks: THREE.Group[];
  halo: THREE.Mesh;
  haloMat: THREE.MeshBasicMaterial;
}

/** A snail facing +z: tan body, a spiral shell in the player's colour, two eye stalks. */
export function buildSnail(kit: Kit, color: string): SnailView {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const tan = kit.toon(palette.sand);
  const slug = new THREE.Mesh(kit.geo(new THREE.CapsuleGeometry(0.3, 0.9, 4, 10)), tan);
  slug.rotation.x = Math.PI / 2;
  slug.scale.set(1, 1, 0.62);
  slug.position.set(0, 0.2, 0);
  body.add(slug);
  const head = new THREE.Mesh(kit.geo(new THREE.SphereGeometry(0.31, 14, 10)), tan);
  head.position.set(0, 0.33, 0.62);
  body.add(head);

  const shellMat = kit.mat(new THREE.MeshToonMaterial({ map: kit.tex(makeShellTexture(color)), gradientMap: celGradient }));
  const shell = new THREE.Mesh(kit.geo(new THREE.SphereGeometry(0.46, 18, 14)), shellMat);
  shell.scale.set(0.9, 1, 1);
  shell.position.set(0, 0.62, -0.12);
  shell.rotation.set(-0.3, 0, Math.PI / 2);
  body.add(shell);

  const stalks: THREE.Group[] = [];
  const stalkGeo = kit.geo(new THREE.CylinderGeometry(0.045, 0.06, 0.4, 6));
  const eyeGeo = kit.geo(new THREE.SphereGeometry(0.12, 10, 8));
  const pupilGeo = kit.geo(new THREE.SphereGeometry(0.06, 8, 6));
  for (const sx of [-0.15, 0.15]) {
    const g = new THREE.Group();
    g.position.set(sx, 0.5, 0.74);
    const s = new THREE.Mesh(stalkGeo, tan);
    s.position.y = 0.2;
    g.add(s);
    const eye = new THREE.Mesh(eyeGeo, kit.toon(palette.white));
    eye.position.y = 0.42;
    g.add(eye);
    const pupil = new THREE.Mesh(pupilGeo, kit.basic(palette.ink));
    pupil.position.set(0, 0.43, 0.09);
    g.add(pupil);
    body.add(g);
    stalks.push(g);
  }

  // A ring on the ground under the snail, in its colour, so your own is easy to find.
  const haloMat = kit.mat(new THREE.MeshBasicMaterial({ color: hex(color), transparent: true, opacity: 0.0, depthWrite: false }));
  const halo = new THREE.Mesh(kit.geo(new THREE.RingGeometry(0.72, 0.9, 32)), haloMat);
  halo.rotation.x = -Math.PI / 2;
  halo.position.y = 0.07;
  root.add(halo);
  return { root, body, stalks, halo, haloMat };
}

export interface GemView {
  root: THREE.Group;
  gem: THREE.Mesh;
  glow: THREE.Mesh;
}

export const GEM_COLORS = [palette.bubble, palette.candy, palette.sun, palette.mint, palette.berry] as const;

export function buildGem(kit: Kit, slot: number): GemView {
  const root = new THREE.Group();
  const color = GEM_COLORS[slot % GEM_COLORS.length];
  const gem = new THREE.Mesh(kit.geo(new THREE.OctahedronGeometry(0.46, 0)), kit.toon(color));
  gem.scale.set(1, 1.35, 1);
  gem.position.y = 0.7;
  root.add(gem);
  const glow = new THREE.Mesh(kit.geo(new THREE.CircleGeometry(0.62, 24)), kit.ghost(color, 0.38));
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = 0.06;
  root.add(glow);
  return { root, gem, glow };
}

/* ------------------------------------------------------------------ */
/*  The chalk layer                                                    */
/* ------------------------------------------------------------------ */

const CHALK_PX = 36;
const CHALK_W = Math.round(2 * HALF_W * CHALK_PX);
const CHALK_H = Math.round(2 * HALF_D * CHALK_PX);

export interface ChalkLayer {
  mesh: THREE.Mesh;
  /** Repaint the paths. `colors` is by seat. */
  paint(snails: readonly Snail[], colors: readonly string[]): void;
  /** Keep what is on the ground now as the picture the rain washes off. */
  startWash(): void;
  /** The band's leading edge is at ground x; everything behind it is gone. */
  wash(x: number): void;
  clear(): void;
  dispose(): void;
}

export function createChalkLayer(parent: THREE.Object3D): ChalkLayer {
  const { c, g } = canvasOf(CHALK_W, CHALK_H);
  const snap = canvasOf(CHALK_W, CHALK_H);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const geo = new THREE.PlaneGeometry(2 * HALF_W, 2 * HALF_D);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = 0.045;
  mesh.renderOrder = 2;
  parent.add(mesh);

  const px = (p: Pt): [number, number] => [(p.x + HALF_W) * CHALK_PX, (p.z + HALF_D) * CHALK_PX];
  const line = (pts: readonly Pt[], from: number, to: number, startAt: Pt | null): void => {
    g.beginPath();
    let first = true;
    if (startAt) {
      g.moveTo(...px(startAt));
      first = false;
    }
    for (let i = from; i < to; i++) {
      const [x, y] = px(pts[i]);
      if (first) {
        g.moveTo(x, y);
        first = false;
      } else g.lineTo(x, y);
    }
    if (pts.length === 1 && !startAt) g.lineTo(px(pts[0])[0] + 0.1, px(pts[0])[1]);
    g.stroke();
  };

  return {
    mesh,
    paint(snails, colors) {
      g.clearRect(0, 0, CHALK_W, CHALK_H);
      g.lineCap = "round";
      g.lineJoin = "round";
      for (const sn of snails) {
        const pts = sn.path;
        if (pts.length === 0) continue;
        const color = colors[sn.seat] ?? palette.cream;
        // Dust under a brighter core. The part already walked is paler than the part ahead.
        const ahead = { x: sn.x, z: sn.z };
        const pass = (width: number, style: string, alphaAhead: number, alphaBehind: number): void => {
          g.lineWidth = width;
          g.strokeStyle = style;
          if (sn.next < pts.length) {
            g.globalAlpha = alphaAhead;
            line(pts, sn.next, pts.length, ahead);
          }
          if (sn.next > 0) {
            g.globalAlpha = alphaBehind;
            line(pts, 0, Math.min(pts.length, sn.next), null);
          }
        };
        pass(0.46 * CHALK_PX, color, 0.6, 0.3);
        pass(0.18 * CHALK_PX, palette.white, 0.95, 0.5);
      }
      g.globalAlpha = 1;
      tex.needsUpdate = true;
    },
    startWash() {
      snap.g.clearRect(0, 0, CHALK_W, CHALK_H);
      snap.g.drawImage(c, 0, 0);
    },
    wash(x) {
      g.clearRect(0, 0, CHALK_W, CHALK_H);
      const cut = Math.max(0, Math.min(CHALK_W, (x + HALF_W) * CHALK_PX));
      if (cut < CHALK_W) g.drawImage(snap.c, cut, 0, CHALK_W - cut, CHALK_H, cut, 0, CHALK_W - cut, CHALK_H);
      tex.needsUpdate = true;
    },
    clear() {
      g.clearRect(0, 0, CHALK_W, CHALK_H);
      tex.needsUpdate = true;
    },
    dispose() {
      mesh.removeFromParent();
      geo.dispose();
      mat.dispose();
      tex.dispose();
    },
  };
}

/* ------------------------------------------------------------------ */
/*  Particles                                                          */
/* ------------------------------------------------------------------ */

export interface Fx {
  /** A burst of sparkles where a gem was picked up. */
  burst(x: number, z: number, color: string): void;
  /** A ring that opens on the ground. */
  ring(x: number, z: number, color: string, size: number): void;
  /** A floating "+1". */
  pop(x: number, z: number): void;
  update(dt: number): void;
  dispose(): void;
}

interface Bit {
  alive: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  age: number;
  life: number;
  size: number;
  rot: number;
}

const SPARK_CAP = 90;
const RING_CAP = 10;
const POP_CAP = 10;

export function createFx(kit: Kit, parent: THREE.Object3D): Fx {
  const root = new THREE.Group();
  root.name = "chalk_trails:fx";
  parent.add(root);
  const rand = lookRng(0xc4a1);

  // Sparkles: one instanced mesh of tiny diamonds, tinted per instance.
  const sparkMesh = new THREE.InstancedMesh(kit.geo(new THREE.OctahedronGeometry(1, 0)), kit.mat(new THREE.MeshBasicMaterial({ color: 0xffffff })), SPARK_CAP);
  sparkMesh.frustumCulled = false;
  sparkMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  for (let i = 0; i < SPARK_CAP; i++) {
    sparkMesh.setMatrixAt(i, zero);
    sparkMesh.setColorAt(i, new THREE.Color(1, 1, 1));
  }
  root.add(sparkMesh);
  const sparks: Bit[] = Array.from({ length: SPARK_CAP }, () => ({ alive: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, age: 0, life: 1, size: 1, rot: 0 }));
  let nextSpark = 0;

  const ringGeo = kit.geo(new THREE.RingGeometry(0.78, 1, 36));
  ringGeo.rotateX(-Math.PI / 2);
  const rings = Array.from({ length: RING_CAP }, () => {
    const mat = kit.mat(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }));
    const mesh = new THREE.Mesh(ringGeo, mat);
    mesh.visible = false;
    mesh.position.y = 0.09;
    mesh.renderOrder = 4;
    root.add(mesh);
    return { mesh, mat, age: 0, life: 0.6, size: 1, alive: false };
  });
  let nextRing = 0;

  const popMat = kit.mat(new THREE.SpriteMaterial({ map: kit.tex(makeWordTexture("+1", palette.sun)), transparent: true, depthWrite: false, depthTest: false }));
  const pops = Array.from({ length: POP_CAP }, () => {
    const sprite = new THREE.Sprite(popMat);
    sprite.visible = false;
    sprite.renderOrder = 9;
    root.add(sprite);
    return { sprite, age: 0, life: 0.9, x: 0, z: 0, alive: false };
  });
  let nextPop = 0;

  const dummy = new THREE.Object3D();
  const tint = new THREE.Color();

  return {
    burst(x, z, color) {
      tint.set(hex(color));
      for (let i = 0; i < 8; i++) {
        const b = sparks[nextSpark];
        sparkMesh.setColorAt(nextSpark, tint);
        nextSpark = (nextSpark + 1) % SPARK_CAP;
        const a = rand() * Math.PI * 2;
        const sp = 1.2 + rand() * 2.2;
        b.alive = true;
        b.x = x;
        b.y = 0.8;
        b.z = z;
        b.vx = Math.cos(a) * sp;
        b.vy = 2.2 + rand() * 2.6;
        b.vz = Math.sin(a) * sp;
        b.age = 0;
        b.life = 0.5 + rand() * 0.3;
        b.size = 0.09 + rand() * 0.06;
        b.rot = rand() * 6;
      }
      if (sparkMesh.instanceColor) sparkMesh.instanceColor.needsUpdate = true;
    },
    ring(x, z, color, size) {
      const r = rings[nextRing];
      nextRing = (nextRing + 1) % RING_CAP;
      r.alive = true;
      r.age = 0;
      r.size = size;
      r.mat.color.set(hex(color));
      r.mesh.position.x = x;
      r.mesh.position.z = z;
      r.mesh.visible = true;
    },
    pop(x, z) {
      const p = pops[nextPop];
      nextPop = (nextPop + 1) % POP_CAP;
      p.alive = true;
      p.age = 0;
      p.x = x;
      p.z = z;
      p.sprite.visible = true;
    },
    update(dt) {
      let any = false;
      for (let i = 0; i < SPARK_CAP; i++) {
        const b = sparks[i];
        if (!b.alive) continue;
        any = true;
        b.age += dt;
        if (b.age >= b.life) {
          b.alive = false;
          sparkMesh.setMatrixAt(i, zero);
          continue;
        }
        b.vy -= 9 * dt;
        b.x += b.vx * dt;
        b.y = Math.max(0.05, b.y + b.vy * dt);
        b.z += b.vz * dt;
        b.rot += dt * 9;
        dummy.position.set(b.x, b.y, b.z);
        dummy.scale.setScalar(b.size * (1 - b.age / b.life));
        dummy.rotation.set(b.rot, b.rot * 0.7, 0);
        dummy.updateMatrix();
        sparkMesh.setMatrixAt(i, dummy.matrix);
      }
      if (any) sparkMesh.instanceMatrix.needsUpdate = true;
      for (const r of rings) {
        if (!r.alive) continue;
        r.age += dt;
        const u = r.age / r.life;
        if (u >= 1) {
          r.alive = false;
          r.mesh.visible = false;
          continue;
        }
        r.mesh.scale.setScalar(r.size * (0.5 + 1.6 * u));
        r.mat.opacity = 0.85 * (1 - u) * (1 - u);
      }
      for (const p of pops) {
        if (!p.alive) continue;
        p.age += dt;
        const u = p.age / p.life;
        if (u >= 1) {
          p.alive = false;
          p.sprite.visible = false;
          continue;
        }
        p.sprite.position.set(p.x, 1.3 + u * 1.3, p.z);
        const s = (0.9 + Math.min(1, u * 6) * 0.4) * (1 - Math.max(0, u - 0.7) * 2.5);
        p.sprite.scale.set(1.5 * s, 0.94 * s, 1);
      }
    },
    dispose() {
      sparkMesh.dispose();
      root.removeFromParent();
    },
  };
}

/** Seat colours for the chalk, from the players. */
export const seatColors = (players: ReadonlyArray<{ id: number; color: string }>): string[] => {
  const out: string[] = new Array<string>(SEATS).fill(palette.cream);
  players.forEach((p, i) => {
    out[i] = p.color || palette.cream;
  });
  return out;
};
