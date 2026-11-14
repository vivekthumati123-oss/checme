#!/usr/bin/env node
/**
 * preToolUse guard shared by interactive Copilot sessions, installed plugins and L2 agent runs.
 * Input: hook payload JSON on stdin ({ toolName, toolArgs, cwd }); toolArgs may be a JSON string.
 * Output: nothing to allow; to deny, one JSON line: { "permissionDecision": "deny", "permissionDecisionReason": "..." }
 */
import { pathToFileURL } from "node:url";

const SHELL_TOOLS = new Set(["bash", "shell", "execute", "powershell", "run_in_terminal"]);
const WRITE_TOOLS = new Set(["edit", "create", "write", "str_replace", "apply_patch", "write_file"]);

const DANGEROUS_COMMANDS = [
  [/\brm\s+-[a-z]*r[a-z]*f[a-z]*\s+(\/|~|\*|\.\s*$)/i, "recursive force delete of a root, home or wildcard path"],
  [/\bgit\s+push\b.*(--force\b|-f\b)/i, "force push"],
  [/\bgit\s+reset\s+--hard\b/i, "hard reset"],
  [/\bgit\s+clean\s+-[a-z]*f/i, "git clean with force"],
  [/(curl|wget)[^|]*\|\s*(ba|z)?sh\b/i, "piping a download into a shell"],
  [/\bchmod\s+(-R\s+)?777\b/i, "world-writable permissions"],
  [/\b(mkfs|dd\s+if=)/i, "disk-level write"],
  [/Remove-Item\b.*-Recurse\b.*-Force\b/i, "recursive force delete"],
  [/\b(cat|type|Get-Content|more|less|head|tail)\b[^|;&]*\.env(\.local)?\b/i, "reading a credentials file"],
  [/\b(printenv|env)\b\s*$|\becho\s+\$\{?\w*(TOKEN|PAT|SECRET|KEY)\w*\}?/i, "printing secrets from the environment"],
];

const PROTECTED_PATHS = [
  [/^\.github\/workflows\//, "pipeline definitions"],
  [/^\.github\/hooks\//, "hook definitions"],
  [/^infrastructure\//, "infrastructure"],
  [/(^|\/)\.env(\.|$)/, "environment files"],
  [/\.(pem|key|pfx|p12)$/i, "key material"],
  [/(^|\/)id_(rsa|ed25519)/, "SSH keys"],
];

const SECRET_PATTERNS = [
  [/\bgh[pousr]_[A-Za-z0-9]{36,}\b/, "GitHub token"],
  [/\bgithub_pat_[A-Za-z0-9_]{60,}\b/, "GitHub fine-grained token"],
  [/\bAKIA[0-9A-Z]{16}\b/, "AWS access key"],
  [/-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/, "private key"],
  [/AccountKey=[A-Za-z0-9+/=]{40,}/, "Azure storage key"],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}/, "Slack token"],
  [/\bATATT3[A-Za-z0-9_\-=]{20,}/, "Atlassian API token"],
];

function parseArgs(raw) {
  if (raw == null) return {};
  if (typeof raw === "object") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return { command: String(raw) };
  }
}

function normalisePath(value, cwd) {
  let p = String(value ?? "").replace(/\\/g, "/");
  const root = String(cwd ?? "").replace(/\\/g, "/").replace(/\/$/, "");
  if (root && p.startsWith(`${root}/`)) p = p.slice(root.length + 1);
  return p.replace(/^\.\//, "");
}

const deny = (reason) => ({ permissionDecision: "deny", permissionDecisionReason: reason });

export function evaluate(payload) {
  const tool = String(payload.toolName ?? "").toLowerCase();
  const args = parseArgs(payload.toolArgs);
  if (SHELL_TOOLS.has(tool)) {
    const command = String(args.command ?? args.cmd ?? args.script ?? "");
    for (const [pattern, label] of DANGEROUS_COMMANDS) if (pattern.test(command)) return deny(`Blocked ${label}: ${command.slice(0, 120)}`);
  }
  if (WRITE_TOOLS.has(tool)) {
    const p = normalisePath(args.path ?? args.filePath ?? args.file ?? "", payload.cwd);
    if (p.split("/").includes("..")) return deny(`Blocked path traversal: ${p}`);
    for (const [pattern, label] of PROTECTED_PATHS) if (pattern.test(p)) return deny(`Blocked write to ${label}: ${p}`);
    const content = String(args.content ?? args.file_text ?? args.newContent ?? args.new_str ?? "");
    for (const [pattern, label] of SECRET_PATTERNS) if (pattern.test(content)) return deny(`Blocked write containing a ${label} in ${p}`);
  }
  return null;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let raw = "";
  if (!process.stdin.isTTY) for await (const chunk of process.stdin) raw += chunk;
  let payload = {};
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    process.exit(0);
  }
  const decision = evaluate(payload);
  if (decision && process.env.GUARD_MODE !== "warn") process.stdout.write(`${JSON.stringify(decision)}\n`);
  else if (decision) process.stderr.write(`[guard:warn] ${decision.permissionDecisionReason}\n`);
  process.exit(0);
}
