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

/**
 * A theme's space tiles: every space drawn by one instanced mesh (instance i
 * = space i), in place of the placeholder disks and their printed rims.
 */
export interface ThemeTiles {
  /** Added to the board after its static-bounds pass (the tiles move). */
  root: Object3D;
  /** Height of the tile face above the ground; per-space props stand on it. */
  top: number;
  /**
   * Pose space i's tile for a landing reaction (landFx dipInstance): y offset,
   * y squash and xz stretch. (0, 1, 1) is at rest.
   */
  dipInstance(i: number, y: number, sy: number, sxz: number): void;
}

/** One built theme: static ground + scenery the board adds after its static-bounds pass. */
export interface BuiltBoardTheme {
  root: Object3D;
  /** Space tiles; without them the board keeps its placeholder disks. */
  tiles?: ThemeTiles;
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
