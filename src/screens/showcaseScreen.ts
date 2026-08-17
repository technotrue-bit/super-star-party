/**
 * SUPER STAR PARTY — showcase screen (harness/demo driver, ORCHESTRATOR-OWNED).
 * The always-inspectable surface: camera tours the Fizzy Fairground board,
 * music plays, HUD + banners show the UI kit, a highlight walks the loop.
 * Wave-1 pieces (board, characters, audio, ui) all light up here.
 */
import * as THREE from "three";
import { palette } from "../config/palette";
import { rng } from "../core/rng";
import { audio } from "../audio/audioEngine";
import { ui } from "../ui/kit";
import { buildBoardScene, boardBounds, type BoardScene } from "../board/boardScene";
import { fizzyFairground } from "../board/boardData";
import type { Screen } from "./screenManager";

interface ShowcaseState {
  _board?: BoardScene;
  _hud?: { destroy(): void };
  _cam?: { cx: number; cy: number; fit: number };
  _t?: number;
  _hlTimer?: number;
  _hlIndex?: number;
}

function positionCamera(self: ShowcaseState, t: number): void {
  const cam = world.camera!;
  const { cx, cy, fit } = self._cam!;
  const dist = fit * 0.85;
  const yaw = t * 0.14;
  const pitch = 1.05 + Math.sin(t * 0.31) * 0.08;
  cam.position.set(cx + Math.sin(yaw) * dist, Math.cos(pitch) * dist + fit * 0.35, cy + Math.cos(yaw) * dist);
  cam.lookAt(cx, 0, cy);
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

    // ---- camera: fit board bounds, party angle ----
    const b = boardBounds();
    const cx = (b.minX + b.maxX) / 2;
    const cy = (b.minY + b.maxY) / 2;
    const fit = Math.max(b.maxX - b.minX, b.maxY - b.minY);
    this._cam = { cx, cy, fit };
    this._t = rng.next() * 100;
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
  },

  exit() {
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
  },

  render() {},
};

export const showcaseScreen = showcaseScreenImpl as Screen;

import { screens } from "./screenManager";
import { world } from "../main";
