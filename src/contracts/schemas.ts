import { z } from "zod";

import type { UnitAgentConfig } from "./config";

export const LanguageSchema = z.enum(["javascript", "python", "java"]);
export const FrameworkNameSchema = z.enum(["jest", "vitest", "pytest", "junit5"]);
export type FrameworkName = z.infer<typeof FrameworkNameSchema>;

export const SkipReasonSchema = z.enum([
  "over_file_cap",
  "over_symbol_cap",
  "not_exported",
  "unsupported_language",
  "unsupported_framework",
  "ambiguous_build_tool",
  "baseline_red",
  "never_send",
  "secret_like_content",
  "already_has_agent_tests",
  "too_large",
  "parse_errors",
  "no_untested_symbols",
  "install_failed",
  "toolchain_mismatch",
  "unsupported_tool_version",
  "wrapper_unavailable",
]);
export type SkipReason = z.infer<typeof SkipReasonSchema>;

export const GateNameSchema = z.enum(["preflight", "path", "static", "format", "snapshot", "run", "flake", "coverage"]);
export type GateName = z.infer<typeof GateNameSchema>;

export const FailureReasonSchema = z.enum([
  "compile_error",
  "import_error",
  "generated_test_failure",
  "lint_error",
  "policy_violation",
  "path_violation",
  "flaky",
  "timeout",
  "no_coverage_gain",
  "environment_error",
  "tool_missing",
  "sandbox_copy_failed",
  "ambiguous_build_tool",
  "wrapper_unavailable",
  "toolchain_mismatch",
  "unsupported_tool_version",
  "unsupported_framework",
  "draft_missing",
]);
export type FailureReason = z.infer<typeof FailureReasonSchema>;

export const ENVIRONMENT_FAILURE_REASONS: ReadonlySet<FailureReason> = new Set<FailureReason>([
  "environment_error",
  "tool_missing",
  "sandbox_copy_failed",
  "ambiguous_build_tool",
  "wrapper_unavailable",
  "toolchain_mismatch",
  "unsupported_tool_version",
  "unsupported_framework",
]);

export const ToolSourceSchema = z.enum(["config", "version-file", "runner-default", "wrapper", "system", "detected"]);
export type ToolSource = z.infer<typeof ToolSourceSchema>;

export const ToolInfoSchema = z
  .object({
    version: z.string().nullable(),
    source: ToolSourceSchema,
    detail: z.string().optional(),
  })
  .strict();
export type ToolInfo = z.infer<typeof ToolInfoSchema>;

export const LanguageToolVersionsSchema = z
  .object({
    runtime: ToolInfoSchema.optional(),
    packageTool: ToolInfoSchema.optional(),
    buildTool: ToolInfoSchema.optional(),
    framework: z
      .object({
        name: z.string(),
        version: z.string().nullable(),
        supported: z.boolean(),
      })
      .strict()
      .optional(),
    coverageTool: ToolInfoSchema.optional(),
    tier: z.enum(["tested", "best-effort"]),
  })
  .strict();
export type LanguageToolVersions = z.infer<typeof LanguageToolVersionsSchema>;

export const ToolVersionsSchema = z
  .object({
    agentNode: z.string(),
    languages: z
      .object({
        javascript: LanguageToolVersionsSchema.optional(),
        python: LanguageToolVersionsSchema.optional(),
        java: LanguageToolVersionsSchema.optional(),
      })
      .strict(),
    warnings: z.array(z.string()),
  })
  .strict();
export type ToolVersions = z.infer<typeof ToolVersionsSchema>;

export const ToolchainEntrySchema = z
  .object({
    version: z.string().optional(),
    file: z.string().optional(),
    source: z.enum(["config", "version-file", "runner-default"]),
    distribution: z.string().optional(),
  })
  .strict();
export type ToolchainEntry = z.infer<typeof ToolchainEntrySchema>;

export const PlanOutputSchema = z
  .object({
    schemaVersion: z.literal(1),
    languages: z.array(LanguageSchema),
    toolchains: z
      .object({
        node: ToolchainEntrySchema.optional(),
        python: ToolchainEntrySchema.optional(),
        java: ToolchainEntrySchema.optional(),
      })
      .strict(),
    frameworks: z
      .object({
        javascript: z.object({ detected: z.string().nullable(), supported: z.boolean() }).optional(),
        python: z.object({ detected: z.string().nullable(), supported: z.boolean() }).optional(),
        java: z
          .object({
            detected: z.string().nullable(),
            supported: z.boolean(),
            buildTool: z.enum(["maven", "gradle"]).optional(),
          })
          .optional(),
      })
      .strict(),
    skipped: z.array(
      z
        .object({
          language: z.string(),
          reason: SkipReasonSchema,
          found: z.string().optional(),
        })
        .strict(),
    ),
    warnings: z.array(z.string()),
  })
  .strict();
export type PlanOutput = z.infer<typeof PlanOutputSchema>;

export const ManifestSymbolSchema = z
  .object({
    symbolId: z.string().min(1),
    qualifiedName: z.string().min(1),
    kind: z.enum(["function", "method", "constructor"]),
    signature: z.string(),
    range: z.object({ startLine: z.number().int().min(1), endLine: z.number().int().min(1) }).strict(),
    executableLines: z.number().int().min(0),
    estimated: z.boolean().optional(),
    coveredLines: z.number().int().min(0),
    coveragePct: z.number().min(0).max(100),
    changedLines: z.array(z.number().int().min(1)),
    complexity: z.number().int().min(1),
    score: z.number(),
  })
  .strict();
export type ManifestSymbol = z.infer<typeof ManifestSymbolSchema>;

export const ManifestFileSchema = z
  .object({
    fileId: z.string().min(1),
    language: LanguageSchema,
    path: z.string().min(1),
    testPath: z.string().min(1),
    importHint: z.string(),
    contextPath: z.string().min(1),
    sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
    testClassName: z
      .string()
      .regex(/^[A-Za-z0-9_.$]+$/)
      .optional(),
    symbols: z.array(ManifestSymbolSchema).min(1),
  })
  .strict();
export type ManifestFile = z.infer<typeof ManifestFileSchema>;

export const ManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    runId: z.string().min(1),
    repo: z.string().min(1),
    pr: z.number().int().min(0),
    baseSha: z.string().min(1),
    headSha: z.string().min(1),
    createdAt: z.string().min(1),
    baseline: z
      .object({
        status: z.enum(["green", "red", "no_coverage"]),
        perLanguage: z.record(
          z.string(),
          z
            .object({
              status: z.enum(["green", "red", "no_coverage"]),
              patchCoveragePct: z.number().nullable(),
            })
            .strict(),
        ),
        patchCoveragePct: z.number().nullable(),
      })
      .strict(),
    files: z.array(ManifestFileSchema),
    warnings: z.array(z.string()),
    skipped: z.array(
      z
        .object({
          path: z.string().min(1),
          reason: SkipReasonSchema,
          detail: z.string().optional(),
        })
        .strict(),
    ),
  })
  .strict();
export type Manifest = z.infer<typeof ManifestSchema>;

export const FileContextSchema = z
  .object({
    schemaVersion: z.literal(1),
    fileId: z.string().min(1),
    language: LanguageSchema,
    framework: FrameworkNameSchema,
    frameworkVersion: z.string().nullable().optional(),
    mockingLibs: z.array(z.string()),
    conventions: z
      .object({
        testNaming: z.string(),
        assertionStyle: z.string(),
        importHint: z.string(),
        testPath: z.string(),
      })
      .strict(),
    sourceFile: z
      .object({
        path: z.string(),
        content: z.string(),
        truncated: z.boolean(),
      })
      .strict(),
    targets: z.array(
      z
        .object({
          symbolId: z.string(),
          qualifiedName: z.string(),
          signature: z.string(),
          startLine: z.number().int().min(1),
          endLine: z.number().int().min(1),
        })
        .strict(),
    ),
    classSkeleton: z.string().optional(),
    referencedSignatures: z.array(z.string()),
    styleSample: z.object({ path: z.string(), content: z.string() }).strict().optional(),
    fixtures: z.array(z.string()).optional(),
  })
  .strict();
export type FileContext = z.infer<typeof FileContextSchema>;

export const SubmitTestsArgsSchema = z
  .object({
    testPath: z.string().min(1),
    content: z.string().min(1).max(61_440),
    symbolIds: z.array(z.string()),
    assumptions: z.array(z.string().max(200)).max(8),
  })
  .strict();
export type SubmitTestsArgs = z.infer<typeof SubmitTestsArgsSchema>;

export const ProposedFileSchema = z
  .object({
    fileId: z.string().min(1),
    testPath: z.string().min(1),
    content: z.string(),
    sha256: z.string(),
    symbolIds: z.array(z.string()),
    assumptions: z.array(z.string().max(200)).max(8),
    status: z.enum(["ok", "generation_failed", "schema_invalid", "truncated", "over_request_budget"]),
    error: z.string().optional(),
    usage: z
      .object({
        requests: z.number().int().min(0),
        inputChars: z.number().int().min(0),
        outputChars: z.number().int().min(0),
        ms: z.number().min(0),
      })
      .strict()
      .optional(),
  })
  .strict();
export type ProposedFile = z.infer<typeof ProposedFileSchema>;

export const ProposedSchema = z
  .object({
    schemaVersion: z.literal(1),
    runId: z.string().min(1),
    headSha: z.string().min(1),
    model: z.string().nullable(),
    files: z.array(ProposedFileSchema),
  })
  .strict();
export type Proposed = z.infer<typeof ProposedSchema>;

export const SnapshotSchema = z
  .object({
    schemaVersion: z.literal(1),
    attempt: z.number().int().min(1),
    headSha: z.string().min(1),
    files: z.array(
      z
        .object({
          fileId: z.string().min(1),
          testPath: z.string().min(1),
          sha256: z.string().regex(/^[a-f0-9]{64}$/),
          bytes: z.number().int().min(0),
        })
        .strict(),
    ),
  })
  .strict();
export type Snapshot = z.infer<typeof SnapshotSchema>;

export const GateResultSchema = z
  .object({
    gate: GateNameSchema,
    status: z.enum(["pass", "fail", "skipped"]),
    detail: z.string().optional(),
  })
  .strict();

export const TestCaseResultSchema = z
  .object({
    name: z.string(),
    status: z.enum(["pass", "fail", "pruned", "flaky"]),
  })
  .strict();

export const ValidatedFileReportSchema = z
  .object({
    fileId: z.string().min(1),
    testPath: z.string().min(1),
    outcome: z.enum(["accepted", "accepted_pruned", "needs_repair", "rejected", "environment_error"]),
    reason: FailureReasonSchema.optional(),
    logPath: z.string().optional(),
    gates: z.array(GateResultSchema),
    tests: z.array(TestCaseResultSchema),
    sha256: z.string().nullable(),
    prunedTests: z.array(z.string()).optional(),
    finalSha256: z.string().optional(),
    coverage: z
      .object({
        symbols: z.array(
          z
            .object({
              symbolId: z.string(),
              beforePct: z.number(),
              afterPct: z.number(),
            })
            .strict(),
        ),
        gainedLines: z.number().int().min(0),
      })
      .strict()
      .optional(),
  })
  .strict();
export type ValidatedFileReport = z.infer<typeof ValidatedFileReportSchema>;

export const ValidationReportSchema = z
  .object({
    schemaVersion: z.literal(1),
    attempt: z.number().int().min(1),
    workspace: z.enum(["copy", "inplace"]),
    environment: z
      .object({
        command: z.string(),
        outputTail: z.string(),
        reason: FailureReasonSchema,
      })
      .strict()
      .nullable(),
    files: z.array(ValidatedFileReportSchema),
    patchCoverage: z
      .object({
        beforePct: z.number().nullable(),
        projectedPct: z.number().nullable(),
      })
      .strict(),
    toolVersions: ToolVersionsSchema,
    notes: z.array(z.string()),
  })
  .strict();
export type ValidationReport = z.infer<typeof ValidationReportSchema>;

export const FailuresSchema = z
  .object({
    schemaVersion: z.literal(1),
    files: z.array(
      z
        .object({
          fileId: z.string(),
          failingTests: z.array(z.string()),
          gate: GateNameSchema,
          reason: z.enum(["compile_error", "import_error", "generated_test_failure"]),
          output: z.string().max(4000),
        })
        .strict(),
    ),
  })
  .strict();
export type Failures = z.infer<typeof FailuresSchema>;

export const FinalSchema = z
  .object({
    schemaVersion: z.literal(1),
    runId: z.string().min(1),
    repo: z.string().min(1),
    pr: z.number().int().min(0),
    headSha: z.string().min(1),
    headRef: z.string().min(1),
    mode: z.enum(["report", "propose"]),
    files: z.array(
      z
        .object({
          path: z.string().min(1),
          sha256: z.string().regex(/^[a-f0-9]{64}$/),
          symbolIds: z.array(z.string()),
          testCount: z.number().int().min(0),
          assumptions: z.array(z.string()),
        })
        .strict(),
    ),
    patchCoverage: z
      .object({
        beforePct: z.number().nullable(),
        projectedPct: z.number().nullable(),
        targetPct: z.number().min(0).max(100),
      })
      .strict(),
    toolVersions: ToolVersionsSchema,
    notes: z.array(z.string()),
    rejected: z.array(z.object({ testPath: z.string(), reason: z.string() }).strict()),
  })
  .strict();
export type Final = z.infer<typeof FinalSchema>;

export const StageStatusSchema = z
  .object({
    stage: z.enum(["prepare", "generate", "validate1", "repair", "validate2", "publish", "commit"]),
    status: z.enum(["ok", "skipped", "soft_fail", "error"]),
    reason: z.string().optional(),
    code: z.union([z.literal(20), z.literal(30), z.literal(40), z.literal(50), z.literal(60)]).optional(),
  })
  .strict();
export type StageStatus = z.infer<typeof StageStatusSchema>;

export const MetricsSchema = z
  .object({
    runId: z.string(),
    repo: z.string(),
    pr: z.number().int(),
    sha: z.string(),
    mode: z.string(),
    agentVersion: z.string(),
    durationMs: z.record(z.string(), z.number()),
    symbols: z.object({ detected: z.number().int(), selected: z.number().int(), covered: z.number().int() }).strict(),
    files: z
      .object({
        selected: z.number().int(),
        generated: z.number().int(),
        accepted: z.number().int(),
        acceptedPruned: z.number().int(),
        rejected: z.number().int(),
      })
      .strict(),
    tests: z
      .object({
        generated: z.number().int(),
        kept: z.number().int(),
        pruned: z.number().int(),
        flakyRejected: z.number().int(),
      })
      .strict(),
    repair: z.object({ attempted: z.number().int(), succeeded: z.number().int() }).strict(),
    coverage: z.object({ patchBeforePct: z.number().nullable(), patchProjectedPct: z.number().nullable() }).strict(),
    llm: z
      .object({
        requests: z.number().int(),
        retries: z.number().int(),
        inputChars: z.number().int(),
        outputChars: z.number().int(),
        failures: z.number().int(),
        truncated: z.number().int(),
        budgetStops: z.number().int(),
      })
      .strict(),
    reasons: z.record(z.string(), z.number().int()),
    toolVersions: ToolVersionsSchema,
    outcome: z.enum(["no_work", "report_posted", "awaiting_approval", "committed", "soft_fail", "error"]),
  })
  .strict();
export type Metrics = z.infer<typeof MetricsSchema>;

export const LocalDetectSummarySchema = z
  .object({
    schemaVersion: z.literal(1),
    scope: z.enum(["staged", "worktree", "branch", "files"]),
    baseRef: z.string().nullable(),
    baseline: z
      .object({
        status: z.enum(["green", "red", "no_coverage", "skipped"]),
        reusedCoverage: z.boolean(),
      })
      .strict(),
    files: z.array(
      z
        .object({
          fileId: z.string(),
          path: z.string(),
          testPath: z.string(),
          stagedPath: z.string(),
          contextPath: z.string(),
          symbols: z.array(
            z
              .object({
                symbolId: z.string(),
                qualifiedName: z.string(),
                coveragePct: z.number(),
                changedLines: z.number().int(),
              })
              .strict(),
          ),
        })
        .strict(),
    ),
    skipped: z.array(z.object({ path: z.string(), reason: z.string() }).strict()),
    next: z.string(),
    truncated: z.boolean(),
  })
  .strict();
export type LocalDetectSummary = z.infer<typeof LocalDetectSummarySchema>;

export const LocalValidateSummarySchema = z
  .object({
    schemaVersion: z.literal(1),
    attempt: z.number().int().min(1),
    maxAttempts: z.number().int().min(1),
    final: z.boolean(),
    environmentError: z
      .object({
        command: z.string(),
        outputTail: z.string().max(1500),
      })
      .strict()
      .nullable(),
    files: z.array(
      z
        .object({
          fileId: z.string(),
          testPath: z.string(),
          outcome: z.enum(["accepted", "accepted_pruned", "needs_repair", "rejected", "environment_error"]),
          reason: FailureReasonSchema.optional(),
          failingTests: z.array(z.string()),
          logPath: z.string().optional(),
          gainedLines: z.number().int().optional(),
          outputTail: z.string().max(1500).optional(),
        })
        .strict(),
    ),
    patchCoverage: z
      .object({
        beforePct: z.number().nullable(),
        projectedPct: z.number().nullable(),
      })
      .strict(),
    next: z.string(),
    truncated: z.boolean(),
  })
  .strict();
export type LocalValidateSummary = z.infer<typeof LocalValidateSummarySchema>;

export const LocalApplySummarySchema = z
  .object({
    schemaVersion: z.literal(1),
    dryRun: z.boolean(),
    written: z.array(z.object({ path: z.string(), sha256: z.string() }).strict()),
    refused: z.array(
      z
        .object({
          path: z.string(),
          reason: z.enum(["hash_mismatch", "source_changed", "target_exists", "policy", "not_accepted"]),
        })
        .strict(),
    ),
    staged: z.boolean(),
    next: z.string(),
  })
  .strict();
export type LocalApplySummary = z.infer<typeof LocalApplySummarySchema>;

export const LocalDoctorSummarySchema = z
  .object({
    schemaVersion: z.literal(1),
    ok: z.boolean(),
    toolVersions: ToolVersionsSchema.nullable(),
    checks: z.array(
      z
        .object({
          name: z.string(),
          status: z.enum(["pass", "warn", "fail"]),
          detail: z.string(),
          fix: z.string().optional(),
        })
        .strict(),
    ),
  })
  .strict();
export type LocalDoctorSummary = z.infer<typeof LocalDoctorSummarySchema>;

export const LocalStatusSummarySchema = z
  .object({
    schemaVersion: z.literal(1),
    stage: z.enum(["none", "detected", "drafted", "validated", "applied"]),
    attempt: z.number().int().nullable(),
    files: z.array(
      z
        .object({
          fileId: z.string(),
          testPath: z.string(),
          outcome: z.string().optional(),
        })
        .strict(),
    ),
    stagedFilesInGitStatus: z.array(z.string()),
    next: z.string(),
  })
  .strict();
export type LocalStatusSummary = z.infer<typeof LocalStatusSummarySchema>;

export type DiffSource =
  | { kind: "git-range"; base: string; head: string }
  | {
      kind: "local";
      scope: "staged" | "worktree" | "branch" | "files";
      baseRef?: string;
      files?: string[];
      symbols?: string[];
      includeCovered?: boolean;
    };

export interface LoggerLike {
  info(obj: Record<string, unknown>, msg?: string): void;
  warn(obj: Record<string, unknown>, msg?: string): void;
  error(obj: Record<string, unknown>, msg?: string): void;
  debug(obj: Record<string, unknown>, msg?: string): void;
  child(bindings: Record<string, unknown>): LoggerLike;
}

export interface GitHubClientLike {
  getPullRequest(
    owner: string,
    repo: string,
    pr: number,
  ): Promise<{
    headSha: string;
    headRef: string;
    headRepoFullName: string;
    baseRepoFullName: string;
    draft: boolean;
    authorLogin: string;
    authorType: string;
    labels: string[];
    headCommitMessage: string;
  }>;
  listIssueComments(
    owner: string,
    repo: string,
    pr: number,
  ): Promise<Array<{ id: number; body: string; userLogin: string }>>;
  createIssueComment(owner: string, repo: string, pr: number, body: string): Promise<{ id: number }>;
  updateIssueComment(owner: string, repo: string, commentId: number, body: string): Promise<void>;
  getEnvironment(
    owner: string,
    repo: string,
    environmentName: string,
  ): Promise<{
    exists: boolean;
    status: number;
    hasRequiredReviewers: boolean;
    preventSelfReview?: boolean;
  }>;
  getRunApprovals(owner: string, repo: string, runId: number): Promise<string[]>;
  createCommitOnBranch(params: {
    repositoryNameWithOwner: string;
    branchName: string;
    expectedHeadOid: string;
    headline: string;
    body: string;
    additions: Array<{ path: string; contentsBase64: string }>;
  }): Promise<{ oid: string }>;
}

export interface ExecutionContext {
  surface: "ci" | "local";
  repoRoot: string;
  workDir: string;
  config: UnitAgentConfig;
  now: () => Date;
  logger: LoggerLike;
  github?: GitHubClientLike;
}
