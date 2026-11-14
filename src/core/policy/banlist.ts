import type { LanguageKey } from "../../contracts";

export const DEFAULT_BANNED_IMPORTS: Record<LanguageKey, readonly string[]> = {
  javascript: [
    "fs",
    "node:fs",
    "fs/promises",
    "node:fs/promises",
    "child_process",
    "node:child_process",
    "http",
    "node:http",
    "https",
    "node:https",
    "http2",
    "node:http2",
    "net",
    "node:net",
    "tls",
    "node:tls",
    "dgram",
    "node:dgram",
    "cluster",
    "node:cluster",
    "worker_threads",
    "node:worker_threads",
    "vm",
    "node:vm",
    "inspector",
    "node:inspector",
  ],
  python: [
    "subprocess",
    "socket",
    "urllib",
    "urllib.request",
    "http.client",
    "requests",
    "httpx",
    "aiohttp",
    "pickle",
    "marshal",
    "ctypes",
    "pty",
    "webbrowser",
  ],
  java: [
    "java.lang.ProcessBuilder",
    "java.lang.Runtime",
    "java.net.Socket",
    "java.net.ServerSocket",
    "java.net.URL",
    "java.net.HttpURLConnection",
    "java.net.http.HttpClient",
    "javax.script.ScriptEngine",
    "javax.script.ScriptEngineManager",
    "org.junit.Test",
    "org.junit.Ignore",
    "org.junit.runner.RunWith",
  ],
};

export const DEFAULT_BANNED_CALLS: Record<LanguageKey, readonly string[]> = {
  javascript: ["eval", "Function", "fetch", "XMLHttpRequest", "process.chdir", "process.exit", "process.kill"],
  python: [
    "eval",
    "exec",
    "__import__",
    "importlib.import_module",
    "os.system",
    "os.popen",
    "os.chdir",
    "sys.exit",
    "shutil.rmtree",
  ],
  java: [
    "Runtime.getRuntime",
    "System.exit",
    "System.setProperty",
    "Files.delete",
    "Files.deleteIfExists",
    "Files.write",
  ],
};

export function normalizeExtraBannedImports(extra: Record<string, string[]>, language: LanguageKey): string[] {
  const keys = language === "javascript" ? ["javascript", "typescript", "js", "ts"] : [language];
  const out = new Set<string>();
  for (const k of keys) {
    for (const mod of extra[k] ?? []) {
      out.add(mod.trim());
    }
  }
  return [...out];
}
