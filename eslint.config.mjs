import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      "packages/**",
      "agents/**",
      "tests/**",
      "evals/**",
      "examples/**",
      "configurations/**",
      "l2/**",
      "fixtures/**",
      ".l2/**",
      ".unit-agent/**",
      ".github/**",
      "docs/**",
      "schema/**",
      "scripts/**",
      "!scripts/build.mjs",
      "!scripts/spike-*.ts",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.ts", "test/**/*.ts", "scripts/spike-*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["src/**/*.ts"],
    ignores: ["src/exec/exec.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "node:child_process", message: "Import child processes only through src/exec/exec.ts (D19)." },
            { name: "child_process", message: "Import child processes only through src/exec/exec.ts (D19)." },
            { name: "execa", message: "Import execa only through src/exec/exec.ts (D19)." },
          ],
        },
      ],
    },
  },
  {
    files: ["src/core/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "node:child_process", message: "Import child processes only through src/exec/exec.ts (D19)." },
            { name: "child_process", message: "Import child processes only through src/exec/exec.ts (D19)." },
            { name: "execa", message: "Import execa only through src/exec/exec.ts (D19)." },
            { name: "@octokit/rest", message: "src/core must stay free of GitHub/Actions imports (Section 2.4)." },
            { name: "@octokit/graphql", message: "src/core must stay free of GitHub/Actions imports (Section 2.4)." },
          ],
        },
      ],
    },
  },
);
