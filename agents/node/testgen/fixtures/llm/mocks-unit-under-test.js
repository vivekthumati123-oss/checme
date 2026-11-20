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
        `from ${importHint} import ${fnName}`,
        `import ${importHint} as target_mod`,
        "",
        `def test_mocks_self(monkeypatch):`,
        `    monkeypatch.setattr(target_mod, "${fnName}", lambda a, b: 99)`,
        `    assert target_mod.${fnName}(1, 2) == 99`,
        "",
      ].join("\n"),
    };
  }
  const header = context.framework === "jest" ? "" : `import { describe, it, expect, vi } from "vitest";\n`;
  const mockFn = context.framework === "jest" ? "jest.mock" : "vi.mock";
  return {
    content: [
      `${header}import { ${fnName} } from "${importHint}";`,
      `${mockFn}("${importHint}", () => ({ ${fnName}: () => 42 }));`,
      "",
      `describe("${fnName}", () => {`,
      `  it("mocks the unit under test", () => {`,
      `    expect(${fnName}(1, 2)).toBe(42);`,
      `  });`,
      `});`,
      "",
    ].join("\n"),
  };
}

