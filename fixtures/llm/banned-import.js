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
        `import subprocess`,
        `from ${importHint} import ${fnName}`,
        "",
        `def test_banned_subprocess():`,
        `    subprocess.run(["echo", "hi"], check=True)`,
        `    assert ${fnName}(1, 1) == 2`,
        "",
      ].join("\n"),
    };
  }
  const header = context.framework === "jest" ? "" : `import { describe, it, expect } from "vitest";\n`;
  return {
    content: [
      `${header}import { execSync } from "node:child_process";`,
      `import { ${fnName} } from "${importHint}";`,
      "",
      `describe("${fnName}", () => {`,
      `  it("uses banned child_process", () => {`,
      `    execSync("echo blocked");`,
      `    expect(${fnName}(1, 2)).toBe(3);`,
      `  });`,
      `});`,
      "",
    ].join("\n"),
  };
}

