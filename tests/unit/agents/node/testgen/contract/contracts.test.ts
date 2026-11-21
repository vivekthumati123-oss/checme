import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

import { runConfigCheck } from "../../../../../../agents/node/testgen/src/config/check";
import { ARTIFACTS, ConfigSchema, exportConfigJsonSchema } from "../../../../../../agents/node/testgen/src/contracts";
import { APPROVE_ENV_NAME } from "../../../../../../agents/node/testgen/src/stages/publish";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../../../../..");

function collectFilesRecursive(dir: string, exts: readonly string[]): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const abs = path.join(dir, entry);
    const st = statSync(abs);
    if (st.isDirectory()) {
      out.push(...collectFilesRecursive(abs, exts));
    } else if (exts.some((ext) => abs.endsWith(ext))) {
      out.push(abs);
    }
  }
  return out;
}

describe("Contract suite (workflow YAML, schemas, and repo invariants)", () => {
  it("keeps workflow artifact names and stage folders aligned with ARTIFACTS contract", () => {
    const runYml = readFileSync(path.join(REPO_ROOT, ".github/workflows/_testgen-run.yml"), "utf8");
    const validateYml = readFileSync(path.join(REPO_ROOT, ".github/workflows/_testgen-validate.yml"), "utf8");
    const combined = `${runYml}\n${validateYml}`;

    for (const key of Object.keys(ARTIFACTS) as Array<keyof typeof ARTIFACTS>) {
      const spec = ARTIFACTS[key];
      expect(combined).toContain(spec.name);
      if (key !== "snapshot1" && key !== "snapshot2" && key !== "validate1" && key !== "validate2") {
        expect(runYml).toContain(`.unit-agent/${spec.dir}`);
      }
    }
    expect(validateYml).toContain(".unit-agent/snapshot${{ inputs.attempt }}");
    expect(validateYml).toContain(".unit-agent/validate${{ inputs.attempt }}");
  });

  it("wraps every CLI step with ${UA_NODE:-node} and enforces Node 20 target", () => {
    const cliAction = readFileSync(path.join(REPO_ROOT, ".github/actions/unit-agent/action.yml"), "utf8");
    expect(cliAction).toContain('"${UA_NODE:-node}"');
    expect(cliAction).toContain("--throw-deprecation");
    expect(cliAction).toContain("agents/node/testgen/dist/cli.js");

    const cliDoc = parseYaml(cliAction) as { outputs?: Record<string, { value?: string }> };
    for (const requiredOut of [
      "proceed",
      "skip",
      "languages",
      "toolchains",
      "has_work",
      "has_notice",
      "needs_repair",
      "has_tests",
    ]) {
      expect(cliDoc.outputs?.[requiredOut]?.value).toBe(`\${{ steps.run.outputs.${requiredOut} }}`);
    }

    const buildScript = readFileSync(path.join(REPO_ROOT, "agents/node/testgen/scripts/build.mjs"), "utf8");
    expect(buildScript).toContain("node20");

    const distCli = path.join(REPO_ROOT, "agents/node/testgen/dist/cli.js");
    if (existsSync(distCli)) {
      const content = readFileSync(distCli, "utf8");
      expect(content.length).toBeGreaterThan(1000);
      expect(existsSync(path.join(REPO_ROOT, "agents/node/testgen/dist/wasm/tree-sitter.wasm"))).toBe(true);
    }
  });

  it("keeps approval environment name unit-agent-approval consistent across code, workflows, and docs", () => {
    expect(APPROVE_ENV_NAME).toBe("unit-agent-approval");
    const unitAgentYml = readFileSync(path.join(REPO_ROOT, ".github/workflows/unit-agent.yml"), "utf8");
    const runYml = readFileSync(path.join(REPO_ROOT, ".github/workflows/_testgen-run.yml"), "utf8");
    const setupDoc = readFileSync(path.join(REPO_ROOT, "docs/testgen/setup.md"), "utf8");
    const approverDoc = readFileSync(path.join(REPO_ROOT, "docs/testgen/approver-guide.md"), "utf8");

    expect(unitAgentYml).toContain("approval-environment: unit-agent-approval");
    expect(runYml).toContain('default: "unit-agent-approval"');
    expect(runYml).toContain("environment: ${{ inputs.approval-environment }}");
    expect(setupDoc).toContain("unit-agent-approval");
    expect(approverDoc).toContain("unit-agent-approval");
  });

  it("matches docs/supported-versions.md tested tier 1:1 with .github/workflows/matrix.yml", () => {
    const matrixDoc = parseYaml(
      readFileSync(path.join(REPO_ROOT, ".github/workflows/_testgen-matrix.yml"), "utf8"),
    ) as {
      jobs: {
        "node-matrix": { strategy: { matrix: { os: string[]; "node-version": string[] } } };
        "python-matrix": { strategy: { matrix: { os: string[]; "python-version": string[] } } };
        "java-matrix": {
          strategy: { matrix: { os: string[]; "java-version": string[]; "build-tool": string[] } };
        };
      };
    };
    const supportedDoc = readFileSync(path.join(REPO_ROOT, "docs/testgen/supported-versions.md"), "utf8");

    expect(supportedDoc).toContain("Maintainer:");
    for (const osName of matrixDoc.jobs["node-matrix"].strategy.matrix.os) {
      expect(supportedDoc).toContain(`\`${osName}\``);
    }
    for (const nv of matrixDoc.jobs["node-matrix"].strategy.matrix["node-version"]) {
      expect(supportedDoc).toContain(`\`${nv}\``);
    }
    for (const pv of matrixDoc.jobs["python-matrix"].strategy.matrix["python-version"]) {
      expect(supportedDoc).toContain(`\`${pv}\``);
    }
    for (const jv of matrixDoc.jobs["java-matrix"].strategy.matrix["java-version"]) {
      expect(supportedDoc).toContain(`\`${jv}\``);
    }
    for (const bt of matrixDoc.jobs["java-matrix"].strategy.matrix["build-tool"]) {
      expect(supportedDoc).toContain(`\`${bt}\``);
    }
  });

  it("keeps schema/unit-agent.schema.json in sync with ConfigSchema and validates every fixture repo config", () => {
    const schemaOnDisk = JSON.parse(
      readFileSync(path.join(REPO_ROOT, "agents/node/testgen/schema/unit-agent.schema.json"), "utf8"),
    ) as Record<string, unknown>;
    const exported = exportConfigJsonSchema();
    expect(schemaOnDisk.properties).toEqual(exported.properties);

    const reposDir = path.join(REPO_ROOT, "agents/node/testgen/fixtures/repos");
    const repoNames = readdirSync(reposDir);
    expect(repoNames.length).toBeGreaterThanOrEqual(8);
    for (const name of repoNames) {
      const repoPath = path.join(reposDir, name);
      const raw = parseYaml(readFileSync(path.join(repoPath, ".unit-agent.yml"), "utf8"));
      expect(() => ConfigSchema.parse(raw)).not.toThrow();
      const checkRes = runConfigCheck(repoPath);
      expect(checkRes.ok, `config check failed on ${name}: ${checkRes.errors.join("; ")}`).toBe(true);
    }
  });

  it("enforces static banned-pattern invariants across src/, templates/, and unit-agent workflows", () => {
    const srcFiles = collectFilesRecursive(path.join(REPO_ROOT, "agents/node/testgen/src"), [".ts"]);
    expect(srcFiles.length).toBeGreaterThan(20);

    for (const file of srcFiles) {
      const rel = path.relative(REPO_ROOT, file).replace(/\\/g, "/");
      const text = readFileSync(file, "utf8");

      // Rule: HEAD~1 appears nowhere in src/
      expect(text, `HEAD~1 forbidden in ${rel}`).not.toContain("HEAD~1");

      // Rule: child_process / execa only imported in src/exec/exec.ts
      if (rel !== "agents/node/testgen/src/exec/exec.ts") {
        expect(text, `child_process forbidden outside src/exec/exec.ts (${rel})`).not.toMatch(
          /from\s+["'](?:node:)?child_process["']/,
        );
        expect(text, `execa forbidden outside src/exec/exec.ts (${rel})`).not.toMatch(/from\s+["']execa["']/);
      }

      // Rule: src/core free of GITHUB_* and process.env.GITHUB
      if (rel.startsWith("agents/node/testgen/src/core/")) {
        expect(text, `GITHUB_ env forbidden in src/core (${rel})`).not.toMatch(/process\.env\.GITHUB/);
        expect(text, `GITHUB_* reference forbidden in src/core (${rel})`).not.toContain("GITHUB_TOKEN");
        expect(text, `GITHUB_* reference forbidden in src/core (${rel})`).not.toContain("GITHUB_OUTPUT");
      }

      // Rule: git diff invoked only inside src/core/git/range.ts and src/core/git/diff.ts
      if (rel !== "agents/node/testgen/src/core/git/range.ts" && rel !== "agents/node/testgen/src/core/git/diff.ts") {
        expect(text, `git diff invocation forbidden in ${rel}`).not.toMatch(
          /runCommand\s*\(\s*["']git["']\s*,\s*\[\s*["']diff["']/,
        );
      }
    }

    // Rule: no mcp-servers anywhere in templates or unit-agent agent definition
    const tmplFiles = collectFilesRecursive(path.join(REPO_ROOT, "agents/node/testgen/templates/chat"), [
      ".md",
      ".tmpl",
      ".json",
    ]);
    for (const tf of [...tmplFiles, path.join(REPO_ROOT, ".github/agents/unit-agent.agent.md")]) {
      expect(readFileSync(tf, "utf8")).not.toContain("mcp-servers");
    }

    // Rule: no ${{ github.event.* }} directly interpolated inside bash/pwsh run: blocks in unit-agent workflows
    for (const wfName of [
      "unit-agent.yml",
      "_testgen-run.yml",
      "_testgen-validate.yml",
      "testgen-ci.yml",
      "_testgen-matrix.yml",
      "release.yml",
      "_testgen-e2e.yml",
    ]) {
      const wf = parseYaml(readFileSync(path.join(REPO_ROOT, ".github/workflows", wfName), "utf8")) as {
        jobs?: Record<string, { steps?: Array<{ run?: string }> }>;
      };
      for (const [jobName, job] of Object.entries(wf.jobs ?? {})) {
        for (const step of job.steps ?? []) {
          if (typeof step.run === "string") {
            expect(step.run, `${wfName}:${jobName} run script must not interpolate github.event`).not.toMatch(
              /\$\{\{\s*github\.event\./,
            );
          }
        }
      }
    }

    // Rule: zod JSON schema sanity check
    expect(typeof z.toJSONSchema(ConfigSchema)).toBe("object");
  });
});
