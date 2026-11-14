import type Parser from "web-tree-sitter";

import { normalizeSlashes } from "../paths";
import {
  JAVA_COMPLEXITY_RULES,
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

function readModifiers(node: Parser.SyntaxNode): {
  isPublic: boolean;
  isPrivate: boolean;
  isProtected: boolean;
  isAbstract: boolean;
  isStatic: boolean;
  isGenerated: boolean;
} {
  let isPublic = false;
  let isPrivate = false;
  let isProtected = false;
  let isAbstract = false;
  let isStatic = false;
  let isGenerated = false;

  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i);
    if (c?.type === "modifiers") {
      const text = c.text;
      if (/\bpublic\b/.test(text)) isPublic = true;
      if (/\bprivate\b/.test(text)) isPrivate = true;
      if (/\bprotected\b/.test(text)) isProtected = true;
      if (/\babstract\b/.test(text)) isAbstract = true;
      if (/\bstatic\b/.test(text)) isStatic = true;
      if (/@Generated\b/.test(text)) isGenerated = true;
    }
  }

  return { isPublic, isPrivate, isProtected, isAbstract, isStatic, isGenerated };
}

function extractParameterTypes(fnNode: Parser.SyntaxNode): string[] {
  const paramsNode = fnNode.childForFieldName("parameters");
  if (!paramsNode) return [];
  const types: string[] = [];
  for (let i = 0; i < paramsNode.namedChildCount; i++) {
    const param = paramsNode.namedChild(i);
    if (!param) continue;
    if (param.type === "formal_parameter" || param.type === "spread_parameter") {
      const typeNode = param.childForFieldName("type");
      if (typeNode) {
        types.push(typeNode.text.replace(/\s+/g, ""));
      }
    }
  }
  return types;
}

function extractJavaImports(root: Parser.SyntaxNode): string[] {
  const imports: string[] = [];
  for (let i = 0; i < root.namedChildCount; i++) {
    const child = root.namedChild(i);
    if (child?.type === "import_declaration") {
      imports.push(
        child.text
          .replace(/^import\s+/, "")
          .replace(/;$/, "")
          .trim(),
      );
    }
  }
  return imports;
}

function extractPackageName(root: Parser.SyntaxNode): string | undefined {
  for (let i = 0; i < root.namedChildCount; i++) {
    const child = root.namedChild(i);
    if (child?.type === "package_declaration") {
      return child.text
        .replace(/^package\s+/, "")
        .replace(/;$/, "")
        .trim();
    }
  }
  return undefined;
}

export async function parseJavaFile(params: {
  filePath: string;
  content: string;
  minExecutableLines?: number;
  wasmDir?: string;
}): Promise<FileParseResult> {
  const parser = await createTreeSitterParser("java", params.wasmDir);
  const tree = parser.parse(params.content);
  const errorStats = computeErrorStats(tree);
  const contentLines = params.content.split(/\r?\n/);
  const isTestFile = isTestFilePath(params.filePath);
  const isGeneratedFile = isGeneratedSourceContent(params.filePath, params.content);
  const packageName = extractPackageName(tree.rootNode);
  const allSymbols: ParsedSymbol[] = [];
  let primaryClassName: string | undefined;

  const visitClassContainer = (
    classNode: Parser.SyntaxNode,
    parentClassPath: string | undefined,
    parentExported: boolean,
  ): void => {
    const nameNode = classNode.childForFieldName("name");
    const className = nameNode?.text;
    if (!className) return;

    const classMods = readModifiers(classNode);
    const classExported = parentExported && !classMods.isPrivate && !classMods.isProtected && !classMods.isGenerated;
    const fullClassName = parentClassPath ? `${parentClassPath}.${className}` : className;

    if (classExported && !parentClassPath && (!primaryClassName || classMods.isPublic)) {
      primaryClassName = className;
    }

    const body = classNode.childForFieldName("body");
    if (!body) return;

    const pkgPrefix = packageName ? `${packageName}.` : "";

    for (let i = 0; i < body.namedChildCount; i++) {
      const member = body.namedChild(i);
      if (!member) continue;

      if (
        member.type === "class_declaration" ||
        member.type === "record_declaration" ||
        member.type === "enum_declaration"
      ) {
        visitClassContainer(member, fullClassName, classExported);
        continue;
      }

      if (member.type === "method_declaration" || member.type === "constructor_declaration") {
        const mods = readModifiers(member);
        const methodName = member.childForFieldName("name")?.text ?? className;
        const bodyNode = member.childForFieldName("body");
        const isAbstract = mods.isAbstract || !bodyNode;
        const paramTypes = extractParameterTypes(member);
        const startLine = member.startPosition.row + 1;
        const endLine = member.endPosition.row + 1;
        const complexity = computeCyclomaticComplexity(member, bodyNode, JAVA_COMPLEXITY_RULES);
        const execLines = bodyNode ? estimateExecutableLines(contentLines, startLine + 1, endLine) : 0;
        const signature = extractSignatureFromNode(member, bodyNode);
        const kind: "method" | "constructor" = member.type === "constructor_declaration" ? "constructor" : "method";

        const trivial = isTrivialSymbolBody({
          kind,
          name: methodName,
          signature,
          bodyText: bodyNode?.text ?? "",
          complexity,
          executableLinesFallback: execLines,
        });

        const exported = classExported && !mods.isPrivate && !mods.isProtected && !mods.isGenerated;

        allSymbols.push({
          symbolId: `${pkgPrefix}${fullClassName}#${methodName}(${paramTypes.join(",")})`,
          qualifiedName: `${fullClassName}.${methodName}`,
          kind,
          signature,
          startLine,
          endLine,
          complexity,
          executableLinesFallback: execLines,
          exported,
          abstract: isAbstract,
          trivial,
          isTest: isTestFile,
          className: fullClassName,
          packageName,
        });
      }
    }
  };

  for (let i = 0; i < tree.rootNode.namedChildCount; i++) {
    const child = tree.rootNode.namedChild(i);
    if (!child) continue;
    if (
      child.type === "class_declaration" ||
      child.type === "record_declaration" ||
      child.type === "enum_declaration"
    ) {
      visitClassContainer(child, undefined, true);
    }
  }

  const imports = extractJavaImports(tree.rootNode);
  const eligibleSymbols =
    isTestFile || isGeneratedFile ? [] : filterEligibleSymbols(allSymbols, params.minExecutableLines ?? 2);

  tree.delete();
  parser.delete();

  return {
    language: "java",
    filePath: normalizeSlashes(params.filePath),
    hasErrors: errorStats.hasErrors,
    tooBroken: errorStats.tooBroken,
    isTestFile,
    isGeneratedFile,
    packageName,
    primaryClassName,
    imports,
    allSymbols,
    eligibleSymbols,
  };
}
