/// <reference types="vitest" />
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // Native (Capacitor) build loads from the app bundle, so asset paths must be relative.
  base: process.env.BUILD_TARGET === "ios" ? "./" : "/College-compass/app/",
  plugins: [react()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  build: { outDir: "dist", sourcemap: false },
  test: {
    environment: "node",
    environmentMatchGlobs: [["**/*.dom.test.tsx", "jsdom"]],
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
