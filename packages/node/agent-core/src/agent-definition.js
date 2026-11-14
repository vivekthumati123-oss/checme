import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

import { parseFrontmatter } from "./frontmatter.js";
import { layout } from "./paths.js";

/** Parsed Copilot custom agent (`.github/agents/<name>.agent.md`). */
export class AgentDefinition {
  constructor({ filePath, data, body }) {
    this.filePath = filePath;
    this.frontmatter = data;
    this.name = data.name ?? agentNameFromFile(filePath);
    this.description = data.description ?? "";
    this.model = data.model ?? null;
    this.tools = Array.isArray(data.tools) ? data.tools : [];
    this.body = body;
  }
}

export const agentNameFromFile = (filePath) => path.basename(filePath).replace(/\.agent\.md$/, "").replace(/\.md$/, "");

export function parseAgentMarkdown(content, filePath = "<memory>.agent.md") {
  const { data, body } = parseFrontmatter(content, filePath);
  return new AgentDefinition({ filePath, data, body });
}

export async function loadAgentFile(filePath) {
  if (!existsSync(filePath)) throw new Error(`Custom agent file not found: ${filePath}`);
  return parseAgentMarkdown(await readFile(filePath, "utf8"), filePath);
}

export async function listAgentFiles(root) {
  const dir = layout(root).agents;
  if (!existsSync(dir)) return [];
  return (await readdir(dir)).filter((f) => f.endsWith(".agent.md")).sort().map((f) => path.join(dir, f));
}
