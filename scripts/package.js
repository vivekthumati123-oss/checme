#!/usr/bin/env node
/**
 * Builds the distributable artefacts (awesome-copilot layout):
 *   dist/marketplace/.github/plugin/marketplace.json + plugins/<bundle>/...
 *   dist/org-workflow-templates/workflow-templates/l2-<agent>.yml (+ .properties.json)
 *   dist/package-report.json (sha256 per file)
 * Usage: npm run package [-- --ref v1.3.0] [--include-drafts] [--out dist]
 */
import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { layout, repoRoot, loadBundles, listBindings, readBindingManifest, loadAgentFile, parseFrontmatter, toRemoteWorkflow } from "@l2/agent-core";

const args = process.argv.slice(2);
const opt = (name, fallback = null) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : fallback);
const root = repoRoot();
const dirs = layout(root);
const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const ref = opt("ref", `v${pkg.version}`);
const outRoot = path.resolve(root, opt("out", "dist"));
const includeDrafts = args.includes("--include-drafts");

const { marketplace, platform, bundles } = await loadBundles(root);
if (!marketplace) {
  console.error("package: bundles.json is missing or has no `marketplace` block");
  process.exit(1);
}
const marketDir = path.join(outRoot, "marketplace");
const templatesDir = path.join(outRoot, "org-workflow-templates", "workflow-templates");
await rm(outRoot, { recursive: true, force: true });
await mkdir(marketDir, { recursive: true });

const selected = bundles.filter((b) => b.status === "published" || (includeDrafts && b.status === "draft"));
const skipped = bundles.filter((b) => !selected.includes(b)).map((b) => `${b.name} (${b.status})`);
const report = { generatedFrom: pkg.name, version: pkg.version, ref, marketplace: marketplace.name, plugins: [], workflowTemplates: [], skipped };
const entries = [];

for (const bundle of selected) {
  const pluginDir = path.join(marketDir, "plugins", bundle.name);
  const manifest = {
    name: bundle.name, displayName: bundle.displayName ?? bundle.name, description: bundle.description, version: bundle.version,
    author: { name: marketplace.owner.name, ...(marketplace.owner.email ? { email: marketplace.owner.email } : {}) },
    repository: `https://github.com/${marketplace.repository}`, keywords: bundle.keywords ?? [],
  };
  const agents = [];
  for (const name of bundle.agents ?? []) {
    const source = path.join(dirs.agents, `${name}.agent.md`);
    await copyFile(source, path.join(pluginDir, "agents", `${name}.agent.md`));
    agents.push(await loadAgentFile(source));
  }
  if (agents.length) manifest.agents = agents.map((a) => `./agents/${path.basename(a.filePath)}`);
  const skills = [];
  for (const name of bundle.skills ?? []) {
    await cp(path.join(dirs.skills, name), path.join(pluginDir, "skills", name), { recursive: true });
    const { data } = parseFrontmatter(await readFile(path.join(dirs.skills, name, "SKILL.md"), "utf8"));
    skills.push({ name, description: data.description ?? "" });
  }
  if (skills.length) manifest.skills = skills.map((s) => `./skills/${s.name}/`);
  const hookEvents = await packageHooks(bundle.hooks ?? [], pluginDir);
  if (hookEvents.length) manifest.hooks = "./hooks/hooks.json";
  const instructions = [];
  for (const name of bundle.instructions ?? []) {
    const source = path.join(dirs.instructions, `${name}.instructions.md`);
    await copyFile(source, path.join(pluginDir, "instructions", `${name}.instructions.md`));
    const { data } = parseFrontmatter(await readFile(source, "utf8"));
    instructions.push({ name, applyTo: data.applyTo, description: data.description ?? "" });
  }
  await writeJson(path.join(pluginDir, ".github", "plugin", "plugin.json"), manifest);
  await writeFile(path.join(pluginDir, "README.md"), pluginReadme(bundle, agents, skills, hookEvents, instructions));
  entries.push({ name: bundle.name, source: `plugins/${bundle.name}`, description: bundle.description, version: bundle.version, ...(bundle.keywords?.length ? { keywords: bundle.keywords } : {}) });
  report.plugins.push({ name: bundle.name, version: bundle.version, status: bundle.status, files: await fileHashes(pluginDir) });
}

await writeJson(path.join(marketDir, ".github", "plugin", "marketplace.json"), { name: marketplace.name, owner: marketplace.owner, metadata: { description: marketplace.description, version: pkg.version }, plugins: entries });
await writeFile(path.join(marketDir, "README.md"), marketplaceReadme(selected));

if (platform?.repository) {
  for (const id of await listBindings(root)) {
    const { manifest: m } = await readBindingManifest(id, root);
    if (m.status !== "active" || !m.runtime?.workflow) continue;
    const yaml = toRemoteWorkflow(await readFile(path.join(root, m.runtime.workflow), "utf8"), platform.repository, ref);
    if (!yaml) continue;
    await mkdir(templatesDir, { recursive: true });
    const header = `# Generated from ${platform.repository}/${m.runtime.workflow}@${ref} by npm run package.\n# Prerequisites: secret COPILOT_GITHUB_TOKEN; L2_PLATFORM_TOKEN if ${platform.repository} is not readable by this repo's GITHUB_TOKEN.\n# Work items: variables WORK_ITEM_PROVIDER, ADO_ORG_URL, ADO_PROJECT, JIRA_BASE_URL; secrets ADO_PAT, JIRA_EMAIL, JIRA_API_TOKEN or JIRA_PAT.\n`;
    await writeFile(path.join(templatesDir, `l2-${id}.yml`), header + yaml);
    await writeJson(path.join(templatesDir, `l2-${id}.properties.json`), { name: `L2 ${m.displayName ?? id}`, description: `${m.description} Runs from ${platform.repository}@${ref}.`, iconName: "octicon copilot", categories: ["Automation"] });
    report.workflowTemplates.push(`l2-${id}.yml`);
  }
}
await writeJson(path.join(outRoot, "package-report.json"), report);
console.log(`Packaged marketplace "${marketplace.name}" @ ${ref} -> ${path.relative(root, marketDir)}`);
for (const p of report.plugins) console.log(`  plugin    ${p.name.padEnd(16)} v${p.version}  ${p.files.length} files`);
for (const t of report.workflowTemplates) console.log(`  template  ${t}`);
for (const s of skipped) console.log(`  skipped   ${s}  (use --include-drafts)`);

async function packageHooks(names, pluginDir) {
  const merged = { version: 1, hooks: {} };
  const scripts = new Set();
  for (const name of names) {
    const config = JSON.parse(await readFile(path.join(dirs.hooks, `${name}.json`), "utf8"));
    for (const [event, list] of Object.entries(config.hooks ?? {})) {
      for (const entry of list) {
        const rewritten = { ...entry, env: { ...(entry.env ?? {}), L2_AUDIT_SCOPE: "user" } };
        delete rewritten.cwd;
        for (const shell of ["bash", "powershell"]) {
          if (!rewritten[shell]) continue;
          rewritten[shell] = rewritten[shell].replace(/\.github\/hooks\/scripts\/([\w.-]+)/g, (_, file) => {
            scripts.add(file);
            return shell === "powershell" ? `"$env:PLUGIN_ROOT/hooks/scripts/${file}"` : `"\${PLUGIN_ROOT}/hooks/scripts/${file}"`;
          });
        }
        (merged.hooks[event] ??= []).push(rewritten);
      }
    }
  }
  if (Object.keys(merged.hooks).length === 0) return [];
  for (const file of scripts) await copyFile(path.join(dirs.hooks, "scripts", file), path.join(pluginDir, "hooks", "scripts", file));
  await writeJson(path.join(pluginDir, "hooks", "hooks.json"), merged);
  return Object.keys(merged.hooks);
}
async function copyFile(from, to) {
  await mkdir(path.dirname(to), { recursive: true });
  await cp(from, to);
}
async function writeJson(file, data) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(data, null, 2)}\n`);
}
async function fileHashes(dir) {
  const result = [];
  for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const full = path.join(entry.parentPath ?? entry.path, entry.name);
    result.push({ path: path.relative(dir, full).replace(/\\/g, "/"), sha256: createHash("sha256").update(await readFile(full)).digest("hex") });
  }
  return result.sort((a, b) => a.path.localeCompare(b.path));
}
function pluginReadme(bundle, agents, skills, hookEvents, instructions) {
  const lines = [`# ${bundle.displayName ?? bundle.name}`, "", bundle.description, "", "## Install", "", "```bash", `copilot plugin marketplace add ${marketplace.repository}   # once`, `copilot plugin install ${bundle.name}@${marketplace.name}`, "```", ""];
  if (agents.length) lines.push("## Agents", "", "| Agent | Description |", "| --- | --- |", ...agents.map((a) => `| \`${a.name}\` | ${a.description} |`), "");
  if (agents.length) {
    const prompts = {
      "unit-agent": "Generate and run unit tests for src/path/to/module.js.",
      "code-agent": "Implement jira:PROJ-123 using its acceptance criteria.",
      "task-agent": "Break down ado:123 into development tasks and show the dry run.",
      "modplanner": "Plan assessments/app.json, then show the Jira preview for PROJ.",
      "fsd-agent": "Generate an FSD for Jira epic PROJ-123 and list open questions.",
      "finops-agent": "Summarize this organization's Copilot metrics and identify budget risks.",
      "hld-agent": "Produce an HLD for this change in docs/hld/change.md.",
      "architectconnect": "Analyze this repository and produce an evidence-based HLD.",
      "figma-agent": "Design a settings page in <Figma URL> using our design system, or audit a frame."
    };
    lines.push("## Use the agents", "", "In VS Code, open the repository where you want the work done, enable **Chat: Use Agent Skills**, and select an installed agent from the Copilot Chat agent picker. Give it a specific goal and relevant file paths or work item IDs. Review proposed changes and confirm any external write before it proceeds.", "", "Example requests:", "", ...agents.map((a) => `- **${a.name}**: \`${prompts[a.name] ?? `Ask for help with: ${a.description}`}\``), "");
  }
  if (skills.length) lines.push("## Skills", "", "| Skill | Description |", "| --- | --- |", ...skills.map((s) => `| \`${s.name}\` | ${s.description} |`), "");
  if (skills.some((s) => s.name === "work-items")) lines.push("## Configure work item access", "", "Set `WORK_ITEM_PROVIDER` to `ado`, `jira` or `github`, then configure the provider-specific variables in `.env.local` at the repository root or in the shell. The setup guide lists required variables and permissions: `skills/work-items/references/setup.md`. Never put credentials in prompts or Git. No MCP server is used.", "");
  if (skills.some((s) => s.name === "l2-platform-runner")) lines.push("## Configure the programmatic runtime", "", "Plugin installation does not install the L2 runtime. Set `L2_PLATFORM_ROOT` to an existing platform checkout with its npm workspaces installed, and run from the application workspace. Configure Jira access and `COPILOT_GITHUB_TOKEN` in the environment or platform checkout as described in `skills/l2-platform-runner/references/setup.md`. The launcher does not download code, install dependencies or copy credentials.", "");
  if (agents.some((a) => a.name === "finops-agent")) lines.push("## Configure Copilot metrics", "", "Live metrics access requires Copilot metrics reports to be enabled for the organization and a GitHub token with organization `read:org` access. Configure `GITHUB_TOKEN` and `COPILOT_ORG` in the environment; do not paste tokens into prompts. This plugin packages the Copilot agent and skills, not the scheduled L2 monitor or its Teams delivery runtime.", "");
  if (agents.some((a) => a.name === "figma-agent")) lines.push("## Configure Figma MCP access", "", "This plugin includes the `figma-use`, `figma-generate-design` and `figma-generate-library` skills, and requires the remote Figma MCP server (`https://mcp.figma.com/mcp`) configured as `figma` in your editor or Copilot CLI. Sign in to Figma when prompted; never put tokens or credentials in prompts or repository files.", "");
  if (hookEvents.length) lines.push("## Hooks", "", `Runs on: ${hookEvents.join(", ")}. Audit entries go to \`~/.copilot/l2-audit/audit.jsonl\`.`, "");
  if (instructions.length) lines.push("## Configure repository instructions", "", "These files are optional repository-scoped guidance; installing the plugin does not apply them automatically. To use one, copy the file from this plugin's `instructions/` directory into the target repository's `.github/instructions/` directory. Keep its YAML frontmatter: `applyTo` controls which files receive the guidance. These files do not install agents or configure credentials.", "", "| File | Applies to | Purpose |", "| --- | --- | --- |", ...instructions.map((i) => `| \`instructions/${i.name}.instructions.md\` | \`${i.applyTo}\` | ${i.description} |`), "");
  lines.push(`_Version ${bundle.version}. Generated by \`npm run package\`. Do not edit by hand._`, "");
  return lines.join("\n");
}
function marketplaceReadme(list) {
  return [`# ${marketplace.name}`, "", marketplace.description, "", "```bash", `copilot plugin marketplace add ${marketplace.repository}`, `copilot plugin marketplace browse ${marketplace.name}`, "```", "",
    "| Plugin | Version | Description | Install |", "| --- | --- | --- | --- |",
    ...list.map((b) => `| [${b.displayName ?? b.name}](plugins/${b.name}/README.md) | ${b.version} | ${b.description} | \`copilot plugin install ${b.name}@${marketplace.name}\` |`),
    "", "Install `l2-guardrails` first.", "", `_Generated by \`npm run package\` (${ref})._`, ""].join("\n");
}
