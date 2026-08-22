/**
 * CAKE DASH — arena, scenery and the finish cake.
 *
 * Builds the grass course (checker tiles, dashed lane dividers, rails),
 * the sky + sun + parallax clouds, and the big procedural finish cake
 * (stacked tiers, icing drips, cherry) at the end of the course.
 * Also owns the winner confetti burst. Deterministic: confetti velocities
 * come from ctx.rng at burst time; physics advance only by dt.
 *
 * Every object is registered so teardown() removes + disposes exactly once
 * (shared per-round toon materials + geometry tracking via Assets).
 */
import * as THREE from "three";
import { palette, hex } from "../../config/palette";
import { celGradient } from "../../characters/cel";

export const COURSE_LEN = 55; // cake center x
export const FINISH_X = 52; // finish line / ranking plane
export const START_X = -3.5; // start line x (characters line up here)
export const LANE_Z: readonly number[] = [-2.55, -0.85, 0.85, 2.55]; // lanes 0..3 (spacing 1.7)
export const LANE_SPACING = 1.7;
export const GROUND_HALF = 3.35; // grass strip half-width (z)
const COURSE_MIN = -9;
const COURSE_MAX = COURSE_LEN + 6;

/** Per-round asset registry: cached cel materials + tracked geometries. */
export class Assets {
  private toons = new Map<string, THREE.MeshToonMaterial>();
  private flats = new Map<string, THREE.MeshBasicMaterial>();
  private geos = new Set<THREE.BufferGeometry>();
  private inkOut: THREE.MeshBasicMaterial | null = null;

  toon(color: string): THREE.MeshToonMaterial {
    let m = this.toons.get(color);
    if (!m) {
      m = new THREE.MeshToonMaterial({ map: celGradient, color: hex(color) });
      this.toons.set(color, m);
    }
    return m;
  }

  flat(color: string): THREE.MeshBasicMaterial {
    let m = this.flats.get(color);
    if (!m) {
      m = new THREE.MeshBasicMaterial({ color: hex(color) });
      this.flats.set(color, m);
    }
    return m;
  }

  /**
   * Opaque ink material for silhouette outlines. Deliberately a SEPARATE
   * instance from the cached ink flat: shadowMat mutates that shared flat
   * (transparent + opacity 0.3), which would leak into every outline shell
   * if they shared it.
   */
  inkOutline(): THREE.MeshBasicMaterial {
    if (!this.inkOut) {
      // Inverted-hull silhouette: the outline shell is a copy of the source
      // geometry scaled OUTLINE_SCALE and rendered BackSide, so its front
      // faces are culled and only the back faces show — behind the real
      // mesh. That makes the dark hull peek out as a thin outline instead of
      // an opaque box that HIDES the colored obstacle (candy handle / lava
      // tips) inside it.
      this.inkOut = new THREE.MeshBasicMaterial({
        color: hex(palette.ink),
        side: THREE.BackSide,
      });
      this.inkOut.name = "ink-outline";
    }
    return this.inkOut;
  }

  geo(g: THREE.BufferGeometry): THREE.BufferGeometry {
    this.geos.add(g);
    return g;
  }

  disposeAll(): void {
    for (const m of this.toons.values()) m.dispose();
    for (const m of this.flats.values()) m.dispose();
    for (const g of this.geos) g.dispose();
    this.inkOut?.dispose();
    this.inkOut = null;
    this.toons.clear();
    this.flats.clear();
    this.geos.clear();
  }
}

/** Ink "grounding" shadow material (shared, transparent). */
export function shadowMat(a: Assets): THREE.MeshBasicMaterial {
  const m = a.flat(palette.ink);
  m.transparent = true;
  m.opacity = 0.3;
  return m;
}

interface ConfettiPiece {
  mesh: THREE.Mesh;
  vx: number;
  vy: number;
  vz: number;
  rx: number;
  ry: number;
  rz: number;
  t: number;
  life: number;
}

interface Cloud {
  group: THREE.Group;
  baseX: number;
  y: number;
  s: number;
}

const CONFETTI_COLORS = [palette.candy, palette.sun, palette.mint, palette.bubble, palette.berry];

export class Course {
  readonly assets = new Assets();
  private scene: THREE.Scene;
  private added: THREE.Object3D[] = [];
  private confetti: ConfettiPiece[] = [];
  private sun: THREE.Mesh;
  private clouds: Cloud[] = [];
  /** Leading runner x — drives sun/cloud parallax. */
  leaderX = 0;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.sun = this.buildSun();
    this.clouds = this.buildClouds();
    this.buildArena();
  }

  /* ------------------------------------------------------------- */
  /*  Builders                                                      */
  /* ------------------------------------------------------------- */

  private track(obj: THREE.Object3D): THREE.Object3D {
    this.added.push(obj);
    this.scene.add(obj);
    return obj;
  }

  private mesh(
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    pos: [number, number, number],
    parent: THREE.Object3D,
    rot?: THREE.Euler
  ): THREE.Mesh {
    const m = new THREE.Mesh(this.assets.geo(geo), mat);
    m.position.set(pos[0], pos[1], pos[2]);
    if (rot) m.rotation.copy(rot);
    parent.add(m);
    return m;
  }

  /** Big flat sky + a deeper meadow band behind the course. */
  private buildArena(): void {
    const s = this.scene;

    // Sky (above the horizon seam) + meadow (below it) — the seam sits just
    // above the course surface so the sky stays visible in frame.
    this.track(
      this.mesh(
        new THREE.PlaneGeometry(220, 44),
        this.assets.flat(palette.bubble),
        [0, 21, -8.6],
        s
      )
    );
    this.track(
      this.mesh(
        new THREE.PlaneGeometry(220, 33),
        this.assets.flat(palette.mintDeep),
        [0, -16.25, -8.55],
        s
      )
    );

    // Grass base + checker tiles (speed feel).
    this.track(
      this.mesh(
        new THREE.BoxGeometry(COURSE_MAX - COURSE_MIN, 1, GROUND_HALF * 2 + 0.2),
        this.assets.toon(palette.grassA),
        [(COURSE_MIN + COURSE_MAX) / 2, -0.5, 0],
        s
      )
    );
    const tileGeo = new THREE.BoxGeometry(4.02, 0.035, GROUND_HALF * 2 + 0.1);
    for (let x = COURSE_MIN + 2; x < COURSE_MAX; x += 4) {
      this.track(this.mesh(tileGeo, this.assets.toon(palette.grassB), [x, 0.018, 0], s));
    }

    // Dashed lane dividers (3 lines between the 4 lanes).
    const dashGeo = new THREE.BoxGeometry(2.0, 0.04, 0.1);
    const dashMat = this.assets.toon(palette.cream);
    for (let i = 0; i < 3; i++) {
      const z = (i - 1) * LANE_SPACING;
      let di = 0;
      for (let x = COURSE_MIN + 1; x < COURSE_MAX - 1; x += 3.2) {
        if (di % 2 === 0) this.track(this.mesh(dashGeo, dashMat, [x, 0.035, z], s));
        di++;
      }
    }

    // Wood rails at the course edges.
    const railGeo = new THREE.BoxGeometry(COURSE_MAX - COURSE_MIN, 0.4, 0.12);
    for (const z of [-GROUND_HALF - 0.05, GROUND_HALF + 0.05]) {
      this.track(
        this.mesh(railGeo, this.assets.toon(palette.woodDark), [(COURSE_MIN + COURSE_MAX) / 2, 0.42, z], s)
      );
    }

    // Start + finish stripes.
    this.track(
      this.mesh(
        new THREE.BoxGeometry(0.3, 0.05, GROUND_HALF * 2),
        this.assets.toon(palette.white),
        [START_X - 1, 0.03, 0],
        s
      )
    );
    this.track(
      this.mesh(
        new THREE.BoxGeometry(0.5, 0.06, GROUND_HALF * 2),
        this.assets.toon(palette.sun),
        [FINISH_X, 0.035, 0],
        s
      )
    );

    this.buildCake();
  }

  /** The big celebratory cake at the end of the course. */
  private buildCake(): void {
    const g = new THREE.Group();
    const cx = COURSE_LEN;
    const cyl = (r: number, h: number, y: number, color: string): void => {
      this.mesh(new THREE.CylinderGeometry(r, r, h, 26), this.assets.toon(color), [0, y, 0], g);
    };

    // Ink grounding shadow.
    const shadow = new THREE.Mesh(
      this.assets.geo(new THREE.CylinderGeometry(3.6, 3.6, 0.03, 28)),
      shadowMat(this.assets)
    );
    shadow.position.y = 0.015;
    g.add(shadow);

    cyl(3.3, 0.32, 0.16, palette.cream); // plate
    cyl(2.9, 1.3, 0.97, palette.mint); // tier 1
    cyl(2.15, 1.1, 2.17, palette.sun); // tier 2
    cyl(1.4, 0.95, 3.2, palette.berry); // tier 3

    // Icing drips around each tier rim.
    const drip = (radius: number, y: number, count: number): void => {
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2;
        this.mesh(
          new THREE.SphereGeometry(0.24, 12, 10),
          this.assets.toon(palette.cream),
          [Math.cos(a) * radius, y, Math.sin(a) * radius],
          g
        );
      }
    };
    drip(2.9, 1.42, 9);
    drip(2.15, 2.52, 8);
    drip(1.4, 3.44, 6);

    // Cherry + stem.
    this.mesh(new THREE.SphereGeometry(0.5, 16, 12), this.assets.toon(palette.lava), [0, 4.3, 0], g);
    const stem = this.mesh(
      new THREE.CylinderGeometry(0.07, 0.07, 0.55, 10),
      this.assets.toon(palette.mintDeep),
      [0, 4.75, 0],
      g
    );
    stem.rotation.z = 0.25;

    g.position.set(cx, 0, 0);
    this.track(g);
  }

  private buildSun(): THREE.Mesh {
    const g = new THREE.Group();
    this.mesh(
      new THREE.CircleGeometry(3.4, 32),
      this.assets.flat(palette.sunDeep),
      [0, 0, -0.1],
      g
    );
    const disc = this.mesh(new THREE.CircleGeometry(2.3, 32), this.assets.flat(palette.sun), [0, 0, 0], g);
    g.position.set(8, 6.0, -8.35);
    this.track(g);
    return disc;
  }

  private buildClouds(): Cloud[] {
    const clouds: Cloud[] = [];
    const sphereGeo = new THREE.SphereGeometry(1, 14, 10);
    const mat = this.assets.flat(palette.white);
    for (let i = 0; i < 8; i++) {
      const group = new THREE.Group();
      const s = 1.2 + (i % 3) * 0.4;
      const puffs: [number, number, number, number][] = [
        [0, 0, 0, 0.9],
        [0.85, 0.15, 0.1, 0.6],
        [-0.85, 0.12, -0.05, 0.65],
        [0.35, 0.42, 0.05, 0.55],
      ];
      for (const [px, py, pz, pr] of puffs) {
        const m = new THREE.Mesh(sphereGeo, mat);
        m.position.set(px * s, py * s, pz * s);
        m.scale.set(pr, pr * 0.72, pr);
        group.add(m);
      }
      const cloud: Cloud = { group, baseX: -14 + i * 12, y: 4.8 + (i % 3) * 1.1, s };
      group.position.set(cloud.baseX, cloud.y, -8.3);
      this.track(group);
      clouds.push(cloud);
    }
    return clouds;
  }

  /* ------------------------------------------------------------- */
  /*  Per-frame                                                      */
  /* ------------------------------------------------------------- */

  /** Parallax scenery (sun + clouds) driven by the leader position. */
  updateScenery(leaderX: number): void {
    const wrap = (v: number, span: number): number => {
      const m = v % span;
      return m < 0 ? m + span : m;
    };
    this.sun.position.x = wrap(leaderX * 0.35 + 8, 70) - 8;
    for (const c of this.clouds) {
      c.group.position.x = wrap(c.baseX + leaderX * 0.45, 84) - 14;
    }
  }

  /** Confetti rain around the cake (rng-driven velocities at burst time). */
  confettiBurst(cx: number, cz: number, rng: () => number): void {
    const geo = this.assets.geo(new THREE.BoxGeometry(0.16, 0.16, 0.03));
    for (let i = 0; i < 46; i++) {
      const color = CONFETTI_COLORS[Math.floor(rng() * CONFETTI_COLORS.length)];
      const mesh = new THREE.Mesh(geo, this.assets.flat(color));
      mesh.position.set(
        cx + (rng() - 0.5) * 6.5,
        2.6 + rng() * 2.6,
        cz + (rng() - 0.5) * 6.5
      );
      this.scene.add(mesh);
      this.added.push(mesh);
      this.confetti.push({
        mesh,
        vx: (rng() - 0.5) * 2.6,
        vy: 1.6 + rng() * 2.6,
        vz: (rng() - 0.5) * 2.6,
        rx: (rng() - 0.5) * 14,
        ry: (rng() - 0.5) * 14,
        rz: (rng() - 0.5) * 14,
        t: 0,
        life: 2.2 + rng() * 0.6,
      });
    }
  }

  updateConfetti(dt: number): void {
    if (this.confetti.length === 0) return;
    for (let i = this.confetti.length - 1; i >= 0; i--) {
      const p = this.confetti[i];
      p.t += dt;
      p.vy -= 8.5 * dt;
      p.mesh.position.x += p.vx * dt;
      p.mesh.position.y += p.vy * dt;
      p.mesh.position.z += p.vz * dt;
      p.mesh.rotation.x += p.rx * dt;
      p.mesh.rotation.y += p.ry * dt;
      p.mesh.rotation.z += p.rz * dt;
      if (p.t >= p.life) {
        this.scene.remove(p.mesh);
        this.confetti.splice(i, 1);
      }
    }
  }

  teardown(): void {
    for (const obj of this.added) {
      this.scene.remove(obj);
    }
    this.added = [];
    this.confetti = [];
    this.assets.disposeAll();
  }
}
