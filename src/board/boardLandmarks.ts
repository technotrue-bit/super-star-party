/**
 * SUPER STAR PARTY — big landmarks for the Fizzy Fairground island. A party
 * map reads by its landmarks ("meet you by the Big Top"), so the open grass
 * on each side of the loop gets one: the Big Top circus tent in the west, the
 * helter-skelter slide tower in the east, and a pier with a bobbing boat on
 * the south coast. Procedural, cel-shaded, ink-outlined, palette colours only.
 */
import * as THREE from "three";
import { palette } from "../config/palette";
import type { BoardTextures } from "./boardTextures";
import { toonMat, outline, type Prop } from "./boardScenery";
import type { IslandShape } from "./boardIsland";
import { settings } from "../config/settings";

/** Footprint radius of each landmark, for the foliage keep-out. */
export const LANDMARK_RADIUS = { bigTop: 4.2, helter: 2.6, pier: 2.2 } as const;

function shadowAll(root: THREE.Object3D): void {
  root.traverse((o) => {
    if (o instanceof THREE.Mesh && o.name !== "ink-shell") {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
}

/**
 * Big Top: a wide striped drum, a tall two-tier striped roof, a scalloped gold
 * trim, a dark entrance arch facing `face`, and a flag that flutters.
 */
export function buildBigTop(kit: BoardTextures, x: number, z: number, face: number): Prop {
  const root = new THREE.Group();
  root.position.set(x, 0, z);
  root.rotation.y = face;
  const stripe = kit.stripe(palette.tentRed, palette.cream);

  const body = new THREE.Mesh(new THREE.CylinderGeometry(3.3, 3.5, 2.0, 24, 1, true), toonMat(kit, palette.white, { map: stripe }));
  body.position.y = 1.0;
  root.add(body, outline(body, 1.04));

  const trimGeo = new THREE.SphereGeometry(0.26, 8, 6);
  const trimMat = toonMat(kit, palette.sun);
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * Math.PI * 2;
    const b = new THREE.Mesh(trimGeo, trimMat);
    b.position.set(Math.cos(a) * 3.38, 2.0, Math.sin(a) * 3.38);
    b.scale.set(1, 0.7, 1);
    root.add(b);
  }

  const roof = new THREE.Mesh(new THREE.ConeGeometry(3.9, 2.4, 24, 1, true), toonMat(kit, palette.white, { map: stripe, side: THREE.DoubleSide }));
  roof.position.y = 2.0 + 1.2;
  root.add(roof, outline(roof, 1.05));
  const cap = new THREE.Mesh(new THREE.ConeGeometry(1.5, 1.6, 16), toonMat(kit, palette.white, { map: kit.stripe(palette.sun, palette.cream) }));
  cap.position.y = 4.4;
  root.add(cap, outline(cap, 1.08));

  // Entrance: an ink arch with gold posts, on the side facing the board (+x local).
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.5, 1.6), new THREE.MeshBasicMaterial({ color: palette.ink }));
  door.position.set(3.45, 0.75, 0);
  root.add(door);
  const postGeo = new THREE.CylinderGeometry(0.1, 0.1, 1.9, 8);
  for (const s of [-1, 1]) {
    const post = new THREE.Mesh(postGeo, toonMat(kit, palette.sun));
    post.position.set(3.6, 0.95, s * 0.95);
    root.add(post);
  }

  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 1.4, 8), toonMat(kit, palette.woodDark));
  pole.position.y = 5.6;
  root.add(pole);
  const flagShape = new THREE.Shape();
  flagShape.moveTo(0, 0);
  flagShape.lineTo(1.0, -0.25);
  flagShape.lineTo(0, -0.55);
  flagShape.closePath();
  const flag = new THREE.Mesh(new THREE.ShapeGeometry(flagShape), toonMat(kit, palette.candy, { side: THREE.DoubleSide }));
  flag.position.y = 6.25;
  root.add(flag);
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8), toonMat(kit, palette.sun));
  ball.position.y = 6.35;
  root.add(ball);

  shadowAll(root);
  return {
    root,
    update(t: number) {
      flag.rotation.y = Math.sin(t * 2.3) * 0.35;
      flag.scale.x = 0.9 + 0.1 * Math.sin(t * 4.1);
    },
  };
}

/** Helter-skelter: a striped lighthouse-like tower with a slide spiralling down it. */
export function buildHelterSkelter(kit: BoardTextures, x: number, z: number): Prop {
  const root = new THREE.Group();
  root.position.set(x, 0, z);
  const H = 5.2;
  const tower = new THREE.Mesh(
    new THREE.CylinderGeometry(0.85, 1.15, H, 16, 1, true),
    toonMat(kit, palette.white, { map: kit.stripe(palette.sun, palette.cream), side: THREE.DoubleSide })
  );
  tower.position.y = H / 2;
  root.add(tower, outline(tower, 1.06));
  const deck = new THREE.Mesh(new THREE.CylinderGeometry(1.35, 1.35, 0.22, 16), toonMat(kit, palette.berry));
  deck.position.y = H;
  root.add(deck, outline(deck, 1.06));
  const roof = new THREE.Mesh(new THREE.ConeGeometry(1.5, 1.6, 16), toonMat(kit, palette.white, { map: kit.stripe(palette.candy, palette.cream) }));
  roof.position.y = H + 1.0;
  root.add(roof, outline(roof, 1.08));
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), toonMat(kit, palette.sun));
  ball.position.y = H + 1.9;
  root.add(ball);

  // The slide: 2.4 turns from the deck down to a run-out on the grass.
  const TURNS = 2.4;
  const helixPts: THREE.Vector3[] = [];
  for (let i = 0; i <= 96; i++) {
    const u = i / 96;
    const a = u * Math.PI * 2 * TURNS;
    const r = 1.55 + 0.25 * u;
    helixPts.push(new THREE.Vector3(Math.cos(a) * r, H - 0.1 - u * (H - 0.35), Math.sin(a) * r));
  }
  const helix = new THREE.CatmullRomCurve3(helixPts);
  const slide = new THREE.Mesh(new THREE.TubeGeometry(helix, 120, 0.2, 6, false), toonMat(kit, palette.candy));
  root.add(slide);
  const rail = new THREE.Mesh(new THREE.TubeGeometry(helix, 120, 0.07, 5, false), toonMat(kit, palette.cream));
  rail.position.y = 0.2;
  root.add(rail);
  const mat = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 0.06, 14), toonMat(kit, palette.bubble));
  mat.position.set(Math.cos(Math.PI * 2 * TURNS) * 1.8, 0.03, Math.sin(Math.PI * 2 * TURNS) * 1.8);
  root.add(mat);

  shadowAll(root);
  return { root };
}

/**
 * Pier on the coast at heading `a`: planks on posts running out to sea, with
 * a little striped boat bobbing at the end.
 */
export function buildPier(kit: BoardTextures, island: IslandShape, a: number): Prop {
  const I = settings.board.island;
  const root = new THREE.Group();
  const r = island.radiusAt(a) - 1.2;
  root.position.set(island.cx + Math.cos(a) * r, 0, island.cz + Math.sin(a) * r);
  // Local +z points out to sea.
  root.rotation.y = Math.atan2(Math.cos(a), Math.sin(a));
  const LEN = 6.5;
  const deckY = -0.12;
  const plankMat = toonMat(kit, palette.wood);
  const plankGeo = new THREE.BoxGeometry(1.7, 0.14, 0.42);
  for (let i = 0; i < 14; i++) {
    const p = new THREE.Mesh(plankGeo, plankMat);
    p.position.set(0, deckY, 0.3 + i * 0.47);
    p.rotation.y = (i % 3 - 1) * 0.02;
    root.add(p);
  }
  const postGeo = new THREE.CylinderGeometry(0.11, 0.11, 1.8, 7);
  const postMat = toonMat(kit, palette.woodDark);
  for (let i = 0; i < 4; i++) {
    for (const s of [-1, 1]) {
      const post = new THREE.Mesh(postGeo, postMat);
      post.position.set(s * 0.8, deckY - 0.5, 1.4 + i * 1.6);
      root.add(post);
    }
  }
  // Boat: hull, gunwale stripe, a little mast with a pennant.
  const boat = new THREE.Group();
  boat.position.set(1.7, I.seaY + 0.15, LEN - 0.6);
  const hull = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), toonMat(kit, palette.candy, { side: THREE.DoubleSide }));
  hull.scale.set(0.75, 0.55, 1.5);
  hull.position.y = 0.45;
  boat.add(hull, outline(hull, 1.06));
  const rim = new THREE.Mesh(new THREE.TorusGeometry(1, 0.08, 6, 24), toonMat(kit, palette.cream));
  rim.rotation.x = Math.PI / 2;
  rim.scale.set(0.75, 1.5, 1);
  rim.position.y = 0.45;
  boat.add(rim);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.6, 6), toonMat(kit, palette.woodDark));
  mast.position.y = 1.2;
  boat.add(mast);
  const sail = new THREE.Mesh(
    new THREE.ShapeGeometry(
      (() => {
        const s = new THREE.Shape();
        s.moveTo(0, 0);
        s.lineTo(0, 1.1);
        s.lineTo(0.75, 0.1);
        s.closePath();
        return s;
      })()
    ),
    toonMat(kit, palette.sun, { side: THREE.DoubleSide })
  );
  sail.position.set(0.04, 0.6, 0);
  sail.rotation.y = Math.PI / 2;
  boat.add(sail);
  root.add(boat);

  shadowAll(root);
  return {
    root,
    update(t: number) {
      boat.position.y = I.seaY + 0.15 + Math.sin(t * 1.6) * 0.06;
      boat.rotation.z = Math.sin(t * 1.1) * 0.06;
      boat.rotation.x = Math.sin(t * 1.4 + 1) * 0.04;
    },
  };
}
