/**
 * PIE FLICK — the shared art kit: pies, customers, order bubbles, popups.
 *
 * Everything that is made many times (a pie per throw, a customer per stool,
 * a bubble per order) is built from ONE set of geometries and materials owned
 * by the kit, so a round allocates them once and `dispose` frees them all.
 * Presentation only: no rng, no simulation state.
 */
import * as THREE from "three";
import { palette, hex } from "../../config/palette";
import { celGradient } from "../../characters/cel";
import { FLAVOR_COUNT } from "./rules";

/** The four pies. Each has its own color AND its own mark, so color is never the only cue. */
export const FLAVORS: readonly { name: string; color: string; deep: string }[] = [
  { name: "cherry", color: palette.spaceRed, deep: palette.spaceRedDeep },
  { name: "blueberry", color: palette.spaceBlue, deep: palette.spaceBlueDeep },
  { name: "lemon", color: palette.sun, deep: palette.sunDeep },
  { name: "lime", color: palette.leaf, deep: palette.leafDeep },
];

export type Face = "wait" | "happy" | "eat" | "grump";
const FACES: readonly Face[] = ["wait", "happy", "eat", "grump"];

function canvas(w: number, h: number): { c: HTMLCanvasElement; g: CanvasRenderingContext2D | null } {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return { c, g: c.getContext("2d") };
}

function texOf(c: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** The top of a pie, drawn on a canvas: flavor color and its mark. */
function drawPie(g: CanvasRenderingContext2D, flavor: number, cx: number, cy: number, r: number): void {
  const f = FLAVORS[flavor];
  g.lineJoin = "round";
  g.lineCap = "round";
  // Crust and filling.
  g.fillStyle = palette.sunDeep;
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = palette.ink;
  g.lineWidth = r * 0.08;
  g.stroke();
  g.fillStyle = f.color;
  g.beginPath();
  g.arc(cx, cy, r * 0.8, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = f.deep;
  g.lineWidth = r * 0.05;
  g.stroke();
  // Crimped crust edge.
  g.fillStyle = palette.sand;
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    g.beginPath();
    g.arc(cx + Math.cos(a) * r * 0.9, cy + Math.sin(a) * r * 0.9, r * 0.065, 0, Math.PI * 2);
    g.fill();
  }
  g.save();
  g.beginPath();
  g.arc(cx, cy, r * 0.78, 0, Math.PI * 2);
  g.clip();
  if (flavor === 0) {
    // Cherry: a lattice crust and a cherry in the middle.
    g.strokeStyle = palette.sand;
    g.lineWidth = r * 0.12;
    for (let k = -2; k <= 2; k++) {
      g.beginPath();
      g.moveTo(cx - r + k * r * 0.4, cy - r);
      g.lineTo(cx + r + k * r * 0.4, cy + r);
      g.moveTo(cx + r + k * r * 0.4, cy - r);
      g.lineTo(cx - r + k * r * 0.4, cy + r);
      g.stroke();
    }
  } else if (flavor === 1) {
    // Blueberry: berries.
    const spots: [number, number][] = [[-0.38, -0.2], [0.1, -0.45], [0.42, -0.1], [-0.12, 0.12], [0.34, 0.38], [-0.42, 0.38], [0.05, 0.62]];
    for (const [x, y] of spots) {
      g.fillStyle = palette.berryDeep;
      g.beginPath();
      g.arc(cx + x * r, cy + y * r, r * 0.17, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = palette.white;
      g.beginPath();
      g.arc(cx + x * r - r * 0.05, cy + y * r - r * 0.05, r * 0.045, 0, Math.PI * 2);
      g.fill();
    }
  } else if (flavor === 2) {
    // Lemon: whipped meringue peaks.
    g.fillStyle = palette.cream;
    for (let ring = 0; ring < 2; ring++) {
      const n = ring === 0 ? 1 : 6;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const d = ring === 0 ? 0 : r * 0.42;
        g.beginPath();
        g.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, r * (ring === 0 ? 0.3 : 0.2), 0, Math.PI * 2);
        g.fill();
        g.strokeStyle = palette.sunDeep;
        g.lineWidth = r * 0.04;
        g.stroke();
      }
    }
  } else {
    // Lime: a slice in the middle.
    g.fillStyle = palette.mint;
    g.beginPath();
    g.arc(cx, cy, r * 0.46, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = palette.white;
    g.lineWidth = r * 0.06;
    g.stroke();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      g.beginPath();
      g.moveTo(cx, cy);
      g.lineTo(cx + Math.cos(a) * r * 0.42, cy + Math.sin(a) * r * 0.42);
      g.stroke();
    }
  }
  g.restore();
  if (flavor === 0) {
    g.fillStyle = palette.spaceRedDeep;
    g.strokeStyle = palette.ink;
    g.lineWidth = r * 0.05;
    g.beginPath();
    g.arc(cx, cy, r * 0.17, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    g.strokeStyle = palette.leafDeep;
    g.lineWidth = r * 0.05;
    g.beginPath();
    g.moveTo(cx, cy - r * 0.17);
    g.quadraticCurveTo(cx + r * 0.12, cy - r * 0.34, cx + r * 0.22, cy - r * 0.3);
    g.stroke();
  }
}

function pieTopTexture(flavor: number): THREE.CanvasTexture {
  const { c, g } = canvas(128, 128);
  if (g) drawPie(g, flavor, 64, 64, 60);
  return texOf(c);
}

/** A speech bubble holding the pie a customer wants, rimmed in the flavor color. */
function bubbleTexture(flavor: number): THREE.CanvasTexture {
  const { c, g } = canvas(160, 176);
  if (g) {
    const f = FLAVORS[flavor];
    g.lineJoin = "round";
    g.fillStyle = palette.white;
    g.strokeStyle = palette.ink;
    g.lineWidth = 9;
    g.beginPath();
    g.roundRect(8, 8, 144, 128, 40);
    g.moveTo(66, 134);
    g.lineTo(80, 168);
    g.lineTo(96, 134);
    g.fill();
    g.stroke();
    g.beginPath();
    g.moveTo(63, 128);
    g.lineTo(80, 164);
    g.lineTo(99, 128);
    g.fillStyle = palette.white;
    g.fill();
    g.strokeStyle = f.color;
    g.lineWidth = 11;
    g.beginPath();
    g.roundRect(20, 20, 120, 104, 30);
    g.stroke();
    drawPie(g, flavor, 80, 72, 42);
  }
  return texOf(c);
}

/** A customer's face for one mood. */
function faceTexture(face: Face): THREE.CanvasTexture {
  const { c, g } = canvas(160, 120);
  if (g) {
    g.lineJoin = "round";
    g.lineCap = "round";
    g.strokeStyle = palette.ink;
    g.fillStyle = palette.ink;
    g.lineWidth = 8;
    const eye = (x: number): void => {
      g.fillStyle = palette.white;
      g.beginPath();
      g.ellipse(x, 46, 17, 21, 0, 0, Math.PI * 2);
      g.fill();
      g.lineWidth = 6;
      g.stroke();
      g.fillStyle = palette.ink;
      g.beginPath();
      g.arc(x + 1, 52, 9, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = palette.white;
      g.beginPath();
      g.arc(x + 5, 47, 3.2, 0, Math.PI * 2);
      g.fill();
    };
    if (face === "wait") {
      eye(48);
      eye(112);
      // Brows up, mouth a hopeful little O.
      g.lineWidth = 7;
      g.beginPath();
      g.moveTo(30, 16);
      g.quadraticCurveTo(48, 6, 66, 16);
      g.moveTo(94, 16);
      g.quadraticCurveTo(112, 6, 130, 16);
      g.stroke();
      g.fillStyle = palette.lavaDeep;
      g.beginPath();
      g.ellipse(80, 98, 13, 11, 0, 0, Math.PI * 2);
      g.fill();
      g.lineWidth = 6;
      g.stroke();
    } else if (face === "happy") {
      g.lineWidth = 9;
      g.beginPath();
      g.arc(48, 56, 17, Math.PI * 1.1, Math.PI * 1.9);
      g.stroke();
      g.beginPath();
      g.arc(112, 56, 17, Math.PI * 1.1, Math.PI * 1.9);
      g.stroke();
      g.fillStyle = palette.lavaDeep;
      g.beginPath();
      g.moveTo(44, 82);
      g.quadraticCurveTo(80, 126, 116, 82);
      g.closePath();
      g.fill();
      g.lineWidth = 6;
      g.stroke();
      g.fillStyle = "rgba(255,79,154,0.55)";
      for (const x of [22, 138]) {
        g.beginPath();
        g.ellipse(x, 84, 15, 9, 0, 0, Math.PI * 2);
        g.fill();
      }
    } else if (face === "eat") {
      g.lineWidth = 9;
      g.beginPath();
      g.moveTo(30, 52);
      g.lineTo(66, 52);
      g.moveTo(94, 52);
      g.lineTo(130, 52);
      g.stroke();
      // Puffed cheeks and a chewing mouth.
      g.fillStyle = "rgba(255,79,154,0.55)";
      for (const x of [20, 140]) {
        g.beginPath();
        g.ellipse(x, 86, 18, 13, 0, 0, Math.PI * 2);
        g.fill();
      }
      g.lineWidth = 7;
      g.strokeStyle = palette.ink;
      g.beginPath();
      g.moveTo(52, 92);
      g.quadraticCurveTo(66, 106, 80, 92);
      g.quadraticCurveTo(94, 78, 108, 92);
      g.stroke();
    } else {
      // Grump: slanted brows, glaring eyes, a downturned mouth.
      eye(48);
      eye(112);
      g.lineWidth = 11;
      g.beginPath();
      g.moveTo(26, 14);
      g.lineTo(68, 32);
      g.moveTo(134, 14);
      g.lineTo(92, 32);
      g.stroke();
      g.lineWidth = 8;
      g.beginPath();
      g.moveTo(52, 104);
      g.quadraticCurveTo(80, 82, 108, 104);
      g.stroke();
    }
  }
  return texOf(c);
}

function popupTexture(text: string, fill: string): THREE.CanvasTexture {
  const { c, g } = canvas(192, 112);
  if (g) {
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.lineJoin = "round";
    g.font = "700 88px Fredoka, sans-serif";
    g.lineWidth = 16;
    g.strokeStyle = palette.ink;
    g.strokeText(text, 96, 58);
    g.fillStyle = fill;
    g.fillText(text, 96, 58);
  }
  return texOf(c);
}

/** How a customer looks: a cast of regulars, chosen by seat. */
interface Look {
  skin: string;
  shirt: string;
  ears: "none" | "bear" | "cat" | "bunny";
  hat: "none" | "cap" | "pillbox" | "pompadour" | "beehive" | "bow";
  hatColor: string;
}

const LOOKS: readonly Look[] = [
  { skin: palette.heroPip, shirt: palette.bubble, ears: "bear", hat: "cap", hatColor: palette.spaceRed },
  { skin: palette.heroTusk, shirt: palette.sun, ears: "none", hat: "pompadour", hatColor: palette.woodDark },
  { skin: palette.heroGlimmer, shirt: palette.candy, ears: "cat", hat: "none", hatColor: palette.ink },
  { skin: palette.heroMallow, shirt: palette.mint, ears: "none", hat: "beehive", hatColor: palette.berry },
  { skin: palette.heroBounce, shirt: palette.spaceRed, ears: "bunny", hat: "none", hatColor: palette.ink },
  { skin: palette.heroRumble, shirt: palette.cream, ears: "none", hat: "pillbox", hatColor: palette.spaceBlue },
  { skin: palette.heroWisp, shirt: palette.spaceBlue, ears: "bear", hat: "bow", hatColor: palette.candy },
  { skin: palette.sand, shirt: palette.leaf, ears: "none", hat: "cap", hatColor: palette.ink },
  { skin: palette.heroJack, shirt: palette.berry, ears: "cat", hat: "none", hatColor: palette.ink },
  { skin: palette.bubble, shirt: palette.sunDeep, ears: "none", hat: "pompadour", hatColor: palette.ink },
  { skin: palette.mint, shirt: palette.spaceRed, ears: "bunny", hat: "bow", hatColor: palette.sun },
  { skin: palette.candy, shirt: palette.mintDeep, ears: "bear", hat: "pillbox", hatColor: palette.sun },
];

export interface Customer {
  group: THREE.Group;
  /** The part that bounces, leans and squashes. */
  body: THREE.Group;
  head: THREE.Group;
  face: THREE.Mesh;
  arms: [THREE.Mesh, THREE.Mesh];
  setFace(face: Face): void;
}

export interface PieMesh {
  group: THREE.Group;
  top: THREE.Mesh;
}

export interface Art {
  /** Shared shapes for the effects. */
  geo: { puff: THREE.BufferGeometry; ring: THREE.BufferGeometry; shadow: THREE.BufferGeometry; placemat: THREE.BufferGeometry; plate: THREE.BufferGeometry };
  toon(color: string): THREE.MeshToonMaterial;
  basic(color: string): THREE.MeshBasicMaterial;
  /** The bubble material for a flavor (sprites share it). */
  bubble(flavor: number): THREE.SpriteMaterial;
  /** A flat ring of the flavor color under a plate: what that customer wants. */
  placemat(flavor: number): THREE.MeshBasicMaterial;
  popup: { plus: THREE.Texture; minus: THREE.Texture };
  makePie(flavor: number): PieMesh;
  setPieFlavor(pie: PieMesh, flavor: number): void;
  makeCustomer(index: number): Customer;
  dispose(): void;
}

export function createArt(): Art {
  const geos: THREE.BufferGeometry[] = [];
  const textures: THREE.Texture[] = [];
  const mats: THREE.Material[] = [];
  const geo = <T extends THREE.BufferGeometry>(g: T): T => {
    geos.push(g);
    return g;
  };
  const tex = <T extends THREE.Texture>(t: T): T => {
    textures.push(t);
    return t;
  };

  const toonCache = new Map<string, THREE.MeshToonMaterial>();
  const toon = (color: string): THREE.MeshToonMaterial => {
    let m = toonCache.get(color);
    if (!m) {
      m = new THREE.MeshToonMaterial({ color: hex(color), gradientMap: celGradient });
      toonCache.set(color, m);
      mats.push(m);
    }
    return m;
  };
  const basicCache = new Map<string, THREE.MeshBasicMaterial>();
  const basic = (color: string): THREE.MeshBasicMaterial => {
    let m = basicCache.get(color);
    if (!m) {
      m = new THREE.MeshBasicMaterial({ color: hex(color) });
      basicCache.set(color, m);
      mats.push(m);
    }
    return m;
  };

  // ---- pies ----
  const tinGeo = geo(new THREE.CylinderGeometry(0.3, 0.25, 0.09, 20));
  const crustGeo = geo(new THREE.TorusGeometry(0.255, 0.05, 6, 22));
  const topGeo = geo(new THREE.CircleGeometry(0.25, 24));
  const topMats: THREE.MeshBasicMaterial[] = [];
  const bubbleMats: THREE.SpriteMaterial[] = [];
  const placemats: THREE.MeshBasicMaterial[] = [];
  for (let i = 0; i < FLAVOR_COUNT; i++) {
    const m = new THREE.MeshBasicMaterial({ map: tex(pieTopTexture(i)) });
    topMats.push(m);
    mats.push(m);
    const b = new THREE.SpriteMaterial({ map: tex(bubbleTexture(i)), transparent: true, depthTest: false });
    bubbleMats.push(b);
    mats.push(b);
    const p = new THREE.MeshBasicMaterial({ color: hex(FLAVORS[i].color), transparent: true, opacity: 0.95 });
    placemats.push(p);
    mats.push(p);
  }

  const makePie = (flavor: number): PieMesh => {
    const group = new THREE.Group();
    const tin = new THREE.Mesh(tinGeo, toon(palette.metal));
    tin.position.y = 0.045;
    const crust = new THREE.Mesh(crustGeo, toon(palette.sunDeep));
    crust.rotation.x = Math.PI / 2;
    crust.position.y = 0.1;
    const top = new THREE.Mesh(topGeo, topMats[flavor]);
    top.rotation.x = -Math.PI / 2;
    top.position.y = 0.112;
    group.add(tin, crust, top);
    return { group, top };
  };
  const setPieFlavor = (pie: PieMesh, flavor: number): void => {
    pie.top.material = topMats[flavor];
  };

  // ---- faces and popups ----
  const faceMats = new Map<Face, THREE.MeshBasicMaterial>();
  for (const f of FACES) {
    const m = new THREE.MeshBasicMaterial({ map: tex(faceTexture(f)), transparent: true });
    faceMats.set(f, m);
    mats.push(m);
  }
  const popup = { plus: tex(popupTexture("+1", palette.mint)), minus: tex(popupTexture("-1", palette.lava)) };

  // ---- customers ----
  const headGeo = geo(new THREE.SphereGeometry(0.29, 18, 14));
  const bodyGeo = geo(new THREE.SphereGeometry(0.34, 16, 12));
  const stoolPoleGeo = geo(new THREE.CylinderGeometry(0.05, 0.07, 0.34, 8));
  const stoolSeatGeo = geo(new THREE.CylinderGeometry(0.3, 0.3, 0.1, 18));
  const stoolBaseGeo = geo(new THREE.CylinderGeometry(0.22, 0.26, 0.05, 14));
  const armGeo = geo(new THREE.CylinderGeometry(0.075, 0.07, 0.42, 7));
  const handGeo = geo(new THREE.SphereGeometry(0.095, 8, 6));
  const faceGeo = geo(new THREE.PlaneGeometry(0.46, 0.345));
  const earBall = geo(new THREE.SphereGeometry(0.1, 8, 6));
  const earCone = geo(new THREE.ConeGeometry(0.11, 0.2, 6));
  const earLong = geo(new THREE.CapsuleGeometry(0.07, 0.3, 4, 8));
  const capGeo = geo(new THREE.SphereGeometry(0.3, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2));
  const brimGeo = geo(new THREE.BoxGeometry(0.34, 0.04, 0.22));
  const pillGeo = geo(new THREE.CylinderGeometry(0.18, 0.2, 0.16, 14));
  const pompGeo = geo(new THREE.SphereGeometry(0.2, 10, 8));
  const hiveGeo = geo(new THREE.ConeGeometry(0.2, 0.46, 10));
  const bowGeo = geo(new THREE.ConeGeometry(0.09, 0.2, 4));
  const knotGeo = geo(new THREE.SphereGeometry(0.05, 6, 5));

  const makeCustomer = (index: number): Customer => {
    const look = LOOKS[index % LOOKS.length];
    const group = new THREE.Group();
    const chrome = toon(palette.metal);
    // The stool.
    const base = new THREE.Mesh(stoolBaseGeo, chrome);
    base.position.y = 0.025;
    const pole = new THREE.Mesh(stoolPoleGeo, chrome);
    pole.position.y = 0.2;
    const seat = new THREE.Mesh(stoolSeatGeo, toon(palette.spaceRed));
    seat.position.y = 0.4;
    group.add(base, pole, seat);

    const body = new THREE.Group();
    body.position.y = 0.45;
    group.add(body);
    const torso = new THREE.Mesh(bodyGeo, toon(look.shirt));
    torso.scale.set(1, 1.05, 0.9);
    torso.position.y = 0.3;
    body.add(torso);
    // A little collar-and-buttons stripe.
    const stripe = new THREE.Mesh(knotGeo, toon(palette.white));
    stripe.position.set(0, 0.34, 0.3);
    body.add(stripe);

    const head = new THREE.Group();
    head.position.y = 0.82;
    body.add(head);
    const skull = new THREE.Mesh(headGeo, toon(look.skin));
    head.add(skull);
    const face = new THREE.Mesh(faceGeo, faceMats.get("wait") as THREE.MeshBasicMaterial);
    face.position.set(0, -0.01, 0.272);
    head.add(face);

    // Ears.
    const earMat = toon(look.skin);
    for (const s of [-1, 1]) {
      if (look.ears === "bear") {
        const e = new THREE.Mesh(earBall, earMat);
        e.position.set(s * 0.22, 0.22, 0);
        head.add(e);
      } else if (look.ears === "cat") {
        const e = new THREE.Mesh(earCone, earMat);
        e.position.set(s * 0.18, 0.3, 0);
        e.rotation.z = -s * 0.28;
        head.add(e);
      } else if (look.ears === "bunny") {
        const e = new THREE.Mesh(earLong, earMat);
        e.position.set(s * 0.12, 0.45, 0);
        e.rotation.z = -s * 0.14;
        head.add(e);
      }
    }
    // Hats and hair.
    const hatMat = toon(look.hatColor);
    if (look.hat === "cap") {
      const dome = new THREE.Mesh(capGeo, hatMat);
      dome.position.y = 0.04;
      const brim = new THREE.Mesh(brimGeo, hatMat);
      brim.position.set(0, 0.07, 0.3);
      head.add(dome, brim);
    } else if (look.hat === "pillbox") {
      const pill = new THREE.Mesh(pillGeo, hatMat);
      pill.position.y = 0.3;
      pill.rotation.z = 0.14;
      head.add(pill);
    } else if (look.hat === "pompadour") {
      const pomp = new THREE.Mesh(pompGeo, hatMat);
      pomp.position.set(0, 0.26, 0.1);
      pomp.scale.set(1.1, 0.8, 1.2);
      head.add(pomp);
    } else if (look.hat === "beehive") {
      const hive = new THREE.Mesh(hiveGeo, hatMat);
      hive.position.y = 0.46;
      head.add(hive);
    } else if (look.hat === "bow") {
      for (const s of [-1, 1]) {
        const b = new THREE.Mesh(bowGeo, hatMat);
        b.position.set(s * 0.12, 0.34, 0.04);
        b.rotation.z = s * Math.PI / 2;
        head.add(b);
      }
      const k = new THREE.Mesh(knotGeo, hatMat);
      k.position.set(0, 0.34, 0.04);
      head.add(k);
    }

    // Arms reaching out over the counter.
    const armMat = toon(look.shirt);
    const handMat = toon(look.skin);
    const arms: THREE.Mesh[] = [];
    for (const s of [-1, 1]) {
      const arm = new THREE.Mesh(armGeo, armMat);
      arm.position.set(s * 0.33, 0.2, 0.2);
      arm.rotation.x = Math.PI / 2 - 0.4;
      const hand = new THREE.Mesh(handGeo, handMat);
      hand.position.set(0, -0.23, 0);
      arm.add(hand);
      body.add(arm);
      arms.push(arm);
    }
    return {
      group,
      body,
      head,
      face,
      arms: [arms[0], arms[1]],
      setFace(f) {
        face.material = faceMats.get(f) as THREE.MeshBasicMaterial;
      },
    };
  };

  return {
    geo: {
      puff: geo(new THREE.SphereGeometry(0.07, 6, 5)),
      ring: geo(new THREE.RingGeometry(0.8, 1, 32)),
      shadow: geo(new THREE.CircleGeometry(0.28, 16)),
      placemat: geo(new THREE.RingGeometry(0.4, 0.52, 28)),
      plate: geo(new THREE.CylinderGeometry(0.36, 0.3, 0.04, 22)),
    },
    toon,
    basic,
    bubble: (flavor) => bubbleMats[flavor],
    placemat: (flavor) => placemats[flavor],
    popup,
    makePie,
    setPieFlavor,
    makeCustomer,
    dispose() {
      for (const g of geos) g.dispose();
      for (const m of mats) m.dispose();
      for (const t of textures) t.dispose();
    },
  };
}
