/**
 * SUPER STAR PARTY — the Hidden Block prop (presentation only).
 *
 * A chunky gold "?" block that pops into the air above a player. Looks:
 *   mystery — gold with a "?" on every side (the reveal block)
 *   dice    — the Coin Dice Block: a cream die whose pips are gold coins;
 *             every bonk flips it to the next face and spits out a coin
 *   spent   — dull wood, once it has been emptied
 *
 * No gameplay rng here: everything cosmetic runs on fixed sequences, so the
 * seeded match is identical with or without a renderer.
 */
import * as THREE from "three";
import { palette } from "../config/palette";
import { celGradient } from "../characters/cel";

export type HiddenBlockLook = "mystery" | "dice" | "spent";
export type HiddenBlockReveal = "star" | "item" | "coins";

export interface HiddenBlockProp {
  root: THREE.Group;
  setLook(look: HiddenBlockLook): void;
  /** Hit reaction: the block jumps, squashes, and a die flips to its next face. */
  bump(): void;
  /** A coin pops out of the top and spins away. */
  popCoin(): void;
  /** The prize icon rises out of the block. */
  reveal(icon: HiddenBlockReveal): void;
  /** Shrink away; update() returns false once gone. */
  vanish(): void;
  update(dt: number): boolean;
  dispose(): void;
}

const TEX = 128;
const SIZE = 0.9;

function canvas(): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = TEX;
  c.height = TEX;
  return [c, c.getContext("2d")!];
}

function tex(c: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Block face: colored panel, darker bevel, ink keyline, four rivets. */
function panel(ctx: CanvasRenderingContext2D, base: string, deep: string, rivets: boolean): void {
  ctx.fillStyle = palette.ink;
  ctx.fillRect(0, 0, TEX, TEX);
  ctx.fillStyle = deep;
  roundRect(ctx, 4, 4, TEX - 8, TEX - 8, 14);
  ctx.fill();
  ctx.fillStyle = base;
  roundRect(ctx, 12, 12, TEX - 24, TEX - 24, 10);
  ctx.fill();
  // top-left sheen
  ctx.fillStyle = "rgba(255,255,255,0.35)";
  roundRect(ctx, 18, 18, TEX - 52, 10, 5);
  ctx.fill();
  if (!rivets) return;
  ctx.fillStyle = deep;
  for (const [x, y] of [[22, 22], [TEX - 22, 22], [22, TEX - 22], [TEX - 22, TEX - 22]]) {
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Copy a face texture turned half a turn: the box's top face reads upright from the board camera. */
function flipped(src: THREE.CanvasTexture): THREE.CanvasTexture {
  const [c, ctx] = canvas();
  ctx.translate(TEX, TEX);
  ctx.rotate(Math.PI);
  ctx.drawImage(src.image as HTMLCanvasElement, 0, 0);
  return tex(c);
}

function mysteryFace(): THREE.CanvasTexture {
  const [c, ctx] = canvas();
  panel(ctx, palette.sun, palette.sunDeep, true);
  ctx.font = "700 84px Fredoka, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.lineWidth = 12;
  ctx.strokeStyle = palette.ink;
  ctx.strokeText("?", TEX / 2, TEX / 2 + 6);
  ctx.fillStyle = palette.white;
  ctx.fillText("?", TEX / 2, TEX / 2 + 6);
  return tex(c);
}

function coin(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.fillStyle = palette.sun;
  ctx.strokeStyle = palette.ink;
  ctx.lineWidth = 3.5;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = palette.sunDeep;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(x, y, r * 0.6, 0, Math.PI * 2);
  ctx.stroke();
}

const PIPS: Record<number, [number, number][]> = {
  1: [[0, 0]],
  2: [[-1, -1], [1, 1]],
  3: [[-1, -1], [0, 0], [1, 1]],
  4: [[-1, -1], [1, -1], [-1, 1], [1, 1]],
  5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]],
  6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]],
};

/** A die face whose pips are gold coins. */
function diceFace(n: number): THREE.CanvasTexture {
  const [c, ctx] = canvas();
  panel(ctx, palette.cream, palette.bubbleDeep, false);
  const r = n === 1 ? 20 : 12;
  for (const [dx, dy] of PIPS[n]) coin(ctx, TEX / 2 + dx * 30, TEX / 2 + dy * 30, r);
  return tex(c);
}

function spentFace(): THREE.CanvasTexture {
  const [c, ctx] = canvas();
  panel(ctx, palette.wood, palette.woodDark, true);
  return tex(c);
}

function revealTexture(icon: HiddenBlockReveal): THREE.CanvasTexture {
  const [c, ctx] = canvas();
  ctx.clearRect(0, 0, TEX, TEX);
  const cx = TEX / 2;
  const cy = TEX / 2;
  ctx.lineJoin = "round";
  if (icon === "star") {
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const rr = i % 2 === 0 ? 56 : 25;
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const x = cx + Math.cos(a) * rr;
      const y = cy + 4 + Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.lineWidth = 9;
    ctx.strokeStyle = palette.ink;
    ctx.stroke();
    ctx.fillStyle = palette.sun;
    ctx.fill();
    ctx.fillStyle = palette.ink;
    ctx.beginPath();
    ctx.ellipse(cx - 11, cy + 2, 4.5, 8, 0, 0, Math.PI * 2);
    ctx.ellipse(cx + 11, cy + 2, 4.5, 8, 0, 0, Math.PI * 2);
    ctx.fill();
  } else if (icon === "item") {
    // A gift box with a candy ribbon.
    ctx.lineWidth = 7;
    ctx.strokeStyle = palette.ink;
    ctx.fillStyle = palette.berry;
    roundRect(ctx, 22, 50, 84, 62, 8);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = palette.berryDeep;
    roundRect(ctx, 16, 36, 96, 22, 7);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = palette.candy;
    ctx.fillRect(57, 37, 14, 74);
    ctx.strokeRect(57, 37, 14, 74);
    ctx.beginPath();
    ctx.ellipse(50, 28, 15, 10, -0.5, 0, Math.PI * 2);
    ctx.ellipse(78, 28, 15, 10, 0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  } else {
    coin(ctx, cx, cy, 50);
    ctx.fillStyle = palette.white;
    ctx.beginPath();
    ctx.arc(cx - 18, cy - 18, 7, 0, Math.PI * 2);
    ctx.fill();
  }
  return tex(c);
}

// Shared across every block: built on first use.
let shared: {
  mystery: THREE.CanvasTexture;
  mysteryTop: THREE.CanvasTexture;
  dice: THREE.CanvasTexture[];
  diceTop: THREE.CanvasTexture[];
  spent: THREE.CanvasTexture;
  reveal: Record<HiddenBlockReveal, THREE.CanvasTexture>;
} | null = null;

function textures(): NonNullable<typeof shared> {
  if (!shared) {
    const mystery = mysteryFace();
    const dice = [1, 2, 3, 4, 5, 6].map(diceFace);
    shared = {
      mystery,
      mysteryTop: flipped(mystery),
      dice,
      diceTop: dice.map(flipped),
      spent: spentFace(),
      reveal: { star: revealTexture("star"), item: revealTexture("item"), coins: revealTexture("coins") },
    };
  }
  return shared;
}

const easeOutBack = (p: number): number => {
  const c1 = 1.9;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2);
};

export function createHiddenBlock(): HiddenBlockProp {
  const T = textures();
  const root = new THREE.Group();
  root.name = "hidden-block";

  const spin = new THREE.Group(); // cosmetic idle spin + die flips
  root.add(spin);
  // Six materials, one per box side, so the die can show a different face per side.
  const mats = Array.from(
    { length: 6 },
    () => new THREE.MeshToonMaterial({ gradientMap: celGradient, map: T.mystery }),
  );
  const geo = new THREE.BoxGeometry(SIZE, SIZE, SIZE);
  const box = new THREE.Mesh(geo, mats);
  box.castShadow = true;
  spin.add(box);
  const inkGeo = new THREE.BoxGeometry(SIZE * 1.07, SIZE * 1.07, SIZE * 1.07);
  const inkMat = new THREE.MeshBasicMaterial({ color: palette.ink, side: THREE.BackSide });
  spin.add(new THREE.Mesh(inkGeo, inkMat));

  // Prize icon that rises out of the block (a billboard sprite).
  const revealMat = new THREE.SpriteMaterial({ map: T.reveal.coins, transparent: true, depthTest: false });
  const revealSprite = new THREE.Sprite(revealMat);
  revealSprite.visible = false;
  revealSprite.renderOrder = 10;
  root.add(revealSprite);

  // Coin pool for the Coin Dice Block.
  const coinGeo = new THREE.CylinderGeometry(0.16, 0.16, 0.05, 18);
  coinGeo.rotateX(Math.PI / 2);
  const coinMat = new THREE.MeshToonMaterial({ gradientMap: celGradient, color: palette.sun, transparent: true });
  const coins: { mesh: THREE.Mesh; t: number; dir: number }[] = [];
  for (let i = 0; i < 8; i++) {
    const mesh = new THREE.Mesh(coinGeo, coinMat.clone());
    mesh.visible = false;
    root.add(mesh);
    coins.push({ mesh, t: -1, dir: 0 });
  }
  let nextCoin = 0;
  let coinSide = 0;

  let t = 0;
  let spawnT = 0;
  let bumpT = -1;
  let revealT = -1;
  let vanishT = -1;
  let look: HiddenBlockLook = "mystery";
  let face = 0; // which die face sits on the camera-facing side
  let flipFrom = 0;
  let flipT = -1;

  const paint = (): void => {
    if (look === "dice") {
      // Box sides: +x, -x, +y, -y, +z, -z. Front (+z) shows `face`.
      const order = [face + 1, face + 4, face + 2, face + 5, face, face + 3];
      order.forEach((f, i) => {
        mats[i].map = (i === 2 ? T.diceTop : T.dice)[f % 6];
        mats[i].needsUpdate = true;
      });
      return;
    }
    mats.forEach((m, i) => {
      m.map = look === "spent" ? T.spent : i === 2 ? T.mysteryTop : T.mystery;
      m.needsUpdate = true;
    });
  };

  const prop: HiddenBlockProp = {
    root,
    setLook(next) {
      look = next;
      paint();
    },
    bump() {
      bumpT = 0;
      if (look === "dice") {
        flipFrom = spin.rotation.x;
        flipT = 0;
        face = (face + 1) % 6;
        paint();
      }
    },
    popCoin() {
      const c = coins[nextCoin];
      nextCoin = (nextCoin + 1) % coins.length;
      coinSide += 1;
      c.t = 0;
      c.dir = coinSide % 2 === 0 ? 1 : -1;
      c.mesh.visible = true;
    },
    reveal(icon) {
      revealMat.map = T.reveal[icon];
      revealMat.needsUpdate = true;
      revealSprite.visible = true;
      revealT = 0;
    },
    vanish() {
      if (vanishT < 0) vanishT = 0;
    },
    update(dt) {
      t += dt;
      // Pop in: grow from nothing with an overshoot and a quarter turn.
      spawnT = Math.min(1, spawnT + dt / 0.45);
      let s = easeOutBack(spawnT);
      if (vanishT >= 0) {
        vanishT += dt;
        s *= Math.max(0, 1 - vanishT / 0.35);
      }
      // Hit: jump up and squash.
      let lift = Math.sin(t * 2.4) * 0.06;
      let sy = 1;
      if (bumpT >= 0) {
        bumpT += dt;
        const p = Math.min(1, bumpT / 0.22);
        lift += Math.sin(Math.PI * p) * 0.28;
        sy = 1 - Math.sin(Math.PI * p) * 0.12;
        if (p >= 1) bumpT = -1;
      }
      spin.position.y = lift;
      spin.scale.set(s * (2 - sy), s * sy, s * (2 - sy));
      if (look === "dice" && flipT >= 0) {
        flipT += dt;
        const p = Math.min(1, flipT / 0.18);
        spin.rotation.x = flipFrom + (1 - p) * Math.PI * 0.5;
        if (p >= 1) {
          flipT = -1;
          spin.rotation.x = 0;
        }
      } else if (look !== "dice") {
        spin.rotation.y = (1 - spawnT) * Math.PI * 0.5 + Math.sin(t * 1.3) * 0.18;
      } else {
        spin.rotation.y = 0;
      }
      if (revealT >= 0) {
        revealT += dt;
        const p = Math.min(1, revealT / 0.5);
        revealSprite.position.y = SIZE * 0.5 + easeOutBack(p) * 0.85;
        const r = 0.9 * Math.min(1, p * 1.6);
        revealSprite.scale.set(r, r, 1);
        revealMat.opacity = vanishT >= 0 ? Math.max(0, 1 - vanishT / 0.35) : 1;
      }
      for (const c of coins) {
        if (c.t < 0) continue;
        c.t += dt;
        const p = c.t / 0.6;
        if (p >= 1) {
          c.t = -1;
          c.mesh.visible = false;
          continue;
        }
        c.mesh.position.set(c.dir * p * 0.45, SIZE * 0.55 + Math.sin(Math.PI * p) * 0.9 + p * 0.3, 0.1);
        c.mesh.rotation.y = c.t * 18;
        (c.mesh.material as THREE.MeshToonMaterial).opacity = 1 - Math.max(0, p - 0.6) / 0.4;
      }
      return !(vanishT >= 0.35);
    },
    dispose() {
      root.parent?.remove(root);
      geo.dispose();
      inkGeo.dispose();
      inkMat.dispose();
      coinGeo.dispose();
      coinMat.dispose();
      for (const c of coins) (c.mesh.material as THREE.Material).dispose();
      for (const m of mats) m.dispose();
      revealMat.dispose();
    },
  };
  paint();
  return prop;
}
