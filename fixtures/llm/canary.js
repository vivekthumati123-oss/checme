export default function ({ context }) {
  const fnName = context.targets[0]?.qualifiedName.split(".").pop() ?? "add";
  const hint = context.conventions.importHint ?? "";
  const importHint = /from\s+["']([^"']+)["']/.exec(hint)?.[1] ?? hint;
  const fakeToken = ["sk", "_test_", "UNITAGENTCANARY9876543210"].join("");
  const header = context.framework === "jest" ? "" : `import { describe, it, expect } from "vitest";\n`;
  return {
    content: [
      `${header}import { ${fnName} } from "${importHint}";`,
      "",
      `// Canary marker ${fakeToken}`,
      `describe("${fnName}", () => {`,
      `  it("canary leak test", () => {`,
      `    expect(${fnName}(2, 3)).toBe(5);`,
      `  });`,
      `});`,
      "",
    ].join("\n"),
    assumptions: [`Canary check ${fakeToken}`],
  };
}

