/**
 * SUPER STAR PARTY — placeholder title screen. Wave 4 (screens) replaces this
 * with the real animated title. For now: a bouncy wordmark so the app boots
 * to something friendly.
 */
import * as THREE from "three";
import { palette } from "../config/palette";
import { ui } from "../ui/kit";
import type { Screen } from "./screenManager";

export const titleScreen: Screen = {
  id: "title",
  enter() {
    ui.clearScreen();
    ui.banner("SUPER STAR PARTY", { durationMs: 0, sound: null });
    const start = ui.button({
      label: "SHOWCASE",
      kind: "gold",
      size: "lg",
      onClick: () => screens.goto("showcase"),
    });
    start.el.style.cssText += ";position:absolute;left:50%;top:62%;transform:translateX(-50%);";
    // Little star that bobs (visual placeholder).
    const star = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.5),
      new THREE.MeshToonMaterial({ color: palette.sun })
    );
    star.position.set(0, 1.6, -6);
    world.scene?.add(star);
    (this as unknown as { star?: THREE.Mesh }).star = star;
  },
  exit() {
    ui.clearScreen();
    const s = (this as unknown as { star?: THREE.Mesh }).star;
    if (s) world.scene?.remove(s);
  },
  update(dt: number) {
    const s = (this as unknown as { star?: THREE.Mesh }).star;
    if (s) {
      s.rotation.y += dt * 2;
      s.position.y = 1.6 + Math.sin(performance.now() / 300) * 0.15;
    }
  },
  render() {},
};

import { screens } from "./screenManager";
import { world } from "../main";
