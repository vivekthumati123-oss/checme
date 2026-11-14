import * as filesystem from "node:fs/promises";
import path from "node:path";
import { isSafeRepositoryPath, selectArchitectureFiles } from "./architectureFileSelector.js";
import { normalizeContents } from "./scmRepositoryLoader.js";

export async function loadLocalRepository(directory, { fs = filesystem, maxFiles = 5000, maxFileBytes = 1024 * 1024 } = {}) {
  const root = path.resolve(directory);
  const stat = await fs.lstat(root);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("Local repository must be a real directory, not a symlink.");
  const tree = [];
  async function visit(relative = "") {
    const entries = await fs.readdir(path.join(root, relative), { withFileTypes: true });
    for (const entry of entries) {
      const filePath = path.posix.join(relative, entry.name);
      if (!isSafeRepositoryPath(filePath) || entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) await visit(filePath);
      else if (entry.isFile()) {
        tree.push({ path: filePath, type: "file" });
        if (tree.length > maxFiles) throw new Error("Local repository exceeds the file limit. Choose a smaller source directory.");
      }
    }
  }
  await visit();
  const selectedPaths = selectArchitectureFiles(tree);
  const files = [];
  for (const filePath of selectedPaths) {
    const absolute = path.join(root, filePath);
    const current = await fs.lstat(absolute);
    if (current.isSymbolicLink() || !current.isFile()) throw new Error("A local source file changed during acquisition. Retry with a stable source directory.");
    if (current.size > maxFileBytes) throw new Error("A selected source file exceeds the size limit. Narrow the source directory.");
    files.push({ path: filePath, type: "file", size: current.size, content: await fs.readFile(absolute, "utf8") });
  }
  const contents = normalizeContents(files);
  return {
    contents, selectedPaths, packageContent: contents.find((file) => file.path.toLowerCase() === "package.json")?.content ?? "",
    metadata: { repository: path.basename(root) },
    source: { type: "local", repository: path.basename(root), branch: null },
  };
}