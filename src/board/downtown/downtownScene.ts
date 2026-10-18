import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
export async function probe(url: string): Promise<unknown> {
  const l = new GLTFLoader();
  l.setMeshoptDecoder(MeshoptDecoder);
  return l.loadAsync(url);
}
