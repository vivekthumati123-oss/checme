import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import picomatch from "picomatch";

import { loadConfig, resolveTestPathForSource, runConfigCheck } from "../config";
import {
  LocalDoctorSummarySchema,
  ToolVersionsSchema,
  type LanguageKey,
  type LocalDoctorSummary,
  type ToolVersions,
  type UnitAgentConfig,
} from "../contracts";
import { detectFrameworkForLanguage } from "../core/context";
import { parseCoverageFile } from "../core/coverage";
import { parseSourceFile } from "../core/parse";
import { cleanRepoRelative, normalizeSlashes } from "../core/paths";
import { runCommand } from "../exec/exec";
import { buildLanguageToolVersions, resolveJavaBuildTool, resolveToolchainForLanguage } from "../languages/toolchains";
import { runBaseline } from "../stages/baseline";
import { probeTestRunner, runRunnerPreflight } from "../stages/validate/preflight";
import { runSingleFileTests } from "../stages/validate/runners";
import { prepareValidationWorkspace } from "../stages/validate/workspace";
import { sanitizeFailureOutput } from "../telemetry";
import { cleanupLeftoverPlacedFiles } from "./placement";

export const UNIT_AGENT_CLI_VERSION = "2.0.0";

export interface RunLocalDoctorOptions {
  repoRoot: string;
  workDir: string;
  configPath?: string;
  full?: boolean;
  light?: boolean;
  nodeVersionOverride?: string;
  wasmDir?: string;
}

function collectFilesMatching(repoRoot: string, workingDirectory: string, globs: readonly string[]): string[] {
  const wdAbs = path.resolve(repoRoot, workingDirectory || ".");
  if (!existsSync(wdAbs)) return [];
  const matcher = picomatch(
    globs.map((g) => cleanRepoRelative(normalizeSlashes(g))),
    { dot: true, nocase: process.platform === "win32" },
  );
  const found: string[] = [];
  const walk = (cur: string, depth: number): void => {
    if (depth > 8 || found.length >= 25) return;
    let entries;
    try {
      entries = readdirSync(cur, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (
        ent.name === ".git" ||
        ent.name === "node_modules" ||
        ent.name === ".unit-agent" ||
        ent.name === "target" ||
        ent.name === "build" ||
        ent.name === ".venv" ||
        ent.name === "venv"
      ) {
        continue;
      }
      const full = path.join(cur, ent.name);
      if (ent.isDirectory()) {
        walk(full, depth + 1);
      } else if (ent.isFile()) {
        const rel = cleanRepoRelative(normalizeSlashes(path.relative(wdAbs, full)));
        if (matcher(rel)) {
          found.push(cleanRepoRelative(normalizeSlashes(path.relative(repoRoot, full))));
        }
      }
    }
  };
  walk(wdAbs, 0);
  return found;
}

function findExistingSampleTestFile(repoRoot: string, language: LanguageKey): string | null {
  const patterns: Record<LanguageKey, string[]> = {
    javascript: [
      "**/*.test.{ts,tsx,js,jsx,mjs}",
      "**/*.spec.{ts,tsx,js,jsx,mjs}",
      "test/**/*.{ts,js}",
      "tests/**/*.{ts,js}",
    ],
    python: ["**/test_*.py", "**/*_test.py"],
    java: ["**/*Test.java"],
  };
  const matcher = picomatch(patterns[language], { dot: false, nocase: process.platform === "win32" });
  const stack: Array<{ dir: string; depth: number }> = [{ dir: repoRoot, depth: 0 }];
  while (stack.length > 0) {
    const { dir, depth } = stack.pop()!;
    if (depth > 6) continue;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      if (ent.name === ".git" || ent.name === "node_modules" || ent.name === ".unit-agent") continue;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        stack.push({ dir: full, depth: depth + 1 });
      } else if (ent.isFile()) {
        const rel = cleanRepoRelative(normalizeSlashes(path.relative(repoRoot, full)));
        if (matcher(rel)) return rel;
      }
    }
  }
  return null;
}

function parseNodeMajor(ver: string): number {
  const clean = ver.replace(/^v/i, "").trim();
  const major = Number.parseInt(clean.split(".")[0] ?? "0", 10);
  return Number.isFinite(major) ? major : 0;
}

export async function runLocalDoctor(opts: RunLocalDoctorOptions): Promise<LocalDoctorSummary> {
  cleanupLeftoverPlacedFiles(opts.workDir, opts.repoRoot);

  const checks: LocalDoctorSummary["checks"] = [];
  let loadedConfig: UnitAgentConfig | null = null;
  let toolVersions: ToolVersions | null = null;

  // Check 2 first in memory so Check 1 can inspect local.nodeCommand & local.baseRef too
  const cfgCheck = runConfigCheck(opts.repoRoot, opts.configPath);
  if (cfgCheck.ok) {
    loadedConfig = loadConfig(opts.repoRoot, opts.configPath).config;
  }

  // Check 1: Node >= 20, git, baseRef
  const agentNodeVersion = opts.nodeVersionOverride ?? process.versions.node;
  const agentMajor = parseNodeMajor(agentNodeVersion);
  const repoNodeRes = await runCommand("node", ["-v"], { cwd: opts.repoRoot, timeoutMs: 10_000 });
  const repoNodeVersion = repoNodeRes.exitCode === 0 ? repoNodeRes.stdout.trim() : "unknown";
  const gitRes = await runCommand("git", ["rev-parse", "--is-inside-work-tree"], { cwd: opts.repoRoot });
  const inGitRepo = gitRes.exitCode === 0 && gitRes.stdout.trim() === "true";

  const baseCandidate = loadedConfig?.local.baseRef ?? "main";
  let baseResolvable = false;
  if (inGitRepo) {
    const rev = await runCommand("git", ["rev-parse", "--verify", baseCandidate], { cwd: opts.repoRoot });
    if (rev.exitCode === 0) {
      baseResolvable = true;
    } else {
      const headRev = await runCommand("git", ["rev-parse", "--verify", "HEAD"], { cwd: opts.repoRoot });
      baseResolvable = headRev.exitCode === 0;
    }
  }

  if (agentMajor < 20) {
    checks.push({
      name: "runtime-and-git",
      status: "fail",
      detail: `Agent runs on Node ${agentNodeVersion} (< 20 required); repo tests run on Node ${repoNodeVersion}.`,
      fix: "Install Node 20 or newer, or set local.nodeCommand in .unit-agent.yml to a Node >= 20 path.",
    });
  } else if (!inGitRepo) {
    checks.push({
      name: "runtime-and-git",
      status: "fail",
      detail: `Agent runs on Node ${agentNodeVersion}; repo tests will run on Node ${repoNodeVersion}; repository is not a git work tree.`,
      fix: "Run inside a valid git repository checkout.",
    });
  } else if (!baseResolvable) {
    checks.push({
      name: "runtime-and-git",
      status: "warn",
      detail: `Agent runs on Node ${agentNodeVersion}; repo tests will run on Node ${repoNodeVersion}; baseRef "${baseCandidate}" could not be resolved.`,
      fix: `Set local.baseRef in .unit-agent.yml or create at least one commit / fetch base branch.`,
    });
  } else {
    checks.push({
      name: "runtime-and-git",
      status: "pass",
      detail: `Agent runs on Node ${agentNodeVersion}; repo tests will run on Node ${repoNodeVersion}; git & baseRef OK.`,
    });
  }

  // Check 2: Configuration validation
  if (!cfgCheck.ok) {
    checks.push({
      name: "config",
      status: "fail",
      detail: cfgCheck.errors.join("; "),
      fix: "Fix invalid keys or types in .unit-agent.yml and run `config check`.",
    });
  } else {
    checks.push({
      name: "config",
      status: "pass",
      detail: `Loaded ${cleanRepoRelative(normalizeSlashes(path.relative(opts.repoRoot, cfgCheck.configPath)))} (${cfgCheck.summary?.enabledLanguages.join(", ") ?? ""}).`,
    });
  }

  // Check 3: CLI bundle & Tree-sitter WASM grammars
  const binCliPath = path.join(opts.workDir, "bin", "cli.js");
  const hasLocalBin = existsSync(binCliPath);
  const enabledLangs: LanguageKey[] = loadedConfig
    ? (["javascript", "python", "java"] as LanguageKey[]).filter((l) => loadedConfig?.languages[l]?.enabled)
    : ["javascript"];

  let wasmOk = true;
  let wasmDetail = "";
  const samples: Record<LanguageKey, { file: string; code: string }> = {
    javascript: { file: "probe.ts", code: "export function ok(x: number): number { return x + 1; }\n" },
    python: { file: "probe.py", code: "def ok(x: int) -> int:\n    return x + 1\n" },
    java: { file: "Ok.java", code: "public class Ok { public int x() { return 1; } }\n" },
  };
  for (const lang of enabledLangs) {
    try {
      const res = await parseSourceFile({
        filePath: samples[lang].file,
        content: samples[lang].code,
        language: lang,
        minExecutableLines: 1,
        wasmDir: opts.wasmDir,
      });
      if (res.tooBroken || res.eligibleSymbols.length === 0) {
        wasmOk = false;
        wasmDetail = `Tree-sitter failed to extract sample symbol for ${lang}.`;
        break;
      }
    } catch (err) {
      wasmOk = false;
      wasmDetail = err instanceof Error ? err.message : String(err);
      break;
    }
  }

  if (!wasmOk) {
    checks.push({
      name: "bundle-and-wasm",
      status: "fail",
      detail: `Grammar load error: ${wasmDetail}`,
      fix: "Re-run `npm run build` or `unit-agent local init-chat` to restore wasm grammars.",
    });
  } else if (!hasLocalBin && !opts.light) {
    checks.push({
      name: "bundle-and-wasm",
      status: "warn",
      detail: "Tree-sitter grammars loaded; .unit-agent/bin/cli.js is not installed in this repo.",
      fix: "Run `unit-agent local init-chat` to install the repo-local CLI bundle.",
    });
  } else {
    checks.push({
      name: "bundle-and-wasm",
      status: "pass",
      detail: `Tree-sitter grammars verified for ${enabledLangs.join(", ")}.`,
    });
  }

  // Check 4 & toolVersions: Per enabled language toolchains, workingDirectory, sourceGlobs, testPathPatterns
  if (loadedConfig) {
    const langToolMap: ToolVersions["languages"] = {};
    const toolWarnings: string[] = [];

    for (const lang of enabledLangs) {
      const langCfg = loadedConfig.languages[lang]!;
      const wdAbs = path.resolve(opts.repoRoot, langCfg.workingDirectory || ".");
      const tc = resolveToolchainForLanguage({ repoRoot: opts.repoRoot, language: lang, langConfig: langCfg });
      if (tc.warning) {
        toolWarnings.push(`${lang}: ${tc.warning}`);
      }
      const tv = buildLanguageToolVersions({ repoRoot: opts.repoRoot, config: loadedConfig, language: lang });
      langToolMap[lang] = tv;
      if (tv.framework && !tv.framework.supported) {
        toolWarnings.push(`${lang}: Unsupported test framework "${tv.framework.name}".`);
      }

      if (!existsSync(wdAbs)) {
        checks.push({
          name: `toolchain:${lang}`,
          status: "fail",
          detail: `workingDirectory "${langCfg.workingDirectory}" does not exist.`,
          fix: `Update languages.${lang}.workingDirectory in .unit-agent.yml.`,
        });
        continue;
      }

      if (lang === "java") {
        const bt = resolveJavaBuildTool(opts.repoRoot, loadedConfig.languages.java!);
        if (bt.ambiguous) {
          checks.push({
            name: `toolchain:${lang}`,
            status: "fail",
            detail: bt.ambiguous,
            fix: "Set languages.java.buildTool to maven or gradle.",
          });
          continue;
        }
      }

      const probe = await probeTestRunner({
        workspaceRoot: opts.repoRoot,
        wdAbs,
        testCommand: langCfg.testCommand,
        config: loadedConfig,
        language: lang,
      });

      if (!probe.ok) {
        checks.push({
          name: `toolchain:${lang}`,
          status: "fail",
          detail: probe.detail,
          fix: probe.fix ?? `Ensure test runner for "${lang}" is installed, or adjust languages.${lang}.testCommand.`,
        });
        continue;
      }

      const matchedSources = collectFilesMatching(opts.repoRoot, langCfg.workingDirectory, langCfg.sourceGlobs);
      if (matchedSources.length === 0) {
        checks.push({
          name: `toolchain:${lang}`,
          status: "fail",
          detail: `sourceGlobs [${langCfg.sourceGlobs.join(", ")}] matched 0 files under "${langCfg.workingDirectory}".`,
          fix: `Adjust languages.${lang}.sourceGlobs in .unit-agent.yml.`,
        });
        continue;
      }

      try {
        resolveTestPathForSource({
          repoRoot: opts.repoRoot,
          language: lang,
          sourcePath: matchedSources[0]!,
          testPathPatterns: langCfg.testPathPatterns,
          generatedSuffix: langCfg.generatedSuffix,
        });
      } catch (err) {
        checks.push({
          name: `toolchain:${lang}`,
          status: "fail",
          detail: `testPathPatterns failed on "${matchedSources[0]}": ${err instanceof Error ? err.message : String(err)}`,
          fix: `Fix languages.${lang}.testPathPatterns in .unit-agent.yml.`,
        });
        continue;
      }

      checks.push({
        name: `toolchain:${lang}`,
        status: "pass",
        detail: `${probe.detail}; ${matchedSources.length} source sample(s) matched.`,
      });
    }

    toolVersions = ToolVersionsSchema.parse({
      agentNode: agentNodeVersion,
      languages: langToolMap,
      warnings: toolWarnings,
    });

    // Check 5: Preflight Gate 0
    for (const lang of enabledLangs) {
      const langCfg = loadedConfig.languages[lang]!;
      const pre = await runRunnerPreflight({
        workspaceRoot: opts.repoRoot,
        language: lang,
        langConfig: langCfg,
        config: loadedConfig,
        phase: "run",
      });
      if (!pre.ok) {
        checks.push({
          name: `preflight:${lang}`,
          status: "fail",
          detail: pre.detail,
          fix: "Verify dependencies are installed and testCommand runs locally.",
        });
        continue;
      }

      if (opts.full) {
        const sampleTest = findExistingSampleTestFile(opts.repoRoot, lang);
        if (sampleTest) {
          const fw = detectFrameworkForLanguage({ language: lang, langConfig: langCfg, repoRoot: opts.repoRoot });
          const ws = prepareValidationWorkspace(opts.repoRoot, loadedConfig, "local");
          try {
            const runRes = await runSingleFileTests(fw.framework, {
              workspaceRoot: ws.root,
              repoRoot: opts.repoRoot,
              languageConfig: langCfg,
              config: loadedConfig,
              sourcePath: sampleTest,
              testPath: sampleTest,
              withCoverage: false,
              offline: false,
            });
            if (runRes.exitCode !== 0 && runRes.failureReason === "environment_error") {
              checks.push({
                name: `preflight:${lang}`,
                status: "fail",
                detail: sanitizeFailureOutput(`${runRes.stdout}\n${runRes.stderr}`, { repoRoot: ws.root }, 400),
                fix: "Fix local test runner environment before running local validate.",
              });
              continue;
            }
          } finally {
            ws.cleanup();
          }
        }
      }

      checks.push({
        name: `preflight:${lang}`,
        status: "pass",
        detail: `${lang} preflight passed.`,
      });
    }

    // Check 6: Coverage check
    if (opts.full) {
      const baselineRes = await runBaseline({
        repoRoot: opts.repoRoot,
        workDir: opts.workDir,
        config: loadedConfig,
        writeOutputs: false,
      });
      if (baselineRes.status === "red") {
        checks.push({
          name: "coverage",
          status: "fail",
          detail: `Baseline test suite failed during --full check.`,
          fix: "Fix failing baseline tests or pass --skip-baseline to local detect.",
        });
      } else if (baselineRes.status === "no_coverage") {
        checks.push({
          name: "coverage",
          status: "fail",
          detail: `Baseline ran without producing expected coverage files.`,
          fix: "Configure your testCommand to emit coverage at languages.<lang>.coverageFile.",
        });
      } else {
        checks.push({
          name: "coverage",
          status: "pass",
          detail: `Baseline coverage files generated and parsed cleanly.`,
        });
      }
    } else {
      let allCovPresent = true;
      for (const lang of enabledLangs) {
        const langCfg = loadedConfig.languages[lang]!;
        const cov = parseCoverageFile({
          filePath: langCfg.coverageFile,
          format: langCfg.coverageFormat,
          repoRoot: opts.repoRoot,
          workingDirectory: langCfg.workingDirectory,
          knownSourceFiles: [],
        });
        if (!cov) {
          allCovPresent = false;
        }
      }
      checks.push(
        allCovPresent
          ? { name: "coverage", status: "pass", detail: "Existing coverage files found and parsed." }
          : {
              name: "coverage",
              status: "warn",
              detail: "No reusable baseline coverage file found on disk yet.",
              fix: "Run `unit-agent local doctor --full` or `unit-agent local detect` to generate coverage.",
            },
      );
    }
  }

  // Check 7: Chat agent and prompt files freshness
  const agentFile = path.join(opts.repoRoot, ".github", "agents", "unit-agent.agent.md");
  const promptFiles = [
    path.join(opts.repoRoot, ".github", "prompts", "unit-tests.prompt.md"),
    path.join(opts.repoRoot, ".github", "prompts", "unit-doctor.prompt.md"),
    path.join(opts.repoRoot, ".github", "prompts", "unit-repair.prompt.md"),
  ];
  const allChatExist = existsSync(agentFile) && promptFiles.every((p) => existsSync(p));
  if (!allChatExist) {
    checks.push({
      name: "chat-files",
      status: "warn",
      detail: "One or more chat agent/prompt files are missing.",
      fix: "Run `unit-agent local init-chat`.",
    });
  } else {
    const agentText = readFileSync(agentFile, "utf8");
    const markerMatch = /<!--\s*generated by unit-agent init-chat\s+([^\s;]+)/.exec(agentText);
    if (!markerMatch || markerMatch[1] !== UNIT_AGENT_CLI_VERSION) {
      checks.push({
        name: "chat-files",
        status: "warn",
        detail: markerMatch
          ? `Chat agent file version "${markerMatch[1]}" differs from CLI "${UNIT_AGENT_CLI_VERSION}".`
          : "Chat agent file lacks current init-chat version marker.",
        fix: "Run `unit-agent local init-chat` to update chat templates.",
      });
    } else {
      checks.push({
        name: "chat-files",
        status: "pass",
        detail: `Chat agent and prompt files match v${UNIT_AGENT_CLI_VERSION}.`,
      });
    }
  }

  const ok = checks.every((c) => c.status !== "fail");
  return LocalDoctorSummarySchema.parse({
    schemaVersion: 1,
    ok,
    toolVersions,
    checks,
  });
}
