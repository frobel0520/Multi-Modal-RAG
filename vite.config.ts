import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "web",
  plugins: [react()],
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // Tesseract loads this language file by its fixed basename.
        assetFileNames: (asset) => asset.names.includes("eng.traineddata.gz")
          ? "ocr/eng.traineddata.gz"
          : "assets/[name]-[hash][extname]",
      },
    },
  },
  server: {
    proxy: {
      "/api": "http://127.0.0.1:8787",
    },
  },
});
