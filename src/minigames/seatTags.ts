/**
 * SUPER STAR PARTY — minigame seat tags (display only).
 * One fixed DOM container, one node per HUMAN seat: "YOU" + ▼ on your own
 * seat, a coloured "P2"/"P3" pill on other humans. CPUs get nothing.
 * Positions come from the avatar's world position and a head height measured
 * once at mount, projected with the minigame camera. translate3d only; no rng,
 * no ctx or MatchState writes.
 */
import * as THREE from "three";
import type { Character } from "../characters/characterFactory";

export interface SeatTagSeat {
  id: number;
  /** Index into `chars`. */
  index: number;
  color: string;
  text: string;
  you: boolean;
}

export interface SeatTagReading {
  id: number;
  kind: "you" | "peer";
  text: string;
  x: number;
  y: number;
  visible: boolean;
}

export interface SeatTags {
  tick(): void;
  destroy(): void;
}

interface Node {
  seat: SeatTagSeat;
  ch: Character;
  el: HTMLDivElement;
  arrow: HTMLElement;
  headLocal: number;
  x: number;
  y: number;
  visible: boolean;
  edge: boolean;
  rot: string;
}

const MARGIN = 28;
const HEAD_PAD = 0.15;
const EDGE_INSET = 36;

let live: Node[] | null = null;

/** Dev/CI read hook: the last positions written by tick(). */
export function readSeatTags(): SeatTagReading[] {
  return (live ?? []).map((n) => ({
    id: n.seat.id,
    kind: n.seat.you ? "you" : "peer",
    text: n.seat.text,
    x: n.x,
    y: n.y,
    visible: n.visible,
  }));
}

function edgePoint(w: number, h: number, dx: number, dy: number): { x: number; y: number } {
  const hw = Math.max(1, w / 2 - EDGE_INSET);
  const hh = Math.max(1, h / 2 - EDGE_INSET);
  if (Math.abs(dx) < 1e-4 && Math.abs(dy) < 1e-4) return { x: w / 2, y: EDGE_INSET };
  const s = Math.min(hw / Math.abs(dx), hh / Math.abs(dy));
  return { x: w / 2 + dx * s, y: h / 2 + dy * s };
}

export function mountSeatTags(opts: {
  chars: readonly Character[];
  camera: THREE.Camera | null | undefined;
  seats: readonly SeatTagSeat[];
}): SeatTags {
  const box = new THREE.Box3();
  const pos = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const root = document.createElement("div");
  root.className = "ssp-seat-tags";
  root.setAttribute("data-seat-tags", "");
  const nodes: Node[] = [];

  for (const seat of opts.seats) {
    const ch = opts.chars[seat.index];
    if (!ch) continue;
    ch.group.updateWorldMatrix(true, true);
    box.setFromObject(ch.group);
    ch.group.getWorldPosition(pos);
    ch.group.getWorldScale(scale);
    const headLocal = Math.max(0.5, (box.max.y - pos.y) / (scale.y || 1));

    const el = document.createElement("div");
    el.className = seat.you ? "ssp-seat ssp-seat--on ssp-seat--you" : "ssp-seat ssp-seat--on ssp-seat--peer";
    el.dataset.seatMarker = String(seat.id);
    el.dataset.seatTag = String(seat.id);
    el.dataset.tagKind = seat.you ? "you" : "peer";
    el.style.setProperty("--ssp-seat", seat.color);
    el.style.color = seat.color;
    const stack = document.createElement("div");
    stack.className = "ssp-seat__stack";
    const pill = document.createElement("div");
    pill.className = "ssp-seat__pill";
    pill.textContent = seat.text;
    const down = document.createElement("div");
    down.className = "ssp-seat__down";
    const arrow = document.createElement("div");
    arrow.className = "ssp-seat__arrow";
    stack.append(pill);
    if (seat.you) stack.append(down, arrow);
    el.append(stack);
    el.style.transform = "translate3d(-200px,-200px,0)";
    root.append(el);
    nodes.push({ seat, ch, el, arrow, headLocal, x: -200, y: -200, visible: false, edge: false, rot: "" });
  }
  document.body.appendChild(root);
  live = nodes;

  const tick = () => {
    const cam = opts.camera;
    if (!cam) return;
    cam.updateMatrixWorld();
    const w = window.innerWidth || 1;
    const h = window.innerHeight || 1;
    for (const n of nodes) {
      n.ch.group.getWorldPosition(pos);
      n.ch.group.getWorldScale(scale);
      pos.y += n.headLocal * scale.y + HEAD_PAD;
      pos.project(cam);
      const sx = (pos.x * 0.5 + 0.5) * w;
      const sy = (-pos.y * 0.5 + 0.5) * h;
      const behind = pos.z > 1;
      const onScreen = !behind && sx >= MARGIN && sx <= w - MARGIN && sy >= MARGIN && sy <= h - MARGIN;
      let x = sx;
      let y = sy;
      let visible = true;
      let edge = false;
      let rot = "";
      if (!onScreen) {
        if (n.seat.you) {
          let dx = sx - w / 2;
          let dy = sy - h / 2;
          if (behind) {
            dx = -dx;
            dy = -dy;
          }
          const pt = edgePoint(w, h, dx, dy);
          x = pt.x;
          y = pt.y;
          edge = true;
          rot = `rotate(${Math.atan2(dy, dx) + Math.PI / 2}rad)`;
        } else {
          visible = false;
        }
      }
      if (visible !== n.visible) n.el.classList.toggle("ssp-seat--hide", !visible);
      if (edge !== n.edge) n.el.classList.toggle("ssp-seat--edge", edge);
      if (rot !== n.rot) n.arrow.style.transform = rot;
      n.visible = visible;
      n.edge = edge;
      n.rot = rot;
      n.x = x;
      n.y = y;
      n.el.style.transform = `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0)`;
    }
  };

  const destroy = () => {
    if (live === nodes) live = null;
    root.remove();
  };
  return { tick, destroy };
}
