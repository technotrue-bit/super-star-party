/**
 * check-mesh-bvh.mjs — the bounds-tree gate does not change hits.
 *
 * Loads src/render/meshBvh.ts the way Vite does and checks:
 * - a 12-triangle box (the card / tile pick) gets no tree and does not
 *   patch Mesh.raycast (three-mesh-bvh stays unloaded)
 * - a dense rigid mesh gets one indirect tree, index buffer untouched
 * - closest hit matches the original Mesh.raycast
 * - skinned and morph meshes are skipped
 * - release drops the tree
 *
 * Run: node tools/check-mesh-bvh.mjs
 */
import { createServer } from "vite";
import * as THREE from "three";
import { acceleratedRaycast } from "three-mesh-bvh";

const server = await createServer({
  server: { middlewareMode: true },
  appType: "custom",
  logLevel: "error",
  optimizeDeps: { noDiscovery: true },
});

let failed = 0;
function check(label, ok) {
  console.log(`${ok ? "ok" : "FAIL"}  ${label}`);
  if (!ok) failed += 1;
}

try {
  const mod = await server.ssrLoadModule("/src/render/meshBvh.ts");
  const original = THREE.Mesh.prototype.raycast;
  check("boot leaves Three's raycast in place", THREE.Mesh.prototype.raycast === original);

  const box = new THREE.BoxGeometry(0.7, 0.92, 0.06);
  check("card box is under the cutoff", mod.triangleCount(box) < mod.STATIC_BVH_MIN_TRIANGLES);
  check(
    "card box builds no tree and does not patch raycast",
    (await mod.attachStaticBoundsTree(box)) === false &&
      !box.boundsTree &&
      THREE.Mesh.prototype.raycast === original
  );

  const mesh = new THREE.Mesh(box);
  mesh.position.set(0.2, 1.1, -0.4);
  mesh.rotation.set(0.2, 0.5, 0.1);
  mesh.updateMatrixWorld(true);
  const raycaster = new THREE.Raycaster();
  raycaster.ray.origin.set(0.2, 1.1, 6);
  raycaster.ray.direction.set(0, 0, -1);
  const brute = [];
  const patched = [];
  original.call(mesh, raycaster, brute);
  mesh.raycast(raycaster, patched);
  check(
    "no-tree raycast matches the original hit",
    brute.length === patched.length &&
      brute.length === 1 &&
      brute[0].faceIndex === patched[0].faceIndex &&
      brute[0].distance === patched[0].distance
  );

  const dense = new THREE.SphereGeometry(1, 64, 48);
  check("dense sphere clears the cutoff", mod.triangleCount(dense) >= mod.STATIC_BVH_MIN_TRIANGLES);
  const indexBefore = dense.getIndex().array.slice();
  const sphere = new THREE.Mesh(dense);
  sphere.position.set(1, 2, 3);
  sphere.rotation.set(0.4, 1.1, 0.2);
  sphere.updateMatrixWorld(true);
  check(
    "dense mesh gets one tree and patches raycast",
    (await mod.attachStaticBoundsTree(dense)) === true &&
      !!dense.boundsTree &&
      THREE.Mesh.prototype.raycast === acceleratedRaycast
  );
  const tree = dense.boundsTree;
  check(
    "second attach does not rebuild",
    (await mod.attachStaticBoundsTree(dense)) === false && dense.boundsTree === tree
  );
  let indexSame = indexBefore.length === dense.getIndex().array.length;
  for (let i = 0; indexSame && i < indexBefore.length; i++) {
    if (indexBefore[i] !== dense.getIndex().array[i]) indexSame = false;
  }
  check("indirect build leaves the index buffer alone", indexSame);

  const hitsA = [];
  const hitsB = [];
  let hitSame = true;
  for (let i = 0; i < 24; i++) {
    const a = (i * 2.399963) % (Math.PI * 2);
    const y = 1 - (2 * (i + 0.5)) / 24;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const dir = new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r).normalize();
    raycaster.ray.origin.copy(dir).multiplyScalar(4).add(sphere.position);
    raycaster.ray.direction.copy(dir).negate();
    hitsA.length = 0;
    hitsB.length = 0;
    original.call(sphere, raycaster, hitsA);
    sphere.raycast(raycaster, hitsB);
    const da = hitsA.length ? hitsA[0].distance : -1;
    const db = hitsB.length ? hitsB[0].distance : -1;
    const fa = hitsA.length ? hitsA[0].faceIndex : -1;
    const fb = hitsB.length ? hitsB[0].faceIndex : -1;
    if ((da < 0) !== (db < 0) || fa !== fb || Math.abs(da - db) > 1e-4) hitSame = false;
  }
  check("dense bounds-tree hits match the original raycast", hitSame);

  const group = new THREE.Group();
  const shared = new THREE.SphereGeometry(1, 48, 32);
  group.add(new THREE.Mesh(shared));
  group.add(new THREE.Mesh(shared));
  const skin = new THREE.SkinnedMesh(new THREE.SphereGeometry(1, 64, 48));
  group.add(skin);
  const morph = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 48));
  morph.morphTargetInfluences = [0];
  group.add(morph);
  group.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)));
  const built = await mod.attachStaticBoundsIn(group);
  check("shared dense geometry is built once", built === 1 && !!shared.boundsTree);
  check("skinned mesh is not treed", !skin.geometry.boundsTree);
  check("morph mesh is not treed", !morph.geometry.boundsTree);
  mod.releaseStaticBoundsIn(group);
  check("release drops the shared tree", !shared.boundsTree);
  check("release leaves the box without a tree", !group.children[4].geometry.boundsTree);
} finally {
  await server.close();
}

if (failed) {
  console.log(`${failed} check(s) failed`);
  process.exit(1);
}
console.log("mesh bvh checks passed");
