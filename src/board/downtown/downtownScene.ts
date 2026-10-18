/**
 * SUPER STAR PARTY — Downtown's lazy scenery chunk. registry.ts reaches it
 * only through a dynamic import (BOARDS.downtown.loadScene), so the Kenney
 * models, GLTFLoader and the meshopt decoder never weigh on the main bundle
 * or on the other boards.
 */
import type { BoardTheme } from "../boardTheme";
import { loadCityModels } from "./cityModels";
import { buildDowntownCity } from "./downtownCity";

/** Fetch and decode the city once; every Downtown match builds from the same models. */
export async function loadDowntownTheme(): Promise<BoardTheme> {
  const models = await loadCityModels();
  return { build: (host) => buildDowntownCity(host, models) };
}
