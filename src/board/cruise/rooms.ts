/**
 * SUPER STAR PARTY — the Cruise Ship's glass rooms, the places the lanes walk
 * through: the Grand Ballroom's two-storey hall (glass walls round the sunken
 * floor, a vaulted glass roof, chandeliers), the Panorama Lounge up on its
 * raised floor in front of the bridge, the canopies over the lifeboat decks,
 * and the glass arch over the pool bridge.
 *
 * Every pane is tinted, see-through glass, so a player inside is always in
 * sight; when the camera comes close (the party camera follows at ~20 units)
 * the panes thin out further, and from afar (overview, flyover) they read as
 * glass halls. Frames, signs and furniture are solid and merge into the
 * ship's parts. Presentation only: no state, no rng.
 */
import * as THREE from "three";
import { palette } from "../../config/palette";
import type { BoardDef } from "../boardData";
import { CRUISE_H, CRUISE_SHIP } from "../boards/cruiseData";
import { Parts, type P2, canvasTex, offsetPts, roundRectPts, signedArea, starShape, wall } from "./shipKit";

export interface RoomsCtx {
  def: BoardDef;
  root: THREE.Group;
  /** The ship's merged solid parts: frames and furniture go here. */
  solid: Parts;
  textures: THREE.Texture[];
  lamps: { glow: THREE.Mesh; halo: THREE.Mesh }[];
  ground: (x: number, z: number) => number;
  /** Outlines of the Panorama Lounge's raised floor (from the split levels). */
  loungeOutline: P2[][];
}

const smooth = (a: number, b: number, v: number): number => {
  const u = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return u * u * (3 - 2 * u);
};

/** Distance from p to segment a-b. */
function distSeg(p: P2, a: P2, b: P2): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const l2 = dx * dx + dz * dz || 1;
  const u = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / l2));
  return Math.hypot(a.x + dx * u - p.x, a.z + dz * u - p.z);
}

/** A lane's spaces as points, fork and rejoin included. */
function laneSpaces(def: BoardDef, label: string): P2[] {
  const b = def.branches?.find((x) => x.label === label);
  if (!b) return [];
  return [b.from, ...b.path, b.to].map((i) => ({ x: def.spaces[i].x, z: def.spaces[i].y }));
}

/** Glass panes along a closed outline from y0 up to y1, leaving out segments where `skip` holds. */
function glassWall(pts: P2[], y0: number, y1: number, skip: (m: P2) => boolean): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  let acc = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    const l = Math.hypot(q.x - p.x, q.z - p.z);
    if (!skip({ x: (p.x + q.x) / 2, z: (p.z + q.z) / 2 })) {
      const u0 = acc / 3;
      const u1 = (acc + l) / 3;
      const v1 = (y1 - y0) / 3;
      pos.push(p.x, y0, p.z, q.x, y0, q.z, p.x, y1, p.z, q.x, y0, q.z, q.x, y1, q.z, p.x, y1, p.z);
      uv.push(u0, 0, u1, 0, u0, v1, u1, 0, u1, v1, u0, v1);
    }
    acc += l;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

/** Flat glass over a closed outline (with holes) at height y, UVs in world units. */
function glassCap(pts: P2[], y: number, holes: P2[][] = []): THREE.BufferGeometry {
  const shape = new THREE.Shape(pts.map((p) => new THREE.Vector2(p.x, -p.z)));
  for (const h of holes) shape.holes.push(new THREE.Path(h.map((p) => new THREE.Vector2(p.x, -p.z))));
  const g = new THREE.ShapeGeometry(shape);
  g.rotateX(-Math.PI / 2);
  g.translate(0, y, 0);
  const p = g.getAttribute("position");
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    uv[i * 2] = p.getX(i) / 3;
    uv[i * 2 + 1] = p.getZ(i) / 3;
  }
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  return g;
}

/**
 * Frames along a closed outline: a sill and a top rail (both faces), and posts
 * every `spacing`, with jambs either side of each gap.
 */
function frame(
  solid: Parts,
  pts: P2[],
  y0: number,
  y1: number,
  skip: (m: P2) => boolean,
  o: { spacing: number; post: string; rail: string; sill: string; postR?: number }
): void {
  const bands = [
    { y0, y1: y0 + 0.14, color: o.sill },
    { y0: y1 - 0.12, y1, color: o.rail },
  ];
  wall(solid, pts, bands, skip);
  wall(solid, pts, bands, skip, true);
  const r = o.postR ?? 0.05;
  let acc = o.spacing;
  let prevSkip = skip({ x: (pts[pts.length - 1].x + pts[0].x) / 2, z: (pts[pts.length - 1].z + pts[0].z) / 2 });
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    const sk = skip({ x: (p.x + q.x) / 2, z: (p.z + q.z) / 2 });
    acc += Math.hypot(q.x - p.x, q.z - p.z);
    if (sk !== prevSkip || (!sk && acc >= o.spacing)) {
      solid.post(r, r, p.x, y0, y1, p.z, o.post, 6);
      acc = 0;
    }
    prevSkip = sk;
  }
}

/** A gold-on-ink name board ("GRAND BALLROOM"), double-faced, centred at (x, y, z) facing ∓z. */
function nameBoard(ctx: RoomsCtx, text: string, x: number, y: number, z: number, w: number): void {
  const tex = canvasTex(512, 88, (c) => {
    c.fillStyle = palette.ink;
    c.beginPath();
    c.roundRect(2, 2, 508, 84, 26);
    c.fill();
    c.strokeStyle = palette.sun;
    c.lineWidth = 5;
    c.beginPath();
    c.roundRect(8, 8, 496, 72, 20);
    c.stroke();
    c.fillStyle = palette.sun;
    c.font = "bold 46px Fredoka, 'Comic Sans MS', sans-serif";
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillText(text, 256, 47);
  });
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  ctx.textures.push(tex);
  const mat = new THREE.MeshBasicMaterial({ map: tex });
  const geo = new THREE.PlaneGeometry(w, (w * 88) / 512);
  for (const face of [-1, 1]) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z + face * 0.02);
    m.rotation.y = face < 0 ? Math.PI : 0;
    m.name = "cruise:sign";
    ctx.root.add(m);
  }
}

/** A lamp the night rig can light: a glow and a halo at (x, y, z). */
function lamp(ctx: RoomsCtx, x: number, y: number, z: number, r = 0.2): void {
  const glow = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), new THREE.MeshBasicMaterial({ color: palette.sun }));
  glow.position.set(x, y, z);
  glow.name = "lamp-glow";
  const halo = new THREE.Mesh(new THREE.SphereGeometry(r * 1.9, 10, 8), new THREE.MeshBasicMaterial({ color: palette.sun, transparent: true, opacity: 0.22 }));
  halo.position.copy(glow.position);
  halo.name = "lamp-halo";
  ctx.root.add(glow, halo);
  ctx.lamps.push({ glow, halo });
}

export function buildRooms(ctx: RoomsCtx): void {
  // ---- glass ----------------------------------------------------------------------------
  // A faint sheen (diagonal light streaks) so the panes read as glass even when thin.
  const sheen = canvasTex(128, 128, (c) => {
    c.fillStyle = "rgba(255,255,255,0.55)";
    c.fillRect(0, 0, 128, 128);
    c.fillStyle = "rgba(255,255,255,1)";
    for (const [x, w] of [[18, 10], [40, 4], [84, 14], [106, 5]] as const) {
      c.beginPath();
      c.moveTo(x, 128);
      c.lineTo(x + w, 128);
      c.lineTo(x + w + 40, 0);
      c.lineTo(x + 40, 0);
      c.fill();
    }
  });
  ctx.textures.push(sheen);
  /**
   * A glass mesh: tinted, see-through, never writing depth (what is behind and
   * inside always draws), and thinner the closer the camera is to `centre`.
   */
  const glass = (geo: THREE.BufferGeometry, centre: THREE.Vector3, near: number, far: number, name: string): THREE.Mesh => {
    const mat = new THREE.MeshBasicMaterial({
      color: palette.bubble,
      map: sheen,
      transparent: true,
      opacity: far,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = name;
    mesh.renderOrder = 4;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.onBeforeRender = (_r, _s, cam) => {
      mat.opacity = near + (far - near) * smooth(24, 70, cam.position.distanceTo(centre));
    };
    ctx.root.add(mesh);
    return mesh;
  };

  ballroomHall(ctx, glass);
  panoramaLounge(ctx, glass);
  lifeboatCanopies(ctx, glass);
  poolArch(ctx, glass);
}

type Glass = (geo: THREE.BufferGeometry, centre: THREE.Vector3, near: number, far: number, name: string) => THREE.Mesh;

// ---- Grand Ballroom ---------------------------------------------------------------------
function ballroomHall(ctx: RoomsCtx, glass: Glass): void {
  const { solid, def, ground } = ctx;
  const B = CRUISE_SHIP.ballroom;
  const WALL = 3.0;
  // The walls stand on the deck just outside the sunken floor's rim.
  const outline = offsetPts(roundRectPts(B, 0.45), 0.2);
  const lane = laneSpaces(def, "Grand Ballroom");
  // Doorways where the lane steps down into the hall: [promenade side, door landing].
  const doors: Array<[P2, P2]> = lane.length >= 4 ? [[lane[1], lane[2]], [lane[lane.length - 3], lane[lane.length - 2]]] : [];
  const door = (m: P2): boolean => doors.some(([a, b]) => distSeg(m, a, b) < 1.6) || ground(m.x, m.z) < -1e-4;
  const centre = new THREE.Vector3(B.x, 0.5, B.z);

  glass(glassWall(outline, 0, WALL, door), centre, 0.1, 0.3, "cruise:ballroom-glass");
  frame(solid, outline, 0, WALL, door, { spacing: 1.5, post: palette.white, rail: palette.sun, sill: palette.white, postR: 0.06 });

  // Roof: a flat glass ceiling round a raised glass barrel vault over the middle.
  const VX = 7.5;
  const VW = 2.5;
  const RISE = 1.3;
  const R = (VW * VW + RISE * RISE) / (2 * RISE);
  const cy = WALL + RISE - R;
  const half = Math.asin(VW / R);
  const vaultHole: P2[] = [
    { x: -VX, z: B.z - VW },
    { x: -VX, z: B.z + VW },
    { x: VX, z: B.z + VW },
    { x: VX, z: B.z - VW },
  ];
  glass(glassCap(outline, WALL, [vaultHole]), centre, 0.07, 0.26, "cruise:ballroom-ceiling");
  const vault = new THREE.CylinderGeometry(R, R, VX * 2, 30, 1, true, Math.PI / 2 - half, half * 2);
  vault.rotateZ(Math.PI / 2);
  vault.translate(0, cy, B.z);
  // Cylinder UVs run round the arc; fine for the sheen.
  glass(vault, centre, 0.07, 0.26, "cruise:ballroom-vault");
  const arc = (x: number): THREE.Vector3[] => {
    const out: THREE.Vector3[] = [];
    for (let k = 0; k <= 14; k++) {
      const th = Math.PI / 2 - half + (half * 2 * k) / 14;
      out.push(new THREE.Vector3(x, cy + R * Math.sin(th), B.z + R * Math.cos(th)));
    }
    return out;
  };
  // Gable ends: glass arch segments at each end of the vault.
  for (const x of [-VX, VX]) {
    const shape = new THREE.Shape();
    const pts = arc(0);
    shape.moveTo(pts[0].z - B.z, pts[0].y);
    for (const p of pts.slice(1)) shape.lineTo(p.z - B.z, p.y);
    shape.closePath();
    const g = new THREE.ShapeGeometry(shape);
    g.rotateY(-Math.PI / 2);
    g.translate(x, 0, B.z);
    const p = g.getAttribute("position");
    const uv = new Float32Array(p.count * 2);
    for (let i = 0; i < p.count; i++) {
      uv[i * 2] = p.getZ(i) / 3;
      uv[i * 2 + 1] = p.getY(i) / 3;
    }
    g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    glass(g, centre, 0.07, 0.26, "cruise:ballroom-gable");
  }
  // Gold ribs over the vault, a ridge beam and the vault's edge beams.
  for (let x = -VX; x <= VX + 1e-6; x += VX / 3) {
    solid.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(arc(x)), 20, 0.05, 5, false), palette.sun);
  }
  solid.bar(new THREE.Vector3(-VX, WALL + RISE, B.z), new THREE.Vector3(VX, WALL + RISE, B.z), 0.07, palette.sun);
  for (const z of [B.z - VW, B.z + VW]) solid.bar(new THREE.Vector3(-VX, WALL, z), new THREE.Vector3(VX, WALL, z), 0.07, palette.white);
  for (const x of [-VX, VX]) solid.bar(new THREE.Vector3(x, WALL, B.z - VW), new THREE.Vector3(x, WALL, B.z + VW), 0.07, palette.white);

  // Two chandeliers hang from the vault over the dance floor's far side.
  for (const side of [-1, 1]) {
    const x = side * 4.6;
    const z = B.z + 1.2;
    const y = 2.55;
    const top = cy + Math.sqrt(R * R - (z - B.z) * (z - B.z));
    solid.post(0.025, 0.025, x, y + 0.2, top, z, palette.sunDeep, 4);
    solid.add(new THREE.TorusGeometry(0.46, 0.05, 6, 18), palette.sun, new THREE.Matrix4().makeRotationX(Math.PI / 2).setPosition(x, y, z));
    solid.add(new THREE.TorusGeometry(0.26, 0.04, 6, 14), palette.sun, new THREE.Matrix4().makeRotationX(Math.PI / 2).setPosition(x, y + 0.22, z));
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      solid.post(0.03, 0.03, x + Math.cos(a) * 0.46, y, y + 0.16, z + Math.sin(a) * 0.46, palette.cream, 5);
      solid.add(new THREE.OctahedronGeometry(0.07), palette.bubble, new THREE.Matrix4().makeTranslation(x + Math.cos(a) * 0.4, y - 0.16, z + Math.sin(a) * 0.4));
    }
    lamp(ctx, x, y + 0.02, z, 0.16);
  }

  // On the far (stern) wall: the party camera looks aft, so the board never hides the lane.
  nameBoard(ctx, "GRAND BALLROOM", 0, WALL - 0.42, B.z + B.hz + 0.24, 4.4);
}

// ---- Panorama Lounge ----------------------------------------------------------------------
function panoramaLounge(ctx: RoomsCtx, glass: Glass): void {
  const { solid, def } = ctx;
  const floor = CRUISE_H.lounge;
  const outer = ctx.loungeOutline.filter((l) => signedArea(l) > 0).sort((a, b) => signedArea(b) - signedArea(a))[0];
  if (!outer) return;
  const TOP = floor + 2.3;
  const outline = offsetPts(outer, 0.06);
  const walk = laneSpaces(def, "Captain's Walk");
  // Doorways where the walk climbs its last step into the lounge.
  const doors: Array<[P2, P2]> = walk.length >= 4 ? [[walk[2], walk[3]], [walk[walk.length - 4], walk[walk.length - 3]]] : [];
  const door = (m: P2): boolean => doors.some(([a, b]) => distSeg(m, a, b) < 1.45);
  const L = CRUISE_SHIP.lounge;
  const centre = new THREE.Vector3(L.x, floor + 1, L.z);

  glass(glassWall(outline, floor, TOP, door), centre, 0.1, 0.3, "cruise:lounge-glass");
  frame(solid, outline, floor, TOP, door, { spacing: 1.3, post: palette.white, rail: palette.sunDeep, sill: palette.white });
  glass(glassCap(outline, TOP), centre, 0.07, 0.26, "cruise:lounge-roof");
  // Roof beams across the lounge (bow to stern), clipped to its outline.
  const span = (x: number): [number, number] | null => {
    const zs: number[] = [];
    for (let i = 0; i < outline.length; i++) {
      const p = outline[i];
      const q = outline[(i + 1) % outline.length];
      if ((p.x - x) * (q.x - x) < 0) zs.push(p.z + ((q.z - p.z) * (x - p.x)) / (q.x - p.x));
    }
    return zs.length >= 2 ? [Math.min(...zs), Math.max(...zs)] : null;
  };
  for (const x of [-4.8, -1.6, 1.6, 4.8]) {
    const s = span(x);
    if (s) solid.bar(new THREE.Vector3(x, TOP, s[0]), new THREE.Vector3(x, TOP, s[1]), 0.05, palette.white);
  }

  // Furniture along the back, clear of the walk: the ship's wheel and binnacle, two sofas,
  // and lamps the night rig lights.
  const back = L.z + L.hz - 0.42;
  solid.post(0.12, 0.16, 0, floor, floor + 0.85, back, palette.wood, 10);
  const wheelY = floor + 1.2;
  solid.add(new THREE.TorusGeometry(0.42, 0.05, 6, 20), palette.wood, new THREE.Matrix4().makeTranslation(0, wheelY, back - 0.1));
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    const tip = new THREE.Vector3(Math.cos(a) * 0.56, wheelY + Math.sin(a) * 0.56, back - 0.1);
    solid.bar(new THREE.Vector3(0, wheelY, back - 0.1), tip, 0.025, palette.wood);
    solid.add(new THREE.SphereGeometry(0.05, 6, 4), palette.sunDeep, new THREE.Matrix4().makeTranslation(tip.x, tip.y, tip.z));
  }
  solid.post(0.08, 0.08, 0, wheelY - 0.05, wheelY + 0.05, back - 0.1, palette.sun, 8);
  solid.post(0.1, 0.12, 1.2, floor, floor + 0.75, back, palette.wood, 8);
  solid.add(new THREE.SphereGeometry(0.2, 10, 8), palette.sunDeep, new THREE.Matrix4().makeTranslation(1.2, floor + 0.9, back));
  for (const side of [-1, 1]) {
    const sx = side * 3.6;
    solid.box(1.6, 0.32, 0.55, sx, floor + 0.16, back, palette.candy);
    solid.box(1.6, 0.5, 0.16, sx, floor + 0.45, back + 0.22, palette.candy);
    for (const ex of [-0.85, 0.85]) solid.box(0.14, 0.42, 0.55, sx + ex, floor + 0.21, back, palette.berry);
    // Standing lamp at the back corner.
    const lx = side * 6.6;
    const lz = L.z + L.hz - 0.55;
    if (!def.spaces.some((sp) => Math.hypot(sp.x - lx, sp.y - lz) < 1.33)) {
      solid.post(0.04, 0.05, lx, floor, floor + 1.55, lz, palette.white, 6);
      lamp(ctx, lx, floor + 1.7, lz, 0.17);
    }
  }

  // On the back (bridge-side) wall, above the furniture, clear of the walk.
  nameBoard(ctx, "PANORAMA LOUNGE", 0, TOP - 0.38, Math.max(...outline.map((p) => p.z)) + 0.06, 4.2);
}

// ---- lifeboat-deck canopies -------------------------------------------------------------
function lifeboatCanopies(ctx: RoomsCtx, glass: Glass): void {
  const { solid, def } = ctx;
  const sp = CRUISE_SHIP.sponson;
  const clearOfSpaces = (x: number, z: number, r: number): boolean => !def.spaces.some((s) => Math.hypot(s.x - x, s.y - z) < r);
  for (const [side, zr] of [[1, sp.starboard], [-1, sp.port]] as const) {
    const xi = side * 16.3;
    const xo = side * 21.55;
    const yi = 3.15;
    const yo = 2.85;
    const z0 = zr[0] + 0.15;
    const z1 = zr[1] - 0.15;
    const roof = new THREE.BufferGeometry();
    const P = [
      [xi, yi, z0],
      [xo, yo, z0],
      [xo, yo, z1],
      [xi, yi, z1],
    ];
    roof.setAttribute("position", new THREE.Float32BufferAttribute([...P[0], ...P[1], ...P[2], ...P[0], ...P[2], ...P[3]], 3));
    const U = P.map(([x, , z]) => [x / 3, z / 3]);
    roof.setAttribute("uv", new THREE.Float32BufferAttribute([...U[0], ...U[1], ...U[2], ...U[0], ...U[2], ...U[3]], 2));
    glass(roof, new THREE.Vector3((xi + xo) / 2, 1, (z0 + z1) / 2), 0.08, 0.28, "cruise:canopy");
    // Frame: edge beams and cross beams.
    const v = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);
    solid.bar(v(xi, yi, z0), v(xi, yi, z1), 0.06, palette.white);
    solid.bar(v(xo, yo, z0), v(xo, yo, z1), 0.06, palette.white);
    const n = Math.max(2, Math.round((z1 - z0) / 2.5));
    for (let k = 0; k <= n; k++) {
      const z = z0 + ((z1 - z0) * k) / n;
      solid.bar(v(xi, yi, z), v(xo, yo, z), 0.05, k === 0 || k === n ? palette.white : palette.sun);
    }
    // Posts: outboard between the lifeboats' davits, inboard wherever the deck is clear.
    const boats = [0, 1, 2, 3].map((k) => zr[0] + 1.9 + ((zr[1] - zr[0] - 3.8) * k) / 3);
    const davits = boats.flatMap((z) => [z - 1.1, z + 1.1]);
    const outerZ = [z0 + 0.1, ...boats.slice(0, -1).map((z, k) => (z + boats[k + 1]) / 2), z1 - 0.1];
    for (const z of outerZ) {
      if (davits.some((d) => Math.abs(d - z) < 0.35)) continue;
      solid.post(0.06, 0.06, side * 21.35, 0, yo + ((yi - yo) * (21.55 - 21.35)) / (21.55 - 16.3), z, palette.white, 6);
    }
    for (let z = z0 + 0.1; z <= z1 - 0.05; z += 0.5) {
      if (!clearOfSpaces(side * 16.35, z, 1.45)) continue;
      solid.post(0.06, 0.06, side * 16.35, 0, yi - 0.01, z, palette.white, 6);
      z += 2.6;
    }
  }
}

// ---- pool bridge arch ---------------------------------------------------------------------
function poolArch(ctx: RoomsCtx, glass: Glass): void {
  const { solid } = ctx;
  const y = CRUISE_H.lido;
  const z = CRUISE_SHIP.poolBridge.z;
  const R = 1.22;
  const X = 3.25;
  const tube = new THREE.CylinderGeometry(R, R, X * 2, 20, 1, true, 0, Math.PI);
  tube.rotateZ(Math.PI / 2);
  tube.translate(0, y, z);
  glass(tube, new THREE.Vector3(0, y + 0.6, z), 0.08, 0.28, "cruise:pool-arch");
  for (let x = -X; x <= X + 1e-6; x += 1.3) {
    const pts: THREE.Vector3[] = [];
    for (let k = 0; k <= 12; k++) {
      const th = (k / 12) * Math.PI;
      pts.push(new THREE.Vector3(x, y + R * Math.sin(th), z + R * Math.cos(th)));
    }
    solid.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, 0.045, 5, false), Math.abs(Math.abs(x) - X) < 1e-6 ? palette.white : palette.sun);
  }
  solid.bar(new THREE.Vector3(-X, y + R, z), new THREE.Vector3(X, y + R, z), 0.05, palette.white);
  // A little gold star on the arch's crown at each end.
  for (const x of [-X, X]) solid.add(new THREE.ShapeGeometry(starShape(0.22)), palette.sun, new THREE.Matrix4().makeRotationY(Math.PI / 2).setPosition(x + Math.sign(x) * 0.06, y + R + 0.05, z));
}
