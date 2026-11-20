import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  AuthError,
  SubmitTestsArgsSchema,
  TruncatedOutputError,
  type FileContext,
  type SubmitTestsArgs,
} from "../contracts";
import type { LlmInvokeResult, LlmTestClient } from "./client";
import type { FailurePromptDetail } from "./renderer";

export interface FakeScriptResponse {
  testPath?: string;
  content: string;
  symbolIds?: string[];
  assumptions?: string[];
  simulateTruncation?: boolean;
  simulateAuthError?: boolean;
}

export type FakeLlmHandlerFn = (params: {
  mode: "generate" | "repair";
  context: FileContext;
  attempt: number;
  currentTestContent?: string;
  failure?: FailurePromptDetail;
}) => Promise<FakeScriptResponse> | FakeScriptResponse;

export class FakeLlmClient implements LlmTestClient {
  private readonly handler: FakeLlmHandlerFn;

  private constructor(handler: FakeLlmHandlerFn) {
    this.handler = handler;
  }

  static fromHandler(handler: FakeLlmHandlerFn): FakeLlmClient {
    return new FakeLlmClient(handler);
  }

  static async fromScriptPath(scriptPath: string): Promise<FakeLlmClient> {
    const resolved = path.resolve(scriptPath);
    if (resolved.endsWith(".json")) {
      const table = JSON.parse(readFileSync(resolved, "utf8")) as Record<string, FakeScriptResponse>;
      return new FakeLlmClient(({ mode, context }) => {
        const key = `${mode}:${context.sourceFile.path}`;
        const hit = table[key] ?? table[context.sourceFile.path] ?? table[context.fileId] ?? table["*"];
        if (!hit) {
          throw new Error(`Fake JSON script "${resolved}" has no entry for "${key}" or "${context.sourceFile.path}".`);
        }
        return hit;
      });
    }

    const mod = (await import(`${pathToFileURL(resolved).href}?t=${Date.now()}`)) as {
      default?: FakeLlmHandlerFn | Record<string, FakeScriptResponse>;
      generateTests?: FakeLlmHandlerFn;
    };
    const candidate = mod.generateTests ?? mod.default;
    if (typeof candidate === "function") {
      return new FakeLlmClient(candidate);
    }
    if (candidate && typeof candidate === "object") {
      const table = candidate;
      return new FakeLlmClient(({ mode, context }) => {
        const key = `${mode}:${context.sourceFile.path}`;
        const hit = table[key] ?? table[context.sourceFile.path] ?? table["*"];
        if (!hit) {
          throw new Error(`Fake script "${resolved}" returned no match for "${context.sourceFile.path}".`);
        }
        return hit;
      });
    }
    throw new Error(`Fake LLM script "${resolved}" must export a default function or response map.`);
  }

  async generateTests(params: {
    context: FileContext;
    maxTestsPerSymbol: number;
    javaTestClassName?: string;
    attempt: number;
  }): Promise<LlmInvokeResult> {
    return this.runHandler({
      mode: "generate",
      context: params.context,
      attempt: params.attempt,
    });
  }

  async repairTests(params: {
    context: FileContext;
    currentTestContent: string;
    failure: FailurePromptDetail;
    attempt: number;
  }): Promise<LlmInvokeResult> {
    return this.runHandler({
      mode: "repair",
      context: params.context,
      attempt: params.attempt,
      currentTestContent: params.currentTestContent,
      failure: params.failure,
    });
  }

  private async runHandler(input: {
    mode: "generate" | "repair";
    context: FileContext;
    attempt: number;
    currentTestContent?: string;
    failure?: FailurePromptDetail;
  }): Promise<LlmInvokeResult> {
    const resp = await this.handler(input);
    if (resp.simulateAuthError) {
      throw new AuthError("Simulated auth failure (401)", "simulated_auth_error");
    }
    if (resp.simulateTruncation) {
      throw new TruncatedOutputError("Simulated output truncation (finishReason=length)", "length");
    }
    const submission: SubmitTestsArgs = SubmitTestsArgsSchema.parse({
      testPath: resp.testPath ?? input.context.conventions.testPath,
      content: resp.content,
      symbolIds: resp.symbolIds ?? input.context.targets.map((t) => t.symbolId),
      assumptions: resp.assumptions ?? [],
    });
    return {
      submission,
      finishReason: "tool_calls",
      truncated: false,
      requestsUsed: 1,
    };
  }
}
