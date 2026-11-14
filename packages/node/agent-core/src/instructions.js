import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

import { parseFrontmatter } from "./frontmatter.js";
import { matchesAny, splitPatterns } from "./glob.js";
import { layout } from "./paths.js";

/** Repository instructions (always) plus `*.instructions.md` whose `applyTo` matches. */
export class InstructionSet {
  constructor({ repository = null, files = [] } = {}) {
    this.repository = repository;
    this.files = files;
  }

  static async load(root) {
    const paths = layout(root);
    const repository = existsSync(paths.repoInstructions)
      ? { name: "copilot-instructions", applyTo: ["**"], body: (await readFile(paths.repoInstructions, "utf8")).trim(), filePath: paths.repoInstructions }
      : null;
    const files = [];
    if (existsSync(paths.instructions)) {
      for (const file of (await readdir(paths.instructions)).filter((f) => f.endsWith(".instructions.md")).sort()) {
        const filePath = path.join(paths.instructions, file);
        const { data, body } = parseFrontmatter(await readFile(filePath, "utf8"), filePath);
        files.push({ name: file.replace(/\.instructions\.md$/, ""), description: data.description ?? "", applyTo: splitPatterns(data.applyTo), body, filePath });
      }
    }
    return new InstructionSet({ repository, files });
  }

  resolveFor(targetPaths = []) {
    const selected = this.files.filter((i) => i.applyTo.includes("**") || targetPaths.some((p) => matchesAny(i.applyTo, p)));
    return this.repository ? [this.repository, ...selected] : selected;
  }
}
