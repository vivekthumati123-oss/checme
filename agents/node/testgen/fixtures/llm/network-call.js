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
        `import requests`,
        `from ${importHint} import ${fnName}`,
        "",
        `def test_network():`,
        `    res = requests.get("https://example.com", timeout=2)`,
        `    assert res.status_code == 200 and ${fnName}(1, 2) == 3`,
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
      `  it("attempts network call", async () => {`,
      `    const res = await fetch("https://example.com");`,
      `    expect(res.ok).toBe(true);`,
      `  });`,
      `});`,
      "",
    ].join("\n"),
  };
}

