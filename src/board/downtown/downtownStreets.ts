/**
 * SUPER STAR PARTY — Downtown's street life: where the traffic drives and
 * the pedestrians walk (lively/traffic.ts, lively/pedestrians.ts draw them).
 *
 * Only the streets running off the map past the Ring Road's corners carry
 * any: the ring itself is the board, and its corner crossroads hold spaces,
 * so nothing ever drives or walks over a tile. Every one of those streets is
 * a dead end at the ring, so each gets its own loop:
 * - cars keep right, U-turn on the second tile out (short of the zebra on
 *   the first) and again far off the map;
 * - pedestrians walk out along one sidewalk, back along the other, and cross
 *   at the zebra, waiting at the kerb for the walk signal.
 * Lane and sidewalk offsets are the Kenney road's (in tile units): asphalt
 * |z| < 0.3, sidewalks 0.3 to 0.5, the zebra 0.225 either side of the first
 * tile's centre.
 */
import type { Object3D, Texture } from "three";
import type { ThemeLively } from "../boardTheme";
import type { StreetRoute } from "../lively/streetKit";
import { createTraffic, type VehicleKind } from "../lively/traffic";
import { createPedestrians, type WalkRoute } from "../lively/pedestrians";
import { wx, wz, Y_ROAD, Y_WALK, RING_MIN, RING_MAX, STUB } from "./downtownCity";

/** One street off the map: from a ring corner (tile units) along direction (dx, dy). */
interface Stub {
  cx: number;
  cy: number;
  dx: number;
  dy: number;
}

const STUBS: Stub[] = [];
for (const [cx, cy] of [
  [RING_MIN, RING_MIN],
  [RING_MAX, RING_MIN],
  [RING_MAX, RING_MAX],
  [RING_MIN, RING_MAX],
] as const) {
  const ox = cx === RING_MIN ? -1 : 1;
  const oy = cy === RING_MIN ? -1 : 1;
  STUBS.push({ cx, cy, dx: 0, dy: oy }, { cx, cy, dx: ox, dy: 0 });
}

const LANE = 0.15; // lane centre off the road's centre line
const TURN_R = 0.22; // U-turn radius: both lanes and a little of the kerb lane
const NEAR_TURN = 1.95; // U-turn centre, tiles out (its apex stays short of the zebra)
const FAR_TURN = STUB - 0.6;
const WALK_L = 0.4; // sidewalk centre line
const KERB_L = 0.33; // where a walker waits
const ZEBRA = 1; // the crosswalk's tile
const WALK_FAR = STUB - 0.2;

/** Street-local (k tiles out, l tiles to the left of outbound) -> board-local world x/z. */
function toWorld(s: Stub, k: number, l: number, out: number[]): void {
  // Left of outbound (dx, dy) in tile units is (-dy, dx); tile +y is world -z.
  const tx = s.cx + s.dx * k - s.dy * l;
  const ty = s.cy + s.dy * k + s.dx * l;
  out.push(wx(tx), wz(ty));
}

/** Keep-right loop on one street: out, U-turn far off, back in, U-turn short of the zebra. */
function carLoop(s: Stub): StreetRoute {
  const pts: number[] = [];
  const arc = (k: number, from: number, to: number): void => {
    const steps = 10;
    for (let i = 0; i <= steps; i++) {
      const a = from + ((to - from) * i) / steps;
      toWorld(s, k + Math.cos(a) * TURN_R, Math.sin(a) * TURN_R, pts);
    }
  };
  // Outbound keeps right (l < 0): swing back into lane after the near U-turn.
  toWorld(s, NEAR_TURN + 0.7, -LANE, pts);
  toWorld(s, FAR_TURN - 0.7, -LANE, pts);
  arc(FAR_TURN, -Math.PI / 2, Math.PI / 2); // round the far end, through k = FAR_TURN + r
  toWorld(s, FAR_TURN - 0.7, LANE, pts);
  toWorld(s, NEAR_TURN + 0.7, LANE, pts);
  arc(NEAR_TURN, Math.PI / 2, (3 * Math.PI) / 2); // left U-turn, apex at k = NEAR_TURN - r
  return { pts, y: Y_ROAD + 0.01 };
}

/**
 * Sidewalk loop on one street: in along one side, wait at the kerb, cross
 * the zebra, out along the other side, cross back far off the map. `flip`
 * walks it the other way round.
 */
function walkLoop(s: Stub, flip: boolean, signal: number): WalkRoute {
  const sideA = flip ? WALK_L : -WALK_L;
  const kerbA = flip ? KERB_L : -KERB_L;
  const pts: number[] = [];
  toWorld(s, WALK_FAR, sideA, pts);
  toWorld(s, ZEBRA, sideA, pts);
  toWorld(s, ZEBRA, kerbA, pts); // point 2: the kerb, wait here
  toWorld(s, ZEBRA, -kerbA, pts);
  toWorld(s, ZEBRA, -sideA, pts);
  toWorld(s, WALK_FAR, -sideA, pts);
  return { pts, y: Y_WALK, stops: [{ point: 2, signal }] };
}

/**
 * Which vehicle on which street (STUBS order: per corner, the north/south
 * street then the east/west one). The south streets run toward the
 * whole-board camera, so they carry the most.
 */
const FLEET: ReadonlyArray<{ kind: VehicleKind; route: number }> = [
  { kind: "bus", route: 0 },
  { kind: "sedan", route: 0 },
  { kind: "taxi", route: 2 },
  { kind: "sedan", route: 2 },
  { kind: "van", route: 1 },
  { kind: "sedan", route: 3 },
  { kind: "taxi", route: 4 },
  { kind: "van", route: 5 },
  { kind: "sedan", route: 6 },
  { kind: "taxi", route: 7 },
];
const WALKERS = 16;

/** Traffic + pedestrians as one lively group (at most 5 draw calls). */
export function createDowntownStreets(root: Object3D, gradientMap: Texture | null): ThemeLively {
  const traffic = createTraffic({ root, routes: STUBS.map(carLoop), vehicles: FLEET, gradientMap });
  const peds = createPedestrians({
    root,
    routes: STUBS.map((s, i) => walkLoop(s, i % 2 === 1, i)),
    count: WALKERS,
    gradientMap,
  });
  return {
    update(dt: number) {
      traffic.update(dt);
      peds.update(dt);
    },
    dispose() {
      traffic.dispose();
      peds.dispose();
    },
    debug() {
      const t = traffic.debug();
      const p = peds.debug();
      return {
        drawCalls: t.drawCalls + p.drawCalls,
        triangles: t.triangles + p.triangles,
        vehicles: t.vehicles,
        perKind: t.perKind,
        walkers: p.walkers,
        waiting: p.waiting,
      };
    },
  };
}
