import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { defineConfig, type Plugin } from "vite";

/**
 * three-mesh-bvh reads Line, Points, and BatchedMesh at init. A Mesh never
 * uses those paths. Redirect the package's `three` import so those classes
 * stay out of the shared Three module (that module lives in the boot bundle).
 *
 * fileURLToPath, not URL.pathname: on Windows pathname is `/C:/...`, which
 * the loader cannot open.
 */
function bvhThreeFacade(): Plugin {
  const facade = fileURLToPath(new URL("./src/render/bvhThreeFacade.ts", import.meta.url));
  return {
    name: "bvh-three-facade",
    enforce: "pre",
    resolveId(source, importer) {
      if (source !== "three" || !importer) return null;
      if (!importer.replaceAll("\\", "/").includes("/three-mesh-bvh/")) return null;
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
  plugins: [bvhThreeFacade()],
  optimizeDeps: {
    // Serve the package as source so the facade alias applies in dev too.
    exclude: ["three-mesh-bvh", "@dimforge/rapier3d-compat"],
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
