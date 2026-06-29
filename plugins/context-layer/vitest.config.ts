import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// Tests live in this package but also exercise the hook-runtime `.mjs` modules
// one level up (hooks/unified/modules), so allow filesystem access to the repo
// root for cross-runtime parity tests.
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
  server: {
    fs: { allow: [repoRoot] },
  },
});
