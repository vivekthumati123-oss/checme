import { CopilotClient, defineTool } from "@github/copilot-sdk";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  AuthError,
  SubmitTestsArgsSchema,
  TruncatedOutputError,
  type FileContext,
  type SubmitTestsArgs,
} from "../contracts";
import { cleanRepoRelative, normalizeSlashes } from "../core/paths";
import { isAuthErrorMessage } from "./auth-errors";
import type { FailurePromptDetail } from "./renderer";
import { buildSystemPrompt, renderGenerationPrompt, renderRepairPrompt } from "./renderer";

export interface LlmInvokeResult {
  submission: SubmitTestsArgs;
  finishReason?: string;
  truncated?: boolean;
  requestsUsed: number;
}

export interface LlmTestClient {
  generateTests(params: {
    context: FileContext;
    maxTestsPerSymbol: number;
    javaTestClassName?: string;
    attempt: number;
  }): Promise<LlmInvokeResult>;

  repairTests(params: {
    context: FileContext;
    currentTestContent: string;
    failure: FailurePromptDetail;
    attempt: number;
  }): Promise<LlmInvokeResult>;
}

export interface CopilotSdkClientOptions {
  model?: string;
  gitHubToken?: string;
  maxOutputTokens?: number;
  timeoutMs?: number;
}

export { isAuthErrorMessage };

const TRANSIENT_LLM_ERROR_RE =
  /\b(?:429|500|502|503|504)\b|rate[\s_-]*limit|too many requests|timed?\s*out|econnreset|etimedout|epipe|socket hang up|service unavailable/i;

function isTransientLlmError(err: unknown): boolean {
  if (err instanceof AuthError || err instanceof TruncatedOutputError) return false;
  const msg = err instanceof Error ? err.message : String(err);
  if (isAuthErrorMessage(msg)) return false;
  return TRANSIENT_LLM_ERROR_RE.test(msg);
}

function safeRemoveTempDir(dirPath: string): void {
  try {
    rmSync(dirPath, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  } catch {
    // Best-effort temp cleanup
  }
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class CopilotSdkTestClient implements LlmTestClient {
  private readonly model?: string;
  private readonly gitHubToken: string;
  private readonly timeoutMs: number;

  constructor(opts: CopilotSdkClientOptions = {}) {
    const token = opts.gitHubToken ?? process.env.COPILOT_GITHUB_TOKEN ?? "";
    if (!token.trim()) {
      throw new AuthError(
        "COPILOT_GITHUB_TOKEN is required to run Unit Agent generation without --fake-llm or --dry-run.",
        "missing_copilot_token",
      );
    }
    this.gitHubToken = token.trim();
    this.model = opts.model;
    this.timeoutMs = opts.timeoutMs ?? 120_000;
  }

  async generateTests(params: {
    context: FileContext;
    maxTestsPerSymbol: number;
    javaTestClassName?: string;
    attempt: number;
  }): Promise<LlmInvokeResult> {
    const systemPrompt = buildSystemPrompt(params.context.language, params.maxTestsPerSymbol);
    const userPrompt = renderGenerationPrompt({
      context: params.context,
      maxTestsPerSymbol: params.maxTestsPerSymbol,
      javaTestClassName: params.javaTestClassName,
    });
    return this.invokeWithRetry({
      systemPrompt,
      userPrompt,
      expectedTestPath: params.context.conventions.testPath,
    });
  }

  async repairTests(params: {
    context: FileContext;
    currentTestContent: string;
    failure: FailurePromptDetail;
    attempt: number;
  }): Promise<LlmInvokeResult> {
    const systemPrompt = buildSystemPrompt(params.context.language);
    const userPrompt = renderRepairPrompt({
      context: params.context,
      currentTestContent: params.currentTestContent,
      failure: params.failure,
    });
    return this.invokeWithRetry({
      systemPrompt,
      userPrompt,
      expectedTestPath: params.context.conventions.testPath,
    });
  }

  private async invokeWithRetry(params: {
    systemPrompt: string;
    userPrompt: string;
    expectedTestPath: string;
  }): Promise<LlmInvokeResult> {
    const maxAttempts = 3;
    let totalRequestsUsed = 0;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const usageCounter = { count: 0 };
      try {
        const res = await this.invokeIsolatedSessionOnce(params, usageCounter);
        return {
          ...res,
          requestsUsed: totalRequestsUsed + res.requestsUsed,
        };
      } catch (err) {
        totalRequestsUsed += Math.max(1, usageCounter.count);
        if (attempt < maxAttempts && isTransientLlmError(err)) {
          const backoffMs = Math.min(5000, 1000 * attempt + Math.floor(Math.random() * 250));
          await sleepMs(backoffMs);
          continue;
        }
        throw err;
      }
    }
    throw new Error("Exhausted retry attempts invoking Copilot SDK session.");
  }

  private async invokeIsolatedSessionOnce(
    params: {
      systemPrompt: string;
      userPrompt: string;
      expectedTestPath: string;
    },
    usageCounter: { count: number },
  ): Promise<LlmInvokeResult> {
    const isolatedHome = mkdtempSync(path.join(os.tmpdir(), "ua-copilot-home-"));
    const isolatedCwd = mkdtempSync(path.join(os.tmpdir(), "ua-copilot-cwd-"));
    let capturedSubmission: SubmitTestsArgs | null = null;
    let submissionPathMismatch: string | null = null;
    let finishReason: string | undefined;
    let sawTruncation = false;

    const client = new CopilotClient({
      mode: "empty",
      baseDirectory: isolatedHome,
      workingDirectory: isolatedCwd,
      gitHubToken: this.gitHubToken,
      useLoggedInUser: false,
      logLevel: "error",
    });

    try {
      const submitTool = defineTool("submit_tests", {
        description: "Submit the generated unit test file content and target symbol IDs.",
        parameters: SubmitTestsArgsSchema,
        isTerminal: true,
        skipPermission: true,
        handler: async (args) => {
          const rawTestPath =
            typeof (args as { testPath?: unknown })?.testPath === "string"
              ? (args as { testPath: string }).testPath
              : "";
          const normSubmitted = rawTestPath ? cleanRepoRelative(normalizeSlashes(rawTestPath)) : "";
          const normExpected = cleanRepoRelative(normalizeSlashes(params.expectedTestPath));
          if (normSubmitted && normSubmitted !== normExpected) {
            submissionPathMismatch = `Model submitted unexpected testPath "${rawTestPath}" (expected "${params.expectedTestPath}").`;
            return { textResultForLlm: submissionPathMismatch, resultType: "failure" };
          }
          capturedSubmission = SubmitTestsArgsSchema.parse({
            ...args,
            testPath: params.expectedTestPath,
          });
          return { textResultForLlm: "accepted", resultType: "success" };
        },
      });

      const session = await client.createSession({
        model: this.model,
        systemMessage: { mode: "replace", content: params.systemPrompt },
        tools: [submitTool],
        availableTools: ["submit_tests"],
        excludedTools: ["builtin:*", "mcp:*"],
        onPermissionRequest: () => ({ kind: "denied-by-rules", rules: [] }),
        skipCustomInstructions: true,
        customAgentsLocalOnly: true,
      });

      session.on((event) => {
        if (event.type === "assistant.usage") {
          usageCounter.count += 1;
          if (typeof event.data?.finishReason === "string") {
            finishReason = event.data.finishReason;
          }
        }
        if (event.type === "session.truncation") {
          sawTruncation = true;
        }
      });

      await session.sendAndWait({ prompt: params.userPrompt }, this.timeoutMs);

      if (submissionPathMismatch) {
        throw new Error(submissionPathMismatch);
      }

      if ((sawTruncation || finishReason === "length") && !capturedSubmission) {
        throw new TruncatedOutputError(
          "Model output truncated before submit_tests completed.",
          finishReason ?? "truncation",
        );
      }

      if (!capturedSubmission) {
        throw new Error(`Model did not invoke submit_tests tool (finishReason=${finishReason ?? "unknown"}).`);
      }

      return {
        submission: capturedSubmission,
        finishReason,
        truncated: sawTruncation || finishReason === "length",
        requestsUsed: Math.max(1, usageCounter.count),
      };
    } catch (err) {
      if (err instanceof TruncatedOutputError || err instanceof AuthError) {
        throw err;
      }
      const msg = err instanceof Error ? err.message : String(err);
      if (isAuthErrorMessage(msg)) {
        throw new AuthError(`Copilot SDK authentication/authorization failed: ${msg}`, "sdk_auth_failed");
      }
      throw err;
    } finally {
      await client.stop().catch(() => undefined);
      safeRemoveTempDir(isolatedHome);
      safeRemoveTempDir(isolatedCwd);
    }
  }
}
