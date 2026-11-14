import * as filesystem from "node:fs/promises";
import path from "node:path";

export class ArtifactWriteError extends Error {
  constructor(message) {
    super(message);
    this.name = "ArtifactWriteError";
  }
}

export function normalizeArtifactPath(value) {
  if (typeof value !== "string" || !value || value.includes("\0")) throw new ArtifactWriteError("An artifact needs a nonempty relative path.");
  const normalized = value.replace(/\\/g, "/");
  if (normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized) || normalized.split("/").includes("..")) {
    throw new ArtifactWriteError("Artifact paths must stay inside the application workspace.");
  }
  if (!/^docs\/hld\/[A-Za-z0-9._/-]+\.(md|dsl|json)$/.test(normalized)) {
    throw new ArtifactWriteError("ArchitectConnect artifacts must be Markdown, DSL, or JSON under docs/hld/.");
  }
  return path.posix.normalize(normalized);
}

export async function writeArtifacts({ files, workspace, policy, hooks, dryRun = true, fs = filesystem }) {
  const prepared = [];
  for (const file of files) {
    const relative = normalizeArtifactPath(file.path);
    if (typeof file.content !== "string" || !file.content.trim()) throw new ArtifactWriteError("Cannot persist an empty architecture artifact.");
    const decision = policy.evaluate({ action: "file.write", attributes: { path: relative } });
    if (!decision.allowed || decision.requiresApproval) throw new ArtifactWriteError("Artifact write denied or requires external approval.");
    if (!hooks?.allowTool) throw new ArtifactWriteError("Artifact writes require configured guardrails.");
    const guard = await hooks.allowTool("create", { path: relative, content: file.content });
    if (guard?.decision !== "allow" || guard.results?.some((result) => result.error)) {
      throw new ArtifactWriteError("Artifact blocked by guardrails or a guardrail execution error.");
    }
    prepared.push({ ...file, path: relative });
  }
  if (new Set(prepared.map((file) => file.path)).size !== prepared.length) throw new ArtifactWriteError("Artifact paths must be unique.");
  if (dryRun) return prepared.map((file) => ({ type: "file", name: path.posix.basename(file.path), path: file.path, saved: false }));
  if (!workspace || !path.isAbsolute(workspace)) throw new ArtifactWriteError("Writing reports requires an absolute application workspace.");
  const rootStat = await fs.lstat(workspace);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) throw new ArtifactWriteError("Application workspace must be a real directory, not a symlink.");
  const root = await fs.realpath(workspace);
  for (const file of prepared) {
    let current = root;
    for (const segment of file.path.split("/")) {
      current = path.join(current, segment);
      try {
        const stat = await fs.lstat(current);
        if (stat.isSymbolicLink()) throw new ArtifactWriteError("Artifact path contains a symlink.");
        if (current === path.join(root, file.path)) throw new ArtifactWriteError("An artifact already exists. Choose a new output directory.");
        if (!stat.isDirectory()) throw new ArtifactWriteError("Artifact parent is not a directory.");
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
  }
  const artifacts = [];
  for (const file of prepared) {
    let current = root;
    for (const segment of path.posix.dirname(file.path).split("/")) {
      current = path.join(current, segment);
      try { await fs.mkdir(current); } catch (error) { if (error.code !== "EEXIST") throw error; }
      const stat = await fs.lstat(current);
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new ArtifactWriteError("Artifact parent is not a safe directory.");
    }
    await fs.writeFile(path.join(root, file.path), file.content, { encoding: "utf8", flag: "wx" });
    artifacts.push({ type: "file", name: path.posix.basename(file.path), path: file.path, saved: true });
  }
  return artifacts;
}