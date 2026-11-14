import type Parser from "web-tree-sitter";

import { normalizeSlashes } from "../paths";
import {
  JS_COMPLEXITY_RULES,
  computeCyclomaticComplexity,
  computeErrorStats,
  estimateExecutableLines,
  extractSignatureFromNode,
} from "./complexity";
import { createTreeSitterParser, grammarForFilePath } from "./loader";
import {
  type FileParseResult,
  type ParsedSymbol,
  filterEligibleSymbols,
  isGeneratedSourceContent,
  isTestFilePath,
  isTrivialSymbolBody,
} from "./skip-rules";

function extractJsImports(root: Parser.SyntaxNode): string[] {
  const imports = new Set<string>();
  for (const stmt of root.descendantsOfType("import_statement")) {
    const sourceNode = stmt.childForFieldName("source");
    if (sourceNode) {
      const cleaned = sourceNode.text.replace(/^['"]|['"]$/g, "");
      if (cleaned) imports.add(cleaned);
    }
  }
  for (const call of root.descendantsOfType("call_expression")) {
    const fn = call.childForFieldName("function");
    if (fn?.text === "require") {
      const args = call.childForFieldName("arguments");
      const firstArg = args?.namedChild(0);
      if (firstArg && (firstArg.type === "string" || firstArg.type === "template_string")) {
        const cleaned = firstArg.text.replace(/^['"`]|['"`]$/g, "");
        if (cleaned) imports.add(cleaned);
      }
    }
  }
  return [...imports];
}

function collectReExportedNames(root: Parser.SyntaxNode): Set<string> {
  const exported = new Set<string>();
  for (let i = 0; i < root.namedChildCount; i++) {
    const child = root.namedChild(i);
    if (!child || child.type !== "export_statement") continue;
    for (const clause of child.descendantsOfType("export_clause")) {
      for (const spec of clause.descendantsOfType("export_specifier")) {
        const localName = spec.childForFieldName("name")?.text;
        if (localName) exported.add(localName);
      }
    }
    const defaultVal = child.childForFieldName("value");
    if (defaultVal?.type === "identifier") {
      exported.add(defaultVal.text);
    }
  }
  return exported;
}

function makeSymbol(params: {
  filePath: string;
  contentLines: string[];
  qualifiedName: string;
  kind: "function" | "method" | "constructor";
  fnNode: Parser.SyntaxNode;
  bodyNode: Parser.SyntaxNode | null;
  exported: boolean;
  abstractFlag: boolean;
  isTestFile: boolean;
  className?: string;
  signatureOverride?: string;
}): ParsedSymbol {
  const startLine = params.fnNode.startPosition.row + 1;
  const endLine = params.fnNode.endPosition.row + 1;
  const complexity = computeCyclomaticComplexity(params.fnNode, params.bodyNode, JS_COMPLEXITY_RULES);
  const execLines = params.bodyNode ? estimateExecutableLines(params.contentLines, startLine, endLine) : 0;
  const signature = params.signatureOverride ?? extractSignatureFromNode(params.fnNode, params.bodyNode);
  const shortName = params.qualifiedName.split(".").pop() ?? params.qualifiedName;
  const trivial = isTrivialSymbolBody({
    kind: params.kind,
    name: shortName,
    signature,
    bodyText: params.bodyNode?.text ?? "",
    complexity,
    executableLinesFallback: execLines,
  });

  return {
    symbolId: `${normalizeSlashes(params.filePath)}#${params.qualifiedName}`,
    qualifiedName: params.qualifiedName,
    kind: params.kind,
    signature,
    startLine,
    endLine,
    complexity,
    executableLinesFallback: execLines,
    exported: params.exported,
    abstract: params.abstractFlag,
    trivial,
    isTest: params.isTestFile,
    className: params.className,
  };
}

function hasChildToken(node: Parser.SyntaxNode, text: string): boolean {
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i);
    if (!c) continue;
    if (c.text === text) return true;
    if (c.type === "accessibility_modifier" && c.text === text) return true;
    if (c.type === "override_modifier") continue;
  }
  return false;
}

function extractClassMembers(
  classNode: Parser.SyntaxNode,
  className: string,
  classExported: boolean,
  filePath: string,
  contentLines: string[],
  isTestFile: boolean,
): ParsedSymbol[] {
  const results: ParsedSymbol[] = [];
  const body = classNode.childForFieldName("body");
  if (!body) return results;

  for (let i = 0; i < body.namedChildCount; i++) {
    const member = body.namedChild(i);
    if (!member) continue;

    if (member.type === "method_definition" || member.type === "abstract_method_signature") {
      const nameNode = member.childForFieldName("name");
      const memberName = nameNode?.text ?? "";
      const isPrivateMod = hasChildToken(member, "private") || hasChildToken(member, "protected");
      const isHashPrivate = nameNode?.type === "private_property_identifier" || memberName.startsWith("#");
      const isAbstract = member.type === "abstract_method_signature" || hasChildToken(member, "abstract");
      const fnBody = member.childForFieldName("body");
      if (!fnBody && !isAbstract) continue;

      const kind = memberName === "constructor" ? "constructor" : "method";
      results.push(
        makeSymbol({
          filePath,
          contentLines,
          qualifiedName: `${className}.${memberName || "method"}`,
          kind,
          fnNode: member,
          bodyNode: fnBody,
          exported: classExported && !isPrivateMod && !isHashPrivate,
          abstractFlag: isAbstract || !fnBody,
          isTestFile,
          className,
        }),
      );
      continue;
    }

    if (member.type === "public_field_definition" || member.type === "field_definition") {
      const nameNode = member.childForFieldName("name") ?? member.childForFieldName("property");
      const valNode = member.childForFieldName("value");
      if (!nameNode || !valNode) continue;
      if (valNode.type !== "arrow_function" && valNode.type !== "function_expression") continue;

      const memberName = nameNode.text;
      const isPrivateMod = hasChildToken(member, "private") || hasChildToken(member, "protected");
      const isHashPrivate = nameNode.type === "private_property_identifier" || memberName.startsWith("#");
      const fnBody = valNode.childForFieldName("body");

      results.push(
        makeSymbol({
          filePath,
          contentLines,
          qualifiedName: `${className}.${memberName}`,
          kind: "method",
          fnNode: member,
          bodyNode: fnBody,
          exported: classExported && !isPrivateMod && !isHashPrivate,
          abstractFlag: false,
          isTestFile,
          className,
        }),
      );
    }
  }

  return results;
}

export async function parseJavaScriptFile(params: {
  filePath: string;
  content: string;
  minExecutableLines?: number;
  wasmDir?: string;
}): Promise<FileParseResult> {
  const grammar = grammarForFilePath(params.filePath) ?? "typescript";
  const parser = await createTreeSitterParser(
    grammar === "python" || grammar === "java" ? "typescript" : grammar,
    params.wasmDir,
  );
  const tree = parser.parse(params.content);
  const errorStats = computeErrorStats(tree);
  const contentLines = params.content.split(/\r?\n/);
  const isTestFile = isTestFilePath(params.filePath);
  const isGeneratedFile = isGeneratedSourceContent(params.filePath, params.content);
  const reExported = collectReExportedNames(tree.rootNode);
  const allSymbols: ParsedSymbol[] = [];
  let primaryClassName: string | undefined;

  const processDeclaration = (decl: Parser.SyntaxNode, explicitExported: boolean): void => {
    if (decl.type === "function_declaration" || decl.type === "generator_function_declaration") {
      const name = decl.childForFieldName("name")?.text ?? "default";
      const bodyNode = decl.childForFieldName("body");
      if (!bodyNode) return;
      allSymbols.push(
        makeSymbol({
          filePath: params.filePath,
          contentLines,
          qualifiedName: name,
          kind: "function",
          fnNode: decl,
          bodyNode,
          exported: explicitExported || reExported.has(name),
          abstractFlag: false,
          isTestFile,
        }),
      );
      return;
    }

    if (decl.type === "arrow_function" || decl.type === "function_expression") {
      const bodyNode = decl.childForFieldName("body");
      if (!bodyNode) return;
      allSymbols.push(
        makeSymbol({
          filePath: params.filePath,
          contentLines,
          qualifiedName: "default",
          kind: "function",
          fnNode: decl,
          bodyNode,
          exported: explicitExported,
          abstractFlag: false,
          isTestFile,
        }),
      );
      return;
    }

    if (decl.type === "lexical_declaration" || decl.type === "variable_declaration") {
      for (let i = 0; i < decl.namedChildCount; i++) {
        const declarator = decl.namedChild(i);
        if (!declarator || declarator.type !== "variable_declarator") continue;
        const name = declarator.childForFieldName("name")?.text;
        const val = declarator.childForFieldName("value");
        if (!name || !val) continue;
        if (val.type === "arrow_function" || val.type === "function_expression") {
          const bodyNode = val.childForFieldName("body");
          if (!bodyNode) continue;
          allSymbols.push(
            makeSymbol({
              filePath: params.filePath,
              contentLines,
              qualifiedName: name,
              kind: "function",
              fnNode: declarator,
              bodyNode,
              exported: explicitExported || reExported.has(name),
              abstractFlag: false,
              isTestFile,
              signatureOverride: `const ${name} = ${extractSignatureFromNode(val, bodyNode)}`,
            }),
          );
        }
      }
      return;
    }

    if (decl.type === "class_declaration" || decl.type === "abstract_class_declaration") {
      const className = decl.childForFieldName("name")?.text ?? "AnonymousClass";
      const exported = explicitExported || reExported.has(className);
      if (exported && !primaryClassName) {
        primaryClassName = className;
      }
      allSymbols.push(...extractClassMembers(decl, className, exported, params.filePath, contentLines, isTestFile));
    }
  };

  for (let i = 0; i < tree.rootNode.namedChildCount; i++) {
    const stmt = tree.rootNode.namedChild(i);
    if (!stmt) continue;

    if (stmt.type === "export_statement") {
      const decl = stmt.childForFieldName("declaration");
      if (decl) {
        processDeclaration(decl, true);
        continue;
      }
      const val = stmt.childForFieldName("value");
      if (val) {
        processDeclaration(val, true);
        continue;
      }
    } else if (stmt.type === "expression_statement") {
      const expr = stmt.namedChild(0);
      if (expr?.type === "assignment_expression") {
        const left = expr.childForFieldName("left")?.text ?? "";
        const right = expr.childForFieldName("right");
        const cjsMatch = /^(?:module\.)?exports\.([A-Za-z0-9_$]+)$/.exec(left);
        if (cjsMatch?.[1] && right && (right.type === "arrow_function" || right.type === "function_expression")) {
          const bodyNode = right.childForFieldName("body");
          if (bodyNode) {
            allSymbols.push(
              makeSymbol({
                filePath: params.filePath,
                contentLines,
                qualifiedName: cjsMatch[1],
                kind: "function",
                fnNode: expr,
                bodyNode,
                exported: true,
                abstractFlag: false,
                isTestFile,
                signatureOverride: `exports.${cjsMatch[1]} = ${extractSignatureFromNode(right, bodyNode)}`,
              }),
            );
          }
        } else if (left === "module.exports" && right?.type === "object") {
          for (let j = 0; j < right.namedChildCount; j++) {
            const prop = right.namedChild(j);
            if (!prop || prop.type !== "pair") continue;
            const key = prop.childForFieldName("key")?.text;
            const val = prop.childForFieldName("value");
            if (key && val && (val.type === "arrow_function" || val.type === "function_expression")) {
              const bodyNode = val.childForFieldName("body");
              if (bodyNode) {
                allSymbols.push(
                  makeSymbol({
                    filePath: params.filePath,
                    contentLines,
                    qualifiedName: key,
                    kind: "function",
                    fnNode: prop,
                    bodyNode,
                    exported: true,
                    abstractFlag: false,
                    isTestFile,
                  }),
                );
              }
            }
          }
        }
      }
    } else {
      processDeclaration(stmt, false);
    }
  }

  const imports = extractJsImports(tree.rootNode);
  const eligibleSymbols =
    isTestFile || isGeneratedFile ? [] : filterEligibleSymbols(allSymbols, params.minExecutableLines ?? 2);

  tree.delete();
  parser.delete();

  return {
    language: "javascript",
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
