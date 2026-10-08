/**
 * probe-bvh.mjs — before/after cost of three-mesh-bvh on this game's hit tests.
 *
 * The live game mesh-picks Memory Match cards and Pipe Puzzle tiles (shared
 * BoxGeometry, pointer-down only). Bumper Balls and Coin Grab aim with
 * Ray.intersectPlane. Balloon Pop uses a 2D radius test. Nothing shapecasts
 * and nothing collides the camera against a mesh.
 *
 * Run: node tools/probe-bvh.mjs
 * Prints triangle counts, build time, tree bytes, and raycast microseconds.
 * No Math.random — ray directions are a fixed table.
 */
import * as THREE from "three";
import {
  acceleratedRaycast,
  computeBoundsTree,
  disposeBoundsTree,
  estimateMemoryInBytes,
} from "three-mesh-bvh";

const originalRaycast = THREE.Mesh.prototype.raycast;

function trisOf(geo) {
  const index = geo.getIndex();
  if (index) return Math.floor(index.count / 3);
  const pos = geo.getAttribute("position");
  return pos ? Math.floor(pos.count / 3) : 0;
}

function buildTree(geo) {
  const t0 = performance.now();
  // indirect: leave the rendered index buffer alone (material groups stay put).
  computeBoundsTree.call(geo, { indirect: true, verbose: false });
  const ms = performance.now() - t0;
  const bytes = estimateMemoryInBytes(geo.boundsTree);
  return { ms, bytes };
}

function dropTree(geo) {
  disposeBoundsTree.call(geo);
}

/** Fixed rays, not Math.random, so the probe is repeatable. */
function rayTable(count) {
  const rays = [];
  for (let i = 0; i < count; i++) {
    const a = (i * 2.399963) % (Math.PI * 2);
    const y = 1 - (2 * (i + 0.5)) / count;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const dir = new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r).normalize();
    // Start outside the unit sphere and aim at the origin so the ray hits.
    const origin = dir.clone().multiplyScalar(4);
    rays.push(new THREE.Ray(origin, dir.clone().negate()));
  }
  return rays;
}

function timeRaycast(mesh, rays, reps) {
  const raycaster = new THREE.Raycaster();
  const hits = [];
  // Sink so V8 cannot delete the raycast as a dead store.
  let sink = 0;
  const once = () => {
    for (let i = 0; i < rays.length; i++) {
      raycaster.ray.copy(rays[i]);
      hits.length = 0;
      mesh.raycast(raycaster, hits);
      if (hits.length) sink += hits[0].distance;
      sink += hits.length;
    }
  };
  once();
  const t0 = performance.now();
  for (let r = 0; r < reps; r++) once();
  const ms = performance.now() - t0;
  const n = rays.length * reps;
  return { ms, n, us: (ms * 1000) / n, sink };
}

function benchMesh(label, geo, rays, reps) {
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial());
  mesh.updateMatrixWorld(true);
  THREE.Mesh.prototype.raycast = originalRaycast;
  const before = timeRaycast(mesh, rays, reps);
  const built = buildTree(geo);
  THREE.Mesh.prototype.raycast = acceleratedRaycast;
  const after = timeRaycast(mesh, rays, reps);
  // Identity: same closest face / distance on every ray.
  let mismatches = 0;
  let maxDist = 0;
  const raycaster = new THREE.Raycaster();
  const a = [];
  const b = [];
  for (let i = 0; i < rays.length; i++) {
    raycaster.ray.copy(rays[i]);
    a.length = 0;
    b.length = 0;
    THREE.Mesh.prototype.raycast = originalRaycast;
    dropTree(geo);
    mesh.raycast(raycaster, a);
    buildTree(geo);
    THREE.Mesh.prototype.raycast = acceleratedRaycast;
    mesh.raycast(raycaster, b);
    const da = a.length ? a[0].distance : -1;
    const db = b.length ? b[0].distance : -1;
    const fa = a.length ? a[0].faceIndex : -1;
    const fb = b.length ? b[0].faceIndex : -1;
    if ((da < 0) !== (db < 0) || fa !== fb || Math.abs(da - db) > 1e-4) {
      mismatches++;
      maxDist = Math.max(maxDist, Math.abs(da - db));
    }
  }
  dropTree(geo);
  const speed = before.us / after.us;
  console.log(
    [
      label.padEnd(28),
      `tris ${String(trisOf(geo)).padStart(7)}`,
      `build ${built.ms.toFixed(2).padStart(7)} ms`,
      `tree ${(built.bytes / 1024).toFixed(1).padStart(7)} KB`,
      `before ${before.us.toFixed(3).padStart(8)} us`,
      `after ${after.us.toFixed(3).padStart(8)} us`,
      `x ${speed.toFixed(2).padStart(6)}`,
      mismatches ? `MISMATCH ${mismatches} maxd ${maxDist}` : "hits-match",
      `sink ${before.sink.toFixed(1)}/${after.sink.toFixed(1)}`,
    ].join("  ")
  );
  mesh.geometry = null;
  return { label, tris: trisOf(geo), before: before.us, after: after.us, speed, bytes: built.bytes, buildMs: built.ms, mismatches };
}

function benchPick(label, count, geo, camera, place) {
  const meshes = [];
  for (let i = 0; i < count; i++) {
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial());
    place(m, i, count);
    m.updateMatrixWorld(true);
    meshes.push(m);
  }
  const raycaster = new THREE.Raycaster();
  const ndc = [
    new THREE.Vector2(0, 0),
    new THREE.Vector2(-0.4, 0.2),
    new THREE.Vector2(0.35, -0.15),
    new THREE.Vector2(0.1, 0.45),
    new THREE.Vector2(-0.2, -0.4),
  ];
  const reps = 400;
  function run() {
    let sink = 0;
    for (let i = 0; i < ndc.length; i++) {
      raycaster.setFromCamera(ndc[i], camera);
      const found = raycaster.intersectObjects(meshes, false);
      sink += found.length;
      if (found.length) sink += found[0].distance;
    }
    const t0 = performance.now();
    for (let r = 0; r < reps; r++) {
      raycaster.setFromCamera(ndc[r % ndc.length], camera);
      const found = raycaster.intersectObjects(meshes, false);
      sink += found.length;
      if (found.length) sink += found[0].distance;
    }
    const ms = performance.now() - t0;
    return { us: (ms * 1000) / reps, sink };
  }
  THREE.Mesh.prototype.raycast = originalRaycast;
  dropTree(geo);
  const before = run();
  const built = buildTree(geo);
  THREE.Mesh.prototype.raycast = acceleratedRaycast;
  const after = run();
  // Closest-object identity across the sample rays.
  let mismatch = 0;
  for (let i = 0; i < ndc.length; i++) {
    raycaster.setFromCamera(ndc[i], camera);
    THREE.Mesh.prototype.raycast = originalRaycast;
    dropTree(geo);
    const a = raycaster.intersectObjects(meshes, false)[0];
    buildTree(geo);
    THREE.Mesh.prototype.raycast = acceleratedRaycast;
    const b = raycaster.intersectObjects(meshes, false)[0];
    const same =
      (!a && !b) ||
      (a && b && a.object === b.object && Math.abs(a.distance - b.distance) < 1e-4);
    if (!same) mismatch++;
  }
  dropTree(geo);
  THREE.Mesh.prototype.raycast = originalRaycast;
  console.log(
    [
      label.padEnd(28),
      `objs ${String(count).padStart(3)}`,
      `tris/mesh ${String(trisOf(geo)).padStart(5)}`,
      `build ${built.ms.toFixed(2).padStart(7)} ms`,
      `tree ${(built.bytes / 1024).toFixed(1).padStart(7)} KB`,
      `before ${before.us.toFixed(3).padStart(8)} us/pick`,
      `after ${after.us.toFixed(3).padStart(8)} us/pick`,
      `x ${(before.us / after.us).toFixed(2).padStart(6)}`,
      mismatch ? `MISMATCH ${mismatch}` : "closest-match",
      `sink ${before.sink.toFixed(1)}/${after.sink.toFixed(1)}`,
    ].join("  ")
  );
}

function benchPlane(label) {
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const ray = new THREE.Ray(new THREE.Vector3(0, 5, 0), new THREE.Vector3(0, -1, 0));
  const target = new THREE.Vector3();
  const reps = 200000;
  const t0 = performance.now();
  for (let i = 0; i < reps; i++) ray.intersectPlane(plane, target);
  const us = ((performance.now() - t0) * 1000) / reps;
  console.log(`${label.padEnd(28)}  plane intersect ${us.toFixed(4)} us  (no mesh, BVH does not apply)`);
}

console.log("three-mesh-bvh probe — indirect trees, verbose off");
console.log("us = microseconds per ray (single mesh) or per pick (many meshes)");
console.log("");

const rays = rayTable(64);
const reps = 80;

const cases = [
  ["box card (memory match)", new THREE.BoxGeometry(0.7, 0.92, 0.06)],
  ["box tile (pipe puzzle)", new THREE.BoxGeometry(0.92, 0.15, 0.92)],
  ["sphere body 24x18", new THREE.SphereGeometry(0.5, 24, 18)],
  ["sphere 32x24", new THREE.SphereGeometry(1, 32, 24)],
  ["sphere 64x48", new THREE.SphereGeometry(1, 64, 48)],
  ["sphere 128x96", new THREE.SphereGeometry(1, 128, 96)],
];

for (const [label, geo] of cases) {
  benchMesh(label, geo, rays, reps);
}

console.log("");
const cam = new THREE.PerspectiveCamera(45, 9 / 16, 0.1, 100);
cam.position.set(0, 8.8, 10.9);
cam.lookAt(0, 1, 0);
cam.updateMatrixWorld(true);
const card = new THREE.BoxGeometry(0.7, 0.92, 0.06);
benchPick("memory-match card pick", 16, card, cam, (m, i) => {
  const col = i % 4;
  const row = Math.floor(i / 4);
  m.position.set((col - 1.5) * 1.08, 0.9, (row - 1.5) * 1.08);
  m.rotation.y = 0.15;
});
const tile = new THREE.BoxGeometry(0.92, 0.15, 0.92);
benchPick("pipe-puzzle tile pick", 25, tile, cam, (m, i) => {
  const col = i % 5;
  const row = Math.floor(i / 5);
  m.position.set((col - 2) * 1.05, 0.97, (row - 2) * 1.05);
});

console.log("");
benchPlane("bumper / coin-grab aim");

console.log("");
console.log("read this as two cases:");
console.log("- a ray that hits one mesh: the tree wins, and the gap grows with triangle count.");
console.log("- a pick across many boxes (the game): most meshes miss, and the tree is slower.");
console.log("src/render/meshBvh.ts therefore trees only static rigid geometry at or above its cutoff.");
console.log("The live card and tile boxes stay on the original raycast.");
