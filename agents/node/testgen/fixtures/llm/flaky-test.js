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
      content: [
        `import random`,
        `from ${importHint} import ${fnName}`,
        "",
        `def test_flaky_behavior():`,
        `    assert ${fnName}(2, 3) == (5 if random.random() > 0.5 else 6)`,
        "",
      ].join("\n"),
    };
  }
  const header = context.framework === "jest" ? "" : `import { describe, it, expect } from "vitest";\n`;
  return {
    content: [
      `${header}import { ${fnName} } from "${importHint}";`,
      "",
      `describe("${fnName}", () => {`,
      `  it("flaky non-deterministic assertion", () => {`,
      `    expect(${fnName}(2, 3)).toBe(Math.random() > 0.5 ? 5 : 6);`,
      `  });`,
      `});`,
      "",
    ].join("\n"),
  };
}

