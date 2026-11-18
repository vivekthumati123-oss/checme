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
    const systemPrompt = buildSystemPrompt(params.context.language);
    const userPrompt = renderGenerationPrompt({
      context: params.context,
      maxTestsPerSymbol: params.maxTestsPerSymbol,
      javaTestClassName: params.javaTestClassName,
    });
    return this.invokeIsolatedSession({
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
    return this.invokeIsolatedSession({
      systemPrompt,
      userPrompt,
      expectedTestPath: params.context.conventions.testPath,
    });
  }

  private async invokeIsolatedSession(params: {
    systemPrompt: string;
    userPrompt: string;
    expectedTestPath: string;
  }): Promise<LlmInvokeResult> {
    const isolatedHome = mkdtempSync(path.join(os.tmpdir(), "ua-copilot-home-"));
    const isolatedCwd = mkdtempSync(path.join(os.tmpdir(), "ua-copilot-cwd-"));
    let capturedSubmission: SubmitTestsArgs | null = null;
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
          capturedSubmission = SubmitTestsArgsSchema.parse({
            ...args,
            testPath: (args as { testPath?: string })?.testPath || params.expectedTestPath,
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
        if (event.type === "assistant.usage" && typeof event.data?.finishReason === "string") {
          finishReason = event.data.finishReason;
        }
        if (event.type === "session.truncation") {
          sawTruncation = true;
        }
      });

      await session.sendAndWait({ prompt: params.userPrompt }, this.timeoutMs);

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
        requestsUsed: 1,
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
      rmSync(isolatedHome, { recursive: true, force: true });
      rmSync(isolatedCwd, { recursive: true, force: true });
    }
  }
}
