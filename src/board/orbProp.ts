/**
 * SUPER STAR PARTY — orbs on the board (presentation only).
 *
 * `createOrbMesh` builds one glossy candy orb, coloured by what it does.
 * `createOrbMarkers` keeps a little bobbing orb over every space that holds
 * one (`match.traps`), so a thrown orb stays visible where it landed.
 * Reads match state, never writes it, and draws no gameplay rng.
 */
import * as THREE from "three";
import { palette } from "../config/palette";
import { celGradient } from "../characters/cel";
import { match, type TrapKind } from "../core/game";
import type { BoardScene } from "./boardScene";

const ORB_COLORS: Record<TrapKind, string> = {
  coin10: palette.sun,
  coin20: palette.sunDeep,
  star_steal: palette.berry,
  wreck: palette.lava,
  duel: palette.candy,
  snag: palette.wood,
  swap: palette.bubble,
  tree: palette.leaf,
  circus: palette.tentRed,
  star_shift: palette.heroMallow,
};

export function orbColor(kind: TrapKind): string {
  return ORB_COLORS[kind] ?? palette.candy;
}

/** A glossy orb with an ink outline and a white glint, radius `r`. */
export function createOrbMesh(kind: TrapKind, r = 0.26): THREE.Group {
  const g = new THREE.Group();
  g.name = `orb:${kind}`;
  const body = new THREE.Mesh(
    new THREE.SphereGeometry(r, 20, 14),
    new THREE.MeshToonMaterial({ gradientMap: celGradient, color: orbColor(kind) }),
  );
  body.castShadow = true;
  const ink = new THREE.Mesh(
    new THREE.SphereGeometry(r * 1.12, 20, 14),
    new THREE.MeshBasicMaterial({ color: palette.ink, side: THREE.BackSide }),
  );
  const glint = new THREE.Mesh(
    new THREE.SphereGeometry(r * 0.28, 10, 8),
    new THREE.MeshBasicMaterial({ color: palette.white }),
  );
  glint.position.set(-r * 0.4, r * 0.45, r * 0.62);
  // A cream band around the middle reads as "capsule" from the high camera.
  const band = new THREE.Mesh(
    new THREE.TorusGeometry(r * 1.0, r * 0.12, 6, 24),
    new THREE.MeshToonMaterial({ gradientMap: celGradient, color: palette.cream }),
  );
  band.rotation.x = Math.PI / 2;
  g.add(ink, body, band, glint);
  return g;
}

export function disposeOrbMesh(g: THREE.Object3D): void {
  g.parent?.remove(g);
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.geometry.dispose();
    (m.material as THREE.Material).dispose();
  });
}

export interface OrbMarkers {
  /** Call every frame: adds, removes and bobs markers to match `match.traps`. */
  update(dt: number): void;
  dispose(): void;
}

export function createOrbMarkers(board: BoardScene): OrbMarkers {
  const root = new THREE.Group();
  root.name = "orb-markers";
  (board.group.parent ?? board.group).add(root);
  const live = new Map<string, THREE.Group>();
  let t = 0;
  return {
    update(dt) {
      t += dt;
      const want = new Set<string>();
      for (const trap of match.traps) {
        const id = `${trap.space}:${trap.kind}`;
        want.add(id);
        let m = live.get(id);
        if (!m) {
          m = createOrbMesh(trap.kind, 0.2);
          root.add(m);
          live.set(id, m);
        }
        const p = board.spaceWorldPos(trap.space);
        // Off-centre so it never hides a character standing on the space.
        m.position.set(p.x - 0.55, p.y + 0.55 + Math.sin(t * 2.2 + trap.space) * 0.08, p.z - 0.35);
        m.rotation.y = t * 0.8;
      }
      for (const [id, m] of live) {
        if (want.has(id)) continue;
        disposeOrbMesh(m);
        live.delete(id);
      }
    },
    dispose() {
      for (const m of live.values()) disposeOrbMesh(m);
      live.clear();
      root.parent?.remove(root);
    },
  };
}
