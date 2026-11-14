function extractSpecifier(hint = "") {
  const js = /from\s+["']([^"']+)["']/.exec(hint);
  if (js?.[1]) return js[1];
  const py = /^from\s+([A-Za-z0-9_.]+)\s+import/.exec(hint.trim());
  if (py?.[1]) return py[1];
  return hint;
}

export default function ({ context }) {
  const fnName = context.targets[0]?.qualifiedName.split(".").pop() ?? "add";
  const importHint = extractSpecifier(context.conventions.importHint);
  if (context.language === "python") {
    return {
      content: `from ${importHint} import ${fnName}\n\ndef test_missing_assertion():\n    _ = ${fnName}(1, 2)\n`,
    };
  }
  const header = context.framework === "jest" ? "" : `import { describe, it } from "vitest";\n`;
  return {
    content: [
      `${header}import { ${fnName} } from "${importHint}";`,
      "",
      `describe("${fnName}", () => {`,
      `  it("has no assertion", () => {`,
      `    ${fnName}(1, 2);`,
      `  });`,
      `});`,
      "",
    ].join("\n"),
  };
}

