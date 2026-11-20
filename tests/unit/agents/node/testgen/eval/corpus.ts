import type { LanguageKey } from "../../../../../../agents/node/testgen/src/contracts";

export interface EvalCase {
  id: string;
  language: LanguageKey;
  category: "pure" | "branching" | "collaborator";
  sourcePath: string;
  testPath: string;
  symbolName: string;
  importHint: string;
  expectedGatePass: boolean;
  sampleTestContent: string;
}

const jsCases: EvalCase[] = Array.from({ length: 10 }, (_, idx) => {
  const n = idx + 1;
  const cat: EvalCase["category"] = n <= 4 ? "pure" : n <= 7 ? "branching" : "collaborator";
  const fnName = `computeMetric${n}`;
  return {
    id: `js-${n}`,
    language: "javascript",
    category: cat,
    sourcePath: `src/eval/jsMetric${n}.ts`,
    testPath: `test/eval/jsMetric${n}.test.ts`,
    symbolName: fnName,
    importHint: `import { ${fnName} } from "../../../../../../agents/node/testgen/src/eval/jsMetric${n}";`,
    expectedGatePass: true,
    sampleTestContent: [
      'import { expect, it, vi } from "vitest";',
      `import { ${fnName} } from "../../../../../../agents/node/testgen/src/eval/jsMetric${n}";`,
      "",
      `it("${fnName} handles normal inputs", () => {`,
      `  const spy = vi.fn(() => ${n});`,
      "  expect(spy()).toBe(" + String(n) + ");",
      `  expect(typeof ${fnName}).toBe("function");`,
      "});",
      "",
      `it("${fnName} rejects invalid boundary", () => {`,
      `  expect(() => { if (${n} < 0) throw new Error("bad"); return ${fnName}(0); }).not.toThrow();`,
      "});",
    ].join("\n"),
  };
});

const pyCases: EvalCase[] = Array.from({ length: 10 }, (_, idx) => {
  const n = idx + 1;
  const cat: EvalCase["category"] = n <= 4 ? "pure" : n <= 7 ? "branching" : "collaborator";
  const fnName = `compute_rate_${n}`;
  return {
    id: `py-${n}`,
    language: "python",
    category: cat,
    sourcePath: `src/pkg/py_rate_${n}.py`,
    testPath: `tests/test_py_rate_${n}.py`,
    symbolName: fnName,
    importHint: `from pkg.py_rate_${n} import ${fnName}`,
    expectedGatePass: true,
    sampleTestContent: [
      "import pytest",
      `from pkg.py_rate_${n} import ${fnName}`,
      "",
      `def test_${fnName}_normal():`,
      `    result = ${fnName}(${n})`,
      `    assert result == ${n}`,
      "",
      `def test_${fnName}_zero():`,
      "    with pytest.raises(ValueError):",
      `        ${fnName}(-1)`,
    ].join("\n"),
  };
});

const javaCases: EvalCase[] = Array.from({ length: 10 }, (_, idx) => {
  const n = idx + 1;
  const cat: EvalCase["category"] = n <= 4 ? "pure" : n <= 7 ? "branching" : "collaborator";
  const clsName = `LedgerCalc${n}`;
  return {
    id: `java-${n}`,
    language: "java",
    category: cat,
    sourcePath: `src/main/java/com/acme/${clsName}.java`,
    testPath: `src/test/java/com/acme/${clsName}Test.java`,
    symbolName: `${clsName}.calculate`,
    importHint: `package com.acme;\nimport com.acme.${clsName};`,
    expectedGatePass: true,
    sampleTestContent: [
      "package com.acme;",
      "import org.junit.jupiter.api.Test;",
      "import static org.junit.jupiter.api.Assertions.*;",
      `class ${clsName}Test {`,
      "  @Test",
      "  void normalPath() {",
      `    assertEquals(${n}, new ${clsName}().calculate(${n}));`,
      "  }",
      "  @Test",
      "  void negativeThrows() {",
      `    assertThrows(IllegalArgumentException.class, () -> new ${clsName}().calculate(-1));`,
      "  }",
      "}",
    ].join("\n"),
  };
});

export const EVAL_CORPUS: readonly EvalCase[] = [...jsCases, ...pyCases, ...javaCases];
