import * as filesystem from "node:fs/promises";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";

export function digest(value) {
  return createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
}

export class ArtifactStore {
  constructor({ workspace, directory, context, fs = filesystem, uniqueId = randomUUID }) {
    this.workspace = path.resolve(workspace);
    this.directory = directory;
    this.context = context;
    this.fs = fs;
    this.uniqueId = uniqueId;
    if (!/^\.l2\/(modplanner|requirementshub)\/[A-Za-z0-9_-]+$/.test(directory)) throw new Error("State directory must be .l2/<agent>/<run-or-epic>");
  }

  async resolve(relative) {
    if (typeof relative !== "string" || path.isAbsolute(relative) || relative.replace(/\\/g, "/").split("/").includes("..")) throw new Error("Path must be relative to the application workspace without traversal");
    const parts = relative.replace(/\\/g, "/").split("/").filter(Boolean);
    if (parts.some((part) => /^\.env(?:\.|$)/i.test(part) || /\.(pem|key|pfx|p12)$/i.test(part) || /^id_(rsa|ed25519)/i.test(part) || /^(\.aws|\.azure|\.ssh|\.npmrc|\.netrc|credentials(?:\.json)?|secrets(?:\.json)?)$/i.test(part))) throw new Error("Credential paths are not allowed");
    let current = this.workspace;
    for (const part of parts) {
      current = path.join(current, part);
      try {
        if ((await this.fs.lstat(current)).isSymbolicLink()) throw new Error("Symlink paths are not allowed");
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    return current;
  }

  relative(name) {
    if (!/^[A-Za-z0-9_.-]+$/.test(name) || name === "." || name === "..") throw new Error("Artifact name must be a plain filename");
    return `${this.directory}/${name}`;
  }

  async readInput(relative) {
    this.context.policy.authorize({ action: "repository.read" });
    const scoped = typeof relative === "string" && path.isAbsolute(relative) ? path.relative(this.workspace, relative) : relative;
    return this.fs.readFile(await this.resolve(scoped), "utf8");
  }

  async read(name) {
    try {
      return await this.readInput(this.relative(name));
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  }

  async json(name) {
    const content = await this.read(name);
    return content === null ? null : JSON.parse(content);
  }

  async guard(relative, content) {
    const decision = this.context.policy.authorize({ action: "file.write", attributes: { path: relative } });
    if (decision.requiresApproval) throw new Error("Artifact policy requires approval; no write performed");
    if (!this.context.hooks?.allowTool) throw new Error("File writes require configured guard hooks");
    const check = await this.context.hooks.allowTool("write", { path: relative, content });
    if (check.decision !== "allow" || check.results?.some((result) => result.error)) throw new Error(check.reason ?? "Artifact guard failed");
  }

  async write(name, value, { overwrite = true } = {}) {
    const relative = this.relative(name);
    const content = typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`;
    await this.guard(relative, content);
    const target = await this.resolve(relative);
    if (!overwrite && await this.read(name) !== null) throw new Error(`${name} already exists; select a new revision/run`);
    await this.fs.mkdir(path.dirname(target), { recursive: true });
    const temporary = `${target}.${this.uniqueId()}.tmp`;
    await this.guard(path.relative(this.workspace, temporary).replace(/\\/g, "/"), content);
    try {
      await this.fs.writeFile(temporary, content, { flag: "wx" });
      await this.fs.rename(temporary, target);
    } finally {
      await this.fs.unlink(temporary).catch((error) => { if (error.code !== "ENOENT") throw error; });
    }
    await this.context.hooks.run("postToolUse", { toolName: "write", toolArgs: { path: relative }, toolResult: { resultType: "success" } });
    return relative;
  }

  async locked(operation) {
    const relative = this.relative("operation.lock");
    await this.guard(relative, "locked");
    const target = await this.resolve(relative);
    await this.fs.mkdir(path.dirname(target), { recursive: true });
    let lock;
    try {
      lock = await this.fs.open(target, "wx");
    } catch (error) {
      if (error.code === "EEXIST") throw new Error("State is locked; reconcile interrupted operations before removing the lock");
      throw error;
    }
    try {
      return await operation();
    } finally {
      await lock.close();
      await this.fs.unlink(target);
    }
  }
}