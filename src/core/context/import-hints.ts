import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import type { LanguageKey } from "../../contracts";
import { cleanRepoRelative, normalizeSlashes } from "../paths";

export function resolvePythonRoots(params: {
  repoRoot: string;
  workingDirectory?: string;
  configuredPythonPath?: readonly string[];
}): string[] {
  const roots = new Set<string>();
  const wdRel = cleanRepoRelative(normalizeSlashes(params.workingDirectory ?? "."));
  const wdAbs = path.resolve(params.repoRoot, wdRel || ".");

  const addRoot = (candidateRel: string): void => {
    const joined =
      wdRel && wdRel !== "." ? cleanRepoRelative(`${wdRel}/${candidateRel}`) : cleanRepoRelative(candidateRel);
    roots.add(joined || ".");
  };

  if (params.configuredPythonPath) {
    for (const p of params.configuredPythonPath) {
      addRoot(p);
    }
  }

  // Check pyproject.toml pythonpath / setuptools src where
  const pyprojectPath = path.join(wdAbs, "pyproject.toml");
  if (existsSync(pyprojectPath)) {
    const raw = readFileSync(pyprojectPath, "utf8");
    const pyPathMatch = /pythonpath\s*=\s*\[([^\]]+)\]/s.exec(raw);
    if (pyPathMatch?.[1]) {
      for (const m of pyPathMatch[1].matchAll(/["']([^"']+)["']/g)) {
        if (m[1]) addRoot(m[1]);
      }
    }
    const whereMatch = /where\s*=\s*\[([^\]]+)\]/s.exec(raw);
    if (whereMatch?.[1]) {
      for (const m of whereMatch[1].matchAll(/["']([^"']+)["']/g)) {
        if (m[1]) addRoot(m[1]);
      }
    }
  }

  // Check pytest.ini / setup.cfg
  for (const iniName of ["pytest.ini", "setup.cfg"]) {
    const iniPath = path.join(wdAbs, iniName);
    if (!existsSync(iniPath)) continue;
    const raw = readFileSync(iniPath, "utf8");
    const m = /^\s*pythonpath\s*=\s*(.+)$/m.exec(raw);
    if (m?.[1]) {
      for (const tok of m[1].trim().split(/[\s,]+/)) {
        if (tok) addRoot(tok);
      }
    }
    const srcPkgMatch = /=\s*src\b/.test(raw);
    if (srcPkgMatch) {
      addRoot("src");
    }
  }

  if (existsSync(path.join(wdAbs, "src"))) {
    addRoot("src");
  }
  addRoot(".");

  // Sort longest paths first so `pkg/src` wins over `pkg` or `.`
  return [...roots].sort((a, b) => b.length - a.length);
}

function usesEsmJsExtensions(repoRoot: string, workingDirectory: string): boolean {
  const wdAbs = path.resolve(repoRoot, workingDirectory || ".");
  const tsconfigPath = path.join(wdAbs, "tsconfig.json");
  if (existsSync(tsconfigPath)) {
    try {
      const text = readFileSync(tsconfigPath, "utf8");
      if (/"moduleResolution"\s*:\s*"(?:nodenext|node16)"/i.test(text)) {
        return true;
      }
    } catch {
      // ignore malformed tsconfig comments
    }
  }
  return false;
}

type CjsHintStyle = { kind: "named" } | { kind: "default"; name: string };

function stripJsCommentsAndLiterals(source: string): string {
  return source.replace(/"(?:\\.|[^"\\\r\n])*"|'(?:\\.|[^'\\\r\n])*'|\/\*[\s\S]*?\*\/|\/\/[^\r\n]*/g, (match) =>
    match.startsWith('"') || match.startsWith("'") ? '""' : " ",
  );
}

function fallbackIdentifierFromPath(sourcePath: string): string {
  const base = path.posix.basename(sourcePath).replace(/\.[^.]+$/, "");
  const sanitized = base.replace(/[^A-Za-z0-9_$]+/g, "_").replace(/^([0-9])/, "_$1");
  return sanitized || "mod";
}

function detectJsCommonJsHintStyle(params: {
  repoRoot: string;
  normSource: string;
  sourceContent?: string;
  primaryClassName?: string;
}): CjsHintStyle | null {
  if (/\.(ts|tsx|mts|mjs)$/i.test(params.normSource)) {
    return null;
  }

  const isExplicitCjs = /\.(cjs|cts)$/i.test(params.normSource);
  let rawSource = params.sourceContent;
  if (rawSource === undefined) {
    const absSource = path.resolve(params.repoRoot, params.normSource);
    if (existsSync(absSource)) {
      try {
        rawSource = readFileSync(absSource, "utf8");
      } catch {
        rawSource = undefined;
      }
    }
  }

  if (rawSource === undefined) {
    return isExplicitCjs ? { kind: "named" } : null;
  }

  const cleaned = stripJsCommentsAndLiterals(rawSource);
  const hasEsmExport =
    /(?:^|[;\n])\s*export\s+(?:default\b|async\s+function\b|function\b|const\b|let\b|var\b|class\b|type\b|interface\b|enum\b|\{|\*)/.test(
      cleaned,
    );
  const hasEsmImport = /(?:^|[;\n])\s*import\s+(?:[\w*{$\s,]+\s+from\s+|"")/.test(cleaned);
  const hasCjsMarker = /\bmodule\.exports\b|\bexports\.[A-Za-z_$]|\bexports\s*\[|\brequire\s*\(/.test(cleaned);

  if (!isExplicitCjs && (hasEsmExport || (hasEsmImport && !hasCjsMarker) || !hasCjsMarker)) {
    return null;
  }

  const hasNamedOrObjectExports =
    /\bmodule\.exports\s*=\s*\{/.test(cleaned) ||
    /\b(?:module\.)?exports\.[A-Za-z0-9_$]+\s*=/.test(cleaned) ||
    /\b(?:module\.)?exports\s*\[/.test(cleaned);
  if (hasNamedOrObjectExports) {
    return { kind: "named" };
  }

  const singleExportMatch =
    /\bmodule\.exports\s*=\s*\(?\s*(?:async\s+)?(?:function(?:\s+([A-Za-z_$][A-Za-z0-9_$]*))?|class(?:\s+([A-Za-z_$][A-Za-z0-9_$]*))?|([A-Za-z_$][A-Za-z0-9_$]*))/.exec(
      cleaned,
    );
  if (singleExportMatch) {
    const candidate = singleExportMatch[1] || singleExportMatch[2] || singleExportMatch[3];
    const ignored = new Set(["exports", "require", "undefined", "null", "true", "false", "function", "class", "async"]);
    const name =
      candidate && !ignored.has(candidate)
        ? candidate
        : (params.primaryClassName ?? fallbackIdentifierFromPath(params.normSource));
    return { kind: "default", name };
  }

  return { kind: "named" };
}

export function computeImportHint(params: {
  language: LanguageKey;
  repoRoot: string;
  workingDirectory?: string;
  sourcePath: string;
  testPath: string;
  packageName?: string;
  primaryClassName?: string;
  configuredPythonPath?: readonly string[];
  sourceContent?: string;
}): string {
  const normSource = cleanRepoRelative(normalizeSlashes(params.sourcePath));
  const normTest = cleanRepoRelative(normalizeSlashes(params.testPath));

  if (params.language === "javascript") {
    const testDir = path.posix.dirname(normTest);
    let rel = path.posix.relative(testDir === "." ? "" : testDir, normSource);
    if (!rel.startsWith(".")) {
      rel = `./${rel}`;
    }
    const appendJs = usesEsmJsExtensions(params.repoRoot, params.workingDirectory ?? ".");
    const cjsHint = detectJsCommonJsHintStyle({
      repoRoot: params.repoRoot,
      normSource,
      sourceContent: params.sourceContent,
      primaryClassName: params.primaryClassName,
    });

    if (/\.(ts|tsx|mts|cts|jsx)$/i.test(rel)) {
      rel = rel.replace(/\.(ts|tsx|mts|cts|jsx)$/i, appendJs ? ".js" : "");
    } else if (/\.js$/i.test(rel) && (!appendJs || cjsHint !== null)) {
      rel = rel.replace(/\.js$/i, "");
    }

    if (cjsHint?.kind === "default") {
      return `const ${cjsHint.name} = require("${rel}");`;
    }
    if (cjsHint?.kind === "named") {
      return `const { ... } = require("${rel}");`;
    }
    return `import { ... } from "${rel}";`;
  }

  if (params.language === "python") {
    const roots = resolvePythonRoots({
      repoRoot: params.repoRoot,
      workingDirectory: params.workingDirectory,
      configuredPythonPath: params.configuredPythonPath,
    });
    let modPath = normSource;
    for (const root of roots) {
      if (root === ".") continue;
      if (modPath.startsWith(`${root}/`)) {
        modPath = modPath.slice(root.length + 1);
        break;
      }
    }
    modPath = modPath.replace(/\.py$/i, "").replace(/\/__init__$/, "");
    const dotted = modPath.split("/").filter(Boolean).join(".");
    return `from ${dotted} import ...`;
  }

  // Java
  const className = params.primaryClassName ?? path.posix.parse(normSource).name;
  let pkg = params.packageName;
  if (!pkg) {
    const m = /(?:^|\/)src\/main\/java\/(.+)\/[^/]+\.java$/.exec(normSource);
    if (m?.[1]) {
      pkg = m[1].replace(/\//g, ".");
    }
  }
  return pkg ? `package ${pkg};\nimport ${pkg}.${className};` : `import ${className};`;
}
