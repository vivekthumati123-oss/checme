import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/unit/agents/node/testgen/**/*.test.ts"],
    exclude: ["node_modules", "dist", "agents/node/testgen/dist/**", "packages/**", "agents/node/testgen/fixtures/**"],
    environment: "node",
    testTimeout: 60_000,
    env: {
      GITHUB_REPOSITORY: "",
    },
  },
});
