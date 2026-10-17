/**
 * SUPER STAR PARTY — the Fizzy Fairground diorama. The board is an island:
 * a checkered grass plateau with a rounded grass lip, an ink outline band
 * and layered earth cliffs, standing in a shallow-to-deep sea with breathing
 * shoreline foam, under a gradient sky dome, with a few small islets on the
 * horizon. This is what turns the board from a tablecloth in a void into a
 * party-board map.
 *
 * Fixed design data: the coastline is a superellipse with a deterministic
 * wobble (no rng of any kind). Static meshes, plus three cheap animations
 * (sea ripple scroll, foam breathing, sky tint) driven from the board clock.
 * Sea and cliffs are toon-lit, so the day -> dusk -> night rig tints them;
 * the sky dome takes its colours from lively/night.ts when it runs.
 */
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { palette } from "../config/palette";
import { settings } from "../config/settings";
import type { BoardTextures } from "./boardTextures";
import type { Prop } from "./boardScenery";

const I = settings.board.island;

/** Coastline of the carnival island (ground-plane x/z, world units). */
export interface IslandShape {
  cx: number;
  cz: number;
  /** Coast radius from the island centre at heading `a` (atan2(dz, dx)). */
  radiusAt(a: number): number;
  /** Signed distance-ish to the coast along the radial: > 0 inside. */
  inset(x: number, z: number): number;
}

export function islandShape(): IslandShape {
  const cx = 0;
  const cz = I.centerZ;
  const radiusAt = (a: number): number => {
    const c = Math.abs(Math.cos(a)) / I.halfX;
    const s = Math.abs(Math.sin(a)) / I.halfZ;
    const base = 1 / Math.pow(Math.pow(c, I.power) + Math.pow(s, I.power), 1 / I.power);
    const wob = 1 + I.wobble * (0.6 * Math.sin(3 * a + 0.7) + 0.4 * Math.sin(5 * a + 2.1) + 0.25 * Math.sin(9 * a + 0.4));
    return base * wob;
  };
  return {
    cx,
    cz,
    radiusAt,
    inset(x: number, z: number): number {
      const dx = x - cx;
      const dz = z - cz;
      return radiusAt(Math.atan2(dz, dx)) - Math.hypot(dx, dz);
    },
  };
}

/** Colour every vertex of a geometry (RGB, or RGBA with alpha per vertex). */
function paintAll(geo: THREE.BufferGeometry, color: string): THREE.BufferGeometry {
  const c = new THREE.Color(color);
  const n = geo.getAttribute("position").count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(arr, 3));
  return geo;
}

const SEG = 180; // coastline samples

/** Ring points at radial offset `off` (outward > 0) from the coast. */
function ring(shape: IslandShape, off: number): { x: number; z: number; nx: number; nz: number }[] {
  const out: { x: number; z: number; nx: number; nz: number }[] = [];
  for (let i = 0; i < SEG; i++) {
    const a = (i / SEG) * Math.PI * 2;
    const r = shape.radiusAt(a) + off;
    const nx = Math.cos(a);
    const nz = Math.sin(a);
    out.push({ x: shape.cx + nx * r, z: shape.cz + nz * r, nx, nz });
  }
  return out;
}

/** Ground height at (x, z) on the island top (0 off the hills). */
export type HeightFn = (x: number, z: number) => number;

/**
 * Grass plateau: a polar grid from the centre out to the coastline, lifted by
 * the board terrain (Starlight Rise). The outer ring is the coast itself, so
 * it meets the cliff band exactly. UVs are world space for the 2u checker.
 */
function buildTop(shape: IslandShape, kit: BoardTextures, heightAt: HeightFn): THREE.Mesh {
  const RINGS = 44;
  const pos: number[] = [shape.cx, heightAt(shape.cx, shape.cz), shape.cz];
  for (let r = 1; r <= RINGS; r++) {
    const f = r / RINGS;
    for (let i = 0; i < SEG; i++) {
      const a = (i / SEG) * Math.PI * 2;
      const rad = shape.radiusAt(a) * f;
      const x = shape.cx + Math.cos(a) * rad;
      const z = shape.cz + Math.sin(a) * rad;
      pos.push(x, r === RINGS ? 0 : heightAt(x, z), z);
    }
  }
  const idx: number[] = [];
  const v = (r: number, i: number): number => 1 + (r - 1) * SEG + (i % SEG);
  for (let i = 0; i < SEG; i++) idx.push(0, v(1, i + 1), v(1, i));
  for (let r = 1; r < RINGS; r++) {
    for (let i = 0; i < SEG; i++) {
      idx.push(v(r, i), v(r, i + 1), v(r + 1, i), v(r + 1, i), v(r, i + 1), v(r + 1, i + 1));
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  const uv: number[] = [];
  // One texture tile = two checker squares of groundTile each.
  const tile = settings.board.groundTile * 2;
  for (let i = 0; i < pos.length; i += 3) uv.push(pos[i] / tile, -pos[i + 2] / tile);
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  // Slopes print a shade darker than the flat grass, so a hill reads as a
  // raised tier from the high party camera, not just as lighting.
  const col = new Float32Array((pos.length / 3) * 3);
  const nrm = geo.getAttribute("normal");
  for (let k = 0; k < nrm.count; k++) {
    const tilt = 1 - nrm.getY(k);
    const shade = 1 - Math.min(0.22, tilt * 1.6);
    col[k * 3] = shade;
    col[k * 3 + 1] = shade;
    col[k * 3 + 2] = shade;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  const grass = kit.grass;
  grass.repeat.set(1, 1);
  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshToonMaterial({ color: palette.white, map: grass, gradientMap: kit.grad, vertexColors: true })
  );
  mesh.name = "island:top";
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * Cliff skirt. Each band is its own strip of quads with a flat colour, so the
 * bands stay hard-edged like a printed cartoon: rounded grass lip, ink outline,
 * warm dirt, darker dirt, stone below the waterline.
 */
function buildCliff(shape: IslandShape, kit: BoardTextures): THREE.Mesh {
  const D = I.cliffDepth;
  // [outward offset, y] pairs; each consecutive pair is one band.
  const bands: Array<{ a: [number, number]; b: [number, number]; color: string }> = [
    { a: [0, 0], b: [0.2, -0.08], color: palette.grassA },
    { a: [0.2, -0.08], b: [0.24, -0.26], color: palette.grassB },
    { a: [0.24, -0.26], b: [0.2, -0.4], color: palette.ink },
    { a: [0.2, -0.4], b: [0.06, -0.95], color: palette.cliffDirt },
    { a: [0.06, -0.95], b: [-0.04, -1.08], color: palette.cliffDirtDark },
    { a: [-0.04, -1.08], b: [-0.12, -1.7], color: palette.cliffDirt },
    { a: [-0.12, -1.7], b: [-0.3, -D], color: palette.cliffStone },
  ];
  const parts: THREE.BufferGeometry[] = [];
  for (const band of bands) {
    const ra = ring(shape, band.a[0]);
    const rb = ring(shape, band.b[0]);
    const pos: number[] = [];
    for (let i = 0; i < SEG; i++) {
      pos.push(ra[i].x, band.a[1], ra[i].z);
      pos.push(rb[i].x, band.b[1], rb[i].z);
    }
    const idx: number[] = [];
    for (let i = 0; i < SEG; i++) {
      const j = (i + 1) % SEG;
      const a0 = i * 2;
      const b0 = i * 2 + 1;
      const a1 = j * 2;
      const b1 = j * 2 + 1;
      idx.push(a0, a1, b0, b0, a1, b1);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    parts.push(paintAll(geo.toNonIndexed(), band.color));
    geo.dispose();
  }
  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  if (!merged) throw new Error("[SSP] island cliff merge failed");
  const mesh = new THREE.Mesh(
    merged,
    new THREE.MeshToonMaterial({ color: palette.white, vertexColors: true, gradientMap: kit.grad, side: THREE.DoubleSide })
  );
  mesh.name = "island:cliff";
  mesh.receiveShadow = true;
  return mesh;
}

/** Wavy ripple marks on the sea (tiles). Linear + mipmaps: it is seen at a glance angle. */
export function rippleTexture(): THREE.CanvasTexture {
  const S = 128;
  const c = document.createElement("canvas");
  c.width = S;
  c.height = S;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = palette.sea;
  ctx.fillRect(0, 0, S, S);
  ctx.strokeStyle = palette.bubble;
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  const marks: [number, number, number][] = [
    [18, 22, 26],
    [74, 40, 30],
    [36, 78, 22],
    [96, 98, 26],
    [8, 112, 18],
  ];
  for (const [x, y, w] of marks) {
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + w / 4, y - 5, x + w / 2, y);
    ctx.quadraticCurveTo(x + (3 * w) / 4, y + 5, x + w, y);
    ctx.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

/** Shallow lagoon band: light water at the coast fading into the open sea. */
function buildShallows(shape: IslandShape, kit: BoardTextures): THREE.Mesh {
  const inner = ring(shape, -0.4);
  const outer = ring(shape, 5.5);
  const pos: number[] = [];
  const col: number[] = [];
  const shallow = new THREE.Color(palette.bubble);
  for (let i = 0; i < SEG; i++) {
    pos.push(inner[i].x, 0, inner[i].z, outer[i].x, 0, outer[i].z);
    col.push(shallow.r, shallow.g, shallow.b, 0.95, shallow.r, shallow.g, shallow.b, 0);
  }
  const idx: number[] = [];
  for (let i = 0; i < SEG; i++) {
    const j = (i + 1) % SEG;
    idx.push(i * 2, j * 2, i * 2 + 1, i * 2 + 1, j * 2, j * 2 + 1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 4));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(new Array(pos.length).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  geo.setIndex(idx);
  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshToonMaterial({
      color: palette.white,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      gradientMap: kit.grad,
    })
  );
  mesh.position.y = I.seaY + 0.02;
  mesh.name = "island:shallows";
  mesh.renderOrder = 1;
  return mesh;
}

/**
 * Foam: a solid ring hugging the cliff foot and a second ring that rolls out
 * and fades, over and over. Positions are rewritten in place (a few hundred
 * vertices), so update() allocates nothing.
 */
function buildFoam(shape: IslandShape): { mesh: THREE.Mesh; update: (t: number) => void; tint: (horizon: number) => void } {
  const base = ring(shape, 0);
  // Two strips x (inner, outer) x SEG vertices.
  const n = SEG * 4;
  const pos = new Float32Array(n * 3);
  const col = new Float32Array(n * 4);
  const idx: number[] = [];
  for (let s = 0; s < 2; s++) {
    const o = s * SEG * 2;
    for (let i = 0; i < SEG; i++) {
      const j = (i + 1) % SEG;
      idx.push(o + i * 2, o + j * 2, o + i * 2 + 1, o + i * 2 + 1, o + j * 2, o + j * 2 + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(pos, 3);
  const colAttr = new THREE.BufferAttribute(col, 4);
  posAttr.setUsage(THREE.DynamicDrawUsage);
  colAttr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute("position", posAttr);
  geo.setAttribute("color", colAttr);
  geo.setIndex(idx);
  const foam = new THREE.Color(palette.foam);
  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false })
  );
  mesh.position.y = I.seaY + 0.05;
  mesh.name = "island:foam";
  mesh.renderOrder = 2;
  mesh.frustumCulled = false;

  const strip = (s: number, r0: number, r1: number, a0: number, a1: number, wob: number, t: number): void => {
    const o = s * SEG * 2;
    for (let i = 0; i < SEG; i++) {
      const b = base[i];
      // A slow travelling wobble so the foam line never reads as a stamp.
      const w = wob * Math.sin(i * 0.37 + t * 1.3);
      const v0 = (o + i * 2) * 3;
      const v1 = (o + i * 2 + 1) * 3;
      pos[v0] = b.x + b.nx * (r0 + w);
      pos[v0 + 1] = 0;
      pos[v0 + 2] = b.z + b.nz * (r0 + w);
      pos[v1] = b.x + b.nx * (r1 + w);
      pos[v1 + 1] = 0;
      pos[v1 + 2] = b.z + b.nz * (r1 + w);
      const c0 = (o + i * 2) * 4;
      const c1 = (o + i * 2 + 1) * 4;
      col[c0] = foam.r;
      col[c0 + 1] = foam.g;
      col[c0 + 2] = foam.b;
      col[c0 + 3] = a0;
      col[c1] = foam.r;
      col[c1 + 1] = foam.g;
      col[c1 + 2] = foam.b;
      col[c1 + 3] = a1;
    }
  };
  const update = (t: number): void => {
    const breathe = 0.5 + 0.5 * Math.sin(t * I.foamPulse);
    strip(0, -0.1, 0.55 + 0.2 * breathe, 0.95, 0.75, 0.05, t);
    // Rolling wave: 0 -> 1 every period, out from the coast, fading as it goes.
    const u = (t * I.foamPulse * 0.25) % 1;
    const r = 0.9 + u * 2.6;
    const a = 0.75 * (1 - u) * Math.min(1, u * 5);
    strip(1, r, r + 0.35, a, a * 0.2, 0.12, t);
    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;
  };
  update(0);
  geo.computeBoundingSphere();
  // Foam is unlit, so it follows the sky instead: white by day, dimmed and
  // tinted toward the horizon at dusk and night.
  const mat = mesh.material as THREE.MeshBasicMaterial;
  const dayLum = luminance(new THREE.Color(palette.skyHorizon));
  const hz = new THREE.Color();
  const tint = (horizon: number): void => {
    hz.setHex(horizon);
    const k = Math.min(1, luminance(hz) / dayLum);
    mat.color.set(palette.white).lerp(hz, 0.5 * (1 - k)).multiplyScalar(0.35 + 0.65 * k);
  };
  return { mesh, update, tint };
}

function luminance(c: THREE.Color): number {
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

/** Gradient sky dome: zenith over a pale horizon that meets the sea. */
export function buildSkyDome(): { mesh: THREE.Mesh; set: (top: number, horizon: number) => void } {
  const geo = new THREE.SphereGeometry(I.skyRadius, 32, 16);
  const uniforms = {
    uTop: { value: new THREE.Color(palette.skyTop) },
    uHorizon: { value: new THREE.Color(palette.skyHorizon) },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uTop;
      uniform vec3 uHorizon;
      varying vec3 vDir;
      void main() {
        float h = clamp(vDir.y, 0.0, 1.0);
        // Two soft bands, not a smooth airbrush: a wide pale horizon, then sky.
        float k = smoothstep(0.02, 0.38, h);
        gl_FragColor = vec4(mix(uHorizon, uTop, k), 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = "island:sky";
  mesh.renderOrder = -10;
  mesh.frustumCulled = false;
  return {
    mesh,
    set(top: number, horizon: number) {
      uniforms.uTop.value.setHex(top);
      uniforms.uHorizon.value.setHex(horizon);
    },
  };
}

/** A handful of small tree-topped islets out at sea. One merged mesh. */
function buildIslets(kit: BoardTextures, shape: IslandShape): THREE.Mesh {
  const spots: [number, number, number][] = [
    // angle (rad), distance beyond the coast, scale
    [-2.2, 26, 1.4],
    [-0.9, 34, 1.1],
    [0.35, 30, 1.6],
    [1.9, 40, 1.2],
    [2.9, 28, 1.0],
    [-1.55, 52, 2.0],
  ];
  const parts: THREE.BufferGeometry[] = [];
  for (const [a, d, s] of spots) {
    const r = shape.radiusAt(a) + d;
    const x = shape.cx + Math.cos(a) * r;
    const z = shape.cz + Math.sin(a) * r;
    const add = (g: THREE.BufferGeometry, color: string, px: number, py: number, pz: number): void => {
      g.scale(s, s, s);
      g.translate(x + px * s, I.seaY + py * s, z + pz * s);
      const flat = g.index ? g.toNonIndexed() : g;
      if (flat !== g) g.dispose();
      parts.push(paintAll(flat, color));
    };
    add(new THREE.CylinderGeometry(2.6, 3.1, 1.6, 12), palette.cliffDirt, 0, 0.2, 0);
    add(new THREE.CylinderGeometry(2.7, 2.6, 0.35, 12), palette.grassA, 0, 1.1, 0);
    add(new THREE.CylinderGeometry(0.16, 0.22, 1.4, 6), palette.bark, 0.4, 1.9, -0.2);
    add(new THREE.IcosahedronGeometry(1.0, 0), palette.leaf, 0.4, 2.9, -0.2);
    add(new THREE.IcosahedronGeometry(0.7, 0), palette.leafDeep, -1.1, 1.8, 0.6);
    add(new THREE.CylinderGeometry(3.4, 3.4, 0.05, 14), palette.foam, 0, 0.0, 0);
  }
  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  if (!merged) throw new Error("[SSP] islet merge failed");
  merged.computeVertexNormals();
  const mesh = new THREE.Mesh(
    merged,
    new THREE.MeshToonMaterial({ color: palette.white, vertexColors: true, gradientMap: kit.grad })
  );
  mesh.name = "island:islets";
  return mesh;
}

export interface Island extends Prop {
  shape: IslandShape;
  /** Sky dome tint (0xRRGGBB zenith and horizon). */
  setSky(top: number, horizon: number): void;
  /** Free the textures the island owns (meshes go with the board traversal). */
  dispose(): void;
}

/** Build the whole diorama. Add `root` to the board group. */
export function buildIsland(kit: BoardTextures, heightAt: HeightFn = () => 0): Island {
  const shape = islandShape();
  const root = new THREE.Group();
  root.name = "island";

  root.add(buildTop(shape, kit, heightAt));
  root.add(buildCliff(shape, kit));

  const rip = rippleTexture();
  rip.repeat.set(I.seaRadius / 6, I.seaRadius / 6);
  const seaGeo = new THREE.CircleGeometry(I.seaRadius, 64);
  seaGeo.rotateX(-Math.PI / 2);
  const sea = new THREE.Mesh(seaGeo, new THREE.MeshToonMaterial({ color: palette.white, map: rip, gradientMap: kit.grad }));
  sea.position.set(shape.cx, I.seaY, shape.cz);
  sea.name = "island:sea";
  sea.receiveShadow = true;
  root.add(sea);

  root.add(buildShallows(shape, kit));
  const foam = buildFoam(shape);
  root.add(foam.mesh);
  root.add(buildIslets(kit, shape));

  const sky = buildSkyDome();
  root.add(sky.mesh);

  return {
    root,
    shape,
    setSky(top: number, horizon: number) {
      sky.set(top, horizon);
      foam.tint(horizon);
    },
    update(t: number) {
      rip.offset.set(t * I.seaDrift, t * I.seaDrift * 0.6);
      foam.update(t);
    },
    dispose() {
      rip.dispose();
    },
  };
}
