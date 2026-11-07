/**
 * SUPER STAR PARTY — Downtown's space tiles: flush octagon plates inlaid in
 * the street, every space in ONE instanced draw (instance i = space i).
 *
 * Each plate is a low slab: a face showing the space type's disk art (the
 * same icons and patterns as the carnival disks, packed into one atlas; a
 * per-instance cell picks the type), a bevel and short sides in the type's
 * deep rim colour (instanceColor). The face stands TOP above the ground, over
 * the lane decal (settings.board.laneY) and under the per-space props; the
 * slab's foot is sunk into the pavement. About 40 triangles a tile.
 *
 * Landings pose one instance's matrix (dipInstance, driven by landFx): a flat
 * plate cannot sink without vanishing into the road, so a dip reads as a
 * press (the plate shrinks a little) and a landing as a squash that spreads it.
 */
import * as THREE from "three";
import { settings } from "../../config/settings";
import { palette } from "../../config/palette";
import type { SpaceType } from "../../core/game";
import { groundHeight } from "../boardData";
import { DISK_STYLE } from "../boardTextures";
import type { BoardThemeHost, ThemeTiles } from "../boardTheme";

/** Face height above the ground (the lane decal is at 0.01). */
const TOP = 0.035;
/** Outer bevel edge height, and the slab's sunk foot. */
const EDGE = 0.022;
const FOOT = -0.02;
/** Circumradii: the textured face, the bevel round it (inradius ~1.12, like the old rims), the foot. */
const R_FACE = settings.tileRadius * 1.07;
const R_EDGE = settings.tileRadius * 1.155;
/**
 * The underside tapers in to the foot, so from above it faces away and is
 * culled: the lane decal is a little see-through, and upright sides showed
 * through it whenever a press lowered the plate.
 */
const R_FOOT = R_EDGE * 0.8;
/** Face circumradius in cell UV units (0.5 = the cell edge). */
const UV_FACE = 0.47;
/** Lowest the bevel edge may go when pressed: stays over the lane decal. */
const MIN_EDGE = 0.012;
/** Plate shrink per world unit of dip (a 0.08 hop dip presses it to 0.9). */
const PRESS_SHRINK = 1.25;

const COLS = 4;
const ROWS = 2;
const CELL = 256;
const TYPES = Object.keys(DISK_STYLE) as SpaceType[];

/** Octagon corner k: edges run along the streets (x and z). */
const corner = (k: number, r: number): [number, number] => {
  const a = Math.PI / 8 + (k * Math.PI) / 4;
  return [Math.cos(a) * r, Math.sin(a) * r];
};

/** One octagon slab: textured face fan, rim-coloured bevel and sides. */
function slabGeometry(): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const rim: number[] = [];
  const k = UV_FACE / R_FACE;
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  const vtx = (p: THREE.Vector3, isRim: number): void => {
    pos.push(p.x, p.y, p.z);
    // Canvas top (v = 1) is north (-z), as on the carnival disks; rims sample a white cell corner.
    if (isRim) uv.push(0.02, 0.02);
    else uv.push(0.5 + p.x * k, 0.5 - p.z * k);
    rim.push(isRim);
  };
  /** Triangle wound to face away from the slab's centre line (or up, for the top). */
  const tri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, out: THREE.Vector3, isRim: number): void => {
    ab.subVectors(b, a);
    ac.subVectors(c, a);
    const flip = ab.cross(ac).dot(out) < 0;
    vtx(a, isRim);
    vtx(flip ? c : b, isRim);
    vtx(flip ? b : c, isRim);
  };
  const up = new THREE.Vector3(0, 1, 0);
  const centre = new THREE.Vector3(0, TOP, 0);
  const out = new THREE.Vector3();
  const f0 = new THREE.Vector3();
  const f1 = new THREE.Vector3();
  const e0 = new THREE.Vector3();
  const e1 = new THREE.Vector3();
  const b0 = new THREE.Vector3();
  const b1 = new THREE.Vector3();
  for (let i = 0; i < 8; i++) {
    const [fx0, fz0] = corner(i, R_FACE);
    const [fx1, fz1] = corner(i + 1, R_FACE);
    const [ex0, ez0] = corner(i, R_EDGE);
    const [ex1, ez1] = corner(i + 1, R_EDGE);
    const [bx0, bz0] = corner(i, R_FOOT);
    const [bx1, bz1] = corner(i + 1, R_FOOT);
    f0.set(fx0, TOP, fz0);
    f1.set(fx1, TOP, fz1);
    e0.set(ex0, EDGE, ez0);
    e1.set(ex1, EDGE, ez1);
    b0.set(bx0, FOOT, bz0);
    b1.set(bx1, FOOT, bz1);
    tri(centre, f0, f1, up, 0);
    out.set((ex0 + ex1) / 2, 0.6, (ez0 + ez1) / 2); // bevel: outward and up
    tri(f0, e0, e1, out, 1);
    tri(f0, e1, f1, out, 1);
    out.set((ex0 + ex1) / 2, -1, (ez0 + ez1) / 2); // underside: outward and down
    tri(e0, b0, b1, out, 1);
    tri(e0, b1, e1, out, 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute("aRim", new THREE.Float32BufferAttribute(rim, 1));
  g.computeVertexNormals(); // non-indexed: flat per face
  return g;
}

/** The space types' faces in one atlas: the kit's disk art inside an inked octagon. */
function faceAtlas(kit: BoardThemeHost["kit"]): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = COLS * CELL;
  c.height = ROWS * CELL;
  const ctx = c.getContext("2d")!;
  const octagon = (r: number): void => {
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const [x, y] = corner(i, r);
      if (i === 0) ctx.moveTo(32 + x, 32 + y);
      else ctx.lineTo(32 + x, 32 + y);
    }
    ctx.closePath();
  };
  TYPES.forEach((type, t) => {
    ctx.save();
    ctx.translate((t % COLS) * CELL, Math.floor(t / COLS) * CELL);
    ctx.scale(CELL / 64, CELL / 64); // the kit's 64-unit disk space
    ctx.fillStyle = palette.white; // cell corners: what the rims sample
    ctx.fillRect(0, 0, 64, 64);
    const R = UV_FACE * 64;
    octagon(R);
    ctx.fillStyle = DISK_STYLE[type].base;
    ctx.fill();
    // The disk's pattern and icon, without its round bevel.
    ctx.save();
    ctx.beginPath();
    ctx.arc(32, 32, 26.2, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(kit.disks[type].image as CanvasImageSource, 0, 0, 64, 64);
    ctx.restore();
    octagon(R - 0.9);
    ctx.strokeStyle = palette.ink;
    ctx.lineWidth = 1.8;
    ctx.lineJoin = "round";
    ctx.stroke();
    ctx.restore();
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.anisotropy = 4;
  return tex;
}

/**
 * Toon plate material: the atlas cell comes from a per-instance offset, and
 * rim vertices take the instance colour while the face keeps the art as is.
 */
function tileMaterial(kit: BoardThemeHost["kit"], map: THREE.Texture): THREE.MeshToonMaterial {
  const mat = new THREE.MeshToonMaterial({ color: palette.white, map, gradientMap: kit.grad });
  // The lane decal draws after the tiles with a slope-scaled offset (boardLanes)
  // that, in far grazing views, pulled it up through a face this low. The same
  // slope term cancels it on the flat face; the larger constant keeps the tile on top.
  mat.polygonOffset = true;
  mat.polygonOffsetFactor = -1;
  mat.polygonOffsetUnits = -4;
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec2 aTileCell;\nattribute float aRim;")
      .replace("#include <uv_vertex>", `#include <uv_vertex>\nvMapUv = vMapUv * vec2(${1 / COLS}, ${1 / ROWS}) + aTileCell;`)
      .replace("#include <color_vertex>", "#include <color_vertex>\nvColor = mix(vec3(1.0), instanceColor.rgb, aRim);");
  };
  mat.customProgramCacheKey = () => "downtown-tiles";
  return mat;
}

export interface DowntownTiles extends ThemeTiles {
  dispose(): void;
}

export function buildDowntownTiles(host: BoardThemeHost): DowntownTiles {
  const def = host.def;
  const n = def.spaces.length;
  const geo = slabGeometry();
  const cells = new Float32Array(n * 2);
  def.spaces.forEach((sp, i) => {
    const t = Math.max(0, TYPES.indexOf(sp.type));
    cells[i * 2] = (t % COLS) / COLS;
    cells[i * 2 + 1] = 1 - (Math.floor(t / COLS) + 1) / ROWS; // canvas rows run down, v runs up
  });
  geo.setAttribute("aTileCell", new THREE.InstancedBufferAttribute(cells, 2));
  const atlas = faceAtlas(host.kit);
  const mat = tileMaterial(host.kit, atlas);
  const mesh = new THREE.InstancedMesh(geo, mat, n);
  mesh.name = "downtown:tiles";
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.receiveShadow = true;
  mesh.castShadow = false;

  const base = def.spaces.map((sp) => new THREE.Vector3(sp.x, groundHeight(def, sp.x, sp.y), sp.y));
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const at = new THREE.Vector3();
  const sc = new THREE.Vector3();
  const color = new THREE.Color();
  for (let i = 0; i < n; i++) {
    mesh.setMatrixAt(i, m.makeTranslation(base[i]));
    mesh.setColorAt(i, color.set(DISK_STYLE[def.spaces[i].type]?.deep ?? palette.ink));
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  // Room for a landing's spread at the board's edge.
  if (mesh.boundingSphere) mesh.boundingSphere.radius += R_EDGE * 0.3;

  return {
    root: mesh,
    top: TOP,
    dipInstance(i: number, y: number, sy: number, sxz: number): void {
      if (i < 0 || i >= n) return;
      const press = Math.min(0, y);
      const s = sxz * (1 + press * PRESS_SHRINK);
      at.copy(base[i]);
      at.y += Math.max(press, MIN_EDGE - EDGE * sy);
      mesh.setMatrixAt(i, m.compose(at, q, sc.set(s, sy, s)));
      mesh.instanceMatrix.needsUpdate = true;
    },
    dispose(): void {
      geo.dispose();
      mat.dispose();
      atlas.dispose();
      mesh.dispose();
    },
  };
}
