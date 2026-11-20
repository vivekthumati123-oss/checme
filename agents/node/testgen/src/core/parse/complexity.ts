import type Parser from "web-tree-sitter";

const NESTED_FUNCTION_TYPES = new Set([
  "function_declaration",
  "function_expression",
  "generator_function",
  "generator_function_declaration",
  "arrow_function",
  "method_definition",
  "function_definition",
  "lambda",
  "class_declaration",
  "class_definition",
  "record_declaration",
  "interface_declaration",
  "constructor_declaration",
  "lambda_expression",
]);

export interface ComplexityRules {
  branchNodeTypes: ReadonlySet<string>;
  logicalOperators?: ReadonlySet<string>;
  ignoreDefaultSwitchLabel?: boolean;
}

export const JS_COMPLEXITY_RULES: ComplexityRules = {
  branchNodeTypes: new Set([
    "if_statement",
    "for_statement",
    "for_in_statement",
    "while_statement",
    "do_statement",
    "switch_case",
    "catch_clause",
    "ternary_expression",
    "conditional_expression",
  ]),
  logicalOperators: new Set(["&&", "||", "??"]),
};

export const PYTHON_COMPLEXITY_RULES: ComplexityRules = {
  branchNodeTypes: new Set([
    "if_statement",
    "elif_clause",
    "for_statement",
    "while_statement",
    "except_clause",
    "conditional_expression",
    "boolean_operator",
    "case_clause",
    "if_clause",
  ]),
};

export const JAVA_COMPLEXITY_RULES: ComplexityRules = {
  branchNodeTypes: new Set([
    "if_statement",
    "for_statement",
    "enhanced_for_statement",
    "while_statement",
    "do_statement",
    "switch_label",
    "catch_clause",
    "ternary_expression",
  ]),
  logicalOperators: new Set(["&&", "||"]),
  ignoreDefaultSwitchLabel: true,
};

export function computeCyclomaticComplexity(
  fnNode: Parser.SyntaxNode,
  bodyNode: Parser.SyntaxNode | null,
  rules: ComplexityRules,
): number {
  if (!bodyNode) return 1;
  let complexity = 1;

  const visit = (node: Parser.SyntaxNode): void => {
    if (node.id !== fnNode.id && node.id !== bodyNode.id && NESTED_FUNCTION_TYPES.has(node.type)) {
      return;
    }

    if (rules.branchNodeTypes.has(node.type)) {
      if (rules.ignoreDefaultSwitchLabel && (node.type === "switch_label" || node.type === "switch_rule")) {
        const trimmed = node.text.trimStart();
        if (!trimmed.startsWith("default")) {
          complexity += 1;
        }
      } else {
        complexity += 1;
      }
    } else if (rules.logicalOperators && (node.type === "binary_expression" || node.type === "logical_expression")) {
      const opNode = node.childForFieldName("operator");
      if (opNode && rules.logicalOperators.has(opNode.text)) {
        complexity += 1;
      }
    }

    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child) visit(child);
    }
  };

  visit(bodyNode);
  return complexity;
}

export function estimateExecutableLines(contentLines: string[], startLine: number, endLine: number): number {
  let count = 0;
  let inBlockComment = false;

  for (let lineNum = Math.max(1, startLine); lineNum <= Math.min(contentLines.length, endLine); lineNum++) {
    const raw = contentLines[lineNum - 1] ?? "";
    const trimmed = raw.trim();
    if (!trimmed) continue;

    if (inBlockComment) {
      if (trimmed.includes("*/")) {
        inBlockComment = false;
      }
      continue;
    }

    if (trimmed.startsWith("/*")) {
      if (!trimmed.includes("*/")) {
        inBlockComment = true;
      }
      continue;
    }

    if (
      trimmed.startsWith("//") ||
      trimmed.startsWith("#") ||
      trimmed === "{" ||
      trimmed === "}" ||
      trimmed === "};" ||
      trimmed === ")" ||
      trimmed === "pass"
    ) {
      continue;
    }
    count += 1;
  }

  return count;
}

export function extractSignatureFromNode(node: Parser.SyntaxNode, bodyNode: Parser.SyntaxNode | null): string {
  const endIdx = bodyNode ? bodyNode.startIndex : node.endIndex;
  const headerSlice = node.text.slice(0, Math.max(0, endIdx - node.startIndex));
  return headerSlice.replace(/\s+/g, " ").trim().replace(/\{$/, "").trim();
}

export function computeErrorStats(tree: Parser.Tree): {
  hasErrors: boolean;
  errorCount: number;
  totalNodes: number;
  errorRatio: number;
  tooBroken: boolean;
} {
  const root = tree.rootNode;
  if (!root.hasError) {
    return {
      hasErrors: false,
      errorCount: 0,
      totalNodes: root.descendantCount,
      errorRatio: 0,
      tooBroken: false,
    };
  }
  const errorNodes = root.descendantsOfType(["ERROR", "MISSING"]);
  const totalNodes = Math.max(1, root.descendantCount);
  const errorCount = errorNodes.length;
  const errorRatio = errorCount / totalNodes;
  const tooBroken = errorRatio > 0.05 || errorNodes.some((n) => n.id === root.id);
  return {
    hasErrors: true,
    errorCount,
    totalNodes,
    errorRatio,
    tooBroken,
  };
}
