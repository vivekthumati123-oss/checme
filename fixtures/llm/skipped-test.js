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
        `import pytest`,
        `from ${importHint} import ${fnName}`,
        "",
        `@pytest.mark.skip(reason="skipped by llm")`,
        `def test_skipped():`,
        `    assert ${fnName}(1, 2) == 3`,
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
      `  it.skip("skipped test", () => {`,
      `    expect(${fnName}(1, 2)).toBe(3);`,
      `  });`,
      `});`,
      "",
    ].join("\n"),
  };
}

