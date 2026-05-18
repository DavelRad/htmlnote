import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";
import { resolve } from "node:path";

export default defineConfig({
  root: "src/ui",
  plugins: [react(), viteSingleFile()],
  build: {
    outDir: resolve(__dirname, "dist/ui"),
    emptyOutDir: true,
    cssCodeSplit: false,
    // We ship a single inlined HTML; set the inline-limit absurdly high so
    // any future fonts/images get embedded as data: URIs rather than emitted
    // as sibling files vite-plugin-singlefile would then need to inline.
    assetsInlineLimit: 100_000_000,
    rollupOptions: {
      output: { inlineDynamicImports: true },
    },
  },
  server: {
    port: 5174,
  },
});
