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
    // Handle runner formats like "Suite > test name", "pkg.ClassTest::method", "Class#method", "testAdd(int, int)[1]", or "test_foo[param]"
    const baseFail = f
      .replace(/\[[^\]]*\]$/, "")
      .replace(/(?:\([^)]*\)|\{[^}]*\})$/, "")
      .trim();
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

function decodeJsPruneString(node: Parser.SyntaxNode | null | undefined): string {
  if (!node) return "";
  if (
    node.type === "string" ||
    (node.type === "template_string" && !node.namedChildren.some((c) => c.type === "template_substitution"))
  ) {
    return node.text
      .slice(1, -1)
      .replace(/\\(x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|u\{[0-9a-fA-F]+\}|n|r|t|\\|'|")/g, (m, esc: string) => {
        if (esc === "n") return "\n";
        if (esc === "r") return "\r";
        if (esc === "t") return "\t";
        if (esc === "\\" || esc === "'" || esc === '"') return esc;
        if (esc.startsWith("x")) return String.fromCharCode(Number.parseInt(esc.slice(1), 16));
        if (esc.startsWith("u{")) {
          const cp = Number.parseInt(esc.slice(2, -1), 16);
          return Number.isFinite(cp) && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
        }
        if (esc.startsWith("u")) return String.fromCharCode(Number.parseInt(esc.slice(1), 16));
        return m;
      })
      .trim();
  }
  return node.text.replace(/^['"`]|['"`]$/g, "").trim();
}

function findJsPruneTargets(
  root: Parser.SyntaxNode,
  failingSet: ReadonlySet<string>,
): { removals: ByteRemoval[]; auxRemovals?: ByteRemoval[]; totalTests: number } {
  const removals: ByteRemoval[] = [];
  let totalTests = 0;

  for (const call of root.descendantsOfType("call_expression")) {
    const fn = call.childForFieldName("function");
    const fnText = fn?.text ?? "";
    const isDirectTest = /^(?:it|test)(?:\.(?:concurrent|sequential))?$/.test(fnText);
    const isEachTest =
      fn?.type === "call_expression" &&
      /^(?:it|test)(?:\.(?:concurrent|sequential))?\.(?:each|for)$/.test(fn.childForFieldName("function")?.text ?? "");
    if (!isDirectTest && !isEachTest) continue;

    const stmt = call.parent;
    if (!stmt || stmt.type !== "expression_statement") continue;

    totalTests += 1;
    const args = call.childForFieldName("arguments");
    const testName = decodeJsPruneString(args?.namedChild(0));
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
): { removals: ByteRemoval[]; auxRemovals?: ByteRemoval[]; totalTests: number } {
  const removals: ByteRemoval[] = [];
  const auxRemovals: ByteRemoval[] = [];
  const removedNodeIds = new Set<number>();
  let totalTests = 0;

  for (const fn of root.descendantsOfType("function_definition")) {
    const name = fn.childForFieldName("name")?.text ?? "";
    if (!name.startsWith("test_")) continue;

    totalTests += 1;
    if (matchesFailingName(name, failingSet)) {
      const targetNode = fn.parent?.type === "decorated_definition" ? fn.parent : fn;
      removedNodeIds.add(targetNode.id);
      removals.push({
        start: targetNode.startIndex,
        end: targetNode.endIndex,
        name,
      });
    }
  }

  // Bottom-up removal of classes whose bodies became empty so nested classes don't leave IndentationError.
  const classes = root.descendantsOfType("class_definition");
  for (let idx = classes.length - 1; idx >= 0; idx -= 1) {
    const cls = classes[idx]!;
    const body = cls.childForFieldName("body");
    if (!body) continue;
    let remainingStmts = 0;
    let hadRemoved = false;
    for (let i = 0; i < body.namedChildCount; i += 1) {
      const child = body.namedChild(i);
      if (!child || child.type === "comment") continue;
      if (removedNodeIds.has(child.id)) {
        hadRemoved = true;
      } else {
        remainingStmts += 1;
      }
    }
    if (hadRemoved && remainingStmts === 0) {
      const clsTarget = cls.parent?.type === "decorated_definition" ? cls.parent : cls;
      removedNodeIds.add(clsTarget.id);
      auxRemovals.push({
        start: clsTarget.startIndex,
        end: clsTarget.endIndex,
        name: cls.childForFieldName("name")?.text ?? "class",
      });
    }
  }

  return { removals, auxRemovals, totalTests };
}

function findJavaPruneTargets(
  root: Parser.SyntaxNode,
  failingSet: ReadonlySet<string>,
): { removals: ByteRemoval[]; auxRemovals?: ByteRemoval[]; totalTests: number } {
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
  let found: { removals: ByteRemoval[]; auxRemovals?: ByteRemoval[]; totalTests: number };
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
  const disjointRemovals = mergeDisjointRemovals([...found.removals, ...(found.auxRemovals ?? [])]);

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
