import { resolve } from "node:path";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// Second self-contained page. emptyOutDir is off so dist/index.html stays.
export default defineConfig({
  plugins: [viteSingleFile()],
  build: {
    outDir: "dist",
    emptyOutDir: false,
    target: "es2022",
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    rollupOptions: { input: resolve("paf.html") },
  },
});
