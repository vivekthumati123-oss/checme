import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

import { parseFrontmatter } from "./frontmatter.js";
import { layout } from "./paths.js";

const ASSET_DIRS = ["references", "assets", "scripts"];

/** Agent skill with progressive disclosure: SKILL.md always, assets on demand only. */
export class Skill {
  constructor({ name, description, body, directory, assets }) {
    Object.assign(this, { name, description, body, directory, assets });
  }

  get references() {
    return this.assets.filter((a) => a.startsWith("references/"));
  }

  async readAsset(relativePath) {
    if (!this.assets.includes(relativePath)) throw new Error(`Skill ${this.name} has no asset ${relativePath}`);
    return readFile(path.join(this.directory, relativePath), "utf8");
  }

  findReference(keyword) {
    const key = String(keyword).toLowerCase();
    return this.references.find((r) => path.basename(r, path.extname(r)).toLowerCase() === key) ?? null;
  }
}

export async function loadSkill(name, root) {
  const directory = path.join(layout(root).skills, name);
  const file = path.join(directory, "SKILL.md");
  if (!existsSync(file)) throw new Error(`Skill not found: ${file}`);
  const { data, body } = parseFrontmatter(await readFile(file, "utf8"), file);
  const assets = [];
  for (const dir of ASSET_DIRS) {
    const full = path.join(directory, dir);
    if (!existsSync(full)) continue;
    for (const entry of await readdir(full, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile()) continue;
      assets.push(path.relative(directory, path.join(entry.parentPath ?? entry.path, entry.name)).replace(/\\/g, "/"));
    }
  }
  return new Skill({ name: data.name ?? name, description: data.description ?? "", body, directory, assets: assets.sort() });
}

export async function listSkills(root) {
  const dir = layout(root).skills;
  if (!existsSync(dir)) return [];
  return (await readdir(dir, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name).sort();
}
