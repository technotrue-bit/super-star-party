import { describe, expect, it } from "vitest";
import { fizzyFairground } from "./boardData";
import { titleOrbitPose, TITLE_ORBIT_PERIOD } from "./titleOrbit";

describe("titleOrbitPose", () => {
  const center = (() => {
    const xs = fizzyFairground.spaces.map((s) => s.x);
    const zs = fizzyFairground.spaces.map((s) => s.y);
    return { x: (Math.min(...xs) + Math.max(...xs)) / 2, z: (Math.min(...zs) + Math.max(...zs)) / 2 };
  })();

  it("looks down at the board centre from above", () => {
    const p = titleOrbitPose(fizzyFairground, 0, 1280 / 800, 45);
    expect(p.look.x).toBeCloseTo(center.x);
    expect(p.look.z).toBeCloseTo(center.z);
    expect(p.pos.y).toBeGreaterThan(Math.hypot(p.pos.x - center.x, p.pos.z - center.z));
  });

  it("keeps a constant radius and height while it turns, and loops", () => {
    const a = titleOrbitPose(fizzyFairground, 0, 1.6, 45);
    const r0 = Math.hypot(a.pos.x - center.x, a.pos.z - center.z);
    const y0 = a.pos.y;
    for (const t of [7, 31, 60, 95]) {
      const p = titleOrbitPose(fizzyFairground, t, 1.6, 45);
      expect(Math.hypot(p.pos.x - center.x, p.pos.z - center.z)).toBeCloseTo(r0);
      expect(p.pos.y).toBeCloseTo(y0);
    }
    const full = titleOrbitPose(fizzyFairground, TITLE_ORBIT_PERIOD, 1.6, 45);
    expect(full.pos.x).toBeCloseTo(a.pos.x);
    expect(full.pos.z).toBeCloseTo(a.pos.z);
  });

  it("moves slowly: under 4 degrees per second", () => {
    const a = titleOrbitPose(fizzyFairground, 0, 1.6, 45);
    const ax = a.pos.x - center.x;
    const az = a.pos.z - center.z;
    const b = titleOrbitPose(fizzyFairground, 1, 1.6, 45);
    const deg = Math.abs(Math.atan2(b.pos.x - center.x, b.pos.z - center.z) - Math.atan2(ax, az)) * (180 / Math.PI);
    expect(deg).toBeGreaterThan(0);
    expect(deg).toBeLessThan(4);
  });

  it("pulls back on a portrait phone so the island spans the width", () => {
    const desk = titleOrbitPose(fizzyFairground, 0, 1280 / 800, 45);
    const phone = titleOrbitPose(fizzyFairground, 0, 390 / 844, 45);
    expect(phone.pos.y).toBeGreaterThan(desk.pos.y);
  });
});
