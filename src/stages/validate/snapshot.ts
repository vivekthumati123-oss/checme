import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { ARTIFACTS, SnapshotSchema, type Proposed, type Snapshot } from "../../contracts";
import { sha256Hex } from "../../core/context";
import { cleanRepoRelative, normalizeSlashes } from "../../core/paths";

export function writeValidationSnapshot(params: { workDir: string; attempt: 1 | 2; proposed: Proposed }): Snapshot {
  const dirKey = params.attempt === 1 ? ARTIFACTS.snapshot1.dir : ARTIFACTS.snapshot2.dir;
  const files = params.proposed.files
    .filter((f) => f.status === "ok" && f.content.length > 0)
    .map((f) => ({
      fileId: f.fileId,
      testPath: f.testPath,
      sha256: /^[a-f0-9]{64}$/.test(f.sha256) ? f.sha256 : sha256Hex(f.content),
      bytes: Buffer.byteLength(f.content, "utf8"),
    }));

  const snapshot = SnapshotSchema.parse({
    schemaVersion: 1,
    attempt: params.attempt,
    headSha: params.proposed.headSha,
    files,
  });

  const outFile = path.join(params.workDir, dirKey, "snapshot.json");
  mkdirSync(path.dirname(outFile), { recursive: true });
  writeFileSync(outFile, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  return snapshot;
}

export function storeSnapshotValidatedContent(params: {
  workDir: string;
  attempt: 1 | 2;
  testPath: string;
  content: string;
}): string {
  const dirKey = params.attempt === 1 ? ARTIFACTS.snapshot1.dir : ARTIFACTS.snapshot2.dir;
  const snapFile = path.join(params.workDir, dirKey, "validated", params.testPath);
  mkdirSync(path.dirname(snapFile), { recursive: true });
  writeFileSync(snapFile, params.content, "utf8");

  const actualSha = sha256Hex(params.content);
  const metaPath = path.join(params.workDir, dirKey, "snapshot.json");
  if (existsSync(metaPath)) {
    try {
      const parsed = SnapshotSchema.parse(JSON.parse(readFileSync(metaPath, "utf8")));
      const normPath = cleanRepoRelative(normalizeSlashes(params.testPath));
      const updated = SnapshotSchema.parse({
        ...parsed,
        files: parsed.files.map((entry) =>
          cleanRepoRelative(normalizeSlashes(entry.testPath)) === normPath
            ? { ...entry, testPath: normPath, sha256: actualSha, bytes: Buffer.byteLength(params.content, "utf8") }
            : entry,
        ),
      });
      writeFileSync(metaPath, `${JSON.stringify(updated, null, 2)}\n`, "utf8");
    } catch {
      // ignore if snapshot metadata unreadable
    }
  }
  return actualSha;
}

export function listSnapshotFiles(rootDir: string): Set<string> {
  const hits = new Set<string>();
  if (!existsSync(rootDir)) return hits;

  const walk = (cur: string, depth: number): void => {
    if (depth > 8) return;
    let entries;
    try {
      entries = readdirSync(cur, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (ent.name === ".git" || ent.name === "node_modules" || ent.name === ".unit-agent") continue;
      const full = path.join(cur, ent.name);
      if (ent.isDirectory()) {
        walk(full, depth + 1);
      } else if (ent.isFile() && (ent.name.endsWith(".snap") || full.includes("__snapshots__"))) {
        hits.add(cleanRepoRelative(normalizeSlashes(path.relative(rootDir, full))));
      }
    }
  };

  walk(rootDir, 0);
  return hits;
}

export function verifyWrittenTestSnapshot(params: {
  workspaceRoot: string;
  testPath: string;
  expectedSha256: string;
}): boolean {
  const abs = path.join(params.workspaceRoot, params.testPath);
  if (!existsSync(abs)) return false;
  const actual = sha256Hex(readFileSync(abs, "utf8"));
  return actual === params.expectedSha256;
}
