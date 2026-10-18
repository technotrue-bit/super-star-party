/**
 * SUPER STAR PARTY — lazy board themes. A board whose scenery is heavy
 * (Downtown's city) ships it as its own chunk behind registry loadScene().
 * The board screen awaits it before building, and buildBoardScene() lets a
 * loaded theme supply the ground and scenery instead of the placeholder.
 * Types plus one group name, so the main chunk pays almost nothing for it.
 */
import type { Object3D } from "three";
import type { BoardDef } from "./boardData";
import type { BoardTextures } from "./boardTextures";

/** What the board builder hands a theme. */
export interface BoardThemeHost {
  def: BoardDef;
  /** The board's shared kit (toon gradient map, disk textures). */
  kit: BoardTextures;
}

/** One built theme: static ground + scenery the board adds after its static-bounds pass. */
export interface BuiltBoardTheme {
  root: Object3D;
  /** Cosmetic animation (water ripples). Board seconds. */
  update?(t: number, dt: number): void;
  /** Free what build() made. The board's own traversal frees the rest. */
  dispose(): void;
}

/** What a lazy scene chunk resolves to, with its assets already decoded. */
export interface BoardTheme {
  build(host: BoardThemeHost): BuiltBoardTheme;
}

/** Name of a theme's static scenery group (the budget probe walks it). */
export const THEME_SCENERY_NAME = "theme:scenery";
