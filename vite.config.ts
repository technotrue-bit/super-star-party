import { defineConfig, type Plugin } from "vite";

/**
 * three-mesh-bvh reads Line, Points, and BatchedMesh at init. A Mesh never
 * uses those paths. Redirect the package's `three` import so those classes
 * stay out of the shared Three module (that module lives in the boot bundle).
 */
function bvhThreeFacade(): Plugin {
  const facade = new URL("./src/render/bvhThreeFacade.ts", import.meta.url).pathname;
  return {
    name: "bvh-three-facade",
    enforce: "pre",
    resolveId(source, importer) {
      if (source !== "three" || !importer) return null;
      if (!importer.includes("/three-mesh-bvh/")) return null;
      return facade;
    },
  };
}

// SUPER STAR PARTY — dev server config.
// Port 5177 (strict) so it never collides with other local projects.
export default defineConfig({
  base: "./",
  plugins: [bvhThreeFacade()],
  optimizeDeps: {
    // Serve the package as source so the facade alias applies in dev too.
    exclude: ["three-mesh-bvh"],
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
