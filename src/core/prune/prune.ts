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
      baseFail.endsWith(`.${candidateName}`)
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
    const fn = call.childForFieldName("function");
    const fnText = fn?.text ?? "";
    const isDirectTest = /^(?:it|test)(?:\.concurrent)?$/.test(fnText);
    const isEachTest =
      fn?.type === "call_expression" &&
      /^(?:it|test)(?:\.concurrent)?\.each$/.test(fn.childForFieldName("function")?.text ?? "");
    if (!isDirectTest && !isEachTest) continue;

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
  const removedFnIds = new Set<number>();
  let totalTests = 0;

  for (const fn of root.descendantsOfType("function_definition")) {
    const name = fn.childForFieldName("name")?.text ?? "";
    if (!name.startsWith("test_")) continue;

    totalTests += 1;
    if (matchesFailingName(name, failingSet)) {
      const targetNode = fn.parent?.type === "decorated_definition" ? fn.parent : fn;
      removedFnIds.add(targetNode.id);
      removals.push({
        start: targetNode.startIndex,
        end: targetNode.endIndex,
        name,
      });
    }
  }

  // If all statements inside a test class body were pruned, remove the empty class to preserve valid Python syntax.
  for (const cls of root.descendantsOfType("class_definition")) {
    const body = cls.childForFieldName("body");
    if (!body) continue;
    let remainingStmts = 0;
    let hadRemoved = false;
    for (let i = 0; i < body.namedChildCount; i += 1) {
      const child = body.namedChild(i);
      if (!child || child.type === "comment") continue;
      if (removedFnIds.has(child.id)) {
        hadRemoved = true;
      } else {
        remainingStmts += 1;
      }
    }
    if (hadRemoved && remainingStmts === 0) {
      const clsTarget = cls.parent?.type === "decorated_definition" ? cls.parent : cls;
      removals.push({
        start: clsTarget.startIndex,
        end: clsTarget.endIndex,
        name: cls.childForFieldName("name")?.text ?? "class",
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
    if (
      !/@(?:org\.junit\.jupiter\.api\.)?(?:Test|RepeatedTest|TestFactory|TestTemplate)\b|@(?:org\.junit\.jupiter\.params\.)?ParameterizedTest\b/.test(
        mods,
      )
    ) {
      continue;
    }

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

function mergeDisjointRemovals(removals: readonly ByteRemoval[]): ByteRemoval[] {
  if (removals.length === 0) return [];
  const sorted = [...removals].sort((a, b) => a.start - b.start || b.end - a.end);
  const merged: ByteRemoval[] = [];
  for (const cur of sorted) {
    const prev = merged[merged.length - 1];
    if (!prev || cur.start > prev.end) {
      merged.push({ ...cur });
    } else if (cur.end > prev.end) {
      prev.end = cur.end;
      prev.name = prev.name || cur.name;
    }
  }
  return merged;
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
  try {
    if (params.language === "javascript") {
      found = findJsPruneTargets(tree.rootNode, failingSet);
    } else if (params.language === "python") {
      found = findPythonPruneTargets(tree.rootNode, failingSet);
    } else {
      found = findJavaPruneTargets(tree.rootNode, failingSet);
    }
  } finally {
    tree.delete();
    parser.delete();
  }

  const droppedNames = found.removals.map((r) => r.name);
  const disjointRemovals = mergeDisjointRemovals(found.removals);

  const prunedContent = applyRemovals(params.content, disjointRemovals);
  const droppedCount = found.removals.length;
  const keptCount = Math.max(0, found.totalTests - droppedCount);

  return {
    prunedContent,
    keptCount,
    droppedCount,
    prunedNames: droppedNames,
    empty: keptCount === 0,
  };
}
