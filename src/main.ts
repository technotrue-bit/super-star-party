/**
 * SUPER STAR PARTY — boot. Renderer, camera, main loop, screen wiring.
 * Wave agents build on this; do not restructure the boot contract.
 */
import * as THREE from "three";
import "@fontsource/fredoka/500.css";
import "@fontsource/fredoka/600.css";
import "@fontsource/fredoka/700.css";
import { settings } from "./config/settings";
import { palette } from "./config/palette";
import { rng } from "./core/rng";
import { screens } from "./screens/screenManager";
import { installDebugAPI, tickFrame, autoplayTick, isAutoplay } from "./core/debug";
import { bus } from "./core/events";
import { audio, unlock } from "./audio/audioEngine";

export const world = {
  renderer: null as THREE.WebGLRenderer | null,
  scene: null as THREE.Scene | null,
  camera: null as THREE.PerspectiveCamera | null,
  clock: new THREE.Clock(),
};

function boot(): void {
  const container = document.getElementById("app")!;

  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, settings.maxDpr));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.NoToneMapping; // cel look: keep raw colors
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(palette.ink);

  const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 400);

  // Basic lights — screens may add their own; these guarantee nothing is black.
  const hemi = new THREE.HemisphereLight(0xffffff, 0x2b1d4e, 1.1);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(6, 14, 8);
  key.castShadow = true;
  scene.add(key);

  world.renderer = renderer;
  world.scene = scene;
  world.camera = camera;

  // URL params for critics: ?seed=N&screen=NAME&autoplay=1&audio=0&speed=2
  const params = new URLSearchParams(window.location.search);
  const seed = Number(params.get("seed") ?? "1");
  rng.reset(seed); // URL seed wins at boot (critic replays)
  const screen = params.get("screen") ?? "title";
  const audioOff = params.get("audio") === "0";
  const speed = Number(params.get("speed") ?? "1");

  if (audioOff) {
    // No AudioContext at all — silence, but the engine object must still work.
  }

  // Debug harness: ?audio=1 forces an unlock so headless critics can verify
  // the music system in a real browser without a user gesture.
  if (params.get("audio") === "1") {
    setTimeout(() => unlock(), 400);
  }

  // First gesture unlocks audio (autoplay policy).
  const unlockOnce = () => {
    unlock();
    window.removeEventListener("pointerdown", unlockOnce);
    window.removeEventListener("keydown", unlockOnce);
  };
  window.addEventListener("pointerdown", unlockOnce);
  window.addEventListener("keydown", unlockOnce);

  // Register screens (lazy imports so every screen can be added independently).
  // Wait for ALL registrations before the initial goto (avoids boot races).
  const screenImports = [
    import("./screens/titleScreen").then((m) => screens.register(m.titleScreen)),
    import("./screens/showcaseScreen").then((m) => screens.register(m.showcaseScreen)),
    import("./screens/boardScreenPlaceholder").then((m) => screens.register(m.boardScreenPlaceholder)),
    import("./screens/minigameScreen").then((m) => screens.register(m.minigameScreen)),
    import("./screens/characterSelect").then((m) => screens.register(m.characterSelect)),
  ];
  void Promise.all(screenImports).then(() => {
    screens.goto(screen);
  });

  // Resize handling.
  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  installDebugAPI();

  bus.on("screen:change", ({ to }) => {
    console.log(`[SSP] screen -> ${to}`);
  });

  // Main loop.
  let last = performance.now();
  function frame(now: number): void {
    const rawDelta = (now - last) / 1000;
    last = now;
    const dt = Math.min(rawDelta, settings.maxDelta) * speed;
    tickFrame(rawDelta * 1000);
    if (isAutoplay()) autoplayTick();
    screens.update(dt);
    screens.render();
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  console.log(`[SSP] SUPER STAR PARTY booted — seed ${seed}, screen ${screen}`);
}

boot();
