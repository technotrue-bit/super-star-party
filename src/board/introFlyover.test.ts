import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { createIntroFlyover, orbitProgress } from "./introFlyover";
import { boardDef } from "./registry";

describe("intro flyover spin", () => {
  it("progress runs 0 to 1 and never goes backwards", () => {
    expect(orbitProgress(0)).toBe(0);
    expect(orbitProgress(1)).toBeCloseTo(1, 9);
    let prev = 0;
    for (let i = 1; i <= 1000; i++) {
      const p = orbitProgress(i / 1000);
      expect(p).toBeGreaterThanOrEqual(prev);
      prev = p;
    }
  });

  it("starts and stops at rest", () => {
    const h = 1e-4;
    expect(orbitProgress(h) / h).toBeLessThan(0.01);
    expect((1 - orbitProgress(1 - h)) / h).toBeLessThan(0.01);
  });

  for (const id of ["fizzy-fairground", "downtown", "cruise-ship"] as const) {
    it(`${id}: one smooth turn that lands on the overview with no jolt`, () => {
      const endPos = new THREE.Vector3(4, 60, 70);
      const endLook = new THREE.Vector3(0, 0, 2);
      const fly = createIntroFlyover(boardDef(id), 0, endPos, endLook);
      const ms = fly.duration * 1000;
      // Lands exactly on the overview.
      const last = fly.pose(ms - 0.5)!;
      expect(last.pos.distanceTo(endPos)).toBeLessThan(0.01);
      expect(last.look.distanceTo(endLook)).toBeLessThan(1e-6);
      expect(fly.pose(ms + 1)).toBeNull();
      // Frame-to-frame steps never reverse and never spike (60 fps samples).
      const step = 1000 / 60;
      let prev = fly.pose(0)!.pos.clone();
      let prevMove: THREE.Vector3 | null = null;
      let swept = 0;
      let lastAngle = Math.atan2(prev.z - endLook.z, prev.x - endLook.x);
      for (let t = step; t < ms; t += step) {
        const p = fly.pose(t)!;
        expect(p.look.distanceTo(endLook)).toBeLessThan(1e-6);
        const move = p.pos.clone().sub(prev);
        if (prevMove && prevMove.length() > 1e-3 && move.length() > 1e-3) {
          expect(move.clone().normalize().dot(prevMove.clone().normalize())).toBeGreaterThan(0.9);
          expect(Math.abs(move.length() - prevMove.length())).toBeLessThan(0.25);
        }
        const a = Math.atan2(p.pos.z - endLook.z, p.pos.x - endLook.x);
        let da = a - lastAngle;
        if (da > Math.PI) da -= Math.PI * 2;
        if (da < -Math.PI) da += Math.PI * 2;
        swept += da;
        lastAngle = a;
        prevMove = move;
        prev = p.pos.clone();
      }
      expect(Math.abs(swept)).toBeGreaterThan(Math.PI * 2 * 0.99);
    });
  }
});
