import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";

import { layout, repoRoot } from "./paths.js";

export async function loadBundles(root = repoRoot()) {
  const file = layout(root).bundles;
  if (!existsSync(file)) return { marketplace: null, platform: null, bundles: [] };
  const data = JSON.parse(await readFile(file, "utf8"));
  return { marketplace: data.marketplace ?? null, platform: data.platform ?? null, bundles: data.bundles ?? [] };
}

/** Point a local trigger workflow at the platform's reusable workflow, pinned to `ref`. */
export function toRemoteWorkflow(source, platformRepo, pinRef) {
  const out = [];
  let rewrote = false;
  let pending = null;
  for (const line of source.split("\n")) {
    const uses = /^(\s*)uses:\s*\.\/\.github\/workflows\/(_agent-[\w-]+\.yml)\s*$/.exec(line);
    if (uses) {
      out.push(`${uses[1]}uses: ${platformRepo}/.github/workflows/${uses[2]}@${pinRef}`);
      pending = uses[1];
      rewrote = true;
      continue;
    }
    out.push(line);
    if (pending !== null && new RegExp(`^${pending}with:\\s*$`).test(line)) {
      out.push(`${pending}  platform-repository: ${platformRepo}`, `${pending}  platform-ref: ${pinRef}`);
      pending = null;
    }
  }
  return rewrote ? out.join("\n") : null;
}
