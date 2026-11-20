export default function ({ context }) {
  if (context.targets.length > 1) {
    return {
      simulateTruncation: true,
      content: "",
    };
  }
  const fnName = context.targets[0]?.qualifiedName.split(".").pop() ?? "add";
  const hint = context.conventions.importHint ?? "";
  const jsMatch = /from\s+["']([^"']+)["']/.exec(hint);
  const importHint = jsMatch?.[1] ?? hint;
  const header = context.framework === "jest" ? "" : `import { describe, it, expect } from "vitest";\n`;
  return {
    content: [
      `${header}import { ${fnName} } from "${importHint}";`,
      "",
      `describe("${fnName}", () => {`,
      `  it("succeeds after reduced-target retry", () => {`,
      `    expect(${fnName}(2, 3)).toBe(5);`,
      `  });`,
      `});`,
      "",
    ].join("\n"),
    assumptions: ["Succeeded after truncation retry"],
  };
}

