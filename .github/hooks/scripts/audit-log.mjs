#!/usr/bin/env node
/**
 * Appends one JSON line per lifecycle event. Tool arguments are summarised, never stored.
 * Log path: $L2_AUDIT_LOG; if installed as a plugin (L2_AUDIT_SCOPE=user) ~/.copilot/l2-audit/audit.jsonl;
 * otherwise .l2/audit.jsonl in the repository (git-ignored).
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
let payload = {};
try {
  payload = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
} catch {
  payload = {};
}
let args = payload.toolArgs;
if (typeof args === "string") {
  try {
    args = JSON.parse(args);
  } catch {
    args = {};
  }
}
const entry = {
  timestamp: payload.timestamp ?? new Date().toISOString(),
  event: process.env.HOOK_EVENT ?? "unknown",
  source: payload.source ?? "copilot",
  agentId: payload.agentId ?? null,
  requestId: payload.requestId ?? null,
  model: payload.model ?? null,
  toolName: payload.toolName ?? null,
  path: args?.path ?? args?.filePath ?? null,
  contentLength: typeof args?.content === "string" ? args.content.length : null,
  result: payload.toolResult?.resultType ?? payload.reason ?? null,
  error: payload.error?.message ?? null,
};
const file = process.env.L2_AUDIT_LOG
  ?? (process.env.L2_AUDIT_SCOPE === "user" ? join(homedir(), ".copilot", "l2-audit", "audit.jsonl") : ".l2/audit.jsonl");
try {
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify(entry)}\n`);
} catch {
  // Auditing must never break the session.
}
process.exit(0);
