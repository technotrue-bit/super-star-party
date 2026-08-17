import { defineConfig } from "vite";

// SUPER STAR PARTY — dev server config.
// Port 5177 (strict) so it never collides with other local projects.
export default defineConfig({
  base: "./",
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
