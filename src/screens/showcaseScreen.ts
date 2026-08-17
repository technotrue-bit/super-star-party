/**
 * SUPER STAR PARTY — showcase screen (harness/demo driver).
 * The always-inspectable surface: camera tours the board while characters
 * wander. Wave-1 pieces (board, characters, audio) light up here as they
 * land; until then a placeholder plaza keeps the screen alive.
 * This file is ORCHESTRATOR-OWNED — wave builders do not edit it; it only
 * consumes their public APIs.
 */
import * as THREE from "three";
import { palette } from "../config/palette";
import { rng } from "../core/rng";
import type { Screen } from "./screenManager";

export const showcaseScreen: Screen = {
  id: "showcase",
  enter() {
    const scene = world.scene!;
    // Ground plaza (placeholder until the board lands).
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(14, 48),
      new THREE.MeshToonMaterial({ color: palette.grassA })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    // Checker ring — carnival vibe.
    const ring: THREE.Mesh[] = [];
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      const tile = new THREE.Mesh(
        new THREE.BoxGeometry(1.9, 0.12, 1.9),
        new THREE.MeshToonMaterial({ color: i % 2 ? palette.grassB : palette.path })
      );
      tile.position.set(Math.cos(a) * 10, 0.06, Math.sin(a) * 10);
      scene.add(tile);
      ring.push(tile);
    }
    (this as unknown as { _ring?: THREE.Mesh[] })._ring = ring;
    (this as unknown as { _ground?: THREE.Mesh })._ground = ground;

    // Bobbing star centerpiece.
    const star = new THREE.Mesh(
      new THREE.OctahedronGeometry(1.1),
      new THREE.MeshToonMaterial({ color: palette.sun })
    );
    star.position.set(0, 1.8, 0);
    scene.add(star);
    (this as unknown as { _star?: THREE.Mesh })._star = star;

    (this as unknown as { _t?: number })._t = rng.next() * 100;
  },
  exit() {
    const self = this as unknown as { _ring?: THREE.Mesh[]; _ground?: THREE.Mesh; _star?: THREE.Mesh };
    for (const m of self._ring ?? []) world.scene?.remove(m);
    if (self._ground) world.scene?.remove(self._ground);
    if (self._star) world.scene?.remove(self._star);
  },
  update(dt: number) {
    const self = this as unknown as { _t?: number; _star?: THREE.Mesh };
    self._t = (self._t ?? 0) + dt;
    // Orbit camera around the plaza.
    const cam = world.camera!;
    const a = self._t * 0.25;
    const r = 16;
    cam.position.set(Math.cos(a) * r, 7.5 + Math.sin(self._t * 0.5) * 1.2, Math.sin(a) * r);
    cam.lookAt(0, 0.6, 0);
    const star = self._star;
    if (star) {
      star.rotation.y += dt * 1.6;
      star.rotation.x = Math.sin(self._t * 2) * 0.3;
      star.position.y = 1.8 + Math.sin(self._t * 2.2) * 0.25;
    }
  },
  render() {},
};

import { screens } from "./screenManager";
import { world } from "../main";
