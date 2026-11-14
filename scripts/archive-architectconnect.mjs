import { createHash } from "node:crypto";
import * as filesystem from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { HookRunner, PolicyEngine } from "@l2/agent-core";
import { evaluate } from "../.github/hooks/scripts/guard-tool-use.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const archiveDirectory = "docs/migration-archive/architectconnect";
const hash = (content) => createHash("sha256").update(content).digest("hex");
const excludedDirectories = new Set([".git", "node_modules", "dist", "build", ".cache", ".l2", "__pycache__"]);
const credentialPath = /(^|\/)(\.env(?:\.[^/]*)?|credentials?(?:\.[^/]*)?|secrets?(?:\.[^/]*)?|id_rsa[^/]*|id_ed25519[^/]*)(\/|$)|\.(pem|key|pfx|p12)$/i;

export async function collectSnapshot(sourceRoot, { fs = filesystem, env = process.env } = {}) {
  const files = [];
  const excluded = [];
  const emptyDirectories = [];
  const knownSecrets = Object.entries(env).filter(([key, value]) => /(TOKEN|SECRET|PASSWORD|PAT|KEY|CONNECTION_STRING)/i.test(key) && value?.length >= 8).map(([, value]) => value);
  async function visit(relative = "") {
    const entries = await fs.readdir(path.join(sourceRoot, relative), { withFileTypes: true });
    if (!entries.length) emptyDirectories.push(relative || ".");
    for (const entry of entries) {
      const filePath = path.posix.join(relative, entry.name);
      if (entry.isSymbolicLink() || excludedDirectories.has(entry.name) || credentialPath.test(filePath)) {
        excluded.push({ path: filePath, reason: entry.isSymbolicLink() ? "symlink" : credentialPath.test(filePath) ? "owner-managed credentials; not read" : "generated or repository metadata; not traversed" });
        continue;
      }
      if (entry.isDirectory()) { await visit(filePath); continue; }
      if (!entry.isFile() || (!/\.(js|mjs|md|json|dsl|txt|yaml|yml)$/.test(entry.name) && entry.name !== ".gitignore")) {
        excluded.push({ path: filePath, reason: "unclassified non-text asset; owner review required" });
        continue;
      }
      const bytes = await fs.readFile(path.join(sourceRoot, filePath));
      const content = bytes.toString("utf8");
      if (!Buffer.from(content, "utf8").equals(bytes)) {
        excluded.push({ path: filePath, reason: "non-UTF8 asset; owner review required" });
        continue;
      }
      const guard = evaluate({ toolName: "create", toolArgs: { path: `${archiveDirectory}/source-snapshot.json`, content } });
      if (guard || knownSecrets.some((secret) => content.includes(secret)) || /\b(?:password|api[_-]?key|access[_-]?token|client[_-]?secret)\s*[:=]\s*["'][^"'\r\n]{8,}["']/i.test(content)) {
        excluded.push({ path: filePath, reason: "sensitive-content check; owner review required" });
        continue;
      }
      files.push({ path: filePath, sha256: hash(bytes), content });
    }
  }
  await visit();
  files.sort((left, right) => left.path.localeCompare(right.path));
  excluded.sort((left, right) => left.path.localeCompare(right.path));
  return { format: 1, sourceRoot: "Architect Connect", files, excluded, emptyDirectories: emptyDirectories.sort() };
}

export function verifySnapshot(snapshot) {
  if (snapshot.format !== 1 || !Array.isArray(snapshot.files) || !snapshot.files.length) throw new Error("Snapshot format or file list is invalid.");
  if (new Set(snapshot.files.map((file) => file.path)).size !== snapshot.files.length) throw new Error("Snapshot contains duplicate source paths.");
  for (const file of snapshot.files) {
    if (credentialPath.test(file.path) || file.path.split("/").includes("..") || file.path.startsWith("/") || /^[A-Za-z]:/.test(file.path)) throw new Error("Snapshot contains an unsafe source path.");
    if (typeof file.content !== "string" || hash(file.content) !== file.sha256) throw new Error("Snapshot content failed checksum verification.");
  }
  return snapshot.files.length;
}

export function disposition(filePath, migratedPaths = new Set()) {
  if (migratedPaths.has(filePath)) return { disposition: "migrated", target: `agents/node/architectconnect/src/engine/${filePath}` };
  const targets = {
    "reportGenerator.js": "agents/node/architectconnect/src/artifact-writer.js",
    "githubConnector.js": "agents/node/architectconnect/src/engine/services/githubRepositoryLoader.js",
    "localConnector.js": "agents/node/architectconnect/src/engine/services/localRepositoryLoader.js",
    "testService.js": "agents/node/architectconnect/src/index.js",
    ".github/agents/architect-connect.agent.md": ".github/agents/hld-agent.agent.md",
    ".github/copilot-instructions.md": ".github/skills/architectconnect/SKILL.md",
    "package.json": "agents/node/architectconnect/package.json",
  };
  if (targets[filePath]) return { disposition: "adapted; original archived", target: targets[filePath] };
  if (filePath.startsWith("services/")) return { disposition: "adapted; original archived", target: `agents/node/architectconnect/src/engine/${filePath}` };
  if (filePath === "architectConnectMcpServer.js") return { disposition: "retired with owner approval; original and contract archived", target: "docs/migration-archive/architectconnect/README.md" };
  return { disposition: "archived historical material; not runtime code", target: `${archiveDirectory}/source-snapshot.json` };
}

export async function main(args = process.argv.slice(2)) {
  const snapshotPath = path.join(root, archiveDirectory, "source-snapshot.json");
  if (args.includes("--verify")) {
    const snapshotText = await filesystem.readFile(snapshotPath, "utf8");
    const receipt = JSON.parse(await filesystem.readFile(path.join(root, archiveDirectory, "source-dispositions.json"), "utf8"));
    if (receipt.snapshotSha256 !== hash(snapshotText)) throw new Error("Snapshot does not match its disposition receipt.");
    process.stdout.write(`Verified ${verifySnapshot(JSON.parse(snapshotText))} archived source files.\n`);
    return;
  }
  const snapshot = await collectSnapshot(path.join(root, "Architect Connect"));
  verifySnapshot(snapshot);
  const migrated = JSON.parse(await filesystem.readFile(path.join(root, archiveDirectory, "engine-receipt.json"), "utf8"));
  const migratedPaths = new Set(migrated.files.map((file) => file.source));
  for (const file of migrated.files) {
    if (snapshot.files.find((entry) => entry.path === file.source)?.sha256 !== file.sha256) throw new Error("An active legacy source differs from its migration baseline; review before archiving.");
  }
  const snapshotText = `${JSON.stringify(snapshot, null, 2)}\n`;
  const receipt = {
    format: 1, snapshot: `${archiveDirectory}/source-snapshot.json`, snapshotSha256: hash(snapshotText),
    files: snapshot.files.map(({ path: filePath, sha256 }) => ({ path: filePath, sha256, ...disposition(filePath, migratedPaths) })),
    excluded: snapshot.excluded, emptyDirectories: snapshot.emptyDirectories,
    decisions: { mcp: "retirement approved", liveScm: "deferred by owner", activationAndDeletion: "await final owner review" },
  };
  if (args.includes("--apply")) {
    const outputs = [{ path: `${archiveDirectory}/source-snapshot.json`, content: snapshotText }, { path: `${archiveDirectory}/source-dispositions.json`, content: `${JSON.stringify(receipt, null, 2)}\n` }];
    const policy = new PolicyEngine({ rules: [{ action: "file.write", effect: "allow", conditions: { paths: [`${archiveDirectory}/**`] } }] });
    const hooks = await HookRunner.load(root, { names: ["l2-guardrails", "l2-audit"] });
    for (const output of outputs) {
      if (!policy.permits("file.write", { path: output.path })) throw new Error("Snapshot output denied by policy.");
      const guard = await hooks.allowTool("create", output);
      if (guard.decision !== "allow" || guard.results.some((result) => result.error)) throw new Error("Snapshot output denied by guardrails.");
      try { await filesystem.lstat(path.join(root, output.path)); throw new Error("Snapshot output already exists; refusing to overwrite it."); }
      catch (error) { if (error.code !== "ENOENT") throw error; }
    }
    for (const output of outputs) await filesystem.writeFile(path.join(root, output.path), output.content, { encoding: "utf8", flag: "wx" });
  }
  process.stdout.write(`${args.includes("--apply") ? "Archived" : "Prepared"} ${snapshot.files.length} non-secret text files; ${snapshot.excluded.length} exclusions recorded; temporary folder unchanged.\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { process.stderr.write("ArchitectConnect snapshot failed. Review checksum, exclusion, or output-collision checks; no source was deleted.\n"); process.exitCode = 1; });
}