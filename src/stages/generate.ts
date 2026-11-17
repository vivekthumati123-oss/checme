import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  ARTIFACTS,
  EXIT_CODES,
  FileContextSchema,
  ProposedSchema,
  StageError,
  TruncatedOutputError,
  type FileContext,
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

export interface RunGenerateOptions {
  repoRoot: string;
  workDir: string;
  configPath?: string;
  config?: UnitAgentConfig;
  manifestPath?: string;
  manifest?: Manifest;
  llmClient?: LlmTestClient;
  fakeLlmPath?: string;
  dryRun?: boolean;
  logger?: LoggerLike;
  writeOutputs?: boolean;
}

export async function runGenerate(opts: RunGenerateOptions): Promise<Proposed> {
  const prepareDir = opts.manifestPath
    ? path.dirname(path.resolve(opts.manifestPath))
    : path.join(opts.workDir, ARTIFACTS.prepare.dir);
  const config =
    opts.config ??
    loadPrepareConfig({
      repoRoot: opts.repoRoot,
      workDir: opts.workDir,
      configPath: opts.configPath,
      prepareDir,
    });
  const manifest = opts.manifest ?? loadManifest(opts.workDir, opts.manifestPath);

  let client: LlmTestClient | null = null;
  if (!opts.dryRun) {
    if (opts.llmClient) {
      client = opts.llmClient;
    } else if (opts.fakeLlmPath) {
      client = await FakeLlmClient.fromScriptPath(opts.fakeLlmPath);
    } else {
      client = new CopilotSdkTestClient({ model: config.model });
    }
  }

  let requestsUsed = 0;
  const maxRequests = config.limits.maxRequestsPerRun;
  const proposedFiles: ProposedFile[] = [];

  for (const mf of manifest.files) {
    const ctxAbs = path.join(prepareDir, mf.contextPath);
    if (!existsSync(ctxAbs)) {
      throw new StageError(
        `Missing context file "${ctxAbs}" for fileId "${mf.fileId}".`,
        EXIT_CODES.CONFIG_OR_INPUT,
        "generate",
        "missing_context_file",
      );
    }
    const ctx: FileContext = FileContextSchema.parse(JSON.parse(readFileSync(ctxAbs, "utf8")));

    if (opts.dryRun || !client) {
      continue;
    }

    if (requestsUsed >= maxRequests) {
      opts.logger?.warn({ maxRequests, skippedFile: mf.path }, "Request cap reached; marking file over_request_budget");
      proposedFiles.push({
        fileId: mf.fileId,
        testPath: mf.testPath,
        content: "",
        sha256: "",
        symbolIds: mf.symbols.map((s) => s.symbolId),
        assumptions: [],
        status: "over_request_budget",
        error: `Exceeds limits.maxRequestsPerRun (${maxRequests}).`,
      });
      continue;
    }

    const startMs = Date.now();
    let currentCtx = ctx;
    let fileRequests = 0;
    let result;

    try {
      requestsUsed += 1;
      fileRequests += 1;
      result = await client.generateTests({
        context: currentCtx,
        maxTestsPerSymbol: config.limits.maxTestsPerSymbol,
        javaTestClassName: mf.testClassName,
        attempt: 1,
      });
    } catch (err) {
      // F9: Retry once on output truncation with reduced symbol count (ceil(N/2))
      if (err instanceof TruncatedOutputError && requestsUsed < maxRequests) {
        const reducedCount = Math.max(1, Math.ceil(currentCtx.targets.length / 2));
        currentCtx = {
          ...currentCtx,
          targets: currentCtx.targets.slice(0, reducedCount),
          styleSample: currentCtx.targets.length === 1 ? undefined : currentCtx.styleSample,
          referencedSignatures: currentCtx.targets.length === 1 ? [] : currentCtx.referencedSignatures,
        };
        opts.logger?.warn(
          { fileId: mf.fileId, originalTargets: ctx.targets.length, reducedTargets: currentCtx.targets.length },
          "Retrying generation after output truncation (F9)",
        );
        requestsUsed += 1;
        fileRequests += 1;
        try {
          result = await client.generateTests({
            context: currentCtx,
            maxTestsPerSymbol: config.limits.maxTestsPerSymbol,
            javaTestClassName: mf.testClassName,
            attempt: 2,
          });
        } catch (retryErr) {
          if (retryErr instanceof TruncatedOutputError) {
            proposedFiles.push({
              fileId: mf.fileId,
              testPath: mf.testPath,
              content: "",
              sha256: "",
              symbolIds: currentCtx.targets.map((t) => t.symbolId),
              assumptions: [],
              status: "truncated",
              error: retryErr.message,
              usage: {
                requests: fileRequests,
                inputChars: currentCtx.sourceFile.content.length,
                outputChars: 0,
                ms: Date.now() - startMs,
              },
            });
            continue;
          }
          throw retryErr;
        }
      } else if (err instanceof TruncatedOutputError) {
        proposedFiles.push({
          fileId: mf.fileId,
          testPath: mf.testPath,
          content: "",
          sha256: "",
          symbolIds: currentCtx.targets.map((t) => t.symbolId),
          assumptions: [],
          status: "truncated",
          error: err.message,
        });
        continue;
      } else if (err instanceof Error && err.name === "ZodError") {
        proposedFiles.push({
          fileId: mf.fileId,
          testPath: mf.testPath,
          content: "",
          sha256: "",
          symbolIds: currentCtx.targets.map((t) => t.symbolId),
          assumptions: [],
          status: "schema_invalid",
          error: err.message,
        });
        continue;
      } else {
        throw err;
      }
    }

    const sourceAbs = path.join(opts.repoRoot, mf.path);
    const refSourceContent = existsSync(sourceAbs) ? readFileSync(sourceAbs, "utf8") : ctx.sourceFile.content;
    const formattedContent = formatGeneratedTestContent({
      content: result.submission.content,
      language: mf.language,
      repoRoot: opts.repoRoot,
      targetPath: mf.testPath,
      configEol: config.files.eol,
      provenanceHeader: config.policy.provenanceHeader,
      referenceSourceContent: refSourceContent,
    });

    proposedFiles.push({
      fileId: mf.fileId,
      testPath: result.submission.testPath || mf.testPath,
      content: formattedContent,
      sha256: sha256Hex(formattedContent),
      symbolIds: result.submission.symbolIds,
      assumptions: result.submission.assumptions,
      status: "ok",
      usage: {
        requests: fileRequests,
        inputChars: currentCtx.sourceFile.content.length,
        outputChars: formattedContent.length,
        ms: Date.now() - startMs,
      },
    });
  }

  const proposed = ProposedSchema.parse({
    schemaVersion: 1,
    runId: manifest.runId,
    headSha: manifest.headSha,
    model: config.model ?? null,
    files: proposedFiles,
  });

  const outPath = path.join(opts.workDir, ARTIFACTS.proposed.dir, "proposed.json");
  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(proposed, null, 2)}\n`, "utf8");

  writeStageStatus(opts.workDir, {
    stage: "generate",
    status: "ok",
    reason: opts.dryRun ? "dry_run" : `generated_${proposed.files.length}`,
  });

  if (opts.writeOutputs !== false) {
    writeGitHubOutput({
      generated_count: proposed.files.length,
      requests_used: requestsUsed,
      status: "ok",
    });
  }

  return proposed;
}
