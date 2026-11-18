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
    if (fn?.text === "require" || fn?.type === "import") {
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
    if (child.childForFieldName("source")) continue;
    for (const clause of child.descendantsOfType("export_clause")) {
      for (const spec of clause.descendantsOfType("export_specifier")) {
        const localName = spec.childForFieldName("name")?.text;
        if (localName) exported.add(localName);
      }
    }
    const defaultVal = unwrapExpression(child.childForFieldName("value"));
    if (defaultVal?.type === "identifier") {
      exported.add(defaultVal.text);
    }
  }
  return exported;
}

type CjsExportTarget = { kind: "module_exports" } | { kind: "named_export"; name: string };

function unwrapExpression(node: Parser.SyntaxNode | null): Parser.SyntaxNode | null {
  let current = node;
  while (current?.type === "parenthesized_expression") {
    current = current.namedChild(0);
  }
  return current;
}

function stripPropertyKey(rawKey: string | undefined): string | undefined {
  if (!rawKey) return undefined;
  return rawKey.replace(/^(['"`])(.*)\1$/, "$2");
}

function parseCjsExportTarget(leftText: string): CjsExportTarget | null {
  const normalized = leftText.trim();
  if (normalized === "module.exports") {
    return { kind: "module_exports" };
  }
  const dotMatch = /^(?:module\.)?exports\.([A-Za-z0-9_$]+)$/.exec(normalized);
  if (dotMatch?.[1]) {
    return { kind: "named_export", name: dotMatch[1] };
  }
  const bracketMatch = /^(?:module\.)?exports\[(['"])([A-Za-z0-9_$]+)\1\]$/.exec(normalized);
  if (bracketMatch?.[2]) {
    return { kind: "named_export", name: bracketMatch[2] };
  }
  return null;
}

/**
 * Extracts chained CommonJS assignment targets paired with the rightmost assigned value node.
 */
function extractCjsAssignmentChain(expr: Parser.SyntaxNode): {
  targets: CjsExportTarget[];
  value: Parser.SyntaxNode | null;
} {
  const targets: CjsExportTarget[] = [];
  let current: Parser.SyntaxNode | null = expr;
  while (current?.type === "assignment_expression") {
    const leftText = current.childForFieldName("left")?.text ?? "";
    const target = parseCjsExportTarget(leftText);
    if (!target) {
      if (targets.length === 0) return { targets: [], value: null };
      break;
    }
    targets.push(target);
    current = unwrapExpression(current.childForFieldName("right"));
  }
  return { targets, value: current };
}

/**
 * Maps locally declared identifiers referenced in top-level CommonJS exports to their exported names.
 */
function collectCommonJsExports(root: Parser.SyntaxNode): Map<string, string[]> {
  const exported = new Map<string, string[]>();
  const addMapping = (localName: string, exportName: string): void => {
    const existing = exported.get(localName);
    if (!existing) {
      exported.set(localName, [exportName]);
      return;
    }
    if (!existing.includes(exportName)) {
      existing.push(exportName);
    }
  };

  for (let i = 0; i < root.namedChildCount; i++) {
    const stmt = root.namedChild(i);
    if (!stmt || stmt.type !== "expression_statement") continue;
    const expr = unwrapExpression(stmt.namedChild(0));
    if (!expr || expr.type !== "assignment_expression") continue;

    const { targets, value } = extractCjsAssignmentChain(expr);
    if (targets.length === 0 || !value) continue;

    for (const target of targets) {
      if (target.kind === "named_export") {
        if (value.type === "identifier") {
          addMapping(value.text, target.name);
        }
        continue;
      }

      if (value.type === "identifier") {
        addMapping(value.text, value.text);
        continue;
      }

      if (value.type === "object") {
        for (let j = 0; j < value.namedChildCount; j++) {
          const prop = value.namedChild(j);
          if (!prop) continue;
          if (prop.type === "shorthand_property_identifier") {
            addMapping(prop.text, prop.text);
          } else if (prop.type === "pair") {
            const key = stripPropertyKey(prop.childForFieldName("key")?.text);
            const val = unwrapExpression(prop.childForFieldName("value"));
            if (key && val?.type === "identifier") {
              addMapping(val.text, key);
            }
          }
        }
      }
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
    if (c.type === "override_modifier") continue;
    if ((c.type === text || c.type === "accessibility_modifier" || !c.isNamed) && c.text === text) {
      return true;
    }
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
  const cjsExported = collectCommonJsExports(tree.rootNode);
  const allSymbols: ParsedSymbol[] = [];
  let primaryClassName: string | undefined;

  const resolveSymbolExports = (
    localName: string,
    explicitExported: boolean,
  ): Array<{ name: string; exported: boolean }> => {
    if (explicitExported || reExported.has(localName)) {
      return [{ name: localName, exported: true }];
    }
    const cjsNames = cjsExported.get(localName);
    if (cjsNames && cjsNames.length > 0) {
      return cjsNames.map((name) => ({ name, exported: true }));
    }
    return [{ name: localName, exported: false }];
  };

  const pushFunctionSymbol = (opts: {
    qualifiedName: string;
    fnNode: Parser.SyntaxNode;
    bodyNode: Parser.SyntaxNode | null;
    exported: boolean;
    signatureOverride?: string;
  }): void => {
    if (!opts.bodyNode) return;
    allSymbols.push(
      makeSymbol({
        filePath: params.filePath,
        contentLines,
        qualifiedName: opts.qualifiedName,
        kind: "function",
        fnNode: opts.fnNode,
        bodyNode: opts.bodyNode,
        exported: opts.exported,
        abstractFlag: false,
        isTestFile,
        signatureOverride: opts.signatureOverride,
      }),
    );
  };

  const pushClassSymbols = (classNode: Parser.SyntaxNode, className: string, exported: boolean): void => {
    if (exported && !primaryClassName) {
      primaryClassName = className;
    }
    allSymbols.push(...extractClassMembers(classNode, className, exported, params.filePath, contentLines, isTestFile));
  };

  const processDeclaration = (rawDecl: Parser.SyntaxNode, explicitExported: boolean): void => {
    const decl = unwrapExpression(rawDecl);
    if (!decl) return;

    if (decl.type === "function_declaration" || decl.type === "generator_function_declaration") {
      const name = decl.childForFieldName("name")?.text ?? "default";
      const bodyNode = decl.childForFieldName("body");
      if (!bodyNode) return;
      for (const entry of resolveSymbolExports(name, explicitExported)) {
        pushFunctionSymbol({
          qualifiedName: entry.name,
          fnNode: decl,
          bodyNode,
          exported: entry.exported,
        });
      }
      return;
    }

    if (decl.type === "arrow_function" || decl.type === "function_expression" || decl.type === "generator_function") {
      const bodyNode = decl.childForFieldName("body");
      pushFunctionSymbol({
        qualifiedName: decl.childForFieldName("name")?.text ?? "default",
        fnNode: decl,
        bodyNode,
        exported: explicitExported,
      });
      return;
    }

    if (decl.type === "lexical_declaration" || decl.type === "variable_declaration") {
      for (let i = 0; i < decl.namedChildCount; i++) {
        const declarator = decl.namedChild(i);
        if (!declarator || declarator.type !== "variable_declarator") continue;
        const name = declarator.childForFieldName("name")?.text;
        const val = unwrapExpression(declarator.childForFieldName("value"));
        if (!name || !val) continue;
        if (val.type === "arrow_function" || val.type === "function_expression" || val.type === "generator_function") {
          const bodyNode = val.childForFieldName("body");
          if (!bodyNode) continue;
          for (const entry of resolveSymbolExports(name, explicitExported)) {
            pushFunctionSymbol({
              qualifiedName: entry.name,
              fnNode: declarator,
              bodyNode,
              exported: entry.exported,
              signatureOverride: `const ${name} = ${extractSignatureFromNode(val, bodyNode)}`,
            });
          }
        } else if (val.type === "class" || val.type === "class_declaration") {
          for (const entry of resolveSymbolExports(name, explicitExported)) {
            pushClassSymbols(val, entry.name, entry.exported);
          }
        }
      }
      return;
    }

    if (decl.type === "class" || decl.type === "class_declaration" || decl.type === "abstract_class_declaration") {
      const className = decl.childForFieldName("name")?.text ?? "AnonymousClass";
      for (const entry of resolveSymbolExports(className, explicitExported)) {
        pushClassSymbols(decl, entry.name, entry.exported);
      }
    }
  };

  const processInlineExportedValue = (
    name: string,
    fnNode: Parser.SyntaxNode,
    val: Parser.SyntaxNode | null,
    signaturePrefix?: string,
  ): void => {
    const unwrapped = unwrapExpression(val);
    if (!unwrapped) return;
    if (unwrapped.type === "arrow_function" || unwrapped.type === "function_expression") {
      const bodyNode = unwrapped.childForFieldName("body");
      if (!bodyNode) return;
      pushFunctionSymbol({
        qualifiedName: name,
        fnNode,
        bodyNode,
        exported: true,
        signatureOverride: signaturePrefix
          ? `${signaturePrefix}${extractSignatureFromNode(unwrapped, bodyNode)}`
          : undefined,
      });
    } else if (unwrapped.type === "class" || unwrapped.type === "class_declaration") {
      pushClassSymbols(unwrapped, name, true);
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
      const expr = unwrapExpression(stmt.namedChild(0));
      if (expr?.type === "assignment_expression") {
        const { targets, value } = extractCjsAssignmentChain(expr);
        if (targets.length === 0 || !value) continue;
        let handledModuleExports = false;
        for (const target of targets) {
          if (target.kind === "named_export") {
            processInlineExportedValue(target.name, expr, value, `exports.${target.name} = `);
            continue;
          }
          if (handledModuleExports) continue;
          handledModuleExports = true;
          if (value.type === "object") {
            for (let j = 0; j < value.namedChildCount; j++) {
              const prop = value.namedChild(j);
              if (!prop) continue;
              if (prop.type === "method_definition") {
                const key = stripPropertyKey(prop.childForFieldName("name")?.text);
                const bodyNode = prop.childForFieldName("body");
                if (key && bodyNode) {
                  pushFunctionSymbol({
                    qualifiedName: key,
                    fnNode: prop,
                    bodyNode,
                    exported: true,
                  });
                }
              } else if (prop.type === "pair") {
                const key = stripPropertyKey(prop.childForFieldName("key")?.text);
                const propVal = prop.childForFieldName("value");
                if (key && propVal) {
                  processInlineExportedValue(key, prop, propVal);
                }
              }
            }
          } else if (value.type === "arrow_function" || value.type === "function_expression") {
            const fnName = value.childForFieldName("name")?.text || "default";
            processInlineExportedValue(fnName, expr, value, "module.exports = ");
          } else if (value.type === "class" || value.type === "class_declaration") {
            const clsName = value.childForFieldName("name")?.text || "AnonymousClass";
            processInlineExportedValue(clsName, expr, value);
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
