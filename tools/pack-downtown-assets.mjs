// Pack the Kenney City Kit models Downtown uses into one small GLB.
//   npm run pack:downtown            (writes src/board/downtown/assets/city.glb, committed)
//   KENNEY=/path/to/kits npm run pack:downtown
//
// Sources: Kenney City Kit Roads 2.2 and City Kit Commercial 2.1 (CC0 1.0, kenney.nl),
// unzipped under $KENNEY (default /workspace/ssp-kenney). Each pick becomes one root node
// named after its file (the theme looks models up by that name).
//
// Colour: every Kenney model samples its kit's palette PNG at a few swatch points. The packer
// bakes that sample into a linear COLOR_0 per vertex and drops the UVs and textures, so the
// whole city draws with ONE vertex-coloured toon material in the game, and the runtime loader
// never decodes an image. The single shared material is KHR_materials_unlit (three's
// GLTFLoader then builds a MeshBasicMaterial, which the game's main chunk already has).
//
// Axes (Kenney, kept as-is): +y up, 1 unit = one road tile. road-straight runs along x with
// sidewalks on the +-z edges; road-intersection-path is a T open to -x, +x and +z;
// road-crossroad-path is a 4-way junction; road-crossing is a straight with a zebra across x = 0.
// Buildings and awnings face +z. light-curved's arm reaches toward -z.
//
// Pipeline: bake colours, merge, dedup, prune, weld, then meshopt (reorder + quantize +
// EXT_meshopt_compression). No Draco, no KTX2: their decoders would outweigh the assets.
// prune drops the normals (an unlit material never reads them), which lets weld share
// vertices across faces; the game shades the pieces flat, so they stay faceted.
import { NodeIO, Document } from "@gltf-transform/core";
import { ALL_EXTENSIONS, KHRTextureTransform, KHRMaterialsUnlit } from "@gltf-transform/extensions";
import { dedup, prune, weld, unpartition, mergeDocuments, meshopt } from "@gltf-transform/functions";
import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer";
import { PNG } from "pngjs";
import { mkdirSync, readFileSync, statSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const KENNEY = process.env.KENNEY ?? "/workspace/ssp-kenney";
const OUT = join(ROOT, "src/board/downtown/assets/city.glb");

const KITS = [
  {
    dir: join(KENNEY, "kenney_city-kit-roads/Models/GLB format"),
    picks: [
      "road-straight",
      "road-crossing",
      "road-crossroad-path",
      "road-intersection-path",
      "light-curved",
      "traffic-light",
      "construction-cone",
      "construction-barrier",
    ],
  },
  {
    dir: join(KENNEY, "kenney_city-kit-commercial_2.1/Models/GLB format"),
    picks: [
      "building-a",
      "building-b",
      "building-c",
      "building-d",
      "building-e",
      "building-f",
      "building-g",
      "building-h",
      "building-skyscraper-a",
      "building-skyscraper-b",
      "building-skyscraper-c",
      "building-skyscraper-e",
      ..."abcdefghijklmn".split("").map((c) => `low-detail-building-${c}`),
      "low-detail-building-wide-a",
      "low-detail-building-wide-b",
      "detail-awning",
      "detail-awning-wide",
      "detail-parasol-a",
      "detail-parasol-b",
    ],
  },
];

/** sRGB byte -> linear float (glTF vertex colours are linear). */
const toLinear = (b) => {
  const c = b / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
};

/** Bilinear palette sample at a glTF uv (origin top-left), as linear rgb. */
function samplePalette(png, u, v) {
  const fx = Math.min(png.width - 1, Math.max(0, u * png.width - 0.5));
  const fy = Math.min(png.height - 1, Math.max(0, v * png.height - 0.5));
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(png.width - 1, x0 + 1);
  const y1 = Math.min(png.height - 1, y0 + 1);
  const tx = fx - x0;
  const ty = fy - y0;
  const px = (x, y, k) => png.data[(y * png.width + x) * 4 + k];
  const out = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    const top = px(x0, y0, k) * (1 - tx) + px(x1, y0, k) * tx;
    const bot = px(x0, y1, k) * (1 - tx) + px(x1, y1, k) * tx;
    out[k] = toLinear(top * (1 - ty) + bot * ty);
  }
  return out;
}

await MeshoptEncoder.ready;
await MeshoptDecoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ "meshopt.encoder": MeshoptEncoder, "meshopt.decoder": MeshoptDecoder });

const doc = new Document();
doc.createBuffer();
const scene = doc.createScene("city");
const material = doc.createMaterial("city").setBaseColorFactor([1, 1, 1, 1]);
material.setExtension("KHR_materials_unlit", doc.createExtension(KHRMaterialsUnlit).createUnlit());
let srcTris = 0;
let srcBytes = 0;

for (const kit of KITS) {
  const palette = PNG.sync.read(readFileSync(join(kit.dir, "Textures/colormap.png")));
  for (const name of kit.picks) {
    const file = join(kit.dir, `${name}.glb`);
    srcBytes += statSync(file).size;
    const src = await io.read(file);
    // Every Kenney transform is identity (offset 0, scale 1); drop it with the texture.
    src.createExtension(KHRTextureTransform).dispose();
    const roots = src.getRoot().listScenes()[0].listChildren();
    if (roots.length !== 1 || roots[0].listChildren().length !== 0 || !roots[0].getMesh()) {
      throw new Error(`${name}: expected one root node with one mesh`);
    }
    const mesh = roots[0].getMesh();
    const prims = mesh.listPrimitives();
    if (prims.length !== 1) throw new Error(`${name}: expected one primitive`);
    const prim = prims[0];
    const uv = prim.getAttribute("TEXCOORD_0");
    if (!uv) throw new Error(`${name}: no TEXCOORD_0 to bake from`);
    const n = uv.getCount();
    const colors = new Float32Array(n * 3);
    const t = [0, 0];
    for (let i = 0; i < n; i++) {
      uv.getElement(i, t);
      colors.set(samplePalette(palette, t[0], t[1]), i * 3);
    }
    prim.setAttribute("COLOR_0", src.createAccessor().setType("VEC3").setArray(colors).setBuffer(src.getRoot().listBuffers()[0]));
    prim.setAttribute("TEXCOORD_0", null);
    roots[0].setName(name);
    mesh.setName(name);
    srcTris += (prim.getIndices()?.getCount() ?? prim.getAttribute("POSITION").getCount()) / 3;
    const map = mergeDocuments(doc, src);
    for (const s of src.getRoot().listScenes()) {
      const merged = map.get(s);
      for (const child of merged.listChildren()) {
        scene.addChild(child);
        child.getMesh().listPrimitives()[0].setMaterial(material);
      }
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
  meshopt({ encoder: MeshoptEncoder, level: "high" })
);

// Sanity: one unlit material, no textures, one coloured primitive per model.
const root = doc.getRoot();
const names = root.listNodes().map((n) => n.getName());
for (const kit of KITS) for (const n of kit.picks) if (!names.includes(n)) throw new Error(`lost ${n}`);
for (const n of root.listNodes()) {
  const prims = n.getMesh()?.listPrimitives() ?? [];
  if (prims.length !== 1) throw new Error(`${n.getName()}: expected one primitive`);
  if (!prims[0].getAttribute("COLOR_0") || prims[0].getAttribute("TEXCOORD_0")) throw new Error(`${n.getName()}: colour bake missing`);
  if (prims[0].getMaterial() !== material) throw new Error(`${n.getName()}: not on the shared material`);
}
if (root.listTextures().length !== 0) throw new Error(`expected no textures, got ${root.listTextures().length}`);
if (root.listMaterials().length !== 1) throw new Error(`expected 1 material, got ${root.listMaterials().length}`);

mkdirSync(dirname(OUT), { recursive: true });
await io.write(OUT, doc);
const bytes = readFileSync(OUT);
console.log(
  `wrote ${OUT}: ${names.length} models, ${srcTris} tris, 1 unlit vertex-colour material, no textures; ` +
    `${bytes.length} bytes (${gzipSync(bytes, { level: 9 }).length} gz) from ${srcBytes} source bytes`
);
