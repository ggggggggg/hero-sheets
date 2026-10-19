import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// Single self-contained HTML: the whole builder in one file, works offline.
export default defineConfig({
  plugins: [viteSingleFile()],
  build: { outDir: "dist", target: "es2022", assetsInlineLimit: Number.MAX_SAFE_INTEGER },
});
