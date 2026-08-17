/**
 * SUPER STAR PARTY — showcase screen (harness/demo driver, ORCHESTRATOR-OWNED).
 * The always-inspectable surface: camera tours the Fizzy Fairground board,
 * music plays, HUD + banners show the UI kit, a highlight walks the loop.
 * Wave-1 pieces (board, characters, audio, ui) all light up here.
 */
import * as THREE from "three";
import { palette } from "../config/palette";
import { mulberry32 } from "../core/rng";
import { audio } from "../audio/audioEngine";
import { ui } from "../ui/kit";
import { buildBoardScene, boardBounds, type BoardScene } from "../board/boardScene";
import { fizzyFairground } from "../board/boardData";
import { createCharacter, type Character } from "../characters/characterFactory";
import type { Screen } from "./screenManager";

// Presentation-only RNG: showcase walker wander/cheer timers use their own
// fixed-seed stream so the shared gameplay rng is never consumed by demo
// presentation code (deterministic replay contract).
const showcaseRng = mulberry32(0x5eedface);

interface Walker {
  char: Character;
  current: number;
  target: number;
  progress: number;
  moving: boolean;
  restT: number;
  cheerT: number;
}

interface ShowcaseState {
  _board?: BoardScene;
  _hud?: { destroy(): void };
  _cam?: { cx: number; cy: number; fit: number };
  _t?: number;
  _hlTimer?: number;
  _hlIndex?: number;
  _walkers?: Walker[];
}

function positionCamera(self: ShowcaseState, t: number): void {
  const cam = world.camera!;
  const { cx, cy, fit } = self._cam!;
  // Party camera that keeps the WHOLE board INCLUDING corner landmarks
  // (tents ~2.9u, ferris wheel ~4.2u beyond the space loop) in frame at
  // every orbit angle. Low pitch (~55deg), tight radius, gentle breathing,
  // lookAt biased toward the ferris-wheel corner so it stays in view.
  const dist = fit * 0.6;
  const yaw = t * 0.14;
  const pitch = 0.94 + Math.sin(t * 0.31) * 0.05;
  cam.position.set(
    cx + Math.sin(yaw) * dist,
    Math.cos(pitch) * dist * 0.74 + fit * 0.1,
    cy + Math.cos(yaw) * dist
  );
  cam.lookAt(cx + fit * 0.08, 0, cy - fit * 0.1);
}

const showcaseScreenImpl: ShowcaseState & Screen = {
  id: "showcase",

  enter() {
    // ---- board ----
    const board = buildBoardScene(fizzyFairground);
    this._board = board;

    // ---- music ----
    audio.music.play("board", { intensity: 0.7 });
    audio.music.intensity(0.7);

    // ---- camera: fit board bounds + scenery pad (tents/ferris live up to
    // ~4.5u beyond the space loop), party angle, lookAt biased to the
    // ferris-wheel corner so landmarks stay in frame at every orbit angle ----
    const b = boardBounds();
    const SCENERY_PAD = 5.2;
    const cx = (b.minX + b.maxX) / 2;
    const cy = (b.minY + b.maxY) / 2;
    const fit = Math.max(b.maxX - b.minX, b.maxY - b.minY) + SCENERY_PAD * 2;
    this._cam = { cx, cy, fit };
    this._t = showcaseRng() * 100;
    positionCamera(this, this._t);

    // ---- UI: HUD with demo players + banner ----
    const hud = ui.hud();
    hud.update([
      { id: 0, kind: "pip", name: "Pip", coins: 23, stars: 1, minigameWins: 2, active: true, color: palette.heroPip },
      { id: 1, kind: "bounce", name: "Bounce", coins: 11, stars: 0, minigameWins: 1, active: false, color: palette.heroBounce },
      { id: 2, kind: "glimmer", name: "Glimmer", coins: 17, stars: 1, minigameWins: 0, active: false, color: palette.heroGlimmer },
      { id: 3, kind: "tusk", name: "Tusk", coins: 9, stars: 0, minigameWins: 1, active: false, color: palette.heroTusk },
    ]);
    this._hud = hud;
    hud.showBanner("FIZZY FAIRGROUND", { durationMs: 2200 });
    ui.toast("Wave 1 showcase — board · characters · audio · ui", { durationMs: 3000 });

    // ---- highlight walk ----
    this._hlTimer = 0;
    this._hlIndex = 0;
    board.highlight(0);

    // ---- character walkers (the 4 heroes wandering the fairground) ----
    const kinds = ["pip", "bounce", "glimmer", "tusk"];
    const offsets = [
      [0.0, 0.0],
      [0.6, 0.0],
      [0.0, 0.6],
      [0.6, 0.6],
    ];
    const start = board.spaceWorldPos(0);
    this._walkers = kinds.map((kind, i) => {
      const char = createCharacter(kind);
      char.group.position.set(start.x + offsets[i][0], 0, start.z + offsets[i][1]);
      char.group.scale.setScalar(0.92);
      char.setFacing(Math.PI / 4 + i);
      char.anim.idle();
      world.scene!.add(char.group);
      return { char, current: 0, target: 0, progress: 1, moving: false, restT: i * 0.8, cheerT: 0 };
    });
  },

  exit() {
    for (const w of this._walkers ?? []) {
      world.scene?.remove(w.char.group);
      w.char.dispose();
    }
    this._walkers = undefined;
    this._board?.dispose();
    this._board = undefined;
    this._hud?.destroy();
    this._hud = undefined;
    ui.clearScreen();
    audio.music.stop(0.3);
  },

  update(dt: number) {
    this._t = (this._t ?? 0) + dt;
    this._board?.update(dt);

    // Camera: slow arc around the board, gentle height breathing.
    if (this._cam) positionCamera(this, this._t);

    // Highlight walks the loop every 1.3s (idle life + critic-visible motion).
    this._hlTimer = (this._hlTimer ?? 0) + dt;
    if (this._hlTimer > 1.3) {
      this._hlTimer = 0;
      this._board?.clearHighlights();
      this._hlIndex = ((this._hlIndex ?? 0) + 1) % fizzyFairground.spaces.length;
      this._board?.highlight(this._hlIndex);
    }

    // ---- walkers: wander the loop, hop-walking tile to tile ----
    const board = this._board;
    const n = fizzyFairground.spaces.length;
    for (const w of this._walkers ?? []) {
      w.char.update(dt);
      if (!board) continue;
      if (!w.moving) {
        w.cheerT -= dt;
        w.restT -= dt;
        if (w.restT <= 0) {
          // Pick a target 1-4 tiles ahead; sometimes cheer instead.
          if (w.cheerT <= 0 && showcaseRng() < 0.12) {
            w.char.anim.cheer();
            w.cheerT = 1.3;
            w.restT = 0.4;
          } else {
            w.target = (w.current + (1 + Math.floor(showcaseRng() * 4))) % n;
            w.progress = 0;
            w.moving = true;
            w.char.anim.walk();
            const to = board.spaceWorldPos(w.target);
            w.char.setFacing(Math.atan2(to.x - w.char.group.position.x, to.z - w.char.group.position.z));
          }
        }
      } else {
        const from = board.spaceWorldPos(w.current);
        const to = board.spaceWorldPos(w.target);
        w.progress += dt * 3.4; // tiles per second (leisurely showcase pace)
        const p = Math.min(1, w.progress);
        const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2; // ease in-out
        w.char.group.position.x = from.x + (to.x - from.x) * e;
        w.char.group.position.z = from.z + (to.z - from.z) * e;
        if (p >= 1) {
          w.current = w.target;
          w.moving = false;
          w.restT = 0.9 + showcaseRng() * 2.0;
          w.char.anim.idle();
        }
      }
    }
  },

  render() {},
};

export const showcaseScreen = showcaseScreenImpl as Screen;

import { screens } from "./screenManager";
import { world } from "../main";
