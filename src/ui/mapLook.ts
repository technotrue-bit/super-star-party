/**
 * Full-map look. Opens over the live board camera so the player can drag
 * (or mouse-drag) around the whole fairground, then hands the camera back.
 */
import * as THREE from "three";
import { palette } from "../config/palette";
import { viewportSize } from "./viewport";

export interface MapLook {
  open(): void;
  close(): void;
  isOpen(): boolean;
  /** True while the player is dragging, so the board camera should not fight. */
  holding(): boolean;
  destroy(): void;
}

export function createMapLook(opts: {
  camera: THREE.PerspectiveCamera;
  bounds: { minX: number; maxX: number; minY: number; maxY: number };
  onChange?: (open: boolean) => void;
}): MapLook {
  const root = document.createElement("div");
  root.className = "ssp-maplook";
  root.style.cssText = [
    "position:fixed",
    "inset:0",
    "z-index:70",
    "display:none",
    "touch-action:none",
    "cursor:grab",
  ].join(";");

  const bar = document.createElement("div");
  bar.style.cssText = [
    "position:absolute",
    "left:50%",
    "top:calc(10px + env(safe-area-inset-top, 0px))",
    "transform:translateX(-50%)",
    "display:flex",
    "gap:10px",
    "align-items:center",
    "pointer-events:none",
  ].join(";");

  const label = document.createElement("div");
  label.textContent = "DRAG TO LOOK";
  label.style.cssText = `font-family:Fredoka,sans-serif;font-weight:700;font-size:14px;color:${palette.cream};text-shadow:0 2px 0 ${palette.ink};`;

  const done = document.createElement("button");
  done.type = "button";
  done.textContent = "DONE";
  done.setAttribute("aria-label", "Close map");
  done.style.cssText = [
    "pointer-events:auto",
    "min-height:48px",
    "padding:8px 18px",
    "border-radius:999px",
    "border:4px solid " + palette.ink,
    "background:" + palette.sun,
    "color:" + palette.ink,
    "font-family:Fredoka,sans-serif",
    "font-weight:700",
    "font-size:16px",
    "box-shadow:0 4px 0 " + palette.ink,
    "touch-action:manipulation",
  ].join(";");

  bar.append(label, done);
  root.appendChild(bar);
  document.body.appendChild(root);

  const b = opts.bounds;
  const cx = (b.minX + b.maxX) / 2;
  const cz = (b.minY + b.maxY) / 2;
  const span = Math.max(b.maxX - b.minX, b.maxY - b.minY);
  let panX = 0;
  let panZ = 0;
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  let pointerId: number | null = null;
  let opened = false;
  const saved = {
    pos: new THREE.Vector3(),
    quat: new THREE.Quaternion(),
    fov: 45,
  };

  const apply = (): void => {
    const cam = opts.camera;
    const { w, h } = viewportSize();
    const aspect = w / Math.max(1, h);
    cam.fov = 48;
    cam.aspect = aspect;
    cam.updateProjectionMatrix();
    const dist = span * (aspect < 1 ? 1.55 : 1.15);
    cam.position.set(cx + panX, dist * 0.92, cz + dist * 0.42 + panZ);
    cam.lookAt(cx + panX, 0, cz + panZ);
  };

  const onDown = (e: PointerEvent): void => {
    if ((e.target as HTMLElement).closest("button")) return;
    dragging = true;
    pointerId = e.pointerId;
    lastX = e.clientX;
    lastY = e.clientY;
    root.style.cursor = "grabbing";
    root.setPointerCapture(e.pointerId);
  };
  const onMove = (e: PointerEvent): void => {
    if (!dragging || e.pointerId !== pointerId) return;
    const { w } = viewportSize();
    const scale = span / Math.max(240, w);
    panX -= (e.clientX - lastX) * scale;
    panZ -= (e.clientY - lastY) * scale;
    const limit = span * 0.45;
    panX = Math.max(-limit, Math.min(limit, panX));
    panZ = Math.max(-limit, Math.min(limit, panZ));
    lastX = e.clientX;
    lastY = e.clientY;
    apply();
  };
  const onUp = (e: PointerEvent): void => {
    if (e.pointerId !== pointerId) return;
    dragging = false;
    pointerId = null;
    root.style.cursor = "grab";
  };

  root.addEventListener("pointerdown", onDown);
  root.addEventListener("pointermove", onMove);
  root.addEventListener("pointerup", onUp);
  root.addEventListener("pointercancel", onUp);
  done.addEventListener("click", () => api.close());

  const api: MapLook = {
    open(): void {
      if (opened) return;
      opened = true;
      panX = 0;
      panZ = 0;
      saved.pos.copy(opts.camera.position);
      saved.quat.copy(opts.camera.quaternion);
      saved.fov = opts.camera.fov;
      root.style.display = "block";
      apply();
      opts.onChange?.(true);
    },
    close(): void {
      if (!opened) return;
      opened = false;
      dragging = false;
      root.style.display = "none";
      opts.camera.position.copy(saved.pos);
      opts.camera.quaternion.copy(saved.quat);
      opts.camera.fov = saved.fov;
      opts.camera.updateProjectionMatrix();
      opts.onChange?.(false);
    },
    isOpen: () => opened,
    holding: () => dragging,
    destroy(): void {
      this.close();
      root.remove();
    },
  };
  return api;
}
