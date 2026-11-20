import { z } from "zod";

import { isArgvOnly, parseArgvTokens } from "../config/argv";

const NO_TRAVERSAL_MSG = "path must not contain '..' traversal segments or absolute/UNC/drive/NUL paths";
const isSafeRelativePath = (value: string): boolean => {
  if (value.includes("\0")) return false;
  const slash = value.replace(/\\/g, "/");
  if (slash.startsWith("/") || /^[A-Za-z]:/.test(slash) || /^\\\\/.test(value)) return false;
  return !slash.split("/").includes("..");
};

const SafePath = z.string().min(1).refine(isSafeRelativePath, NO_TRAVERSAL_MSG);

const ArgvCmd = z
  .string()
  .refine(
    isArgvOnly,
    "no shell operators (&&, ||, |, ;, >, <, backticks, $()). Put multi-step logic in an npm script or a script file.",
  );

const Cmd = ArgvCmd.refine((s) => {
  try {
    return parseArgvTokens(s).every((t) => !t.includes("{files}"));
  } catch {
    return false;
  }
}, "must not contain {files} token");

const FilesCmd = ArgvCmd.refine((s) => {
  try {
    const tokens = parseArgvTokens(s);
    return (
      tokens[0] !== "{files}" &&
      tokens.slice(1).includes("{files}") &&
      tokens.every((t) => t === "{files}" || !t.includes("{files}"))
    );
  } catch {
    return false;
  }
}, "must contain standalone {files} token after executable");

export const FrameworkEnum = z.enum(["auto", "jest", "vitest", "pytest", "junit5"], {
  error:
    "Unsupported framework. Supported frameworks: auto, jest, vitest, pytest, junit5 (see docs/supported-versions.md).",
});

export const LanguageConfigSchema = z
  .object({
    enabled: z.boolean().default(true),
    framework: FrameworkEnum.default("auto"),
    workingDirectory: SafePath.default("."),
    toolchain: z.string().min(1).optional(),
    toolchainFile: SafePath.optional(),
    installCommand: Cmd.optional(),
    testCommand: Cmd,
    coverageFile: SafePath,
    coverageFormat: z.enum(["lcov", "cobertura", "jacoco"]),
    sourceGlobs: z.array(SafePath).min(1),
    testPathPatterns: z.array(SafePath).min(1),
    generatedSuffix: z
      .string()
      .min(1)
      .regex(/^[A-Za-z0-9._-]+$/, "must contain only letters, digits, dots, underscores, or hyphens")
      .refine((v) => !v.includes(".."), "must not contain '..'")
      .default(".unit-agent"),
    formatCommand: FilesCmd.optional(),
    lintCommand: FilesCmd.optional(),
  })
  .strict();

export const PythonConfigSchema = LanguageConfigSchema.extend({
  pythonPath: z.array(SafePath).optional(),
}).strict();

export const JavaConfigSchema = LanguageConfigSchema.extend({
  buildTool: z.enum(["auto", "maven", "gradle"]).default("auto"),
  toolPreference: z
    .array(z.enum(["wrapper", "system"]))
    .min(1)
    .default(["wrapper", "system"]),
  strictWrapper: z.boolean().default(false),
  distribution: z.string().min(1).default("temurin"),
  testResultsDir: SafePath.optional(),
  coverage: z
    .object({
      mode: z.enum(["auto", "repo", "inject", "off"]).default("auto"),
      jacocoVersion: z.string().min(1).optional(),
    })
    .strict()
    .prefault({}),
}).strict();

export const LimitsSchema = z
  .object({
    maxSymbolsPerPr: z.number().int().min(1).max(30).default(10),
    maxFilesPerPr: z.number().int().min(1).max(15).default(6),
    maxTestsPerSymbol: z.number().int().min(1).max(12).default(6),
    maxContextChars: z.number().int().min(1000).default(60000),
    minExecutableLines: z.number().int().min(0).default(2),
    runTimeoutMinutes: z.number().int().min(1).default(25),
    repairAttempts: z.number().int().min(0).max(1).default(1),
    flakeRuns: z.number().int().min(1).max(5).default(3),
    perRunTestTimeoutSeconds: z.number().int().min(1).default(180),
    maxRequestsPerRun: z.number().int().min(1).max(60).default(20),
  })
  .strict()
  .prefault({});

export const BaselineConfigSchema = z
  .object({
    mode: z.enum(["run", "skip"]).default("run"),
    timeoutMinutes: z.number().int().min(1).max(60).default(20),
  })
  .strict()
  .prefault({});

export const TargetsConfigSchema = z
  .object({
    patchCoverage: z.number().min(0).max(100).default(80),
    symbolCoverageThreshold: z.number().min(0).max(100).default(60),
  })
  .strict()
  .prefault({});

export const PolicyConfigSchema = z
  .object({
    extraBannedImports: z.record(z.string(), z.array(z.string())).default({}),
    dropZeroGainFiles: z.boolean().default(true),
    provenanceHeader: z.boolean().default(true),
  })
  .strict()
  .prefault({});

export const ValidateConfigSchema = z
  .object({
    workspace: z.enum(["copy", "inplace"]).default("copy"),
    maxCopyMB: z.number().int().min(50).max(5000).default(500),
  })
  .strict()
  .prefault({});

export const EnvConfigSchema = z
  .object({
    pass: z.array(z.string()).default([]),
    passProxy: z.boolean().default(true),
  })
  .strict()
  .prefault({});

export const FilesConfigSchema = z
  .object({
    eol: z.enum(["auto", "lf", "crlf"]).default("auto"),
  })
  .strict()
  .prefault({});

export const PrivacyConfigSchema = z
  .object({
    neverSend: z.array(SafePath).default([]),
  })
  .strict()
  .prefault({});

export const OfflineConfigSchema = z
  .object({
    strategy: z.enum(["none", "unshare"]).default("none"),
  })
  .strict()
  .prefault({});

export const CommitConfigSchema = z
  .object({
    auth: z.enum(["github_token", "pat"]).default("github_token"),
  })
  .strict()
  .prefault({});

export const LocalConfigSchema = z
  .object({
    baseRef: z.string().min(1).optional(),
    stagingDir: SafePath.refine(
      (v) =>
        v
          .replace(/\\/g, "/")
          .replace(/\/+$/, "")
          .replace(/^(?:\.\/)+/, "") !== "." && v.replace(/[\\/.]/g, "").length > 0,
      "stagingDir must name a subdirectory inside the repository",
    ).default(".unit-agent/chat/proposed"),
    maxRepairIterations: z.number().int().min(0).max(3).default(2),
    reuseCoverage: z.boolean().default(true),
    confirmBeforeRun: z.boolean().default(true),
    stageApplied: z.boolean().default(false),
    nodeCommand: z
      .string()
      .min(1)
      .refine(
        (v) => !/[\r\n\0]/.test(v) && isArgvOnly(v),
        "must be a safe single command token without shell operators",
      )
      .refine((v) => {
        try {
          return parseArgvTokens(v).length === 1;
        } catch {
          return false;
        }
      }, "must resolve to a single executable token")
      .default("node"),
    chatTools: z.array(z.string().min(1)).min(1).default(["read", "edit", "search", "execute"]),
  })
  .strict()
  .prefault({});

export const DEFAULT_EXCLUDES = [
  "**/generated/**",
  "**/*.d.ts",
  "**/migrations/**",
  "**/node_modules/**",
  "**/vendor/**",
];

export const ConfigSchema = z
  .object({
    version: z.literal(1),
    mode: z.enum(["report", "propose"]).default("report"),
    model: z.string().min(1).optional(),
    limits: LimitsSchema,
    baseline: BaselineConfigSchema,
    targets: TargetsConfigSchema,
    policy: PolicyConfigSchema,
    validate: ValidateConfigSchema,
    env: EnvConfigSchema,
    files: FilesConfigSchema,
    privacy: PrivacyConfigSchema,
    offline: OfflineConfigSchema,
    commit: CommitConfigSchema,
    local: LocalConfigSchema,
    languages: z
      .object({
        javascript: LanguageConfigSchema.optional(),
        python: PythonConfigSchema.optional(),
        java: JavaConfigSchema.optional(),
      })
      .strict(),
    exclude: z.array(SafePath).default(DEFAULT_EXCLUDES),
  })
  .strict()
  .superRefine((cfg, ctx) => {
    if (cfg.offline.strategy === "unshare" && cfg.languages.java?.enabled !== false && cfg.languages.java) {
      if (cfg.languages.java.buildTool === "gradle") {
        ctx.addIssue({
          code: "custom",
          path: ["offline", "strategy"],
          message:
            "offline.strategy 'unshare' cannot be combined with languages.java.buildTool 'gradle' (not supported for Gradle in this release)",
        });
      }
    }
    const langEntries = Object.entries(cfg.languages) as [
      "javascript" | "python" | "java",
      z.infer<typeof LanguageConfigSchema> | undefined,
    ][];
    const hasEnabledLanguage = langEntries.some(([, lc]) => lc && lc.enabled);
    if (!hasEnabledLanguage) {
      ctx.addIssue({
        code: "custom",
        path: ["languages"],
        message: "at least one language must be configured and enabled under languages.*",
      });
    }
  });

export type UnitAgentConfig = z.infer<typeof ConfigSchema>;
export type LanguageKey = "javascript" | "python" | "java";
export type LanguageConfig = z.infer<typeof LanguageConfigSchema>;
export type PythonConfig = z.infer<typeof PythonConfigSchema>;
export type JavaConfig = z.infer<typeof JavaConfigSchema>;

export function exportConfigJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(ConfigSchema, { io: "input" }) as Record<string, unknown>;
}
