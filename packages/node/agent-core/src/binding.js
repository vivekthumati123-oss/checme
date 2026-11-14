import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

import { loadAgentFile } from "./agent-definition.js";
import { InstructionSet } from "./instructions.js";
import { loadSkill } from "./skills.js";
import { layout, repoRoot } from "./paths.js";
import { parseYaml } from "./yaml.js";

/** Everything one L2 agent needs, resolved from `l2/<id>.json`. */
export class AgentBinding {
  constructor({ manifest, manifestPath, root, agent, skills, instructions, policy }) {
    Object.assign(this, { manifest, manifestPath, root, agent, skills, instructions, policy });
  }

  get id() { return this.manifest.name; }
  get displayName() { return this.manifest.displayName ?? this.manifest.name; }
  get status() { return this.manifest.status ?? "draft"; }
  get hookNames() { return this.manifest.hooks ?? []; }
  get tools() { return this.agent.tools; }

  /** Automation model: runtime.model, then L2_DEFAULT_MODEL, else null (SDK default). Agent-file model is ignored. */
  get model() {
    return this.manifest.runtime?.model ?? process.env.L2_DEFAULT_MODEL ?? null;
  }

  skill(name) {
    const skill = this.skills.find((s) => s.name === name);
    if (!skill) throw new Error(`Agent ${this.id} does not declare skill ${name}`);
    return skill;
  }

  resolveConfig(overrides = {}) {
    const clean = Object.fromEntries(Object.entries(overrides).filter(([, v]) => v !== undefined && v !== null));
    return { ...(this.manifest.config ?? {}), ...clean };
  }
}

export async function readBindingManifest(id, root = repoRoot()) {
  const manifestPath = path.join(layout(root).l2, `${id}.json`);
  if (!existsSync(manifestPath)) throw new Error(`L2 binding not found: ${manifestPath}`);
  return { manifest: JSON.parse(await readFile(manifestPath, "utf8")), manifestPath };
}

export async function loadBinding(id, { root = repoRoot() } = {}) {
  const { manifest, manifestPath } = await readBindingManifest(id, root);
  const agent = await loadAgentFile(path.join(root, manifest.agent));
  const skills = await Promise.all((manifest.skills ?? []).map((name) => loadSkill(name, root)));
  const instructions = await InstructionSet.load(root);
  const policyPath = path.join(root, manifest.policy ?? "configurations/policies/default.yaml");
  const policy = existsSync(policyPath) ? parseYaml(await readFile(policyPath, "utf8")) : { rules: [] };
  return new AgentBinding({ manifest, manifestPath, root, agent, skills, instructions, policy });
}

export async function listBindings(root = repoRoot()) {
  const dir = layout(root).l2;
  if (!existsSync(dir)) return [];
  return (await readdir(dir)).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, "")).sort();
}
