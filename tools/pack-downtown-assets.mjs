// Pack the Kenney City Kit models Downtown uses into one small GLB.
//   npm run pack:downtown            (writes src/board/downtown/assets/city.glb, committed)
//   KENNEY=/path/to/kits npm run pack:downtown
//
// Sources (CC0, see CREDITS.md): Kenney City Kit Roads 2.2 and City Kit Commercial 2.1,
// unzipped under $KENNEY (default /workspace/ssp-kenney). Each pick becomes one root node
// named after its file (the theme looks models up by that name). Both kits keep their
// own palette PNG (one texture per kit, shared by every model of that kit, resized).
// Pipeline: merge, drop the identity KHR_texture_transform, dedup, prune, weld,
// palette resize (sharp), then meshopt (reorder + quantize + EXT_meshopt_compression).
// No Draco, no KTX2: their decoders would outweigh the assets.
import { NodeIO, Document } from "@gltf-transform/core";
import { ALL_EXTENSIONS, KHRTextureTransform } from "@gltf-transform/extensions";
import { dedup, prune, weld, unpartition, mergeDocuments, textureCompress, meshopt } from "@gltf-transform/functions";
import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer";
import sharp from "sharp";
import { mkdirSync, statSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const KENNEY = process.env.KENNEY ?? "/workspace/ssp-kenney";
const OUT = join(ROOT, "src/board/downtown/assets/city.glb");
/** Palette edge length after resize (512 in the kits; the swatches sample column centres). */
const PALETTE = 128;

const KITS = [
  {
    dir: join(KENNEY, "kenney_city-kit-roads/Models/GLB format"),
    picks: [
      "road-straight",
      "road-crossing",
      "road-crossroad",
      "road-intersection",
      "road-bend-square",
      "road-bridge",
      "light-curved",
      "light-curved-double",
      "light-square-double",
      "traffic-light",
      "construction-cone",
      "construction-barrier",
    ],
  },
  {
    dir: join(KENNEY, "kenney_city-kit-commercial_2.1/Models/GLB format"),
    picks: [
      "building-a",
      "building-c",
      "building-e",
      "building-skyscraper-a",
      "building-skyscraper-b",
      "building-skyscraper-e",
      "low-detail-building-a",
      "low-detail-building-wide-a",
      "detail-awning-wide",
      "detail-parasol-a",
    ],
  },
];

await MeshoptEncoder.ready;
await MeshoptDecoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ "meshopt.encoder": MeshoptEncoder, "meshopt.decoder": MeshoptDecoder });

const doc = new Document();
doc.createBuffer();
const scene = doc.createScene("city");
let srcTris = 0;
let srcBytes = 0;

for (const kit of KITS) {
  for (const name of kit.picks) {
    const file = join(kit.dir, `${name}.glb`);
    srcBytes += statSync(file).size;
    const src = await io.read(file);
    // Every Kenney transform is identity (offset 0, scale 1); drop it so the GLB needs no extension.
    src.createExtension(KHRTextureTransform).dispose();
    const roots = src.getRoot().listScenes()[0].listChildren();
    if (roots.length !== 1 || roots[0].listChildren().length !== 0 || !roots[0].getMesh()) {
      throw new Error(`${name}: expected one root node with one mesh`);
    }
    roots[0].setName(name);
    roots[0].getMesh().setName(name);
    for (const p of roots[0].getMesh().listPrimitives()) {
      srcTris += (p.getIndices()?.getCount() ?? p.getAttribute("POSITION").getCount()) / 3;
    }
    const map = mergeDocuments(doc, src);
    for (const s of src.getRoot().listScenes()) {
      const merged = map.get(s);
      for (const child of merged.listChildren()) scene.addChild(child);
      merged.dispose();
    }
  }
}
doc.getRoot().setDefaultScene(scene);

await doc.transform(
  unpartition(),
  dedup(),
  prune({ keepLeaves: false }),
  weld(),
  textureCompress({ encoder: sharp, resize: [PALETTE, PALETTE], targetFormat: "png" }),
  meshopt({ encoder: MeshoptEncoder, level: "medium" })
);

// Sanity: the theme expects 2 materials (one palette each) and one primitive per model.
const root = doc.getRoot();
const names = root.listNodes().map((n) => n.getName());
for (const kit of KITS) for (const n of kit.picks) if (!names.includes(n)) throw new Error(`lost ${n}`);
for (const n of root.listNodes()) {
  if (n.getMesh()?.listPrimitives().length !== 1) throw new Error(`${n.getName()}: expected one primitive`);
}
if (root.listTextures().length !== KITS.length) throw new Error(`expected ${KITS.length} textures, got ${root.listTextures().length}`);

mkdirSync(dirname(OUT), { recursive: true });
await io.write(OUT, doc);
const bytes = readFileSync(OUT);
console.log(
  `wrote ${OUT}: ${names.length} models, ${srcTris} tris, ${root.listMaterials().length} materials, ` +
    `${root.listTextures().map((t) => t.getSize()?.join("x")).join(" + ")} textures; ` +
    `${bytes.length} bytes (${gzipSync(bytes, { level: 9 }).length} gz) from ${srcBytes} source bytes`
);
