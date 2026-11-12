import { defineConfig } from "vite";

export default defineConfig({
  // GitHub Pages serves this project from /RPG/, not from the domain root.
  base: "/RPG/",
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
  },
  preview: {
    host: "0.0.0.0",
    port: 4173,
    strictPort: true,
  },
});
