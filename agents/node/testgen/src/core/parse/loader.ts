import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Parser from "web-tree-sitter";

export type GrammarKey = "javascript" | "typescript" | "tsx" | "python" | "java";

let initPromise: Promise<void> | undefined;
const languageCache = new Map<GrammarKey, Promise<Parser.Language>>();

function findWasmPath(fileName: string, overrideDir?: string): string {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    overrideDir ? path.join(overrideDir, fileName) : "",
    process.env.UA_WASM_DIR ? path.join(process.env.UA_WASM_DIR, fileName) : "",
    path.join(moduleDir, "wasm", fileName),
    path.resolve(moduleDir, "..", "..", "dist", "wasm", fileName),
    path.resolve(moduleDir, "..", "..", "..", "dist", "wasm", fileName),
    path.resolve(process.cwd(), "dist", "wasm", fileName),
    fileName === "tree-sitter.wasm"
      ? path.resolve(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm")
      : path.resolve(process.cwd(), "node_modules", "tree-sitter-wasms", "out", fileName),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error(`Unable to locate WASM asset "${fileName}". Checked: ${candidates.join(", ")}`);
}

export async function initTreeSitter(wasmDir?: string): Promise<void> {
  if (!initPromise) {
    initPromise = Parser.init({
      locateFile: (scriptName: string) => findWasmPath(scriptName, wasmDir),
    }).catch((err) => {
      initPromise = undefined;
      throw err;
    });
  }
  await initPromise;
}

export async function loadTreeSitterLanguage(grammar: GrammarKey, wasmDir?: string): Promise<Parser.Language> {
  await initTreeSitter(wasmDir);
  let cached = languageCache.get(grammar);
  if (!cached) {
    const wasmFile = findWasmPath(`tree-sitter-${grammar}.wasm`, wasmDir);
    cached = Parser.Language.load(wasmFile).catch((err) => {
      languageCache.delete(grammar);
      throw err;
    });
    languageCache.set(grammar, cached);
  }
  return cached;
}

export async function createTreeSitterParser(grammar: GrammarKey, wasmDir?: string): Promise<Parser> {
  const language = await loadTreeSitterLanguage(grammar, wasmDir);
  const parser = new Parser();
  parser.setLanguage(language);
  return parser;
}

export function grammarForFilePath(filePath: string): GrammarKey | undefined {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".ts" || ext === ".mts" || ext === ".cts") return "typescript";
  if (ext === ".tsx") return "tsx";
  if (ext === ".js" || ext === ".mjs" || ext === ".cjs" || ext === ".jsx") return "javascript";
  if (ext === ".py") return "python";
  if (ext === ".java") return "java";
  return undefined;
}
