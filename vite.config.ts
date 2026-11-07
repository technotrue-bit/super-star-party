import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { defineConfig, type Plugin } from "vite";

/**
 * Redirect one lazy library's `three` import to a facade module. Three is a
 * single module shared with the boot bundle, so every class a lazy chunk
 * names is hoisted into the main chunk; the facade passes through what the
 * game already ships and stands in for the rest.
 * - three-mesh-bvh reads Line, Points, and BatchedMesh at init. A Mesh never
 *   uses those paths.
 * - GLTFLoader (Downtown chunk) names skins, animation, lines, points and
 *   PBR materials the packed city GLB never uses.
 *
 * fileURLToPath, not URL.pathname: on Windows pathname is `/C:/...`, which
 * the loader cannot open.
 */
function threeFacade(name: string, importerPath: string, facadeFile: string): Plugin {
  const facade = fileURLToPath(new URL(facadeFile, import.meta.url));
  return {
    name,
    enforce: "pre",
    resolveId(source, importer) {
      if (source !== "three" || !importer) return null;
      if (!importer.replaceAll("\\", "/").includes(importerPath)) return null;
      return facade;
    },
  };
}

/** Short commit id for the on-screen build tag (Vercel sets the env var; local builds ask git). */
function buildId(): string {
  const fromEnv = process.env.VERCEL_GIT_COMMIT_SHA;
  if (fromEnv) return fromEnv.slice(0, 7);
  try {
    return execSync("git rev-parse --short=7 HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "dev";
  }
}

// SUPER STAR PARTY — dev server config.
// Port 5177 (strict) so it never collides with other local projects.
export default defineConfig({
  base: "./",
  define: {
    __BUILD_ID__: JSON.stringify(buildId()),
  },
  plugins: [
    threeFacade("bvh-three-facade", "/three-mesh-bvh/", "./src/render/bvhThreeFacade.ts"),
    threeFacade("gltf-three-facade", "/three/examples/jsm/loaders/GLTFLoader.js", "./src/board/downtown/gltfThreeFacade.ts"),
  ],
  optimizeDeps: {
    // Serve these as source so the facade aliases apply in dev too.
    exclude: ["three-mesh-bvh", "@dimforge/rapier3d-compat", "three/examples/jsm/loaders/GLTFLoader.js"],
  },
  server: {
    host: true, // reachable over LAN/Tailscale for phone testing
    port: 5177,
    strictPort: true,
  },
  preview: {
    host: true,
    port: 5177,
    strictPort: true,
  },
});
