import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/fixtures/**",
      "**/schema/**",
      "**/templates/**",
      "**/src/*.js",
      "**/agents/node/codeconnect/**",
      "**/agents/node/tasksync/**",
      "**/agents/node/modplanner/**",
      "**/agents/node/requirementshub/**",
      "**/agents/node/architectconnect/**",
      "**/agents/node/scm-bridge/**",
      "**/agents/node/common/**",
      "**/agents/python/**",
      "**/packages/**",
      "**/tests/node/**",
      "**/tests/python/**",
      "**/tests/unit/agents/node/architectconnect/**",
      "**/tests/unit/agents/node/modplanner/**",
      "**/tests/unit/agents/node/requirementshub/**",
      "**/tests/unit/packages/**",
      "**/tests/unit/.github/**",
      "**/tests/unit/scripts/**",
      "**/evals/**",
      "**/examples/**",
      "**/configurations/**",
      "**/l2/**",
      "**/.l2/**",
      "**/.unit-agent/**",
      "**/.github/**",
      "**/docs/**",
      "**/scripts/**",
      "!**/scripts/build.mjs",
      "!**/scripts/spike-*.ts",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: [
      "src/**/*.ts",
      "agents/node/testgen/src/**/*.ts",
      "tests/unit/agents/node/testgen/**/*.ts",
      "scripts/spike-*.ts",
      "**/src/**/*.ts",
      "**/tests/unit/agents/node/testgen/**/*.ts",
    ],
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["src/**/*.ts", "agents/node/testgen/src/**/*.ts", "**/src/**/*.ts"],
    ignores: ["src/exec/exec.ts", "agents/node/testgen/src/exec/exec.ts", "**/src/exec/exec.ts"],
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
    files: ["src/core/**/*.ts", "agents/node/testgen/src/core/**/*.ts", "**/src/core/**/*.ts"],
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
