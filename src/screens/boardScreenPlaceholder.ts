/**
 * SUPER STAR PARTY — board screen placeholder. Wave 2 (turn-loop) replaces
 * this with the real match screen. Kept tiny so the app always has a board
 * target for the debug API.
 */
import * as THREE from "three";
import { palette } from "../config/palette";
import type { Screen } from "./screenManager";

export const boardScreenPlaceholder: Screen = {
  id: "board",
  enter() {
    const scene = world.scene!;
    const g = new THREE.Mesh(
      new THREE.PlaneGeometry(40, 40),
      new THREE.MeshToonMaterial({ color: palette.grassB })
    );
    g.rotation.x = -Math.PI / 2;
    g.position.y = -0.01;
    scene.add(g);
    (this as unknown as { _g?: THREE.Mesh })._g = g;
    world.camera!.position.set(0, 22, 14);
    world.camera!.lookAt(0, 0, 0);
  },
  exit() {
    const g = (this as unknown as { _g?: THREE.Mesh })._g;
    if (g) world.scene?.remove(g);
  },
  update(_dt: number) {},
  render() {},
};

import { screens } from "./screenManager";
import { world } from "../main";
