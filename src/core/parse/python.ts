import type Parser from "web-tree-sitter";

import { normalizeSlashes } from "../paths";
import {
  PYTHON_COMPLEXITY_RULES,
  computeCyclomaticComplexity,
  computeErrorStats,
  estimateExecutableLines,
  extractSignatureFromNode,
} from "./complexity";
import { createTreeSitterParser } from "./loader";
import {
  type FileParseResult,
  type ParsedSymbol,
  filterEligibleSymbols,
  isGeneratedSourceContent,
  isTestFilePath,
  isTrivialSymbolBody,
} from "./skip-rules";

function extractPythonImports(root: Parser.SyntaxNode): string[] {
  const imports = new Set<string>();
  for (const node of root.descendantsOfType(["import_statement", "import_from_statement"])) {
    const modNode = node.childForFieldName("module_name");
    if (modNode) {
      imports.add(modNode.text);
    } else {
      for (const nameNode of node.childrenForFieldName("name")) {
        imports.add(nameNode.text);
      }
    }
  }
  return [...imports];
}

function isPrivatePythonName(name: string): boolean {
  if (!name.startsWith("_")) return false;
  // Treat double-underscore magic methods like __init__ or __call__ separately from _private helpers
  if (name.startsWith("__") && name.endsWith("__") && name.length > 4) {
    return false;
  }
  return true;
}

function collectDecorators(decoratedNode: Parser.SyntaxNode): string[] {
  const decorators: string[] = [];
  for (let i = 0; i < decoratedNode.namedChildCount; i++) {
    const child = decoratedNode.namedChild(i);
    if (child?.type === "decorator") {
      decorators.push(child.text.trim());
    }
  }
  return decorators;
}

function buildPythonFunctionSymbol(params: {
  filePath: string;
  contentLines: string[];
  fnNode: Parser.SyntaxNode;
  decorators: string[];
  className?: string;
  classExported: boolean;
  isTestFile: boolean;
}): ParsedSymbol | undefined {
  const nameNode = params.fnNode.childForFieldName("name");
  const bodyNode = params.fnNode.childForFieldName("body");
  if (!nameNode || !bodyNode) return undefined;

  const fnName = nameNode.text;
  const qualifiedName = params.className ? `${params.className}.${fnName}` : fnName;
  const startLine = params.fnNode.startPosition.row + 1;
  const endLine = params.fnNode.endPosition.row + 1;
  const complexity = computeCyclomaticComplexity(params.fnNode, bodyNode, PYTHON_COMPLEXITY_RULES);

  // Exclude triple-quoted docstring line count roughly if needed, otherwise estimateExecutableLines handles comments/pass
  const execLines = estimateExecutableLines(params.contentLines, startLine + 1, endLine);
  const signature = extractSignatureFromNode(params.fnNode, bodyNode).replace(/:$/, "").trim();

  const isAbstract = params.decorators.some((d) => d.includes("abstractmethod"));
  const isProperty = params.decorators.some((d) => d.includes("property") || d.includes(".setter"));
  const exported = params.classExported && !isPrivatePythonName(fnName);
  const kind: "function" | "method" | "constructor" =
    params.className && fnName === "__init__" ? "constructor" : params.className ? "method" : "function";

  let trivial = isTrivialSymbolBody({
    kind,
    name: fnName,
    signature,
    bodyText: bodyNode.text,
    complexity,
    executableLinesFallback: execLines,
  });

  if (isProperty && complexity === 1 && execLines <= 2) {
    trivial = true;
  }
  if (kind === "constructor" && complexity === 1) {
    const stmts = bodyNode.text
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter((s) => s && !s.startsWith("#"));
    if (
      stmts.length <= 4 &&
      stmts.every((s) => /^self\.[A-Za-z0-9_]+\s*=/.test(s) || s === "pass" || s.startsWith("super()"))
    ) {
      trivial = true;
    }
  }

  return {
    symbolId: `${normalizeSlashes(params.filePath)}#${qualifiedName}`,
    qualifiedName,
    kind,
    signature,
    startLine,
    endLine,
    complexity,
    executableLinesFallback: execLines,
    exported,
    abstract: isAbstract,
    trivial,
    isTest: params.isTestFile || fnName.startsWith("test_"),
    className: params.className,
  };
}

export async function parsePythonFile(params: {
  filePath: string;
  content: string;
  minExecutableLines?: number;
  wasmDir?: string;
}): Promise<FileParseResult> {
  const parser = await createTreeSitterParser("python", params.wasmDir);
  const tree = parser.parse(params.content);
  const errorStats = computeErrorStats(tree);
  const contentLines = params.content.split(/\r?\n/);
  const isTestFile = isTestFilePath(params.filePath);
  const isGeneratedFile = isGeneratedSourceContent(params.filePath, params.content);
  const allSymbols: ParsedSymbol[] = [];
  let primaryClassName: string | undefined;

  const visitTopNode = (node: Parser.SyntaxNode, decorators: string[]): void => {
    if (node.type === "decorated_definition") {
      const innerDecorators = collectDecorators(node);
      const def = node.childForFieldName("definition");
      if (def) {
        visitTopNode(def, innerDecorators);
      }
      return;
    }

    if (node.type === "function_definition") {
      const sym = buildPythonFunctionSymbol({
        filePath: params.filePath,
        contentLines,
        fnNode: node,
        decorators,
        classExported: true,
        isTestFile,
      });
      if (sym) allSymbols.push(sym);
      return;
    }

    if (node.type === "class_definition") {
      const className = node.childForFieldName("name")?.text;
      const body = node.childForFieldName("body");
      if (!className || !body) return;
      const classExported = !isPrivatePythonName(className);
      if (classExported && !primaryClassName) {
        primaryClassName = className;
      }

      for (let i = 0; i < body.namedChildCount; i++) {
        const member = body.namedChild(i);
        if (!member) continue;
        if (member.type === "decorated_definition") {
          const memberDecorators = collectDecorators(member);
          const def = member.childForFieldName("definition");
          if (def?.type === "function_definition") {
            const sym = buildPythonFunctionSymbol({
              filePath: params.filePath,
              contentLines,
              fnNode: def,
              decorators: memberDecorators,
              className,
              classExported,
              isTestFile,
            });
            if (sym) allSymbols.push(sym);
          }
        } else if (member.type === "function_definition") {
          const sym = buildPythonFunctionSymbol({
            filePath: params.filePath,
            contentLines,
            fnNode: member,
            decorators: [],
            className,
            classExported,
            isTestFile,
          });
          if (sym) allSymbols.push(sym);
        }
      }
    }
  };

  for (let i = 0; i < tree.rootNode.namedChildCount; i++) {
    const child = tree.rootNode.namedChild(i);
    if (!child) continue;
    visitTopNode(child, []);
  }

  const imports = extractPythonImports(tree.rootNode);
  const eligibleSymbols =
    isTestFile || isGeneratedFile ? [] : filterEligibleSymbols(allSymbols, params.minExecutableLines ?? 2);

  tree.delete();
  parser.delete();

  return {
    language: "python",
    filePath: normalizeSlashes(params.filePath),
    hasErrors: errorStats.hasErrors,
    tooBroken: errorStats.tooBroken,
    isTestFile,
    isGeneratedFile,
    primaryClassName,
    imports,
    allSymbols,
    eligibleSymbols,
  };
}
