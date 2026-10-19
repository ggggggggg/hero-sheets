import { defineConfig } from "vitest/config";

// Unit tests import the real product modules (core/custom) and check build logic.
export default defineConfig({
  test: { include: ["tests/**/*.test.ts"], environment: "node" },
});
