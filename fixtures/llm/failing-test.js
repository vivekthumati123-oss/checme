function extractSpecifier(hint = "") {
  const js = /from\s+["']([^"']+)["']/.exec(hint);
  if (js?.[1]) return js[1];
  const py = /^from\s+([A-Za-z0-9_.]+)\s+import/.exec(hint.trim());
  if (py?.[1]) return py[1];
  return hint;
}

export default function ({ mode, context }) {
  const fnName = context.targets[0]?.qualifiedName.split(".").pop() ?? "add";
  const importHint = extractSpecifier(context.conventions.importHint);

  if (context.language === "python") {
    if (mode === "repair") {
      return {
        content: `from ${importHint} import ${fnName}\n\ndef test_passes_after_repair():\n    assert ${fnName}(2, 3) == 5\n`,
      };
    }
    return {
      content: [
        `from ${importHint} import ${fnName}`,
        "",
        `def test_passes():`,
        `    assert ${fnName}(2, 3) == 5`,
        "",
        `def test_intentionally_failing():`,
        `    assert ${fnName}(2, 3) == 999`,
        "",
      ].join("\n"),
    };
  }

  const header = context.framework === "jest" ? "" : `import { describe, it, expect } from "vitest";\n`;
  if (mode === "repair") {
    return {
      content: [
        `${header}import { ${fnName} } from "${importHint}";`,
        "",
        `describe("${fnName}", () => {`,
        `  it("passes after repair", () => {`,
        `    expect(${fnName}(2, 3)).toBe(5);`,
        `  });`,
        `});`,
        "",
      ].join("\n"),
    };
  }

  return {
    content: [
      `${header}import { ${fnName} } from "${importHint}";`,
      "",
      `describe("${fnName}", () => {`,
      `  it("passes first case", () => {`,
      `    expect(${fnName}(2, 3)).toBe(5);`,
      `  });`,
      "",
      `  it("fails wrong expectation", () => {`,
      `    expect(${fnName}(2, 3)).toBe(999);`,
      `  });`,
      `});`,
      "",
    ].join("\n"),
  };
}

