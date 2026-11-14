import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";

import { layout } from "./paths.js";

export const HOOK_EVENTS = ["sessionStart", "sessionEnd", "userPromptSubmitted", "preToolUse", "postToolUse", "errorOccurred"];

/** Runs `.github/hooks/*.json` inside L2 runs so the same guards protect chat and automation. */
export class HookRunner {
  constructor({ root, configs = [], logger = null, platform = process.platform, context = {} } = {}) {
    Object.assign(this, { root, configs, logger, platform, context });
  }

  static async load(root, { names = null, logger = null, context = {} } = {}) {
    const dir = layout(root).hooks;
    const configs = [];
    if (existsSync(dir)) {
      for (const file of (await readdir(dir)).filter((f) => f.endsWith(".json")).sort()) {
        const name = file.replace(/\.json$/, "");
        if (names && !names.includes(name)) continue;
        configs.push({ name, ...JSON.parse(await readFile(path.join(dir, file), "utf8")) });
      }
    }
    return new HookRunner({ root, configs, logger, context });
  }

  entriesFor(event, toolName) {
    const entries = [];
    for (const config of this.configs) {
      for (const entry of config.hooks?.[event] ?? []) {
        if (entry.matcher && toolName && !new RegExp(`^(?:${entry.matcher})$`, "i").test(toolName)) continue;
        entries.push({ ...entry, source: config.name });
      }
    }
    return entries;
  }

  async run(event, payload = {}) {
    const body = { timestamp: new Date().toISOString(), cwd: this.root, source: "l2", ...this.context, ...payload };
    if (body.toolArgs && typeof body.toolArgs !== "string") body.toolArgs = JSON.stringify(body.toolArgs);
    const results = [];
    for (const entry of this.entriesFor(event, body.toolName)) {
      const result = await this.#exec(entry, body);
      results.push(result);
      if (event === "preToolUse" && result.decision === "deny") {
        this.logger?.warn?.("hook.denied", { hook: entry.source, reason: result.reason });
        return { decision: "deny", reason: result.reason, results };
      }
      if (result.error) this.logger?.warn?.("hook.error", { hook: entry.source, event, error: result.error });
    }
    return { decision: "allow", reason: null, results };
  }

  allowTool(toolName, toolArgs) {
    return this.run("preToolUse", { toolName, toolArgs });
  }

  #exec(entry, payload) {
    const windows = this.platform === "win32";
    const toolName = String(payload.toolName ?? "").toLowerCase();
    const preferPowershell = toolName.includes("powershell") || (toolName === "" && windows);
    const powershell = this.platform === "win32" ? "powershell.exe" : "pwsh";
    const bashAvailable = !spawnSync("bash", ["--version"], { stdio: "ignore" }).error;
    const shell = preferPowershell || !bashAvailable ? powershell : "bash";
    const command = shell === "bash" ? entry.bash ?? entry.powershell : entry.powershell ?? entry.bash;
    if (!command) return Promise.resolve({ source: entry.source, decision: "allow", error: "no command for platform" });
    const args = shell === "bash" ? ["-c", command] : ["-NoProfile", "-Command", command];
    return new Promise((resolve) => {
      const child = spawn(shell, args, { cwd: path.resolve(this.root, entry.cwd ?? "."), env: { ...process.env, ...(entry.env ?? {}) }, stdio: ["pipe", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      const timer = setTimeout(() => child.kill("SIGKILL"), (entry.timeoutSec ?? 30) * 1000);
      child.stdout.on("data", (d) => (stdout += d));
      child.stderr.on("data", (d) => (stderr += d));
      child.on("error", (error) => {
        clearTimeout(timer);
        resolve({ source: entry.source, decision: "allow", error: error.message });
      });
      child.on("close", (code, signal) => {
        clearTimeout(timer);
        const output = lastJson(stdout);
        if (output?.permissionDecision === "deny") return resolve({ source: entry.source, decision: "deny", reason: output.permissionDecisionReason ?? "denied by hook" });
        if (signal) return resolve({ source: entry.source, decision: "deny", reason: `hook timed out (${entry.source})` });
        if (code !== 0) return resolve({ source: entry.source, decision: "deny", reason: stderr.trim() || `hook exited ${code}`, error: `exit ${code}` });
        resolve({ source: entry.source, decision: "allow" });
      });
      child.stdin.on("error", () => {});
      child.stdin.end(JSON.stringify(payload));
    });
  }
}

function lastJson(stdout) {
  for (const line of String(stdout).trim().split(/\r?\n/).reverse()) {
    try {
      return JSON.parse(line);
    } catch {
      // keep looking
    }
  }
  return null;
}
