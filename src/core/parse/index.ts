import type { LanguageKey } from "../../contracts";
import { parseJavaScriptFile } from "./javascript";
import { parseJavaFile } from "./java";
import { parsePythonFile } from "./python";
import type { FileParseResult } from "./skip-rules";

export * from "./complexity";
export * from "./java";
export * from "./javascript";
export * from "./loader";
export * from "./python";
export * from "./skip-rules";

export function detectLanguageFromPath(filePath: string): LanguageKey | undefined {
  const lower = filePath.toLowerCase();
  if (/\.[cm]?[jt]sx?$/.test(lower)) return "javascript";
  if (lower.endsWith(".py")) return "python";
  if (lower.endsWith(".java")) return "java";
  return undefined;
}

export async function parseSourceFile(params: {
  filePath: string;
  content: string;
  language?: LanguageKey;
  minExecutableLines?: number;
  wasmDir?: string;
}): Promise<FileParseResult> {
  const language = params.language ?? detectLanguageFromPath(params.filePath);
  if (!language) {
    throw new Error(`Unsupported source file extension: ${params.filePath}`);
  }
  if (language === "javascript") {
    return parseJavaScriptFile(params);
  }
  if (language === "python") {
    return parsePythonFile(params);
  }
  return parseJavaFile(params);
}
