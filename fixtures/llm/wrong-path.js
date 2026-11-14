export default function ({ context }) {
  const fnName = context.targets[0]?.qualifiedName.split(".").pop() ?? "add";
  const hint = context.conventions.importHint ?? "";
  const importHint = /from\s+["']([^"']+)["']/.exec(hint)?.[1] ?? hint;
  const header = context.framework === "jest" ? "" : `import { describe, it, expect } from "vitest";\n`;
  return {
    testPath: "src/outside-test-glob.test.js",
    content: [
      `${header}import { ${fnName} } from "${importHint}";`,
      "",
      `describe("${fnName}", () => {`,
      `  it("wrong path outside test glob", () => {`,
      `    expect(${fnName}(1, 2)).toBe(3);`,
      `  });`,
      `});`,
      "",
    ].join("\n"),
  };
}

