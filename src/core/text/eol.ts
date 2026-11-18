import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { PROVENANCE_HEADER_JS, PROVENANCE_HEADER_PY, hasProvenanceHeader } from "../../config/templates";
import type { LanguageKey } from "../../contracts";

import { cleanRepoRelative, normalizeSlashes } from "../paths";

export type LineEnding = "\n" | "\r\n";

export function detectGitattributesEol(repoRoot: string, repoRelPath: string): LineEnding | null {
  const attrPath = path.join(repoRoot, ".gitattributes");
  if (!existsSync(attrPath)) return null;
  const normPath = cleanRepoRelative(normalizeSlashes(repoRelPath));
  const lines = readFileSync(attrPath, "utf8").split(/\r?\n/);
  const ext = path.posix.extname(normPath);
  let resolved: LineEnding | null = null;
  for (const raw of lines) {
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const parts = trimmed.split(/\s+/);
    const pattern = normalizeSlashes(parts[0] ?? "").replace(/^\.\//, "");
    const attrs = parts.slice(1);
    const matches =
      pattern === "*" || (pattern.startsWith("*.") && ext && pattern.slice(1) === ext) || pattern === normPath;
    if (!matches) continue;
    for (const a of attrs) {
      if (a === "eol=crlf") resolved = "\r\n";
      if (a === "eol=lf") resolved = "\n";
    }
  }
  return resolved;
}

export function detectPreferredEol(params: {
  repoRoot: string;
  targetPath: string;
  configEol: "auto" | "lf" | "crlf";
  referenceSourceContent?: string;
}): LineEnding {
  if (params.configEol === "crlf") return "\r\n";
  if (params.configEol === "lf") return "\n";

  const targetAbs = path.join(params.repoRoot, params.targetPath);
  if (existsSync(targetAbs)) {
    const existing = readFileSync(targetAbs, "utf8");
    if (existing.includes("\r\n")) return "\r\n";
    if (existing.includes("\n")) return "\n";
  }

  const attrEol = detectGitattributesEol(params.repoRoot, params.targetPath);
  if (attrEol) return attrEol;

  if (params.referenceSourceContent) {
    const crlfCount = (params.referenceSourceContent.match(/\r\n/g) ?? []).length;
    const lfCount = (params.referenceSourceContent.replace(/\r\n/g, "").match(/\n/g) ?? []).length;
    if (crlfCount > lfCount) return "\r\n";
  }

  return "\n";
}

export function normalizeLineEndings(content: string, eol: LineEnding): string {
  const lf = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const normalized = lf.endsWith("\n") ? lf : `${lf}\n`;
  return eol === "\r\n" ? normalized.replace(/\n/g, "\r\n") : normalized;
}

export function applyProvenanceHeader(content: string, language: LanguageKey, enabled = true): string {
  if (!enabled) return content;
  if (hasProvenanceHeader(content)) return content;
  const header = language === "python" ? PROVENANCE_HEADER_PY : PROVENANCE_HEADER_JS;
  const eol: LineEnding = content.includes("\r\n") ? "\r\n" : "\n";
  return `${header}${eol}${content}`;
}

export function formatGeneratedTestContent(params: {
  content: string;
  language: LanguageKey;
  repoRoot: string;
  targetPath: string;
  configEol: "auto" | "lf" | "crlf";
  provenanceHeader: boolean;
  referenceSourceContent?: string;
}): string {
  const eol = detectPreferredEol({
    repoRoot: params.repoRoot,
    targetPath: params.targetPath,
    configEol: params.configEol,
    referenceSourceContent: params.referenceSourceContent,
  });
  const withHeader = applyProvenanceHeader(params.content, params.language, params.provenanceHeader);
  return normalizeLineEndings(withHeader, eol);
}
