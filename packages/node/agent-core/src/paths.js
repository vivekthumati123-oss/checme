import path from "node:path";
import { existsSync } from "node:fs";

/** Repository root: L2_ROOT, then GITHUB_WORKSPACE, then the nearest folder containing `.github`. */
export function repoRoot(start = process.cwd()) {
  if (process.env.L2_ROOT) return path.resolve(process.env.L2_ROOT);
  if (process.env.GITHUB_WORKSPACE) return path.resolve(process.env.GITHUB_WORKSPACE);
  let current = path.resolve(start);
  for (;;) {
    if (existsSync(path.join(current, ".github"))) return current;
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(start);
    current = parent;
  }
}

export const layout = (root = repoRoot()) => ({
  root,
  agents: path.join(root, ".github", "agents"),
  instructions: path.join(root, ".github", "instructions"),
  repoInstructions: path.join(root, ".github", "copilot-instructions.md"),
  skills: path.join(root, ".github", "skills"),
  hooks: path.join(root, ".github", "hooks"),
  l2: path.join(root, "l2"),
  bundles: path.join(root, "bundles.json"),
  policies: path.join(root, "configurations", "policies"),
});
