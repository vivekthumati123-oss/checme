import { lstatSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";

import type { LanguageKey } from "../contracts";

export const PROVENANCE_HEADER_JS = "// unit-agent:generated";
export const PROVENANCE_HEADER_PY = "# unit-agent:generated";

export function provenanceHeaderFor(language: LanguageKey): string {
  return language === "python" ? PROVENANCE_HEADER_PY : PROVENANCE_HEADER_JS;
}

export function hasProvenanceHeader(content: string): boolean {
  const clean = content.replace(/^\uFEFF/, "");
  const firstLine = clean.split(/\r?\n/, 1)[0]?.trim() ?? "";
  return firstLine === PROVENANCE_HEADER_JS || firstLine === PROVENANCE_HEADER_PY;
}

export function toPascalCase(name: string): string {
  return name
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

export interface RenderTestPathOptions {
  language: LanguageKey;
  sourcePath: string;
  pattern: string;
  className?: string;
  packageName?: string;
  generatedSuffix?: string;
}

export function renderTestPathPattern(opts: RenderTestPathOptions): string {
  const normalized = opts.sourcePath.replace(/\\/g, "/").replace(/^\.\//, "");
  const parsed = path.posix.parse(normalized);
  const dir = parsed.dir;
  const stem = parsed.name;
  const ext = parsed.ext.replace(/^\./, "");
  const pascalName = opts.className && opts.className.length > 0 ? opts.className : toPascalCase(stem);
  const pkgPath = opts.packageName ? opts.packageName.replace(/\./g, "/") : "";

  let rendered = opts.pattern
    .replace(/\{dir\}/g, dir)
    .replace(/\{name\}/g, stem)
    .replace(/\{Name\}/g, pascalName)
    .replace(/\{package\}/g, pkgPath)
    .replace(/\{ext\}/g, ext);

  // Clean up duplicate or leading slashes when {dir} or {package} is empty.
  rendered = rendered.replace(/\/+/g, "/").replace(/^\.\//, "").replace(/^\//, "");
  return rendered;
}

export function applyCollisionSuffix(
  candidatePath: string,
  language: LanguageKey,
  generatedSuffix = ".unit-agent",
): string {
  const normalized = candidatePath.replace(/\\/g, "/");
  if (language === "python") {
    const pySuffix = generatedSuffix === ".unit-agent" ? "_agent" : generatedSuffix;
    return normalized.replace(/\.py$/i, `${pySuffix}.py`);
  }
  if (language === "java") {
    if (/(?:Tests?|IT)\.java$/i.test(normalized)) {
      return normalized.replace(/(Tests?|IT)?\.java$/i, "AgentTest.java");
    }
    return normalized.replace(/\.java$/i, "AgentTest.java");
  }
  // JavaScript / TypeScript: preserve `.test.<ext>` / `.spec.<ext>` so Jest/Vitest still match.
  return normalized.replace(/(\.(?:test|spec))?\.([^.]+)$/i, (_, testMarker: string | undefined, ext: string) => {
    return `${generatedSuffix}${testMarker ?? ""}.${ext}`;
  });
}

export interface ResolveTestPathResult {
  testPath: string;
  usedCollisionSuffix: boolean;
  skipReason?: "already_has_agent_tests";
}

export function resolveTestPathForSource(params: {
  repoRoot: string;
  language: LanguageKey;
  sourcePath: string;
  testPathPatterns: string[];
  className?: string;
  packageName?: string;
  generatedSuffix?: string;
  fileExists?: (repoRelPath: string) => boolean;
  readFilePrefix?: (repoRelPath: string) => string | null;
}): ResolveTestPathResult {
  const exists =
    params.fileExists ??
    ((rel: string) => {
      const full = path.join(params.repoRoot, rel);
      try {
        const st = lstatSync(full);
        return !st.isSymbolicLink() && st.isFile();
      } catch {
        return false;
      }
    });
  const readPrefix =
    params.readFilePrefix ??
    ((rel: string) => {
      const full = path.join(params.repoRoot, rel);
      try {
        const st = lstatSync(full);
        if (st.isSymbolicLink() || !st.isFile()) return null;
        const realRoot = realpathSync(params.repoRoot);
        const realFull = realpathSync(full);
        if (!realFull.startsWith(realRoot + path.sep) && realFull !== realRoot) return null;
        return readFileSync(full, "utf8").slice(0, 256);
      } catch {
        return null;
      }
    });

  const primaryPattern = params.testPathPatterns[0];
  if (!primaryPattern) {
    throw new Error(`No testPathPatterns configured for language ${params.language}`);
  }

  const candidate = renderTestPathPattern({
    language: params.language,
    sourcePath: params.sourcePath,
    pattern: primaryPattern,
    className: params.className,
    packageName: params.packageName,
    generatedSuffix: params.generatedSuffix,
  });

  if (!exists(candidate)) {
    return { testPath: candidate, usedCollisionSuffix: false };
  }

  const primaryHead = readPrefix(candidate);
  if (primaryHead !== null && hasProvenanceHeader(primaryHead)) {
    return {
      testPath: candidate,
      usedCollisionSuffix: false,
      skipReason: "already_has_agent_tests",
    };
  }

  const suffixed = applyCollisionSuffix(candidate, params.language, params.generatedSuffix);
  if (exists(suffixed)) {
    const suffixedHead = readPrefix(suffixed);
    if (suffixedHead !== null && hasProvenanceHeader(suffixedHead)) {
      return {
        testPath: suffixed,
        usedCollisionSuffix: true,
        skipReason: "already_has_agent_tests",
      };
    }
    return {
      testPath: suffixed,
      usedCollisionSuffix: true,
      skipReason: "already_has_agent_tests",
    };
  }

  return { testPath: suffixed, usedCollisionSuffix: true };
}
