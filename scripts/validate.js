#!/usr/bin/env node
/**
 * Validates agents, instructions, skills, hooks, L2 bindings and bundles.
 * Errors fail the build. Warnings fail only with --strict.
 */
import { readFile, readdir, access } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import path from "node:path";

import { parseFrontmatter, layout, repoRoot, HOOK_EVENTS, loadSkill, splitPatterns } from "@l2/agent-core";

const root = repoRoot();
const dirs = layout(root);
const strict = process.argv.includes("--strict");
const findings = [];
const rel = (p) => path.relative(root, p).replace(/\\/g, "/") || p;
const error = (file, message) => findings.push({ level: "error", file: rel(file), message });
const warn = (file, message) => findings.push({ level: "warn", file: rel(file), message });
const exists = (p) => access(p).then(() => true, () => false);
const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SEMVER = /^\d+\.\d+\.\d+/;
const STANDARD_AGENT_KEYS = new Set(["name", "description", "tools", "model", "target", "mcp-servers", "handoffs", "argument-hint"]);
const counts = {};
const agentNames = new Set();
const skillNames = new Set();
const hookNames = new Set();
const instructionNames = new Set();

async function list(dir, suffix) {
  if (!existsSync(dir)) return [];
  return (await readdir(dir)).filter((f) => f.endsWith(suffix)).sort().map((f) => path.join(dir, f));
}
const quotedDescription = (raw) => {
  const line = raw.split(/\r?\n/).find((l) => l.startsWith("description:"));
  return line ? /^description:\s*'/.test(line) : true;
};
async function parse(file) {
  try {
    return parseFrontmatter(await readFile(file, "utf8"), rel(file));
  } catch (e) {
    error(file, e.message);
    return null;
  }
}
async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (e) {
    error(file, `invalid JSON: ${e.message}`);
    return null;
  }
}

for (const file of await list(dirs.agents, ".md")) {
  counts.agents = (counts.agents ?? 0) + 1;
  const base = path.basename(file);
  if (!base.endsWith(".agent.md")) {
    error(file, "custom agent files must be named <name>.agent.md");
    continue;
  }
  const stem = base.replace(/\.agent\.md$/, "");
  agentNames.add(stem);
  if (!KEBAB.test(stem)) error(file, "file name must be lowercase words separated by hyphens");
  const parsed = await parse(file);
  if (!parsed) continue;
  const { data, body, raw } = parsed;
  if (!data.description) error(file, "missing `description`");
  else if (!quotedDescription(raw)) warn(file, "wrap `description` in single quotes");
  if (data.name && data.name !== stem) warn(file, `\`name\` (${data.name}) should match the file name (${stem})`);
  if (!data.tools) warn(file, "`tools` is recommended so the agent gets least privilege");
  if (data.model) warn(file, "`model` pins the chat user's model; remove it and set `runtime.model` in l2/<id>.json for automation");
  for (const key of Object.keys(data)) if (!STANDARD_AGENT_KEYS.has(key)) warn(file, `non-standard frontmatter key \`${key}\`; move L2 settings to l2/<id>.json`);
  if (!body.includes('"mode": "automation"')) warn(file, 'output contract needs an Automation branch keyed on `"mode": "automation"` and a Chat branch');
  if (/work-items/.test(body) && !(data.tools ?? []).includes("execute")) warn(file, "uses the work-items skill but has no `execute` tool to run it in chat");
}

for (const file of await list(dirs.instructions, ".md")) {
  counts.instructions = (counts.instructions ?? 0) + 1;
  if (!file.endsWith(".instructions.md")) {
    error(file, "instruction files must be named <name>.instructions.md");
    continue;
  }
  instructionNames.add(path.basename(file).replace(/\.instructions\.md$/, ""));
  const parsed = await parse(file);
  if (!parsed) continue;
  if (!parsed.data.description) error(file, "missing `description`");
  else if (!quotedDescription(parsed.raw)) warn(file, "wrap `description` in single quotes");
  if (!parsed.data.applyTo) error(file, "missing `applyTo` glob");
  else if (splitPatterns(parsed.data.applyTo).length === 0) error(file, "`applyTo` has no patterns");
}

if (existsSync(dirs.skills)) {
  for (const folder of (await readdir(dirs.skills, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name)) {
    counts.skills = (counts.skills ?? 0) + 1;
    const file = path.join(dirs.skills, folder, "SKILL.md");
    if (!(await exists(file))) {
      error(path.join(dirs.skills, folder), "skill folder has no SKILL.md");
      continue;
    }
    skillNames.add(folder);
    const parsed = await parse(file);
    if (!parsed) continue;
    const { data, body } = parsed;
    if (!data.name) error(file, "missing `name`");
    else if (data.name !== folder) error(file, `\`name\` (${data.name}) must match folder name (${folder})`);
    const description = String(data.description ?? "");
    if (description.length < 10 || description.length > 1024) error(file, "`description` must be 10-1024 characters");
    if (!/use (when|for)/i.test(description)) warn(file, "description should say when to use the skill");
    if (body.length > 8000) warn(file, "SKILL.md is long; move detail into references/");
    const skill = await loadSkill(folder, root);
    for (const ref of body.match(/`((?:references|assets|scripts)\/[^`\s]+)`/g) ?? []) {
      const target = ref.slice(1, -1);
      if (!skill.assets.includes(target)) error(file, `references missing asset ${target}`);
    }
  }
}

for (const file of await list(dirs.hooks, ".json")) {
  counts.hooks = (counts.hooks ?? 0) + 1;
  hookNames.add(path.basename(file, ".json"));
  const config = await readJson(file);
  if (!config) continue;
  if (config.version !== 1) error(file, "`version` must be 1");
  for (const [event, entries] of Object.entries(config.hooks ?? {})) {
    if (!HOOK_EVENTS.includes(event)) error(file, `unknown hook event \`${event}\``);
    for (const entry of entries ?? []) {
      if (entry.type !== "command") error(file, `${event}: \`type\` must be "command"`);
      if (!entry.bash && !entry.powershell) error(file, `${event}: needs \`bash\` and/or \`powershell\``);
      else if (!entry.bash || !entry.powershell) warn(file, `${event}: provide both \`bash\` and \`powershell\``);
      for (const command of [entry.bash, entry.powershell].filter(Boolean)) {
        for (const script of command.match(/[\w./-]+\.(?:mjs|js|sh|ps1|py)\b/g) ?? []) {
          const target = path.resolve(root, entry.cwd ?? ".", script);
          if (!(await exists(target))) error(file, `${event}: script not found ${script}`);
          else if (script.endsWith(".sh") && process.platform !== "win32" && !(statSync(target).mode & 0o111)) warn(file, `${event}: ${script} is not executable`);
        }
      }
    }
  }
}

const rootPackage = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const agentsUsed = new Map();
for (const file of await list(dirs.l2, ".json")) {
  counts.bindings = (counts.bindings ?? 0) + 1;
  const id = path.basename(file, ".json");
  const m = await readJson(file);
  if (!m) continue;
  for (const key of ["name", "version", "description", "status", "agent", "runtime"]) if (!m[key]) error(file, `missing \`${key}\``);
  if (m.name && m.name !== id) error(file, `\`name\` (${m.name}) must match the file name (${id})`);
  if (m.version && !SEMVER.test(m.version)) error(file, "`version` must be semver");
  if (m.status && !["draft", "planned", "active", "deprecated"].includes(m.status)) error(file, `unknown status ${m.status}`);
  if (!m.owner) warn(file, "`owner` is recommended for routing reviews");
  if (m.agent) {
    if (!(await exists(path.join(root, m.agent)))) error(file, `agent file not found: ${m.agent}`);
    if (agentsUsed.has(m.agent)) warn(file, `agent ${m.agent} is also bound by ${agentsUsed.get(m.agent)}`);
    agentsUsed.set(m.agent, id);
  }
  for (const skill of m.skills ?? []) if (!skillNames.has(skill)) error(file, `skill not found: ${skill}`);
  for (const hook of m.hooks ?? []) if (!hookNames.has(hook)) error(file, `hook not found: ${hook}`);
  if (m.policy && !(await exists(path.join(root, m.policy)))) error(file, `policy not found: ${m.policy}`);
  const rt = m.runtime ?? {};
  if (!["node", "python"].includes(rt.language)) error(file, "`runtime.language` must be node or python");
  const runnable = ["active", "draft"].includes(m.status);
  if (runnable && rt.entrypoint && !(await exists(path.join(root, rt.entrypoint)))) error(file, `entrypoint not found: ${rt.entrypoint}`);
  if (rt.workflow && !(await exists(path.join(root, rt.workflow)))) error(file, `workflow not found: ${rt.workflow}`);
  if (m.status === "active" && !rt.model) warn(file, "set `runtime.model` so automated runs and live evals use a fixed model");
  if (rt.package && runnable && !rootPackage.workspaces) error(file, "root package.json has no workspaces");
  if (m.evals && !(await exists(path.join(root, m.evals)))) error(file, `evals folder not found: ${m.evals}`);
  if (m.status === "active" && !m.evals) warn(file, "active agents should declare `evals` to catch prompt regressions");
}

if (existsSync(dirs.bundles)) {
  const data = await readJson(dirs.bundles);
  const file = dirs.bundles;
  if (data) {
    const mk = data.marketplace ?? {};
    if (!mk.name || !KEBAB.test(mk.name)) error(file, "`marketplace.name` must be kebab-case");
    if (!/^[^/]+\/[^/]+$/.test(mk.repository ?? "")) error(file, "`marketplace.repository` must be owner/repo");
    if (!mk.owner?.name) error(file, "`marketplace.owner.name` is required");
    const seen = new Set();
    const bundled = new Set();
    for (const b of data.bundles ?? []) {
      counts.bundles = (counts.bundles ?? 0) + 1;
      const where = `bundle ${b.name ?? "?"}`;
      if (!b.name || !KEBAB.test(b.name)) error(file, `${where}: \`name\` must be kebab-case`);
      if (seen.has(b.name)) error(file, `${where}: duplicate bundle name`);
      seen.add(b.name);
      if (!SEMVER.test(b.version ?? "")) error(file, `${where}: \`version\` must be semver`);
      if (!["draft", "published", "deprecated"].includes(b.status)) error(file, `${where}: status must be draft, published or deprecated`);
      if (["agents", "skills", "hooks", "instructions"].reduce((n, k) => n + (b[k]?.length ?? 0), 0) === 0) error(file, `${where}: bundle is empty`);
      for (const a of b.agents ?? []) {
        if (!agentNames.has(a)) error(file, `${where}: agent not found: ${a}`);
        bundled.add(a);
      }
      for (const s of b.skills ?? []) if (!skillNames.has(s)) error(file, `${where}: skill not found: ${s}`);
      for (const h of b.hooks ?? []) if (!hookNames.has(h)) error(file, `${where}: hook not found: ${h}`);
      for (const i of b.instructions ?? []) if (!instructionNames.has(i)) error(file, `${where}: instructions not found: ${i}`);
    }
    for (const a of agentNames) if (!bundled.has(a)) warn(file, `agent ${a} is not in any bundle, so users cannot install it from the marketplace`);
  }
}

const errors = findings.filter((f) => f.level === "error");
const warnings = findings.filter((f) => f.level === "warn");
console.log(`Checked ${counts.agents ?? 0} agents, ${counts.instructions ?? 0} instructions, ${counts.skills ?? 0} skills, ${counts.hooks ?? 0} hook files, ${counts.bindings ?? 0} L2 bindings, ${counts.bundles ?? 0} bundles.`);
for (const f of [...errors, ...warnings]) console.log(`  ${f.level === "error" ? "ERROR" : "warn "}  ${f.file}: ${f.message}`);
const failed = errors.length > 0 || (strict && warnings.length > 0);
console.log(failed ? `\nFAILED: ${errors.length} error(s), ${warnings.length} warning(s).` : `\nOK: 0 errors, ${warnings.length} warning(s).`);
process.exit(failed ? 1 : 0);
