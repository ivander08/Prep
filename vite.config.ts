import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "src/ui",
  plugins: [react()],
  server: {
    port: 5174,
    proxy: {
      // Trailing slash is load-bearing: a bare "/api" prefix also matches the source
      // file "/api.ts", which then gets proxied to the Bun server and 404s.
      "/api/": "http://127.0.0.1:5173",
    },
  },
  build: {
    outDir: "../../dist/ui",
    emptyOutDir: true,
  },
});
