import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { tokenizeCommand } from "../../config";
import type { FailureReason, JavaConfig, LanguageConfig, LanguageKey, UnitAgentConfig } from "../../contracts";
import { runCommand } from "../../exec/exec";
import { resolveJavaBuildTool } from "../../languages/toolchains";

export interface PreflightOutcome {
  ok: boolean;
  reason?: FailureReason;
  detail: string;
}

export interface RunnerProbeOutcome extends PreflightOutcome {
  fix?: string;
}

function collectAncestorDirs(wdAbs: string, workspaceRoot: string): string[] {
  const dirs: string[] = [];
  const rootNorm = path.resolve(workspaceRoot);
  let cur = path.resolve(wdAbs);
  while (true) {
    dirs.push(cur);
    if (cur === rootNorm) break;
    const parent = path.dirname(cur);
    const rel = path.relative(rootNorm, parent);
    if (parent === cur || (rel !== "" && (rel.startsWith("..") || path.isAbsolute(rel)))) break;
    cur = parent;
  }
  return dirs;
}

function stripPackageVersion(spec: string): string {
  if (spec.startsWith("@")) {
    const secondAt = spec.indexOf("@", 1);
    return secondAt > 0 ? spec.slice(0, secondAt) : spec;
  }
  const atIdx = spec.indexOf("@");
  return atIdx > 0 ? spec.slice(0, atIdx) : spec;
}

function extractNpxTarget(args: readonly string[]): { tool: string | null; pkg: string | null } {
  const valueFlags = new Set(["-p", "--package", "-c", "--call", "--userconfig", "--cache"]);
  let pkg: string | null = null;
  let afterDoubleDash = false;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!;
    if (!afterDoubleDash) {
      if (arg === "--") {
        afterDoubleDash = true;
        continue;
      }
      if (valueFlags.has(arg)) {
        const next = args[i + 1];
        if ((arg === "-p" || arg === "--package") && next) {
          pkg = stripPackageVersion(next);
        }
        i += 1;
        continue;
      }
      if (arg.startsWith("--package=")) {
        pkg = stripPackageVersion(arg.slice("--package=".length));
        continue;
      }
      if (arg.startsWith("-")) continue;
    }
    const tool = stripPackageVersion(arg);
    return { tool, pkg: pkg ?? tool };
  }
  return { tool: null, pkg };
}

function findLocalNodeTool(dirs: readonly string[], tool: string, pkgName: string | null): boolean {
  const binNames = process.platform === "win32" ? [`${tool}.cmd`, `${tool}.exe`, tool] : [tool];
  for (const dir of dirs) {
    for (const binName of binNames) {
      if (existsSync(path.join(dir, "node_modules", ".bin", binName))) {
        return true;
      }
    }
    if (pkgName && existsSync(path.join(dir, "node_modules", pkgName, "package.json"))) {
      return true;
    }
  }
  return false;
}

function hasMissingProjectNodeModules(dirs: readonly string[], pkgName: string | null): boolean {
  let hasPkgJson = false;
  let hasNodeModules = false;
  let declaresDep = false;
  for (const dir of dirs) {
    if (existsSync(path.join(dir, "node_modules"))) {
      hasNodeModules = true;
    }
    const pkgPath = path.join(dir, "package.json");
    if (!existsSync(pkgPath)) continue;
    hasPkgJson = true;
    if (pkgName) {
      try {
        const parsed = JSON.parse(readFileSync(pkgPath, "utf8")) as Record<string, Record<string, string> | undefined>;
        for (const section of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
          if (parsed[section] && Object.prototype.hasOwnProperty.call(parsed[section], pkgName)) {
            declaresDep = true;
          }
        }
      } catch {
        // Ignore malformed package.json here; config/build checks handle it elsewhere.
      }
    }
  }
  return hasPkgJson && (!hasNodeModules || declaresDep);
}

export async function probeTestRunner(params: {
  workspaceRoot: string;
  wdAbs: string;
  testCommand: string;
  config: UnitAgentConfig;
  language: LanguageKey;
}): Promise<RunnerProbeOutcome> {
  const { file, args } = tokenizeCommand(params.testCommand);
  const baseName = path
    .basename(file)
    .replace(/\.(exe|cmd|bat)$/i, "")
    .toLowerCase();

  // Check local wrapper existence if command starts with ./
  if (file.startsWith("./") || file.startsWith(".\\")) {
    const baseFile = file.replace(/\\/g, "/");
    const expectedName =
      process.platform === "win32"
        ? baseFile === "./gradlew"
          ? "gradlew.bat"
          : baseFile === "./mvnw"
            ? "mvnw.cmd"
            : null
        : null;
    const candidateAbs = path.resolve(params.wdAbs, file);
    const expectedAbs = expectedName ? path.resolve(params.wdAbs, expectedName) : candidateAbs;
    const hasWrapper =
      existsSync(expectedAbs) ||
      existsSync(candidateAbs) ||
      (process.platform === "win32" && (existsSync(`${candidateAbs}.bat`) || existsSync(`${candidateAbs}.cmd`)));
    if (!hasWrapper) {
      if (params.language === "java") {
        const javaCfg = params.config.languages.java;
        const pref = javaCfg?.toolPreference ?? [];
        if (javaCfg && javaCfg.strictWrapper === false && pref.includes("system")) {
          const sysTool = baseName.startsWith("gradle") ? "gradle" : baseName.startsWith("mvn") ? "mvn" : null;
          if (sysTool) {
            const sysProbe = await runCommand(sysTool, ["-v"], {
              cwd: params.wdAbs,
              timeoutMs: 15_000,
              config: params.config,
            });
            if (!sysProbe.spawnError && sysProbe.exitCode === 0) {
              return { ok: true, detail: `wrapper missing; system ${sysTool} available` };
            }
          }
        }
      }
      return {
        ok: false,
        reason: "wrapper_unavailable",
        detail: `Wrapper executable "${file}" not found under "${path.relative(params.workspaceRoot, params.wdAbs) || "."}".`,
        fix: `Restore wrapper "${file}" or adjust languages.${params.language}.testCommand.`,
      };
    }
    return { ok: true, detail: `wrapper present: ${file}` };
  }

  // Handle npx by verifying local installation (or direct PATH binary) without relying on ~/.npm/_npx cache
  if (baseName === "npx") {
    const { tool, pkg } = extractNpxTarget(args);
    if (tool) {
      const dirs = collectAncestorDirs(params.wdAbs, params.workspaceRoot);
      const localInstalled = findLocalNodeTool(dirs, tool, pkg);
      if (localInstalled) {
        const probe = await runCommand(file, ["--no-install", tool, "--version"], {
          cwd: params.wdAbs,
          timeoutMs: 15_000,
          config: params.config,
        });
        if (probe.spawnError || probe.exitCode !== 0) {
          return {
            ok: false,
            reason: "tool_missing",
            detail: `Local runner "${tool}" via "${file}" could not be started (${probe.spawnError ?? (probe.stderr.trim() || `exit ${probe.exitCode}`)}).`,
            fix: `Run npm install or ensure "${file}" and "${tool}" work locally.`,
          };
        }
        return { ok: true, detail: `${file} --no-install ${tool} available` };
      }

      if (hasMissingProjectNodeModules(dirs, pkg ?? tool)) {
        return {
          ok: false,
          reason: "tool_missing",
          detail: `Local dependency "${tool}" is not installed in node_modules (missing node_modules for "${params.testCommand}").`,
          fix: `Run npm install in "${params.wdAbs}" so "${tool}" is installed locally.`,
        };
      }

      const directProbe = await runCommand(tool, ["--version"], {
        cwd: params.wdAbs,
        timeoutMs: 15_000,
        config: params.config,
      });
      if (directProbe.spawnError || directProbe.exitCode !== 0) {
        return {
          ok: false,
          reason: "tool_missing",
          detail: `Executable "${tool}" not found locally or on PATH (${directProbe.spawnError ?? `exit ${directProbe.exitCode}`}).`,
          fix: `Run npm install in "${params.wdAbs}" or ensure "${tool}" is installed.`,
        };
      }
      return { ok: true, detail: `${tool} available on PATH` };
    }
  }

  // Handle python -m <module> (and --cov plugin requirement)
  if (baseName === "python" || baseName === "python3" || baseName === "py") {
    const mIdx = args.indexOf("-m");
    if (mIdx >= 0 && mIdx + 1 < args.length) {
      const preMArgs = args.slice(0, mIdx);
      const mod = args[mIdx + 1]!;
      if (!/^[A-Za-z0-9_.]+$/.test(mod)) {
        return {
          ok: false,
          reason: "environment_error",
          detail: `Invalid Python module name "${mod}" in "${params.testCommand}".`,
          fix: `Use a valid dotted module name in languages.${params.language}.testCommand.`,
        };
      }
      const modProbeArgs =
        mod === "pytest"
          ? [...preMArgs, "-m", "pytest", "--version"]
          : [...preMArgs, "-c", `import importlib.util, sys; sys.exit(0 if importlib.util.find_spec('${mod}') else 1)`];
      const modProbe = await runCommand(file, modProbeArgs, {
        cwd: params.wdAbs,
        timeoutMs: 15_000,
        config: params.config,
      });
      if (modProbe.spawnError || modProbe.exitCode !== 0) {
        return {
          ok: false,
          reason: "tool_missing",
          detail: `Python module "${mod}" via "${file}" is unavailable (${modProbe.spawnError ?? (modProbe.stderr.trim() || `exit ${modProbe.exitCode}`)}).`,
          fix: `Install "${mod}" into "${file}" or adjust languages.${params.language}.testCommand.`,
        };
      }
      if (mod === "pytest" && args.some((a) => a === "--cov" || a.startsWith("--cov="))) {
        const covProbe = await runCommand(file, [...preMArgs, "-c", "import pytest_cov"], {
          cwd: params.wdAbs,
          timeoutMs: 15_000,
          config: params.config,
        });
        if (covProbe.spawnError || covProbe.exitCode !== 0) {
          return {
            ok: false,
            reason: "tool_missing",
            detail: `Python package "pytest-cov" required by "--cov" in "${params.testCommand}" is not installed in "${file}".`,
            fix: `Install pytest-cov in "${file}" or adjust languages.${params.language}.testCommand.`,
          };
        }
      }
      return { ok: true, detail: `${file} -m ${mod} available` };
    }
  }

  // Probe executable version safely for bare commands (e.g. pytest, mvn, node, gradle)
  const versionFlag = ["mvn", "mvnw", "gradle", "gradlew"].includes(baseName) ? "-v" : "--version";
  const probe = await runCommand(file, [versionFlag], {
    cwd: params.wdAbs,
    timeoutMs: 15_000,
    config: params.config,
  });

  if (probe.spawnError || probe.exitCode !== 0) {
    return {
      ok: false,
      reason: "tool_missing",
      detail: `Executable "${file}" not found (${probe.spawnError ?? (probe.stderr.trim() || `exit ${probe.exitCode}`)}).`,
      fix: `Ensure "${file}" is installed and on PATH, or adjust languages.${params.language}.testCommand.`,
    };
  }

  if (baseName === "pytest" && args.some((a) => a === "--cov" || a.startsWith("--cov="))) {
    const helpProbe = await runCommand(file, ["--help"], {
      cwd: params.wdAbs,
      timeoutMs: 15_000,
      config: params.config,
    });
    if (helpProbe.spawnError || helpProbe.exitCode !== 0 || !helpProbe.stdout.includes("--cov")) {
      return {
        ok: false,
        reason: "tool_missing",
        detail: `pytest coverage plugin (pytest-cov / --cov) required by "${params.testCommand}" is not installed.`,
        fix: `Install pytest-cov in the "${file}" environment or adjust languages.${params.language}.testCommand.`,
      };
    }
  }

  return { ok: true, detail: `${file} available` };
}

export async function runRunnerPreflight(params: {
  workspaceRoot: string;
  language: LanguageKey;
  langConfig: LanguageConfig;
  config: UnitAgentConfig;
  phase: "static" | "run" | "all";
}): Promise<PreflightOutcome> {
  if (params.phase === "static") {
    return { ok: true, detail: "static-only phase skips external runner preflight" };
  }

  const wdAbs = path.resolve(params.workspaceRoot, params.langConfig.workingDirectory || ".");
  if (!existsSync(wdAbs)) {
    return {
      ok: false,
      reason: "environment_error",
      detail: `Language workingDirectory "${params.langConfig.workingDirectory}" does not exist.`,
    };
  }

  if (params.language === "java") {
    const bt = resolveJavaBuildTool(params.workspaceRoot, params.langConfig as JavaConfig);
    if (bt.ambiguous) {
      return { ok: false, reason: "ambiguous_build_tool", detail: bt.ambiguous };
    }
    if (!bt.buildTool) {
      return {
        ok: false,
        reason: "tool_missing",
        detail: `No pom.xml or build.gradle(.kts) found in "${params.langConfig.workingDirectory}".`,
      };
    }
  }

  const probe = await probeTestRunner({
    workspaceRoot: params.workspaceRoot,
    wdAbs,
    testCommand: params.langConfig.testCommand,
    config: params.config,
    language: params.language,
  });

  return { ok: probe.ok, reason: probe.reason, detail: probe.detail };
}
