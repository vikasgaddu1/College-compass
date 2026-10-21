// Unit tests for the counselor Edge Functions' pure logic (supabase/functions/_shared/*.test.ts).
// Run from college-compass-app/:  npx vitest run --config supabase/vitest.config.mjs
// (Separate from the app's vite.config.ts, which only includes src/.)
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  test: { include: ["functions/**/*.test.ts"], environment: "node" },
});
