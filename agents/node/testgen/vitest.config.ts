import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(dir, "../../..").replace(/\\/g, "/");

export default defineConfig({
  test: {
    include: [`${repoRoot}/tests/unit/agents/node/testgen/**/*.test.ts`],
    exclude: ["node_modules", "dist", "fixtures/**"],
    environment: "node",
    testTimeout: 60_000,
    env: {
      GITHUB_REPOSITORY: "",
    },
  },
});
