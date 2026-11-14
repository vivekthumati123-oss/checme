import { accessSync, constants, existsSync } from "node:fs";
import path from "node:path";
import { execa } from "execa";

import { resolveWrapperCommand } from "../config/argv";
import type { UnitAgentConfig } from "../contracts";
import { EXPLICIT_FORBIDDEN_ENV_KEYS, SECRET_ENV_KEY_RE } from "../telemetry/sanitize";

const BASE_ALLOWLIST = [
  "PATH",
  "Path",
  "PATHEXT",
  "SystemRoot",
  "windir",
  "ComSpec",
  "TEMP",
  "TMP",
  "TMPDIR",
  "HOME",
  "USERPROFILE",
  "HOMEDRIVE",
  "HOMEPATH",
  "APPDATA",
  "LOCALAPPDATA",
  "LANG",
  "LC_ALL",
  "JAVA_HOME",
  "GRADLE_USER_HOME",
] as const;

const PROXY_ALLOWLIST = [
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "no_proxy",
  "NODE_EXTRA_CA_CERTS",
  "SSL_CERT_FILE",
  "REQUESTS_CA_BUNDLE",
  "GRADLE_OPTS",
  "MAVEN_OPTS",
] as const;

const PROXY_KEY_SET = new Set<string>(PROXY_ALLOWLIST);

export function buildChildEnv(
  cfg?: Pick<UnitAgentConfig, "env">,
  extraPass: Record<string, string | undefined> = {},
  parentEnv: Record<string, string | undefined> = process.env,
): Record<string, string> {
  const result: Record<string, string> = {};

  for (const key of BASE_ALLOWLIST) {
    const val = parentEnv[key];
    if (typeof val === "string") {
      result[key] = val;
    }
  }

  // Ensure Windows PATHEXT / SystemRoot are available if case varies in parentEnv
  if (process.platform === "win32") {
    for (const [k, v] of Object.entries(parentEnv)) {
      if (typeof v !== "string") continue;
      const upper = k.toUpperCase();
      if (
        upper === "PATH" ||
        upper === "PATHEXT" ||
        upper === "SYSTEMROOT" ||
        upper === "COMSPEC" ||
        upper === "WINDIR"
      ) {
        result[k] = v;
      }
    }
  }

  if (cfg?.env.passProxy !== false) {
    for (const key of PROXY_ALLOWLIST) {
      const val = parentEnv[key];
      if (typeof val === "string") {
        result[key] = val;
      }
    }
  }

  for (const key of cfg?.env.pass ?? []) {
    const val = parentEnv[key];
    if (typeof val === "string") {
      result[key] = val;
    }
  }

  for (const [key, val] of Object.entries(extraPass)) {
    if (typeof val === "string") {
      result[key] = val;
    }
  }

  // Fixed safe defaults required by runners
  result.CI = "true";
  result.PYTHONDONTWRITEBYTECODE = "1";

  // Always delete secret-named env variables (even if listed in env.pass), except explicit proxy vars.
  for (const key of Object.keys(result)) {
    if (EXPLICIT_FORBIDDEN_ENV_KEYS.has(key)) {
      delete result[key];
      continue;
    }
    if (PROXY_KEY_SET.has(key)) {
      continue;
    }
    if (SECRET_ENV_KEY_RE.test(key)) {
      delete result[key];
    }
  }

  return result;
}

export async function killProcessTree(pid: number | undefined): Promise<void> {
  if (!pid || pid <= 0) return;
  if (process.platform === "win32") {
    await execa("taskkill", ["/pid", String(pid), "/T", "/F"], {
      shell: false,
      reject: false,
      windowsHide: true,
    });
    return;
  }
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Process already exited.
    }
  }
}

export interface ExecOptions {
  cwd: string;
  config?: Pick<UnitAgentConfig, "env" | "offline">;
  extraEnv?: Record<string, string | undefined>;
  parentEnv?: Record<string, string | undefined>;
  timeoutMs?: number;
  useOfflineWrapper?: boolean;
  offlineScriptPath?: string;
}

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  all: string;
  timedOut: boolean;
  spawnError?: string;
  notes: string[];
  commandString: string;
}

function hasExecutablePermission(fullPath: string): boolean {
  if (process.platform === "win32") return true;
  try {
    accessSync(fullPath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export async function runCommand(
  rawFile: string,
  rawArgs: readonly string[],
  options: ExecOptions,
): Promise<ExecResult> {
  const notes: string[] = [];
  const timeoutMs = options.timeoutMs ?? 180_000;
  const env = buildChildEnv(options.config, options.extraEnv, options.parentEnv);

  // Wrapper resolution for gradlew / mvnw relative to cwd.
  const maybeWrapperPath = path.resolve(options.cwd, rawFile);
  const execBit = existsSync(maybeWrapperPath) ? hasExecutablePermission(maybeWrapperPath) : true;
  const resolved = resolveWrapperCommand(rawFile, process.platform, execBit);

  let file = resolved.executable;
  let args = [...rawArgs];
  if (resolved.note) {
    notes.push(resolved.note);
  }

  if (resolved.isWrapper) {
    const absWrapper = path.resolve(options.cwd, file);
    if (!existsSync(absWrapper)) {
      return {
        exitCode: 127,
        stdout: "",
        stderr: `Wrapper script not found: ${absWrapper}`,
        all: `Wrapper script not found: ${absWrapper}`,
        timedOut: false,
        spawnError: `ENOENT: ${absWrapper}`,
        notes,
        commandString: `${file} ${args.join(" ")}`.trim(),
      };
    }
    if (resolved.viaShell) {
      args = [file, ...args];
      file = "sh";
    } else {
      file = absWrapper;
    }
  }

  // Optional unshare offline wrapper (Linux only, falls back visibly when unavailable or failing self-test).
  if (options.useOfflineWrapper && options.config?.offline.strategy === "unshare") {
    const script = options.offlineScriptPath ?? path.resolve(process.cwd(), "scripts/run-offline.sh");
    let unshareReady = false;
    if (process.platform === "linux" && existsSync(script)) {
      const probe = await execa("bash", [script, "true"], {
        cwd: options.cwd,
        env,
        extendEnv: false,
        shell: false,
        reject: false,
        windowsHide: true,
        timeout: 5_000,
      });
      unshareReady = probe.exitCode === 0;
    }
    if (unshareReady) {
      args = [script, file, ...args];
      file = "bash";
    } else {
      notes.push("offline.strategy 'unshare' unavailable on this host; fell back to strategy 'none'");
    }
  }

  const commandString = [file, ...args].join(" ");
  const child = execa(file, args, {
    cwd: options.cwd,
    env,
    extendEnv: false,
    shell: false,
    reject: false,
    windowsHide: true,
    timeout: timeoutMs,
    maxBuffer: 1_000_000,
    all: true,
    detached: process.platform !== "win32",
  });

  const pid = child.pid;
  const res = await child;

  if (res.timedOut) {
    await killProcessTree(pid);
  }

  const stdout = typeof res.stdout === "string" ? res.stdout : "";
  const stderr = typeof res.stderr === "string" ? res.stderr : "";
  const all = typeof res.all === "string" && res.all.length > 0 ? res.all : `${stdout}${stderr}`;
  const isMissingWinCmd =
    process.platform === "win32" &&
    res.exitCode === 1 &&
    (/is not recognized as an internal or external command/i.test(all) ||
      (!stdout.trim() && !stderr.trim() && !existsSync(path.resolve(options.cwd, file))));
  const spawnError =
    res.failed && (res.exitCode === undefined || isMissingWinCmd) ? (res.shortMessage ?? res.message) : undefined;

  return {
    exitCode: typeof res.exitCode === "number" ? res.exitCode : res.timedOut ? 124 : 1,
    stdout,
    stderr,
    all,
    timedOut: Boolean(res.timedOut),
    spawnError,
    notes,
    commandString,
  };
}
