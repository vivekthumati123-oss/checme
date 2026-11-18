import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { ARTIFACTS, EXIT_CODES, FileContextSchema, ManifestSchema, StageError, type FileContext } from "../contracts";
import { isSafeRealPathInsideRoot } from "../core/paths";

export interface RunLocalShowOptions {
  workDir: string;
  fileId: string;
  maxChars?: number;
}

export function trimContextForMaxChars(packet: FileContext, maxChars: number): FileContext {
  const copy = structuredClone(packet);
  if (JSON.stringify(copy, null, 2).length <= maxChars) {
    return copy;
  }

  // 1. Drop style sample first
  if (copy.styleSample) {
    delete copy.styleSample;
    if (JSON.stringify(copy, null, 2).length <= maxChars) return copy;
  }

  // 2. Trim class skeleton
  if (copy.classSkeleton) {
    copy.classSkeleton = copy.classSkeleton.slice(0, Math.min(400, copy.classSkeleton.length));
    if (JSON.stringify(copy, null, 2).length <= maxChars) return copy;
    delete copy.classSkeleton;
    if (JSON.stringify(copy, null, 2).length <= maxChars) return copy;
  }

  // 3. Trim referenced signatures and fixtures
  if (copy.fixtures && copy.fixtures.length > 0) {
    copy.fixtures = [];
    if (JSON.stringify(copy, null, 2).length <= maxChars) return copy;
  }
  while (copy.referencedSignatures.length > 0 && JSON.stringify(copy, null, 2).length > maxChars) {
    copy.referencedSignatures.pop();
  }

  // 4. Trim sourceFile.content cleanly
  const overhead = JSON.stringify(
    { ...copy, sourceFile: { ...copy.sourceFile, content: "", truncated: true } },
    null,
    2,
  ).length;
  if (overhead < maxChars) {
    const budget = Math.max(0, maxChars - overhead - 32);
    if (copy.sourceFile.content.length > budget) {
      copy.sourceFile.content = copy.sourceFile.content.slice(0, budget);
      copy.sourceFile.truncated = true;
    }
  } else {
    copy.sourceFile.content = "";
    copy.sourceFile.truncated = true;
  }

  // 5. Enforce hard maxChars bound while keeping primary target
  while (copy.targets.length > 1 && JSON.stringify(copy, null, 2).length > maxChars) {
    copy.targets.pop();
  }
  if (JSON.stringify(copy, null, 2).length > maxChars && copy.conventions.importHint.length > 64) {
    copy.conventions.importHint = copy.conventions.importHint.slice(0, 64);
  }
  for (const t of copy.targets) {
    if (JSON.stringify(copy, null, 2).length <= maxChars) break;
    if (t.signature && t.signature.length > 64) t.signature = t.signature.slice(0, 64);
  }

  return copy;
}

export function runLocalShow(opts: RunLocalShowOptions): FileContext {
  const prepareDir = path.join(opts.workDir, ARTIFACTS.prepare.dir);
  const manifestPath = path.join(prepareDir, "manifest.json");
  if (!existsSync(manifestPath)) {
    throw new StageError(
      `Manifest not found at "${manifestPath}". Run \`unit-agent local detect\` first.`,
      EXIT_CODES.CONFIG_OR_INPUT,
      "local",
      "missing_manifest",
    );
  }
  const manifest = ManifestSchema.parse(JSON.parse(readFileSync(manifestPath, "utf8")));
  const entry = manifest.files.find((f) => f.fileId === opts.fileId);
  if (!entry) {
    throw new StageError(
      `Unknown fileId "${opts.fileId}" in manifest.`,
      EXIT_CODES.CONFIG_OR_INPUT,
      "local",
      "unknown_file_id",
    );
  }

  if (!isSafeRealPathInsideRoot(entry.contextPath, prepareDir, { requireRegularFileIfExists: true })) {
    throw new StageError(
      `Unsafe context path "${entry.contextPath}".`,
      EXIT_CODES.POLICY_OR_HASH,
      "local",
      "path_violation",
    );
  }
  const ctxPath = path.join(prepareDir, entry.contextPath);
  if (!existsSync(ctxPath)) {
    throw new StageError(
      `Context packet missing at "${ctxPath}".`,
      EXIT_CODES.CONFIG_OR_INPUT,
      "local",
      "missing_context",
    );
  }

  const parsed = FileContextSchema.parse(JSON.parse(readFileSync(ctxPath, "utf8")));
  return trimContextForMaxChars(parsed, opts.maxChars ?? 40_000);
}
