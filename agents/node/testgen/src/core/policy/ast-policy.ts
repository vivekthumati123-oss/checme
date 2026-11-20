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
  targetSymbolNames?: readonly string[];
  targetCount?: number;
  maxTestsPerSymbol?: number;
  extraBannedImports?: Record<string, string[]>;
  wasmDir?: string;
}

const JS_GLOBAL_ROOT_NAMES = new Set(["globalThis", "global", "window", "self"]);
const JS_BANNED_PROCESS_IMPORTS = new Set([
  "chdir",
  "exit",
  "kill",
  "getBuiltinModule",
  "dlopen",
  "binding",
  "_linkedBinding",
  "mainModule",
]);
const JS_TRACKED_GLOBAL_FUNCTIONS = new Set(["eval", "Function", "fetch", "XMLHttpRequest", "require"]);
const PY_BANNED_OS_ATTRS = new Set([
  "environ",
  "environb",
  "getenv",
  "putenv",
  "unsetenv",
  "system",
  "popen",
  "chdir",
  "execv",
  "execl",
  "execve",
  "execvp",
  "execvpe",
  "execlp",
  "execle",
  "execlpe",
  "spawnv",
  "spawnl",
  "spawnve",
  "spawnvp",
  "spawnvpe",
  "spawnlp",
  "spawnle",
  "spawnlpe",
  "posix_spawn",
  "posix_spawnp",
  "fork",
  "forkpty",
  "kill",
  "remove",
  "unlink",
  "rmdir",
  "rename",
  "replace",
  "__dict__",
]);
const PY_BANNED_BUILTIN_ATTRS = new Set(["eval", "exec", "__import__", "__dict__"]);
const JAVA_STDLIB_PREFIX_RE =
  /^(?:java\.lang|java\.nio\.file|java\.net\.http|java\.lang\.invoke|java\.nio\.channels|javax\.net\.ssl|javax\.net)\./;

function matchesBannedModule(specifier: string, bannedList: readonly string[]): boolean {
  const clean = specifier.replace(/^['"`]|['"`]$/g, "").trim();
  return bannedList.some((raw) => {
    const b = raw.trim();
    if (!b) return false;
    if (b.endsWith(".*")) {
      const prefix = b.slice(0, -2);
      return clean === b || clean === prefix || clean.startsWith(`${prefix}.`);
    }
    if (b.endsWith("/*")) {
      const prefix = b.slice(0, -2);
      return clean === b || clean === prefix || clean.startsWith(`${prefix}/`);
    }
    return clean === b || clean.startsWith(`${b}/`) || clean.startsWith(`${b}.`);
  });
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
    } else if (cur.type === "sequence_expression") {
      cur = cur.namedChildCount > 0 ? cur.namedChild(cur.namedChildCount - 1) : null;
    } else if (cur.type === "type_assertion") {
      cur = cur.namedChild(1);
    } else {
      break;
    }
  }
  return cur;
}

function decodeJsStringBody(raw: string): string {
  return raw.replace(/\\(x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|u\{[0-9a-fA-F]+\}|n|r|t|\\|'|")/g, (m, esc: string) => {
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
  });
}

function extractJsStringLiteral(node: Parser.SyntaxNode | null | undefined, depth = 0): string | null {
  if (depth > 16) return null;
  const cur = unwrapJsExpr(node);
  if (!cur) return null;
  if (cur.type === "string") {
    return decodeJsStringBody(cur.text.slice(1, -1));
  }
  if (cur.type === "template_string") {
    const hasSub = cur.namedChildren.some((c) => c.type === "template_substitution");
    if (!hasSub) {
      return decodeJsStringBody(cur.text.slice(1, -1));
    }
  }
  if (cur.type === "binary_expression") {
    const hasPlus = cur.children.some((c) => !c.isNamed && c.text === "+");
    if (hasPlus) {
      const left = extractJsStringLiteral(cur.childForFieldName("left"), depth + 1);
      const right = extractJsStringLiteral(cur.childForFieldName("right"), depth + 1);
      if (left !== null && right !== null) {
        return `${left}${right}`;
      }
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
    const obj = cur.childForFieldName("object");
    if (prop === "process" && isJsGlobalRoot(obj, globalAliases)) return true;
    if (prop === "default" && isJsProcessRef(obj, globalAliases, processAliases)) return true;
    return false;
  }
  if (cur.type === "subscript_expression") {
    const key = extractJsStringLiteral(cur.childForFieldName("index"));
    const obj = cur.childForFieldName("object");
    if (key === "process" && isJsGlobalRoot(obj, globalAliases)) return true;
    if (key === "default" && isJsProcessRef(obj, globalAliases, processAliases)) return true;
    return false;
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

function isJsBuiltinContainer(
  node: Parser.SyntaxNode | null | undefined,
  targetName: "Reflect" | "Object",
  globalAliases: ReadonlySet<string>,
  containerAliases: ReadonlySet<string>,
): boolean {
  const cur = unwrapJsExpr(node);
  if (!cur) return false;
  if (cur.type === "identifier") {
    return containerAliases.has(cur.text);
  }
  if (cur.type === "member_expression") {
    return (
      cur.childForFieldName("property")?.text === targetName &&
      isJsGlobalRoot(cur.childForFieldName("object"), globalAliases)
    );
  }
  if (cur.type === "subscript_expression") {
    return (
      extractJsStringLiteral(cur.childForFieldName("index")) === targetName &&
      isJsGlobalRoot(cur.childForFieldName("object"), globalAliases)
    );
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
  reflectAliases: Set<string>;
  objectAliases: Set<string>;
  callAliases: Map<string, string>;
} {
  const globalAliases = new Set(JS_GLOBAL_ROOT_NAMES);
  const processAliases = new Set(["process"]);
  const reflectAliases = new Set(["Reflect"]);
  const objectAliases = new Set(["Object"]);
  const callAliases = new Map<string, string>();

  // Ignore locally shadowed `self` declarations (e.g. `const self = this` or parameter `(self)`) unless bound to global root.
  for (const param of root.descendantsOfType(["required_parameter", "optional_parameter"])) {
    const pat = param.childForFieldName("pattern");
    const val = param.childForFieldName("value");
    if (pat?.type === "identifier" && pat.text === "self" && !isJsGlobalRoot(val, globalAliases)) {
      globalAliases.delete("self");
    }
  }
  for (const decl of root.descendantsOfType("variable_declarator")) {
    const nameNode = decl.childForFieldName("name");
    const valNode = decl.childForFieldName("value");
    if (nameNode?.type === "identifier" && nameNode.text === "self" && !isJsGlobalRoot(valNode, globalAliases)) {
      globalAliases.delete("self");
    }
  }

  for (const imp of root.descendantsOfType("import_statement")) {
    const src = extractJsStringLiteral(imp.childForFieldName("source")) ?? "";
    if (!isJsProcessImport(src)) continue;
    const clause = imp.namedChildren.find((c) => c.type === "import_clause");
    if (!clause) continue;
    for (const ch of clause.namedChildren) {
      if (ch.type === "identifier") {
        processAliases.add(ch.text);
      } else if (ch.type === "namespace_import") {
        const aliasId = ch.namedChildren.find((n) => n.type === "identifier");
        if (aliasId) processAliases.add(aliasId.text);
      } else if (ch.type === "named_imports") {
        for (const spec of ch.descendantsOfType("import_specifier")) {
          const nameNode = spec.childForFieldName("name") ?? spec.namedChild(0);
          const importedName = extractJsStringLiteral(nameNode) ?? nameNode?.text ?? "";
          const localName = spec.childForFieldName("alias")?.text ?? importedName;
          if (importedName === "default" && localName) {
            processAliases.add(localName);
          }
        }
      }
    }
  }

  for (const impReq of root.descendantsOfType("import_require_clause")) {
    const src = extractJsStringLiteral(impReq.childForFieldName("source")) ?? "";
    const idNode = impReq.namedChildren.find((c) => c.type === "identifier");
    if (idNode && isJsProcessImport(src)) {
      processAliases.add(idNode.text);
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
    if (!lhs || !rhs) continue;
    if (lhs.type === "identifier") {
      if (isJsGlobalRoot(rhs, globalAliases)) {
        globalAliases.add(lhs.text);
      } else if (isJsProcessRef(rhs, globalAliases, processAliases)) {
        processAliases.add(lhs.text);
      } else if (isJsBuiltinContainer(rhs, "Reflect", globalAliases, reflectAliases)) {
        reflectAliases.add(lhs.text);
      } else if (isJsBuiltinContainer(rhs, "Object", globalAliases, objectAliases)) {
        objectAliases.add(lhs.text);
      } else {
        const callee = resolveJsCalleeName(
          rhs,
          globalAliases,
          processAliases,
          reflectAliases,
          objectAliases,
          callAliases,
        );
        if (JS_TRACKED_GLOBAL_FUNCTIONS.has(callee) || callee.startsWith("process.") || callee === "Reflect.get") {
          callAliases.set(lhs.text, callee);
        }
      }
    } else if (lhs.type === "object_pattern") {
      if (isJsGlobalRoot(rhs, globalAliases)) {
        for (const prop of extractJsObjectPatternProps(lhs)) {
          const targetId = prop.valueNode?.type === "identifier" ? prop.valueNode.text : prop.propName;
          if (!targetId) continue;
          if (prop.propName === "process") processAliases.add(targetId);
          else if (prop.propName === "Reflect") reflectAliases.add(targetId);
          else if (prop.propName === "Object") objectAliases.add(targetId);
          else if (prop.propName && JS_TRACKED_GLOBAL_FUNCTIONS.has(prop.propName)) {
            callAliases.set(targetId, prop.propName);
          }
        }
      } else if (isJsProcessRef(rhs, globalAliases, processAliases)) {
        for (const prop of extractJsObjectPatternProps(lhs)) {
          const targetId = prop.valueNode?.type === "identifier" ? prop.valueNode.text : prop.propName;
          if (targetId && prop.propName && JS_BANNED_PROCESS_IMPORTS.has(prop.propName)) {
            callAliases.set(targetId, `process.${prop.propName}`);
          }
        }
      }
    } else if (lhs.type === "array_pattern" && unwrapJsExpr(rhs)?.type === "array") {
      const rhsItems = unwrapJsExpr(rhs)!.namedChildren;
      const lhsItems = lhs.namedChildren;
      for (let i = 0; i < Math.min(lhsItems.length, rhsItems.length); i += 1) {
        const lItem = lhsItems[i];
        const rItem = rhsItems[i];
        if (lItem?.type === "identifier" && rItem) {
          if (isJsGlobalRoot(rItem, globalAliases)) globalAliases.add(lItem.text);
          else if (isJsProcessRef(rItem, globalAliases, processAliases)) processAliases.add(lItem.text);
        }
      }
    }
  }

  return { globalAliases, processAliases, reflectAliases, objectAliases, callAliases };
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
    for (const child of pattern.namedChildren) {
      if (child.type === "rest_pattern") {
        violations.push({
          rule: "banned_env_access",
          message: "Banned rest destructuring `{...rest} = process` exposes process.env.",
          line: child.startPosition.row + 1,
        });
      }
    }
    for (const prop of extractJsObjectPatternProps(pattern)) {
      if (prop.propName === "env" || prop.propName === null) {
        violations.push({
          rule: "banned_env_access",
          message:
            prop.propName === "env"
              ? 'Banned destructuring of "env" from process.'
              : "Banned computed destructuring on process.",
          line: prop.node.startPosition.row + 1,
        });
      }
    }
    return;
  }

  if (isJsGlobalRoot(targetExpr, globalAliases)) {
    for (const prop of extractJsObjectPatternProps(pattern)) {
      if (prop.propName === "process" && prop.valueNode?.type === "object_pattern") {
        checkJsObjectPatternOnTarget(prop.valueNode, prop.valueNode, globalAliases, processAliases, violations);
        for (const nested of extractJsObjectPatternProps(prop.valueNode)) {
          if (nested.propName === "env") {
            violations.push({
              rule: "banned_env_access",
              message: 'Banned nested destructuring of "process.env" from global object.',
              line: nested.node.startPosition.row + 1,
            });
          }
        }
        for (const rest of prop.valueNode.namedChildren) {
          if (rest.type === "rest_pattern") {
            violations.push({
              rule: "banned_env_access",
              message: "Banned nested rest destructuring of process from global object.",
              line: rest.startPosition.row + 1,
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
  reflectAliases: ReadonlySet<string> = new Set(["Reflect"]),
  objectAliases: ReadonlySet<string> = new Set(["Object"]),
  callAliases: ReadonlyMap<string, string> = new Map(),
): string {
  const cur = unwrapJsExpr(fnNode) ?? fnNode;
  if (cur.type === "identifier") {
    return callAliases.get(cur.text) ?? cur.text;
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
    if (propName === "call" || propName === "apply" || propName === "bind") {
      if (obj) {
        return resolveJsCalleeName(obj, globalAliases, processAliases, reflectAliases, objectAliases, callAliases);
      }
    }
    if (propName) {
      if (propName === "require") {
        const unwrappedObj = unwrapJsExpr(obj);
        if (unwrappedObj?.type === "identifier" && unwrappedObj.text === "module") {
          return "require";
        }
        if (
          unwrappedObj?.type === "member_expression" &&
          unwrapJsExpr(unwrappedObj.childForFieldName("object"))?.text === "require" &&
          unwrappedObj.childForFieldName("property")?.text === "main"
        ) {
          return "require";
        }
      }
      if (isJsGlobalRoot(obj, globalAliases)) {
        return propName;
      }
      if (isJsProcessRef(obj, globalAliases, processAliases)) {
        return `process.${propName}`;
      }
      if (isJsBuiltinContainer(obj, "Reflect", globalAliases, reflectAliases)) {
        return `Reflect.${propName}`;
      }
      if (isJsBuiltinContainer(obj, "Object", globalAliases, objectAliases)) {
        return `Object.${propName}`;
      }
    }
  }
  return cur.text;
}

function isJsExpectCall(node: Parser.SyntaxNode | null | undefined): boolean {
  if (node?.type !== "call_expression") return false;
  const fn = node.childForFieldName("function");
  if (fn?.text === "expect") return true;
  if (fn?.type === "member_expression" && fn.childForFieldName("object")?.text === "expect") {
    const prop = fn.childForFieldName("property")?.text;
    return prop === "soft" || prop === "poll";
  }
  return false;
}

function isJsExpectChain(node: Parser.SyntaxNode | null | undefined): {
  isExpect: boolean;
  direct: boolean;
} {
  if (isJsExpectCall(node)) {
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
    if (isJsExpectCall(obj)) {
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
  const { globalAliases, processAliases, reflectAliases, objectAliases, callAliases } = collectJsAliases(root);
  let testCount = 0;
  let assertionCount = 0;

  for (const imp of root.descendantsOfType("import_statement")) {
    const src = extractJsStringLiteral(imp.childForFieldName("source")) ?? "";
    if (matchesBannedModule(src, bannedModules)) {
      violations.push({
        rule: "banned_import",
        message: `Banned module import "${src}".`,
        line: imp.startPosition.row + 1,
      });
    }
    if (isJsProcessImport(src)) {
      for (const spec of imp.descendantsOfType("import_specifier")) {
        const nameNode = spec.childForFieldName("name") ?? spec.namedChild(0);
        const importedName = extractJsStringLiteral(nameNode) ?? nameNode?.text ?? "";
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

  for (const exp of root.descendantsOfType("export_statement")) {
    const srcNode = exp.childForFieldName("source");
    if (!srcNode) continue;
    const src = extractJsStringLiteral(srcNode) ?? "";
    if (matchesBannedModule(src, bannedModules)) {
      violations.push({
        rule: "banned_import",
        message: `Banned module re-export "${src}".`,
        line: exp.startPosition.row + 1,
      });
    }
    if (isJsProcessImport(src)) {
      violations.push({
        rule: "banned_env_access",
        message: `Banned process re-export from "${src}".`,
        line: exp.startPosition.row + 1,
      });
    }
  }

  for (const impReq of root.descendantsOfType("import_require_clause")) {
    const src = extractJsStringLiteral(impReq.childForFieldName("source")) ?? "";
    if (matchesBannedModule(src, bannedModules)) {
      violations.push({
        rule: "banned_import",
        message: `Banned TypeScript import-require "${src}".`,
        line: impReq.startPosition.row + 1,
      });
    }
  }

  for (const expr of root.descendantsOfType("new_expression")) {
    const ctorNode = expr.childForFieldName("constructor");
    const ctorName = ctorNode
      ? resolveJsCalleeName(ctorNode, globalAliases, processAliases, reflectAliases, objectAliases, callAliases)
      : "";
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
    if (isJsProcessRef(mem.childForFieldName("object"), globalAliases, processAliases)) {
      if (prop === "env") {
        violations.push({
          rule: "banned_env_access",
          message: 'Banned access to "process.env".',
          line: mem.startPosition.row + 1,
        });
      } else if (prop === "mainModule") {
        violations.push({
          rule: "banned_call",
          message: 'Banned access to "process.mainModule".',
          line: mem.startPosition.row + 1,
        });
      }
    }
  }

  for (const sub of root.descendantsOfType("subscript_expression")) {
    const obj = sub.childForFieldName("object");
    const key = extractJsStringLiteral(sub.childForFieldName("index"));
    if (isJsProcessRef(obj, globalAliases, processAliases)) {
      if (key === "env" || key === null) {
        violations.push({
          rule: "banned_env_access",
          message:
            key === "env"
              ? 'Banned subscript access to `process["env"]`.'
              : "Banned computed subscript access on process.",
          line: sub.startPosition.row + 1,
        });
      } else if (key === "mainModule") {
        violations.push({
          rule: "banned_call",
          message: 'Banned subscript access to `process["mainModule"]`.',
          line: sub.startPosition.row + 1,
        });
      }
    } else if (isJsGlobalRoot(obj, globalAliases) && (key === "process" || key === null)) {
      violations.push({
        rule: "banned_env_access",
        message: "Banned computed or process subscript access on global object.",
        line: sub.startPosition.row + 1,
      });
    }
  }

  for (const spread of root.descendantsOfType("spread_element")) {
    if (isJsProcessRef(spread.namedChild(0), globalAliases, processAliases)) {
      violations.push({
        rule: "banned_env_access",
        message: "Banned spread `{ ...process }` exposes process.env.",
        line: spread.startPosition.row + 1,
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
    const calleeName = resolveJsCalleeName(
      fn,
      globalAliases,
      processAliases,
      reflectAliases,
      objectAliases,
      callAliases,
    );

    if (calleeName === "require" || calleeName === "import" || calleeName === "process.getBuiltinModule") {
      const arg0Node = args?.namedChild(0);
      const arg0Lit = extractJsStringLiteral(arg0Node);
      if (arg0Node && arg0Lit === null) {
        violations.push({
          rule: "banned_import",
          message: `Dynamic ${calleeName}() argument is disallowed.`,
          line: call.startPosition.row + 1,
        });
      } else if (
        arg0Lit !== null &&
        (matchesBannedModule(arg0Lit, bannedModules) || /^(?:data|file|https?):/i.test(arg0Lit))
      ) {
        violations.push({
          rule: "banned_import",
          message: `Banned dynamic import/require "${arg0Lit}".`,
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

    if (calleeName === "Reflect.get" || calleeName === "Object.getOwnPropertyDescriptor") {
      const targetArg = args?.namedChild(0);
      const propKey = extractJsStringLiteral(args?.namedChild(1));
      if (isJsProcessRef(targetArg, globalAliases, processAliases)) {
        if (propKey === "env" || propKey === null) {
          violations.push({
            rule: "banned_env_access",
            message: `Banned env lookup via "${calleeName}(process, ...)".`,
            line: call.startPosition.row + 1,
          });
        }
      } else if (isJsGlobalRoot(targetArg, globalAliases)) {
        if (propKey === "process" || propKey === null) {
          violations.push({
            rule: "banned_env_access",
            message: `Banned process lookup via "${calleeName}(global, ...)".`,
            line: call.startPosition.row + 1,
          });
        }
      }
    }

    if (
      calleeName === "Object.assign" &&
      (args?.namedChildren ?? []).some((arg) => isJsProcessRef(arg, globalAliases, processAliases))
    ) {
      violations.push({
        rule: "banned_env_access",
        message: 'Banned "Object.assign(..., process)" exposes process.env.',
        line: call.startPosition.row + 1,
      });
    }

    if (
      (calleeName === "Object.getOwnPropertyDescriptors" ||
        calleeName === "Object.entries" ||
        calleeName === "Object.keys" ||
        calleeName === "Object.values") &&
      (isJsProcessRef(args?.namedChild(0), globalAliases, processAliases) ||
        isJsGlobalRoot(args?.namedChild(0), globalAliases))
    ) {
      violations.push({
        rule: "banned_env_access",
        message: `Banned reflective inspection "${calleeName}(...)" on process/global.`,
        line: call.startPosition.row + 1,
      });
    }

    if (
      /^(?:it|test|describe)(?:\.(?:concurrent|sequential))?(?:\.(?:each|for))?\.(?:only|skip)$/.test(fnText) ||
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

    if (
      /^(?:it|test)(?:\.(?:concurrent|sequential))?$/.test(fnText) ||
      (fn.type === "call_expression" &&
        /^(?:it|test)(?:\.(?:concurrent|sequential))?\.(?:each|for)$/.test(
          fn.childForFieldName("function")?.text ?? "",
        ))
    ) {
      testCount += 1;
    }

    if (
      targetImport &&
      (fnText === "vi.mock" || fnText === "jest.mock" || fnText === "vi.doMock" || fnText === "jest.doMock")
    ) {
      const arg0 =
        extractJsStringLiteral(args?.namedChild(0)) ?? args?.namedChild(0)?.text.replace(/^['"]|['"]$/g, "") ?? "";
      if (
        arg0 === targetImport ||
        arg0.replace(/\.[cm]?[jt]sx?$/i, "") === targetImport.replace(/\.[cm]?[jt]sx?$/i, "")
      ) {
        violations.push({
          rule: "mock_unit_under_test",
          message: `Cannot mock the unit under test ("${arg0}").`,
          line: call.startPosition.row + 1,
        });
      }
    }

    // Check expect(...) assertions and tautologies like expect(true).toBe(true)
    if (fn.type === "identifier" && fn.text === "assert") {
      assertionCount += 1;
    } else if (fn.type === "member_expression") {
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
      } else if (/^assert(?:\.|$)/.test(fnText)) {
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

function unwrapPyExpr(node: Parser.SyntaxNode | null | undefined): Parser.SyntaxNode | null {
  let cur = node ?? null;
  while (cur?.type === "parenthesized_expression") {
    cur = cur.namedChild(0);
  }
  return cur;
}

function decodePythonStringBody(raw: string): string {
  return raw.replace(/\\(x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|U[0-9a-fA-F]{8}|n|r|t|\\|'|")/g, (m, esc: string) => {
    if (esc === "n") return "\n";
    if (esc === "r") return "\r";
    if (esc === "t") return "\t";
    if (esc === "\\" || esc === "'" || esc === '"') return esc;
    if (esc.startsWith("x") || esc.startsWith("u") || esc.startsWith("U")) {
      const cp = Number.parseInt(esc.slice(1), 16);
      return Number.isFinite(cp) && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
    }
    return m;
  });
}

function extractPythonStringLiteral(node: Parser.SyntaxNode | null | undefined, depth = 0): string | null {
  if (depth > 16) return null;
  const cur = unwrapPyExpr(node);
  if (!cur) return null;
  if (cur.type === "concatenated_string") {
    let acc = "";
    for (const part of cur.namedChildren) {
      const sub = extractPythonStringLiteral(part, depth + 1);
      if (sub === null) return null;
      acc += sub;
    }
    return acc;
  }
  if (cur.type === "binary_operator") {
    const hasPlus = cur.children.some((c) => !c.isNamed && c.text === "+");
    if (hasPlus) {
      const left = extractPythonStringLiteral(cur.childForFieldName("left"), depth + 1);
      const right = extractPythonStringLiteral(cur.childForFieldName("right"), depth + 1);
      if (left !== null && right !== null) return `${left}${right}`;
    }
    return null;
  }
  if (cur.type !== "string") return null;
  if (cur.namedChildren.some((c) => c.type === "interpolation")) return null;
  const prefixMatch = /^([rRuUfFbB]{0,2})(?:'''|"""|'|")/.exec(cur.text);
  const isRaw = Boolean(prefixMatch?.[1] && /[rR]/.test(prefixMatch[1]));
  const contentParts = cur.namedChildren.filter((c) => c.type === "string_content").map((c) => c.text);
  const rawBody =
    contentParts.length > 0
      ? contentParts.join("")
      : cur.text.replace(/^[rRuUfFbB]{0,2}(?:'''|"""|'|")|(?:'''|"""|'|")$/g, "");
  return isRaw ? rawBody : decodePythonStringBody(rawBody);
}

function resolvePythonCallableName(
  fnNode: Parser.SyntaxNode | null | undefined,
  osAliases: ReadonlySet<string>,
  builtinsAliases: ReadonlySet<string>,
  importlibAliases: ReadonlySet<string>,
  callAliases: ReadonlyMap<string, string>,
  sysAliases: ReadonlySet<string> = new Set(["sys"]),
): string {
  const cur = unwrapPyExpr(fnNode);
  if (!cur) return "";
  if (cur.type === "identifier") {
    return callAliases.get(cur.text) ?? cur.text;
  }
  if (cur.type === "attribute") {
    const obj = unwrapPyExpr(cur.childForFieldName("object"));
    const prop = cur.childForFieldName("attribute")?.text ?? "";
    if (obj?.type === "identifier") {
      if (osAliases.has(obj.text)) return `os.${prop}`;
      if (builtinsAliases.has(obj.text)) return prop;
      if (importlibAliases.has(obj.text)) return `importlib.${prop}`;
      if (sysAliases.has(obj.text)) return `sys.${prop}`;
    }
  }
  if (cur.type === "subscript") {
    const val = unwrapPyExpr(cur.childForFieldName("value"));
    const key = extractPythonStringLiteral(cur.childForFieldName("subscript"));
    if (
      key &&
      val?.type === "attribute" &&
      val.childForFieldName("attribute")?.text === "__dict__" &&
      val.childForFieldName("object")?.type === "identifier"
    ) {
      const rootName = val.childForFieldName("object")!.text;
      if (osAliases.has(rootName)) return `os.${key}`;
      if (builtinsAliases.has(rootName)) return key;
    }
    if (key && val?.type === "identifier" && (builtinsAliases.has(val.text) || val.text === "__builtins__")) {
      return key;
    }
  }
  return cur.text;
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
  const builtinsAliases = new Set(["builtins", "__builtins__"]);
  const importlibAliases = new Set(["importlib"]);
  const sysAliases = new Set(["sys"]);
  const sysModulesAliases = new Set<string>();
  const pytestAssertAliases = new Set<string>();
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
      if (name === "os" || name === "posix" || name === "nt") {
        osAliases.add(alias ?? name);
      } else if (name === "builtins") {
        builtinsAliases.add(alias ?? "builtins");
      } else if (name === "importlib") {
        importlibAliases.add(alias ?? "importlib");
      } else if (name === "sys") {
        sysAliases.add(alias ?? "sys");
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
      if (
        mod === "os" ||
        mod === "posix" ||
        mod === "nt" ||
        mod === "builtins" ||
        mod === "shutil" ||
        mod === "importlib" ||
        mod === "subprocess"
      ) {
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
      if (mod === "builtins") {
        if (bannedCalls.has(name) || PY_BANNED_BUILTIN_ATTRS.has(name)) {
          violations.push({
            rule: "banned_call",
            message: `Banned Python builtins import "from builtins import ${name}".`,
            line: imp.startPosition.row + 1,
          });
        }
        callAliases.set(alias ?? name, name);
      }
      if (qualified === "sys.modules") {
        sysModulesAliases.add(alias ?? name);
      }
      if (mod === "pytest" && (name === "raises" || name === "warns" || name === "fail")) {
        pytestAssertAliases.add(alias ?? name);
      }
      if (qualified === "os.environ" || qualified === "os.environb") {
        envAliases.add(alias ?? name);
      } else if (bannedCalls.has(qualified) || qualified === "getattr" || qualified === "builtins.getattr") {
        callAliases.set(alias ?? name, qualified === "builtins.getattr" ? "getattr" : qualified);
      }
    }
  }

  for (const assign of root.descendantsOfType("assignment")) {
    const lhs = unwrapPyExpr(assign.childForFieldName("left"));
    const rhs = unwrapPyExpr(assign.childForFieldName("right"));
    if (lhs?.type !== "identifier" || !rhs) continue;
    if (rhs.type === "identifier") {
      if (osAliases.has(rhs.text)) osAliases.add(lhs.text);
      else if (builtinsAliases.has(rhs.text)) builtinsAliases.add(lhs.text);
      else if (importlibAliases.has(rhs.text)) importlibAliases.add(lhs.text);
      else if (sysAliases.has(rhs.text)) sysAliases.add(lhs.text);
      else if (sysModulesAliases.has(rhs.text)) sysModulesAliases.add(lhs.text);
      else if (envAliases.has(rhs.text)) envAliases.add(lhs.text);
      else if (callAliases.has(rhs.text)) callAliases.set(lhs.text, callAliases.get(rhs.text)!);
      else if (bannedCalls.has(rhs.text) || rhs.text === "getattr" || rhs.text === "vars") {
        callAliases.set(lhs.text, rhs.text);
      }
    } else if (rhs.type === "attribute") {
      const rObj = unwrapPyExpr(rhs.childForFieldName("object"));
      const rAttr = rhs.childForFieldName("attribute")?.text ?? "";
      if (rObj?.type === "identifier") {
        if (osAliases.has(rObj.text) && (rAttr === "environ" || rAttr === "environb")) {
          envAliases.add(lhs.text);
        } else if (sysAliases.has(rObj.text) && rAttr === "modules") {
          sysModulesAliases.add(lhs.text);
        } else {
          const resolved = resolvePythonCallableName(
            rhs,
            osAliases,
            builtinsAliases,
            importlibAliases,
            callAliases,
            sysAliases,
          );
          if (bannedCalls.has(resolved) || resolved === "getattr" || resolved === "vars") {
            callAliases.set(lhs.text, resolved);
          }
        }
      }
    } else if (rhs.type === "call") {
      const fnName = resolvePythonCallableName(
        rhs.childForFieldName("function"),
        osAliases,
        builtinsAliases,
        importlibAliases,
        callAliases,
        sysAliases,
      );
      if (fnName === "getattr") {
        const gArgs = rhs.childForFieldName("arguments");
        const gArg0 = unwrapPyExpr(gArgs?.namedChild(0));
        const gArg1 = extractPythonStringLiteral(gArgs?.namedChild(1));
        if (gArg0?.type === "identifier" && osAliases.has(gArg0.text) && gArg1) {
          if (gArg1 === "environ" || gArg1 === "environb") envAliases.add(lhs.text);
          else callAliases.set(lhs.text, `os.${gArg1}`);
        } else if (gArg0?.type === "identifier" && builtinsAliases.has(gArg0.text) && gArg1) {
          callAliases.set(lhs.text, gArg1);
        }
      }
    }
  }

  for (const attr of root.descendantsOfType("attribute")) {
    const obj = unwrapPyExpr(attr.childForFieldName("object"));
    const prop = attr.childForFieldName("attribute")?.text ?? "";
    if (obj?.type === "identifier") {
      if (osAliases.has(obj.text) && (prop === "environ" || prop === "environb" || prop === "__dict__")) {
        violations.push({
          rule: prop === "__dict__" ? "banned_call" : "banned_env_access",
          message: `Banned Python env/reflection access "${obj.text}.${prop}".`,
          line: attr.startPosition.row + 1,
        });
      } else if (builtinsAliases.has(obj.text) && prop === "__dict__") {
        violations.push({
          rule: "banned_call",
          message: `Banned Python builtins reflection access "${obj.text}.__dict__".`,
          line: attr.startPosition.row + 1,
        });
      } else if (envAliases.has(obj.text)) {
        violations.push({
          rule: "banned_env_access",
          message: `Banned Python env attribute access "${obj.text}.${prop}".`,
          line: attr.startPosition.row + 1,
        });
      }
    }
  }

  for (const sub of root.descendantsOfType("subscript")) {
    const val = unwrapPyExpr(sub.childForFieldName("value"));
    if (val?.type === "identifier") {
      if (envAliases.has(val.text)) {
        violations.push({
          rule: "banned_env_access",
          message: `Banned Python env subscript "${val.text}[...]".`,
          line: sub.startPosition.row + 1,
        });
      } else if (builtinsAliases.has(val.text)) {
        violations.push({
          rule: "banned_call",
          message: `Banned Python builtins subscript "${val.text}[...]".`,
          line: sub.startPosition.row + 1,
        });
      } else if (sysModulesAliases.has(val.text)) {
        const modKey = extractPythonStringLiteral(sub.childForFieldName("subscript"));
        if (modKey === null || modKey === "os" || modKey === "builtins" || matchesBannedModule(modKey, bannedModules)) {
          violations.push({
            rule: "banned_import",
            message: `Banned Python sys.modules access "${sub.text}".`,
            line: sub.startPosition.row + 1,
          });
        }
      }
    } else if (
      val?.type === "attribute" &&
      val.childForFieldName("object")?.type === "identifier" &&
      sysAliases.has(val.childForFieldName("object")!.text) &&
      val.childForFieldName("attribute")?.text === "modules"
    ) {
      const modKey = extractPythonStringLiteral(sub.childForFieldName("subscript"));
      if (modKey === null || modKey === "os" || modKey === "builtins" || matchesBannedModule(modKey, bannedModules)) {
        violations.push({
          rule: "banned_import",
          message: `Banned Python sys.modules access "${sub.text}".`,
          line: sub.startPosition.row + 1,
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
    const fnNode = unwrapPyExpr(call.childForFieldName("function"));
    const fnText = fnNode?.text ?? "";
    const canonicalFn = resolvePythonCallableName(
      fnNode,
      osAliases,
      builtinsAliases,
      importlibAliases,
      callAliases,
      sysAliases,
    );

    if (bannedCalls.has(canonicalFn)) {
      violations.push({
        rule: "banned_call",
        message: `Banned Python call "${canonicalFn}()".`,
        line: call.startPosition.row + 1,
      });
    }

    const args = call.childForFieldName("arguments");
    if (fnNode?.type === "attribute") {
      const mObj = unwrapPyExpr(fnNode.childForFieldName("object"));
      const mProp = fnNode.childForFieldName("attribute")?.text ?? "";
      const isSysModulesTarget =
        (mObj?.type === "identifier" && sysModulesAliases.has(mObj.text)) ||
        (mObj?.type === "attribute" &&
          mObj.childForFieldName("object")?.type === "identifier" &&
          sysAliases.has(mObj.childForFieldName("object")!.text) &&
          mObj.childForFieldName("attribute")?.text === "modules");
      if (isSysModulesTarget && (mProp === "get" || mProp === "pop" || mProp === "values")) {
        if (mProp === "values") {
          violations.push({
            rule: "banned_import",
            message: `Banned Python sys.modules.${mProp}() call.`,
            line: call.startPosition.row + 1,
          });
        } else {
          const modKey = extractPythonStringLiteral(args?.namedChild(0));
          if (
            modKey === null ||
            modKey === "os" ||
            modKey === "builtins" ||
            matchesBannedModule(modKey, bannedModules)
          ) {
            violations.push({
              rule: "banned_import",
              message: `Banned Python sys.modules.${mProp}() access "${call.text}".`,
              line: call.startPosition.row + 1,
            });
          }
        }
      }
    }
    if (canonicalFn === "getattr") {
      const arg0 = unwrapPyExpr(args?.namedChild(0));
      const arg1 = extractPythonStringLiteral(args?.namedChild(1));
      if (arg0?.type === "identifier" && osAliases.has(arg0.text)) {
        if (arg1 === null || PY_BANNED_OS_ATTRS.has(arg1)) {
          violations.push({
            rule: arg1 === "environ" || arg1 === "environb" ? "banned_env_access" : "banned_call",
            message: `Banned Python reflection access "getattr(${arg0.text}, ${arg1 ? `'${arg1}'` : "..."})".`,
            line: call.startPosition.row + 1,
          });
        }
      } else if (arg0?.type === "identifier" && builtinsAliases.has(arg0.text)) {
        if (arg1 === null || PY_BANNED_BUILTIN_ATTRS.has(arg1)) {
          violations.push({
            rule: "banned_call",
            message: `Banned Python builtins reflection "getattr(${arg0.text}, ${arg1 ? `'${arg1}'` : "..."})".`,
            line: call.startPosition.row + 1,
          });
        }
      }
    }

    if (canonicalFn === "vars") {
      const arg0 = unwrapPyExpr(args?.namedChild(0));
      if (arg0?.type === "identifier" && (osAliases.has(arg0.text) || builtinsAliases.has(arg0.text))) {
        violations.push({
          rule: "banned_call",
          message: `Banned Python reflection call "vars(${arg0.text})".`,
          line: call.startPosition.row + 1,
        });
      }
    }

    for (const arg of args?.namedChildren ?? []) {
      const unwrappedArg = unwrapPyExpr(arg);
      if (unwrappedArg?.type === "identifier" && envAliases.has(unwrappedArg.text)) {
        violations.push({
          rule: "banned_env_access",
          message: `Banned Python env pass-by-value "${unwrappedArg.text}".`,
          line: call.startPosition.row + 1,
        });
      }
    }

    const fnTail = fnText.split(".").pop() ?? "";
    if (
      fnText === "pytest.raises" ||
      fnText === "pytest.warns" ||
      fnText === "pytest.fail" ||
      pytestAssertAliases.has(fnText) ||
      /^(?:assert_|assert[A-Z])/.test(fnTail)
    ) {
      assertionCount += 1;
    }
    if (
      targetMod &&
      (fnText === "patch" || fnText === "mock.patch" || fnText === "unittest.mock.patch" || fnText === "mocker.patch")
    ) {
      const arg0 = extractPythonStringLiteral(args?.namedChild(0)) ?? "";
      const isDirectUnitMock =
        arg0 === targetMod ||
        Boolean(
          opts.targetSymbolNames &&
          opts.targetSymbolNames.length > 0 &&
          opts.targetSymbolNames.some(
            (sym) => arg0 === `${targetMod}.${sym}` || arg0.startsWith(`${targetMod}.${sym}.`),
          ),
        );
      if (isDirectUnitMock) {
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
  const raw = typeNode.type === "generic_type" ? (typeNode.namedChild(0)?.text ?? typeNode.text) : typeNode.text;
  return raw.replace(/\s+/g, "");
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
    if (mod.endsWith(".*")) continue;
    bannedConstructors.add(mod);
    const dotIdx = mod.lastIndexOf(".");
    const simple = dotIdx !== -1 ? mod.slice(dotIdx + 1) : mod;
    if (simple !== "Process" && simple !== "Runtime") {
      bannedConstructors.add(simple);
    }
  }

  const staticWildcardClasses = new Set<string>();
  const staticMethodAliases = new Map<string, string>();
  const expectedClass = path.posix.parse(opts.testPath).name;
  let testCount = 0;
  let assertionCount = root.descendantsOfType("assert_statement").length;

  const pkgHintMatch = /package\s+([A-Za-z0-9_.]+)\s*;/.exec(opts.importHint ?? "");
  if (pkgHintMatch?.[1]) {
    const pkgNode = root.descendantsOfType("package_declaration")[0];
    const actualPkg = pkgNode?.text
      .replace(/^package\s+/, "")
      .replace(/;$/, "")
      .replace(/\s+/g, "");
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
    const isTopLevel = cls.parent?.type === "program";
    if (isTopLevel && /\bpublic\b/.test(clsMods) && clsName && clsName !== expectedClass) {
      violations.push({
        rule: "java_classname_mismatch",
        message: `Public Java test class "${clsName}" must match filename "${expectedClass}".`,
        line: cls.startPosition.row + 1,
      });
    }
    const superCls = cls.childForFieldName("superclass")?.text ?? "";
    if (/\b(?:java\.lang\.)?ClassLoader\b/.test(superCls)) {
      violations.push({
        rule: "banned_call",
        message: `Extending ClassLoader ("${superCls}") is disallowed.`,
        line: cls.startPosition.row + 1,
      });
    }
  }

  for (const imp of root.descendantsOfType("import_declaration")) {
    const isStatic = /\bstatic\b/.test(imp.text);
    const clean = imp.text
      .replace(/^import\s+(?:static\s+)?/, "")
      .replace(/;$/, "")
      .replace(/\s+/g, "");
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
        if (
          cls === "System" ||
          cls === "Runtime" ||
          cls === "Files" ||
          cls === "HttpClient" ||
          cls === "Class" ||
          cls === "MethodHandles" ||
          cls === "SocketChannel" ||
          cls === "URI"
        ) {
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
    const lhs = (parts[0]?.text ?? "").replace(/\s+/g, "");
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
      const rhs = (parts[parts.length - 1]?.text ?? "").replace(/\s+/g, "");
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
    const name = (ann.childForFieldName("name")?.text ?? "").replace(/\s+/g, "");
    if (/^(?:.*?\.)?(?:Test|ParameterizedTest|RepeatedTest|TestFactory|TestTemplate)$/.test(name)) {
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
    const obj = inv.childForFieldName("object")?.text.replace(/\s+/g, "");
    const name = (inv.childForFieldName("name")?.text ?? "").replace(/\s+/g, "");
    const fullName = obj ? `${obj}.${name}` : name;
    const normalizedName = fullName.replace(JAVA_STDLIB_PREFIX_RE, "");

    if (
      bannedCalls.has(fullName) ||
      bannedCalls.has(normalizedName) ||
      name === "openConnection" ||
      name === "openStream" ||
      name === "toURL"
    ) {
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

    if (
      /^(?:Assertions\.)?assert/.test(fullName) ||
      name.startsWith("assert") ||
      name === "verify" ||
      name === "verifyNoInteractions" ||
      name === "verifyNoMoreInteractions" ||
      name === "fail"
    ) {
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
