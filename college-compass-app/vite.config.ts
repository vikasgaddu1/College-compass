/// <reference types="vitest" />
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const ios = process.env.BUILD_TARGET === "ios";
const root = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  // Native (Capacitor) build loads from the app bundle, so asset paths must be relative.
  base: ios ? "./" : "/College-compass/app/",
  plugins: [react()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
    // The counselor portal (website only) is a second entry → dist/counselors/index.html. The native app
    // bundle never includes it: counselors sign up and pay on the website, never in the iOS app.
    rollupOptions: { input: ios ? { main: root("./index.html") } : { main: root("./index.html"), counselors: root("./counselors/index.html") } },
  },
  test: {
    environment: "node",
    environmentMatchGlobs: [["**/*.dom.test.tsx", "jsdom"]],
    include: ["src/**/*.test.{ts,tsx}", "counselors/**/*.test.{ts,tsx}"],
  },
});
