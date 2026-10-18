/**
 * Downtown's Kenney models (tools/pack-downtown-assets.mjs packs them into
 * assets/city.glb): fetched, meshopt-decoded and turned into plain geometry
 * the city merges. Only this chunk imports GLTFLoader and the meshopt
 * decoder; GLTFLoader's `three` goes through ./gltfThreeFacade.ts.
 */
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import cityUrl from "./assets/city.glb?url";

/**
 * Model name (the Kenney file name) -> geometry in Kenney units (1 = one
 * road tile, +y up): float `position` + linear `color`, no normals (the
 * pieces are faceted; the city material shades flat).
 */
export type CityModels = ReadonlyMap<string, THREE.BufferGeometry>;

/** Dequantized float copy of a (possibly interleaved, normalized) attribute. */
function toFloat(src: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, size: number): THREE.BufferAttribute {
  const out = new Float32Array(src.count * size);
  for (let i = 0; i < src.count; i++) {
    out[i * size] = src.getX(i);
    out[i * size + 1] = src.getY(i);
    if (size > 2) out[i * size + 2] = src.getZ(i);
  }
  return new THREE.BufferAttribute(out, size);
}

export async function loadCityModels(): Promise<CityModels> {
  const res = await fetch(cityUrl);
  if (!res.ok) throw new Error(`[SSP] Downtown models: HTTP ${res.status} for ${cityUrl}`);
  const data = await res.arrayBuffer();
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.parseAsync(data, "");
  gltf.scene.updateMatrixWorld(true);
  const models = new Map<string, THREE.BufferGeometry>();
  gltf.scene.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    const src = obj.geometry as THREE.BufferGeometry;
    const pos = src.getAttribute("position");
    const color = src.getAttribute("color");
    if (pos && color && src.index) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", toFloat(pos, 3));
      geo.setAttribute("color", toFloat(color, 3));
      geo.setIndex(src.index.clone());
      // Quantized positions carry their scale/offset on the node.
      geo.applyMatrix4(obj.matrixWorld);
      models.set(obj.name, geo);
    }
    src.dispose();
    (obj.material as THREE.Material).dispose();
  });
  return models;
}
