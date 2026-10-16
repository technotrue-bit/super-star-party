/**
 * PIE FLICK — the roadside diner (presentation only).
 *
 * A 1950s highway diner at night, seen from the counter side: a purple-and-
 * cream checkered floor, four wedge-shaped counters of teal formica with chrome
 * bumper rails (one per player), and across the back wall a big neon STAR
 * DINER sign, a window onto the desert highway, a glowing jukebox, a pie case
 * with steam curling off the pies, a wall clock and a string of pennants.
 * Red vinyl booths line the sides (they show on a wide screen). The neon hums
 * and flickers, the jukebox pulses on the beat and floats music notes, the
 * pennants sway. `flare` lights the neon up for a moment (a served pie), and
 * `beat` kicks the jukebox.
 *
 * No gameplay rng: every placement is fixed, and everything that moves is a
 * function of the clock handed to `update`.
 */
import * as THREE from "three";
import { palette, hex } from "../../config/palette";
import { celGradient } from "../../characters/cel";
import {
  COUNTER_END,
  COUNTER_HALF_NEAR,
  COUNTER_HALF_SLOPE,
  RAIL_MARGIN,
  counterHalfWidth,
} from "./rules";

/** Height of the counter tops above the floor. */
export const COUNTER_Y = 0.95;
/** Distance between the counters' centre lines. */
export const LANE_GAP = 3.15;
/** The back wall. */
export const WALL_Z = -11.9;
/** How far the counter reaches behind the launch spot (toward the player). */
export const COUNTER_BACK = 0.9;
/** Height of the neon sign's centre. */
export const SIGN_Y = 6.2;

export interface DinerEnvironment {
  /** Idle animation on the presentation clock `t` (seconds). */
  update(t: number, dt: number): void;
  /** The neon and the jukebox light up for a moment (a served pie). */
  flare(): void;
  /** A kick on the jukebox beat. */
  beat(): void;
  dispose(): void;
}

export interface LaneInfo {
  x: number;
  color: string;
}

const mod = (n: number, m: number): number => ((n % m) + m) % m;

function canvas(w: number, h: number): { c: HTMLCanvasElement; g: CanvasRenderingContext2D | null } {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return { c, g: c.getContext("2d") };
}

function texOf(c: HTMLCanvasElement, srgb = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Black-and-cream checker: one repeat is 2 x 2 tiles. */
function checkerTexture(): THREE.CanvasTexture {
  const { c, g } = canvas(128, 128);
  if (g) {
    g.fillStyle = palette.creamShadow;
    g.fillRect(0, 0, 128, 128);
    g.fillStyle = palette.inkSoft;
    g.fillRect(0, 0, 64, 64);
    g.fillRect(64, 64, 64, 64);
    // A soft inner bevel on every tile.
    g.strokeStyle = "rgba(255,255,255,0.14)";
    g.lineWidth = 3;
    for (const [x, y] of [[0, 0], [64, 0], [0, 64], [64, 64]]) g.strokeRect(x + 2, y + 2, 60, 60);
  }
  const t = texOf(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

/** Teal formica with a sprinkle of little boomerangs. */
function formicaTexture(): THREE.CanvasTexture {
  const { c, g } = canvas(128, 128);
  if (g) {
    g.fillStyle = palette.mintDeep;
    g.fillRect(0, 0, 128, 128);
    g.strokeStyle = "rgba(255,246,229,0.5)";
    g.lineWidth = 3;
    g.lineCap = "round";
    const marks: [number, number, number][] = [[20, 24, 0.4], [78, 14, -0.7], [104, 62, 1.2], [44, 76, -0.2], [12, 108, 0.9], [92, 108, -1.1], [60, 44, 2.3]];
    for (const [x, y, a] of marks) {
      g.save();
      g.translate(x, y);
      g.rotate(a);
      g.beginPath();
      g.moveTo(-9, 4);
      g.lineTo(0, -4);
      g.lineTo(9, 4);
      g.stroke();
      g.restore();
    }
    g.fillStyle = "rgba(255,246,229,0.35)";
    for (const [x, y] of [[36, 52], [70, 96], [118, 30], [8, 60]]) {
      g.beginPath();
      g.arc(x, y, 2.4, 0, Math.PI * 2);
      g.fill();
    }
  }
  const t = texOf(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

/** The night view through the diner windows: sky, hills, a roadside star sign, cacti, the highway. */
function windowTexture(): THREE.CanvasTexture {
  const W = 2048;
  const H = 256;
  const { c, g } = canvas(W, H);
  if (g) {
    const sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, palette.nightSkyTop);
    sky.addColorStop(0.45, palette.berryDeep);
    sky.addColorStop(0.78, palette.candyDeep);
    sky.addColorStop(1, palette.sunDeep);
    g.fillStyle = sky;
    g.fillRect(0, 0, W, H);
    // Stars.
    let seed = 7;
    const rnd = (): number => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    g.fillStyle = "rgba(255,246,229,0.9)";
    for (let i = 0; i < 90; i++) {
      const r = 0.8 + rnd() * 1.4;
      g.beginPath();
      g.arc(rnd() * W, rnd() * H * 0.55, r, 0, Math.PI * 2);
      g.fill();
    }
    // Mesas and hills.
    g.fillStyle = palette.nightSky;
    g.beginPath();
    g.moveTo(0, H);
    for (let x = 0; x <= W; x += 16) {
      const y = H * 0.62 - Math.abs(Math.sin(x * 0.0042 + 1)) * 62 - Math.max(0, Math.sin(x * 0.013)) * 16;
      g.lineTo(x, y);
    }
    g.lineTo(W, H);
    g.fill();
    // The highway.
    g.fillStyle = palette.ink;
    g.fillRect(0, H * 0.82, W, H * 0.18);
    g.fillStyle = palette.sun;
    for (let x = 20; x < W; x += 110) g.fillRect(x, H * 0.9, 56, 4);
    // Saguaro cacti.
    const cactus = (x: number, h: number): void => {
      g.fillStyle = palette.leafPine;
      g.fillRect(x - 7, H * 0.82 - h, 14, h);
      g.fillRect(x - 24, H * 0.82 - h * 0.62, 18, 9);
      g.fillRect(x - 24, H * 0.82 - h * 0.62 - 26, 9, 30);
      g.fillRect(x + 6, H * 0.82 - h * 0.45, 18, 9);
      g.fillRect(x + 15, H * 0.82 - h * 0.45 - 24, 9, 28);
    };
    for (const [x, h] of [[210, 70], [610, 54], [1130, 78], [1560, 58], [1930, 66]]) cactus(x, h);
    // A roadside star sign on a pole, glowing.
    const sx = 860;
    g.fillStyle = palette.woodDark;
    g.fillRect(sx - 4, H * 0.3, 8, H * 0.52);
    const halo = g.createRadialGradient(sx, H * 0.26, 4, sx, H * 0.26, 54);
    halo.addColorStop(0, "rgba(255,226,90,0.95)");
    halo.addColorStop(1, "rgba(255,181,71,0)");
    g.fillStyle = halo;
    g.fillRect(sx - 60, H * 0.26 - 60, 120, 120);
    g.fillStyle = palette.sun;
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 === 0 ? 30 : 13;
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      g.lineTo(sx + Math.cos(a) * r, H * 0.26 + Math.sin(a) * r);
    }
    g.closePath();
    g.fill();
    g.strokeStyle = palette.ink;
    g.lineWidth = 3;
    g.stroke();
    // A tail-fin car on the highway with its headlamps lit.
    const cx = 1360;
    const cy = H * 0.855;
    g.fillStyle = palette.bubbleDeep;
    g.beginPath();
    g.roundRect(cx - 54, cy - 20, 108, 24, 8);
    g.fill();
    g.fillStyle = palette.bubble;
    g.beginPath();
    g.roundRect(cx - 28, cy - 36, 56, 22, 9);
    g.fill();
    g.fillStyle = palette.ink;
    for (const dx of [-32, 32]) {
      g.beginPath();
      g.arc(cx + dx, cy + 5, 10, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = palette.lampHot;
    g.beginPath();
    g.arc(cx + 54, cy - 8, 6, 0, Math.PI * 2);
    g.fill();
    const beam = g.createLinearGradient(cx + 54, 0, cx + 190, 0);
    beam.addColorStop(0, "rgba(255,242,194,0.6)");
    beam.addColorStop(1, "rgba(255,242,194,0)");
    g.fillStyle = beam;
    g.beginPath();
    g.moveTo(cx + 56, cy - 12);
    g.lineTo(cx + 190, cy - 30);
    g.lineTo(cx + 190, cy + 10);
    g.lineTo(cx + 56, cy - 4);
    g.fill();
  }
  const t = texOf(c);
  t.anisotropy = 4;
  return t;
}

/** Glowing neon lettering on a transparent canvas. */
function neonTexture(parts: { text: string; color: string; x: number }[], w: number, h: number, font: number, star = false): THREE.CanvasTexture {
  const { c, g } = canvas(w, h);
  if (g) {
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.lineJoin = "round";
    g.font = `700 ${font}px Fredoka, sans-serif`;
    for (const p of parts) {
      // The glow, then a thin bright core.
      g.shadowColor = p.color;
      g.shadowBlur = 38;
      g.lineWidth = font * 0.13;
      g.strokeStyle = p.color;
      g.strokeText(p.text, p.x, h / 2);
      g.shadowBlur = 16;
      g.strokeText(p.text, p.x, h / 2);
      g.shadowBlur = 0;
      g.fillStyle = palette.white;
      g.fillText(p.text, p.x, h / 2);
    }
    if (star) {
      g.shadowColor = palette.sun;
      g.shadowBlur = 30;
      g.fillStyle = palette.sun;
      g.strokeStyle = palette.white;
      g.lineWidth = 5;
      g.beginPath();
      for (let i = 0; i < 10; i++) {
        const r = i % 2 === 0 ? 52 : 22;
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        g.lineTo(w / 2 + Math.cos(a) * r, 52 + Math.sin(a) * r);
      }
      g.closePath();
      g.fill();
      g.stroke();
    }
  }
  return texOf(c);
}

/** A painted banner on the upper wall: the diner's menu in neon-sign lettering. */
function bannerTexture(): THREE.CanvasTexture {
  const { c, g } = canvas(2048, 128);
  if (g) {
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.font = "700 76px Fredoka, sans-serif";
    const words = ["PIE", "SHAKES", "BURGERS", "COFFEE", "PIE", "OPEN ALL NIGHT"];
    const cols = [palette.sun, palette.bubble, palette.candy, palette.mint, palette.sun, palette.cream];
    let x = 40;
    words.forEach((w, i) => {
      const width = g.measureText(w).width;
      g.fillStyle = cols[i];
      g.fillText(w, x + width / 2, 66);
      x += width + 40;
      g.fillStyle = palette.sun;
      g.beginPath();
      for (let k = 0; k < 10; k++) {
        const r = k % 2 === 0 ? 20 : 8;
        const a = -Math.PI / 2 + (k * Math.PI) / 5;
        g.lineTo(x + Math.cos(a) * r, 66 + Math.sin(a) * r);
      }
      g.closePath();
      g.fill();
      x += 60;
    });
  }
  const t = texOf(c);
  t.anisotropy = 4;
  return t;
}

function haloTexture(rgb: string): THREE.CanvasTexture {
  const { c, g } = canvas(64, 64);
  if (g) {
    const grad = g.createRadialGradient(32, 32, 2, 32, 32, 31);
    grad.addColorStop(0, `rgba(${rgb},0.95)`);
    grad.addColorStop(0.4, `rgba(${rgb},0.4)`);
    grad.addColorStop(1, `rgba(${rgb},0)`);
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
  }
  return texOf(c);
}

function noteTexture(): THREE.CanvasTexture {
  const { c, g } = canvas(64, 64);
  if (g) {
    g.fillStyle = palette.white;
    g.strokeStyle = palette.ink;
    g.lineWidth = 4;
    g.beginPath();
    g.ellipse(22, 46, 11, 8, -0.4, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    g.fillRect(30, 12, 6, 34);
    g.beginPath();
    g.moveTo(34, 12);
    g.quadraticCurveTo(52, 16, 50, 34);
    g.lineTo(44, 30);
    g.quadraticCurveTo(44, 22, 34, 22);
    g.fill();
  }
  return texOf(c);
}

function jukeboxPanelTexture(): THREE.CanvasTexture {
  const { c, g } = canvas(128, 160);
  if (g) {
    const bands = [palette.candy, palette.sun, palette.mint, palette.bubble, palette.berry];
    const grad = g.createLinearGradient(0, 0, 0, 160);
    bands.forEach((col, i) => grad.addColorStop(i / (bands.length - 1), col));
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 160);
    // A record behind the glass and a row of song titles.
    g.fillStyle = palette.ink;
    g.beginPath();
    g.arc(64, 62, 38, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = palette.candy;
    g.beginPath();
    g.arc(64, 62, 12, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = "rgba(255,255,255,0.28)";
    g.lineWidth = 2;
    for (const r of [20, 27, 33]) {
      g.beginPath();
      g.arc(64, 62, r, 0, Math.PI * 2);
      g.stroke();
    }
    g.fillStyle = palette.cream;
    for (let i = 0; i < 4; i++) g.fillRect(14, 112 + i * 10, 100 - (i % 2) * 24, 5);
  }
  return texOf(c);
}

function clockTexture(): THREE.CanvasTexture {
  const { c, g } = canvas(128, 128);
  if (g) {
    g.fillStyle = palette.cream;
    g.beginPath();
    g.arc(64, 64, 58, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = palette.spaceRed;
    g.lineWidth = 8;
    g.stroke();
    g.fillStyle = palette.ink;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      g.beginPath();
      g.arc(64 + Math.cos(a) * 46, 64 + Math.sin(a) * 46, i % 3 === 0 ? 5 : 2.6, 0, Math.PI * 2);
      g.fill();
    }
  }
  return texOf(c);
}

export function buildDinerEnvironment(parent: THREE.Object3D, lanes: readonly LaneInfo[]): DinerEnvironment {
  const root = new THREE.Group();
  root.name = "pieflick:environment";
  parent.add(root);

  const geos: THREE.BufferGeometry[] = [];
  const textures: THREE.Texture[] = [];
  const disposables: { dispose(): void }[] = [];
  const geo = <T extends THREE.BufferGeometry>(g: T): T => {
    geos.push(g);
    return g;
  };
  const tex = <T extends THREE.Texture>(t: T): T => {
    textures.push(t);
    return t;
  };

  const toonCache = new Map<string, THREE.MeshToonMaterial>();
  const toon = (color: string): THREE.MeshToonMaterial => {
    let m = toonCache.get(color);
    if (!m) {
      m = new THREE.MeshToonMaterial({ color: hex(color), gradientMap: celGradient });
      toonCache.set(color, m);
    }
    return m;
  };
  const basicCache = new Map<string, THREE.MeshBasicMaterial>();
  const basic = (color: string): THREE.MeshBasicMaterial => {
    let m = basicCache.get(color);
    if (!m) {
      m = new THREE.MeshBasicMaterial({ color: hex(color) });
      basicCache.set(color, m);
    }
    return m;
  };
  const chrome = toon(palette.metal);
  const mesh = (g: THREE.BufferGeometry, mat: THREE.Material | THREE.Material[], x = 0, y = 0, z = 0): THREE.Mesh => {
    const m = new THREE.Mesh(g, mat);
    m.position.set(x, y, z);
    return m;
  };
  const strutGeo = geo(new THREE.CylinderGeometry(1, 1, 1, 8));
  /** A unit-height cylinder stretched between two points. */
  const strut = (a: THREE.Vector3, b: THREE.Vector3, r: number, mat: THREE.Material): THREE.Mesh => {
    const m = new THREE.Mesh(strutGeo, mat);
    const d = new THREE.Vector3().subVectors(b, a);
    const len = d.length();
    m.position.copy(a).addScaledVector(d, 0.5);
    m.scale.set(r, len, r);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    return m;
  };

  const HALF_W = 12.5;
  // ---- the floor: dusky-purple-and-cream checker, every tile about 1.6 units ----
  const checker = tex(checkerTexture());
  checker.repeat.set(HALF_W * 2 / 3.2, (24 - WALL_Z) / 3.2);
  const floorMat = new THREE.MeshToonMaterial({ map: checker, gradientMap: celGradient });
  disposables.push(floorMat);
  const FLOOR_FRONT = 24;
  const floor = mesh(geo(new THREE.PlaneGeometry(HALF_W * 2, FLOOR_FRONT - WALL_Z)), floorMat, 0, 0, (FLOOR_FRONT + WALL_Z) / 2);
  floor.rotation.x = -Math.PI / 2;
  root.add(floor);

  // ---- walls ----
  const WALL_H = 30;
  const CREAM_TOP = 7.6;
  // Wainscot (teal tile with a chrome cap), then cream paint above.
  root.add(mesh(geo(new THREE.BoxGeometry(HALF_W * 2 + 2, 1.5, 0.3)), toon(palette.mintDeep), 0, 0.75, WALL_Z - 0.15));
  root.add(mesh(geo(new THREE.BoxGeometry(HALF_W * 2 + 2, 0.14, 0.4)), chrome, 0, 1.55, WALL_Z - 0.1));
  root.add(mesh(geo(new THREE.BoxGeometry(HALF_W * 2 + 2, CREAM_TOP - 1.6, 0.3)), toon(palette.creamShadow), 0, 1.6 + (CREAM_TOP - 1.6) / 2, WALL_Z - 0.15));
  // Above the picture rail the wall is a deep violet bulkhead, so a high camera never looks over it.
  root.add(mesh(geo(new THREE.BoxGeometry(HALF_W * 2 + 2, WALL_H - CREAM_TOP, 0.3)), toon(palette.berryDeep), 0, CREAM_TOP + (WALL_H - CREAM_TOP) / 2, WALL_Z - 0.15));
  root.add(mesh(geo(new THREE.BoxGeometry(HALF_W * 2 + 2, 0.18, 0.4)), toon(palette.sun), 0, CREAM_TOP, WALL_Z - 0.05));
  for (const sx of [-1, 1]) {
    const sideZ = (WALL_Z + 12) / 2;
    root.add(mesh(geo(new THREE.BoxGeometry(0.3, 1.5, 26)), toon(palette.mintDeep), sx * (HALF_W + 0.15), 0.75, sideZ));
    root.add(mesh(geo(new THREE.BoxGeometry(0.3, CREAM_TOP - 1.6, 26)), toon(palette.creamShadow), sx * (HALF_W + 0.15), 1.6 + (CREAM_TOP - 1.6) / 2, sideZ));
    root.add(mesh(geo(new THREE.BoxGeometry(0.3, WALL_H - CREAM_TOP, 26)), toon(palette.berryDeep), sx * (HALF_W + 0.15), CREAM_TOP + (WALL_H - CREAM_TOP) / 2, sideZ));
  }
  // A skirting of red stripe along the back wall.
  root.add(mesh(geo(new THREE.BoxGeometry(HALF_W * 2, 0.22, 0.06)), toon(palette.spaceRed), 0, 1.78, WALL_Z + 0.02));

  const bannerMat = new THREE.MeshBasicMaterial({ map: tex(bannerTexture()), transparent: true });
  disposables.push(bannerMat);
  root.add(mesh(geo(new THREE.PlaneGeometry(22, 1.375)), bannerMat, 0, 9.1, WALL_Z + 0.02));

  // ---- the window onto the highway ----
  const WIN_Y = 3.75;
  const WIN_H = 2.3;
  const WIN_W = 22;
  const view = tex(windowTexture());
  const viewMat = new THREE.MeshBasicMaterial({ map: view });
  disposables.push(viewMat);
  root.add(mesh(geo(new THREE.PlaneGeometry(WIN_W, WIN_H)), viewMat, 0, WIN_Y, WALL_Z + 0.04));
  const frameMat = toon(palette.cream);
  root.add(mesh(geo(new THREE.BoxGeometry(WIN_W + 0.5, 0.25, 0.22)), frameMat, 0, WIN_Y + WIN_H / 2 + 0.1, WALL_Z + 0.06));
  root.add(mesh(geo(new THREE.BoxGeometry(WIN_W + 0.5, 0.25, 0.22)), chrome, 0, WIN_Y - WIN_H / 2 - 0.1, WALL_Z + 0.06));
  const mullion = geo(new THREE.BoxGeometry(0.2, WIN_H, 0.2));
  for (let i = -3; i <= 3; i++) root.add(mesh(mullion, frameMat, i * (WIN_W / 6), WIN_Y, WALL_Z + 0.07));

  // ---- the neon sign ----
  const signTex = tex(
    neonTexture(
      [
        { text: "STAR", color: palette.bubble, x: 224 },
        { text: "DINER", color: palette.candy, x: 700 },
      ],
      1024,
      256,
      150,
      true,
    ),
  );
  const signMat = new THREE.MeshBasicMaterial({ map: signTex, transparent: true, depthWrite: false });
  disposables.push(signMat);
  const SIGN_W = 8.4;
  const SIGN_H = SIGN_W / 4;
  root.add(mesh(geo(new THREE.BoxGeometry(SIGN_W + 0.5, SIGN_H + 0.35, 0.12)), toon(palette.ink), 0, SIGN_Y, WALL_Z + 0.03));
  const sign = mesh(geo(new THREE.PlaneGeometry(SIGN_W, SIGN_H)), signMat, 0, SIGN_Y, WALL_Z + 0.12);
  root.add(sign);
  const signHalo = tex(haloTexture("255,79,154"));
  const signGlowMat = new THREE.SpriteMaterial({ map: signHalo, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.34 });
  disposables.push(signGlowMat);
  const signGlow = new THREE.Sprite(signGlowMat);
  signGlow.scale.set(SIGN_W * 1.7, SIGN_H * 2.6, 1);
  signGlow.position.set(0, SIGN_Y, WALL_Z + 0.5);
  root.add(signGlow);
  // A small PIE arrow sign by the pie case.
  const pieSignTex = tex(neonTexture([{ text: "PIE", color: palette.sun, x: 150 }], 512, 192, 130));
  const pieSignMat = new THREE.MeshBasicMaterial({ map: pieSignTex, transparent: true, depthWrite: false });
  disposables.push(pieSignMat);
  const PIE_X = 1.9;
  root.add(mesh(geo(new THREE.PlaneGeometry(2.0, 0.75)), pieSignMat, PIE_X + 0.3, 2.95, WALL_Z + 0.1));

  // ---- the counters: teal formica wedges with chrome rails and a lane stripe ----
  const formica = tex(formicaTexture());
  formica.repeat.set(0.55, 0.55);
  const topMat = new THREE.MeshToonMaterial({ map: formica, gradientMap: celGradient });
  disposables.push(topMat);
  const apronMat = toon(palette.spaceRed);
  const shape = new THREE.Shape();
  const far = counterHalfWidth(-COUNTER_END);
  shape.moveTo(-COUNTER_HALF_NEAR, COUNTER_BACK);
  shape.lineTo(COUNTER_HALF_NEAR, COUNTER_BACK);
  shape.lineTo(COUNTER_HALF_NEAR, 0);
  shape.lineTo(far, -COUNTER_END);
  shape.lineTo(-far, -COUNTER_END);
  shape.lineTo(-COUNTER_HALF_NEAR, 0);
  shape.closePath();
  const slabGeo = geo(new THREE.ExtrudeGeometry(shape, { depth: COUNTER_Y, bevelEnabled: false }));
  slabGeo.rotateX(Math.PI / 2);
  slabGeo.translate(0, COUNTER_Y, 0);
  const dashGeo = geo(new THREE.BoxGeometry(0.1, 0.014, 0.42));
  const capGeo = geo(new THREE.SphereGeometry(0.1, 8, 6));
  for (const lane of lanes) {
    const g = new THREE.Group();
    g.position.x = lane.x;
    root.add(g);
    g.add(mesh(slabGeo, [topMat, apronMat]));
    // Chrome bumper rails: along the slanted edges, and across the far end.
    for (const s of [-1, 1]) {
      const a = new THREE.Vector3(s * (COUNTER_HALF_NEAR - RAIL_MARGIN * 0.08), COUNTER_Y + 0.09, 0);
      const b = new THREE.Vector3(s * (far - RAIL_MARGIN * 0.08), COUNTER_Y + 0.09, -COUNTER_END);
      g.add(strut(a, b, 0.06, chrome));
      const back = new THREE.Vector3(a.x, a.y, COUNTER_BACK);
      g.add(strut(back, a, 0.06, chrome));
      g.add(mesh(capGeo, toon(lane.color), back.x, back.y, back.z));
      g.add(mesh(capGeo, toon(lane.color), b.x, b.y, b.z));
    }
    g.add(strut(new THREE.Vector3(-far, COUNTER_Y + 0.09, -COUNTER_END), new THREE.Vector3(far, COUNTER_Y + 0.09, -COUNTER_END), 0.06, chrome));
    // Chevron dashes down the middle in the player's colour: a ruler for how far a pie will slide.
    const stripe = toon(lane.color);
    for (let d = 1.4; d < COUNTER_END - 0.5; d += 0.9) {
      g.add(mesh(dashGeo, stripe, 0, COUNTER_Y + 0.008, -d));
    }
    // The chrome-trimmed apron lip.
    const lip = new THREE.Mesh(geo(new THREE.BoxGeometry(COUNTER_HALF_NEAR * 2 + 0.16, 0.12, 0.1)), chrome);
    lip.position.set(0, COUNTER_Y - 0.06, COUNTER_BACK + 0.04);
    g.add(lip);
  }

  // ---- the pie case (with steam) ----
  const caseG = new THREE.Group();
  caseG.position.set(PIE_X, 0, WALL_Z + 0.9);
  root.add(caseG);
  caseG.add(mesh(geo(new THREE.BoxGeometry(4.6, 0.9, 1.3)), toon(palette.spaceRed), 0, 0.45, 0));
  caseG.add(mesh(geo(new THREE.BoxGeometry(4.8, 0.1, 1.45)), chrome, 0, 0.92, 0));
  const glassMat = new THREE.MeshBasicMaterial({ color: hex(palette.white), transparent: true, opacity: 0.2, depthWrite: false });
  disposables.push(glassMat);
  caseG.add(mesh(geo(new THREE.BoxGeometry(4.5, 0.85, 1.25)), glassMat, 0, 1.4, 0));
  caseG.add(mesh(geo(new THREE.BoxGeometry(4.6, 0.06, 1.35)), chrome, 0, 1.85, 0));
  const pieColors = [palette.spaceRed, palette.spaceBlue, palette.sun, palette.leaf, palette.sunDeep, palette.candy];
  const pieTinGeo = geo(new THREE.CylinderGeometry(0.34, 0.3, 0.1, 18));
  const pieTopGeo = geo(new THREE.CylinderGeometry(0.29, 0.29, 0.05, 18));
  for (let i = 0; i < 6; i++) {
    const px = -1.8 + i * 0.72;
    caseG.add(mesh(pieTinGeo, chrome, px, 1.02, 0.1));
    caseG.add(mesh(pieTopGeo, toon(pieColors[i]), px, 1.09, 0.1));
  }
  const caseGlowMat = new THREE.SpriteMaterial({ map: tex(haloTexture("255,181,71")), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.5 });
  disposables.push(caseGlowMat);
  const caseGlow = new THREE.Sprite(caseGlowMat);
  caseGlow.scale.set(6.5, 3.2, 1);
  caseGlow.position.set(0, 1.4, 0.4);
  caseG.add(caseGlow);

  // Steam: soft puffs that curl up off the hot pies and fade.
  const steamTex = tex(haloTexture("255,255,255"));
  const STEAMS = 14;
  const steams: { sprite: THREE.Sprite; mat: THREE.SpriteMaterial; x: number; phase: number; speed: number; size: number }[] = [];
  for (let i = 0; i < STEAMS; i++) {
    const mat = new THREE.SpriteMaterial({ map: steamTex, transparent: true, depthWrite: false, opacity: 0 });
    disposables.push(mat);
    const sprite = new THREE.Sprite(mat);
    caseG.add(sprite);
    steams.push({ sprite, mat, x: -1.8 + (i % 6) * 0.72 + ((i * 7) % 5) * 0.05, phase: (i * 0.173) % 1, speed: 0.22 + ((i * 3) % 4) * 0.045, size: 0.55 + ((i * 5) % 3) * 0.18 });
  }

  // ---- the jukebox ----
  const juke = new THREE.Group();
  const JUKE_X = -4.7;
  juke.position.set(JUKE_X, 0, WALL_Z + 0.75);
  root.add(juke);
  juke.add(mesh(geo(new THREE.BoxGeometry(1.7, 2.0, 0.9)), toon(palette.spaceRed), 0, 1.0, 0));
  const arch = mesh(geo(new THREE.CylinderGeometry(0.85, 0.85, 0.9, 20, 1, false, 0, Math.PI)), toon(palette.spaceRed), 0, 2.0, 0);
  arch.rotation.x = Math.PI / 2;
  juke.add(arch);
  const panelTex = tex(jukeboxPanelTexture());
  const panelMat = new THREE.MeshBasicMaterial({ map: panelTex });
  disposables.push(panelMat);
  const panel = mesh(geo(new THREE.PlaneGeometry(1.2, 1.5)), panelMat, 0, 1.45, 0.47);
  juke.add(panel);
  juke.add(mesh(geo(new THREE.BoxGeometry(1.34, 1.64, 0.06)), chrome, 0, 1.45, 0.43));
  // Glowing arch tubes that chase around the top.
  const tubeA = basic(palette.sun);
  const tubeB = basic(palette.candy);
  const tubeC = basic(palette.bubble);
  const tubeMats = [tubeA, tubeB, tubeC];
  const tubeGeo = geo(new THREE.TorusGeometry(0.72, 0.05, 6, 24, Math.PI));
  const tubes: THREE.Mesh[] = [];
  for (let i = 0; i < 3; i++) {
    const t = mesh(tubeGeo, tubeMats[i], 0, 1.95, 0.47);
    t.scale.setScalar(1 - i * 0.18);
    juke.add(t);
    tubes.push(t);
  }
  juke.add(mesh(geo(new THREE.BoxGeometry(1.2, 0.34, 0.06)), toon(palette.ink), 0, 0.5, 0.47));
  for (let i = 0; i < 5; i++) juke.add(mesh(geo(new THREE.CircleGeometry(0.05, 8)), tubeMats[i % 3], -0.4 + i * 0.2, 0.5, 0.51));
  juke.add(mesh(geo(new THREE.BoxGeometry(1.8, 0.16, 1.0)), chrome, 0, 0.08, 0));
  const jukeGlowMat = new THREE.SpriteMaterial({ map: tex(haloTexture("255,79,154")), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.3 });
  disposables.push(jukeGlowMat);
  const jukeGlow = new THREE.Sprite(jukeGlowMat);
  jukeGlow.scale.set(4.2, 4.2, 1);
  jukeGlow.position.set(0, 1.5, 0.9);
  juke.add(jukeGlow);
  // Music notes drifting up from the jukebox.
  const noteTex = tex(noteTexture());
  const NOTES = 6;
  const noteColors = [palette.sun, palette.candy, palette.mint, palette.bubble, palette.sun, palette.lava];
  const notes: { sprite: THREE.Sprite; mat: THREE.SpriteMaterial; phase: number; dx: number }[] = [];
  for (let i = 0; i < NOTES; i++) {
    const mat = new THREE.SpriteMaterial({ map: noteTex, color: hex(noteColors[i]), transparent: true, depthWrite: false, opacity: 0 });
    disposables.push(mat);
    const sprite = new THREE.Sprite(mat);
    sprite.scale.setScalar(0.5);
    juke.add(sprite);
    notes.push({ sprite, mat, phase: i / NOTES, dx: (i % 2 === 0 ? -1 : 1) * (0.25 + (i % 3) * 0.12) });
  }

  // ---- a wall clock and a string of pennants ----
  const clockTex = tex(clockTexture());
  const clockMat = new THREE.MeshBasicMaterial({ map: clockTex, transparent: true });
  disposables.push(clockMat);
  const CLOCK_X = -1.4;
  const CLOCK_Y = 2.95;
  root.add(mesh(geo(new THREE.CircleGeometry(0.62, 28)), clockMat, CLOCK_X, CLOCK_Y, WALL_Z + 0.1));
  const hands = new THREE.Group();
  hands.position.set(CLOCK_X, CLOCK_Y, WALL_Z + 0.13);
  const pivotGeo = geo(new THREE.BoxGeometry(0.05, 0.4, 0.02).translate(0, 0.2, 0));
  const hour = mesh(pivotGeo, basic(palette.ink));
  hour.scale.y = 0.65;
  const minute = mesh(pivotGeo, basic(palette.spaceRed));
  minute.position.z = 0.01;
  hands.add(hour, minute);
  root.add(hands);

  const PENNANTS = 26;
  const pennantGeo = geo(new THREE.ConeGeometry(0.26, 0.62, 3));
  const pennantMat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  disposables.push(pennantMat);
  const pennants = new THREE.InstancedMesh(pennantGeo, pennantMat, PENNANTS);
  pennants.frustumCulled = false;
  pennants.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const tint = new THREE.Color();
  const pennantColors = [palette.spaceRed, palette.cream, palette.bubble, palette.sun, palette.candy];
  for (let i = 0; i < PENNANTS; i++) pennants.setColorAt(i, tint.set(pennantColors[i % pennantColors.length]));
  root.add(pennants);
  const dummy = new THREE.Object3D();
  const stringGeoPts = new THREE.CatmullRomCurve3([new THREE.Vector3(-9.5, 5.4, WALL_Z + 0.7), new THREE.Vector3(0, 4.85, WALL_Z + 0.9), new THREE.Vector3(9.5, 5.4, WALL_Z + 0.7)]);
  root.add(mesh(geo(new THREE.TubeGeometry(stringGeoPts, 32, 0.02, 4)), basic(palette.ink)));
  const placePennants = (t: number): void => {
    for (let i = 0; i < PENNANTS; i++) {
      const p = stringGeoPts.getPoint((i + 0.5) / PENNANTS);
      dummy.position.set(p.x, p.y - 0.3, p.z);
      dummy.rotation.set(Math.PI, 0, Math.sin(t * 1.6 + i * 0.7) * 0.16);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      pennants.setMatrixAt(i, dummy.matrix);
    }
    pennants.instanceMatrix.needsUpdate = true;
  };
  placePennants(0);

  // ---- red vinyl booths down the sides (a wide screen shows them) ----
  const vinyl = toon(palette.spaceRed);
  const tableMat = toon(palette.cream);
  const boothBase = geo(new THREE.BoxGeometry(1.0, 0.6, 2.4));
  const boothBack = geo(new THREE.BoxGeometry(0.28, 1.2, 2.4));
  const tableTop = geo(new THREE.BoxGeometry(1.4, 0.1, 1.5));
  const tableLeg = geo(new THREE.CylinderGeometry(0.07, 0.07, 0.75, 6));
  for (const sx of [-1, 1]) {
    for (const z of [-3.2, -8.4]) {
      const bx = sx * 9.2;
      root.add(mesh(boothBase, vinyl, bx, 0.3, z));
      root.add(mesh(boothBack, vinyl, sx * 9.9, 0.9, z));
      root.add(mesh(tableTop, tableMat, sx * 7.7, 0.78, z));
      root.add(mesh(tableLeg, chrome, sx * 7.7, 0.38, z));
    }
    // A pendant lamp over each pair.
    root.add(mesh(geo(new THREE.SphereGeometry(0.34, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2)), toon(palette.lampWarm), sx * 8.2, 3.6, -5.8));
  }

  let flareT = 0;
  let kick = 0;

  return {
    update(t, dt) {
      if (flareT > 0) flareT = Math.max(0, flareT - dt);
      kick = Math.max(0, kick - dt * 3.2);
      const flare = Math.min(1, flareT / 0.4);

      // Neon: a steady hum, a rare stutter, a flash on a served pie.
      const stutter = Math.sin(t * 37) * Math.sin(t * 2.3 + 1) > 0.97 ? 0.55 : 1;
      const hum = 0.9 + 0.06 * Math.sin(t * 9) + 0.1 * flare;
      signMat.color.setScalar(Math.min(1.2, hum * stutter));
      signGlowMat.opacity = (0.3 + 0.06 * Math.sin(t * 3)) * stutter + 0.35 * flare;
      signGlow.scale.set(SIGN_W * (1.7 + 0.25 * flare), SIGN_H * (2.6 + 0.4 * flare), 1);
      pieSignMat.color.setScalar(0.85 + 0.15 * Math.sin(t * 5.3 + 1));

      // Jukebox: pulse on the beat (two per second), chase the arch tubes.
      const beat = Math.pow(Math.max(0, Math.sin(t * Math.PI * 2)), 6);
      const pulse = Math.min(1, beat + kick);
      jukeGlowMat.opacity = 0.2 + 0.4 * pulse + 0.3 * flare;
      juke.scale.set(1 + 0.02 * pulse, 1 + 0.035 * pulse, 1);
      tubes.forEach((tube, i) => {
        const on = (Math.floor(t * 4) + i) % 3 === 0;
        tube.scale.setScalar((1 - i * 0.18) * (on ? 1.05 : 1));
      });
      tubeA.color.set(hex(Math.floor(t * 4) % 2 === 0 ? palette.sun : palette.sunDeep));
      tubeB.color.set(hex(Math.floor(t * 4) % 2 === 0 ? palette.candy : palette.candyDeep));
      panelMat.color.setScalar(0.82 + 0.18 * pulse);
      notes.forEach((n) => {
        const u = mod(t * 0.28 + n.phase, 1);
        n.sprite.position.set(n.dx + Math.sin(u * 9 + n.phase * 6) * 0.22, 2.4 + u * 2.4, 0.5);
        n.mat.opacity = Math.min(1, u * 5, (1 - u) * 2.2);
        n.sprite.scale.setScalar(0.38 + 0.2 * u);
      });

      // Steam off the pies.
      for (const s of steams) {
        const u = mod(t * s.speed + s.phase, 1);
        s.sprite.position.set(s.x + Math.sin(u * 7 + s.phase * 9) * 0.22, 1.25 + u * 1.7, 0.1);
        s.mat.opacity = 0.5 * Math.min(1, u * 4) * (1 - u);
        s.sprite.scale.setScalar(s.size * (0.7 + u * 1.4));
      }
      caseGlowMat.opacity = 0.42 + 0.06 * Math.sin(t * 2.4);

      // The wall clock keeps good time.
      minute.rotation.z = -(t / 60) * Math.PI * 2 * 12;
      hour.rotation.z = -(t / 60 / 12) * Math.PI * 2 * 12 - 0.9;
      placePennants(t);
    },
    flare() {
      flareT = 1.1;
    },
    beat() {
      kick = 1;
    },
    dispose() {
      for (const g of geos) g.dispose();
      for (const m of toonCache.values()) m.dispose();
      for (const m of basicCache.values()) m.dispose();
      for (const d of disposables) d.dispose();
      for (const t of textures) t.dispose();
      pennants.dispose();
      root.removeFromParent();
    },
  };
}
