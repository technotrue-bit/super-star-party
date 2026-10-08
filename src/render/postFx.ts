/**
 * SUPER STAR PARTY — post look.
 *
 * postprocessing stays out of the boot bundle. Off draws with the renderer
 * and never imports the library. Low and High dynamic-import ./postFxLazy,
 * which builds one RenderPass and one EffectPass.
 *
 * The renderer's pixel ratio is left alone. Resize uses the size main.ts
 * already applied, and the composer reads the drawing-buffer size from that.
 */
import { Vector2, type PerspectiveCamera, type Scene, type WebGLRenderer } from "three";
import {
  EFFECTS_QUALITY_STORAGE_KEY,
  defaultEffectsQuality,
  isEffectsQuality,
  type EffectsQuality,
} from "../config/settings";
import type { ActiveEffectsQuality, PostFxSession } from "./postFxLazy";

type LazyModule = typeof import("./postFxLazy");

let renderer: WebGLRenderer | null = null;
let scene: Scene | null = null;
let camera: PerspectiveCamera | null = null;
let quality: EffectsQuality = "off";
let width = 1;
let height = 1;
let session: PostFxSession | null = null;
let loading: Promise<LazyModule> | null = null;
let generation = 0;
let warnedLoadFailure = false;
const sizeScratch = new Vector2();

function warnLoadFailure(err: unknown): void {
  if (warnedLoadFailure) return;
  warnedLoadFailure = true;
  console.warn("[SSP] postprocessing failed to load; drawing the scene directly.", err);
}

function loadLazy(): Promise<LazyModule> {
  if (!loading) {
    loading = import("./postFxLazy").catch((err: unknown) => {
      loading = null;
      throw err;
    });
  }
  return loading;
}

function releaseSession(): void {
  if (session) {
    session.dispose();
    session = null;
  }
  if (renderer) renderer.autoClear = true;
}

function isActive(value: EffectsQuality): value is ActiveEffectsQuality {
  return value === "low" || value === "high";
}

/** URL `?fx=` wins for this load and is not written to storage. */
export function resolveEffectsQuality(): EffectsQuality {
  if (typeof window !== "undefined") {
    const fromUrl = new URLSearchParams(window.location.search).get("fx");
    if (isEffectsQuality(fromUrl)) return fromUrl;
  }
  try {
    const stored = localStorage.getItem(EFFECTS_QUALITY_STORAGE_KEY);
    if (isEffectsQuality(stored)) return stored;
  } catch {
    /* private mode — use the device default */
  }
  return defaultEffectsQuality();
}

export function getEffectsQuality(): EffectsQuality {
  return quality;
}

/** Composer pass count, or null while effects are off or still loading. */
export function effectsPassCount(): number | null {
  if (!isActive(quality) || !session) return null;
  return session.passCount();
}

export function setEffectsQuality(next: string, persist = false): EffectsQuality {
  if (!isEffectsQuality(next)) return quality;
  quality = next;
  if (persist) {
    try {
      localStorage.setItem(EFFECTS_QUALITY_STORAGE_KEY, next);
    } catch {
      /* private mode — the live choice still applies */
    }
  }
  const token = ++generation;
  if (!isActive(next)) {
    releaseSession();
    return quality;
  }
  const active = next;
  loadLazy()
    .then((mod) => {
      if (token !== generation || quality !== active || !renderer || !scene || !camera) return;
      if (!session) {
        session = mod.createPostFx(renderer, scene, camera, active);
        session.setSize(width, height);
      } else {
        session.setQuality(active);
      }
    })
    .catch((err: unknown) => {
      warnLoadFailure(err);
    });
  return quality;
}

export function installPostFx(
  nextRenderer: WebGLRenderer,
  nextScene: Scene,
  nextCamera: PerspectiveCamera,
): void {
  renderer = nextRenderer;
  scene = nextScene;
  camera = nextCamera;
  nextRenderer.getSize(sizeScratch);
  width = Math.max(1, sizeScratch.x);
  height = Math.max(1, sizeScratch.y);
  setEffectsQuality(resolveEffectsQuality(), false);
}

export function resizePostFx(nextWidth: number, nextHeight: number): void {
  width = Math.max(1, nextWidth);
  height = Math.max(1, nextHeight);
  session?.setSize(width, height);
}

export function renderPostFx(): void {
  if (!renderer || !scene || !camera) return;
  if (session && isActive(quality)) {
    session.render();
    return;
  }
  renderer.render(scene, camera);
}
