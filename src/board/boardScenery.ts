/**
 * SUPER STAR PARTY — board scenery. All props are 100% procedural, cel-shaded
 * (MeshToonMaterial + 3-band gradient map), ink-outlined on major props, and
 * colored ONLY from the palette. Everything casts/receives shadows.
 */
import * as THREE from "three";
import { palette } from "../config/palette";
import type { StampKind } from "../core/game";
import { settings } from "../config/settings";
import type { BoardTextures } from "./boardTextures";

export interface Prop {
  root: THREE.Object3D;
  /** Optional idle animation, called with accumulated time t and dt. */
  update?: (t: number, dt: number) => void;
}

const B = settings.board;

/** Cel material with the shared 3-band gradient map. */
export function toonMat(
  kit: BoardTextures,
  color: string,
  opts?: { map?: THREE.Texture; transparent?: boolean; opacity?: number; side?: THREE.Side }
): THREE.MeshToonMaterial {
  return new THREE.MeshToonMaterial({
    color,
    gradientMap: kit.grad,
    map: opts?.map ?? null,
    transparent: opts?.transparent ?? false,
    opacity: opts?.opacity ?? 1,
    side: opts?.side ?? THREE.FrontSide,
  });
}

/**
 * Ink outline shell: a BackSide clone of the same geometry scaled up, so the
 * silhouette gets a deep-violet cartoon border. Shares the source geometry.
 */
export function outline(src: THREE.Mesh, scale: number): THREE.Mesh {
  const shell = new THREE.Mesh(
    src.geometry,
    new THREE.MeshBasicMaterial({ color: palette.ink, side: THREE.BackSide })
  );
  shell.scale.setScalar(scale);
  shell.castShadow = false;
  shell.receiveShadow = false;
  shell.name = "ink-shell";
  return shell;
}

// ---- shared shapes ---------------------------------------------------------------
const starShape5 = ((): THREE.Shape => {
  const s = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? 1 : 0.42;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) s.moveTo(x, y);
    else s.lineTo(x, y);
  }
  s.closePath();
  return s;
})();

function sparkleShape(r: number): THREE.Shape {
  const s = new THREE.Shape();
  for (let i = 0; i < 8; i++) {
    const rr = i % 2 === 0 ? r : r * 0.22;
    const a = (i * Math.PI) / 4;
    const x = Math.cos(a) * rr;
    const y = Math.sin(a) * rr;
    if (i === 0) s.moveTo(x, y);
    else s.lineTo(x, y);
  }
  s.closePath();
  return s;
}

/** Flat 4-point twinkle, baked to lie on the ground plane, unlit (glowy). */
function sparkleMesh(kit: BoardTextures, color: string, r: number): THREE.Mesh {
  const g = new THREE.ShapeGeometry(sparkleShape(r));
  g.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
  m.castShadow = false;
  return m;
}

// ---- tents ------------------------------------------------------------------------
/**
 * Wider candy stripes for tents, drawn locally (boardTextures' 8-stripe kit
 * texture stays untouched). Fewer, thicker stripes read as tent stripes at
 * phone size instead of dissolving into specks.
 */
function tentStripeTexture(a: string, b: string, count: number): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext("2d")!;
  const w = 64 / count;
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = i % 2 === 0 ? a : b;
    ctx.fillRect(i * w, 0, w, 64);
  }
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

/** Striped carnival tent: cone top + cylinder body + swaying pennant flags. */
export function buildTent(kit: BoardTextures, x: number, z: number, stripeA: string, stripeB: string, phase: number): Prop {
  const root = new THREE.Group();
  root.position.set(x, 0, z);
  const stripes = tentStripeTexture(stripeA, stripeB, B.tentStripeCount);

  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(2.1, 2.4, 1.3, 12),
    [
      toonMat(kit, palette.white, { map: stripes }),
      toonMat(kit, stripeB),
      toonMat(kit, stripeB),
    ]
  );
  body.position.y = 0.65;
  body.castShadow = true;
  body.receiveShadow = true;
  root.add(body, outline(body, B.tentOutlineBody));

  const cone = new THREE.Mesh(
    new THREE.ConeGeometry(2.5, 1.9, 12),
    [toonMat(kit, palette.white, { map: stripes }), toonMat(kit, stripeB)]
  );
  cone.position.y = 1.3 + 0.95;
  cone.castShadow = true;
  cone.receiveShadow = true;
  root.add(cone, outline(cone, B.tentOutlineCone));

  // tip pole + ball
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 1.2, 8), toonMat(kit, palette.woodDark));
  pole.position.y = 3.8;
  pole.castShadow = true;
  root.add(pole);
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), toonMat(kit, palette.sun));
  ball.position.y = 4.45;
  root.add(ball);

  // pennant string from the tip down to a front stake, 3 flags that sway
  const p0 = new THREE.Vector3(0, 4.35, 0);
  const p1 = new THREE.Vector3(2.0, 0.3, 0);
  const dir = p1.clone().sub(p0);
  const ang = Math.atan2(dir.y, dir.x);
  const flagMats = [palette.sun, palette.candy, palette.bubble].map((c) => toonMat(kit, c, { side: THREE.DoubleSide }));
  const flagGeo = new THREE.ShapeGeometry(
    (() => {
      const s = new THREE.Shape();
      s.moveTo(0, 0);
      s.lineTo(0.52, 0);
      s.lineTo(0.26, 0.38);
      s.closePath();
      return s;
    })()
  );
  const flags: THREE.Group[] = [];
  for (let i = 0; i < 3; i++) {
    const t = 0.3 + i * 0.21;
    const g = new THREE.Group();
    g.position.copy(p0).add(dir.clone().multiplyScalar(t));
    const flag = new THREE.Mesh(flagGeo, flagMats[i % flagMats.length]);
    flag.position.set(-0.26, 0, 0); // center the flag on the string point
    g.add(flag);
    g.rotation.z = ang;
    root.add(g);
    flags.push(g);
  }

  // Scale the whole tent (body, cone, pole, ball, pennant string + flags) so
  // it reads as a coherent cluster at phone size.
  root.scale.setScalar(B.tentScale);

  return {
    root,
    update(t: number) {
      for (let i = 0; i < flags.length; i++) {
        flags[i].rotation.z = ang + Math.sin(t * B.pennantSway + phase + i * 1.15) * 0.13;
      }
    },
  };
}

// ---- ferris wheel -------------------------------------------------------------------
/** Rotating ferris wheel: rim, 6 spokes, 6 cabins that stay upright, A-frame legs. */
export function buildFerrisWheel(kit: BoardTextures, x: number, z: number): Prop {
  const root = new THREE.Group();
  root.position.set(x, 0, z);

  // A-frame legs + base bar
  const legMat = toonMat(kit, palette.woodDark);
  for (const s of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 4.0, 8), legMat);
    leg.position.set(0.75 * s, 1.8, 0);
    leg.rotation.z = -0.39 * s;
    leg.castShadow = true;
    root.add(leg);
  }
  const bar = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.16, 0.5), legMat);
  bar.position.y = 0.09;
  bar.castShadow = true;
  root.add(bar);

  const wheel = new THREE.Group();
  wheel.position.y = 3.6;
  root.add(wheel);

  const RIM = 2.9;
  const rim = new THREE.Mesh(new THREE.TorusGeometry(RIM, 0.1, 8, 40), toonMat(kit, palette.metal));
  rim.castShadow = true;
  wheel.add(rim, outline(rim, 1.08));

  const hub = new THREE.Mesh(new THREE.SphereGeometry(0.26, 12, 10), toonMat(kit, palette.sun));
  hub.castShadow = true;
  wheel.add(hub);

  const spokeMat = toonMat(kit, palette.metal);
  for (let i = 0; i < 3; i++) {
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(2.62, 0.12, 0.07), spokeMat);
    spoke.rotation.z = (i * Math.PI) / 3;
    spoke.castShadow = true;
    wheel.add(spoke);
  }

  const cabinColors = [palette.candy, palette.berry, palette.bubble, palette.sun, palette.mint, palette.candy];
  const cabins: THREE.Group[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3 + Math.PI / 6;
    const g = new THREE.Group();
    g.position.set(Math.cos(a) * 2.55, Math.sin(a) * 2.55, 0);
    const cab = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 10), toonMat(kit, cabinColors[i % cabinColors.length]));
    cab.castShadow = true;
    const roof = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.18, 8), toonMat(kit, palette.cream));
    roof.position.y = 0.3;
    roof.castShadow = true;
    g.add(cab, outline(cab, 1.16), roof);
    wheel.add(g);
    cabins.push(g);
  }

  return {
    root,
    update(_t: number, dt: number) {
      wheel.rotation.z += dt * B.ferrisSpin;
      for (const c of cabins) c.rotation.z = -wheel.rotation.z; // cabins stay upright
    },
  };
}

// ---- star fountain plaza --------------------------------------------------------------
/** Gold star on a pedestal in the middle of the board, with a pulsing sparkle ring. */
export function buildFountain(kit: BoardTextures, phase: number): Prop {
  const root = new THREE.Group();

  const basin = new THREE.Mesh(new THREE.CylinderGeometry(2.3, 2.0, 0.35, 24), toonMat(kit, palette.metal));
  basin.position.y = 0.175;
  basin.castShadow = true;
  basin.receiveShadow = true;
  root.add(basin, outline(basin, 1.05));

  const water = new THREE.Mesh(
    new THREE.CircleGeometry(2.15, 24),
    toonMat(kit, palette.bubble, { transparent: true, opacity: 0.6 })
  );
  water.geometry.rotateX(-Math.PI / 2);
  water.position.y = 0.36;
  water.receiveShadow = true;
  root.add(water);

  const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.85, 1.05, 16), toonMat(kit, palette.wood));
  pedestal.position.y = 0.88;
  pedestal.castShadow = true;
  root.add(pedestal, outline(pedestal, 1.06));

  const starGeo = new THREE.ExtrudeGeometry(starShape5, {
    depth: 0.16,
    bevelEnabled: true,
    bevelThickness: 0.06,
    bevelSize: 0.06,
    bevelSegments: 2,
  });
  const star = new THREE.Mesh(starGeo, toonMat(kit, palette.sun));
  star.position.y = 1.45;
  star.castShadow = true;
  root.add(star, outline(star, 1.14));

  // sparkles orbiting the star + a wide pulsing ring around the basin
  const orbit: THREE.Mesh[] = [];
  for (let i = 0; i < 3; i++) {
    const s = sparkleMesh(kit, palette.white, 0.15);
    orbit.push(s);
    root.add(s);
  }
  const ring: THREE.Mesh[] = [];
  for (let i = 0; i < 10; i++) {
    const s = sparkleMesh(kit, palette.sun, 0.14);
    s.material = (s.material as THREE.MeshBasicMaterial).clone();
    (s.material as THREE.MeshBasicMaterial).transparent = true;
    ring.push(s);
    root.add(s);
  }

  return {
    root,
    update(t: number) {
      star.position.y = 1.45 + Math.sin(t * B.starBobSpeed + phase) * B.starBobAmp;
      star.rotation.y = t * B.starSpinSpeed + phase;
      for (let i = 0; i < orbit.length; i++) {
        const a = t * 1.5 + phase + (i * Math.PI * 2) / 3;
        orbit[i].position.set(Math.cos(a) * 1.05, 1.7 + Math.sin(t * 2.1 + phase + i) * 0.07, Math.sin(a) * 1.05);
        orbit[i].scale.setScalar(0.7 + 0.5 * Math.sin(t * 5 + phase + i * 2.1));
      }
      for (let i = 0; i < ring.length; i++) {
        const a = t * 0.5 + phase + (i * Math.PI * 2) / 10;
        // elliptical ring to match the board's interior shape
        ring[i].position.set(Math.cos(a) * 2.35, 0.5, Math.sin(a) * 1.55);
        const p = 0.6 + 0.5 * Math.sin(t * B.fountainPulse * 1.4 + i * 1.7);
        ring[i].scale.setScalar(0.6 + 0.5 * p);
        (ring[i].material as THREE.MeshBasicMaterial).opacity = 0.35 + 0.45 * p;
      }
    },
  };
}

// ---- gumball machines ------------------------------------------------------------------
/** Tiny gumball machine prop for shop spaces. */
export function buildGumballMachine(kit: BoardTextures, x: number, z: number): Prop {
  const root = new THREE.Group();
  root.position.set(x, 0, z);

  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.62, 0.62, 14), toonMat(kit, palette.wood));
  base.position.y = 0.31;
  base.castShadow = true;
  root.add(base, outline(base, 1.08));

  const globe = new THREE.Mesh(
    new THREE.SphereGeometry(0.42, 16, 12),
    toonMat(kit, palette.bubble, { transparent: true, opacity: 0.55 })
  );
  globe.position.y = 1.06;
  globe.castShadow = true;
  root.add(globe, outline(globe, 1.1));

  const gumColors = [palette.candy, palette.sun, palette.mint, palette.bubble, palette.berry];
  const gumSpots: [number, number, number][] = [
    [0.05, 0.14, 0.09],
    [-0.13, 0.2, -0.05],
    [0.15, 0.24, -0.11],
    [-0.06, 0.3, 0.11],
    [0.1, 0.34, 0.02],
  ];
  for (let i = 0; i < gumSpots.length; i++) {
    const g = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), toonMat(kit, gumColors[i % gumColors.length]));
    g.position.set(1.06 + gumSpots[i][0], gumSpots[i][1], gumSpots[i][2]);
    g.castShadow = false;
    root.add(g);
  }

  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.3, 0.14, 12), toonMat(kit, palette.candy));
  cap.position.y = 1.54;
  cap.castShadow = true;
  root.add(cap);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), toonMat(kit, palette.sun));
  knob.position.y = 1.66;
  root.add(knob);

  return { root };
}

// ---- lamp posts --------------------------------------------------------------------------
/** Lamp post with a warm unlit glow sphere (reads as light without a real light). */
export function buildLampPost(kit: BoardTextures, x: number, z: number): Prop {
  const root = new THREE.Group();
  root.position.set(x, 0, z);

  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, 3.1, 8), toonMat(kit, palette.woodDark));
  pole.position.y = 1.55;
  pole.castShadow = true;
  root.add(pole, outline(pole, 1.1));

  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.7, 8), toonMat(kit, palette.woodDark));
  arm.position.set(0.32, 2.85, 0);
  arm.rotation.z = -0.35;
  root.add(arm);

  const glow = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 10), new THREE.MeshBasicMaterial({ color: palette.sun }));
  glow.position.set(0.62, 2.7, 0);
  root.add(glow);
  const halo = new THREE.Mesh(
    new THREE.SphereGeometry(0.46, 12, 10),
    new THREE.MeshBasicMaterial({ color: palette.sun, transparent: true, opacity: 0.22 })
  );
  halo.position.set(0.62, 2.7, 0);
  root.add(halo);
  const cap = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.16, 8), toonMat(kit, palette.ink));
  cap.position.set(0.62, 3.0, 0);
  root.add(cap);

  return { root };
}

// ---- balloon clusters ---------------------------------------------------------------------
/** A few colored balloons on one string, gently swaying. */
export function buildBalloons(kit: BoardTextures, x: number, z: number, phase: number): Prop {
  const root = new THREE.Group();
  root.position.set(x, 0, z);

  const stake = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.34, 8), toonMat(kit, palette.woodDark));
  stake.position.y = 0.17;
  root.add(stake);
  const string = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 1.75, 6), toonMat(kit, palette.woodDark));
  string.position.y = 1.12;
  root.add(string);

  const colors = [palette.candy, palette.bubble, palette.mint, palette.sun, palette.berry];
  const spots: [number, number, number][] = [
    [0, 2.25, 0],
    [0.3, 2.45, 0.12],
    [-0.32, 2.35, -0.08],
    [0.16, 2.62, 0.2],
    [-0.2, 2.55, -0.16],
  ];
  for (let i = 0; i < spots.length; i++) {
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.21 + (i % 2) * 0.04, 12, 10), toonMat(kit, colors[i % colors.length]));
    b.position.set(spots[i][0], spots[i][1], spots[i][2]);
    b.castShadow = true;
    root.add(b);
  }

  return {
    root,
    update(t: number) {
      root.rotation.z = Math.sin(t * B.balloonSway + phase) * 0.05;
      root.rotation.x = Math.sin(t * B.balloonSway * 0.7 + phase) * 0.04;
    },
  };
}

// ---- per-space props ------------------------------------------------------------------------
/** Golden star prop for star spaces: bobs, spins, sparkles. */
export function buildStarProp(kit: BoardTextures, phase: number): Prop {
  const root = new THREE.Group();

  const starGeo = new THREE.ExtrudeGeometry(starShape5, {
    depth: 0.15,
    bevelEnabled: true,
    bevelThickness: 0.05,
    bevelSize: 0.05,
    bevelSegments: 2,
  });
  const star = new THREE.Mesh(starGeo, toonMat(kit, palette.sun));
  star.position.y = 0.75;
  star.castShadow = true;
  root.add(star, outline(star, 1.15));

  const sparks: THREE.Mesh[] = [];
  for (let i = 0; i < 3; i++) {
    const s = sparkleMesh(kit, palette.white, 0.16);
    sparks.push(s);
    root.add(s);
  }

  return {
    root,
    update(t: number) {
      star.position.y = 0.75 + Math.sin(t * B.starBobSpeed + phase) * B.starBobAmp;
      star.rotation.y = t * B.starSpinSpeed + phase;
      for (let i = 0; i < sparks.length; i++) {
        const a = t * 1.6 + phase + (i * Math.PI * 2) / 3;
        sparks[i].position.set(Math.cos(a) * 0.9, 0.88 + Math.sin(t * 2.2 + phase + i) * 0.06, Math.sin(a) * 0.9);
        sparks[i].scale.setScalar(0.6 + 0.5 * Math.sin(t * 5 + phase + i * 2.1));
      }
    },
  };
}

const STAMP_SEAL_COLOR: Record<StampKind, string> = {
  shy: palette.lava,
  goomba: palette.wood,
  koopa: palette.mint,
};

/**
 * Bobbing seal for a stamp space. The letter (S / G / K) and seal color
 * tell Shy Guy, Goomba, and Koopa apart from the party camera.
 */
export function buildStampProp(kit: BoardTextures, kind: StampKind, phase: number): Prop {
  const root = new THREE.Group();
  const seal = new THREE.Mesh(
    new THREE.CylinderGeometry(0.42, 0.46, 0.1, 20),
    [
      toonMat(kit, palette.ink),
      toonMat(kit, palette.white, { map: kit.stampSeal[kind] }),
      toonMat(kit, STAMP_SEAL_COLOR[kind]),
    ]
  );
  seal.castShadow = true;
  seal.position.y = 0.7;
  // Same yaw as space disks so the initial reads upright from the south camera.
  seal.rotation.y = Math.PI / 2;
  root.add(seal);

  return {
    root,
    update(t: number) {
      seal.position.y = 0.7 + Math.sin(t * 1.7 + phase) * 0.07;
      seal.rotation.y = Math.PI / 2 + Math.sin(t * 0.7 + phase) * 0.18;
    },
  };
}

/**
 * One carnival balloon on a string, pink for 5 coins and gold for 10,
 * with a cream price tag that bobs with it.
 */
export function buildSpaceBalloon(kit: BoardTextures, coins: 5 | 10, phase: number): Prop {
  const root = new THREE.Group();
  const bodyColor = coins === 10 ? palette.sun : palette.candy;
  const bob = new THREE.Group();

  const string = new THREE.Mesh(
    new THREE.CylinderGeometry(0.02, 0.02, 0.7, 6),
    toonMat(kit, palette.ink)
  );
  string.position.y = 0.55;
  bob.add(string);

  const balloon = new THREE.Mesh(
    new THREE.SphereGeometry(0.36, 14, 12),
    toonMat(kit, bodyColor)
  );
  balloon.position.y = 1.15;
  balloon.castShadow = true;
  bob.add(balloon);
  const shell = outline(balloon, 1.08);
  shell.position.copy(balloon.position);
  bob.add(shell);

  const knot = new THREE.Mesh(
    new THREE.ConeGeometry(0.08, 0.12, 6),
    toonMat(kit, bodyColor)
  );
  knot.position.y = 0.82;
  knot.rotation.x = Math.PI;
  bob.add(knot);

  const badge = new THREE.Mesh(
    new THREE.CylinderGeometry(0.2, 0.2, 0.06, 16),
    [
      toonMat(kit, palette.ink),
      toonMat(kit, palette.white, { map: kit.balloonBadge[coins], transparent: true }),
      toonMat(kit, palette.cream),
    ]
  );
  badge.position.y = 1.42;
  badge.rotation.y = Math.PI / 2;
  bob.add(badge);

  root.add(bob);
  return {
    root,
    update(t: number) {
      bob.position.y = Math.sin(t * B.balloonSway + phase) * 0.08;
      bob.rotation.z = Math.sin(t * B.balloonSway * 0.8 + phase) * 0.06;
    },
  };
}

/**
 * The Grand Prize Balloon: one big gold balloon with a spinning star on top.
 * The board scene parents it and slides it to match.starBalloonPos.
 */
export function buildGrandPrizeBalloon(kit: BoardTextures): Prop {
  const root = new THREE.Group();
  const bob = new THREE.Group();

  const string = new THREE.Mesh(
    new THREE.CylinderGeometry(0.025, 0.025, 0.85, 6),
    toonMat(kit, palette.ink)
  );
  string.position.y = 0.62;
  bob.add(string);

  const balloon = new THREE.Mesh(
    new THREE.SphereGeometry(0.52, 16, 14),
    toonMat(kit, palette.sun)
  );
  balloon.position.y = 1.42;
  balloon.castShadow = true;
  bob.add(balloon);
  const shell = outline(balloon, 1.06);
  shell.position.copy(balloon.position);
  bob.add(shell);

  const band = new THREE.Mesh(
    new THREE.TorusGeometry(0.4, 0.045, 8, 20),
    toonMat(kit, palette.candy)
  );
  band.position.y = 1.42;
  band.rotation.x = Math.PI / 2;
  bob.add(band);

  const knot = new THREE.Mesh(
    new THREE.ConeGeometry(0.1, 0.16, 6),
    toonMat(kit, palette.sunDeep)
  );
  knot.position.y = 0.96;
  knot.rotation.x = Math.PI;
  bob.add(knot);

  const starGeo = new THREE.ExtrudeGeometry(starShape5, {
    depth: 0.08,
    bevelEnabled: true,
    bevelThickness: 0.02,
    bevelSize: 0.02,
    bevelSegments: 1,
  });
  const star = new THREE.Mesh(starGeo, toonMat(kit, palette.white));
  star.scale.setScalar(0.32);
  star.position.y = 2.12;
  star.castShadow = true;
  bob.add(star);

  root.add(bob);
  return {
    root,
    update(t: number) {
      bob.position.y = Math.sin(t * B.balloonSway) * 0.1;
      bob.rotation.z = Math.sin(t * B.balloonSway * 0.8) * 0.06;
      star.rotation.y = t * B.starSpinSpeed;
    },
  };
}

/** Grumpy face disc that sits on grumpus space disks. */
export function buildGrumpyFace(kit: BoardTextures): THREE.Object3D {
  const disc = new THREE.Mesh(
    new THREE.CylinderGeometry(0.52, 0.54, 0.07, 20),
    [
      toonMat(kit, palette.lavaDeep),
      toonMat(kit, palette.white, { map: kit.face, transparent: true }),
      toonMat(kit, palette.lavaDeep),
    ]
  );
  disc.position.y = 0.165;
  disc.receiveShadow = true;
  return disc;
}

/** Build a copy of `src` scaled by `s` about the origin (Shape has no scale). */
function scaledShape(src: THREE.Shape, s: number): THREE.Shape {
  const out = new THREE.Shape();
  src.getPoints(0).forEach((p, i) => {
    if (i === 0) out.moveTo(p.x * s, p.y * s);
    else out.lineTo(p.x * s, p.y * s);
  });
  out.closePath();
  return out;
}

/** Gold arrow marking the start space, aimed along the direction of travel. */
export function buildStartArrow(kit: BoardTextures): THREE.Object3D {
  const root = new THREE.Group();
  const shape = new THREE.Shape();
  shape.moveTo(0, 0.42);
  shape.lineTo(-0.34, -0.26);
  shape.lineTo(-0.11, -0.26);
  shape.lineTo(-0.11, -0.42);
  shape.lineTo(0.11, -0.42);
  shape.lineTo(0.11, -0.26);
  shape.lineTo(0.34, -0.26);
  shape.closePath();
  const inkShape = scaledShape(shape, 1.35);

  const base = new THREE.Mesh(new THREE.ShapeGeometry(inkShape), toonMat(kit, palette.ink));
  base.geometry.rotateX(-Math.PI / 2);
  base.position.y = -0.012;
  const tip = new THREE.Mesh(new THREE.ShapeGeometry(shape), toonMat(kit, palette.sun));
  tip.geometry.rotateX(-Math.PI / 2);
  root.add(base, tip);
  root.position.y = 0.15;
  return root;
}
