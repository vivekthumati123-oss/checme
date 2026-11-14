export default function ({ context }) {
  const fnName = context.targets[0]?.qualifiedName.split(".").pop() ?? "add";
  const hint = context.conventions.importHint ?? "";
  const importHint = /from\s+["']([^"']+)["']/.exec(hint)?.[1] ?? hint;
  const pad = "// oversize padding comment\n".repeat(12000);
  const header = context.framework === "jest" ? "" : `import { describe, it, expect } from "vitest";\n`;
  return {
    content: `${header}import { ${fnName} } from "${importHint}";\n${pad}describe("${fnName}", () => {\n  it("oversized", () => {\n    expect(${fnName}(1, 2)).toBe(3);\n  });\n});\n`,
  };
}

