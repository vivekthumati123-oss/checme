import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  ARTIFACTS,
  EXIT_CODES,
  FailuresSchema,
  FileContextSchema,
  ProposedSchema,
  StageError,
  type Failures,
  type LoggerLike,
  type Manifest,
  type Proposed,
  type ProposedFile,
  type UnitAgentConfig,
} from "../contracts";
import { sha256Hex } from "../core/context";
import { formatGeneratedTestContent } from "../core/text/eol";
import { CopilotSdkTestClient, FakeLlmClient, type LlmTestClient } from "../llm";
import { writeGitHubOutput, writeStageStatus } from "../telemetry";
import { loadPrepareConfig, loadManifest } from "./detect";

export interface RunRepairOptions {
  repoRoot: string;
  workDir: string;
  configPath?: string;
  config?: UnitAgentConfig;
  failuresPath?: string;
  failures?: Failures;
  proposedPath?: string;
  proposed?: Proposed;
  manifest?: Manifest;
  llmClient?: LlmTestClient;
  fakeLlmPath?: string;
  dryRun?: boolean;
  logger?: LoggerLike;
  writeOutputs?: boolean;
}

export async function runRepair(opts: RunRepairOptions): Promise<Proposed> {
  const config =
    opts.config ??
    loadPrepareConfig({
      repoRoot: opts.repoRoot,
      workDir: opts.workDir,
      configPath: opts.configPath,
    });
  const manifest = opts.manifest ?? loadManifest(opts.workDir);

  let failures = opts.failures;
  if (!failures) {
    const fp = opts.failuresPath ?? path.join(opts.workDir, ARTIFACTS.validate1.dir, "failures.json");
    if (!existsSync(fp)) {
      throw new StageError(
        `Failures file not found: "${fp}"`,
        EXIT_CODES.CONFIG_OR_INPUT,
        "repair",
        "missing_failures",
      );
    }
    failures = FailuresSchema.parse(JSON.parse(readFileSync(fp, "utf8")));
  }

  let proposed = opts.proposed;
  if (!proposed) {
    const pp = opts.proposedPath ?? path.join(opts.workDir, ARTIFACTS.proposed.dir, "proposed.json");
    if (!existsSync(pp)) {
      throw new StageError(
        `Proposed file not found: "${pp}"`,
        EXIT_CODES.CONFIG_OR_INPUT,
        "repair",
        "missing_proposed",
      );
    }
    proposed = ProposedSchema.parse(JSON.parse(readFileSync(pp, "utf8")));
  }

  const repairedFiles: ProposedFile[] = [];
  let requestsUsed = 0;

  if (failures.files.length === 0 || config.limits.repairAttempts === 0 || opts.dryRun) {
    const emptyRepaired = ProposedSchema.parse({
      schemaVersion: 1,
      runId: manifest.runId,
      headSha: manifest.headSha,
      model: config.model ?? null,
      files: [],
    });
    const outPath = path.join(opts.workDir, ARTIFACTS.repaired.dir, "proposed.repaired.json");
    const compatOutPath = path.join(opts.workDir, ARTIFACTS.repaired.dir, "repaired.json");
    mkdirSync(path.dirname(outPath), { recursive: true });
    const serializedEmpty = `${JSON.stringify(emptyRepaired, null, 2)}\n`;
    writeFileSync(outPath, serializedEmpty, "utf8");
    writeFileSync(compatOutPath, serializedEmpty, "utf8");
    writeStageStatus(opts.workDir, { stage: "repair", status: "ok", reason: "nothing_to_repair" });
    if (opts.writeOutputs !== false) {
      writeGitHubOutput({ repaired_count: 0, status: "ok" });
    }
    return emptyRepaired;
  }

  const client: LlmTestClient = opts.llmClient
    ? opts.llmClient
    : opts.fakeLlmPath
      ? await FakeLlmClient.fromScriptPath(opts.fakeLlmPath)
      : new CopilotSdkTestClient({ model: config.model });

  const prepareDir = path.join(opts.workDir, ARTIFACTS.prepare.dir);
  const manifestById = new Map(manifest.files.map((f) => [f.fileId, f]));
  const proposedById = new Map(proposed.files.map((f) => [f.fileId, f]));

  for (const failEntry of failures.files) {
    if (requestsUsed >= config.limits.maxRequestsPerRun) {
      opts.logger?.warn({ fileId: failEntry.fileId }, "Request budget reached during repair");
      break;
    }

    const mf = manifestById.get(failEntry.fileId);
    const prevPf = proposedById.get(failEntry.fileId);
    if (!mf || !prevPf) continue;

    const ctxPath = path.join(prepareDir, mf.contextPath);
    if (!existsSync(ctxPath)) continue;
    const ctx = FileContextSchema.parse(JSON.parse(readFileSync(ctxPath, "utf8")));

    const startMs = Date.now();
    requestsUsed += 1;

    try {
      const res = await client.repairTests({
        context: ctx,
        currentTestContent: prevPf.content,
        failure: {
          reason: failEntry.reason,
          message: `Failed gate "${failEntry.gate}" (${failEntry.reason})`,
          excerpt: failEntry.output,
        },
        attempt: 2,
      });

      const srcAbs = path.join(opts.repoRoot, mf.path);
      const refSrc = existsSync(srcAbs) ? readFileSync(srcAbs, "utf8") : ctx.sourceFile.content;
      const formatted = formatGeneratedTestContent({
        content: res.submission.content,
        language: mf.language,
        repoRoot: opts.repoRoot,
        targetPath: mf.testPath,
        configEol: config.files.eol,
        provenanceHeader: config.policy.provenanceHeader,
        referenceSourceContent: refSrc,
      });

      repairedFiles.push({
        fileId: mf.fileId,
        testPath: res.submission.testPath || mf.testPath,
        content: formatted,
        sha256: sha256Hex(formatted),
        symbolIds: res.submission.symbolIds,
        assumptions: res.submission.assumptions,
        status: "ok",
        usage: {
          requests: 1,
          inputChars: prevPf.content.length + failEntry.output.length,
          outputChars: formatted.length,
          ms: Date.now() - startMs,
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      repairedFiles.push({
        fileId: mf.fileId,
        testPath: mf.testPath,
        content: "",
        sha256: "",
        symbolIds: prevPf.symbolIds,
        assumptions: [],
        status: "generation_failed",
        error: msg,
      });
    }
  }

  const repaired = ProposedSchema.parse({
    schemaVersion: 1,
    runId: manifest.runId,
    headSha: manifest.headSha,
    model: config.model ?? null,
    files: repairedFiles,
  });

  const outPath = path.join(opts.workDir, ARTIFACTS.repaired.dir, "proposed.repaired.json");
  const compatOutPath = path.join(opts.workDir, ARTIFACTS.repaired.dir, "repaired.json");
  mkdirSync(path.dirname(outPath), { recursive: true });
  const serializedRepaired = `${JSON.stringify(repaired, null, 2)}\n`;
  writeFileSync(outPath, serializedRepaired, "utf8");
  writeFileSync(compatOutPath, serializedRepaired, "utf8");

  writeStageStatus(opts.workDir, {
    stage: "repair",
    status: "ok",
    reason: `repaired_${repaired.files.filter((f) => f.status === "ok").length}`,
  });

  if (opts.writeOutputs !== false) {
    writeGitHubOutput({
      repaired_count: repaired.files.filter((f) => f.status === "ok").length,
      status: "ok",
    });
  }

  return repaired;
}
