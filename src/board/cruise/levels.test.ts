import { describe, expect, it } from "vitest";
import { contours, floorGeometry, levelLoops, riserGeometry, risers, sunkenLoops } from "./levels";

const area = (pts: { x: number; z: number }[]): number => {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p.x * q.z - q.x * p.z;
  }
  return a / 2;
};

describe("split-level outlines", () => {
  it("traces a disc as one counter-clockwise loop on its rim", () => {
    const loops = contours((x, z) => x * x + z * z < 4, { x0: -3, x1: 3, z0: -3, z1: 3 });
    expect(loops.length).toBe(1);
    expect(area(loops[0])).toBeCloseTo(Math.PI * 4, 1);
    for (const p of loops[0]) expect(Math.hypot(p.x, p.z)).toBeCloseTo(2, 3);
  });

  it("traces a ring as an outer loop and a clockwise hole", () => {
    const loops = contours((x, z) => {
      const r = Math.hypot(x, z);
      return r < 2.5 && r > 1;
    }, { x0: -3, x1: 3, z0: -3, z1: 3 });
    expect(loops.length).toBe(2);
    const areas = loops.map(area).sort((a, b) => a - b);
    expect(areas[0]).toBeLessThan(0);
    expect(areas[1]).toBeGreaterThan(0);
    const g = floorGeometry(loops, 0.5);
    expect(g).not.toBeNull();
    // The floor covers the ring, not the hole: about pi (6.25 - 1).
    const pos = g!.getAttribute("position");
    let covered = 0;
    for (let i = 0; i < pos.count; i += 3) {
      const ax = pos.getX(i), az = pos.getZ(i);
      const bx = pos.getX(i + 1), bz = pos.getZ(i + 1);
      const cx = pos.getX(i + 2), cz = pos.getZ(i + 2);
      covered += Math.abs((bx - ax) * (cz - az) - (cx - ax) * (bz - az)) / 2;
    }
    if (g!.index) {
      covered = 0;
      const idx = g!.index;
      for (let i = 0; i < idx.count; i += 3) {
        const a = idx.getX(i), b = idx.getX(i + 1), c = idx.getX(i + 2);
        covered += Math.abs((pos.getX(b) - pos.getX(a)) * (pos.getZ(c) - pos.getZ(a)) - (pos.getX(c) - pos.getX(a)) * (pos.getZ(b) - pos.getZ(a))) / 2;
      }
    }
    expect(covered).toBeCloseTo(Math.PI * 5.25, 0);
    for (let i = 0; i < pos.count; i++) expect(pos.getY(i)).toBeCloseTo(0.5, 6);
  });

  it("builds risers once per step, facing the lower side", () => {
    // A raised square (1.0) with a half step (0.5) on one side, on a flat deck.
    const height = (x: number, z: number): number => {
      if (Math.abs(x) < 1 && Math.abs(z) < 1) return 1;
      if (x >= 1 && x < 2 && Math.abs(z) < 1) return 0.5;
      return 0;
    };
    const box = { x0: -3, x1: 4, z0: -3, z1: 3 };
    const top = risers(height, levelLoops(height, box, 1), 1);
    const step = risers(height, levelLoops(height, box, 0.5), 0.5);
    // The 1.0 floor drops to 0 on three sides and to 0.5 on the fourth.
    const toStep = top.filter((r) => Math.abs(r.y0 - 0.5) < 1e-6);
    const toDeck = top.filter((r) => Math.abs(r.y0) < 1e-6);
    expect(toStep.length).toBeGreaterThan(0);
    expect(toDeck.length).toBeGreaterThan(0);
    // Facing +x (toward the step), weighted by length: the traced corner is chamfered.
    let len = 0;
    let along = 0;
    for (const r of toStep) {
      const l = Math.hypot(r.b.x - r.a.x, r.b.z - r.a.z);
      len += l;
      along += r.nx * l;
    }
    expect(along / len).toBeGreaterThan(0.95);
    expect(len).toBeCloseTo(2, 0);
    // The half step never draws a wall up to the 1.0 floor (that one belongs to the top).
    for (const r of step) expect(r.y1).toBeCloseTo(0.5, 6);
    const g = riserGeometry([...top, ...step]);
    expect(g.body.getAttribute("position").count).toBeGreaterThan(0);
    expect(g.lip.getAttribute("position").count).toBeGreaterThan(0);
  });

  it("faces sunken risers inward and finds the deck holes", () => {
    const height = (x: number, z: number): number => (Math.hypot(x, z) < 2 ? -1 : 0);
    const box = { x0: -3, x1: 3, z0: -3, z1: 3 };
    const pit = levelLoops(height, box, -1);
    const walls = risers(height, pit, -1);
    expect(walls.length).toBeGreaterThan(10);
    for (const r of walls) {
      expect(r.y0).toBeCloseTo(-1, 6);
      expect(r.y1).toBeCloseTo(0, 6);
      // Facing the pit's middle.
      const mx = (r.a.x + r.b.x) / 2;
      const mz = (r.a.z + r.b.z) / 2;
      expect(r.nx * -mx + r.nz * -mz).toBeGreaterThan(0);
    }
    const holes = sunkenLoops(height, box);
    expect(holes.length).toBe(1);
    expect(Math.abs(area(holes[0]))).toBeCloseTo(Math.PI * 4, 0);
  });
});
