import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  ARTIFACTS,
  AuthError,
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
import { isSafeRealPathInsideRoot } from "../core/paths";
import { formatGeneratedTestContent } from "../core/text/eol";
import { CopilotSdkTestClient, FakeLlmClient, type LlmTestClient } from "../llm";
import { sanitizeOutput, writeGitHubOutput, writeStageStatus } from "../telemetry";
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

function getErrorRequestsUsed(err: unknown): number {
  const raw =
    err && typeof err === "object" && "requestsUsed" in err
      ? (err as { requestsUsed?: unknown }).requestsUsed
      : undefined;
  return typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? raw : 1;
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
    if (!isSafeRealPathInsideRoot(mf.contextPath, prepareDir, { requireRegularFileIfExists: true })) {
      throw new StageError(
        `Unsafe context path "${mf.contextPath}" for fileId "${mf.fileId}".`,
        EXIT_CODES.POLICY_OR_HASH,
        "generate",
        "path_violation",
      );
    }
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
      const attemptRes = await client.generateTests({
        context: currentCtx,
        maxTestsPerSymbol: config.limits.maxTestsPerSymbol,
        javaTestClassName: mf.testClassName,
        attempt: 1,
        maxRequestsRemaining: Math.max(1, maxRequests - requestsUsed),
      });
      requestsUsed += attemptRes.requestsUsed;
      fileRequests += attemptRes.requestsUsed;
      result = attemptRes;
    } catch (err) {
      if (err instanceof AuthError) {
        throw err;
      }
      const errRequests = getErrorRequestsUsed(err);
      requestsUsed += errRequests;
      fileRequests += errRequests;
      const isTruncated = err instanceof TruncatedOutputError;
      const isZod = err instanceof Error && err.name === "ZodError";
      // F9: Retry once on output truncation or schema validation error with reduced symbol count (ceil(N/2))
      if ((isTruncated || isZod) && requestsUsed < maxRequests) {
        const reducedCount = currentCtx.targets.length > 1 ? Math.max(1, Math.ceil(currentCtx.targets.length / 2)) : 1;
        currentCtx = {
          ...currentCtx,
          targets: currentCtx.targets.slice(0, reducedCount),
          styleSample: currentCtx.targets.length === 1 ? undefined : currentCtx.styleSample,
          referencedSignatures: currentCtx.targets.length === 1 ? [] : currentCtx.referencedSignatures,
        };
        opts.logger?.warn(
          { fileId: mf.fileId, originalTargets: ctx.targets.length, reducedTargets: currentCtx.targets.length },
          `Retrying generation after ${isTruncated ? "output truncation" : "schema validation error"} (F9)`,
        );
        try {
          const retryRes = await client.generateTests({
            context: currentCtx,
            maxTestsPerSymbol: config.limits.maxTestsPerSymbol,
            javaTestClassName: mf.testClassName,
            attempt: 2,
            maxRequestsRemaining: Math.max(1, maxRequests - requestsUsed),
          });
          requestsUsed += retryRes.requestsUsed;
          fileRequests += retryRes.requestsUsed;
          result = retryRes;
        } catch (retryErr) {
          if (retryErr instanceof AuthError) {
            throw retryErr;
          }
          const retryErrRequests = getErrorRequestsUsed(retryErr);
          requestsUsed += retryErrRequests;
          fileRequests += retryErrRequests;
          const retryMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
          const retryStatus =
            retryErr instanceof TruncatedOutputError
              ? "truncated"
              : retryErr instanceof Error && retryErr.name === "ZodError"
                ? "schema_invalid"
                : "generation_failed";
          proposedFiles.push({
            fileId: mf.fileId,
            testPath: mf.testPath,
            content: "",
            sha256: "",
            symbolIds: currentCtx.targets.map((t) => t.symbolId),
            assumptions: [],
            status: retryStatus,
            error: sanitizeOutput(retryMsg, { repoRoot: opts.repoRoot }),
            usage: {
              requests: fileRequests,
              inputChars: currentCtx.sourceFile.content.length,
              outputChars: 0,
              ms: Date.now() - startMs,
            },
          });
          continue;
        }
      } else {
        const errMsg = err instanceof Error ? err.message : String(err);
        const failStatus = isTruncated ? "truncated" : isZod ? "schema_invalid" : "generation_failed";
        proposedFiles.push({
          fileId: mf.fileId,
          testPath: mf.testPath,
          content: "",
          sha256: "",
          symbolIds: currentCtx.targets.map((t) => t.symbolId),
          assumptions: [],
          status: failStatus,
          error: sanitizeOutput(errMsg, { repoRoot: opts.repoRoot }),
          usage: {
            requests: fileRequests,
            inputChars: currentCtx.sourceFile.content.length,
            outputChars: 0,
            ms: Date.now() - startMs,
          },
        });
        continue;
      }
    }

    const sourceAbs = path.join(opts.repoRoot, mf.path);
    const refSourceContent =
      isSafeRealPathInsideRoot(mf.path, opts.repoRoot, { requireRegularFileIfExists: true }) && existsSync(sourceAbs)
        ? readFileSync(sourceAbs, "utf8")
        : ctx.sourceFile.content;
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
