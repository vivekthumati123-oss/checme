import type Parser from "web-tree-sitter";

import type { LanguageKey } from "../../contracts";
import { createTreeSitterParser, grammarForFilePath } from "../parse";

export interface PruneResult {
  prunedContent: string;
  keptCount: number;
  droppedCount: number;
  prunedNames: string[];
  empty: boolean;
}

interface ByteRemoval {
  start: number;
  end: number;
  name: string;
}

function matchesFailingName(candidateName: string, failingSet: ReadonlySet<string>): boolean {
  if (failingSet.has(candidateName)) return true;
  for (const f of failingSet) {
    // Handle runner formats like "Suite > test name", "pkg.ClassTest::method", "Class#method", or "test_foo[param]"
    const baseFail = f.replace(/\[.*\]$/, "").trim();
    if (
      baseFail === candidateName ||
      baseFail.endsWith(`> ${candidateName}`) ||
      baseFail.endsWith(`::${candidateName}`) ||
      baseFail.endsWith(`#${candidateName}`) ||
      baseFail.endsWith(`.${candidateName}`) ||
      baseFail.endsWith(` ${candidateName}`)
    ) {
      return true;
    }
  }
  return false;
}

function applyRemovals(content: string, removals: ByteRemoval[]): string {
  if (removals.length === 0) return content;
  const sorted = [...removals].sort((a, b) => b.start - a.start);
  let out = content;
  for (const r of sorted) {
    let start = r.start;
    let end = r.end;
    // Expand removal over preceding indentation on the same line and trailing newline(s)
    while (start > 0 && (out[start - 1] === " " || out[start - 1] === "\t")) {
      start -= 1;
    }
    if (out.slice(end, end + 2) === "\r\n") {
      end += 2;
    } else if (out[end] === "\n") {
      end += 1;
    }
    out = out.slice(0, start) + out.slice(end);
  }
  return out.replace(/\n{3,}/g, "\n\n").replace(/(\r\n){3,}/g, "\r\n\r\n");
}

function findJsPruneTargets(
  root: Parser.SyntaxNode,
  failingSet: ReadonlySet<string>,
): { removals: ByteRemoval[]; totalTests: number } {
  const removals: ByteRemoval[] = [];
  let totalTests = 0;

  for (const call of root.descendantsOfType("call_expression")) {
    const fnText = call.childForFieldName("function")?.text ?? "";
    if (fnText !== "it" && fnText !== "test") continue;

    const stmt = call.parent;
    if (!stmt || stmt.type !== "expression_statement") continue;

    totalTests += 1;
    const args = call.childForFieldName("arguments");
    const firstArg = args?.namedChild(0);
    const testName = firstArg ? firstArg.text.replace(/^['"`]|['"`]$/g, "").trim() : "";
    if (testName && matchesFailingName(testName, failingSet)) {
      removals.push({
        start: stmt.startIndex,
        end: stmt.endIndex,
        name: testName,
      });
    }
  }

  return { removals, totalTests };
}

function findPythonPruneTargets(
  root: Parser.SyntaxNode,
  failingSet: ReadonlySet<string>,
): { removals: ByteRemoval[]; totalTests: number } {
  const removals: ByteRemoval[] = [];
  let totalTests = 0;

  for (const fn of root.descendantsOfType("function_definition")) {
    const name = fn.childForFieldName("name")?.text ?? "";
    if (!name.startsWith("test_")) continue;

    totalTests += 1;
    if (matchesFailingName(name, failingSet)) {
      const targetNode = fn.parent?.type === "decorated_definition" ? fn.parent : fn;
      removals.push({
        start: targetNode.startIndex,
        end: targetNode.endIndex,
        name,
      });
    }
  }

  return { removals, totalTests };
}

function findJavaPruneTargets(
  root: Parser.SyntaxNode,
  failingSet: ReadonlySet<string>,
): { removals: ByteRemoval[]; totalTests: number } {
  const removals: ByteRemoval[] = [];
  let totalTests = 0;

  for (const method of root.descendantsOfType("method_declaration")) {
    const mods = method.children.find((c) => c.type === "modifiers")?.text ?? "";
    if (!/@(?:org\.junit\.jupiter\.api\.)?Test\b/.test(mods)) continue;

    const name = method.childForFieldName("name")?.text ?? "";
    totalTests += 1;
    if (name && matchesFailingName(name, failingSet)) {
      removals.push({
        start: method.startIndex,
        end: method.endIndex,
        name,
      });
    }
  }

  return { removals, totalTests };
}

export async function pruneFailingTests(params: {
  language: LanguageKey;
  testPath: string;
  content: string;
  failingTestNames: readonly string[];
  wasmDir?: string;
}): Promise<PruneResult> {
  const failingSet = new Set(params.failingTestNames.map((n) => n.trim()).filter(Boolean));
  const grammar =
    grammarForFilePath(params.testPath) ??
    (params.language === "python" ? "python" : params.language === "java" ? "java" : "typescript");

  const parser = await createTreeSitterParser(grammar, params.wasmDir);
  const tree = parser.parse(params.content);

  let found: { removals: ByteRemoval[]; totalTests: number };
  if (params.language === "javascript") {
    found = findJsPruneTargets(tree.rootNode, failingSet);
  } else if (params.language === "python") {
    found = findPythonPruneTargets(tree.rootNode, failingSet);
  } else {
    found = findJavaPruneTargets(tree.rootNode, failingSet);
  }

  tree.delete();
  parser.delete();

  // Deduplicate overlapping byte ranges
  const uniqueRemovals: ByteRemoval[] = [];
  for (const r of found.removals) {
    if (!uniqueRemovals.some((u) => u.start === r.start && u.end === r.end)) {
      uniqueRemovals.push(r);
    }
  }

  const prunedContent = applyRemovals(params.content, uniqueRemovals);
  const droppedCount = uniqueRemovals.length;
  const keptCount = Math.max(0, found.totalTests - droppedCount);

  return {
    prunedContent,
    keptCount,
    droppedCount,
    prunedNames: uniqueRemovals.map((r) => r.name),
    empty: keptCount === 0,
  };
}
