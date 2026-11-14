import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { FileContext, LanguageKey } from "../contracts";

export interface FailurePromptDetail {
  reason: string;
  message: string;
  excerpt: string;
}

function resolvePromptPath(fileName: string): string {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(moduleDir, "prompts", fileName),
    path.resolve(moduleDir, "..", "..", "dist", "prompts", fileName),
    path.resolve(moduleDir, "..", "..", "src", "llm", "prompts", fileName),
    path.resolve(process.cwd(), "src", "llm", "prompts", fileName),
    path.resolve(process.cwd(), "dist", "prompts", fileName),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  throw new Error(`Unable to locate prompt template "${fileName}". Checked: ${candidates.join(", ")}`);
}

export function loadPromptTemplate(fileName: string): string {
  return readFileSync(resolvePromptPath(fileName), "utf8");
}

export function extractTestRulesBlock(systemPrompt?: string): string {
  const content = systemPrompt ?? loadPromptTemplate("system.md");
  const startMarker = "<!-- BEGIN TEST_RULES -->";
  const endMarker = "<!-- END TEST_RULES -->";
  const startIdx = content.indexOf(startMarker);
  const endIdx = content.indexOf(endMarker);
  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
    throw new Error("Prompt template missing <!-- BEGIN TEST_RULES --> ... <!-- END TEST_RULES --> block");
  }
  return content.slice(startIdx + startMarker.length, endIdx).trim();
}

export function buildSystemPrompt(language: LanguageKey): string {
  const base = loadPromptTemplate("system.md").trim();
  const addendum = loadPromptTemplate(`${language}.md`).trim();
  return `${base}\n\n${addendum}\n`;
}

export function wrapUntrustedCode(label: string, content: string): string {
  const sanitized = content.replace(/<\/?UNTRUSTED_CODE>/gi, "[redacted-tag]");
  return `<UNTRUSTED_CODE label="${label}">\n${sanitized}\n</UNTRUSTED_CODE>`;
}

export function renderGenerationPrompt(params: {
  context: FileContext;
  maxTestsPerSymbol: number;
  javaTestClassName?: string;
}): string {
  const { context } = params;
  const targetLines = context.targets.map(
    (t) => `- symbolId: \`${t.symbolId}\` | ${t.qualifiedName} (lines ${t.startLine}-${t.endLine}): \`${t.signature}\``,
  );

  const sections = [
    `Generate unit tests for \`${context.sourceFile.path}\`.`,
    "",
    "### Conventions & Placement",
    `- testPath: \`${context.conventions.testPath}\``,
    `- framework: \`${context.framework}\`${context.frameworkVersion ? ` (${context.frameworkVersion})` : ""}`,
    `- importHint: \`${context.conventions.importHint}\``,
    `- mockingLibs: ${context.mockingLibs.length > 0 ? context.mockingLibs.join(", ") : "none (prefer pure inputs/constructors)"}`,
    `- testNaming: ${context.conventions.testNaming}`,
    `- assertionStyle: ${context.conventions.assertionStyle}`,
    `- maxTestsPerSymbol: ${params.maxTestsPerSymbol}`,
  ];

  if (params.javaTestClassName) {
    sections.push(`- required Java public test class name: \`${params.javaTestClassName}\``);
  }

  sections.push("", "### Target Symbols", ...targetLines);

  if (context.classSkeleton) {
    sections.push("", "### Class Skeleton", wrapUntrustedCode("class-skeleton", context.classSkeleton));
  }

  if (context.referencedSignatures.length > 0) {
    sections.push(
      "",
      "### Referenced Dependency Signatures",
      wrapUntrustedCode("referenced-signatures", context.referencedSignatures.join("\n")),
    );
  }

  if (context.styleSample) {
    sections.push(
      "",
      `### Repository Test Style Sample (${context.styleSample.path})`,
      wrapUntrustedCode(context.styleSample.path, context.styleSample.content),
    );
  }

  sections.push(
    "",
    `### Source Code (${context.sourceFile.path}${context.sourceFile.truncated ? " [sliced]" : ""})`,
    wrapUntrustedCode(context.sourceFile.path, context.sourceFile.content),
    "",
    "Call `submit_tests` now with valid code adhering to all Test Generation Rules.",
  );

  return sections.join("\n");
}

export function renderRepairPrompt(params: {
  context: FileContext;
  currentTestContent: string;
  failure: FailurePromptDetail;
}): string {
  const repairHeader = loadPromptTemplate("repair.md").trim();
  const sections = [
    repairHeader,
    "",
    `- testPath: \`${params.context.conventions.testPath}\``,
    `- importHint: \`${params.context.conventions.importHint}\``,
    `- failureReason: \`${params.failure.reason}\``,
    `- message: ${params.failure.message}`,
    "",
    "### Error Excerpt",
    wrapUntrustedCode("validation-error", params.failure.excerpt),
    "",
    "### Current Test File",
    wrapUntrustedCode(params.context.conventions.testPath, params.currentTestContent),
    "",
    `### Target Source (${params.context.sourceFile.path})`,
    wrapUntrustedCode(params.context.sourceFile.path, params.context.sourceFile.content),
  ];

  return sections.join("\n");
}
