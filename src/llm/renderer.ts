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

export function buildSystemPrompt(language: LanguageKey, maxTestsPerSymbol?: number): string {
  const base = loadPromptTemplate("system.md")
    .trim()
    .replaceAll(
      "{{maxTestsPerSymbol}}",
      maxTestsPerSymbol !== undefined ? String(maxTestsPerSymbol) : "the configured maxTestsPerSymbol",
    );
  const addendum = loadPromptTemplate(`${language}.md`).trim();
  return `${base}\n\n${addendum}\n`;
}

function sanitizeInlinePromptText(value: string): string {
  return value
    .replace(/[\r\n]+/g, " ")
    .replace(/`/g, "'")
    .replace(/<\s*\/?\s*UNTRUSTED_CODE\b[^>]*>/gi, "[redacted-tag]")
    .trim();
}

export function wrapUntrustedCode(label: string, content: string): string {
  const safeLabel = sanitizeInlinePromptText(label).replace(/"/g, "&quot;");
  const sanitized = content.replace(/<\s*\/?\s*UNTRUSTED_CODE\b[^>]*>/gi, "[redacted-tag]");
  return `<UNTRUSTED_CODE label="${safeLabel}">\n${sanitized}\n</UNTRUSTED_CODE>`;
}

export function renderGenerationPrompt(params: {
  context: FileContext;
  maxTestsPerSymbol: number;
  javaTestClassName?: string;
}): string {
  const { context } = params;
  const targetLines = context.targets.map(
    (t) =>
      `- symbolId: \`${sanitizeInlinePromptText(t.symbolId)}\` | ${sanitizeInlinePromptText(t.qualifiedName)} (lines ${t.startLine}-${t.endLine}): \`${sanitizeInlinePromptText(t.signature)}\``,
  );

  const sourcePathSafe = sanitizeInlinePromptText(context.sourceFile.path);
  const testPathSafe = sanitizeInlinePromptText(context.conventions.testPath);
  const importHintSafe = sanitizeInlinePromptText(context.conventions.importHint);
  const fwVerSafe = context.frameworkVersion ? sanitizeInlinePromptText(context.frameworkVersion) : null;

  const sections = [
    `Generate unit tests for \`${sourcePathSafe}\`.`,
    "",
    "### Conventions & Placement",
    `- testPath: \`${testPathSafe}\``,
    `- framework: \`${context.framework}\`${fwVerSafe ? ` (${fwVerSafe})` : ""}`,
    `- importHint: \`${importHintSafe}\``,
    `- mockingLibs: ${context.mockingLibs.length > 0 ? context.mockingLibs.map(sanitizeInlinePromptText).join(", ") : "none (prefer pure inputs/constructors)"}`,
    `- testNaming: ${sanitizeInlinePromptText(context.conventions.testNaming)}`,
    `- assertionStyle: ${sanitizeInlinePromptText(context.conventions.assertionStyle)}`,
    `- maxTestsPerSymbol: ${params.maxTestsPerSymbol}`,
  ];

  if (params.javaTestClassName) {
    sections.push(`- required Java public test class name: \`${sanitizeInlinePromptText(params.javaTestClassName)}\``);
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
      `### Repository Test Style Sample (${sanitizeInlinePromptText(context.styleSample.path)})`,
      wrapUntrustedCode(context.styleSample.path, context.styleSample.content),
    );
  }

  sections.push(
    "",
    `### Source Code (${sourcePathSafe}${context.sourceFile.truncated ? " [sliced]" : ""})`,
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
    `- testPath: \`${sanitizeInlinePromptText(params.context.conventions.testPath)}\``,
    `- importHint: \`${sanitizeInlinePromptText(params.context.conventions.importHint)}\``,
    `- failureReason: \`${sanitizeInlinePromptText(params.failure.reason)}\``,
    "",
    "### Failure Message",
    wrapUntrustedCode("failure-message", params.failure.message),
    "",
    "### Error Excerpt",
    wrapUntrustedCode("validation-error", params.failure.excerpt),
    "",
    "### Current Test File",
    wrapUntrustedCode(params.context.conventions.testPath, params.currentTestContent),
    "",
    `### Target Source (${sanitizeInlinePromptText(params.context.sourceFile.path)})`,
    wrapUntrustedCode(params.context.sourceFile.path, params.context.sourceFile.content),
  ];

  return sections.join("\n");
}
