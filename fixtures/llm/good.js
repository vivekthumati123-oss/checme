import path from "node:path";

function extractSpecifier(hint = "") {
  const js = /from\s+["']([^"']+)["']/.exec(hint);
  if (js?.[1]) return js[1];
  const py = /^from\s+([A-Za-z0-9_.]+)\s+import/.exec(hint.trim());
  if (py?.[1]) return py[1];
  return hint;
}

function buildValidTest({ context }) {
  const targetNames = context.targets.map((t) => t.qualifiedName.split(".").pop()).filter(Boolean);
  const importTarget = extractSpecifier(context.conventions.importHint);

  if (context.language === "python") {
    const imports = [...new Set(targetNames)].join(", ") || "add";
    return {
      content: [
        `import pytest`,
        `from ${importTarget} import ${imports}`,
        "",
        `def test_valid_behavior():`,
        `    assert callable(${targetNames[0] ?? imports})`,
        `    assert ${targetNames[0] ?? imports}(2, 3) == 5`,
        "",
      ].join("\n"),
      assumptions: ["Generated valid pytest test from fixtures/llm/good.js"],
    };
  }

  if (context.language === "java") {
    const clsName = path.posix.parse(context.conventions.testPath).name;
    const pkgMatch = /package\s+([A-Za-z0-9_.]+)\s*;/.exec(context.conventions.importHint ?? "");
    const resolvedPkg = context.packageName ?? pkgMatch?.[1];
    const pkg = resolvedPkg ? `package ${resolvedPkg};\n\n` : "";
    return {
      content: [
        `${pkg}import org.junit.jupiter.api.Test;`,
        `import static org.junit.jupiter.api.Assertions.*;`,
        "",
        `public class ${clsName} {`,
        `    @Test`,
        `    void validTestCase() {`,
        `        assertEquals(5, 2 + 3);`,
        `    }`,
        `}`,
        "",
      ].join("\n"),
      assumptions: ["Generated valid JUnit 5 test from fixtures/llm/good.js"],
    };
  }

  const isJest = context.framework === "jest";
  const header = isJest ? "" : `import { describe, it, expect } from "vitest";\n`;
  const exportedName = targetNames[0] ?? "add";
  return {
    content: [
      `${header}import { ${exportedName} } from "${importTarget}";`,
      "",
      `describe("${exportedName}", () => {`,
      `  it("handles valid inputs", () => {`,
      `    expect(${exportedName}(2, 3)).toBe(5);`,
      `  });`,
      `});`,
      "",
    ].join("\n"),
    assumptions: ["Generated valid JS test from fixtures/llm/good.js"],
  };
}

export default buildValidTest;

