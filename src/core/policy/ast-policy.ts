import path from "node:path";
import type Parser from "web-tree-sitter";

import type { LanguageKey } from "../../contracts";
import { createTreeSitterParser, grammarForFilePath } from "../parse";
import { DEFAULT_BANNED_CALLS, DEFAULT_BANNED_IMPORTS, normalizeExtraBannedImports } from "./banlist";

export interface PolicyViolation {
  rule: string;
  message: string;
  line?: number;
}

export interface PolicyCheckResult {
  ok: boolean;
  syntaxErrors: boolean;
  testCount: number;
  assertionCount: number;
  violations: PolicyViolation[];
}

export interface PolicyCheckOptions {
  language: LanguageKey;
  testPath: string;
  content: string;
  importHint?: string;
  sourcePath?: string;
  targetCount?: number;
  maxTestsPerSymbol?: number;
  extraBannedImports?: Record<string, string[]>;
  wasmDir?: string;
}

function matchesBannedModule(specifier: string, bannedList: readonly string[]): boolean {
  const clean = specifier.replace(/^['"]|['"]$/g, "").trim();
  return bannedList.some((b) => clean === b || clean.startsWith(`${b}/`) || clean.startsWith(`${b}.`));
}

function extractRelativeImportTarget(importHint?: string): string | null {
  if (!importHint) return null;
  const jsMatch = /from\s+["']([^"']+)["']/.exec(importHint);
  if (jsMatch?.[1]) return jsMatch[1];
  const pyMatch = /from\s+([A-Za-z0-9_.]+)\s+import/.exec(importHint);
  if (pyMatch?.[1]) return pyMatch[1];
  const javaMatch = /import\s+(?:static\s+)?([A-Za-z0-9_.]+)\s*;/.exec(importHint);
  if (javaMatch?.[1]) return javaMatch[1];
  const trimmed = importHint.trim();
  if (trimmed && !trimmed.includes(" ") && !trimmed.includes(";")) {
    return trimmed;
  }
  return null;
}

function isSimpleLiteral(node: Parser.SyntaxNode | null | undefined): string | null {
  if (!node) return null;
  if (
    node.type === "true" ||
    node.type === "false" ||
    node.type === "null" ||
    node.type === "none" ||
    node.type === "number" ||
    node.type === "integer" ||
    node.type === "float" ||
    node.type === "string" ||
    node.type === "decimal_integer_literal" ||
    node.type === "boolean_literal"
  ) {
    return node.text;
  }
  return null;
}

function checkJsPolicy(
  root: Parser.SyntaxNode,
  opts: PolicyCheckOptions,
  bannedModules: readonly string[],
): { testCount: number; assertionCount: number; violations: PolicyViolation[] } {
  const violations: PolicyViolation[] = [];
  const bannedCalls = new Set(DEFAULT_BANNED_CALLS.javascript);
  const targetImport = extractRelativeImportTarget(opts.importHint);
  let testCount = 0;
  let assertionCount = 0;

  for (const imp of root.descendantsOfType("import_statement")) {
    const src = imp.childForFieldName("source")?.text.replace(/^['"]|['"]$/g, "") ?? "";
    if (matchesBannedModule(src, bannedModules)) {
      violations.push({
        rule: "banned_import",
        message: `Banned module import "${src}".`,
        line: imp.startPosition.row + 1,
      });
    }
  }

  for (const expr of root.descendantsOfType("new_expression")) {
    const ctor = expr.childForFieldName("constructor")?.text ?? "";
    if (ctor === "Function") {
      violations.push({
        rule: "banned_call",
        message: "Dynamic function constructor `new Function` is banned.",
        line: expr.startPosition.row + 1,
      });
    }
  }

  for (const call of root.descendantsOfType("call_expression")) {
    const fn = call.childForFieldName("function");
    const args = call.childForFieldName("arguments");
    if (!fn) continue;
    const fnText = fn.text;

    if (fnText === "require" || fnText === "import") {
      const arg0 = args?.namedChild(0)?.text.replace(/^['"`]|['"`]$/g, "") ?? "";
      if (matchesBannedModule(arg0, bannedModules)) {
        violations.push({
          rule: "banned_import",
          message: `Banned dynamic import/require "${arg0}".`,
          line: call.startPosition.row + 1,
        });
      }
    }

    if (bannedCalls.has(fnText)) {
      violations.push({
        rule: "banned_call",
        message: `Banned call "${fnText}()".`,
        line: call.startPosition.row + 1,
      });
    }

    if (
      /^(?:it|test|describe)\.(?:only|skip)$/.test(fnText) ||
      fnText === "fit" ||
      fnText === "fdescribe" ||
      fnText === "xit" ||
      fnText === "xdescribe"
    ) {
      violations.push({
        rule: "focus_or_skip",
        message: `Focus/skip modifier "${fnText}" is disallowed.`,
        line: call.startPosition.row + 1,
      });
    }

    if (fnText === "it" || fnText === "test") {
      testCount += 1;
    }

    if (
      targetImport &&
      (fnText === "vi.mock" || fnText === "jest.mock" || fnText === "vi.doMock" || fnText === "jest.doMock")
    ) {
      const arg0 = args?.namedChild(0)?.text.replace(/^['"]|['"]$/g, "") ?? "";
      if (arg0 === targetImport || arg0.replace(/\.(js|ts)$/, "") === targetImport.replace(/\.(js|ts)$/, "")) {
        violations.push({
          rule: "mock_unit_under_test",
          message: `Cannot mock the unit under test ("${arg0}").`,
          line: call.startPosition.row + 1,
        });
      }
    }

    // Check expect(...) assertions and tautologies like expect(true).toBe(true)
    if (fn.type === "member_expression") {
      const obj = fn.childForFieldName("object");
      const prop = fn.childForFieldName("property")?.text ?? "";
      if (obj?.type === "call_expression" && obj.childForFieldName("function")?.text === "expect") {
        assertionCount += 1;
        if (prop === "toBe" || prop === "toEqual" || prop === "toStrictEqual") {
          const leftLit = isSimpleLiteral(obj.childForFieldName("arguments")?.namedChild(0));
          const rightLit = isSimpleLiteral(args?.namedChild(0));
          if (leftLit !== null && rightLit !== null && leftLit === rightLit) {
            violations.push({
              rule: "tautological_assertion",
              message: `Tautological literal assertion expect(${leftLit}).${prop}(${rightLit}).`,
              line: call.startPosition.row + 1,
            });
          }
        }
      } else if (/^assert(?:$|.)/.test(fnText)) {
        assertionCount += 1;
      }
    }
  }

  return { testCount, assertionCount, violations };
}

function checkPythonPolicy(
  root: Parser.SyntaxNode,
  opts: PolicyCheckOptions,
  bannedModules: readonly string[],
): { testCount: number; assertionCount: number; violations: PolicyViolation[] } {
  const violations: PolicyViolation[] = [];
  const bannedCalls = new Set(DEFAULT_BANNED_CALLS.python);
  const targetMod = extractRelativeImportTarget(opts.importHint);
  let testCount = 0;
  let assertionCount = 0;

  for (const imp of root.descendantsOfType(["import_statement", "import_from_statement"])) {
    const mod = imp.childForFieldName("module_name")?.text;
    const targets = mod ? [mod] : imp.childrenForFieldName("name").map((n) => n.text);
    for (const t of targets) {
      if (matchesBannedModule(t, bannedModules)) {
        violations.push({
          rule: "banned_import",
          message: `Banned Python import "${t}".`,
          line: imp.startPosition.row + 1,
        });
      }
    }
  }

  for (const fn of root.descendantsOfType("function_definition")) {
    const name = fn.childForFieldName("name")?.text ?? "";
    if (name.startsWith("test_")) {
      testCount += 1;
    }
  }

  for (const dec of root.descendantsOfType("decorator")) {
    const txt = dec.text;
    if (/pytest\.mark\.(?:only|skip)|unittest\.skip/.test(txt)) {
      violations.push({
        rule: "focus_or_skip",
        message: `Python focus/skip decorator "${txt.trim()}" is disallowed.`,
        line: dec.startPosition.row + 1,
      });
    }
  }

  for (const call of root.descendantsOfType("call")) {
    const fnText = call.childForFieldName("function")?.text ?? "";
    if (bannedCalls.has(fnText)) {
      violations.push({
        rule: "banned_call",
        message: `Banned Python call "${fnText}()".`,
        line: call.startPosition.row + 1,
      });
    }
    if (fnText === "pytest.raises") {
      assertionCount += 1;
    }
    if (
      targetMod &&
      (fnText === "patch" || fnText === "mock.patch" || fnText === "unittest.mock.patch" || fnText === "mocker.patch")
    ) {
      const arg0 =
        call
          .childForFieldName("arguments")
          ?.namedChild(0)
          ?.text.replace(/^['"]|['"]$/g, "") ?? "";
      if (arg0 === targetMod || arg0.startsWith(`${targetMod}.`)) {
        violations.push({
          rule: "mock_unit_under_test",
          message: `Cannot mock the unit under test ("${arg0}").`,
          line: call.startPosition.row + 1,
        });
      }
    }
  }

  for (const asrt of root.descendantsOfType("assert_statement")) {
    assertionCount += 1;
    const expr = asrt.namedChild(0);
    if (expr?.type === "true") {
      violations.push({
        rule: "tautological_assertion",
        message: "Tautological `assert True` is disallowed.",
        line: asrt.startPosition.row + 1,
      });
    } else if (expr?.type === "comparison_operator" && expr.namedChildCount === 2) {
      const l = isSimpleLiteral(expr.namedChild(0));
      const r = isSimpleLiteral(expr.namedChild(1));
      if (l !== null && r !== null && l === r && expr.text.includes("==")) {
        violations.push({
          rule: "tautological_assertion",
          message: `Tautological literal assertion "${asrt.text.trim()}".`,
          line: asrt.startPosition.row + 1,
        });
      }
    }
  }

  return { testCount, assertionCount, violations };
}

function checkJavaPolicy(
  root: Parser.SyntaxNode,
  opts: PolicyCheckOptions,
  bannedModules: readonly string[],
): { testCount: number; assertionCount: number; violations: PolicyViolation[] } {
  const violations: PolicyViolation[] = [];
  const bannedCalls = new Set(DEFAULT_BANNED_CALLS.java);
  const expectedClass = path.posix.parse(opts.testPath).name;
  let testCount = 0;
  let assertionCount = 0;

  const pkgHintMatch = /package\s+([A-Za-z0-9_.]+)\s*;/.exec(opts.importHint ?? "");
  if (pkgHintMatch?.[1]) {
    const pkgNode = root.descendantsOfType("package_declaration")[0];
    const actualPkg = pkgNode?.text
      .replace(/^package\s+/, "")
      .replace(/;$/, "")
      .trim();
    if (actualPkg && actualPkg !== pkgHintMatch[1]) {
      violations.push({
        rule: "java_package_mismatch",
        message: `Expected Java package "${pkgHintMatch[1]}", got "${actualPkg}".`,
        line: pkgNode ? pkgNode.startPosition.row + 1 : 1,
      });
    }
  }

  for (const cls of root.descendantsOfType("class_declaration")) {
    const clsMods = cls.children.find((c) => c.type === "modifiers")?.text ?? "";
    const clsName = cls.childForFieldName("name")?.text;
    if (/\bpublic\b/.test(clsMods) && clsName && clsName !== expectedClass) {
      violations.push({
        rule: "java_classname_mismatch",
        message: `Public Java test class "${clsName}" must match filename "${expectedClass}".`,
        line: cls.startPosition.row + 1,
      });
    }
  }

  for (const imp of root.descendantsOfType("import_declaration")) {
    const clean = imp.text
      .replace(/^import\s+(?:static\s+)?/, "")
      .replace(/;$/, "")
      .trim();
    if (matchesBannedModule(clean, bannedModules)) {
      violations.push({
        rule: "banned_import",
        message: `Banned Java import "${clean}".`,
        line: imp.startPosition.row + 1,
      });
    }
  }

  for (const ann of root.descendantsOfType(["marker_annotation", "annotation"])) {
    const name = ann.childForFieldName("name")?.text ?? "";
    if (name === "Test" || name.endsWith(".Test")) {
      testCount += 1;
    }
    if (name === "Disabled" || name === "Ignore" || name.endsWith(".Disabled") || name.endsWith(".Ignore")) {
      violations.push({
        rule: "focus_or_skip",
        message: `Skipped annotation "@${name}" is disallowed.`,
        line: ann.startPosition.row + 1,
      });
    }
  }

  for (const inv of root.descendantsOfType("method_invocation")) {
    const obj = inv.childForFieldName("object")?.text;
    const name = inv.childForFieldName("name")?.text ?? "";
    const fullName = obj ? `${obj}.${name}` : name;

    if (bannedCalls.has(fullName) || bannedCalls.has(fullName.replace(/^java\.lang\./, ""))) {
      violations.push({
        rule: "banned_call",
        message: `Banned Java call "${fullName}()".`,
        line: inv.startPosition.row + 1,
      });
    }

    if (/^(?:Assertions\.)?assert/.test(fullName) || name.startsWith("assert")) {
      assertionCount += 1;
      const args = inv.childForFieldName("arguments");
      if (name === "assertTrue" && args?.namedChildCount === 1 && args.namedChild(0)?.text === "true") {
        violations.push({
          rule: "tautological_assertion",
          message: "Tautological `assertTrue(true)` is disallowed.",
          line: inv.startPosition.row + 1,
        });
      } else if (name === "assertEquals" && args?.namedChildCount === 2) {
        const l = isSimpleLiteral(args.namedChild(0));
        const r = isSimpleLiteral(args.namedChild(1));
        if (l !== null && r !== null && l === r) {
          violations.push({
            rule: "tautological_assertion",
            message: `Tautological literal assertion "${inv.text}".`,
            line: inv.startPosition.row + 1,
          });
        }
      }
    }
  }

  return { testCount, assertionCount, violations };
}

export async function runStaticPolicyCheck(opts: PolicyCheckOptions): Promise<PolicyCheckResult> {
  const grammar =
    grammarForFilePath(opts.testPath) ??
    (opts.language === "python" ? "python" : opts.language === "java" ? "java" : "typescript");

  const parser = await createTreeSitterParser(grammar, opts.wasmDir);
  const tree = parser.parse(opts.content);
  const syntaxErrors = tree.rootNode.hasError;

  const extra = opts.extraBannedImports ? normalizeExtraBannedImports(opts.extraBannedImports, opts.language) : [];
  const bannedModules = [...DEFAULT_BANNED_IMPORTS[opts.language], ...extra];

  let checkRes: { testCount: number; assertionCount: number; violations: PolicyViolation[] };
  if (opts.language === "javascript") {
    checkRes = checkJsPolicy(tree.rootNode, opts, bannedModules);
  } else if (opts.language === "python") {
    checkRes = checkPythonPolicy(tree.rootNode, opts, bannedModules);
  } else {
    checkRes = checkJavaPolicy(tree.rootNode, opts, bannedModules);
  }

  tree.delete();
  parser.delete();

  const violations = [...checkRes.violations];
  if (syntaxErrors) {
    violations.unshift({
      rule: "syntax_error",
      message: `Syntax error detected while parsing generated test "${opts.testPath}".`,
    });
  }

  if (checkRes.testCount === 0) {
    violations.push({
      rule: "zero_tests",
      message: "Generated file contains zero test cases.",
    });
  }
  if (checkRes.assertionCount === 0) {
    violations.push({
      rule: "zero_assertions",
      message: "Generated file contains zero assertions.",
    });
  }

  const maxAllowed = (opts.maxTestsPerSymbol ?? 6) * Math.max(1, opts.targetCount ?? 1);
  if (checkRes.testCount > maxAllowed) {
    violations.push({
      rule: "over_test_cap",
      message: `Generated ${checkRes.testCount} tests exceeds cap of ${maxAllowed}.`,
    });
  }

  const contentBytes = Buffer.byteLength(opts.content, "utf8");
  if (contentBytes > 61_440) {
    violations.push({
      rule: "size_limit",
      message: `Generated file exceeds 60 KB limit (${contentBytes} bytes).`,
    });
  }

  return {
    ok: violations.length === 0,
    syntaxErrors,
    testCount: checkRes.testCount,
    assertionCount: checkRes.assertionCount,
    violations,
  };
}
