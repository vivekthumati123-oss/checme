import { spawn, type ChildProcessByStdio } from "node:child_process";
import { accessSync, constants, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import type { Readable, Writable } from "node:stream";
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
const PROXY_KEY_UPPER = new Set<string>(PROXY_ALLOWLIST.map((k) => k.toUpperCase()));
const EXPLICIT_FORBIDDEN_UPPER = new Set<string>([...EXPLICIT_FORBIDDEN_ENV_KEYS].map((k) => k.toUpperCase()));
const URL_PROXY_KEYS_UPPER = new Set<string>(["HTTP_PROXY", "HTTPS_PROXY"]);

function stripProxyCredentials(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.username || parsed.password) {
      parsed.username = "";
      parsed.password = "";
      return parsed.toString();
    }
  } catch {
    // Non-URL proxy strings left unchanged unless matching user:pass@
    return rawUrl.replace(/((?:https?|socks5h?|ftp):\/\/)[^/@\s]+@/gi, "$1");
  }
  return rawUrl;
}

function setEnvCaseAware(target: Record<string, string>, key: string, value: string): void {
  if (process.platform === "win32") {
    const upper = key.toUpperCase();
    for (const existingKey of Object.keys(target)) {
      if (existingKey !== key && existingKey.toUpperCase() === upper) {
        delete target[existingKey];
      }
    }
  }
  target[key] = value;
}

export function buildChildEnv(
  cfg?: Pick<UnitAgentConfig, "env">,
  extraPass: Record<string, string | undefined> = {},
  parentEnv: Record<string, string | undefined> = process.env,
): Record<string, string> {
  const result: Record<string, string> = {};

  for (const key of BASE_ALLOWLIST) {
    const val = parentEnv[key];
    if (typeof val === "string") {
      setEnvCaseAware(result, key, val);
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
        setEnvCaseAware(result, k, v);
      }
    }
  }

  if (cfg?.env.passProxy !== false) {
    for (const key of PROXY_ALLOWLIST) {
      const val = parentEnv[key];
      if (typeof val === "string") {
        setEnvCaseAware(result, key, URL_PROXY_KEYS_UPPER.has(key.toUpperCase()) ? stripProxyCredentials(val) : val);
      }
    }
  }

  for (const key of cfg?.env.pass ?? []) {
    const val = parentEnv[key];
    if (typeof val === "string") {
      setEnvCaseAware(result, key, val);
    }
  }

  for (const [key, val] of Object.entries(extraPass)) {
    if (typeof val === "string") {
      setEnvCaseAware(result, key, val);
    }
  }

  // Fixed safe defaults required by runners
  result.CI = "true";
  result.PYTHONDONTWRITEBYTECODE = "1";

  // Always delete secret-named env variables (even if listed in env.pass), except explicit proxy vars.
  for (const key of Object.keys(result)) {
    const upper = key.toUpperCase();
    if (EXPLICIT_FORBIDDEN_UPPER.has(upper)) {
      delete result[key];
      continue;
    }
    if (PROXY_KEY_SET.has(key) || PROXY_KEY_UPPER.has(upper)) {
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
  killChildrenOnExit?: boolean;
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

function killDetachedByExecId(treeId: string): void {
  if (process.platform === "win32" || !existsSync("/proc")) return;
  const marker = `UA_EXEC_ID=${treeId}`;
  let entries: string[];
  try {
    entries = readdirSync("/proc");
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue;
    const candidatePid = Number(entry);
    if (candidatePid <= 1 || candidatePid === process.pid) continue;
    try {
      const vars = readFileSync(`/proc/${entry}/environ`, "utf8").split("\0");
      if (vars.includes(marker)) {
        try {
          process.kill(candidatePid, "SIGKILL");
        } catch {
          // Process exited or permission denied.
        }
      }
    } catch {
      // Process exited or /proc entry unreadable.
    }
  }
}

function isRegularFile(filePath: string): boolean {
  try {
    return existsSync(filePath) && statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function resolveWindowsExecutable(file: string, cwd: string, env: Record<string, string>): string | null {
  const pathExtRaw = env.PATHEXT ?? env.Pathext ?? env.pathext ?? ".COM;.EXE;.BAT;.CMD";
  const exts = pathExtRaw
    .split(";")
    .map((e) => e.trim())
    .filter(Boolean);
  const lower = file.toLowerCase();
  const hasKnownExt = exts.some((e) => lower.endsWith(e.toLowerCase()));
  const probeExts = hasKnownExt ? ["", ...exts] : [...exts, ""];

  const probeInDir = (basePath: string): string | null => {
    for (const ext of probeExts) {
      const candidate = ext && !basePath.toLowerCase().endsWith(ext.toLowerCase()) ? `${basePath}${ext}` : basePath;
      if (isRegularFile(candidate)) return candidate;
    }
    return null;
  };

  if (file.includes("/") || file.includes("\\") || /^[A-Za-z]:/.test(file)) {
    return probeInDir(path.resolve(cwd, file));
  }

  const rawPath = env.PATH ?? env.Path ?? env.path ?? "";
  const searchDirs = rawPath
    .split(path.delimiter)
    .map((dir) => dir.trim().replace(/^"+|"+$/g, ""))
    .filter(Boolean);
  for (const dir of searchDirs) {
    const found = probeInDir(path.join(dir, file));
    if (found) return found;
  }
  return null;
}

function resolvePosixExecutable(file: string, cwd: string, env: Record<string, string>): string | null {
  if (file.includes("/")) {
    const candidate = path.resolve(cwd, file);
    return isRegularFile(candidate) && hasExecutablePermission(candidate) ? candidate : null;
  }
  const rawPath = env.PATH ?? "";
  for (const dir of rawPath.split(path.delimiter).filter(Boolean)) {
    const candidate = path.join(dir, file);
    if (isRegularFile(candidate) && hasExecutablePermission(candidate)) return candidate;
  }
  return null;
}

function validateWin32BatchArg(arg: string): void {
  if (/[\r\n\0"%!]/.test(arg)) {
    throw new Error("Unsafe control or batch metacharacter in Windows .cmd/.bat argument.");
  }
}

function quoteWin32BatchArg(arg: string): string {
  validateWin32BatchArg(arg);
  if (arg.length === 0) return '""';
  return /[\s\t&|<>()^;=]/.test(arg) ? `"${arg}"` : arg;
}

function quoteWin32Arg(arg: string, quoteTrigger: RegExp = /[\s\t\n\v"]/): string {
  if (arg.length > 0 && !quoteTrigger.test(arg)) return arg;
  let out = '"';
  let backslashes = 0;
  for (let i = 0; i < arg.length; i += 1) {
    const ch = arg[i]!;
    if (ch === "\\") {
      backslashes += 1;
    } else if (ch === '"') {
      out += `${"\\".repeat(backslashes * 2 + 1)}"`;
      backslashes = 0;
    } else {
      out += `${"\\".repeat(backslashes)}${ch}`;
      backslashes = 0;
    }
  }
  out += `${"\\".repeat(backslashes * 2)}"`;
  return out;
}

function buildWinEnvBlock(envObj: Record<string, string>): Buffer {
  const entries = Object.entries(envObj)
    .filter(([k, v]) => typeof v === "string" && !k.includes("=") && !k.includes("\0") && !v.includes("\0"))
    .sort(([a], [b]) => {
      const ua = a.toUpperCase();
      const ub = b.toUpperCase();
      return ua < ub ? -1 : ua > ub ? 1 : 0;
    })
    .map(([k, v]) => `${k}=${v}`);
  return Buffer.from(`${entries.join("\0")}\0\0`, "utf16le");
}

interface Refable {
  ref?: () => void;
  unref?: () => void;
}

interface StreamWithHandle {
  _handle?: Refable;
}

interface WinBrokerEntry {
  onBrokerMsg: (tag: string, val: number) => void;
}

type WinBrokerChild = ChildProcessByStdio<Writable, Readable, Readable> & Refable;

let winBroker: WinBrokerChild | null = null;
let winBrokerSeq = 0;
let winExitHookRegistered = false;
const winBrokerPending = new Map<string, WinBrokerEntry>();

function setWinBrokerRef(ref: boolean): void {
  if (!winBroker) return;
  const invoke = (obj: Refable | undefined) => {
    if (!obj) return;
    if (ref) obj.ref?.();
    else obj.unref?.();
  };
  invoke(winBroker);
  invoke((winBroker.stdin as unknown as StreamWithHandle | undefined)?._handle);
  invoke((winBroker.stdout as unknown as StreamWithHandle | undefined)?._handle);
  if (!ref) {
    invoke((winBroker.stderr as unknown as StreamWithHandle | undefined)?._handle);
  }
}

function buildWinBrokerScript(): string {
  return [
    "$ProgressPreference = 'SilentlyContinue'",
    "$asm = [AppDomain]::CurrentDomain.DefineDynamicAssembly((New-Object System.Reflection.AssemblyName('UaJobBroker')), 1)",
    "$tb = $asm.DefineDynamicModule('M').DefineType('K', 385)",
    "$cc = [System.Runtime.InteropServices.CallingConvention]::Winapi",
    "$cs = [System.Runtime.InteropServices.CharSet]::Unicode",
    "$ma = [System.Reflection.MethodAttributes]'Public, Static'",
    "$mc = [System.Reflection.CallingConventions]::Standard",
    "function F($n, $r, $p) { $tb.DefinePInvokeMethod($n, 'kernel32.dll', $ma, $mc, $r, $p, $cc, $cs).SetImplementationFlags(128) }",
    "F 'CreateJobObjectW' ([IntPtr]) @([IntPtr], [IntPtr])",
    "F 'SetInformationJobObject' ([bool]) @([IntPtr], [int], [IntPtr], [uint32])",
    "F 'AssignProcessToJobObject' ([bool]) @([IntPtr], [IntPtr])",
    "F 'CreateProcessW' ([bool]) @([IntPtr], [IntPtr], [IntPtr], [IntPtr], [bool], [uint32], [IntPtr], [IntPtr], [IntPtr], [IntPtr])",
    "F 'CreateFileW' ([IntPtr]) @([string], [uint32], [uint32], [IntPtr], [uint32], [uint32], [IntPtr])",
    "F 'ResumeThread' ([uint32]) @([IntPtr])",
    "F 'WaitForSingleObject' ([uint32]) @([IntPtr], [uint32])",
    "F 'GetExitCodeProcess' ([bool]) @([IntPtr], [uint32].MakeByRefType())",
    "F 'TerminateJobObject' ([bool]) @([IntPtr], [uint32])",
    "F 'CloseHandle' ([bool]) @([IntPtr])",
    "F 'GetLastError' ([uint32]) @()",
    "$k = $tb.CreateType()",
    "$M = [System.Runtime.InteropServices.Marshal]",
    "$E = [System.Text.Encoding]::UTF8",
    "$pool = [RunspaceFactory]::CreateRunspacePool(1, 16)",
    "$pool.Open()",
    "$jobs = New-Object 'System.Collections.Concurrent.ConcurrentDictionary[string, object]'",
    "$outSync = New-Object object",
    "$pendingTasks = New-Object 'System.Collections.Generic.List[object]'",
    "function WriteOut([string]$line) {",
    "  [System.Threading.Monitor]::Enter($outSync)",
    "  try { [Console]::Out.WriteLine($line); [Console]::Out.Flush() }",
    "  finally { [System.Threading.Monitor]::Exit($outSync) }",
    "}",
    "while ($null -ne ($line = [Console]::In.ReadLine())) {",
    "  for ($i = $pendingTasks.Count - 1; $i -ge 0; $i--) {",
    "    if ($pendingTasks[$i].h.IsCompleted) {",
    "      try { [void]$pendingTasks[$i].ps.EndInvoke($pendingTasks[$i].h) } catch {}",
    "      $pendingTasks[$i].ps.Dispose()",
    "      $pendingTasks.RemoveAt($i)",
    "    }",
    "  }",
    "  if ($line -eq '') { continue }",
    "  $parts = $line.Split('|')",
    "  $op = $parts[0]",
    "  if ($op -eq 'KILL') {",
    "    $id = $parts[1]",
    "    $entry = $null",
    "    if ($jobs.TryRemove($id, [ref]$entry)) {",
    "      [void]$k::TerminateJobObject($entry.hJob, 1)",
    "      [void]$k::CloseHandle($entry.hJob)",
    "    }",
    "    continue",
    "  }",
    "  if ($op -ne 'RUN') { continue }",
    "  $id = $parts[1]",
    "  $sa = [IntPtr]::Zero",
    "  try {",
    "    $app = $E.GetString([Convert]::FromBase64String($parts[2]))",
    "    $cmd = $E.GetString([Convert]::FromBase64String($parts[3]))",
    "    $cwd = $E.GetString([Convert]::FromBase64String($parts[4]))",
    "    $envBytes = [Convert]::FromBase64String($parts[5])",
    "    $outPipe = $E.GetString([Convert]::FromBase64String($parts[6]))",
    "    $errPipe = $E.GetString([Convert]::FromBase64String($parts[7]))",
    "    $is64 = [IntPtr]::Size -eq 8",
    "    $saSz = if ($is64) { 24 } else { 12 }",
    "    $sa = $M::AllocHGlobal($saSz)",
    "    for ($i = 0; $i -lt $saSz; $i += 4) { $M::WriteInt32($sa, $i, 0) }",
    "    $M::WriteInt32($sa, 0, $saSz)",
    "    $M::WriteInt32($sa, $(if ($is64) { 16 } else { 8 }), 1)",
    "    $hIn = $k::CreateFileW('\\\\.\\NUL', [uint32]2147483648, 3, $sa, 3, 0, [IntPtr]::Zero)",
    "    $hOut = $k::CreateFileW($outPipe, [uint32]1073741824, 0, $sa, 3, 0, [IntPtr]::Zero)",
    "    $hErr = $k::CreateFileW($errPipe, [uint32]1073741824, 0, $sa, 3, 0, [IntPtr]::Zero)",
    "    $M::FreeHGlobal($sa); $sa = [IntPtr]::Zero",
    "    $inv = [IntPtr](-1)",
    "    if ($hOut -eq $inv -or $hErr -eq $inv) {",
    "      $err = $k::GetLastError()",
    "      if ($hIn -ne $inv) { [void]$k::CloseHandle($hIn) }",
    "      if ($hOut -ne $inv) { [void]$k::CloseHandle($hOut) }",
    "      if ($hErr -ne $inv) { [void]$k::CloseHandle($hErr) }",
    '      WriteOut "FAIL|$id|$err"',
    "      continue",
    "    }",
    "    $hJob = $k::CreateJobObjectW([IntPtr]::Zero, [IntPtr]::Zero)",
    "    $jSz = if ($is64) { 144 } else { 112 }",
    "    $jBuf = $M::AllocHGlobal($jSz)",
    "    for ($i = 0; $i -lt $jSz; $i += 4) { $M::WriteInt32($jBuf, $i, 0) }",
    "    $M::WriteInt32($jBuf, 16, 0x2000)",
    "    $okJob = $k::SetInformationJobObject($hJob, 9, $jBuf, [uint32]$jSz)",
    "    $M::FreeHGlobal($jBuf)",
    "    if ($hJob -eq [IntPtr]::Zero -or -not $okJob) {",
    "      $err = $k::GetLastError()",
    "      if ($hIn -ne $inv) { [void]$k::CloseHandle($hIn) }",
    "      [void]$k::CloseHandle($hOut); [void]$k::CloseHandle($hErr)",
    "      if ($hJob -ne [IntPtr]::Zero) { [void]$k::CloseHandle($hJob) }",
    '      WriteOut "FAIL|$id|$err"',
    "      continue",
    "    }",
    "    $appPtr = $M::StringToHGlobalUni($app)",
    "    $cmdPtr = $M::StringToHGlobalUni($cmd)",
    "    $cwdPtr = $M::StringToHGlobalUni($cwd)",
    "    $envPtr = $M::AllocHGlobal($envBytes.Length)",
    "    $M::Copy($envBytes, 0, $envPtr, $envBytes.Length)",
    "    $siSz = if ($is64) { 104 } else { 68 }",
    "    $si = $M::AllocHGlobal($siSz)",
    "    for ($i = 0; $i -lt $siSz; $i += 4) { $M::WriteInt32($si, $i, 0) }",
    "    $M::WriteInt32($si, 0, $siSz)",
    "    $M::WriteInt32($si, $(if ($is64) { 60 } else { 44 }), 0x100)",
    "    $M::WriteIntPtr($si, $(if ($is64) { 80 } else { 56 }), $hIn)",
    "    $M::WriteIntPtr($si, $(if ($is64) { 88 } else { 60 }), $hOut)",
    "    $M::WriteIntPtr($si, $(if ($is64) { 96 } else { 64 }), $hErr)",
    "    $pi = $M::AllocHGlobal(24)",
    "    $okProc = $k::CreateProcessW($appPtr, $cmdPtr, [IntPtr]::Zero, [IntPtr]::Zero, $true, 0x08000404, $envPtr, $cwdPtr, $si, $pi)",
    "    $errProc = $k::GetLastError()",
    "    $M::FreeHGlobal($appPtr); $M::FreeHGlobal($cmdPtr); $M::FreeHGlobal($cwdPtr); $M::FreeHGlobal($envPtr); $M::FreeHGlobal($si)",
    "    if ($hIn -ne $inv) { [void]$k::CloseHandle($hIn) }",
    "    [void]$k::CloseHandle($hOut); [void]$k::CloseHandle($hErr)",
    "    if (-not $okProc) {",
    "      $M::FreeHGlobal($pi); [void]$k::CloseHandle($hJob)",
    '      WriteOut "FAIL|$id|$errProc"',
    "      continue",
    "    }",
    "    $hProc = $M::ReadIntPtr($pi, 0); $hThread = $M::ReadIntPtr($pi, [IntPtr]::Size); $M::FreeHGlobal($pi)",
    "    if (-not $k::AssignProcessToJobObject($hJob, $hProc)) {",
    "      $errAssign = $k::GetLastError()",
    "      [void]$k::CloseHandle($hThread); [void]$k::CloseHandle($hProc); [void]$k::TerminateJobObject($hJob, 1); [void]$k::CloseHandle($hJob)",
    '      WriteOut "FAIL|$id|$errAssign"',
    "      continue",
    "    }",
    "    [void]$jobs.TryAdd($id, @{ hJob = $hJob })",
    "    [void]$k::ResumeThread($hThread); [void]$k::CloseHandle($hThread)",
    "    $ps = [PowerShell]::Create()",
    "    $ps.RunspacePool = $pool",
    "    [void]$ps.AddScript({",
    "      param($k, $jobs, $outSync, $id, $hJob, $hProc)",
    "      [void]$k::WaitForSingleObject($hProc, [uint32]::MaxValue)",
    "      [uint32]$ec = 0; [void]$k::GetExitCodeProcess($hProc, [ref]$ec)",
    "      [void]$k::CloseHandle($hProc)",
    "      $removed = $null",
    "      if ($jobs.TryRemove($id, [ref]$removed)) {",
    "        [void]$k::TerminateJobObject($hJob, 1)",
    "        [void]$k::CloseHandle($hJob)",
    "      }",
    "      $signedEc = [BitConverter]::ToInt32([BitConverter]::GetBytes($ec), 0)",
    "      [System.Threading.Monitor]::Enter($outSync)",
    '      try { [Console]::Out.WriteLine("DONE|$id|$signedEc"); [Console]::Out.Flush() }',
    "      finally { [System.Threading.Monitor]::Exit($outSync) }",
    "    }).AddArgument($k).AddArgument($jobs).AddArgument($outSync).AddArgument($id).AddArgument($hJob).AddArgument($hProc)",
    "    $handle = $ps.BeginInvoke()",
    "    $pendingTasks.Add(@{ ps = $ps; h = $handle })",
    "  } catch {",
    "    if ($sa -ne [IntPtr]::Zero) { $M::FreeHGlobal($sa) }",
    '    WriteOut "FAIL|$id|1"',
    "  }",
    "}",
    "foreach ($entry in $jobs.Values) {",
    "  try { [void]$k::TerminateJobObject($entry.hJob, 1); [void]$k::CloseHandle($entry.hJob) } catch {}",
    "}",
    "$pool.Close()",
    "$pool.Dispose()",
    "[Environment]::Exit(0)",
  ].join("\n");
}

function ensureWinBroker(): WinBrokerChild {
  if (winBroker && !winBroker.killed && winBroker.exitCode === null) {
    return winBroker;
  }
  const sysRoot = process.env.SystemRoot || process.env.SYSTEMROOT || "C:\\Windows";
  const psDefault = path.join(sysRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const psExe = existsSync(psDefault) ? psDefault : "powershell.exe";
  const bootstrap =
    "[ScriptBlock]::Create([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([Console]::In.ReadLine()))).Invoke()";

  const child = spawn(psExe, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", bootstrap], {
    stdio: ["pipe", "pipe", "pipe"],
    env: buildChildEnv(undefined, {}, process.env),
    windowsHide: true,
  }) as WinBrokerChild;

  child.stdin.write(`${Buffer.from(buildWinBrokerScript(), "utf8").toString("base64")}\n`);

  let lineBuf = "";
  child.stdout.on("data", (chunk: Buffer) => {
    lineBuf += chunk.toString("utf8");
    let nl = lineBuf.indexOf("\n");
    while (nl !== -1) {
      const line = lineBuf.slice(0, nl).replace(/\r$/, "");
      lineBuf = lineBuf.slice(nl + 1);
      const [tag, id, val] = line.split("|");
      if (id) {
        const entry = winBrokerPending.get(id);
        if (entry) {
          entry.onBrokerMsg(tag ?? "FAIL", Number(val ?? "1"));
        }
      }
      nl = lineBuf.indexOf("\n");
    }
  });

  // Drain stderr silently so broker pipe never fills.
  child.stderr.on("data", () => {});

  const failPending = () => {
    if (winBroker === child) {
      winBroker = null;
    }
    for (const [, entry] of [...winBrokerPending.entries()]) {
      entry.onBrokerMsg("FAIL", 125);
    }
  };
  child.once("exit", failPending);
  child.once("error", failPending);

  if (!winExitHookRegistered) {
    winExitHookRegistered = true;
    process.once("exit", () => {
      if (winBroker) {
        try {
          winBroker.stdin.end();
        } catch {
          // Ignore pipe errors during process teardown.
        }
        try {
          winBroker.kill();
        } catch {
          // Ignore already-exited broker.
        }
        winBroker = null;
      }
    });
  }

  winBroker = child;
  setWinBrokerRef(false);
  return child;
}

function createWinPipeCollector(
  pipeName: string,
  onChunk: (buf: Buffer) => void,
): Promise<{ closed: Promise<string>; abort: () => void }> {
  return new Promise((resolveListen, rejectListen) => {
    let closedResolve!: (value: string) => void;
    let settled = false;
    const closed = new Promise<string>((resolve) => {
      closedResolve = resolve;
    });
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    const maxBytes = 1_000_000;
    let connected = false;

    const finish = (srv: net.Server) => {
      if (settled) return;
      settled = true;
      srv.close(() => {
        closedResolve(Buffer.concat(chunks).toString("utf8"));
      });
    };

    const srv = net.createServer((sock) => {
      connected = true;
      sock.on("data", (buf: Buffer) => {
        if (totalBytes < maxBytes) {
          const remaining = maxBytes - totalBytes;
          const slice = buf.length > remaining ? buf.subarray(0, remaining) : buf;
          chunks.push(slice);
          totalBytes += slice.length;
          onChunk(slice);
        }
      });
      sock.once("close", () => finish(srv));
      sock.on("error", () => finish(srv));
    });
    srv.maxConnections = 1;
    srv.on("error", rejectListen);
    srv.listen(pipeName, () => {
      resolveListen({
        closed,
        abort: () => {
          if (!connected) {
            finish(srv);
          }
        },
      });
    });
  });
}

/**
 * Run a Windows command inside a Job Object with JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
 * (and without JOB_OBJECT_LIMIT_BREAKAWAY_OK), completely in-memory with zero temp files.
 */
async function runInWindowsJob(
  resolvedExe: string,
  args: readonly string[],
  cwd: string,
  env: Record<string, string>,
  timeoutMs: number,
): Promise<{
  exitCode: number | undefined;
  stdout: string;
  stderr: string;
  all: string;
  timedOut: boolean;
  failed: boolean;
  shortMessage?: string;
  message?: string;
  spawnErrorOverride?: string;
}> {
  const isBatch = /\.(cmd|bat)$/i.test(resolvedExe);
  const sysRoot = env.SystemRoot || env.SYSTEMROOT || process.env.SystemRoot || "C:\\Windows";
  const appName = isBatch ? env.ComSpec || env.COMSPEC || path.join(sysRoot, "System32", "cmd.exe") : resolvedExe;
  let cmdLine: string;
  if (isBatch) {
    validateWin32BatchArg(resolvedExe);
    const exeToken = /[\s\t&|<>()^;=]/.test(resolvedExe) ? `"${resolvedExe}"` : resolvedExe;
    const inner = `${exeToken}${args.length > 0 ? ` ${args.map(quoteWin32BatchArg).join(" ")}` : ""}`;
    cmdLine = `${quoteWin32Arg(appName)} /d /v:off /s /c "${inner}"`;
  } else {
    cmdLine = [quoteWin32Arg(resolvedExe), ...args.map((a) => quoteWin32Arg(a))].join(" ");
  }

  const broker = ensureWinBroker();
  const id = String((winBrokerSeq += 1));
  const outPipe = `\\\\.\\pipe\\ua-job-${process.pid}-${id}-out`;
  const errPipe = `\\\\.\\pipe\\ua-job-${process.pid}-${id}-err`;
  const allChunks: Buffer[] = [];
  const outCol = await createWinPipeCollector(outPipe, (chunk) => allChunks.push(chunk));
  const errCol = await createWinPipeCollector(errPipe, (chunk) => allChunks.push(chunk));

  let timedOut = false;
  let brokerErrCode: number | undefined;
  const doneCode = new Promise<number | undefined>((resolve) => {
    const timer =
      timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            try {
              broker.stdin.write(`KILL|${id}\n`);
            } catch {
              // Broker already exited.
            }
          }, timeoutMs)
        : null;

    winBrokerPending.set(id, {
      onBrokerMsg: (tag, val) => {
        if (timer) clearTimeout(timer);
        winBrokerPending.delete(id);
        if (winBrokerPending.size === 0) {
          setWinBrokerRef(false);
        }
        if (tag === "FAIL") {
          brokerErrCode = val;
          outCol.abort();
          errCol.abort();
          resolve(undefined);
        } else {
          resolve(val);
        }
      },
    });
    setWinBrokerRef(true);
  });

  const payload = [
    "RUN",
    id,
    Buffer.from(appName, "utf8").toString("base64"),
    Buffer.from(cmdLine, "utf8").toString("base64"),
    Buffer.from(path.resolve(cwd), "utf8").toString("base64"),
    buildWinEnvBlock(env).toString("base64"),
    Buffer.from(outPipe, "utf8").toString("base64"),
    Buffer.from(errPipe, "utf8").toString("base64"),
  ].join("|");

  try {
    broker.stdin.write(`${payload}\n`);
  } catch {
    const pendingEntry = winBrokerPending.get(id);
    if (pendingEntry) {
      pendingEntry.onBrokerMsg("FAIL", 125);
    }
  }

  const [exitCode, stdout, stderr] = await Promise.all([doneCode, outCol.closed, errCol.closed]);
  const all = Buffer.concat(allChunks).toString("utf8");
  const failed = timedOut || exitCode === undefined || exitCode !== 0;
  const spawnErrorOverride =
    brokerErrCode !== undefined ? `Win32 Job launch failed (error ${brokerErrCode})` : undefined;

  return {
    exitCode: timedOut ? undefined : exitCode,
    stdout,
    stderr,
    all,
    timedOut,
    failed,
    shortMessage: spawnErrorOverride,
    message: spawnErrorOverride,
    spawnErrorOverride,
  };
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
  let res: {
    exitCode?: number;
    stdout: unknown;
    stderr: unknown;
    all?: unknown;
    timedOut: boolean;
    failed: boolean;
    shortMessage?: string;
    message?: string;
    spawnErrorOverride?: string;
  };
  const resolvedExe =
    process.platform === "win32"
      ? resolveWindowsExecutable(file, options.cwd, env)
      : resolvePosixExecutable(file, options.cwd, env);

  if (process.platform === "win32" && options.killChildrenOnExit) {
    if (!existsSync(options.cwd)) {
      return {
        exitCode: 1,
        stdout: "",
        stderr: "",
        all: "",
        timedOut: false,
        spawnError: `ENOENT: cwd ${options.cwd} does not exist`,
        notes,
        commandString,
      };
    }
    if (!resolvedExe) {
      return {
        exitCode: 1,
        stdout: "",
        stderr: "",
        all: "",
        timedOut: false,
        spawnError: `spawn ${file} ENOENT`,
        notes,
        commandString,
      };
    }
    res = await runInWindowsJob(resolvedExe, args, options.cwd, env, timeoutMs);
  } else if (process.platform === "win32" && resolvedExe && /\.(cmd|bat)$/i.test(resolvedExe)) {
    validateWin32BatchArg(resolvedExe);
    const sysRoot = env.SystemRoot || env.SYSTEMROOT || process.env.SystemRoot || "C:\\Windows";
    const comspec = env.ComSpec || env.COMSPEC || path.join(sysRoot, "System32", "cmd.exe");
    const exeToken = /[\s\t&|<>()^;=]/.test(resolvedExe) ? `"${resolvedExe}"` : resolvedExe;
    const inner = `${exeToken}${args.length > 0 ? ` ${args.map(quoteWin32BatchArg).join(" ")}` : ""}`;
    res = await execa(comspec, ["/d", "/v:off", "/s", "/c", `"${inner}"`], {
      cwd: options.cwd,
      env,
      extendEnv: false,
      shell: false,
      reject: false,
      windowsHide: true,
      windowsVerbatimArguments: true,
      timeout: timeoutMs,
      maxBuffer: 1_000_000,
      all: true,
    });
  } else {
    const treeId =
      options.killChildrenOnExit && process.platform !== "win32"
        ? `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`
        : undefined;
    const childEnv = treeId ? { ...env, UA_EXEC_ID: treeId } : env;
    const child = execa(file, args, {
      cwd: options.cwd,
      env: childEnv,
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
    let forcedTimeout = false;
    const forceTimer =
      process.platform !== "win32" && timeoutMs > 0
        ? setTimeout(() => {
            forcedTimeout = true;
            void killProcessTree(pid);
            if (treeId) killDetachedByExecId(treeId);
          }, timeoutMs + 250)
        : null;
    if (process.platform !== "win32" && options.killChildrenOnExit) {
      child.once("exit", () => {
        void killProcessTree(pid);
        if (treeId) killDetachedByExecId(treeId);
      });
    }
    let awaited: Awaited<typeof child> | undefined;
    try {
      awaited = await child;
    } finally {
      if (forceTimer) clearTimeout(forceTimer);
      if (awaited?.timedOut || forcedTimeout || options.killChildrenOnExit) {
        await killProcessTree(pid);
        if (treeId) {
          killDetachedByExecId(treeId);
        }
      }
    }
    res = awaited && forcedTimeout && !awaited.timedOut ? { ...awaited, timedOut: true } : awaited;
  }

  const stdout = typeof res.stdout === "string" ? res.stdout : "";
  const stderr = typeof res.stderr === "string" ? res.stderr : "";
  const all = typeof res.all === "string" && res.all.length > 0 ? res.all : `${stdout}${stderr}`;
  const isMissingWinCmd =
    process.platform === "win32" &&
    res.exitCode === 1 &&
    (/is not recognized as an internal or external command/i.test(all) ||
      (!stdout.trim() && !stderr.trim() && !resolvedExe));
  const spawnError =
    res.spawnErrorOverride ??
    (res.failed && (res.exitCode === undefined || isMissingWinCmd) ? (res.shortMessage ?? res.message) : undefined);

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
