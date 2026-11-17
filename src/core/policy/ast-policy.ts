import path from "node:path";
import type Parser from "web-tree-sitter";

import type { LanguageKey } from "../../contracts";
import { createTreeSitterParser, grammarForFilePath } from "../parse";
import {
  DEFAULT_BANNED_CALLS,
  DEFAULT_BANNED_IMPORTS,
  DEFAULT_BANNED_JAVA_CONSTRUCTORS,
  normalizeExtraBannedImports,
} from "./banlist";

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

const JS_GLOBAL_ROOT_NAMES = new Set(["globalThis", "global", "window", "self"]);
const JS_BANNED_PROCESS_IMPORTS = new Set(["chdir", "exit", "kill", "getBuiltinModule", "dlopen"]);
const PY_BANNED_OS_ATTRS = new Set(["environ", "environb", "getenv", "putenv", "unsetenv", "system", "popen", "chdir"]);
const JAVA_STDLIB_PREFIX_RE = /^(?:java\.lang|java\.nio\.file|java\.net\.http)\./;

function matchesBannedModule(specifier: string, bannedList: readonly string[]): boolean {
  const clean = specifier.replace(/^['"`]|['"`]$/g, "").trim();
  return bannedList.some((b) => clean === b || clean.startsWith(`${b}/`) || clean.startsWith(`${b}.`));
}

function extractRelativeImportTarget(importHint?: string): string | null {
  if (!importHint) return null;
  const jsMatch = /from\s+["']([^"']+)["']/.exec(importHint);
  if (jsMatch?.[1]) return jsMatch[1];
  const cjsMatch = /require\s*\(\s*["']([^"']+)["']\s*\)/.exec(importHint);
  if (cjsMatch?.[1]) return cjsMatch[1];
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

function unwrapJsExpr(node: Parser.SyntaxNode | null | undefined): Parser.SyntaxNode | null {
  let cur = node ?? null;
  while (cur) {
    if (
      cur.type === "parenthesized_expression" ||
      cur.type === "as_expression" ||
      cur.type === "non_null_expression" ||
      cur.type === "satisfies_expression"
    ) {
      cur = cur.namedChild(0);
    } else if (cur.type === "type_assertion") {
      cur = cur.namedChild(1);
    } else {
      break;
    }
  }
  return cur;
}

function extractJsStringLiteral(node: Parser.SyntaxNode | null | undefined): string | null {
  const cur = unwrapJsExpr(node);
  if (!cur) return null;
  if (cur.type === "string") {
    return cur.text.slice(1, -1);
  }
  if (cur.type === "template_string") {
    const hasSub = cur.namedChildren.some((c) => c.type === "template_substitution");
    if (!hasSub) {
      return cur.text.slice(1, -1);
    }
  }
  return null;
}

function isJsProcessImport(specifier: string): boolean {
  return specifier === "process" || specifier === "node:process";
}

function isJsGlobalRoot(node: Parser.SyntaxNode | null | undefined, globalAliases: ReadonlySet<string>): boolean {
  const cur = unwrapJsExpr(node);
  if (!cur) return false;
  if (cur.type === "identifier") {
    return globalAliases.has(cur.text);
  }
  if (cur.type === "member_expression") {
    const prop = cur.childForFieldName("property")?.text ?? "";
    return JS_GLOBAL_ROOT_NAMES.has(prop) && isJsGlobalRoot(cur.childForFieldName("object"), globalAliases);
  }
  if (cur.type === "subscript_expression") {
    const key = extractJsStringLiteral(cur.childForFieldName("index"));
    return Boolean(
      key && JS_GLOBAL_ROOT_NAMES.has(key) && isJsGlobalRoot(cur.childForFieldName("object"), globalAliases),
    );
  }
  return false;
}

function isJsProcessRef(
  node: Parser.SyntaxNode | null | undefined,
  globalAliases: ReadonlySet<string>,
  processAliases: ReadonlySet<string>,
): boolean {
  const cur = unwrapJsExpr(node);
  if (!cur) return false;
  if (cur.type === "await_expression") {
    return isJsProcessRef(cur.namedChild(0), globalAliases, processAliases);
  }
  if (cur.type === "identifier") {
    return processAliases.has(cur.text);
  }
  if (cur.type === "member_expression") {
    const prop = cur.childForFieldName("property")?.text ?? "";
    return prop === "process" && isJsGlobalRoot(cur.childForFieldName("object"), globalAliases);
  }
  if (cur.type === "subscript_expression") {
    const key = extractJsStringLiteral(cur.childForFieldName("index"));
    return key === "process" && isJsGlobalRoot(cur.childForFieldName("object"), globalAliases);
  }
  if (cur.type === "call_expression") {
    const fn = unwrapJsExpr(cur.childForFieldName("function"));
    const fnName = fn?.type === "identifier" ? fn.text : fn?.type === "import" ? "import" : "";
    if (fnName === "require" || fnName === "import") {
      const arg0 = extractJsStringLiteral(cur.childForFieldName("arguments")?.namedChild(0));
      return Boolean(arg0 && isJsProcessImport(arg0));
    }
  }
  return false;
}

function extractJsObjectPatternProps(pattern: Parser.SyntaxNode): Array<{
  propName: string | null;
  valueNode: Parser.SyntaxNode | null;
  node: Parser.SyntaxNode;
}> {
  const props: Array<{ propName: string | null; valueNode: Parser.SyntaxNode | null; node: Parser.SyntaxNode }> = [];
  for (const rawChild of pattern.namedChildren) {
    const child =
      rawChild.type === "object_assignment_pattern"
        ? (rawChild.childForFieldName("left") ?? rawChild.namedChild(0))
        : rawChild;
    if (!child) continue;
    if (child.type === "shorthand_property_identifier_pattern") {
      props.push({ propName: child.text, valueNode: null, node: child });
    } else if (child.type === "pair_pattern") {
      const keyNode = child.childForFieldName("key");
      let propName: string | null = null;
      if (keyNode?.type === "computed_property_name") {
        propName = extractJsStringLiteral(keyNode.namedChild(0));
      } else if (keyNode) {
        propName = extractJsStringLiteral(keyNode) ?? keyNode.text;
      }
      props.push({ propName, valueNode: child.childForFieldName("value"), node: child });
    }
  }
  return props;
}

function collectJsAliases(root: Parser.SyntaxNode): {
  globalAliases: Set<string>;
  processAliases: Set<string>;
} {
  const globalAliases = new Set(JS_GLOBAL_ROOT_NAMES);
  const processAliases = new Set(["process"]);

  for (const imp of root.descendantsOfType("import_statement")) {
    const src = imp.childForFieldName("source")?.text.replace(/^['"]|['"]$/g, "") ?? "";
    if (!isJsProcessImport(src)) continue;
    const clause = imp.namedChildren.find((c) => c.type === "import_clause");
    if (!clause) continue;
    for (const ch of clause.namedChildren) {
      if (ch.type === "identifier") {
        processAliases.add(ch.text);
      } else if (ch.type === "namespace_import") {
        const aliasId = ch.namedChildren.find((n) => n.type === "identifier");
        if (aliasId) processAliases.add(aliasId.text);
      }
    }
  }

  for (const decl of root.descendantsOfType(["variable_declarator", "assignment_expression"])) {
    const lhs = decl.type === "variable_declarator" ? decl.childForFieldName("name") : decl.childForFieldName("left");
    const rhs = decl.type === "variable_declarator" ? decl.childForFieldName("value") : decl.childForFieldName("right");
    if (!lhs || !rhs) continue;
    if (lhs.type === "identifier") {
      if (isJsGlobalRoot(rhs, globalAliases)) {
        globalAliases.add(lhs.text);
      } else if (isJsProcessRef(rhs, globalAliases, processAliases)) {
        processAliases.add(lhs.text);
      }
    } else if (lhs.type === "object_pattern" && isJsGlobalRoot(rhs, globalAliases)) {
      for (const prop of extractJsObjectPatternProps(lhs)) {
        if (prop.propName === "process" && prop.valueNode?.type === "identifier") {
          processAliases.add(prop.valueNode.text);
        }
      }
    }
  }

  return { globalAliases, processAliases };
}

function checkJsObjectPatternOnTarget(
  pattern: Parser.SyntaxNode,
  targetExpr: Parser.SyntaxNode | null | undefined,
  globalAliases: ReadonlySet<string>,
  processAliases: ReadonlySet<string>,
  violations: PolicyViolation[],
): void {
  if (!targetExpr) return;
  if (isJsProcessRef(targetExpr, globalAliases, processAliases)) {
    for (const prop of extractJsObjectPatternProps(pattern)) {
      if (prop.propName === "env") {
        violations.push({
          rule: "banned_env_access",
          message: 'Banned destructuring of "env" from process.',
          line: prop.node.startPosition.row + 1,
        });
      }
    }
    return;
  }

  if (isJsGlobalRoot(targetExpr, globalAliases)) {
    for (const prop of extractJsObjectPatternProps(pattern)) {
      if (prop.propName === "process" && prop.valueNode?.type === "object_pattern") {
        for (const nested of extractJsObjectPatternProps(prop.valueNode)) {
          if (nested.propName === "env") {
            violations.push({
              rule: "banned_env_access",
              message: 'Banned nested destructuring of "process.env" from global object.',
              line: nested.node.startPosition.row + 1,
            });
          }
        }
      }
    }
  }
}

function resolveJsCalleeName(
  fnNode: Parser.SyntaxNode,
  globalAliases: ReadonlySet<string>,
  processAliases: ReadonlySet<string>,
): string {
  const cur = unwrapJsExpr(fnNode) ?? fnNode;
  if (cur.type === "identifier") {
    return cur.text;
  }
  if (cur.type === "import") {
    return "import";
  }
  if (cur.type === "member_expression" || cur.type === "subscript_expression") {
    const obj = cur.childForFieldName("object");
    const propName =
      cur.type === "member_expression"
        ? (cur.childForFieldName("property")?.text ?? null)
        : extractJsStringLiteral(cur.childForFieldName("index"));
    if (propName) {
      if (isJsGlobalRoot(obj, globalAliases)) {
        return propName;
      }
      if (isJsProcessRef(obj, globalAliases, processAliases)) {
        return `process.${propName}`;
      }
    }
  }
  return cur.text;
}

function isJsExpectChain(node: Parser.SyntaxNode | null | undefined): {
  isExpect: boolean;
  direct: boolean;
} {
  if (node?.type === "call_expression" && node.childForFieldName("function")?.text === "expect") {
    return { isExpect: true, direct: true };
  }
  let cur = node ?? null;
  let hops = 0;
  while (cur && cur.type === "member_expression" && hops < 3) {
    const prop = cur.childForFieldName("property")?.text ?? "";
    if (prop !== "not" && prop !== "resolves" && prop !== "rejects") {
      break;
    }
    const obj = cur.childForFieldName("object");
    if (obj?.type === "call_expression" && obj.childForFieldName("function")?.text === "expect") {
      return { isExpect: true, direct: false };
    }
    cur = obj;
    hops += 1;
  }
  return { isExpect: false, direct: false };
}

function checkJsPolicy(
  root: Parser.SyntaxNode,
  opts: PolicyCheckOptions,
  bannedModules: readonly string[],
): { testCount: number; assertionCount: number; violations: PolicyViolation[] } {
  const violations: PolicyViolation[] = [];
  const bannedCalls = new Set(DEFAULT_BANNED_CALLS.javascript);
  const targetImport = extractRelativeImportTarget(opts.importHint);
  const { globalAliases, processAliases } = collectJsAliases(root);
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
    if (isJsProcessImport(src)) {
      for (const spec of imp.descendantsOfType("import_specifier")) {
        const importedName = spec.childForFieldName("name")?.text ?? spec.namedChild(0)?.text ?? "";
        if (importedName === "env") {
          violations.push({
            rule: "banned_env_access",
            message: `Banned import of "env" from "${src}".`,
            line: spec.startPosition.row + 1,
          });
        } else if (JS_BANNED_PROCESS_IMPORTS.has(importedName)) {
          violations.push({
            rule: "banned_call",
            message: `Banned process import "${importedName}" from "${src}".`,
            line: spec.startPosition.row + 1,
          });
        }
      }
    }
  }

  for (const expr of root.descendantsOfType("new_expression")) {
    const ctorNode = expr.childForFieldName("constructor");
    const ctorName = ctorNode ? resolveJsCalleeName(ctorNode, globalAliases, processAliases) : "";
    if (ctorName === "Function") {
      violations.push({
        rule: "banned_call",
        message: "Dynamic function constructor `new Function` is banned.",
        line: expr.startPosition.row + 1,
      });
    } else if (ctorName === "XMLHttpRequest") {
      violations.push({
        rule: "banned_call",
        message: "Banned constructor `new XMLHttpRequest()`.",
        line: expr.startPosition.row + 1,
      });
    }
  }

  for (const mem of root.descendantsOfType("member_expression")) {
    const prop = mem.childForFieldName("property")?.text ?? "";
    if (prop === "env" && isJsProcessRef(mem.childForFieldName("object"), globalAliases, processAliases)) {
      violations.push({
        rule: "banned_env_access",
        message: 'Banned access to "process.env".',
        line: mem.startPosition.row + 1,
      });
    }
  }

  for (const sub of root.descendantsOfType("subscript_expression")) {
    const key = extractJsStringLiteral(sub.childForFieldName("index"));
    if (key === "env" && isJsProcessRef(sub.childForFieldName("object"), globalAliases, processAliases)) {
      violations.push({
        rule: "banned_env_access",
        message: 'Banned subscript access to `process["env"]`.',
        line: sub.startPosition.row + 1,
      });
    }
  }

  for (const bin of root.descendantsOfType("binary_expression")) {
    const hasInOp = bin.children.some((c) => !c.isNamed && c.text === "in");
    if (
      hasInOp &&
      extractJsStringLiteral(bin.childForFieldName("left")) === "env" &&
      isJsProcessRef(bin.childForFieldName("right"), globalAliases, processAliases)
    ) {
      violations.push({
        rule: "banned_env_access",
        message: 'Banned `"env" in process` inspection.',
        line: bin.startPosition.row + 1,
      });
    }
  }

  for (const decl of root.descendantsOfType([
    "variable_declarator",
    "assignment_expression",
    "assignment_pattern",
    "required_parameter",
    "optional_parameter",
  ])) {
    let lhs: Parser.SyntaxNode | null;
    let rhs: Parser.SyntaxNode | null;
    if (decl.type === "variable_declarator") {
      lhs = decl.childForFieldName("name");
      rhs = decl.childForFieldName("value");
    } else if (decl.type === "assignment_expression" || decl.type === "assignment_pattern") {
      lhs = decl.childForFieldName("left");
      rhs = decl.childForFieldName("right");
    } else {
      lhs = decl.childForFieldName("pattern");
      rhs = decl.childForFieldName("value");
    }
    if (lhs?.type === "object_pattern") {
      checkJsObjectPatternOnTarget(lhs, rhs, globalAliases, processAliases, violations);
    }
  }

  for (const call of root.descendantsOfType("call_expression")) {
    const fn = call.childForFieldName("function");
    const args = call.childForFieldName("arguments");
    if (!fn) continue;
    const fnText = fn.text;
    const calleeName = resolveJsCalleeName(fn, globalAliases, processAliases);

    if (calleeName === "require" || calleeName === "import" || calleeName === "process.getBuiltinModule") {
      const arg0Node = args?.namedChild(0);
      const arg0 = extractJsStringLiteral(arg0Node) ?? arg0Node?.text.replace(/^['"`]|['"`]$/g, "") ?? "";
      if (matchesBannedModule(arg0, bannedModules)) {
        violations.push({
          rule: "banned_import",
          message: `Banned dynamic import/require "${arg0}".`,
          line: call.startPosition.row + 1,
        });
      }
    }

    if (bannedCalls.has(calleeName)) {
      violations.push({
        rule: "banned_call",
        message: `Banned call "${calleeName}()".`,
        line: call.startPosition.row + 1,
      });
    }

    if (
      (calleeName === "Reflect.get" || calleeName === "Object.getOwnPropertyDescriptor") &&
      isJsProcessRef(args?.namedChild(0), globalAliases, processAliases) &&
      extractJsStringLiteral(args?.namedChild(1)) === "env"
    ) {
      violations.push({
        rule: "banned_env_access",
        message: `Banned env lookup via "${calleeName}(process, 'env')".`,
        line: call.startPosition.row + 1,
      });
    }

    if (
      /^(?:it|test|describe)(?:\.concurrent)?\.(?:only|skip)$/.test(fnText) ||
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
      const expectChain = isJsExpectChain(obj);
      if (expectChain.isExpect) {
        assertionCount += 1;
        if (expectChain.direct && (prop === "toBe" || prop === "toEqual" || prop === "toStrictEqual")) {
          const leftLit = isSimpleLiteral(obj?.childForFieldName("arguments")?.namedChild(0));
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

function extractPythonImportNameAndAlias(node: Parser.SyntaxNode): { name: string; alias?: string } {
  if (node.type === "aliased_import") {
    return {
      name: node.childForFieldName("name")?.text ?? "",
      alias: node.childForFieldName("alias")?.text,
    };
  }
  return { name: node.text };
}

function extractPythonStringLiteral(node: Parser.SyntaxNode | null | undefined): string | null {
  if (!node || node.type !== "string") return null;
  if (node.namedChildren.some((c) => c.type === "interpolation")) return null;
  const contentParts = node.namedChildren.filter((c) => c.type === "string_content").map((c) => c.text);
  if (contentParts.length > 0) {
    return contentParts.join("");
  }
  return node.text.replace(/^[rRuUfFbB]{0,2}(?:'''|"""|'|")|(?:'''|"""|'|")$/g, "");
}

function checkPythonPolicy(
  root: Parser.SyntaxNode,
  opts: PolicyCheckOptions,
  bannedModules: readonly string[],
): { testCount: number; assertionCount: number; violations: PolicyViolation[] } {
  const violations: PolicyViolation[] = [];
  const bannedCalls = new Set(DEFAULT_BANNED_CALLS.python);
  const targetMod = extractRelativeImportTarget(opts.importHint);
  const osAliases = new Set(["os"]);
  const builtinsAliases = new Set(["builtins"]);
  const envAliases = new Set<string>();
  const callAliases = new Map<string, string>();
  let testCount = 0;
  let assertionCount = 0;

  for (const imp of root.descendantsOfType("import_statement")) {
    for (const targetNode of imp.childrenForFieldName("name")) {
      const { name, alias } = extractPythonImportNameAndAlias(targetNode);
      if (matchesBannedModule(name, bannedModules)) {
        violations.push({
          rule: "banned_import",
          message: `Banned Python import "${name}".`,
          line: imp.startPosition.row + 1,
        });
      }
      if (name === "os") {
        osAliases.add(alias ?? "os");
      } else if (name === "builtins") {
        builtinsAliases.add(alias ?? "builtins");
      }
    }
  }

  for (const imp of root.descendantsOfType("import_from_statement")) {
    const mod = imp.childForFieldName("module_name")?.text ?? "";
    if (mod && matchesBannedModule(mod, bannedModules)) {
      violations.push({
        rule: "banned_import",
        message: `Banned Python import "${mod}".`,
        line: imp.startPosition.row + 1,
      });
      continue;
    }

    if (imp.children.some((c) => c.type === "wildcard_import")) {
      if (mod === "os" || mod === "builtins" || mod === "shutil" || mod === "importlib") {
        violations.push({
          rule: "banned_import",
          message: `Banned Python wildcard import "from ${mod} import *".`,
          line: imp.startPosition.row + 1,
        });
      }
      continue;
    }

    for (const targetNode of imp.childrenForFieldName("name")) {
      const { name, alias } = extractPythonImportNameAndAlias(targetNode);
      const qualified = mod ? `${mod}.${name}` : name;
      if (matchesBannedModule(qualified, bannedModules) || bannedCalls.has(qualified)) {
        violations.push({
          rule: "banned_import",
          message: `Banned Python import "${qualified}".`,
          line: imp.startPosition.row + 1,
        });
      }
      if (qualified === "os.environ" || qualified === "os.environb") {
        envAliases.add(alias ?? name);
      } else if (bannedCalls.has(qualified)) {
        callAliases.set(alias ?? name, qualified);
      }
    }
  }

  for (const attr of root.descendantsOfType("attribute")) {
    const obj = attr.childForFieldName("object");
    const prop = attr.childForFieldName("attribute")?.text ?? "";
    if (obj?.type === "identifier" && osAliases.has(obj.text) && (prop === "environ" || prop === "environb")) {
      violations.push({
        rule: "banned_env_access",
        message: `Banned Python env access "${obj.text}.${prop}".`,
        line: attr.startPosition.row + 1,
      });
    }
  }

  for (const sub of root.descendantsOfType("subscript")) {
    const val = sub.childForFieldName("value");
    if (val?.type === "identifier" && envAliases.has(val.text)) {
      violations.push({
        rule: "banned_env_access",
        message: `Banned Python env subscript "${val.text}[...]".`,
        line: sub.startPosition.row + 1,
      });
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
    const fnNode = call.childForFieldName("function");
    const fnText = fnNode?.text ?? "";
    let canonicalFn = fnText;
    if (fnNode?.type === "identifier" && callAliases.has(fnNode.text)) {
      canonicalFn = callAliases.get(fnNode.text)!;
    } else if (fnNode?.type === "attribute") {
      const obj = fnNode.childForFieldName("object");
      const prop = fnNode.childForFieldName("attribute")?.text ?? "";
      if (obj?.type === "identifier" && osAliases.has(obj.text)) {
        canonicalFn = `os.${prop}`;
      } else if (obj?.type === "identifier" && builtinsAliases.has(obj.text)) {
        canonicalFn = prop;
      }
    }

    if (bannedCalls.has(canonicalFn)) {
      violations.push({
        rule: "banned_call",
        message: `Banned Python call "${canonicalFn}()".`,
        line: call.startPosition.row + 1,
      });
    }

    if (canonicalFn === "getattr") {
      const args = call.childForFieldName("arguments");
      const arg0 = args?.namedChild(0);
      const arg1 = extractPythonStringLiteral(args?.namedChild(1));
      if (arg0?.type === "identifier" && osAliases.has(arg0.text) && arg1 && PY_BANNED_OS_ATTRS.has(arg1)) {
        violations.push({
          rule: arg1 === "environ" || arg1 === "environb" ? "banned_env_access" : "banned_call",
          message: `Banned Python reflection access "getattr(${arg0.text}, '${arg1}')".`,
          line: call.startPosition.row + 1,
        });
      }
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

function extractJavaCreationTypeName(expr: Parser.SyntaxNode): string {
  const typeNode = expr.childForFieldName("type");
  if (!typeNode) return "";
  if (typeNode.type === "generic_type") {
    return typeNode.namedChild(0)?.text ?? typeNode.text;
  }
  return typeNode.text;
}

function checkJavaPolicy(
  root: Parser.SyntaxNode,
  opts: PolicyCheckOptions,
  bannedModules: readonly string[],
): { testCount: number; assertionCount: number; violations: PolicyViolation[] } {
  const violations: PolicyViolation[] = [];
  const bannedCalls = new Set(DEFAULT_BANNED_CALLS.java);
  const bannedConstructors = new Set(DEFAULT_BANNED_JAVA_CONSTRUCTORS);
  for (const mod of bannedModules) {
    if (mod.startsWith("org.junit.")) continue;
    bannedConstructors.add(mod);
    const dotIdx = mod.lastIndexOf(".");
    if (dotIdx !== -1) {
      bannedConstructors.add(mod.slice(dotIdx + 1));
    }
  }

  const staticWildcardClasses = new Set<string>();
  const staticMethodAliases = new Map<string, string>();
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
    const isStatic = /\bstatic\b/.test(imp.text);
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
    } else if (isStatic) {
      const shortStatic = clean.replace(JAVA_STDLIB_PREFIX_RE, "");
      if (clean.endsWith(".*")) {
        const cls = shortStatic.slice(0, -2);
        if (cls === "System" || cls === "Runtime" || cls === "Files" || cls === "HttpClient") {
          staticWildcardClasses.add(cls);
        }
      } else if (bannedCalls.has(clean) || bannedCalls.has(shortStatic)) {
        violations.push({
          rule: "banned_import",
          message: `Banned Java static import "${clean}".`,
          line: imp.startPosition.row + 1,
        });
        const dotIdx = shortStatic.lastIndexOf(".");
        if (dotIdx !== -1) {
          staticMethodAliases.set(shortStatic.slice(dotIdx + 1), shortStatic);
        }
      }
    }
  }

  for (const expr of root.descendantsOfType("object_creation_expression")) {
    const typeName = extractJavaCreationTypeName(expr);
    if (bannedConstructors.has(typeName)) {
      violations.push({
        rule: "banned_call",
        message: `Banned Java instantiation "new ${typeName}(...)".`,
        line: expr.startPosition.row + 1,
      });
    }
  }

  for (const ref of root.descendantsOfType("method_reference")) {
    const parts = ref.namedChildren;
    if (parts.length === 0) continue;
    const lhs = parts[0]?.text ?? "";
    const normLhs = lhs.replace(JAVA_STDLIB_PREFIX_RE, "");
    if (ref.text.endsWith("::new")) {
      if (bannedConstructors.has(lhs) || bannedConstructors.has(normLhs)) {
        violations.push({
          rule: "banned_call",
          message: `Banned Java constructor reference "${ref.text}".`,
          line: ref.startPosition.row + 1,
        });
      }
    } else if (parts.length >= 2) {
      const rhs = parts[parts.length - 1]?.text ?? "";
      const target = `${normLhs}.${rhs}`;
      if (bannedCalls.has(target)) {
        violations.push({
          rule: "banned_call",
          message: `Banned Java method reference "${ref.text}".`,
          line: ref.startPosition.row + 1,
        });
      }
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
    const normalizedName = fullName.replace(JAVA_STDLIB_PREFIX_RE, "");

    if (bannedCalls.has(fullName) || bannedCalls.has(normalizedName)) {
      violations.push({
        rule: "banned_call",
        message: `Banned Java call "${fullName}()".`,
        line: inv.startPosition.row + 1,
      });
    } else if (!obj) {
      if (staticMethodAliases.has(name)) {
        violations.push({
          rule: "banned_call",
          message: `Banned Java static call "${staticMethodAliases.get(name)}()".`,
          line: inv.startPosition.row + 1,
        });
      } else {
        for (const cls of staticWildcardClasses) {
          if (bannedCalls.has(`${cls}.${name}`)) {
            violations.push({
              rule: "banned_call",
              message: `Banned Java static call "${cls}.${name}()".`,
              line: inv.startPosition.row + 1,
            });
            break;
          }
        }
      }
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
  let syntaxErrors: boolean;
  let checkRes: { testCount: number; assertionCount: number; violations: PolicyViolation[] };
  try {
    syntaxErrors = tree.rootNode.hasError;

    const extra = opts.extraBannedImports ? normalizeExtraBannedImports(opts.extraBannedImports, opts.language) : [];
    const bannedModules = [...DEFAULT_BANNED_IMPORTS[opts.language], ...extra];

    if (opts.language === "javascript") {
      checkRes = checkJsPolicy(tree.rootNode, opts, bannedModules);
    } else if (opts.language === "python") {
      checkRes = checkPythonPolicy(tree.rootNode, opts, bannedModules);
    } else {
      checkRes = checkJavaPolicy(tree.rootNode, opts, bannedModules);
    }
  } finally {
    tree.delete();
    parser.delete();
  }

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
